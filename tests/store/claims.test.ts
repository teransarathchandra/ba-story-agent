import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript } from "../../src/store/transcripts.js";
import { insertClaims, listClaims, listProjectClaims, updateClaimValidation, countByStatus } from "../../src/store/claims.js";
import { newId } from "../../src/types/ids.js";
import type { Claim } from "../../src/types/domain.js";

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "hello there\n\ngoodbye now" });
  return { db, projectId: p.id, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id };
}

function claim(over: Partial<Claim> & Pick<Claim, "sessionId" | "transcriptId" | "segmentId">): Claim {
  return {
    id: newId("clm"),
    quote: "hello there",
    statement: "A greeting is issued.",
    speakerRole: "client",
    kind: "requirement",
    status: "candidate",
    charStart: null,
    charEnd: null,
    matchMode: null,
    createdAt: new Date().toISOString(),
    ...over,
  } as Claim;
}

describe("claims", () => {
  it("inserts and filters by status and kind", () => {
    const { db, sessionId, transcriptId, segmentId } = seed();
    insertClaims(db, [
      claim({ sessionId, transcriptId, segmentId, status: "validated", kind: "requirement" }),
      claim({ sessionId, transcriptId, segmentId, status: "quarantined", kind: "requirement" }),
      claim({ sessionId, transcriptId, segmentId, status: "validated", kind: "assumption" }),
    ]);
    expect(listClaims(db, sessionId)).toHaveLength(3);
    expect(listClaims(db, sessionId, { status: "validated" })).toHaveLength(2);
    expect(listClaims(db, sessionId, { status: "validated", kind: "assumption" })).toHaveLength(1);
  });

  it("updates validation outcome", () => {
    const { db, sessionId, transcriptId, segmentId } = seed();
    const c = claim({ sessionId, transcriptId, segmentId });
    insertClaims(db, [c]);
    updateClaimValidation(db, c.id, {
      status: "validated", charStart: 0, charEnd: 11, matchMode: "exact", segmentId,
    });
    const updated = listClaims(db, sessionId)[0]!;
    expect(updated.status).toBe("validated");
    expect(updated.matchMode).toBe("exact");
    expect(updated.charEnd).toBe(11);
  });

  it("counts by status", () => {
    const { db, sessionId, transcriptId, segmentId } = seed();
    insertClaims(db, [
      claim({ sessionId, transcriptId, segmentId, status: "validated" }),
      claim({ sessionId, transcriptId, segmentId, status: "quarantined" }),
      claim({ sessionId, transcriptId, segmentId, status: "quarantined" }),
    ]);
    expect(countByStatus(db, sessionId)).toEqual({ validated: 1, quarantined: 2 });
  });

  it("lists claims across all sessions in a project", () => {
    const { db, projectId, sessionId, transcriptId, segmentId } = seed();
    insertClaims(db, [claim({ sessionId, transcriptId, segmentId, status: "validated" })]);
    expect(listProjectClaims(db, projectId, { status: "validated" })).toHaveLength(1);
  });
});
