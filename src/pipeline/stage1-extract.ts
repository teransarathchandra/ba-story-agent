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

    for (const ref of state.windows) {
      const window = hydrateWindow(ctx.db, frozen.transcript.text, ref);
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

    insertClaims(ctx.db, all);
    return { ...state, extracted: all.length };
  },
};
