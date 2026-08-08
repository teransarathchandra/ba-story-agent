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
    const segmentLabels = new Map<string, string | null>();
    const now = new Date().toISOString();

    for (const ref of state.windows) {
      const window = hydrateWindow(ctx.db, frozen.transcript.text, ref);
      for (const seg of window.segments) segmentLabels.set(seg.id, seg.speakerLabel);
      const result = await callTyped({
        client: ctx.client,
        db: ctx.db,
        sessionId: ctx.sessionId,
        stage: "extract",
        system: EXTRACT_SYSTEM,
        user: buildExtractUser(window, project),
        schema: ExtractedClaimsSchema,
        effort: "high",
      });

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

    applySpeakerRoleFloor(all, segmentLabels);
    insertClaims(ctx.db, all);
    return { ...state, extracted: all.length };
  },
};
