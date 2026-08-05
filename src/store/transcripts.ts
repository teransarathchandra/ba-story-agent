import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import { newId } from "../types/ids.js";
import {
  TranscriptSchema, SegmentSchema,
  type Transcript, type Segment,
} from "../types/domain.js";

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

interface TranscriptRow {
  id: string; session_id: string; version: number; text: string;
  content_hash: string; frozen_at: string | null; created_at: string;
}

interface SegmentRow {
  id: string; transcript_id: string; idx: number;
  start_ms: number | null; end_ms: number | null;
  speaker_label: string | null; text: string;
  char_start: number; char_end: number;
}

function toTranscript(row: TranscriptRow): Transcript {
  return TranscriptSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    version: row.version,
    text: row.text,
    contentHash: row.content_hash,
    frozenAt: row.frozen_at,
    createdAt: row.created_at,
  });
}

function toSegment(row: SegmentRow): Segment {
  return SegmentSchema.parse({
    id: row.id,
    transcriptId: row.transcript_id,
    idx: row.idx,
    startMs: row.start_ms,
    endMs: row.end_ms,
    speakerLabel: row.speaker_label,
    text: row.text,
    charStart: row.char_start,
    charEnd: row.char_end,
  });
}

/**
 * Split raw text into segments on blank lines, preserving exact character
 * offsets into the original text. Offsets are the anchor the grounding
 * validator relies on, so they must index the untouched source string.
 */
function splitSegments(transcriptId: string, text: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /\n\s*\n/g;
  let cursor = 0;
  let idx = 0;
  const push = (start: number, end: number): void => {
    const raw = text.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const s = start + leading;
    const e = end - trailing;
    if (e <= s) return;
    segments.push(
      SegmentSchema.parse({
        id: newId("seg"),
        transcriptId,
        idx: idx++,
        startMs: null,
        endMs: null,
        speakerLabel: null,
        text: text.slice(s, e),
        charStart: s,
        charEnd: e,
      }),
    );
  };
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    push(cursor, m.index);
    cursor = m.index + m[0].length;
  }
  push(cursor, text.length);
  return segments;
}

export function createTranscript(
  db: Db,
  input: { sessionId: string; text: string },
): { transcript: Transcript; segments: Segment[] } {
  const prior = db
    .prepare("SELECT MAX(version) AS v FROM transcripts WHERE session_id = ?")
    .get(input.sessionId) as { v: number | null };
  const version = (prior.v ?? 0) + 1;

  const transcript = TranscriptSchema.parse({
    id: newId("trs"),
    sessionId: input.sessionId,
    version,
    text: input.text,
    contentHash: hashText(input.text),
    frozenAt: null,
    createdAt: new Date().toISOString(),
  });

  const segments = splitSegments(transcript.id, input.text);

  const insertTranscript = db.prepare(
    `INSERT INTO transcripts (id, session_id, version, text, content_hash, frozen_at, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  );
  const insertSegment = db.prepare(
    `INSERT INTO segments (id, transcript_id, idx, start_ms, end_ms, speaker_label, text, char_start, char_end)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );

  db.transaction(() => {
    insertTranscript.run(
      transcript.id, transcript.sessionId, transcript.version, transcript.text,
      transcript.contentHash, transcript.frozenAt, transcript.createdAt,
    );
    for (const seg of segments) {
      insertSegment.run(
        seg.id, seg.transcriptId, seg.idx, seg.startMs, seg.endMs,
        seg.speakerLabel, seg.text, seg.charStart, seg.charEnd,
      );
    }
  })();

  return { transcript, segments };
}

export function freezeTranscript(db: Db, transcriptId: string): Transcript {
  const at = new Date().toISOString();
  db.prepare("UPDATE transcripts SET frozen_at = ? WHERE id = ?").run(at, transcriptId);
  const row = db.prepare("SELECT * FROM transcripts WHERE id = ?").get(transcriptId) as TranscriptRow;
  return toTranscript(row);
}

export function getFrozenTranscript(
  db: Db,
  sessionId: string,
): { transcript: Transcript; segments: Segment[] } | null {
  const row = db
    .prepare(
      `SELECT * FROM transcripts
       WHERE session_id = ? AND frozen_at IS NOT NULL
       ORDER BY version DESC LIMIT 1`,
    )
    .get(sessionId) as TranscriptRow | undefined;
  if (!row) return null;
  const segRows = db
    .prepare("SELECT * FROM segments WHERE transcript_id = ? ORDER BY idx ASC")
    .all(row.id) as SegmentRow[];
  return { transcript: toTranscript(row), segments: segRows.map(toSegment) };
}
