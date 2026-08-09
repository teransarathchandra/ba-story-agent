import type { Db } from "./db.js";
import { newId } from "../types/ids.js";
import { SpeakerRole, type Claim } from "../types/domain.js";

/**
 * Upserts one or more session-scoped speaker-label -> role confirmations.
 * A later call for the same (sessionId, label) overwrites the earlier value —
 * this is a correction mechanism, not an append-only log.
 */
export function setSpeakerRoleOverrides(
  db: Db,
  sessionId: string,
  overrides: Map<string, Claim["speakerRole"]>,
): void {
  const stmt = db.prepare(
    `INSERT INTO speaker_role_overrides (id, session_id, speaker_label, role, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (session_id, speaker_label) DO UPDATE SET role = excluded.role`,
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const [label, role] of overrides) {
      SpeakerRole.parse(role);
      stmt.run(newId("sro"), sessionId, label, role, now);
    }
  })();
}

export function getSpeakerRoleOverrides(db: Db, sessionId: string): Map<string, Claim["speakerRole"]> {
  const rows = db
    .prepare("SELECT speaker_label, role FROM speaker_role_overrides WHERE session_id = ?")
    .all(sessionId) as { speaker_label: string; role: string }[];
  return new Map(rows.map((r) => [r.speaker_label, r.role as Claim["speakerRole"]]));
}

export interface DetectedSpeaker {
  label: string;
  confirmedRole: Claim["speakerRole"] | null;
}

/**
 * Every distinct labeled speaker in the session's LATEST frozen transcript,
 * in first-appearance order, with whatever role (if any) has already been
 * confirmed for them. A transcript with no labeled segments, or a session
 * with no frozen transcript at all, returns an empty array — there is
 * nothing to confirm, and callers (the pre-analysis gate in particular)
 * must treat an empty array as "gate satisfied", not "gate blocked".
 */
export function listDetectedSpeakers(db: Db, sessionId: string): DetectedSpeaker[] {
  const transcriptRow = db
    .prepare(
      `SELECT id FROM transcripts
       WHERE session_id = ? AND frozen_at IS NOT NULL
       ORDER BY version DESC LIMIT 1`,
    )
    .get(sessionId) as { id: string } | undefined;
  if (!transcriptRow) return [];

  // GROUP BY + MIN(idx), not SELECT DISTINCT ... ORDER BY idx: DISTINCT's
  // interaction with an ORDER BY column outside the select list is not
  // reliably first-occurrence-ordered across SQL engines. This is.
  const labelRows = db
    .prepare(
      `SELECT speaker_label, MIN(idx) AS first_idx FROM segments
       WHERE transcript_id = ? AND speaker_label IS NOT NULL
       GROUP BY speaker_label
       ORDER BY first_idx ASC`,
    )
    .all(transcriptRow.id) as { speaker_label: string; first_idx: number }[];

  const overrides = getSpeakerRoleOverrides(db, sessionId);
  return labelRows.map((row) => ({
    label: row.speaker_label,
    confirmedRole: overrides.get(row.speaker_label) ?? null,
  }));
}
