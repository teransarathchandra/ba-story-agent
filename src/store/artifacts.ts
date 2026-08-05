import type { Db } from "./db.js";
import {
  RequirementSchema, StorySchema, AcceptanceCriterionSchema,
  type Requirement, type Story, type AcceptanceCriterion,
} from "../types/domain.js";

const KEYED_TABLES = ["requirements", "stories", "open_questions", "recommendations"] as const;
export type KeyedTable = (typeof KEYED_TABLES)[number];

/** Allocate the next `PREFIX-NNN` key for a project. Not concurrency-safe by design: one BA, one process. */
export function nextKey(db: Db, projectId: string, table: KeyedTable, prefix: string): string {
  if (!KEYED_TABLES.includes(table)) throw new Error(`unknown keyed table: ${table}`);
  const rows = db
    .prepare(`SELECT key FROM ${table} WHERE project_id = ?`)
    .all(projectId) as { key: string }[];
  let max = 0;
  for (const { key } of rows) {
    const m = /-(\d+)$/.exec(key);
    if (m?.[1]) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

interface RequirementRow {
  id: string; project_id: string; key: string; statement: string;
  status: string; origin: string; origin_claim_ids: string;
  supersedes_id: string | null; created_at: string;
}

function toRequirement(row: RequirementRow): Requirement {
  return RequirementSchema.parse({
    id: row.id,
    projectId: row.project_id,
    key: row.key,
    statement: row.statement,
    status: row.status,
    origin: row.origin,
    originClaimIds: JSON.parse(row.origin_claim_ids) as string[],
    supersedesId: row.supersedes_id,
    createdAt: row.created_at,
  });
}

export function insertRequirements(db: Db, reqs: Requirement[]): void {
  const stmt = db.prepare(
    `INSERT INTO requirements
       (id, project_id, key, statement, status, origin, origin_claim_ids, supersedes_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    for (const r of reqs) {
      RequirementSchema.parse(r);
      stmt.run(
        r.id, r.projectId, r.key, r.statement, r.status, r.origin,
        JSON.stringify(r.originClaimIds), r.supersedesId, r.createdAt,
      );
    }
  })();
}

export function listRequirements(
  db: Db,
  projectId: string,
  opts?: { status?: Requirement["status"] },
): Requirement[] {
  let sql = "SELECT * FROM requirements WHERE project_id = ?";
  const extra: string[] = [];
  if (opts?.status) { sql += " AND status = ?"; extra.push(opts.status); }
  sql += " ORDER BY key ASC";
  return (db.prepare(sql).all(projectId, ...extra) as RequirementRow[]).map(toRequirement);
}

export function setRequirementStatus(db: Db, id: string, status: Requirement["status"]): void {
  db.prepare("UPDATE requirements SET status = ? WHERE id = ?").run(status, id);
}

interface StoryRow {
  id: string; project_id: string; key: string;
  as_a: string; i_want: string; so_that: string;
  requirement_ids: string; created_at: string;
}

interface AcRow {
  id: string; story_id: string; idx: number;
  gherkin: string; source: string; linked_question_id: string | null;
}

export function insertStory(db: Db, story: Story, criteria: AcceptanceCriterion[]): void {
  StorySchema.parse(story);
  const insertS = db.prepare(
    `INSERT INTO stories (id, project_id, key, as_a, i_want, so_that, requirement_ids, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  const insertAc = db.prepare(
    `INSERT INTO acceptance_criteria (id, story_id, idx, gherkin, source, linked_question_id)
     VALUES (?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    insertS.run(
      story.id, story.projectId, story.key, story.asA, story.iWant, story.soThat,
      JSON.stringify(story.requirementIds), story.createdAt,
    );
    for (const ac of criteria) {
      AcceptanceCriterionSchema.parse(ac);
      insertAc.run(ac.id, ac.storyId, ac.idx, ac.gherkin, ac.source, ac.linkedQuestionId);
    }
  })();
}

export function listStories(
  db: Db,
  projectId: string,
): { story: Story; criteria: AcceptanceCriterion[] }[] {
  const rows = db
    .prepare("SELECT * FROM stories WHERE project_id = ? ORDER BY key ASC")
    .all(projectId) as StoryRow[];
  const acStmt = db.prepare("SELECT * FROM acceptance_criteria WHERE story_id = ? ORDER BY idx ASC");
  return rows.map((row) => ({
    story: StorySchema.parse({
      id: row.id,
      projectId: row.project_id,
      key: row.key,
      asA: row.as_a,
      iWant: row.i_want,
      soThat: row.so_that,
      requirementIds: JSON.parse(row.requirement_ids) as string[],
      createdAt: row.created_at,
    }),
    criteria: (acStmt.all(row.id) as AcRow[]).map((a) =>
      AcceptanceCriterionSchema.parse({
        id: a.id,
        storyId: a.story_id,
        idx: a.idx,
        gherkin: a.gherkin,
        source: a.source,
        linkedQuestionId: a.linked_question_id,
      }),
    ),
  }));
}
