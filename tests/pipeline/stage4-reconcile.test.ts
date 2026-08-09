import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertClaims } from "../../src/store/claims.js";
import { insertRequirements } from "../../src/store/artifacts.js";
import { listQuestions } from "../../src/store/findings.js";
import { listLinks } from "../../src/store/links.js";

import { stage4Reconcile } from "../../src/pipeline/stage4-reconcile.js";
import { emptyState } from "../../src/pipeline/state.js";
import { newId } from "../../src/types/ids.js";
import type { StageContext } from "../../src/pipeline/runner.js";

function setup(modelOutputFn: (a: string, b: string) => unknown) {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
  freezeTranscript(db, transcript.id);
  const now = new Date().toISOString();
  const a = newId("clm"), b = newId("clm");
  insertClaims(db, [a, b].map((id, i) => ({
    id, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
    quote: i === 0 ? "approvals go to a manager" : "approvals go to the finance lead",
    statement: "approval routing", speakerRole: "client" as const,
    kind: "requirement" as const, status: "validated" as const,
    charStart: 0, charEnd: 1, matchMode: "exact" as const, createdAt: now,
  })));
  const parse = vi.fn().mockResolvedValue({
    raw: "{}",
    parsedOutput: modelOutputFn(a, b),
    requestPayload: {},
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
  return { ctx, a, b, state: emptyState(transcript.id) };
}

describe("stage4Reconcile", () => {
  it("raises an open question for each contradiction", async () => {
    const { ctx, a, b, state } = setup((a, b) => ({
      contradictions: [{ claimIdA: a, claimIdB: b, question: "Do approvals route to a manager or the finance lead?" }],
      links: [],
    }));
    const out = await stage4Reconcile.run(ctx, state);
    const qs = listQuestions(ctx.db, ctx.projectId);
    expect(qs).toHaveLength(1);
    expect(qs[0]?.text).toMatch(/manager or the finance lead/);
    expect(qs[0]?.status).toBe("open");
    expect(out.questions).toBe(1);
  });

  it("retains both sides of a contradiction rather than picking one", async () => {
    const { ctx, a, b, state } = setup((a, b) => ({
      contradictions: [{ claimIdA: a, claimIdB: b, question: "Which is it?" }],
      links: [],
    }));
    await stage4Reconcile.run(ctx, state);
    const links = listLinks(ctx.db, ctx.projectId);
    const contradiction = links.find((l) => l.linkKind === "contradicts");
    expect(contradiction?.fromClaimId).toBe(a);
    expect(contradiction?.toClaimId).toBe(b);
    expect(contradiction?.accepted).toBe(false);
  });

  it("records cross-session links as proposed, never auto-applied", async () => {
    const { ctx, a, state } = setup((a, b) => ({
      contradictions: [],
      links: [{ claimId: a, requirementId: "req_existing", linkKind: "refines", rationale: "adds a threshold" }],
    }));
    // Insert the existing requirement before running the stage
    const now = new Date().toISOString();
    insertRequirements(ctx.db, [{
      id: "req_existing",
      projectId: ctx.projectId,
      key: "REQ-001",
      statement: "existing requirement",
      status: "confirmed",
      origin: "ba-authored",
      originClaimIds: [],
      supersedesId: null,
      createdAt: now,
    }]);
    await stage4Reconcile.run(ctx, state);
    const [link] = listLinks(ctx.db, ctx.projectId);
    expect(link?.linkKind).toBe("refines");
    expect(link?.accepted).toBe(false);
  });

  it("is a no-op when there are no requirement claims", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
    freezeTranscript(db, transcript.id);
    const parse = vi.fn();
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    await stage4Reconcile.run(ctx, emptyState(transcript.id));
    expect(parse).not.toHaveBeenCalled();
  });

  it("excludes analyst-attributed claims from reconciliation, even when validated and kind=requirement", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
    freezeTranscript(db, transcript.id);
    const now = new Date().toISOString();
    const baClaimId = newId("clm");
    const clientClaimId = newId("clm");
    insertClaims(db, [
      {
        id: baClaimId, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
        quote: "should approvals go to a manager?", statement: "approval routing question",
        speakerRole: "ba" as const, kind: "requirement" as const, status: "validated" as const,
        charStart: 0, charEnd: 1, matchMode: "exact" as const, createdAt: now,
      },
      {
        id: clientClaimId, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
        quote: "approvals go to the finance lead", statement: "approval routing",
        speakerRole: "client" as const, kind: "requirement" as const, status: "validated" as const,
        charStart: 0, charEnd: 1, matchMode: "exact" as const, createdAt: now,
      },
    ]);
    const parse = vi.fn().mockResolvedValue({
      raw: "{}",
      // The model is never given a chance to reference baClaimId at all —
      // this test proves the FILTER excludes it before the LLM call is even
      // built, not merely that the model chose not to use it.
      parsedOutput: { contradictions: [], links: [] },
      requestPayload: {}, usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    await stage4Reconcile.run(ctx, emptyState(transcript.id));
    const [call] = parse.mock.calls;
    const userPrompt = (call![0] as { user: string }).user;
    expect(userPrompt).not.toContain(baClaimId);
    expect(userPrompt).toContain(clientClaimId);
  });
});
