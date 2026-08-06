import { z } from "zod/v4";
import { listClaims, setClaimKind } from "../store/claims.js";
import { getProject } from "../store/projects.js";
import { isHedged } from "../hedge/lexicon.js";
import { callTyped } from "../llm/parse.js";
import { CLASSIFY_SYSTEM, buildClassifyUser } from "../prompts/classify.js";
import type { PipelineState } from "./state.js";
import type { Stage } from "./runner.js";

export const ClassificationSchema = z.object({
  classifications: z.array(
    z.object({
      claimId: z.string(),
      kind: z.enum(["requirement", "assumption", "ambiguity"]),
    }),
  ),
});

const BATCH = 40;

/**
 * Classify each validated claim, then apply a deterministic floor.
 *
 * The hedge guard is not advisory: a quote containing a hedge marker is
 * forced to "assumption" regardless of the model's answer. Model judgment
 * plus a mechanical floor — because the failure mode here (promoting hedged
 * speech to a client commitment) is the one that does real damage.
 */
export const stage3Classify: Stage<PipelineState, PipelineState> = {
  name: "classify",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");

    const claims = listClaims(ctx.db, ctx.sessionId, { status: "validated" });
    if (claims.length === 0) return state;

    for (let i = 0; i < claims.length; i += BATCH) {
      const batch = claims.slice(i, i + BATCH);
      const result = await callTyped({
        client: ctx.client,
        db: ctx.db,
        sessionId: ctx.sessionId,
        stage: "classify",
        system: CLASSIFY_SYSTEM,
        user: buildClassifyUser(batch, project),
        schema: ClassificationSchema,
        effort: "high",
      });

      const byId = new Map(result.classifications.map((c) => [c.claimId, c.kind]));
      for (const claim of batch) {
        const modelKind = byId.get(claim.id) ?? "ambiguity";
        // Deterministic floor: hedged speech is never a requirement.
        const kind = isHedged(claim.quote) ? "assumption" : modelKind;
        setClaimKind(ctx.db, claim.id, kind);
      }
    }

    return state;
  },
};
