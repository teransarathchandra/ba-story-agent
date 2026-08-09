import { z } from "zod/v4";
import { listClaims, setClaimKind, setClaimSpeakerRole } from "../store/claims.js";
import { getProject } from "../store/projects.js";
import { isHedged } from "../hedge/lexicon.js";
import { callTyped } from "../llm/parse.js";
import { CLASSIFY_SYSTEM, buildClassifyUser } from "../prompts/classify.js";
import { applySpeakerRoleFloor } from "./stage1-extract.js";
import { getFrozenTranscript } from "../store/transcripts.js";
import { getSpeakerRoleOverrides } from "../store/speaker-overrides.js";
import type { PipelineState } from "./state.js";
import type { Stage } from "./runner.js";

export const ClassificationSchema = z.object({
  classifications: z.array(
    z.object({
      // No .positive() — the GBNF grammar generator cannot express numeric
      // bounds, so a 0-based-index model mistake would pass the grammar,
      // fail this constraint, and abort the whole classify stage via
      // StageFailure. A non-positive or out-of-range index is instead left
      // to fall through the existing `byIndex.get(i + 1) ?? "ambiguity"`
      // default below, same graceful handling an out-of-range index already
      // gets.
      index: z.number().int(),
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

    // Speaker roles are only correct once grounding has finished — stage2Validate
    // and stage2bRequote can both move a claim's segmentId after extraction ran
    // its own (necessarily provisional) role floor, and neither of those stages
    // re-derives speakerRole. This is the first point after all grounding is
    // final, and the last point before role is read for anything (classification
    // itself, and stage5-requirements' ba-exclusion downstream) — so it is the
    // one authoritative place this floor can run.
    const frozen = getFrozenTranscript(ctx.db, ctx.sessionId);
    if (frozen) {
      const segmentLabels = new Map(frozen.segments.map((s) => [s.id, s.speakerLabel]));
      // The automatic first-speaker-is-analyst heuristic is intentionally not
      // invoked here anymore (see applySpeakerRoleFloor's comment) — the
      // session-confirmed override, read fresh from the DB on every call, is
      // the real correction mechanism now.
      const sessionOverrides = getSpeakerRoleOverrides(ctx.db, ctx.sessionId);
      applySpeakerRoleFloor(claims, segmentLabels, undefined, sessionOverrides);
      for (const claim of claims) setClaimSpeakerRole(ctx.db, claim.id, claim.speakerRole);
    }

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

      const byIndex = new Map(result.classifications.map((c) => [c.index, c.kind]));
      batch.forEach((claim, i) => {
        const modelKind = byIndex.get(i + 1) ?? "ambiguity";
        // Deterministic floor: hedged speech is never a requirement.
        const kind = isHedged(claim.quote) ? "assumption" : modelKind;
        setClaimKind(ctx.db, claim.id, kind);
      });
    }

    return state;
  },
};
