import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, getProject, createSession, listSessions, setSessionStatus } from "../../src/store/projects.js";

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
});
