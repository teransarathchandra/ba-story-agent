CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  regulatory_context TEXT NOT NULL DEFAULT 'none',
  system_name TEXT,
  glossary TEXT,
  created_at TEXT NOT NULL
);

-- Small, app-owned markers for one-time setup such as the bundled demo workspace.
-- Keeping the marker outside the demo project means deleting the demo is permanent.
CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  frozen_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, version)
);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY NOT NULL,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  start_ms INTEGER,
  end_ms INTEGER,
  speaker_label TEXT,
  text TEXT NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  UNIQUE (transcript_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_segments_transcript ON segments(transcript_id);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  quote TEXT NOT NULL,
  statement TEXT NOT NULL,
  speaker_role TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  char_start INTEGER,
  char_end INTEGER,
  match_mode TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_session ON claims(session_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(session_id, status);

CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL,
  origin TEXT NOT NULL,
  origin_claim_ids TEXT NOT NULL,
  supersedes_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, key)
);
CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id);

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  as_a TEXT NOT NULL,
  i_want TEXT NOT NULL,
  so_that TEXT NOT NULL,
  requirement_ids TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS acceptance_criteria (
  id TEXT PRIMARY KEY NOT NULL,
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  gherkin TEXT NOT NULL,
  source TEXT NOT NULL,
  linked_question_id TEXT,
  UNIQUE (story_id, idx)
);

CREATE TABLE IF NOT EXISTS open_questions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  text TEXT NOT NULL,
  category TEXT NOT NULL,
  raised_by_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  answer_text TEXT,
  answered_by_session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  text TEXT NOT NULL,
  rationale TEXT NOT NULL,
  category TEXT NOT NULL,
  raised_by_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  disposition_note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS claim_links (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  to_requirement_id TEXT REFERENCES requirements(id) ON DELETE CASCADE,
  to_claim_id TEXT REFERENCES claims(id) ON DELETE CASCADE,
  link_kind TEXT NOT NULL,
  rationale TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- approval_events is an append-only audit record of BA approvals and denials.
-- Intentionally NOT foreign-key-bound to sessions — if a session is deleted,
-- the approval audit trail must remain as evidence of what was approved and when.
-- Deleting a session cannot erase the record of what a Business Analyst authorized.
CREATE TABLE IF NOT EXISTS approval_events (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_note TEXT,
  content_hash TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_entity ON approval_events(entity_type, entity_id);

-- egress_log records exactly what text was sent to the Anthropic API for this session.
-- Intentionally NOT foreign-key-bound to sessions — if a session is deleted,
-- the egress log must remain as the authoritative record of what left this machine.
-- This artifact is the compliance promise to the client; deleting a session cannot erase it.
CREATE TABLE IF NOT EXISTS egress_log (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  model TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_egress_session ON egress_log(session_id);

CREATE TABLE IF NOT EXISTS stage_checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT,
  error_text TEXT,
  raw_response TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (session_id, stage)
);
