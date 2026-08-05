import type { Db } from "./db.js";
import { newId } from "../types/ids.js";
import {
  ApprovalEventSchema, EgressLogSchema,
  type ApprovalEvent, type EgressLog,
} from "../types/domain.js";

export type CheckpointStatus = "pending" | "running" | "complete" | "failed";

export function recordApproval(
  db: Db,
  e: Omit<ApprovalEvent, "id" | "at">,
): ApprovalEvent {
  const event = ApprovalEventSchema.parse({
    ...e,
    id: newId("apv"),
    at: new Date().toISOString(),
  });
  db.prepare(
    `INSERT INTO approval_events (id, entity_type, entity_id, action, actor_note, content_hash, at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    event.id, event.entityType, event.entityId, event.action,
    event.actorNote, event.contentHash, event.at,
  );
  return event;
}

export function listApprovals(
  db: Db,
  entityType: ApprovalEvent["entityType"],
  entityId: string,
): ApprovalEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM approval_events
       WHERE entity_type = ? AND entity_id = ? ORDER BY at ASC`,
    )
    .all(entityType, entityId) as {
      id: string; entity_type: string; entity_id: string; action: string;
      actor_note: string | null; content_hash: string; at: string;
    }[];
  return rows.map((r) =>
    ApprovalEventSchema.parse({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      actorNote: r.actor_note,
      contentHash: r.content_hash,
      at: r.at,
    }),
  );
}

export function recordEgress(db: Db, e: Omit<EgressLog, "id" | "at">): void {
  const entry = EgressLogSchema.parse({
    ...e,
    id: newId("egr"),
    at: new Date().toISOString(),
  });
  db.prepare(
    `INSERT INTO egress_log (id, session_id, stage, request_hash, prompt_tokens, completion_tokens, model, at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    entry.id, entry.sessionId, entry.stage, entry.requestHash,
    entry.promptTokens, entry.completionTokens, entry.model, entry.at,
  );
}

export function egressSummary(
  db: Db,
  sessionId: string,
): { requests: number; promptTokens: number; completionTokens: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens), 0) AS p,
              COALESCE(SUM(completion_tokens), 0) AS c
       FROM egress_log WHERE session_id = ?`,
    )
    .get(sessionId) as { requests: number; p: number; c: number };
  return { requests: row.requests, promptTokens: row.p, completionTokens: row.c };
}

export function saveCheckpoint(
  db: Db,
  sessionId: string,
  stage: string,
  status: CheckpointStatus,
  payload: unknown,
  errorText: string | null = null,
  rawResponse: string | null = null,
): void {
  db.prepare(
    `INSERT INTO stage_checkpoints (id, session_id, stage, status, payload_json, error_text, raw_response, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (session_id, stage) DO UPDATE SET
       status = excluded.status,
       payload_json = excluded.payload_json,
       error_text = excluded.error_text,
       raw_response = excluded.raw_response,
       updated_at = excluded.updated_at`,
  ).run(
    newId("ckp"), sessionId, stage, status,
    payload === null || payload === undefined ? null : JSON.stringify(payload),
    errorText, rawResponse, new Date().toISOString(),
  );
}

export function loadCheckpoint<T>(
  db: Db,
  sessionId: string,
  stage: string,
): { status: CheckpointStatus; payload: T | null; errorText: string | null } | null {
  const row = db
    .prepare("SELECT status, payload_json, error_text FROM stage_checkpoints WHERE session_id = ? AND stage = ?")
    .get(sessionId, stage) as
      { status: CheckpointStatus; payload_json: string | null; error_text: string | null } | undefined;
  if (!row) return null;
  return {
    status: row.status,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as T) : null,
    errorText: row.error_text,
  };
}
