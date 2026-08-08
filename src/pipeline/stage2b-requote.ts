import { z } from "zod/v4";
import { validateQuote, type GroundingSource } from "../grounding/validator.js";
import { listClaims, countByStatus, requoteClaim } from "../store/claims.js";
import { getFrozenTranscript } from "../store/transcripts.js";
import { getProject } from "../store/projects.js";
import { hydrateWindow, type PipelineState } from "./state.js";
import { callTyped } from "../llm/parse.js";
import { REQUOTE_SYSTEM, buildRequoteUser } from "../prompts/requote.js";
import type { Stage } from "./runner.js";
import type { Window } from "./stage0-chunk.js";
import type { Claim } from "../types/domain.js";

export const RequoteSchema = z.object({
  requotes: z.array(z.object({ id: z.string(), quote: z.string() })),
});

/**
 * One repair pass over claims stage2Validate quarantined.
 *
 * A quarantined claim's `statement` field is already a good paraphrase of
 * real transcript content (extraction already ran the full-window task);
 * asking the model to re-quote just that one statement against the window
 * it came from is a far narrower task than one-shot extract-and-quote, and
 * a small local model is much more reliable at it. Exactly one retry per
 * claim — a claim that still doesn't validate after this stays quarantined,
 * same as before this stage existed.
 */
export const stage2bRequote: Stage<PipelineState, PipelineState> = {
  name: "requote",
  async run(ctx, state) {
    const frozen = getFrozenTranscript(ctx.db, ctx.sessionId);
    if (!frozen) throw new Error("session has no frozen transcript");
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");

    const quarantined = listClaims(ctx.db, ctx.sessionId, { status: "quarantined" });
    if (quarantined.length === 0) return state;

    const windows = state.windows.map((ref) => hydrateWindow(ctx.db, frozen.transcript.text, ref));
    const windowByIdx = new Map<number, Window>();
    for (const w of windows) windowByIdx.set(w.idx, w);
    const windowIdxBySegment = new Map<string, number>();
    for (const w of windows) {
      for (const s of w.segments) {
        if (!windowIdxBySegment.has(s.id)) windowIdxBySegment.set(s.id, w.idx);
      }
    }

    const wholeTranscript: GroundingSource = {
      segments: frozen.segments.map((s) => ({ id: s.id, text: s.text, charStart: s.charStart })),
      windowText: frozen.transcript.text,
      windowCharStart: 0,
    };

    const groups = new Map<number | "orphan", Claim[]>();
    for (const claim of quarantined) {
      const key = windowIdxBySegment.get(claim.segmentId) ?? "orphan";
      const list = groups.get(key) ?? [];
      list.push(claim);
      groups.set(key, list);
    }

    for (const [key, claimsInGroup] of groups) {
      const window = key === "orphan" ? null : windowByIdx.get(key)!;
      const source: GroundingSource = window
        ? {
            segments: window.segments.map((s) => ({ id: s.id, text: s.text, charStart: s.charStart })),
            windowText: window.text,
            windowCharStart: window.charStart,
          }
        : wholeTranscript;

      const result = await callTyped({
        client: ctx.client,
        db: ctx.db,
        sessionId: ctx.sessionId,
        stage: "requote",
        system: REQUOTE_SYSTEM,
        user: buildRequoteUser(
          claimsInGroup.map((c) => ({ id: c.id, statement: c.statement })),
          source.windowText,
          project,
        ),
        schema: RequoteSchema,
        effort: "high",
      });

      const byId = new Map(result.requotes.map((r) => [r.id, r.quote]));
      for (const claim of claimsInGroup) {
        const candidate = byId.get(claim.id);
        if (!candidate || candidate.trim().length === 0) continue;
        const grounded = validateQuote({ quote: candidate, segmentId: claim.segmentId }, source);
        if (grounded.status === "validated") {
          requoteClaim(ctx.db, claim.id, {
            quote: candidate,
            status: "validated",
            charStart: grounded.charStart,
            charEnd: grounded.charEnd,
            matchMode: grounded.matchMode,
            segmentId: grounded.segmentId,
          });
        }
      }
    }

    const counts = countByStatus(ctx.db, ctx.sessionId);
    return { ...state, validated: counts["validated"] ?? 0, quarantined: counts["quarantined"] ?? 0 };
  },
};
