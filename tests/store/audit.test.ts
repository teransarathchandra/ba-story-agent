import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { recordApproval, listApprovals, recordEgress, egressSummary, saveCheckpoint, loadCheckpoint } from "../../src/store/audit.js";

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  return { db, sessionId: s.id };
}

describe("audit", () => {
  it("records approvals with a content hash", () => {
    const { db } = seed();
    recordApproval(db, {
      entityType: "requirement", entityId: "req_x", action: "approve",
      actorNote: null, contentHash: "a".repeat(64),
    });
    expect(listApprovals(db, "requirement", "req_x")).toHaveLength(1);
  });

  it("summarizes egress across a session", () => {
    const { db, sessionId } = seed();
    recordEgress(db, { sessionId, stage: "extract", requestHash: "b".repeat(64), promptTokens: 100, completionTokens: 20, model: "claude-opus-5" });
    recordEgress(db, { sessionId, stage: "classify", requestHash: "c".repeat(64), promptTokens: 50, completionTokens: 10, model: "claude-opus-5" });
    expect(egressSummary(db, sessionId)).toEqual({ requests: 2, promptTokens: 150, completionTokens: 30 });
  });

  it("saves and reloads a stage checkpoint, overwriting on retry", () => {
    const { db, sessionId } = seed();
    saveCheckpoint(db, sessionId, "extract", "failed", null, "boom", "raw text");
    saveCheckpoint(db, sessionId, "extract", "complete", { claims: 3 }, null, null);
    const cp = loadCheckpoint<{ claims: number }>(db, sessionId, "extract");
    expect(cp?.status).toBe("complete");
    expect(cp?.payload?.claims).toBe(3);
  });
});
