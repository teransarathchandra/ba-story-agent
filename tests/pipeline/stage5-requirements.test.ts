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
    parsed_output: { requirements: makeDrafts(claimId) },
    content: [{ type: "text", text: "{}" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
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

  it("DROPS a requirement with no origin claims", async () => {
    const { ctx, state } = setup(() => [{ statement: "Invented rule.", originClaimIds: [] }]);
    const out = await stage5Requirements.run(ctx, state);
    expect(listRequirements(ctx.db, ctx.projectId)).toHaveLength(0);
    expect(out.requirements).toBe(0);
  });

  it("DROPS a requirement citing a claim that does not exist", async () => {
    const { ctx, state } = setup(() => [{ statement: "Invented rule.", originClaimIds: ["clm_fabricated"] }]);
    await stage5Requirements.run(ctx, state);
    expect(listRequirements(ctx.db, ctx.projectId)).toHaveLength(0);
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
    const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
    const out = await stage5Requirements.run(ctx, emptyState(transcript.id));
    expect(parse).not.toHaveBeenCalled();
    expect(out.requirements).toBe(0);
  });
});
