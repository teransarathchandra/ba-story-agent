import { describe, it, expect, afterEach } from "vitest";
import { openDb, closeDb } from "../../src/store/db.js";
import { mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("openDb", () => {
  let tempDbPath: string | null = null;

  afterEach(() => {
    if (tempDbPath) {
      try {
        unlinkSync(tempDbPath);
        unlinkSync(`${tempDbPath}-wal`);
        unlinkSync(`${tempDbPath}-shm`);
      } catch {
        // cleanup best-effort
      }
      tempDbPath = null;
    }
  });

  it("creates all tables", () => {
    const db = openDb(":memory:");
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const t of [
      "projects", "sessions", "transcripts", "segments", "claims",
      "requirements", "stories", "acceptance_criteria",
      "open_questions", "recommendations",
      "approval_events", "egress_log", "stage_checkpoints", "claim_links",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("enforces foreign keys", () => {
    const db = openDb(":memory:");
    expect(() =>
      db.prepare(
        "INSERT INTO sessions (id, project_id, title, occurred_at, status, created_at) VALUES (?,?,?,?,?,?)",
      ).run("ses_x", "prj_missing", "t", "2026-08-05T00:00:00.000Z", "draft", "2026-08-05T00:00:00.000Z"),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("rejects NULL id in any table", () => {
    const db = openDb(":memory:");
    expect(() =>
      db.prepare("INSERT INTO projects (id, name, domain, created_at) VALUES (?,?,?,?)")
        .run(null, "test", "test.com", "2026-08-05T00:00:00.000Z"),
    ).toThrow(/NOT NULL/i);
  });

  it("enforces segment_id foreign key in claims", () => {
    const db = openDb(":memory:");
    // Create project and session for FK chain
    db.prepare("INSERT INTO projects (id, name, domain, created_at) VALUES (?,?,?,?)")
      .run("prj_1", "test", "test.com", "2026-08-05T00:00:00.000Z");
    db.prepare("INSERT INTO sessions (id, project_id, title, occurred_at, status, created_at) VALUES (?,?,?,?,?,?)")
      .run("ses_1", "prj_1", "t", "2026-08-05T00:00:00.000Z", "draft", "2026-08-05T00:00:00.000Z");
    db.prepare("INSERT INTO transcripts (id, session_id, version, text, content_hash, created_at) VALUES (?,?,?,?,?,?)")
      .run("trn_1", "ses_1", 1, "text", "hash", "2026-08-05T00:00:00.000Z");
    db.prepare("INSERT INTO segments (id, transcript_id, idx, text, char_start, char_end) VALUES (?,?,?,?,?,?)")
      .run("seg_1", "trn_1", 0, "seg text", 0, 5);

    // Now try to insert claim with missing segment_id FK
    expect(() =>
      db.prepare(
        "INSERT INTO claims (id, session_id, transcript_id, segment_id, quote, statement, speaker_role, kind, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run("clm_1", "ses_1", "trn_1", "seg_missing", "quote", "stmt", "role", "k", "new", "2026-08-05T00:00:00.000Z"),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("enforces raised_by_session_id foreign key in open_questions", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO projects (id, name, domain, created_at) VALUES (?,?,?,?)")
      .run("prj_1", "test", "test.com", "2026-08-05T00:00:00.000Z");

    // Try to insert open_question with missing raised_by_session_id FK
    expect(() =>
      db.prepare(
        "INSERT INTO open_questions (id, project_id, key, text, category, raised_by_session_id, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run("oq_1", "prj_1", "q1", "text", "cat", "ses_missing", "open", "2026-08-05T00:00:00.000Z"),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("allows nullable answered_by_session_id in open_questions", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO projects (id, name, domain, created_at) VALUES (?,?,?,?)")
      .run("prj_1", "test", "test.com", "2026-08-05T00:00:00.000Z");
    db.prepare("INSERT INTO sessions (id, project_id, title, occurred_at, status, created_at) VALUES (?,?,?,?,?,?)")
      .run("ses_1", "prj_1", "t", "2026-08-05T00:00:00.000Z", "draft", "2026-08-05T00:00:00.000Z");

    // Insert open_question with raised_by_session_id set and answered_by_session_id NULL
    expect(() =>
      db.prepare(
        "INSERT INTO open_questions (id, project_id, key, text, category, raised_by_session_id, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run("oq_1", "prj_1", "q1", "text", "cat", "ses_1", "open", "2026-08-05T00:00:00.000Z"),
    ).not.toThrow();
  });

  it("enforces from_claim_id foreign key in claim_links", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO projects (id, name, domain, created_at) VALUES (?,?,?,?)")
      .run("prj_1", "test", "test.com", "2026-08-05T00:00:00.000Z");

    // Try to insert claim_link with missing from_claim_id FK
    expect(() =>
      db.prepare(
        "INSERT INTO claim_links (id, project_id, from_claim_id, link_kind, rationale, created_at) VALUES (?,?,?,?,?,?)",
      ).run("cl_1", "prj_1", "clm_missing", "supports", "reason", "2026-08-05T00:00:00.000Z"),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("is idempotent when applied to the same file twice", () => {
    // Create a temp file path
    const tempDir = mkdtempSync(join(tmpdir(), "db-test-"));
    tempDbPath = join(tempDir, "test.db");

    // First call to openDb
    const db1 = openDb(tempDbPath);
    const rows1 = db1
      .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'")
      .get() as { count: number };
    closeDb(db1);

    // Second call to openDb on the same file
    const db2 = openDb(tempDbPath);
    const rows2 = db2
      .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'")
      .get() as { count: number };
    closeDb(db2);

    // Verify table count is unchanged (schema applied idempotently)
    expect(rows2.count).toBe(rows1.count);
    expect(rows1.count).toBe(14); // 14 tables total
  });
});
