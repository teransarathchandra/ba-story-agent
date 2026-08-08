// Use zod/v4 because zodOutputFormat requires it (zod@^3.25.76 resolves bare import to v3)
import { z } from "zod/v4";
import { listClaims } from "../store/claims.js";
import { insertRequirements, nextKey } from "../store/artifacts.js";
import { getProject } from "../store/projects.js";
import { newId } from "../types/ids.js";
import { callTyped } from "../llm/parse.js";
import { REQUIREMENTS_SYSTEM, buildRequirementsUser } from "../prompts/requirements.js";
import type { PipelineState } from "./state.js";
import type { Stage } from "./runner.js";
import type { Requirement } from "../types/domain.js";

export const RequirementDraftsSchema = z.object({
  requirements: z.array(
    z.object({
      statement: z.string(),
      originClaimIds: z.array(z.string()),
    }),
  ),
});

/**
 * Synthesize requirements from validated requirement claims.
 *
 * A draft with no origin claims, or one citing a claim that does not exist,
 * is dropped here — before the store, before the schema, before a human sees
 * it. Combined with RequirementSchema's refine(), there is no code path in
 * this system that produces an unsourced client-stated requirement.
 */
export const stage5Requirements: Stage<PipelineState, PipelineState> = {
  name: "requirements",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");

    const validatedRequirementClaims = listClaims(ctx.db, ctx.sessionId, { status: "validated", kind: "requirement" });
    // Mechanical defense-in-depth: the extraction prompt already instructs the
    // model that "the analyst's own questions and suggestions are not client
    // claims," but that is a prompt instruction only. If extraction ever
    // mis-attributes the analyst's own words as a client claim, this is the
    // last point before that content becomes a persisted "client-stated"
    // Requirement — so it is excluded here rather than trusted to have been
    // filtered correctly upstream. Only "ba" is excluded, not "unknown" or
    // "other": "unknown" commonly means the model couldn't identify the
    // speaker at all (e.g. an unlabeled segment), not that the claim is
    // disqualified, and excluding it too would risk losing legitimate client
    // content — the exact failure mode this plan exists to fix.
    const claims = validatedRequirementClaims.filter((c) => c.speakerRole !== "ba");
    // Recorded unconditionally (both the early-return and full-synthesis paths)
    // so a session with validated claims but zero requirement-kind ones is
    // distinguishable in the persisted pipeline state from a session where
    // nothing was validated at all — otherwise this and every downstream
    // stage go silent with no diagnostic anywhere.
    if (claims.length === 0) return { ...state, requirementClaims: 0 };

    const result = await callTyped({
      client: ctx.client,
      db: ctx.db,
      sessionId: ctx.sessionId,
      stage: "requirements",
      system: REQUIREMENTS_SYSTEM,
      user: buildRequirementsUser(claims, project),
      schema: RequirementDraftsSchema,
      effort: "high",
    });

    const known = new Set(claims.map((c) => c.id));
    const now = new Date().toISOString();
    const toInsert: Requirement[] = [];
    const coveredClaimIds = new Set<string>();

    for (const draft of result.requirements) {
      const cited = draft.originClaimIds.filter((id) => known.has(id));
      if (cited.length === 0) continue; // unsourced — drop it
      const req: Requirement = {
        id: newId("req"),
        projectId: ctx.projectId,
        key: nextKey(ctx.db, ctx.projectId, "requirements", "REQ"),
        statement: draft.statement,
        status: "proposed",
        origin: "client-stated",
        originClaimIds: cited,
        supersedesId: null,
        createdAt: now,
      };
      insertRequirements(ctx.db, [req]); // one at a time so nextKey stays unique
      toInsert.push(req);
      for (const id of cited) coveredClaimIds.add(id);
    }

    // Deterministic fallback: a claim the model's synthesis failed to cite
    // (empty draft list, or drafts citing ids that don't exist) still becomes
    // a minimal requirement of its own — client-stated content must never be
    // silently dropped because a synthesis call underperformed.
    for (const claim of claims) {
      if (coveredClaimIds.has(claim.id)) continue;
      const req: Requirement = {
        id: newId("req"),
        projectId: ctx.projectId,
        key: nextKey(ctx.db, ctx.projectId, "requirements", "REQ"),
        statement: claim.statement,
        status: "proposed",
        origin: "client-stated",
        originClaimIds: [claim.id],
        supersedesId: null,
        createdAt: now,
      };
      insertRequirements(ctx.db, [req]);
      toInsert.push(req);
    }

    return { ...state, requirements: state.requirements + toInsert.length, requirementClaims: claims.length };
  },
};
