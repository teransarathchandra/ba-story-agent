import { z } from "zod/v4";
import { chunkTranscript, countWords, MIN_WORDS } from "./stage0-chunk.js";
import { emptyState, hydrateWindow, toRef, type PipelineState } from "./state.js";
import { getFrozenTranscript } from "../store/transcripts.js";
import { getProject } from "../store/projects.js";
import { insertClaims } from "../store/claims.js";
import { newId } from "../types/ids.js";
import { callTyped } from "../llm/parse.js";
import { EXTRACT_SYSTEM, buildExtractUser } from "../prompts/extract.js";
import type { Stage, StageContext } from "./runner.js";
import type { Claim } from "../types/domain.js";

export const ExtractedClaimsSchema = z.object({
  claims: z.array(
    z.object({
      quote: z.string(),
      statement: z.string(),
      segmentId: z.string(),
      speakerRole: z.enum(["client", "ba", "other", "unknown"]),
    }),
  ),
});

/**
 * A speaker label's true role is a session-wide property, not a per-claim
 * guess. Vote across every claim tagged with the same segment speaker label
 * and force them all to the majority role — the same "deterministic floor
 * under model judgment" pattern the hedge lexicon (src/hedge/lexicon.ts)
 * already applies to `kind`. Ties keep the first-listed role (client),
 * matching the model's own historical default so an even split doesn't
 * flip a claim's role on no real signal.
 */
export function applySpeakerRoleFloor(
  claims: Claim[],
  segmentLabels: Map<string, string | null>,
  firstSpeakerLabel?: string | null,
  sessionOverrides?: Map<string, Claim["speakerRole"]>,
): void {
  const tally = new Map<string, Record<Claim["speakerRole"], number>>();
  for (const c of claims) {
    const label = segmentLabels.get(c.segmentId);
    if (!label) continue;
    const counts = tally.get(label) ?? { client: 0, ba: 0, other: 0, unknown: 0 };
    counts[c.speakerRole]++;
    tally.set(label, counts);
  }

  const majorityByLabel = new Map<string, Claim["speakerRole"]>();
  for (const [label, counts] of tally) {
    const ranked = (Object.entries(counts) as [Claim["speakerRole"], number][])
      .sort((a, b) => b[1] - a[1]);
    majorityByLabel.set(label, ranked[0]![0]);
  }

  // The speaker who opens a discovery-call transcript is, in practice,
  // overwhelmingly the analyst running the meeting — a stronger, more
  // reliable signal than the model's own per-claim guesses, which have been
  // observed to be systematically (not just occasionally) wrong about a
  // given speaker across every one of their claims in a real session. A
  // majority vote can only correct a minority outlier; it cannot correct a
  // unanimous wrong vote, so this overrides that one label's result rather
  // than adding it as another vote (a small number of synthetic votes could
  // never outweigh a lopsided real majority).
  //
  // As of the speaker-role-confirmation-modal plan, `firstSpeakerLabel` is
  // never invoked with a real value by the pipeline anymore — the heuristic
  // proved unreliable in real usage (client-side participants often speak
  // first, not the analyst). The parameter stays because it is still
  // directly, correctly unit-tested above; removing it would be a bigger
  // diff than simply not calling it. `sessionOverrides` (explicit,
  // user-confirmed roles) is the real mechanism now, and is applied last so
  // it always wins over both the heuristic and the plain majority vote.
  if (firstSpeakerLabel) majorityByLabel.set(firstSpeakerLabel, "ba");
  if (sessionOverrides) {
    for (const [label, role] of sessionOverrides) majorityByLabel.set(label, role);
  }

  for (const c of claims) {
    const label = segmentLabels.get(c.segmentId);
    if (!label) continue;
    const majority = majorityByLabel.get(label);
    if (majority) c.speakerRole = majority;
  }
}

export const stage0Chunk: Stage<{ transcriptId: string }, PipelineState> = {
  name: "chunk",
  async run(ctx, input) {
    const frozen = getFrozenTranscript(ctx.db, ctx.sessionId);
    if (!frozen) throw new Error("session has no frozen transcript");
    const words = countWords(frozen.transcript.text);
    if (words < MIN_WORDS) {
      throw new Error(
        `input is ${words} words; the pipeline requires at least ${MIN_WORDS} words. ` +
          `Below this, extraction produces noise rather than requirements.`,
      );
    }
    const windows = chunkTranscript(frozen.transcript.text, frozen.segments);
    return { ...emptyState(input.transcriptId), windows: windows.map(toRef) };
  },
};

export const stage1Extract: Stage<PipelineState, PipelineState> = {
  name: "extract",
  async run(ctx: StageContext, state) {
    const frozen = getFrozenTranscript(ctx.db, ctx.sessionId);
    if (!frozen) throw new Error("session has no frozen transcript");
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");

    const all: Claim[] = [];
    const now = new Date().toISOString();
    let extractFailures = 0;

    for (const ref of state.windows) {
      const window = hydrateWindow(ctx.db, frozen.transcript.text, ref);
      const buildArgs = () => ({
        client: ctx.client,
        db: ctx.db,
        sessionId: ctx.sessionId,
        stage: "extract",
        system: EXTRACT_SYSTEM,
        user: buildExtractUser(window, project),
        schema: ExtractedClaimsSchema,
        effort: "high" as const,
      });

      let result = await callTyped(buildArgs());

      // A window with zero claims is ambiguous on its own — EXTRACT_SYSTEM
      // explicitly allows an empty result for a genuinely logistics-only
      // window — but it is also exactly the shape of the local model's
      // degenerate-empty collapse (isDegenerateEmpty in
      // src/llm/local-client.ts): confirmed by direct repro (see
      // scripts/repro-window1-extract.ts / investigate-skill session
      // 2026-08-09) that a real window can return {"claims":[]} on every one
      // of LocalBackend.generate()'s internal retry attempts, exhausting
      // that ladder without success, and that an independent fresh call
      // against the identical window can then succeed — the failure is
      // stochastic per-call, not a property of the window's content. One
      // retry with a completely fresh call (its own new internal retry
      // ladder) gives a window that came back empty a real second chance
      // before its content is silently dropped with no visible signal —
      // the same fix shape as stage3-classify.ts's zero-coverage retry
      // (e837ded).
      if (result.claims.length === 0) {
        result = await callTyped(buildArgs());
      }
      if (result.claims.length === 0) extractFailures++;

      const validSegmentIds = new Set(window.segments.map((s) => s.id));
      const fallbackSegmentId = window.segments[0]?.id;

      for (const c of result.claims) {
        if (c.quote.trim().length === 0) continue;
        // A hallucinated segment id is not fatal — Stage 2 corrects or
        // quarantines. Anchor to a real segment in this window so Stage 2 has
        // somewhere sensible to start.
        const segmentId = validSegmentIds.has(c.segmentId)
          ? c.segmentId
          : fallbackSegmentId;
        if (!segmentId) continue;
        all.push({
          id: newId("clm"),
          sessionId: ctx.sessionId,
          transcriptId: frozen.transcript.id,
          segmentId,
          quote: c.quote,
          statement: c.statement,
          speakerRole: c.speakerRole,
          kind: "requirement",   // placeholder; Stage 3 sets the real kind
          status: "candidate",   // placeholder; Stage 2 sets the real status
          charStart: null,
          charEnd: null,
          matchMode: null,
          createdAt: now,
        });
      }
    }

    insertClaims(ctx.db, all);
    return {
      ...state,
      extracted: all.length,
      // ?? 0 guards resuming a checkpoint saved before extractFailures
      // existed on PipelineState — its payload_json won't have the field,
      // and JSON round-tripping leaves it undefined rather than 0.
      extractFailures: (state.extractFailures ?? 0) + extractFailures,
    };
  },
};
