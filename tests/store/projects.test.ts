import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import {
  createProject,
  getProject,
  createSession,
  listProjects,
  listSessions,
  setSessionStatus,
  deleteProject,
  deleteSession,
} from "../../src/store/projects.js";
import { createTranscript } from "../../src/store/transcripts.js";

describe("projects", () => {
  it("round-trips a project", () => {
    const db = openDb(":memory:");
    const created = createProject(db, {
      name: "Nordic Freight",
      domain: "B2B freight invoicing for EU logistics operators",
      regulatoryContext: "GDPR",
    });
    const fetched = getProject(db, created.id);
    expect(fetched?.name).toBe("Nordic Freight");
    expect(fetched?.regulatoryContext).toBe("GDPR");
  });

  it("rejects a project with a too-short domain", () => {
    const db = openDb(":memory:");
    expect(() => createProject(db, { name: "X", domain: "stuff" })).toThrow();
  });

  it("lists sessions for a project and updates status", () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics" });
    const s = createSession(db, { projectId: p.id, title: "Kickoff" });
    setSessionStatus(db, s.id, "awaiting-review");
    const sessions = listSessions(db, p.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe("awaiting-review");
  });

  it("lists projects newest first", () => {
    const db = openDb(":memory:");
    const first = createProject(db, { name: "First", domain: "invoice approval for logistics" });
    db.prepare("UPDATE projects SET created_at = ? WHERE id = ?")
      .run("2026-01-01T00:00:00.000Z", first.id);
    const second = createProject(db, { name: "Second", domain: "returns workflow for retail teams" });
    expect(listProjects(db).map(project => project.id)).toEqual([second.id, first.id]);
  });

  it("deletes a session and cascades its transcript", () => {
    const db = openDb(":memory:");
    const project = createProject(db, { name: "P", domain: "invoice approval for logistics" });
    const session = createSession(db, { projectId: project.id, title: "Kickoff" });
    createTranscript(db, { sessionId: session.id, text: "A complete transcript" });

    expect(deleteSession(db, session.id)).toBe(true);
    expect(listSessions(db, project.id)).toHaveLength(0);
    expect((db.prepare("SELECT COUNT(*) AS count FROM transcripts").get() as { count: number }).count).toBe(0);
    expect(deleteSession(db, session.id)).toBe(false);
  });

  it("deletes a project and all project-owned records", () => {
    const db = openDb(":memory:");
    const project = createProject(db, { name: "P", domain: "invoice approval for logistics" });
    createSession(db, { projectId: project.id, title: "Kickoff" });

    expect(deleteProject(db, project.id)).toBe(true);
    expect(getProject(db, project.id)).toBeNull();
    expect(listSessions(db, project.id)).toHaveLength(0);
    expect(deleteProject(db, project.id)).toBe(false);
  });
});
