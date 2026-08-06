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

    const claims = listClaims(ctx.db, ctx.sessionId, { status: "validated", kind: "requirement" });
    if (claims.length === 0) return state;

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
    }

    return { ...state, requirements: state.requirements + toInsert.length };
  },
};
