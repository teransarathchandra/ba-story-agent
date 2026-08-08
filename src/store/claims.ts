import type { Db } from "./db.js";
import { ClaimSchema, type Claim } from "../types/domain.js";

interface ClaimRow {
  id: string; session_id: string; transcript_id: string; segment_id: string;
  quote: string; statement: string; speaker_role: string;
  kind: string; status: string;
  char_start: number | null; char_end: number | null;
  match_mode: string | null; created_at: string;
}

function toClaim(row: ClaimRow): Claim {
  return ClaimSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    transcriptId: row.transcript_id,
    segmentId: row.segment_id,
    quote: row.quote,
    statement: row.statement,
    speakerRole: row.speaker_role,
    kind: row.kind,
    status: row.status,
    charStart: row.char_start,
    charEnd: row.char_end,
    matchMode: row.match_mode,
    createdAt: row.created_at,
  });
}

export function insertClaims(db: Db, claims: Claim[]): void {
  const stmt = db.prepare(
    `INSERT INTO claims
       (id, session_id, transcript_id, segment_id, quote, statement, speaker_role,
        kind, status, char_start, char_end, match_mode, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    for (const c of claims) {
      ClaimSchema.parse(c);
      stmt.run(
        c.id, c.sessionId, c.transcriptId, c.segmentId, c.quote, c.statement,
        c.speakerRole, c.kind, c.status, c.charStart, c.charEnd, c.matchMode, c.createdAt,
      );
    }
  })();
}

function applyFilters(
  base: string,
  opts?: { status?: Claim["status"]; kind?: Claim["kind"] },
): { sql: string; extra: string[] } {
  const extra: string[] = [];
  let sql = base;
  if (opts?.status) { sql += " AND c.status = ?"; extra.push(opts.status); }
  if (opts?.kind) { sql += " AND c.kind = ?"; extra.push(opts.kind); }
  sql += " ORDER BY c.created_at ASC, c.id ASC";
  return { sql, extra };
}

export function listClaims(
  db: Db,
  sessionId: string,
  opts?: { status?: Claim["status"]; kind?: Claim["kind"] },
): Claim[] {
  const { sql, extra } = applyFilters("SELECT c.* FROM claims c WHERE c.session_id = ?", opts);
  return (db.prepare(sql).all(sessionId, ...extra) as ClaimRow[]).map(toClaim);
}

export function listProjectClaims(
  db: Db,
  projectId: string,
  opts?: { status?: Claim["status"]; kind?: Claim["kind"] },
): Claim[] {
  const { sql, extra } = applyFilters(
    `SELECT c.* FROM claims c
     JOIN sessions s ON s.id = c.session_id
     WHERE s.project_id = ?`,
    opts,
  );
  return (db.prepare(sql).all(projectId, ...extra) as ClaimRow[]).map(toClaim);
}

export function updateClaimValidation(
  db: Db,
  id: string,
  patch: {
    status: Claim["status"];
    charStart: number | null;
    charEnd: number | null;
    matchMode: Claim["matchMode"];
    segmentId: string;
  },
): void {
  db.prepare(
    `UPDATE claims
     SET status = ?, char_start = ?, char_end = ?, match_mode = ?, segment_id = ?
     WHERE id = ?`,
  ).run(patch.status, patch.charStart, patch.charEnd, patch.matchMode, patch.segmentId, id);
}

export function countByStatus(db: Db, sessionId: string): Record<string, number> {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS n FROM claims WHERE session_id = ? GROUP BY status")
    .all(sessionId) as { status: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export function setClaimKind(db: Db, id: string, kind: Claim["kind"]): void {
  db.prepare("UPDATE claims SET kind = ? WHERE id = ?").run(kind, id);
}

export function requoteClaim(
  db: Db,
  id: string,
  patch: {
    quote: string;
    status: Claim["status"];
    charStart: number | null;
    charEnd: number | null;
    matchMode: Claim["matchMode"];
    segmentId: string;
  },
): void {
  db.prepare(
    `UPDATE claims
     SET quote = ?, status = ?, char_start = ?, char_end = ?, match_mode = ?, segment_id = ?
     WHERE id = ?`,
  ).run(patch.quote, patch.status, patch.charStart, patch.charEnd, patch.matchMode, patch.segmentId, id);
}

export function setClaimSpeakerRole(db: Db, id: string, speakerRole: Claim["speakerRole"]): void {
  db.prepare("UPDATE claims SET speaker_role = ? WHERE id = ?").run(speakerRole, id);
}
