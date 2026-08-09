import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertClaims } from "../../src/store/claims.js";
import { listRequirements } from "../../src/store/artifacts.js";
import { stage5Requirements } from "../../src/pipeline/stage5-requirements.js";
import { emptyState } from "../../src/pipeline/state.js";
import { newId } from "../../src/types/ids.js";
import type { StageContext } from "../../src/pipeline/runner.js";

/** `makeDrafts` receives the real claim id, so tests never juggle placeholders. */
function setup(makeDrafts: (claimId: string) => unknown[]) {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
  freezeTranscript(db, transcript.id);
  const claimId = newId("clm");
  insertClaims(db, [{
    id: claimId, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
    quote: "anything over ten thousand euro goes to a manager", statement: "threshold",
    speakerRole: "client" as const, kind: "requirement" as const, status: "validated" as const,
    charStart: 0, charEnd: 1, matchMode: "exact" as const, createdAt: new Date().toISOString(),
  }]);
  const parse = vi.fn().mockResolvedValue({
    raw: "{}",
    parsedOutput: { requirements: makeDrafts(claimId) },
    requestPayload: {},
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
  return { ctx, claimId, state: emptyState(transcript.id) };
}

describe("stage5Requirements", () => {
  it("persists a sourced requirement with a sequential key", async () => {
    const { ctx, claimId, state } = setup((id) => [
      { statement: "Invoices over EUR 10,000 must be approved by a manager.", originClaimIds: [id] },
    ]);
    const out = await stage5Requirements.run(ctx, state);
    const reqs = listRequirements(ctx.db, ctx.projectId);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.key).toBe("REQ-001");
    expect(reqs[0]?.status).toBe("proposed");
    expect(reqs[0]?.origin).toBe("client-stated");
    expect(reqs[0]?.originClaimIds).toEqual([claimId]);
    expect(out.requirements).toBe(1);
  });

  it("DROPS an unsourced draft but the fallback still covers the underlying claim", async () => {
    const { ctx, claimId, state } = setup(() => [{ statement: "Invented rule.", originClaimIds: [] }]);
    const out = await stage5Requirements.run(ctx, state);
    const reqs = listRequirements(ctx.db, ctx.projectId);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.statement).not.toBe("Invented rule.");
    expect(reqs[0]?.statement).toBe("threshold");
    expect(reqs[0]?.originClaimIds).toEqual([claimId]);
    expect(out.requirements).toBe(1);
  });

  it("DROPS a requirement citing a claim that does not exist, but the fallback still covers the real claim", async () => {
    const { ctx, claimId, state } = setup(() => [{ statement: "Invented rule.", originClaimIds: ["clm_fabricated"] }]);
    await stage5Requirements.run(ctx, state);
    const reqs = listRequirements(ctx.db, ctx.projectId);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.statement).not.toBe("Invented rule.");
    expect(reqs[0]?.originClaimIds).toEqual([claimId]);
  });

  it("drops only the unsourced entries, keeping the sourced ones", async () => {
    const { ctx, state } = setup((id) => [
      { statement: "Real one.", originClaimIds: [id] },
      { statement: "Invented one.", originClaimIds: [] },
    ]);
    await stage5Requirements.run(ctx, state);
    const reqs = listRequirements(ctx.db, ctx.projectId);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.statement).toBe("Real one.");
  });

  it("emits no requirements when there are no requirement claims", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
    freezeTranscript(db, transcript.id);
    const parse = vi.fn();
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    const out = await stage5Requirements.run(ctx, emptyState(transcript.id));
    expect(parse).not.toHaveBeenCalled();
    expect(out.requirements).toBe(0);
    expect(out.requirementClaims).toBe(0);
  });

  it("records how many requirement-kind claims reached synthesis", async () => {
    const { ctx, state } = setup((id) => [
      { statement: "Real one.", originClaimIds: [id] },
    ]);
    const out = await stage5Requirements.run(ctx, state);
    expect(out.requirementClaims).toBe(1);
  });

  it("falls back to a direct requirement when the model returns no drafts at all", async () => {
    const { ctx, claimId, state } = setup(() => []);
    const out = await stage5Requirements.run(ctx, state);
    const reqs = listRequirements(ctx.db, ctx.projectId);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.statement).toBe("threshold");
    expect(reqs[0]?.originClaimIds).toEqual([claimId]);
    expect(out.requirements).toBe(1);
  });

  it("falls back to a direct requirement when every draft cites an unknown claim id", async () => {
    const { ctx, claimId, state } = setup(() => [
      { statement: "Invented rule.", originClaimIds: ["clm_fabricated"] },
    ]);
    const out = await stage5Requirements.run(ctx, state);
    const reqs = listRequirements(ctx.db, ctx.projectId);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.originClaimIds).toEqual([claimId]);
    expect(out.requirements).toBe(1);
  });

  it("does not duplicate a claim already covered by a sourced LLM draft", async () => {
    const { ctx, state } = setup((id) => [
      { statement: "Real one.", originClaimIds: [id] },
    ]);
    await stage5Requirements.run(ctx, state);
    const reqs = listRequirements(ctx.db, ctx.projectId);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.statement).toBe("Real one.");
  });

  it("fallback covers only claims the LLM draft didn't cite, alongside the LLM's own results", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
    freezeTranscript(db, transcript.id);
    const now = new Date().toISOString();
    const claimA = newId("clm");
    const claimB = newId("clm");
    insertClaims(db, [
      {
        id: claimA, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
        quote: "invoices over ten thousand must go to a manager", statement: "threshold A",
        speakerRole: "client" as const, kind: "requirement" as const, status: "validated" as const,
        charStart: 0, charEnd: 1, matchMode: "exact" as const, createdAt: now,
      },
      {
        id: claimB, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
        quote: "customers must confirm by email", statement: "threshold B",
        speakerRole: "client" as const, kind: "requirement" as const, status: "validated" as const,
        charStart: 0, charEnd: 1, matchMode: "exact" as const, createdAt: now,
      },
    ]);
    const parse = vi.fn().mockResolvedValue({
      raw: "{}",
      parsedOutput: { requirements: [{ statement: "Real one.", originClaimIds: [claimA] }] },
      requestPayload: {},
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    const out = await stage5Requirements.run(ctx, emptyState(transcript.id));
    const reqs = listRequirements(db, p.id);
    expect(reqs).toHaveLength(2);
    expect(reqs.map((r) => r.statement).sort()).toEqual(["Real one.", "threshold B"]);
    expect(out.requirements).toBe(2);
  });

  it("excludes a validated requirement-kind claim whose speakerRole is 'ba' from synthesis", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
    freezeTranscript(db, transcript.id);
    const claimId = newId("clm");
    insertClaims(db, [{
      id: claimId, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
      quote: "should we require manager approval for large invoices?", statement: "manager approval is required",
      speakerRole: "ba" as const, kind: "requirement" as const, status: "validated" as const,
      charStart: 0, charEnd: 1, matchMode: "exact" as const, createdAt: new Date().toISOString(),
    }]);
    const parse = vi.fn();
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    const out = await stage5Requirements.run(ctx, emptyState(transcript.id));
    expect(parse).not.toHaveBeenCalled();
    expect(listRequirements(db, p.id)).toHaveLength(0);
    expect(out.requirements).toBe(0);
    expect(out.requirementClaims).toBe(0);
  });

  it("excludes a validated requirement-kind claim whose speakerRole is 'other' from synthesis", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
    freezeTranscript(db, transcript.id);
    const claimId = newId("clm");
    insertClaims(db, [{
      id: claimId, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
      quote: "the vendor mentioned a different threshold", statement: "vendor-mentioned threshold",
      speakerRole: "other" as const, kind: "requirement" as const, status: "validated" as const,
      charStart: 0, charEnd: 1, matchMode: "exact" as const, createdAt: new Date().toISOString(),
    }]);
    const parse = vi.fn();
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    const out = await stage5Requirements.run(ctx, emptyState(transcript.id));
    expect(parse).not.toHaveBeenCalled();
    expect(listRequirements(db, p.id)).toHaveLength(0);
    expect(out.requirements).toBe(0);
    expect(out.requirementClaims).toBe(0);
  });

  it("still includes a validated requirement-kind claim whose speakerRole is 'unknown'", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
    freezeTranscript(db, transcript.id);
    const claimId = newId("clm");
    insertClaims(db, [{
      id: claimId, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
      quote: "anything over ten thousand euro goes to a manager", statement: "threshold",
      speakerRole: "unknown" as const, kind: "requirement" as const, status: "validated" as const,
      charStart: 0, charEnd: 1, matchMode: "exact" as const, createdAt: new Date().toISOString(),
    }]);
    const parse = vi.fn().mockResolvedValue({
      raw: "{}",
      parsedOutput: { requirements: [{ statement: "Invoices over EUR 10,000 must be approved by a manager.", originClaimIds: [claimId] }] },
      requestPayload: {}, usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    const out = await stage5Requirements.run(ctx, emptyState(transcript.id));
    expect(listRequirements(db, p.id)).toHaveLength(1);
    expect(out.requirementClaims).toBe(1);
  });
});
