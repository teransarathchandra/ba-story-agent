import { describe, expect, it } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession, getSession, setSessionStatus } from "../../src/store/projects.js";
import { amendTranscript, createTranscript, freezeTranscript, getFrozenTranscript } from "../../src/store/transcripts.js";
import { insertClaims } from "../../src/store/claims.js";
import { insertRequirements, insertStory, listRequirements, listStories } from "../../src/store/artifacts.js";
import { insertQuestions, insertRecommendations, listQuestions, listRecommendations } from "../../src/store/findings.js";
import { saveCheckpoint } from "../../src/store/audit.js";
import { setSpeakerRoleOverrides, getSpeakerRoleOverrides } from "../../src/store/speaker-overrides.js";
import { newId } from "../../src/types/ids.js";

function seed() {
  const db = openDb(":memory:");
  const project = createProject(db, {
    name: "Returns",
    domain: "return authorization for marketplace orders",
  });
  const amendedSession = createSession(db, { projectId: project.id, title: "Discovery" });
  const otherSession = createSession(db, { projectId: project.id, title: "Follow-up" });
  const original = createTranscript(db, {
    sessionId: amendedSession.id,
    text: "Client: Returns are allowed for thirty days.",
  });
  freezeTranscript(db, original.transcript.id);
  const other = createTranscript(db, {
    sessionId: otherSession.id,
    text: "Client: Managers approve exceptional returns.",
  });
  freezeTranscript(db, other.transcript.id);

  const oldClaimId = newId("clm");
  const otherClaimId = newId("clm");
  insertClaims(db, [
    {
      id: oldClaimId,
      sessionId: amendedSession.id,
      transcriptId: original.transcript.id,
      segmentId: original.segments[0]!.id,
      quote: "Returns are allowed for thirty days.",
      statement: "Returns are allowed for thirty days.",
      speakerRole: "client",
      kind: "requirement",
      status: "validated",
      charStart: 8,
      charEnd: 44,
      matchMode: "exact",
      createdAt: new Date().toISOString(),
    },
    {
      id: otherClaimId,
      sessionId: otherSession.id,
      transcriptId: other.transcript.id,
      segmentId: other.segments[0]!.id,
      quote: "Managers approve exceptional returns.",
      statement: "Managers approve exceptional returns.",
      speakerRole: "client",
      kind: "requirement",
      status: "validated",
      charStart: 8,
      charEnd: 44,
      matchMode: "exact",
      createdAt: new Date().toISOString(),
    },
  ]);

  const staleRequirementId = newId("req");
  const sharedRequirementId = newId("req");
  insertRequirements(db, [
    {
      id: staleRequirementId,
      projectId: project.id,
      key: "REQ-001",
      statement: "Returns are allowed for thirty days.",
      status: "finalized",
      origin: "client-stated",
      originClaimIds: [oldClaimId],
      supersedesId: null,
      createdAt: new Date().toISOString(),
    },
    {
      id: sharedRequirementId,
      projectId: project.id,
      key: "REQ-002",
      statement: "Managers approve exceptional returns.",
      status: "proposed",
      origin: "client-stated",
      originClaimIds: [oldClaimId, otherClaimId],
      supersedesId: null,
      createdAt: new Date().toISOString(),
    },
  ]);

  insertStory(db, {
    id: newId("sty"), projectId: project.id, key: "US-001",
    asA: "customer", iWant: "to return an item", soThat: "I can receive a refund",
    requirementIds: [staleRequirementId], createdAt: new Date().toISOString(),
  }, []);

  insertQuestions(db, [
    {
      id: newId("oqn"), projectId: project.id, key: "OQ-001", text: "Which items?",
      category: "domain", raisedBySessionId: amendedSession.id, status: "open",
      answerText: null, answeredBySessionId: null, createdAt: new Date().toISOString(),
    },
    {
      id: newId("oqn"), projectId: project.id, key: "OQ-002", text: "Who approves?",
      category: "domain", raisedBySessionId: otherSession.id, status: "answered",
      answerText: "A manager", answeredBySessionId: amendedSession.id, createdAt: new Date().toISOString(),
    },
  ]);
  insertRecommendations(db, [{
    id: newId("rec"), projectId: project.id, key: "REC-001",
    text: "Record return decisions.", rationale: "Auditing is required.", category: "compliance",
    raisedBySessionId: amendedSession.id, status: "open", dispositionNote: null,
    createdAt: new Date().toISOString(),
  }]);
  saveCheckpoint(db, amendedSession.id, "extract", "complete", { claims: 1 });
  setSessionStatus(db, amendedSession.id, "awaiting-review");

  return { db, project, amendedSession, otherSession, oldClaimId, otherClaimId };
}

describe("transcript amendment", () => {
  it("creates a new frozen version and invalidates only output grounded in the amended session", () => {
    const { db, project, amendedSession, oldClaimId, otherClaimId } = seed();

    const result = amendTranscript(db, {
      sessionId: amendedSession.id,
      text: "Client: Returns are allowed for fourteen days with manager approval.",
    });

    expect(result.transcript.version).toBe(2);
    expect(result.transcript.frozenAt).not.toBeNull();
    expect(getFrozenTranscript(db, amendedSession.id)?.transcript.text).toContain("fourteen days");
    expect(db.prepare("SELECT COUNT(*) AS n FROM transcripts WHERE session_id = ?").get(amendedSession.id))
      .toEqual({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM claims WHERE id = ?").get(oldClaimId)).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM claims WHERE id = ?").get(otherClaimId)).toEqual({ n: 1 });
    expect(getSession(db, amendedSession.id)?.status).toBe("draft");

    const requirements = listRequirements(db, project.id);
    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.originClaimIds).toEqual([otherClaimId]);
    expect(listStories(db, project.id)).toHaveLength(0);
    expect(listRecommendations(db, project.id)).toHaveLength(0);
    expect(listQuestions(db, project.id)).toHaveLength(1);
    expect(listQuestions(db, project.id)[0]).toMatchObject({
      key: "OQ-002", status: "open", answerText: null, answeredBySessionId: null,
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM stage_checkpoints WHERE session_id = ?").get(amendedSession.id))
      .toEqual({ n: 0 });
    expect(result.invalidated).toEqual({
      claims: 1, requirements: 1, stories: 1, questions: 1, recommendations: 1, checkpoints: 1,
    });
  });

  it("rejects an amendment with identical content", () => {
    const { db, amendedSession } = seed();
    expect(() => amendTranscript(db, {
      sessionId: amendedSession.id,
      text: "Client: Returns are allowed for thirty days.",
    })).toThrow(/identical/);
  });

  it("clears speaker role overrides for the amended session, but not for other sessions", () => {
    const { db, amendedSession, otherSession } = seed();
    setSpeakerRoleOverrides(db, amendedSession.id, new Map([["Client", "client" as const]]));
    setSpeakerRoleOverrides(db, otherSession.id, new Map([["Client", "client" as const]]));

    amendTranscript(db, {
      sessionId: amendedSession.id,
      text: "Client: Returns are allowed for fourteen days with manager approval.",
    });

    expect(getSpeakerRoleOverrides(db, amendedSession.id).size).toBe(0);
    expect(getSpeakerRoleOverrides(db, otherSession.id).size).toBe(1);
  });
});
