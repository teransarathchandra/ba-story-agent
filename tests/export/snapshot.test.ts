import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertClaims } from "../../src/store/claims.js";
import { insertRequirements, insertStory } from "../../src/store/artifacts.js";
import { insertQuestions, insertRecommendations } from "../../src/store/findings.js";
import { buildSnapshot, SNAPSHOT_SCHEMA_VERSION } from "../../src/export/snapshot.js";
import { newId } from "../../src/types/ids.js";

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "Nordic Freight", domain: "B2B freight invoicing for EU logistics operators", regulatoryContext: "GDPR" });
  const s = createSession(db, { projectId: p.id, title: "Kickoff" });
  const { transcript, segments } = createTranscript(db, {
    sessionId: s.id,
    text: "Client: anything over ten thousand euro has to go to a manager\n\nClient: we would usually be dealing in euro",
  });
  freezeTranscript(db, transcript.id);
  const now = new Date().toISOString();
  const reqClaim = newId("clm"), asmClaim = newId("clm"), quarantined = newId("clm");
  insertClaims(db, [
    { id: reqClaim, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
      quote: "anything over ten thousand euro has to go to a manager", statement: "threshold",
      speakerRole: "client", kind: "requirement", status: "validated",
      charStart: 8, charEnd: 62, matchMode: "exact", createdAt: now },
    { id: asmClaim, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[1]!.id,
      quote: "we would usually be dealing in euro", statement: "currency assumption",
      speakerRole: "client", kind: "assumption", status: "validated",
      charStart: 70, charEnd: 104, matchMode: "exact", createdAt: now },
    { id: quarantined, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
      quote: "passwords rotate every ninety days", statement: "invented",
      speakerRole: "client", kind: "requirement", status: "quarantined",
      charStart: null, charEnd: null, matchMode: null, createdAt: now },
  ]);
  const reqId = newId("req");
  insertRequirements(db, [{
    id: reqId, projectId: p.id, key: "REQ-001",
    statement: "Invoices over EUR 10,000 must be approved by a manager.",
    status: "finalized", origin: "client-stated", originClaimIds: [reqClaim],
    supersedesId: null, createdAt: now,
  }]);
  const storyId = newId("sty");
  insertStory(db,
    { id: storyId, projectId: p.id, key: "US-001", asA: "finance clerk", iWant: "routing", soThat: "oversight", requirementIds: [reqId], createdAt: now },
    [{ id: newId("acr"), storyId, idx: 0, gherkin: "Given X when Y then Z", source: "client-stated", linkedQuestionId: null }],
  );
  insertQuestions(db, [{ id: newId("oqn"), projectId: p.id, key: "OQ-001", text: "Escalation window?", category: "domain", raisedBySessionId: s.id, status: "open", answerText: null, answeredBySessionId: null, createdAt: now }]);
  insertRecommendations(db, [{ id: newId("rec"), projectId: p.id, key: "REC-001", text: "Add an audit trail.", rationale: "No audit mechanism discussed.", category: "security", raisedBySessionId: s.id, status: "open", dispositionNote: null, createdAt: now }]);
  return { db, projectId: p.id };
}

describe("buildSnapshot", () => {
  it("carries a schema version", () => {
    const { db, projectId } = seed();
    expect(buildSnapshot(db, projectId).schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
  });

  it("includes only finalized requirements in the baseline", () => {
    const { db, projectId } = seed();
    const snap = buildSnapshot(db, projectId);
    expect(snap.requirements).toHaveLength(1);
    expect(snap.requirements[0]?.key).toBe("REQ-001");
  });

  it("excludes proposed requirements by default", () => {
    const { db, projectId } = seed();
    insertRequirements(db, [{
      id: newId("req"), projectId, key: "REQ-002", statement: "Not yet approved.",
      status: "proposed", origin: "client-stated", originClaimIds: ["clm_a"],
      supersedesId: null, createdAt: new Date().toISOString(),
    }]);
    expect(buildSnapshot(db, projectId).requirements.map((r) => r.key)).toEqual(["REQ-001"]);
  });

  it("includes proposed requirements when asked, preserving their status", () => {
    const { db, projectId } = seed();
    insertRequirements(db, [{
      id: newId("req"), projectId, key: "REQ-002", statement: "Not yet approved.",
      status: "proposed", origin: "client-stated", originClaimIds: ["clm_a"],
      supersedesId: null, createdAt: new Date().toISOString(),
    }]);
    const snap = buildSnapshot(db, projectId, { includeProposed: true });
    expect(snap.requirements.map((r) => r.key)).toEqual(["REQ-001", "REQ-002"]);
    expect(snap.requirements.find((r) => r.key === "REQ-002")?.status).toBe("proposed");
  });

  it("attaches a verbatim quote and its timestamp to every requirement", () => {
    const { db, projectId } = seed();
    const [req] = buildSnapshot(db, projectId).requirements;
    expect(req?.evidence).toHaveLength(1);
    expect(req?.evidence[0]?.quote).toMatch(/ten thousand euro/);
    expect(req?.evidence[0]?.sessionTitle).toBe("Kickoff");
  });

  it("lists assumptions separately from requirements", () => {
    const { db, projectId } = seed();
    const snap = buildSnapshot(db, projectId);
    expect(snap.assumptions).toHaveLength(1);
    expect(snap.assumptions[0]?.quote).toMatch(/usually be dealing in euro/);
  });

  it("publishes the quarantine list", () => {
    const { db, projectId } = seed();
    const snap = buildSnapshot(db, projectId);
    expect(snap.quarantined).toHaveLength(1);
    expect(snap.quarantined[0]?.quote).toMatch(/ninety days/);
  });

  it("includes provenance: transcript hashes, models, and egress", () => {
    const { db, projectId } = seed();
    const snap = buildSnapshot(db, projectId);
    expect(snap.provenance.sessions[0]?.transcriptHash).toHaveLength(64);
    expect(snap.provenance.llmModel).toBe("claude-opus-5");
    expect(snap.provenance.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(snap.provenance.egress.requests).toBe(0);
  });
});
