import { describe, it, expect, afterEach } from "vitest";
import { openDb, closeDb } from "../../src/store/db.js";
import Database from "better-sqlite3";
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
      "app_metadata",
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
    expect(rows1.count).toBe(16); // 16 tables total
  });

  it("adds llm_backend to a projects table that predates that column", () => {
    // Simulates a real pre-existing database file (e.g. an Electron user's
    // ~/Library/Application Support db, created before llm_backend existed
    // in schema.sql). CREATE TABLE IF NOT EXISTS is a no-op against an
    // already-existing table, so a plain re-run of schema.sql alone can
    // never add this column to a file like this — this is exactly the bug
    // a real user hit ("no column named llm_backend") until openDb() also
    // runs an explicit column migration.
    const tempDir = mkdtempSync(join(tmpdir(), "db-test-"));
    tempDbPath = join(tempDir, "old-shape.db");

    const raw = new Database(tempDbPath);
    raw.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        regulatory_context TEXT NOT NULL DEFAULT 'none',
        system_name TEXT,
        glossary TEXT,
        created_at TEXT NOT NULL
      );
    `);
    raw.close();

    // Opening via the real openDb() (as every real caller does) must not
    // throw, and must leave the table able to accept the current schema's
    // full column set.
    const db = openDb(tempDbPath);
    const columns = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
    expect(columns.map((c) => c.name)).toContain("llm_backend");

    expect(() =>
      db.prepare(
        "INSERT INTO projects (id, name, domain, llm_backend, created_at) VALUES (?,?,?,?,?)",
      ).run("prj_old", "test", "test domain", "local", "2026-08-05T00:00:00.000Z"),
    ).not.toThrow();

    const row = db.prepare("SELECT llm_backend FROM projects WHERE id = ?").get("prj_old") as { llm_backend: string };
    expect(row.llm_backend).toBe("local");

    closeDb(db);
  });

  it("relaxes domain NOT NULL on a projects table that predates that change, preserving existing rows and FKs", () => {
    // SQLite cannot ALTER a column's NOT NULL constraint directly (verified
    // empirically: `ALTER TABLE t ALTER COLUMN x DROP NOT NULL` is a syntax
    // error in this project's installed SQLite) — a real pre-existing
    // database with `domain TEXT NOT NULL` needs a table rebuild, not a
    // simple ALTER, to accept a NULL domain going forward. This simulates
    // the actual production shape (post the llm_backend fix, pre this
    // change) and confirms the rebuild preserves real data and FK links.
    const tempDir = mkdtempSync(join(tmpdir(), "db-test-"));
    tempDbPath = join(tempDir, "old-domain-shape.db");

    const raw = new Database(tempDbPath);
    raw.pragma("foreign_keys = ON");
    raw.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        regulatory_context TEXT NOT NULL DEFAULT 'none',
        system_name TEXT,
        glossary TEXT,
        llm_backend TEXT NOT NULL DEFAULT 'local',
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    raw.prepare(
      "INSERT INTO projects (id, name, domain, regulatory_context, llm_backend, created_at) VALUES (?,?,?,?,?,?)",
    ).run("prj_real", "Real Project", "real existing domain text", "none", "local", "2026-08-07T00:00:00.000Z");
    raw.prepare(
      "INSERT INTO sessions (id, project_id, title, occurred_at, status, created_at) VALUES (?,?,?,?,?,?)",
    ).run("ses_real", "prj_real", "Kickoff", "2026-08-07T00:00:00.000Z", "draft", "2026-08-07T00:00:00.000Z");
    raw.close();

    const db = openDb(tempDbPath);

    // The pre-existing row survived the rebuild with its real data intact.
    const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get("prj_real") as Record<string, unknown>;
    expect(existing.name).toBe("Real Project");
    expect(existing.domain).toBe("real existing domain text");
    expect(existing.llm_backend).toBe("local");

    // The FK-dependent row (sessions -> projects) survived too — a naive
    // rebuild that dropped and recreated `projects` without care could
    // orphan or cascade-delete this via ON DELETE CASCADE if done wrong.
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get("ses_real") as Record<string, unknown>;
    expect(session?.project_id).toBe("prj_real");

    // domain is now genuinely nullable going forward.
    const columns = db.prepare("PRAGMA table_info(projects)").all() as { name: string; notnull: number }[];
    const domainCol = columns.find((c) => c.name === "domain");
    expect(domainCol?.notnull).toBe(0);

    expect(() =>
      db.prepare("INSERT INTO projects (id, name, llm_backend, created_at) VALUES (?,?,?,?)")
        .run("prj_no_domain", "No Domain Yet", "local", "2026-08-08T00:00:00.000Z"),
    ).not.toThrow();

    // No dangling foreign key violations after the rebuild.
    const fkErrors = db.pragma("foreign_key_check");
    expect(fkErrors).toHaveLength(0);

    closeDb(db);
  });
});
