import type { Db } from "./db.js";
import {
  OpenQuestionSchema, RecommendationSchema,
  type OpenQuestion, type Recommendation,
} from "../types/domain.js";

interface QuestionRow {
  id: string; project_id: string; key: string; text: string; category: string;
  raised_by_session_id: string; status: string;
  answer_text: string | null; answered_by_session_id: string | null; created_at: string;
}

interface RecommendationRow {
  id: string; project_id: string; key: string; text: string; rationale: string;
  category: string; raised_by_session_id: string; status: string;
  disposition_note: string | null; created_at: string;
}

export function insertQuestions(db: Db, qs: OpenQuestion[]): void {
  const stmt = db.prepare(
    `INSERT INTO open_questions
       (id, project_id, key, text, category, raised_by_session_id, status,
        answer_text, answered_by_session_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    for (const q of qs) {
      OpenQuestionSchema.parse(q);
      stmt.run(
        q.id, q.projectId, q.key, q.text, q.category, q.raisedBySessionId,
        q.status, q.answerText, q.answeredBySessionId, q.createdAt,
      );
    }
  })();
}

export function listQuestions(
  db: Db,
  projectId: string,
  opts?: { status?: OpenQuestion["status"] },
): OpenQuestion[] {
  let sql = "SELECT * FROM open_questions WHERE project_id = ?";
  const extra: string[] = [];
  if (opts?.status) { sql += " AND status = ?"; extra.push(opts.status); }
  sql += " ORDER BY key ASC";
  return (db.prepare(sql).all(projectId, ...extra) as QuestionRow[]).map((row) =>
    OpenQuestionSchema.parse({
      id: row.id,
      projectId: row.project_id,
      key: row.key,
      text: row.text,
      category: row.category,
      raisedBySessionId: row.raised_by_session_id,
      status: row.status,
      answerText: row.answer_text,
      answeredBySessionId: row.answered_by_session_id,
      createdAt: row.created_at,
    }),
  );
}

export function insertRecommendations(db: Db, recs: Recommendation[]): void {
  const stmt = db.prepare(
    `INSERT INTO recommendations
       (id, project_id, key, text, rationale, category, raised_by_session_id,
        status, disposition_note, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    for (const r of recs) {
      RecommendationSchema.parse(r);
      stmt.run(
        r.id, r.projectId, r.key, r.text, r.rationale, r.category,
        r.raisedBySessionId, r.status, r.dispositionNote, r.createdAt,
      );
    }
  })();
}

export function listRecommendations(db: Db, projectId: string): Recommendation[] {
  const rows = db
    .prepare("SELECT * FROM recommendations WHERE project_id = ? ORDER BY key ASC")
    .all(projectId) as RecommendationRow[];
  return rows.map((row) =>
    RecommendationSchema.parse({
      id: row.id,
      projectId: row.project_id,
      key: row.key,
      text: row.text,
      rationale: row.rationale,
      category: row.category,
      raisedBySessionId: row.raised_by_session_id,
      status: row.status,
      dispositionNote: row.disposition_note,
      createdAt: row.created_at,
    }),
  );
}
