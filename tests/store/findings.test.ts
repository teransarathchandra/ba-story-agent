import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { insertQuestions, listQuestions, insertRecommendations, listRecommendations } from "../../src/store/findings.js";
import { newId } from "../../src/types/ids.js";

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  return { db, projectId: p.id, sessionId: s.id };
}

describe("findings", () => {
  it("stores and filters open questions by status", () => {
    const { db, projectId, sessionId } = seed();
    insertQuestions(db, [
      { id: newId("oqn"), projectId, key: "OQ-001", text: "Retention period?", category: "privacy", raisedBySessionId: sessionId, status: "open", answerText: null, answeredBySessionId: null, createdAt: new Date().toISOString() },
      { id: newId("oqn"), projectId, key: "OQ-002", text: "Escalation path?", category: "domain", raisedBySessionId: sessionId, status: "asked", answerText: null, answeredBySessionId: null, createdAt: new Date().toISOString() },
    ]);
    expect(listQuestions(db, projectId)).toHaveLength(2);
    expect(listQuestions(db, projectId, { status: "open" })).toHaveLength(1);
  });

  it("stores recommendations with rationale", () => {
    const { db, projectId, sessionId } = seed();
    insertRecommendations(db, [{
      id: newId("rec"), projectId, key: "REC-001",
      text: "Approval actions need an immutable audit trail.",
      rationale: "Financial approval with no audit mechanism discussed.",
      category: "security", raisedBySessionId: sessionId, status: "open",
      dispositionNote: null, createdAt: new Date().toISOString(),
    }]);
    expect(listRecommendations(db, projectId)[0]?.rationale).toMatch(/audit mechanism/);
  });
});
