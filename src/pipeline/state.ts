import type { Db } from "../store/db.js";
import type { Segment } from "../types/domain.js";
import type { Window } from "./stage0-chunk.js";

export interface WindowRef {
  idx: number;
  segmentIds: string[];
  charStart: number;
  charEnd: number;
}

export interface PipelineState {
  transcriptId: string;
  windows: WindowRef[];
  extracted: number;
  validated: number;
  quarantined: number;
  requirements: number;
  stories: number;
  questions: number;
  recommendations: number;
}

export function emptyState(transcriptId: string): PipelineState {
  return {
    transcriptId, windows: [],
    extracted: 0, validated: 0, quarantined: 0,
    requirements: 0, stories: 0, questions: 0, recommendations: 0,
  };
}

export function toRef(w: Window): WindowRef {
  const last = w.segments[w.segments.length - 1]!;
  return {
    idx: w.idx,
    segmentIds: w.segments.map((s) => s.id),
    charStart: w.charStart,
    charEnd: last.charEnd,
  };
}

/** Rebuild a full Window from its reference, reading segments back from the store. */
export function hydrateWindow(db: Db, transcriptText: string, ref: WindowRef): Window {
  const placeholders = ref.segmentIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM segments WHERE id IN (${placeholders}) ORDER BY idx ASC`)
    .all(...ref.segmentIds) as {
      id: string; transcript_id: string; idx: number;
      start_ms: number | null; end_ms: number | null;
      speaker_label: string | null; text: string;
      char_start: number; char_end: number;
    }[];
  const segments: Segment[] = rows.map((r) => ({
    id: r.id, transcriptId: r.transcript_id, idx: r.idx,
    startMs: r.start_ms, endMs: r.end_ms, speakerLabel: r.speaker_label,
    text: r.text, charStart: r.char_start, charEnd: r.char_end,
  }));
  return {
    idx: ref.idx,
    segments,
    text: transcriptText.slice(ref.charStart, ref.charEnd),
    charStart: ref.charStart,
  };
}
