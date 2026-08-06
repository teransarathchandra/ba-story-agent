import { validateQuote, type GroundingSource } from "../grounding/validator.js";
import { listClaims, updateClaimValidation, countByStatus } from "../store/claims.js";
import { getFrozenTranscript } from "../store/transcripts.js";
import { hydrateWindow, type PipelineState } from "./state.js";
import type { Stage } from "./runner.js";

/**
 * Apply the grounding validator to every candidate claim.
 *
 * This stage makes no LLM call and no network request. It is the mechanical
 * gate that turns "never invent client details" from a prompt instruction
 * into a property of the system.
 */
export const stage2Validate: Stage<PipelineState, PipelineState> = {
  name: "validate",
  async run(ctx, state) {
    const frozen = getFrozenTranscript(ctx.db, ctx.sessionId);
    if (!frozen) throw new Error("session has no frozen transcript");

    const windows = state.windows.map((ref) =>
      hydrateWindow(ctx.db, frozen.transcript.text, ref),
    );
    const windowBySegment = new Map<string, GroundingSource>();
    for (const w of windows) {
      const src: GroundingSource = {
        segments: w.segments.map((s) => ({ id: s.id, text: s.text, charStart: s.charStart })),
        windowText: w.text,
        windowCharStart: w.charStart,
      };
      for (const s of w.segments) {
        if (!windowBySegment.has(s.id)) windowBySegment.set(s.id, src);
      }
    }

    const wholeTranscript: GroundingSource = {
      segments: frozen.segments.map((s) => ({ id: s.id, text: s.text, charStart: s.charStart })),
      windowText: frozen.transcript.text,
      windowCharStart: 0,
    };

    for (const claim of listClaims(ctx.db, ctx.sessionId, { status: "candidate" })) {
      const source = windowBySegment.get(claim.segmentId) ?? wholeTranscript;
      const result = validateQuote({ quote: claim.quote, segmentId: claim.segmentId }, source);

      if (result.status === "validated") {
        updateClaimValidation(ctx.db, claim.id, {
          status: "validated",
          charStart: result.charStart,
          charEnd: result.charEnd,
          matchMode: result.matchMode,
          segmentId: result.segmentId,
        });
      } else {
        updateClaimValidation(ctx.db, claim.id, {
          status: "quarantined",
          charStart: null,
          charEnd: null,
          matchMode: null,
          segmentId: claim.segmentId,
        });
      }
    }

    // Derive counts from the store to guarantee idempotence. A second run that
    // finds no candidates will return the same totals, preserving the canary metric.
    const counts = countByStatus(ctx.db, ctx.sessionId);
    return {
      ...state,
      validated: counts["validated"] ?? 0,
      quarantined: counts["quarantined"] ?? 0,
    };
  },
};

/**
 * The share of extracted claims that failed grounding. A sudden jump means a
 * prompt regression or a model version change — this is the canary.
 */
export function quarantineRate(state: PipelineState): number {
  const total = state.validated + state.quarantined;
  return total === 0 ? 0 : state.quarantined / total;
}
