import { z } from "zod/v4";
import { listClaims } from "../store/claims.js";
import { listRequirements, nextKey } from "../store/artifacts.js";
import { insertQuestions } from "../store/findings.js";
import { insertLinks } from "../store/links.js";
import { getProject } from "../store/projects.js";
import { newId } from "../types/ids.js";
import { callTyped } from "../llm/parse.js";
import { RECONCILE_SYSTEM, buildReconcileUser } from "../prompts/reconcile.js";
import type { PipelineState } from "./state.js";
import type { Stage } from "./runner.js";
import type { OpenQuestion } from "../types/domain.js";

export const ReconcileSchema = z.object({
  contradictions: z.array(
    z.object({
      claimIdA: z.string(),
      claimIdB: z.string(),
      question: z.string(),
    }),
  ),
  links: z.array(
    z.object({
      claimId: z.string(),
      requirementId: z.string(),
      linkKind: z.enum(["confirms", "refines", "supersedes", "contradicts"]),
      rationale: z.string(),
    }),
  ),
});

export const stage4Reconcile: Stage<PipelineState, PipelineState> = {
  name: "reconcile",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");

    const claims = listClaims(ctx.db, ctx.sessionId, { status: "validated", kind: "requirement" });
    if (claims.length === 0) return state;

    const existing = listRequirements(ctx.db, ctx.projectId);

    const result = await callTyped({
      client: ctx.client,
      db: ctx.db,
      sessionId: ctx.sessionId,
      stage: "reconcile",
      system: RECONCILE_SYSTEM,
      user: buildReconcileUser(claims, existing, project),
      schema: ReconcileSchema,
      effort: "high",
    });

    const known = new Set(claims.map((c) => c.id));
    const now = new Date().toISOString();
    const questions: OpenQuestion[] = [];

    // Contradictions: both sides retained, question auto-raised, never resolved.
    const contradictionLinks = result.contradictions
      .filter((c) => known.has(c.claimIdA) && known.has(c.claimIdB))
      .map((c) => {
        questions.push({
          id: newId("oqn"),
          projectId: ctx.projectId,
          key: nextKey(ctx.db, ctx.projectId, "open_questions", "OQ"),
          text: c.question,
          category: "domain",
          raisedBySessionId: ctx.sessionId,
          status: "open",
          answerText: null,
          answeredBySessionId: null,
          createdAt: now,
        });
        // nextKey reads the table, so questions must be inserted between
        // allocations. Insert one at a time to keep keys unique.
        insertQuestions(ctx.db, [questions[questions.length - 1]!]);
        return {
          projectId: ctx.projectId,
          fromClaimId: c.claimIdA,
          toRequirementId: null,
          toClaimId: c.claimIdB,
          linkKind: "contradicts" as const,
          rationale: c.question,
          accepted: false,
        };
      });

    const existingIds = new Set(existing.map((r) => r.id));
    const crossLinks = result.links
      .filter((l) => known.has(l.claimId) && existingIds.has(l.requirementId))
      .map((l) => ({
        projectId: ctx.projectId,
        fromClaimId: l.claimId,
        toRequirementId: l.requirementId,
        toClaimId: null,
        linkKind: l.linkKind,
        rationale: l.rationale,
        accepted: false, // proposed, never auto-applied
      }));

    insertLinks(ctx.db, [...contradictionLinks, ...crossLinks]);

    return { ...state, questions: state.questions + questions.length };
  },
};
