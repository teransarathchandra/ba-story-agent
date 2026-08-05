import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";

describe("openDb", () => {
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

  it("is idempotent when applied twice", () => {
    const db = openDb(":memory:");
    expect(() => openDb(":memory:")).not.toThrow();
    expect(db.prepare("SELECT 1 AS ok").get()).toEqual({ ok: 1 });
  });
});
