"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const node_fs = require("node:fs");
const Database = require("better-sqlite3");
const node_path = require("node:path");
const node_url = require("node:url");
const ulid = require("ulid");
const v4 = require("zod/v4");
const node_crypto = require("node:crypto");
const Anthropic = require("@anthropic-ai/sdk");
const zod = require("@anthropic-ai/sdk/helpers/zod");
const here = node_path.dirname(node_url.fileURLToPath(require("url").pathToFileURL(__filename).href));
function openDb(path2) {
  const db = new Database(path2);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const ddl = node_fs.readFileSync(node_path.join(here, "schema.sql"), "utf8");
  db.exec(ddl);
  return db;
}
const monotonic = ulid.monotonicFactory();
function newId(prefix) {
  return `${prefix}_${monotonic()}`;
}
const Iso = v4.z.string().datetime();
const ClaimKind = v4.z.enum(["requirement", "assumption", "ambiguity"]);
const ClaimStatus = v4.z.enum(["candidate", "validated", "quarantined"]);
const MatchMode = v4.z.enum(["exact", "segment-corrected", "fuzzy"]);
const SpeakerRole = v4.z.enum(["client", "ba", "other", "unknown"]);
const RequirementStatus = v4.z.enum([
  "proposed",
  "confirmed",
  "finalized",
  "superseded",
  "rejected"
]);
const RequirementOrigin = v4.z.enum(["client-stated", "ba-authored"]);
const AcSource = v4.z.enum(["client-stated", "derived"]);
const QuestionStatus = v4.z.enum(["open", "asked", "answered", "closed"]);
const RecommendationStatus = v4.z.enum(["open", "accepted", "declined"]);
const CritiqueCategory = v4.z.enum([
  "domain",
  "security",
  "privacy",
  "compliance",
  "edge-case",
  "testability"
]);
const RegulatoryContext = v4.z.enum([
  "none",
  "GDPR",
  "HIPAA",
  "PCI-DSS",
  "SOC2"
]);
const SessionStatus = v4.z.enum([
  "draft",
  "analyzing",
  "awaiting-review",
  "finalized",
  "failed"
]);
v4.z.enum(["confirms", "refines", "supersedes", "contradicts"]);
const ProjectSchema = v4.z.object({
  id: v4.z.string(),
  name: v4.z.string().min(1),
  domain: v4.z.string().min(10, "project domain must be a meaningful one-liner"),
  regulatoryContext: RegulatoryContext,
  systemName: v4.z.string().nullable(),
  glossary: v4.z.string().nullable(),
  createdAt: Iso
});
const SessionSchema = v4.z.object({
  id: v4.z.string(),
  projectId: v4.z.string(),
  title: v4.z.string().min(1),
  occurredAt: Iso,
  status: SessionStatus,
  createdAt: Iso
});
const TranscriptSchema = v4.z.object({
  id: v4.z.string(),
  sessionId: v4.z.string(),
  version: v4.z.number().int().positive(),
  text: v4.z.string().min(1),
  contentHash: v4.z.string().length(64),
  frozenAt: Iso.nullable(),
  createdAt: Iso
});
const SegmentSchema = v4.z.object({
  id: v4.z.string(),
  transcriptId: v4.z.string(),
  idx: v4.z.number().int().nonnegative(),
  startMs: v4.z.number().int().nonnegative().nullable(),
  endMs: v4.z.number().int().nonnegative().nullable(),
  speakerLabel: v4.z.string().nullable(),
  text: v4.z.string(),
  charStart: v4.z.number().int().nonnegative(),
  charEnd: v4.z.number().int().nonnegative()
});
const ClaimSchema = v4.z.object({
  id: v4.z.string(),
  sessionId: v4.z.string(),
  transcriptId: v4.z.string(),
  segmentId: v4.z.string(),
  quote: v4.z.string().min(1, "a claim must carry a non-empty quote"),
  statement: v4.z.string().min(1),
  speakerRole: SpeakerRole,
  kind: ClaimKind,
  status: ClaimStatus,
  charStart: v4.z.number().int().nonnegative().nullable(),
  charEnd: v4.z.number().int().nonnegative().nullable(),
  matchMode: MatchMode.nullable(),
  createdAt: Iso
});
const RequirementSchema = v4.z.object({
  id: v4.z.string(),
  projectId: v4.z.string(),
  key: v4.z.string().regex(/^REQ-\d{3,}$/),
  statement: v4.z.string().min(1),
  status: RequirementStatus,
  origin: RequirementOrigin,
  originClaimIds: v4.z.array(v4.z.string()),
  supersedesId: v4.z.string().nullable(),
  createdAt: Iso
}).refine(
  (r) => r.origin === "ba-authored" || r.originClaimIds.length > 0,
  { message: "a client-stated requirement must cite at least one origin claim", path: ["originClaimIds"] }
);
const AcceptanceCriterionSchema = v4.z.object({
  id: v4.z.string(),
  storyId: v4.z.string(),
  idx: v4.z.number().int().nonnegative(),
  gherkin: v4.z.string().min(1),
  source: AcSource,
  linkedQuestionId: v4.z.string().nullable()
});
const StorySchema = v4.z.object({
  id: v4.z.string(),
  projectId: v4.z.string(),
  key: v4.z.string().regex(/^US-\d{3,}$/),
  asA: v4.z.string().min(1),
  iWant: v4.z.string().min(1),
  soThat: v4.z.string().min(1),
  requirementIds: v4.z.array(v4.z.string()).min(1),
  createdAt: Iso
});
const OpenQuestionSchema = v4.z.object({
  id: v4.z.string(),
  projectId: v4.z.string(),
  key: v4.z.string().regex(/^OQ-\d{3,}$/),
  text: v4.z.string().min(1),
  category: CritiqueCategory,
  raisedBySessionId: v4.z.string(),
  status: QuestionStatus,
  answerText: v4.z.string().nullable(),
  answeredBySessionId: v4.z.string().nullable(),
  createdAt: Iso
});
const RecommendationSchema = v4.z.object({
  id: v4.z.string(),
  projectId: v4.z.string(),
  key: v4.z.string().regex(/^REC-\d{3,}$/),
  text: v4.z.string().min(1),
  rationale: v4.z.string().min(1),
  category: CritiqueCategory,
  raisedBySessionId: v4.z.string(),
  status: RecommendationStatus,
  dispositionNote: v4.z.string().nullable(),
  createdAt: Iso
});
const ApprovalEventSchema = v4.z.object({
  id: v4.z.string(),
  entityType: v4.z.enum(["requirement", "story", "question", "recommendation", "session"]),
  entityId: v4.z.string(),
  action: v4.z.string().min(1),
  actorNote: v4.z.string().nullable(),
  contentHash: v4.z.string().length(64),
  at: Iso
});
const EgressLogSchema = v4.z.object({
  id: v4.z.string(),
  sessionId: v4.z.string(),
  stage: v4.z.string().min(1),
  requestHash: v4.z.string().length(64),
  promptTokens: v4.z.number().int().nonnegative(),
  completionTokens: v4.z.number().int().nonnegative(),
  model: v4.z.string().min(1),
  at: Iso
});
function toProject(row) {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    domain: row.domain,
    regulatoryContext: row.regulatory_context,
    systemName: row.system_name,
    glossary: row.glossary,
    createdAt: row.created_at
  });
}
function toSession(row) {
  return SessionSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    occurredAt: row.occurred_at,
    status: row.status,
    createdAt: row.created_at
  });
}
function createProject(db, input) {
  const project = ProjectSchema.parse({
    id: newId("prj"),
    name: input.name,
    domain: input.domain,
    regulatoryContext: input.regulatoryContext ?? "none",
    systemName: input.systemName ?? null,
    glossary: input.glossary ?? null,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  db.prepare(
    `INSERT INTO projects (id, name, domain, regulatory_context, system_name, glossary, created_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    project.id,
    project.name,
    project.domain,
    project.regulatoryContext,
    project.systemName,
    project.glossary,
    project.createdAt
  );
  return project;
}
function getProject(db, id) {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return row ? toProject(row) : null;
}
function createSession(db, input) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const session = SessionSchema.parse({
    id: newId("ses"),
    projectId: input.projectId,
    title: input.title,
    occurredAt: input.occurredAt ?? now,
    status: "draft",
    createdAt: now
  });
  db.prepare(
    `INSERT INTO sessions (id, project_id, title, occurred_at, status, created_at)
     VALUES (?,?,?,?,?,?)`
  ).run(
    session.id,
    session.projectId,
    session.title,
    session.occurredAt,
    session.status,
    session.createdAt
  );
  return session;
}
function setSessionStatus(db, sessionId, status) {
  db.prepare("UPDATE sessions SET status = ? WHERE id = ?").run(status, sessionId);
}
function listSessions(db, projectId) {
  const rows = db.prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY occurred_at ASC").all(projectId);
  return rows.map(toSession);
}
function hashText(text) {
  return node_crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
function toTranscript(row) {
  return TranscriptSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    version: row.version,
    text: row.text,
    contentHash: row.content_hash,
    frozenAt: row.frozen_at,
    createdAt: row.created_at
  });
}
function toSegment(row) {
  return SegmentSchema.parse({
    id: row.id,
    transcriptId: row.transcript_id,
    idx: row.idx,
    startMs: row.start_ms,
    endMs: row.end_ms,
    speakerLabel: row.speaker_label,
    text: row.text,
    charStart: row.char_start,
    charEnd: row.char_end
  });
}
function splitSegments(transcriptId, text) {
  const segments = [];
  const pattern = /\n\s*\n/g;
  let cursor = 0;
  let idx = 0;
  const push = (start, end) => {
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
        charEnd: e
      })
    );
  };
  let m;
  while ((m = pattern.exec(text)) !== null) {
    push(cursor, m.index);
    cursor = m.index + m[0].length;
  }
  push(cursor, text.length);
  return segments;
}
function createTranscript(db, input) {
  const prior = db.prepare("SELECT MAX(version) AS v FROM transcripts WHERE session_id = ?").get(input.sessionId);
  const version = (prior.v ?? 0) + 1;
  const transcript = TranscriptSchema.parse({
    id: newId("trs"),
    sessionId: input.sessionId,
    version,
    text: input.text,
    contentHash: hashText(input.text),
    frozenAt: null,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  const segments = splitSegments(transcript.id, input.text);
  const insertTranscript = db.prepare(
    `INSERT INTO transcripts (id, session_id, version, text, content_hash, frozen_at, created_at)
     VALUES (?,?,?,?,?,?,?)`
  );
  const insertSegment = db.prepare(
    `INSERT INTO segments (id, transcript_id, idx, start_ms, end_ms, speaker_label, text, char_start, char_end)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  db.transaction(() => {
    insertTranscript.run(
      transcript.id,
      transcript.sessionId,
      transcript.version,
      transcript.text,
      transcript.contentHash,
      transcript.frozenAt,
      transcript.createdAt
    );
    for (const seg of segments) {
      insertSegment.run(
        seg.id,
        seg.transcriptId,
        seg.idx,
        seg.startMs,
        seg.endMs,
        seg.speakerLabel,
        seg.text,
        seg.charStart,
        seg.charEnd
      );
    }
  })();
  return { transcript, segments };
}
function freezeTranscript(db, transcriptId) {
  const at = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare("UPDATE transcripts SET frozen_at = ? WHERE id = ?").run(at, transcriptId);
  const row = db.prepare("SELECT * FROM transcripts WHERE id = ?").get(transcriptId);
  return toTranscript(row);
}
function getFrozenTranscript(db, sessionId) {
  const row = db.prepare(
    `SELECT * FROM transcripts
       WHERE session_id = ? AND frozen_at IS NOT NULL
       ORDER BY version DESC LIMIT 1`
  ).get(sessionId);
  if (!row) return null;
  const segRows = db.prepare("SELECT * FROM segments WHERE transcript_id = ? ORDER BY idx ASC").all(row.id);
  return { transcript: toTranscript(row), segments: segRows.map(toSegment) };
}
const KEYED_TABLES = ["requirements", "stories", "open_questions", "recommendations"];
function nextKey(db, projectId, table, prefix) {
  if (!KEYED_TABLES.includes(table)) throw new Error(`unknown keyed table: ${table}`);
  const rows = db.prepare(`SELECT key FROM ${table} WHERE project_id = ?`).all(projectId);
  let max = 0;
  for (const { key } of rows) {
    const m = /-(\d+)$/.exec(key);
    if (m?.[1]) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}
function toRequirement(row) {
  return RequirementSchema.parse({
    id: row.id,
    projectId: row.project_id,
    key: row.key,
    statement: row.statement,
    status: row.status,
    origin: row.origin,
    originClaimIds: JSON.parse(row.origin_claim_ids),
    supersedesId: row.supersedes_id,
    createdAt: row.created_at
  });
}
function insertRequirements(db, reqs) {
  const stmt = db.prepare(
    `INSERT INTO requirements
       (id, project_id, key, statement, status, origin, origin_claim_ids, supersedes_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  db.transaction(() => {
    for (const r of reqs) {
      RequirementSchema.parse(r);
      stmt.run(
        r.id,
        r.projectId,
        r.key,
        r.statement,
        r.status,
        r.origin,
        JSON.stringify(r.originClaimIds),
        r.supersedesId,
        r.createdAt
      );
    }
  })();
}
function listRequirements(db, projectId, opts) {
  let sql = "SELECT * FROM requirements WHERE project_id = ?";
  const extra = [];
  if (opts?.status) {
    sql += " AND status = ?";
    extra.push(opts.status);
  }
  sql += " ORDER BY key ASC";
  return db.prepare(sql).all(projectId, ...extra).map(toRequirement);
}
function setRequirementStatus(db, id, status) {
  db.prepare("UPDATE requirements SET status = ? WHERE id = ?").run(status, id);
}
function insertStory(db, story, criteria) {
  StorySchema.parse(story);
  const insertS = db.prepare(
    `INSERT INTO stories (id, project_id, key, as_a, i_want, so_that, requirement_ids, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const insertAc = db.prepare(
    `INSERT INTO acceptance_criteria (id, story_id, idx, gherkin, source, linked_question_id)
     VALUES (?,?,?,?,?,?)`
  );
  db.transaction(() => {
    insertS.run(
      story.id,
      story.projectId,
      story.key,
      story.asA,
      story.iWant,
      story.soThat,
      JSON.stringify(story.requirementIds),
      story.createdAt
    );
    for (const ac of criteria) {
      AcceptanceCriterionSchema.parse(ac);
      insertAc.run(ac.id, ac.storyId, ac.idx, ac.gherkin, ac.source, ac.linkedQuestionId);
    }
  })();
}
function listStories(db, projectId) {
  const rows = db.prepare("SELECT * FROM stories WHERE project_id = ? ORDER BY key ASC").all(projectId);
  const acStmt = db.prepare("SELECT * FROM acceptance_criteria WHERE story_id = ? ORDER BY idx ASC");
  return rows.map((row) => ({
    story: StorySchema.parse({
      id: row.id,
      projectId: row.project_id,
      key: row.key,
      asA: row.as_a,
      iWant: row.i_want,
      soThat: row.so_that,
      requirementIds: JSON.parse(row.requirement_ids),
      createdAt: row.created_at
    }),
    criteria: acStmt.all(row.id).map(
      (a) => AcceptanceCriterionSchema.parse({
        id: a.id,
        storyId: a.story_id,
        idx: a.idx,
        gherkin: a.gherkin,
        source: a.source,
        linkedQuestionId: a.linked_question_id
      })
    )
  }));
}
function insertQuestions(db, qs) {
  const stmt = db.prepare(
    `INSERT INTO open_questions
       (id, project_id, key, text, category, raised_by_session_id, status,
        answer_text, answered_by_session_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  db.transaction(() => {
    for (const q of qs) {
      OpenQuestionSchema.parse(q);
      stmt.run(
        q.id,
        q.projectId,
        q.key,
        q.text,
        q.category,
        q.raisedBySessionId,
        q.status,
        q.answerText,
        q.answeredBySessionId,
        q.createdAt
      );
    }
  })();
}
function listQuestions(db, projectId, opts) {
  let sql = "SELECT * FROM open_questions WHERE project_id = ?";
  const extra = [];
  sql += " ORDER BY key ASC";
  return db.prepare(sql).all(projectId, ...extra).map(
    (row) => OpenQuestionSchema.parse({
      id: row.id,
      projectId: row.project_id,
      key: row.key,
      text: row.text,
      category: row.category,
      raisedBySessionId: row.raised_by_session_id,
      status: row.status,
      answerText: row.answer_text,
      answeredBySessionId: row.answered_by_session_id,
      createdAt: row.created_at
    })
  );
}
function insertRecommendations(db, recs) {
  const stmt = db.prepare(
    `INSERT INTO recommendations
       (id, project_id, key, text, rationale, category, raised_by_session_id,
        status, disposition_note, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  db.transaction(() => {
    for (const r of recs) {
      RecommendationSchema.parse(r);
      stmt.run(
        r.id,
        r.projectId,
        r.key,
        r.text,
        r.rationale,
        r.category,
        r.raisedBySessionId,
        r.status,
        r.dispositionNote,
        r.createdAt
      );
    }
  })();
}
function listRecommendations(db, projectId) {
  const rows = db.prepare("SELECT * FROM recommendations WHERE project_id = ? ORDER BY key ASC").all(projectId);
  return rows.map(
    (row) => RecommendationSchema.parse({
      id: row.id,
      projectId: row.project_id,
      key: row.key,
      text: row.text,
      rationale: row.rationale,
      category: row.category,
      raisedBySessionId: row.raised_by_session_id,
      status: row.status,
      dispositionNote: row.disposition_note,
      createdAt: row.created_at
    })
  );
}
function toClaim(row) {
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
    createdAt: row.created_at
  });
}
function insertClaims(db, claims) {
  const stmt = db.prepare(
    `INSERT INTO claims
       (id, session_id, transcript_id, segment_id, quote, statement, speaker_role,
        kind, status, char_start, char_end, match_mode, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  db.transaction(() => {
    for (const c of claims) {
      ClaimSchema.parse(c);
      stmt.run(
        c.id,
        c.sessionId,
        c.transcriptId,
        c.segmentId,
        c.quote,
        c.statement,
        c.speakerRole,
        c.kind,
        c.status,
        c.charStart,
        c.charEnd,
        c.matchMode,
        c.createdAt
      );
    }
  })();
}
function applyFilters(base, opts) {
  const extra = [];
  let sql = base;
  if (opts?.status) {
    sql += " AND c.status = ?";
    extra.push(opts.status);
  }
  if (opts?.kind) {
    sql += " AND c.kind = ?";
    extra.push(opts.kind);
  }
  sql += " ORDER BY c.created_at ASC, c.id ASC";
  return { sql, extra };
}
function listClaims(db, sessionId, opts) {
  const { sql, extra } = applyFilters("SELECT c.* FROM claims c WHERE c.session_id = ?", opts);
  return db.prepare(sql).all(sessionId, ...extra).map(toClaim);
}
function listProjectClaims(db, projectId, opts) {
  const { sql, extra } = applyFilters(
    `SELECT c.* FROM claims c
     JOIN sessions s ON s.id = c.session_id
     WHERE s.project_id = ?`,
    opts
  );
  return db.prepare(sql).all(projectId, ...extra).map(toClaim);
}
function updateClaimValidation(db, id, patch) {
  db.prepare(
    `UPDATE claims
     SET status = ?, char_start = ?, char_end = ?, match_mode = ?, segment_id = ?
     WHERE id = ?`
  ).run(patch.status, patch.charStart, patch.charEnd, patch.matchMode, patch.segmentId, id);
}
function countByStatus(db, sessionId) {
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM claims WHERE session_id = ? GROUP BY status").all(sessionId);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
function setClaimKind(db, id, kind) {
  db.prepare("UPDATE claims SET kind = ? WHERE id = ?").run(kind, id);
}
function recordApproval(db, e) {
  const event = ApprovalEventSchema.parse({
    ...e,
    id: newId("apv"),
    at: (/* @__PURE__ */ new Date()).toISOString()
  });
  db.prepare(
    `INSERT INTO approval_events (id, entity_type, entity_id, action, actor_note, content_hash, at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    event.id,
    event.entityType,
    event.entityId,
    event.action,
    event.actorNote,
    event.contentHash,
    event.at
  );
  return event;
}
function recordEgress(db, e) {
  const entry = EgressLogSchema.parse({
    ...e,
    id: newId("egr"),
    at: (/* @__PURE__ */ new Date()).toISOString()
  });
  db.prepare(
    `INSERT INTO egress_log (id, session_id, stage, request_hash, prompt_tokens, completion_tokens, model, at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    entry.id,
    entry.sessionId,
    entry.stage,
    entry.requestHash,
    entry.promptTokens,
    entry.completionTokens,
    entry.model,
    entry.at
  );
}
function egressSummary(db, sessionId) {
  const row = db.prepare(
    `SELECT COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens), 0) AS p,
              COALESCE(SUM(completion_tokens), 0) AS c
       FROM egress_log WHERE session_id = ?`
  ).get(sessionId);
  return { requests: row.requests, promptTokens: row.p, completionTokens: row.c };
}
function saveCheckpoint(db, sessionId, stage, status, payload, errorText = null, rawResponse = null) {
  db.prepare(
    `INSERT INTO stage_checkpoints (id, session_id, stage, status, payload_json, error_text, raw_response, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (session_id, stage) DO UPDATE SET
       status = excluded.status,
       payload_json = excluded.payload_json,
       error_text = excluded.error_text,
       raw_response = excluded.raw_response,
       updated_at = excluded.updated_at`
  ).run(
    newId("ckp"),
    sessionId,
    stage,
    status,
    payload === null || payload === void 0 ? null : JSON.stringify(payload),
    errorText,
    rawResponse,
    (/* @__PURE__ */ new Date()).toISOString()
  );
}
function loadCheckpoint(db, sessionId, stage) {
  const row = db.prepare("SELECT status, payload_json, error_text FROM stage_checkpoints WHERE session_id = ? AND stage = ?").get(sessionId, stage);
  if (!row) return null;
  return {
    status: row.status,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    errorText: row.error_text
  };
}
const MODEL = "claude-opus-5";
const MAX_TOKENS = 16e3;
function createClient(opts) {
  return new Anthropic({
    ...{},
    // The SDK already retries 408/409/429/5xx with exponential backoff.
    maxRetries: 3,
    // NOTE: the TypeScript SDK takes milliseconds, unlike the Python SDK.
    timeout: 10 * 60 * 1e3
  });
}
function canonical(value) {
  if (value === void 0) return '"__undefined__"';
  if (typeof value === "function") return '"__function__"';
  if (typeof value === "symbol") return '"__symbol__"';
  if (value === null) return "null";
  if (typeof value === "number" && !Number.isFinite(value)) {
    return `"__nonfinite:${String(value)}__"`;
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value).sort(
    ([a], [b]) => a < b ? -1 : a > b ? 1 : 0
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
function hashRequest(payload) {
  return node_crypto.createHash("sha256").update(canonical(payload), "utf8").digest("hex");
}
function logEgress(db, sessionId, stage, payload, usage, model) {
  recordEgress(db, {
    sessionId,
    stage,
    requestHash: hashRequest(payload),
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    model
  });
}
class AnthropicBackend {
  constructor(client) {
    this.client = client;
  }
  model = MODEL;
  async generate(args) {
    const request = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: args.system,
      output_config: {
        effort: args.effort ?? "high",
        format: zod.zodOutputFormat(args.schema)
      },
      messages: [{ role: "user", content: args.user }]
    };
    const response = await this.client.messages.parse(request);
    const content = response.content ?? [];
    const raw = content.map((b) => b.type === "text" ? b.text ?? "" : "").join("");
    return {
      raw,
      parsedOutput: response.parsed_output,
      requestPayload: request,
      usage: response.usage ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } : void 0
    };
  }
}
class StageFailure extends Error {
  constructor(stage, message, rawResponse, cause) {
    super(message);
    this.stage = stage;
    this.rawResponse = rawResponse;
    this.cause = cause;
    this.name = "StageFailure";
  }
}
const MAX_SCHEMA_RETRIES = 2;
async function callTyped(args) {
  const { client: backend, db, sessionId, stage, schema } = args;
  let user = args.user;
  let lastRaw = null;
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_SCHEMA_RETRIES; attempt++) {
    const result = await backend.generate({
      system: args.system,
      user,
      schema,
      effort: args.effort
    });
    lastRaw = result.raw;
    if (result.usage) {
      logEgress(db, sessionId, stage, result.requestPayload, result.usage, backend.model);
    }
    if (result.parsedOutput === null || result.parsedOutput === void 0) {
      lastError = new Error("parsed_output was null — the model returned no schema-conforming JSON");
    } else {
      const parsed = schema.safeParse(result.parsedOutput);
      if (parsed.success) return parsed.data;
      lastError = parsed.error;
    }
    if (attempt < MAX_SCHEMA_RETRIES) {
      user = `${args.user}

Your previous response did not conform to the required schema. The validation error was:
${String(lastError)}
Return a response that satisfies the schema exactly.`;
    }
  }
  throw new StageFailure(
    stage,
    `stage "${stage}" produced no schema-conforming output after ${MAX_SCHEMA_RETRIES + 1} attempts`,
    lastRaw,
    lastError
  );
}
async function runPipeline(ctx, stages, initial, opts) {
  const progress = opts?.onProgress ?? (() => {
  });
  let value = initial;
  for (const stage of stages) {
    if (opts?.resume) {
      const cp = loadCheckpoint(ctx.db, ctx.sessionId, stage.name);
      if (cp?.status === "complete") {
        progress(stage.name, "skipped");
        value = cp.payload;
        continue;
      }
    }
    progress(stage.name, "running");
    saveCheckpoint(ctx.db, ctx.sessionId, stage.name, "running", null);
    try {
      value = await stage.run(ctx, value);
    } catch (err) {
      const raw = err instanceof StageFailure ? err.rawResponse : null;
      saveCheckpoint(
        ctx.db,
        ctx.sessionId,
        stage.name,
        "failed",
        null,
        err instanceof Error ? err.message : String(err),
        raw
      );
      setSessionStatus(ctx.db, ctx.sessionId, "failed");
      progress(stage.name, "failed");
      throw err;
    }
    saveCheckpoint(ctx.db, ctx.sessionId, stage.name, "complete", value);
    progress(stage.name, "complete");
  }
  return value;
}
const MIN_WORDS = 200;
function countWords(text) {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}
function chunkTranscript(transcriptText, segments, opts) {
  if (segments.length === 0) return [];
  const target = 2e3;
  const overlap = 200;
  const counts = segments.map((s) => countWords(s.text));
  const windows = [];
  let start = 0;
  let idx = 0;
  while (start < segments.length) {
    let end = start;
    let words = 0;
    let tookAny = false;
    while (end < segments.length && (!tookAny || words + counts[end] <= target)) {
      words += counts[end];
      tookAny = true;
      end++;
    }
    const slice = segments.slice(start, end);
    const first = slice[0];
    const last = slice[slice.length - 1];
    windows.push({
      idx: idx++,
      segments: slice,
      text: transcriptText.slice(first.charStart, last.charEnd),
      charStart: first.charStart
    });
    if (end >= segments.length) break;
    let back = end - 1;
    let carried = 0;
    if (back >= start) {
      carried = counts[back];
      back--;
      while (back >= start && carried + counts[back] <= overlap) {
        carried += counts[back];
        back--;
      }
    }
    start = Math.max(start + 1, back + 1);
  }
  return windows;
}
function emptyState(transcriptId) {
  return {
    transcriptId,
    windows: [],
    extracted: 0,
    validated: 0,
    quarantined: 0,
    requirements: 0,
    stories: 0,
    questions: 0,
    recommendations: 0
  };
}
function toRef(w) {
  const last = w.segments[w.segments.length - 1];
  return {
    idx: w.idx,
    segmentIds: w.segments.map((s) => s.id),
    charStart: w.charStart,
    charEnd: last.charEnd
  };
}
function hydrateWindow(db, transcriptText, ref) {
  const placeholders = ref.segmentIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM segments WHERE id IN (${placeholders}) ORDER BY idx ASC`).all(...ref.segmentIds);
  const segments = rows.map((r) => ({
    id: r.id,
    transcriptId: r.transcript_id,
    idx: r.idx,
    startMs: r.start_ms,
    endMs: r.end_ms,
    speakerLabel: r.speaker_label,
    text: r.text,
    charStart: r.char_start,
    charEnd: r.char_end
  }));
  return {
    idx: ref.idx,
    segments,
    text: transcriptText.slice(ref.charStart, ref.charEnd),
    charStart: ref.charStart
  };
}
const EXTRACT_SYSTEM = `You extract atomic claims from a transcript of a business analyst's meeting with a client.

A claim is one indivisible thing that was actually said. For each claim you emit:
- "quote": the exact words from the transcript, copied verbatim. Do not paraphrase, tidy, correct, or complete it.
- "statement": your own normalized restatement of what that quote asserts.
- "segmentId": the id of the segment the quote came from.
- "speakerRole": who said it.

Rules, in order of importance:

1. If you cannot quote it, do not emit it. Every claim must be anchored in words that literally appear in the transcript below. A quote that is not present will be discarded by an automated check and will count against this extraction's quality score.
2. Do not infer. If the client did not say something, it is not a claim. Absence of a detail is not a claim that the detail is unimportant.
3. One assertion per claim. Split compound statements.
4. Preserve hedging in the quote. If the speaker said "we'd probably want X", quote it with "probably" intact — a later stage depends on that word being there.
5. Extract from what the client says. The analyst's own questions and suggestions are not client claims; if the analyst proposes something and the client only acknowledges it vaguely, that is not a claim.
6. Ignore scheduling, small talk, and meeting logistics.

Return no claims at all if the transcript contains none. An empty result is a correct answer for a status call or a social conversation.`;
function buildExtractUser(window, project) {
  const segmentBlock = window.segments.map((s) => `[segmentId: ${s.id}]
${s.text}`).join("\n\n");
  const glossary = project.glossary ? `

Domain glossary:
${project.glossary}` : "";
  return `Project domain: ${project.domain}${glossary}

Transcript window ${window.idx + 1}:

${segmentBlock}`;
}
const ExtractedClaimsSchema = v4.z.object({
  claims: v4.z.array(
    v4.z.object({
      quote: v4.z.string(),
      statement: v4.z.string(),
      segmentId: v4.z.string(),
      speakerRole: v4.z.enum(["client", "ba", "other", "unknown"])
    })
  )
});
const stage0Chunk = {
  name: "chunk",
  async run(ctx, input) {
    const frozen = getFrozenTranscript(ctx.db, ctx.sessionId);
    if (!frozen) throw new Error("session has no frozen transcript");
    const words = countWords(frozen.transcript.text);
    if (words < MIN_WORDS) {
      throw new Error(
        `input is ${words} words; the pipeline requires at least ${MIN_WORDS} words. Below this, extraction produces noise rather than requirements.`
      );
    }
    const windows = chunkTranscript(frozen.transcript.text, frozen.segments);
    return { ...emptyState(input.transcriptId), windows: windows.map(toRef) };
  }
};
const stage1Extract = {
  name: "extract",
  async run(ctx, state) {
    const frozen = getFrozenTranscript(ctx.db, ctx.sessionId);
    if (!frozen) throw new Error("session has no frozen transcript");
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");
    const all = [];
    const now = (/* @__PURE__ */ new Date()).toISOString();
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
        effort: "high"
      });
      const validSegmentIds = new Set(window.segments.map((s) => s.id));
      const fallbackSegmentId = window.segments[0]?.id;
      for (const c of result.claims) {
        if (c.quote.trim().length === 0) continue;
        const segmentId = validSegmentIds.has(c.segmentId) ? c.segmentId : fallbackSegmentId;
        if (!segmentId) continue;
        all.push({
          id: newId("clm"),
          sessionId: ctx.sessionId,
          transcriptId: frozen.transcript.id,
          segmentId,
          quote: c.quote,
          statement: c.statement,
          speakerRole: c.speakerRole,
          kind: "requirement",
          // placeholder; Stage 3 sets the real kind
          status: "candidate",
          // placeholder; Stage 2 sets the real status
          charStart: null,
          charEnd: null,
          matchMode: null,
          createdAt: now
        });
      }
    }
    insertClaims(ctx.db, all);
    return { ...state, extracted: all.length };
  }
};
const FOLD = {
  [String.fromCodePoint(8216)]: "'",
  // ' left single quotation mark
  [String.fromCodePoint(8217)]: "'",
  // ' right single quotation mark
  [String.fromCodePoint(8218)]: "'",
  // ‚ single low-9 quotation mark
  [String.fromCodePoint(8219)]: "'",
  // ‛ single high-reversed-9 quotation mark
  [String.fromCodePoint(8220)]: '"',
  // " left double quotation mark
  [String.fromCodePoint(8221)]: '"',
  // " right double quotation mark
  [String.fromCodePoint(8222)]: '"',
  // „ double low-9 quotation mark
  [String.fromCodePoint(8223)]: '"',
  // ‟ double high-reversed-9 quotation mark
  [String.fromCodePoint(8211)]: "-",
  // – en dash
  [String.fromCodePoint(8212)]: "-",
  // — em dash
  [String.fromCodePoint(8722)]: "-",
  // − minus sign
  [String.fromCodePoint(160)]: " ",
  // non-breaking space
  [String.fromCodePoint(8230)]: "..."
  // … horizontal ellipsis
};
function normalize(input) {
  const out = [];
  const map = [];
  let pendingSpace = false;
  let lastWhitespaceIndex = -1;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const folded = FOLD[ch] ?? ch;
    if (/\s/.test(folded)) {
      if (out.length > 0) {
        pendingSpace = true;
        lastWhitespaceIndex = i;
      }
      continue;
    }
    if (pendingSpace) {
      out.push(" ");
      map.push(lastWhitespaceIndex);
      pendingSpace = false;
    }
    const lowered = folded.toLowerCase();
    for (const c of lowered) {
      out.push(c);
      map.push(i);
    }
  }
  return { text: out.join(""), map };
}
function denormalizeRange(map, originalLength, start, end) {
  if (map.length === 0 || start >= end) return { start: 0, end: 0 };
  const clampedStart = Math.max(0, Math.min(start, map.length - 1));
  const clampedEnd = Math.max(clampedStart, Math.min(end, map.length));
  const originalStart = map[clampedStart];
  const lastIdx = map[clampedEnd - 1];
  return {
    start: originalStart,
    end: Math.min(lastIdx + 1, originalLength)
  };
}
const DISFLUENCIES = /* @__PURE__ */ new Set([
  "um",
  "uh",
  "erm",
  "er",
  "ah",
  "eh",
  "hm",
  "hmm",
  "mm",
  "mhm",
  "like",
  "sorta",
  "kinda",
  "basically",
  "literally"
]);
const DISFLUENCY_PHRASES = [
  ["you", "know"],
  ["i", "mean"],
  ["sort", "of"],
  ["kind", "of"]
];
function tokenize(text) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ token: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}
const PUNCT_TRIM = /^[.,;:!?"'()[\]-]+|[.,;:!?"'()[\]-]+$/g;
function trimPunct(token) {
  return token.replace(PUNCT_TRIM, "");
}
function stripDisfluencies(tokens) {
  const cleaned = tokens.map(trimPunct).filter((t) => t.length > 0);
  const out = [];
  let i = 0;
  outer: while (i < cleaned.length) {
    for (const phrase of DISFLUENCY_PHRASES) {
      if (phrase.every((w, k) => cleaned[i + k] === w)) {
        i += phrase.length;
        continue outer;
      }
    }
    const tok = cleaned[i];
    if (!DISFLUENCIES.has(tok)) out.push(tok);
    i++;
  }
  return out;
}
function levenshteinRatio(a, b) {
  if (a.length === 0 && b.length === 0) return 1;
  const max = Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return 1 - prev[b.length] / max;
}
function bestWindow(haystackNorm, needleNorm) {
  const hayTokens = tokenize(haystackNorm);
  const rawNeedleTokens = tokenize(needleNorm).map((t) => t.token);
  if (hayTokens.length === 0 || rawNeedleTokens.length === 0) return null;
  const strippedNeedle = stripDisfluencies(rawNeedleTokens);
  if (strippedNeedle.length === 0) return null;
  const n = rawNeedleTokens.length;
  const minLen = Math.max(1, n - 2);
  const maxLen = Math.min(hayTokens.length, n + 3);
  let best = { ratio: -1, start: 0, end: 0 };
  for (let len = minLen; len <= maxLen; len++) {
    for (let i = 0; i + len <= hayTokens.length; i++) {
      const window = hayTokens.slice(i, i + len);
      const windowTokens = window.map((t) => t.token);
      const strippedWindow = stripDisfluencies(windowTokens);
      const ratio = levenshteinRatio(strippedWindow, strippedNeedle);
      if (ratio > best.ratio) {
        best = {
          ratio,
          start: window[0].start,
          end: window[window.length - 1].end
        };
        if (ratio === 1) return best;
      }
    }
  }
  return best.ratio < 0 ? null : best;
}
const FUZZY_THRESHOLD = 0.9;
function exactMatch(haystack, haystackCharStart, quoteNorm) {
  const { text: hayNorm, map } = normalize(haystack);
  const at = hayNorm.indexOf(quoteNorm);
  if (at === -1) return null;
  const range = denormalizeRange(map, haystack.length, at, at + quoteNorm.length);
  return {
    charStart: haystackCharStart + range.start,
    charEnd: haystackCharStart + range.end
  };
}
function validateQuote(input, source) {
  const { text: quoteNorm } = normalize(input.quote);
  if (quoteNorm.length === 0) {
    return { status: "quarantined", reason: "quote is empty after normalization", bestRatio: 0 };
  }
  const named = source.segments.find((s) => s.id === input.segmentId);
  if (named) {
    const hit = exactMatch(named.text, named.charStart, quoteNorm);
    if (hit) {
      return {
        status: "validated",
        matchMode: "exact",
        segmentId: named.id,
        charStart: hit.charStart,
        charEnd: hit.charEnd,
        ratio: 1
      };
    }
  }
  for (const seg of source.segments) {
    if (seg.id === input.segmentId) continue;
    const hit = exactMatch(seg.text, seg.charStart, quoteNorm);
    if (hit) {
      return {
        status: "validated",
        matchMode: "segment-corrected",
        segmentId: seg.id,
        charStart: hit.charStart,
        charEnd: hit.charEnd,
        ratio: 1
      };
    }
  }
  const { text: windowNorm, map } = normalize(source.windowText);
  const best = bestWindow(windowNorm, quoteNorm);
  if (!best) {
    return { status: "quarantined", reason: "window has no tokens to match against", bestRatio: 0 };
  }
  if (best.ratio < FUZZY_THRESHOLD) {
    return {
      status: "quarantined",
      reason: `best similarity ${best.ratio.toFixed(3)} is below the ${FUZZY_THRESHOLD} threshold`,
      bestRatio: best.ratio
    };
  }
  const range = denormalizeRange(map, source.windowText.length, best.start, best.end);
  const absStart = source.windowCharStart + range.start;
  const absEnd = source.windowCharStart + range.end;
  const mid = (absStart + absEnd) / 2;
  const owner = source.segments.find((s) => mid >= s.charStart && mid <= s.charStart + s.text.length) ?? named ?? source.segments[0];
  return {
    status: "validated",
    matchMode: "fuzzy",
    segmentId: owner?.id ?? input.segmentId,
    charStart: absStart,
    charEnd: absEnd,
    ratio: best.ratio
  };
}
const stage2Validate = {
  name: "validate",
  async run(ctx, state) {
    const frozen = getFrozenTranscript(ctx.db, ctx.sessionId);
    if (!frozen) throw new Error("session has no frozen transcript");
    const windows = state.windows.map(
      (ref) => hydrateWindow(ctx.db, frozen.transcript.text, ref)
    );
    const windowBySegment = /* @__PURE__ */ new Map();
    for (const w of windows) {
      const src = {
        segments: w.segments.map((s) => ({ id: s.id, text: s.text, charStart: s.charStart })),
        windowText: w.text,
        windowCharStart: w.charStart
      };
      for (const s of w.segments) {
        if (!windowBySegment.has(s.id)) windowBySegment.set(s.id, src);
      }
    }
    const wholeTranscript = {
      segments: frozen.segments.map((s) => ({ id: s.id, text: s.text, charStart: s.charStart })),
      windowText: frozen.transcript.text,
      windowCharStart: 0
    };
    for (const claim of listClaims(ctx.db, ctx.sessionId, { status: "candidate" })) {
      const source = windowBySegment.get(claim.segmentId) ?? wholeTranscript;
      const result = validateQuote({ quote: claim.quote, segmentId: claim.segmentId }, source);
      if (result.status === "validated") {
        updateClaimValidation(ctx.db, claim.id, {
          status: "validated",
          charStart: result.charStart,
          charEnd: result.charEnd,
          matchMode: result.matchMode,
          segmentId: result.segmentId
        });
      } else {
        updateClaimValidation(ctx.db, claim.id, {
          status: "quarantined",
          charStart: null,
          charEnd: null,
          matchMode: null,
          segmentId: claim.segmentId
        });
      }
    }
    const counts = countByStatus(ctx.db, ctx.sessionId);
    return {
      ...state,
      validated: counts["validated"] ?? 0,
      quarantined: counts["quarantined"] ?? 0
    };
  }
};
function quarantineRate(state) {
  const total = state.validated + state.quarantined;
  return total === 0 ? 0 : state.quarantined / total;
}
const HEDGE_MARKERS = [
  "probably",
  "possibly",
  "perhaps",
  "maybe",
  "might",
  "may be",
  "could be",
  "would be",
  "could",
  "may",
  "i think",
  "i believe",
  "i assume",
  "i guess",
  "i suppose",
  "i'd say",
  "usually",
  "typically",
  "normally",
  "generally",
  "often",
  "tend to",
  "something like",
  "sort of",
  "kind of",
  "more or less",
  "roughly",
  "approximately",
  "or so",
  "roughly speaking",
  "i imagine",
  "presumably",
  "in principle",
  "off the top of my head",
  "not sure",
  "unsure",
  "don't quote me",
  "as far as i know",
  "in theory",
  "or something",
  "ideally",
  "i'd have to check",
  "if i remember"
];
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const PATTERNS = HEDGE_MARKERS.map((marker) => ({
  marker,
  // Boundary regex: [a-z0-9] treats apostrophes as word boundaries, so "might've" matches "might".
  // This is desirable — it catches real hedged speech in contractions.
  re: new RegExp(`(?<![a-z0-9])${escapeRe(marker)}(?![a-z0-9])`, "g")
}));
function detectHedges(text) {
  const { text: norm } = normalize(text);
  if (norm.length === 0) return [];
  const found = [];
  for (const { marker, re } of PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(norm);
    if (m) found.push({ marker, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.marker);
}
function isHedged(text) {
  return detectHedges(text).length > 0;
}
const CLASSIFY_SYSTEM = `You classify claims taken from a client meeting. Each claim is already anchored to a verbatim quote.

Assign exactly one kind to each claim:

- "requirement": the client stated a need, constraint, rule, or obligation as fact. It is something the system must do or must respect. Example: "anything over ten thousand euro has to go to a manager, no exceptions".

- "assumption": the client offered background, belief, or an expectation, or hedged the statement. Anything with "probably", "usually", "I think", "typically", "might", "something like" is an assumption, not a requirement, no matter how confident the surrounding context sounds. Example: "we'd usually be dealing in euro".

- "ambiguity": the client stated something real but left it underspecified in a way that blocks implementation. Example: "it should be fast", "the usual approvals apply".

The difference between "requirement" and "assumption" is the single most consequential judgement in this system. A hedged statement recorded as a requirement becomes a commitment the client never made. When you are unsure, choose "assumption" — an assumption can be verified with the client later, whereas a wrongly promoted requirement is invisible.`;
function buildClassifyUser(claims, project) {
  const list = claims.map((c) => `claimId: ${c.id}
quote: "${c.quote}"
restatement: ${c.statement}`).join("\n\n");
  return `Project domain: ${project.domain}

Classify each claim below.

${list}`;
}
const ClassificationSchema = v4.z.object({
  classifications: v4.z.array(
    v4.z.object({
      claimId: v4.z.string(),
      kind: v4.z.enum(["requirement", "assumption", "ambiguity"])
    })
  )
});
const BATCH = 40;
const stage3Classify = {
  name: "classify",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");
    const claims = listClaims(ctx.db, ctx.sessionId, { status: "validated" });
    if (claims.length === 0) return state;
    for (let i = 0; i < claims.length; i += BATCH) {
      const batch = claims.slice(i, i + BATCH);
      const result = await callTyped({
        client: ctx.client,
        db: ctx.db,
        sessionId: ctx.sessionId,
        stage: "classify",
        system: CLASSIFY_SYSTEM,
        user: buildClassifyUser(batch, project),
        schema: ClassificationSchema,
        effort: "high"
      });
      const byId = new Map(result.classifications.map((c) => [c.claimId, c.kind]));
      for (const claim of batch) {
        const modelKind = byId.get(claim.id) ?? "ambiguity";
        const kind = isHedged(claim.quote) ? "assumption" : modelKind;
        setClaimKind(ctx.db, claim.id, kind);
      }
    }
    return state;
  }
};
function insertLinks(db, links) {
  const stmt = db.prepare(
    `INSERT INTO claim_links
       (id, project_id, from_claim_id, to_requirement_id, to_claim_id, link_kind, rationale, accepted, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.transaction(() => {
    for (const l of links) {
      stmt.run(
        newId("lnk"),
        l.projectId,
        l.fromClaimId,
        l.toRequirementId,
        l.toClaimId,
        l.linkKind,
        l.rationale,
        l.accepted ? 1 : 0,
        now
      );
    }
  })();
}
const RECONCILE_SYSTEM = `You compare requirement claims from a client meeting against each other and against the project's existing requirements.

Produce two things:

1. "contradictions": pairs of claims from this meeting that cannot both be true of the same system. A contradiction is a genuine conflict about what the system must do — not a difference in wording, not a general statement alongside a more specific one, and not two rules that apply in different circumstances. For each contradiction, write the question you would ask the client to resolve it. Ask about the substance; do not propose an answer and do not indicate which side you believe.

2. "links": relationships between a claim from this meeting and an existing project requirement.
   - "confirms": the claim restates the existing requirement.
   - "refines": the claim adds detail to the existing requirement without changing its meaning.
   - "supersedes": the claim replaces the existing requirement with a different rule.
   - "contradicts": the claim conflicts with the existing requirement.

Be conservative. A missing link costs a reviewer a moment; a wrong link silently rewrites a requirement the client already agreed to. Emit a link only when the relationship is clear from the text.

You are never asked to resolve anything. Resolving a contradiction requires knowing which client statement was correct, and you do not have that information.`;
function buildReconcileUser(claims, existing, project) {
  const claimBlock = claims.map((c) => `claimId: ${c.id}
quote: "${c.quote}"
restatement: ${c.statement}`).join("\n\n");
  const existingBlock = existing.length === 0 ? "(none — this is the first session for this project)" : existing.map((r) => `requirementId: ${r.id}
key: ${r.key}
statement: ${r.statement}`).join("\n\n");
  return `Project domain: ${project.domain}

Requirement claims from this meeting:

${claimBlock}

Existing project requirements:

${existingBlock}`;
}
const ReconcileSchema = v4.z.object({
  contradictions: v4.z.array(
    v4.z.object({
      claimIdA: v4.z.string(),
      claimIdB: v4.z.string(),
      question: v4.z.string()
    })
  ),
  links: v4.z.array(
    v4.z.object({
      claimId: v4.z.string(),
      requirementId: v4.z.string(),
      linkKind: v4.z.enum(["confirms", "refines", "supersedes", "contradicts"]),
      rationale: v4.z.string()
    })
  )
});
const stage4Reconcile = {
  name: "reconcile",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");
    const claims = listClaims(ctx.db, ctx.sessionId, { status: "validated", kind: "requirement" });
    if (claims.length === 0) return state;
    const existing = listRequirements(ctx.db, ctx.projectId);
    const result = await callTyped({
      client: ctx.client,
      db: ctx.db,
      sessionId: ctx.sessionId,
      stage: "reconcile",
      system: RECONCILE_SYSTEM,
      user: buildReconcileUser(claims, existing, project),
      schema: ReconcileSchema,
      effort: "high"
    });
    const known = new Set(claims.map((c) => c.id));
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const questions = [];
    const contradictionLinks = result.contradictions.filter((c) => known.has(c.claimIdA) && known.has(c.claimIdB)).map((c) => {
      questions.push({
        id: newId("oqn"),
        projectId: ctx.projectId,
        key: nextKey(ctx.db, ctx.projectId, "open_questions", "OQ"),
        text: c.question,
        category: "domain",
        raisedBySessionId: ctx.sessionId,
        status: "open",
        answerText: null,
        answeredBySessionId: null,
        createdAt: now
      });
      insertQuestions(ctx.db, [questions[questions.length - 1]]);
      return {
        projectId: ctx.projectId,
        fromClaimId: c.claimIdA,
        toRequirementId: null,
        toClaimId: c.claimIdB,
        linkKind: "contradicts",
        rationale: c.question,
        accepted: false
      };
    });
    const existingIds = new Set(existing.map((r) => r.id));
    const crossLinks = result.links.filter((l) => known.has(l.claimId) && existingIds.has(l.requirementId)).map((l) => ({
      projectId: ctx.projectId,
      fromClaimId: l.claimId,
      toRequirementId: l.requirementId,
      toClaimId: null,
      linkKind: l.linkKind,
      rationale: l.rationale,
      accepted: false
      // proposed, never auto-applied
    }));
    insertLinks(ctx.db, [...contradictionLinks, ...crossLinks]);
    return { ...state, questions: state.questions + questions.length };
  }
};
const REQUIREMENTS_SYSTEM = `You turn confirmed claims from a client meeting into testable requirement statements.

For each requirement you emit:
- "statement": one requirement, phrased so that a tester could determine whether the system satisfies it. Use precise language: name the actor, the trigger, and the obligation. Prefer "must" over "should" when the client stated an obligation.
- "originClaimIds": the ids of every claim this requirement is derived from. This list must not be empty.

Rules:

1. Every requirement must cite at least one claim id from the list you were given. A requirement with no citation, or one citing an id that is not in the list, will be discarded automatically.
2. Do not add requirements that seem obviously necessary but were not stated. If the client discussed invoice approval and never mentioned audit logging, there is no audit logging requirement — a later stage will raise that as a question to ask them.
3. Do not merge claims that are about different rules. Do merge claims that restate the same rule.
4. Do not soften or generalize. If the client said "ten thousand euro", the requirement says ten thousand euro, not "a configurable threshold".
5. Say nothing about implementation. Requirements describe what must be true, not how to build it.`;
function buildRequirementsUser(claims, project) {
  const list = claims.map((c) => `claimId: ${c.id}
quote: "${c.quote}"
restatement: ${c.statement}`).join("\n\n");
  return `Project domain: ${project.domain}

Confirmed requirement claims:

${list}`;
}
const RequirementDraftsSchema = v4.z.object({
  requirements: v4.z.array(
    v4.z.object({
      statement: v4.z.string(),
      originClaimIds: v4.z.array(v4.z.string())
    })
  )
});
const stage5Requirements = {
  name: "requirements",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");
    const claims = listClaims(ctx.db, ctx.sessionId, { status: "validated", kind: "requirement" });
    if (claims.length === 0) return state;
    const result = await callTyped({
      client: ctx.client,
      db: ctx.db,
      sessionId: ctx.sessionId,
      stage: "requirements",
      system: REQUIREMENTS_SYSTEM,
      user: buildRequirementsUser(claims, project),
      schema: RequirementDraftsSchema,
      effort: "high"
    });
    const known = new Set(claims.map((c) => c.id));
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const toInsert = [];
    for (const draft of result.requirements) {
      const cited = draft.originClaimIds.filter((id) => known.has(id));
      if (cited.length === 0) continue;
      const req = {
        id: newId("req"),
        projectId: ctx.projectId,
        key: nextKey(ctx.db, ctx.projectId, "requirements", "REQ"),
        statement: draft.statement,
        status: "proposed",
        origin: "client-stated",
        originClaimIds: cited,
        supersedesId: null,
        createdAt: now
      };
      insertRequirements(ctx.db, [req]);
      toInsert.push(req);
    }
    return { ...state, requirements: state.requirements + toInsert.length };
  }
};
const STORIES_SYSTEM = `You group confirmed requirements into user stories with acceptance criteria.

For each story emit "asA", "iWant", "soThat", the "requirementIds" it implements, and its "acceptanceCriteria".

Each acceptance criterion has:
- "gherkin": one criterion in Given/When/Then form.
- "source": either "client-stated" or "derived".
- "question": a question to put to the client, or null.

The source field is the most important thing you produce here.

Mark a criterion "client-stated" only when it is traceable to what the requirement's own claims actually say. If the client said invoices over ten thousand go to a manager, then "Given an invoice of EUR 10,001, when submitted, then it is routed to the manager queue" is client-stated.

Mark a criterion "derived" when you added it for completeness. You are allowed and encouraged to add derived criteria — an incomplete story is not useful. But whenever a derived criterion encodes a decision the client never made (a number, a timeout, a threshold, a default, an ordering, an error behaviour), you must also write the "question" that asks them to confirm it. State plainly in the question that the value was not stated by the client.

A derived criterion that silently invents a retention period, an escalation window, or a page size, with no question attached, is the specific failure this system exists to prevent.

Do not invent requirements. Work only from the requirements given to you. If a story would need a requirement that does not exist, write the acceptance criterion as derived and ask about it instead.`;
function buildStoriesUser(requirements, project) {
  const list = requirements.map((r) => `requirementId: ${r.id}
key: ${r.key}
statement: ${r.statement}`).join("\n\n");
  return `Project domain: ${project.domain}

Confirmed requirements:

${list}`;
}
const StoryDraftsSchema = v4.z.object({
  stories: v4.z.array(
    v4.z.object({
      asA: v4.z.string(),
      iWant: v4.z.string(),
      soThat: v4.z.string(),
      requirementIds: v4.z.array(v4.z.string()),
      acceptanceCriteria: v4.z.array(
        v4.z.object({
          gherkin: v4.z.string(),
          source: v4.z.enum(["client-stated", "derived"]),
          question: v4.z.string().nullable()
        })
      )
    })
  )
});
const stage6Stories = {
  name: "stories",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");
    const requirements = listRequirements(ctx.db, ctx.projectId, { status: "proposed" });
    if (requirements.length === 0) return state;
    const result = await callTyped({
      client: ctx.client,
      db: ctx.db,
      sessionId: ctx.sessionId,
      stage: "stories",
      system: STORIES_SYSTEM,
      user: buildStoriesUser(requirements, project),
      schema: StoryDraftsSchema,
      effort: "high"
    });
    const known = new Set(requirements.map((r) => r.id));
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let stories = 0;
    let questions = 0;
    for (const draft of result.stories) {
      const cited = draft.requirementIds.filter((id) => known.has(id));
      if (cited.length === 0) continue;
      const storyId = newId("sty");
      const criteria = [];
      draft.acceptanceCriteria.forEach((ac, idx) => {
        let linkedQuestionId = null;
        if (ac.source === "derived" && ac.question && ac.question.trim().length > 0) {
          const q = {
            id: newId("oqn"),
            projectId: ctx.projectId,
            key: nextKey(ctx.db, ctx.projectId, "open_questions", "OQ"),
            text: ac.question,
            category: "domain",
            raisedBySessionId: ctx.sessionId,
            status: "open",
            answerText: null,
            answeredBySessionId: null,
            createdAt: now
          };
          insertQuestions(ctx.db, [q]);
          linkedQuestionId = q.id;
          questions++;
        }
        criteria.push({
          id: newId("acr"),
          storyId,
          idx,
          gherkin: ac.gherkin,
          source: ac.source,
          linkedQuestionId
        });
      });
      const story = {
        id: storyId,
        projectId: ctx.projectId,
        key: nextKey(ctx.db, ctx.projectId, "stories", "US"),
        asA: draft.asA,
        iWant: draft.iWant,
        soThat: draft.soThat,
        requirementIds: cited,
        createdAt: now
      };
      insertStory(ctx.db, story, criteria);
      stories++;
    }
    return {
      ...state,
      stories: state.stories + stories,
      questions: state.questions + questions
    };
  }
};
const SHARED_PREAMBLE = `You are reviewing a draft set of requirements and user stories produced from a client meeting.

Your output is limited to two kinds of finding:
- "questions": things to ask the client, because the answer is not in the material and you must not decide it for them.
- "recommendations": things you believe the team should do, with your reasoning.

You cannot author a requirement. There is no place in your response to put one, and that is deliberate: a requirement records what the client said, and you were not in the room. If you notice something the system clearly needs but the client never mentioned, that is a question or a recommendation — never a requirement.

Be specific. "Consider security" is not a finding. "Approval actions have no stated audit mechanism, so a disputed approval could not be reconstructed" is a finding.`;
const REVIEWERS = [
  {
    name: "domain",
    system: () => `${SHARED_PREAMBLE}

You are reviewing for domain completeness. Look for:
- entities, roles, and actors that are referenced but never defined
- lifecycle states that have no transition into or out of them
- volumes, frequencies, and scale that were never established
- integrations and upstream/downstream systems that are implied but unspecified
- failure paths: what happens when the happy path does not happen

Use the project's stated domain to judge what is missing. Do not import assumptions from a different domain.`
  },
  {
    name: "security-privacy",
    system: () => `${SHARED_PREAMBLE}

You are reviewing for security and privacy. Look for:
- authentication and authorization: who may perform each action, and how that is established
- classes of personal or sensitive data being handled, and whether their handling was discussed
- retention and deletion: how long data is kept, and what deletes it
- encryption in transit and at rest, where the material implies sensitive data
- audit trail: whether consequential actions can be reconstructed afterwards
- data residency, where the domain suggests it matters

Frame each as a question to the client or a recommendation to the team.`
  },
  {
    name: "compliance",
    system: (ctx) => {
      if (ctx.regulatoryContext === "none") {
        return `${SHARED_PREAMBLE}

You are reviewing for compliance. No regulatory context has been set for this project.

Because of that, ask only generic data-protection questions that would apply to any system handling business or personal data, and stop there. Do not infer a jurisdiction, do not name a regulation, and do not cite specific articles or clauses. If you believe a regulation probably applies, the correct output is a question asking which regulatory regimes govern this project — not an assumption about which one does.`;
      }
      return `${SHARED_PREAMBLE}

You are reviewing for compliance under ${ctx.regulatoryContext}, which the project has declared as its regulatory context.

Identify obligations under ${ctx.regulatoryContext} that the current requirements do not address, and raise each as a question or a recommendation. Do not extend your review to regulations other than ${ctx.regulatoryContext} unless the material explicitly references them.`;
    }
  },
  {
    name: "testability",
    system: () => `${SHARED_PREAMBLE}

You are reviewing for testability and edge cases. Look for:
- acceptance criteria that cannot be evaluated as pass or fail ("fast", "user-friendly", "reliable")
- inputs with no stated bounds: length, size, count, range, character set
- empty, single-item, and maximum-size cases
- concurrency: two actors doing the same thing at once
- ordering and idempotency: what happens if an action is repeated
- error handling: what the system does when a dependency is unavailable

Prefer findings that would change how someone writes a test.`
  }
];
function buildCritiqueUser(project, requirements, stories) {
  const reqBlock = requirements.map((r) => `${r.key}: ${r.statement}`).join("\n");
  const storyBlock = stories.map(({ story, criteria }) => {
    const acs = criteria.map((c) => `    - [${c.source}] ${c.gherkin}`).join("\n");
    return `${story.key}: As a ${story.asA}, I want ${story.iWant}, so that ${story.soThat}
${acs}`;
  }).join("\n\n");
  return `Project domain: ${project.domain}
Regulatory context: ${project.regulatoryContext}

Requirements:
${reqBlock || "(none)"}

Stories:
${storyBlock || "(none)"}`;
}
const Category = v4.z.enum(["domain", "security", "privacy", "compliance", "edge-case", "testability"]);
const CritiqueFindingsSchema = v4.z.object({
  questions: v4.z.array(v4.z.object({ text: v4.z.string(), category: Category })),
  recommendations: v4.z.array(
    v4.z.object({ text: v4.z.string(), rationale: v4.z.string(), category: Category })
  )
});
const stage7Critique = {
  name: "critique",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");
    const requirements = listRequirements(ctx.db, ctx.projectId, { status: "proposed" });
    if (requirements.length === 0) return state;
    const stories = listStories(ctx.db, ctx.projectId);
    const user = buildCritiqueUser(project, requirements, stories);
    const results = await Promise.all(
      REVIEWERS.map(
        (reviewer) => callTyped({
          client: ctx.client,
          db: ctx.db,
          sessionId: ctx.sessionId,
          stage: `critique:${reviewer.name}`,
          system: reviewer.system({ regulatoryContext: project.regulatoryContext }),
          user,
          schema: CritiqueFindingsSchema,
          effort: "high"
        })
      )
    );
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let questions = 0;
    let recommendations = 0;
    for (const result of results) {
      for (const q of result.questions) {
        const question = {
          id: newId("oqn"),
          projectId: ctx.projectId,
          key: nextKey(ctx.db, ctx.projectId, "open_questions", "OQ"),
          text: q.text,
          category: q.category,
          raisedBySessionId: ctx.sessionId,
          status: "open",
          answerText: null,
          answeredBySessionId: null,
          createdAt: now
        };
        insertQuestions(ctx.db, [question]);
        questions++;
      }
      for (const r of result.recommendations) {
        const rec = {
          id: newId("rec"),
          projectId: ctx.projectId,
          key: nextKey(ctx.db, ctx.projectId, "recommendations", "REC"),
          text: r.text,
          rationale: r.rationale,
          category: r.category,
          raisedBySessionId: ctx.sessionId,
          status: "open",
          dispositionNote: null,
          createdAt: now
        };
        insertRecommendations(ctx.db, [rec]);
        recommendations++;
      }
    }
    return {
      ...state,
      questions: state.questions + questions,
      recommendations: state.recommendations + recommendations
    };
  }
};
const stage8Assemble = {
  name: "assemble",
  async run(ctx, state) {
    setSessionStatus(ctx.db, ctx.sessionId, "awaiting-review");
    return state;
  }
};
const ALL_STAGES = [
  stage0Chunk,
  stage1Extract,
  stage2Validate,
  stage3Classify,
  stage4Reconcile,
  stage5Requirements,
  stage6Stories,
  stage7Critique,
  stage8Assemble
];
async function analyzeSession(ctx, transcriptId, opts) {
  setSessionStatus(ctx.db, ctx.sessionId, "analyzing");
  const out = await runPipeline(ctx, ALL_STAGES, { transcriptId }, opts);
  return out;
}
const ENGINE_VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = "1.0.0";
function buildSnapshot(db, projectId, opts) {
  const project = getProject(db, projectId);
  if (!project) throw new Error("project not found");
  const sessions = listSessions(db, projectId);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const claims = listProjectClaims(db, projectId);
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const segmentStartMs = /* @__PURE__ */ new Map();
  const provenanceSessions = [];
  let egress = { requests: 0, promptTokens: 0, completionTokens: 0 };
  for (const s of sessions) {
    const frozen = getFrozenTranscript(db, s.id);
    if (frozen) {
      for (const seg of frozen.segments) segmentStartMs.set(seg.id, seg.startMs);
      provenanceSessions.push({
        title: s.title,
        occurredAt: s.occurredAt,
        transcriptHash: frozen.transcript.contentHash,
        wordCount: (frozen.transcript.text.match(/\S+/g) ?? []).length
      });
    }
    const e = egressSummary(db, s.id);
    egress = {
      requests: egress.requests + e.requests,
      promptTokens: egress.promptTokens + e.promptTokens,
      completionTokens: egress.completionTokens + e.completionTokens
    };
  }
  const evidenceFor = (claimIds) => claimIds.flatMap((id) => {
    const claim = claimById.get(id);
    if (!claim) return [];
    const session = sessionById.get(claim.sessionId);
    return [{
      quote: claim.quote,
      sessionTitle: session?.title ?? "(unknown session)",
      occurredAt: session?.occurredAt ?? "",
      startMs: segmentStartMs.get(claim.segmentId) ?? null,
      matchMode: claim.matchMode
    }];
  });
  const questions = listQuestions(db, projectId);
  const questionKeyById = new Map(questions.map((q) => [q.id, q.key]));
  const requirementKeyById = new Map(
    listRequirements(db, projectId).map((r) => [r.id, r.key])
  );
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    project: {
      name: project.name,
      domain: project.domain,
      regulatoryContext: project.regulatoryContext
    },
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    // The baseline is what the BA has approved. `includeProposed` additionally
    // surfaces un-approved drafts (clearly labelled by their `status`) so the
    // engine's output can be evaluated before any review UI exists.
    requirements: listRequirements(db, projectId).filter(
      (r) => r.status === "finalized" || opts?.includeProposed === true && r.status === "proposed"
    ).map((r) => ({
      key: r.key,
      statement: r.statement,
      status: r.status,
      origin: r.origin,
      evidence: evidenceFor(r.originClaimIds)
    })),
    stories: listStories(db, projectId).map(({ story, criteria }) => ({
      key: story.key,
      asA: story.asA,
      iWant: story.iWant,
      soThat: story.soThat,
      implements: story.requirementIds.map((id) => requirementKeyById.get(id) ?? id),
      acceptanceCriteria: criteria.map((c) => ({
        gherkin: c.gherkin,
        source: c.source,
        linkedQuestionKey: c.linkedQuestionId ? questionKeyById.get(c.linkedQuestionId) ?? null : null
      }))
    })),
    assumptions: claims.filter((c) => c.status === "validated" && c.kind === "assumption").map((c) => ({
      quote: c.quote,
      statement: c.statement,
      sessionTitle: sessionById.get(c.sessionId)?.title ?? "(unknown session)",
      occurredAt: sessionById.get(c.sessionId)?.occurredAt ?? ""
    })),
    openQuestions: questions.map((q) => ({
      key: q.key,
      text: q.text,
      category: q.category,
      status: q.status,
      raisedIn: sessionById.get(q.raisedBySessionId)?.title ?? "(unknown session)",
      answerText: q.answerText
    })),
    recommendations: listRecommendations(db, projectId).map((r) => ({
      key: r.key,
      text: r.text,
      rationale: r.rationale,
      category: r.category,
      status: r.status
    })),
    quarantined: claims.filter((c) => c.status === "quarantined").map((c) => ({
      quote: c.quote,
      statement: c.statement,
      sessionTitle: sessionById.get(c.sessionId)?.title ?? "(unknown session)"
    })),
    provenance: {
      engineVersion: ENGINE_VERSION,
      llmModel: MODEL,
      sessions: provenanceSessions,
      egress
    }
  };
}
function formatTimestamp(ms) {
  if (ms === null) return "—";
  const total = Math.floor(ms / 1e3);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
function shortDate(iso) {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}
const markdownPublisher = {
  name: "markdown",
  publish(s) {
    const out = [];
    out.push(`# ${s.project.name} — Requirements Baseline`);
    const sessionList = s.provenance.sessions.map((x) => x.title).join(", ") || "(no sessions)";
    out.push(
      `Sessions: ${sessionList} · Generated ${shortDate(s.generatedAt)} · Regulatory context: ${s.project.regulatoryContext}`
    );
    const hashes = s.provenance.sessions.map((x) => x.transcriptHash.slice(0, 8)).join(", ");
    out.push(`Transcript hashes: ${hashes || "—"} · Model: ${s.provenance.llmModel}`);
    out.push("");
    out.push("## 1. Confirmed Requirements");
    out.push("");
    if (s.requirements.length === 0) {
      out.push("_No confirmed requirements. Nothing here has been approved yet._");
      out.push("");
    }
    for (const r of s.requirements) {
      const pending = r.status !== "finalized" ? " `[NOT YET APPROVED]`" : "";
      out.push(`### ${r.key} — ${r.statement}${pending}`);
      out.push(`**Status:** ${r.status} · **Origin:** ${r.origin}`);
      for (const e2 of r.evidence) {
        out.push(
          `**Source:** ${e2.sessionTitle} @ ${formatTimestamp(e2.startMs)} — *"${e2.quote}"*` + (e2.matchMode === "fuzzy" ? " _(matched with disfluencies removed)_" : "")
        );
      }
      out.push("");
    }
    out.push("## 2. User Stories");
    out.push("");
    if (s.stories.length === 0) {
      out.push("_No user stories yet._");
      out.push("");
    }
    for (const st of s.stories) {
      out.push(`### ${st.key} — ${st.iWant}`);
      out.push(`As a ${st.asA}, I want ${st.iWant}, so that ${st.soThat}.`);
      out.push(`**Implements:** ${st.implements.join(", ") || "—"}`);
      out.push("");
      out.push("Acceptance criteria:");
      for (const ac of st.acceptanceCriteria) {
        if (ac.source === "client-stated") {
          out.push(`- \`[client-stated]\` ${ac.gherkin}`);
        } else {
          const link = ac.linkedQuestionKey ? ` → see **${ac.linkedQuestionKey}**` : "";
          out.push(`- \`[DERIVED — UNCONFIRMED]\` ${ac.gherkin}${link}`);
        }
      }
      out.push("");
    }
    out.push("## 3. Assumptions — NOT client-confirmed");
    out.push("");
    if (s.assumptions.length === 0) {
      out.push("_No assumptions recorded._");
      out.push("");
    }
    s.assumptions.forEach((a, i) => {
      out.push(`### ASM-${String(i + 1).padStart(3, "0")} — ${a.statement}`);
      out.push(`**Basis:** ${a.sessionTitle} — *"${a.quote}"* (hedged)`);
      out.push("**Verification:** none recorded");
      out.push("");
    });
    out.push("## 4. Open Questions");
    out.push("");
    if (s.openQuestions.length === 0) {
      out.push("_No open questions._");
    } else {
      out.push("| ID | Question | Category | Raised | Status |");
      out.push("|----|----------|----------|--------|--------|");
      for (const q of s.openQuestions) {
        const text = q.text.replace(/\|/g, "\\|");
        out.push(`| ${q.key} | ${text} | ${q.category} | ${q.raisedIn} | ${q.status} |`);
      }
    }
    out.push("");
    out.push("## 5. Recommendations — tool-generated, not client requirements");
    out.push("");
    if (s.recommendations.length === 0) {
      out.push("_No recommendations._");
      out.push("");
    }
    for (const r of s.recommendations) {
      out.push(`### ${r.key} \`[${r.category}]\` ${r.text}`);
      out.push(`**Rationale:** ${r.rationale}`);
      out.push(`**Status:** ${r.status}`);
      out.push("");
    }
    out.push(`## Appendix A — Quarantined extractions (n=${s.quarantined.length})`);
    out.push("");
    out.push(
      "Statements produced during analysis that could not be matched to any transcript text. Excluded from every section above. Listed for transparency."
    );
    out.push("");
    for (const q of s.quarantined) {
      out.push(`- ${q.sessionTitle}: *"${q.quote}"*`);
    }
    if (s.quarantined.length > 0) out.push("");
    out.push("## Appendix B — Provenance");
    out.push("");
    out.push(`**Engine version:** ${s.provenance.engineVersion}`);
    out.push(`**LLM model:** ${s.provenance.llmModel}`);
    out.push("");
    if (s.provenance.sessions.length > 0) {
      out.push("| Session | Date | Words | Transcript SHA-256 |");
      out.push("|---------|------|-------|--------------------|");
      for (const x of s.provenance.sessions) {
        out.push(`| ${x.title} | ${shortDate(x.occurredAt)} | ${x.wordCount} | \`${x.transcriptHash}\` |`);
      }
      out.push("");
    }
    const e = s.provenance.egress;
    out.push(
      `**Egress:** ${e.requests} requests, ${e.promptTokens.toLocaleString("en-US")} prompt tokens sent, ${e.completionTokens.toLocaleString("en-US")} completion tokens received.`
    );
    out.push("");
    out.push("_Audio never left this machine. Only the frozen transcript text above was sent._");
    out.push("");
    return out.join("\n");
  }
};
const jsonPublisher = {
  name: "json",
  publish(snapshot) {
    return JSON.stringify(
      {
        $schema: `https://ba-story-agent.local/schemas/export-${SNAPSHOT_SCHEMA_VERSION}.json`,
        ...snapshot
      },
      null,
      2
    );
  }
};
let _db = null;
function getDb() {
  if (!_db) {
    const userData = electron.app.getPath("userData");
    _db = openDb(path.join(userData, "ba-story-agent.db"));
  }
  return _db;
}
function setupIpc() {
  electron.ipcMain.handle("project:list", async () => {
    const db = getDb();
    return db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
  });
  electron.ipcMain.handle("project:create", async (_event, data) => {
    const db = getDb();
    return createProject(db, {
      name: data.name,
      domain: data.domain,
      regulatoryContext: data.regulatory ? RegulatoryContext.parse(data.regulatory) : "none",
      systemName: data.systemName ?? null
    });
  });
  electron.ipcMain.handle("project:get", async (_event, id) => {
    const db = getDb();
    return getProject(db, id);
  });
  electron.ipcMain.handle("session:list", async (_event, projectId) => {
    const db = getDb();
    return listSessions(db, projectId);
  });
  electron.ipcMain.handle("session:add", async (_event, data) => {
    const db = getDb();
    const words = countWords(data.transcriptText);
    if (words < MIN_WORDS) {
      throw new Error(
        `Transcript is ${words} words; at least ${MIN_WORDS} required.`
      );
    }
    const session = createSession(db, {
      projectId: data.projectId,
      title: data.title,
      ...data.occurredAt ? { occurredAt: data.occurredAt } : {}
    });
    const { transcript } = createTranscript(db, {
      sessionId: session.id,
      text: data.transcriptText
    });
    freezeTranscript(db, transcript.id);
    return session;
  });
  electron.ipcMain.handle("session:analyze", async (event, data) => {
    const db = getDb();
    const frozen = getFrozenTranscript(db, data.sessionId);
    if (!frozen) throw new Error(`Session ${data.sessionId} has no frozen transcript`);
    const row = db.prepare("SELECT project_id FROM sessions WHERE id = ?").get(data.sessionId);
    if (!row) throw new Error(`Session ${data.sessionId} not found`);
    const state = await analyzeSession(
      {
        db,
        client: new AnthropicBackend(createClient()),
        projectId: row.project_id,
        sessionId: data.sessionId
      },
      frozen.transcript.id,
      {
        resume: data.resume ?? false,
        onProgress: (name, status) => {
          event.sender.send("analyze:progress", { stage: name, status });
        }
      }
    );
    return {
      ...state,
      quarantineRate: quarantineRate(state)
    };
  });
  electron.ipcMain.handle("requirement:list", async (_event, projectId) => {
    const db = getDb();
    return listRequirements(db, projectId);
  });
  electron.ipcMain.handle("requirement:approve", async (_event, data) => {
    const db = getDb();
    const reqs = listRequirements(db, data.projectId);
    const req = reqs.find((r) => r.id === data.requirementId);
    if (!req) throw new Error(`Requirement ${data.requirementId} not found`);
    recordApproval(db, {
      entityType: "requirement",
      entityId: req.id,
      action: "approve",
      actorNote: data.note ?? null,
      contentHash: hashText(req.statement)
    });
    setRequirementStatus(db, req.id, "finalized");
    return req;
  });
  electron.ipcMain.handle("requirement:reject", async (_event, data) => {
    const db = getDb();
    const reqs = listRequirements(db, data.projectId);
    const req = reqs.find((r) => r.id === data.requirementId);
    if (!req) throw new Error(`Requirement ${data.requirementId} not found`);
    recordApproval(db, {
      entityType: "requirement",
      entityId: req.id,
      action: "reject",
      actorNote: data.reason,
      contentHash: hashText(req.statement)
    });
    setRequirementStatus(db, req.id, "rejected");
    return req;
  });
  electron.ipcMain.handle("assumption:list", async (_event, projectId) => {
    const db = getDb();
    const sessions = listSessions(db, projectId);
    const allAssumptions = sessions.flatMap(
      (s) => listClaims(db, s.id).filter((c) => c.kind === "assumption")
    );
    return allAssumptions;
  });
  electron.ipcMain.handle("assumption:promote", async (_event, data) => {
    const db = getDb();
    recordApproval(db, {
      entityType: "claim",
      entityId: data.claimId,
      action: "promote-assumption",
      actorNote: data.verificationNote,
      contentHash: hashText(data.verificationNote)
    });
    return { promoted: true };
  });
  electron.ipcMain.handle("question:list", async (_event, projectId) => {
    const db = getDb();
    return listQuestions(db, projectId);
  });
  electron.ipcMain.handle("question:update-status", async (_event, data) => {
    const db = getDb();
    db.prepare("UPDATE open_questions SET status = ? WHERE id = ?").run(data.status, data.questionId);
    return { updated: true };
  });
  electron.ipcMain.handle("recommendation:list", async (_event, projectId) => {
    const db = getDb();
    return listRecommendations(db, projectId);
  });
  electron.ipcMain.handle("recommendation:accept", async (_event, data) => {
    const db = getDb();
    const status = data.asRequirement ? "accepted-as-req" : "accepted";
    db.prepare("UPDATE recommendations SET status = ?, disposition_note = ? WHERE id = ?").run(status, data.baStatement ?? null, data.recommendationId);
    return { accepted: true };
  });
  electron.ipcMain.handle("recommendation:decline", async (_event, data) => {
    const db = getDb();
    db.prepare("UPDATE recommendations SET status = ?, disposition_note = ? WHERE id = ?").run("declined", data.reason, data.recommendationId);
    return { declined: true };
  });
  electron.ipcMain.handle("claim:get", async (_event, claimId) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM claims WHERE id = ?").get(claimId);
    if (!row) return null;
    const transcript = row.transcript_id ? db.prepare("SELECT text, content_hash FROM transcripts WHERE id = ?").get(row.transcript_id) : null;
    return {
      id: row.id,
      quote: row.quote,
      statement: row.statement,
      kind: row.kind,
      status: row.status,
      speakerRole: row.speaker_role,
      charStart: row.char_start,
      charEnd: row.char_end,
      // Extract surrounding context (200 chars around the quote)
      context: transcript && typeof row.char_start === "number" ? transcript.text.slice(
        Math.max(0, row.char_start - 150),
        Math.min(transcript.text.length, row.char_end + 150)
      ) : null
    };
  });
  electron.ipcMain.handle("story:list", async (_event, projectId) => {
    const db = getDb();
    return listStories(db, projectId);
  });
  electron.ipcMain.handle("export:project", async (_event, data) => {
    const db = getDb();
    const snapshot = buildSnapshot(db, data.projectId, {
      includeProposed: data.includeProposed ?? false
    });
    node_fs.mkdirSync(data.outDir, { recursive: true });
    const mdPath = path.join(data.outDir, "requirements.md");
    const jsonPath = path.join(data.outDir, "requirements.json");
    node_fs.writeFileSync(mdPath, markdownPublisher.publish(snapshot), "utf8");
    node_fs.writeFileSync(jsonPath, jsonPublisher.publish(snapshot), "utf8");
    return { mdPath, jsonPath };
  });
  electron.ipcMain.handle("project:status", async (_event, projectId) => {
    const db = getDb();
    const project = getProject(db, projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    const sessions = listSessions(db, projectId);
    const requirements = listRequirements(db, projectId);
    const stories = listStories(db, projectId);
    const questions = listQuestions(db, projectId);
    const recommendations = listRecommendations(db, projectId);
    const sessionDetails = sessions.map((s) => ({
      ...s,
      claimCounts: countByStatus(db, s.id)
    }));
    return {
      project,
      sessions: sessionDetails,
      requirementCount: requirements.length,
      finalizedCount: requirements.filter((r) => r.status === "finalized").length,
      storyCount: stories.length,
      openQuestionCount: questions.filter((q) => q.status === "open").length,
      recommendationCount: recommendations.length
    };
  });
}
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#f8f9fa",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId("com.electron");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  setupIpc();
  createWindow();
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
