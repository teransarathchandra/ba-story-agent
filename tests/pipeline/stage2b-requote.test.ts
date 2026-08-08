import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertClaims, listClaims } from "../../src/store/claims.js";
import { stage2bRequote } from "../../src/pipeline/stage2b-requote.js";
import { toRef, emptyState } from "../../src/pipeline/state.js";
import { chunkTranscript } from "../../src/pipeline/stage0-chunk.js";
import { newId } from "../../src/types/ids.js";
import type { StageContext } from "../../src/pipeline/runner.js";

const TEXT =
  "BA: what happens on a big invoice\n\n" +
  "Client: anything over ten thousand euro has to go to a manager, no exceptions";

function setup(quote: string, status: "quarantined" | "validated") {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: TEXT });
  freezeTranscript(db, transcript.id);
  const now = new Date().toISOString();
  const claimId = newId("clm");
  insertClaims(db, [{
    id: claimId, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[1]!.id,
    quote, statement: "a manager must approve invoices over ten thousand euro",
    speakerRole: "client" as const, kind: "requirement" as const, status,
    charStart: null, charEnd: null, matchMode: null, createdAt: now,
  }]);
  const windows = chunkTranscript(TEXT, segments);
  return {
    db, projectId: p.id, sessionId: s.id, claimId,
    state: { ...emptyState(transcript.id), windows: windows.map(toRef) },
  };
}

describe("stage2bRequote", () => {
  it("promotes a quarantined claim to validated when the model finds a real verbatim quote", async () => {
    const { db, projectId, sessionId, claimId, state } = setup("anithing over ten thousand euros", "quarantined");
    const parse = vi.fn().mockResolvedValue({
      raw: "{}",
      parsedOutput: { requotes: [{ id: claimId, quote: "anything over ten thousand euro has to go to a manager" }] },
      requestPayload: {}, usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId, sessionId };
    const out = await stage2bRequote.run(ctx, state);
    const [claim] = listClaims(db, sessionId);
    expect(claim?.status).toBe("validated");
    expect(claim?.quote).toBe("anything over ten thousand euro has to go to a manager");
    expect(out.validated).toBe(1);
    expect(out.quarantined).toBe(0);
  });

  it("leaves the claim quarantined when the model reports no match", async () => {
    const { db, projectId, sessionId, claimId, state } = setup("total nonsense not in the transcript", "quarantined");
    const parse = vi.fn().mockResolvedValue({
      raw: "{}",
      parsedOutput: { requotes: [{ id: claimId, quote: "" }] },
      requestPayload: {}, usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId, sessionId };
    const out = await stage2bRequote.run(ctx, state);
    const [claim] = listClaims(db, sessionId);
    expect(claim?.status).toBe("quarantined");
    expect(out.quarantined).toBe(1);
  });

  it("leaves the claim quarantined when the model's new quote still fails grounding", async () => {
    const { db, projectId, sessionId, claimId, state } = setup("still not a real quote at all", "quarantined");
    const parse = vi.fn().mockResolvedValue({
      raw: "{}",
      parsedOutput: { requotes: [{ id: claimId, quote: "this is also not in the transcript anywhere" }] },
      requestPayload: {}, usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId, sessionId };
    await stage2bRequote.run(ctx, state);
    const [claim] = listClaims(db, sessionId);
    expect(claim?.status).toBe("quarantined");
  });

  it("makes no LLM call when there are no quarantined claims", async () => {
    const { db, projectId, sessionId, state } = setup("anything over ten thousand euro has to go to a manager", "validated");
    const parse = vi.fn();
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId, sessionId };
    await stage2bRequote.run(ctx, state);
    expect(parse).not.toHaveBeenCalled();
  });
});
