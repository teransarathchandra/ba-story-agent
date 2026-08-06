import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertClaims, listClaims } from "../../src/store/claims.js";
import { stage3Classify } from "../../src/pipeline/stage3-classify.js";
import { emptyState } from "../../src/pipeline/state.js";
import { newId } from "../../src/types/ids.js";
import type { StageContext } from "../../src/pipeline/runner.js";

function setup(quotes: string[], modelKinds: string[]) {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "x\n\ny" });
  freezeTranscript(db, transcript.id);
  const now = new Date().toISOString();
  const ids = quotes.map(() => newId("clm"));
  insertClaims(db, quotes.map((quote, i) => ({
    id: ids[i]!, sessionId: s.id, transcriptId: transcript.id,
    segmentId: segments[0]!.id, quote, statement: quote,
    speakerRole: "client" as const, kind: "requirement" as const,
    status: "validated" as const, charStart: 0, charEnd: 1,
    matchMode: "exact" as const, createdAt: now,
  })));
  const parse = vi.fn().mockResolvedValue({
    parsed_output: { classifications: ids.map((id, i) => ({ claimId: id, kind: modelKinds[i] })) },
    content: [{ type: "text", text: "{}" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
  return { ctx, ids, state: emptyState(transcript.id) };
}

describe("stage3Classify", () => {
  it("applies the model's classification for unhedged claims", async () => {
    const { ctx } = setup(["invoices over ten thousand must go to a manager"], ["requirement"]);
    await stage3Classify.run(ctx, emptyState("t"));
    expect(listClaims(ctx.db, ctx.sessionId)[0]?.kind).toBe("requirement");
  });

  it("FORCES assumption when the quote is hedged, overriding the model", async () => {
    const { ctx } = setup(["we would probably want manager approval"], ["requirement"]);
    await stage3Classify.run(ctx, emptyState("t"));
    expect(listClaims(ctx.db, ctx.sessionId)[0]?.kind).toBe("assumption");
  });

  it("forces assumption for every hedge marker in the lexicon", async () => {
    const quotes = ["I think it is monthly", "typically we invoice weekly", "something like a dashboard"];
    const { ctx } = setup(quotes, ["requirement", "requirement", "requirement"]);
    await stage3Classify.run(ctx, emptyState("t"));
    for (const c of listClaims(ctx.db, ctx.sessionId)) expect(c.kind).toBe("assumption");
  });

  it("leaves ambiguity classifications alone", async () => {
    const { ctx } = setup(["it should be fast"], ["ambiguity"]);
    await stage3Classify.run(ctx, emptyState("t"));
    expect(listClaims(ctx.db, ctx.sessionId)[0]?.kind).toBe("ambiguity");
  });

  it("only classifies validated claims", async () => {
    const { ctx } = setup(["invoices must be approved"], ["requirement"]);
    const db = ctx.db;
    db.prepare("UPDATE claims SET status = 'quarantined'").run();
    await stage3Classify.run(ctx, emptyState("t"));
    expect(listClaims(db, ctx.sessionId, { status: "quarantined" })).toHaveLength(1);
  });

  it("discriminates quote from statement: hedged quote forces assumption even if statement is clean", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "x\n\ny" });
    freezeTranscript(db, transcript.id);
    const now = new Date().toISOString();
    const claimId = newId("clm");
    insertClaims(db, [{
      id: claimId,
      sessionId: s.id,
      transcriptId: transcript.id,
      segmentId: segments[0]!.id,
      quote: "we would probably want manager approval",
      statement: "manager approval is required",
      speakerRole: "client" as const,
      kind: "requirement" as const,
      status: "validated" as const,
      charStart: 0,
      charEnd: 1,
      matchMode: "exact" as const,
      createdAt: now,
    }]);
    const parse = vi.fn().mockResolvedValue({
      parsed_output: { classifications: [{ claimId, kind: "requirement" }] },
      content: [{ type: "text", text: "{}" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
    await stage3Classify.run(ctx, emptyState("t"));
    expect(listClaims(db, s.id)[0]?.kind).toBe("assumption");
  });

  it("does not force assumption when statement is hedged but quote is clean", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "x\n\ny" });
    freezeTranscript(db, transcript.id);
    const now = new Date().toISOString();
    const claimId = newId("clm");
    insertClaims(db, [{
      id: claimId,
      sessionId: s.id,
      transcriptId: transcript.id,
      segmentId: segments[0]!.id,
      quote: "invoices over ten thousand must go to a manager",
      statement: "we would probably want manager approval for large invoices",
      speakerRole: "client" as const,
      kind: "requirement" as const,
      status: "validated" as const,
      charStart: 0,
      charEnd: 1,
      matchMode: "exact" as const,
      createdAt: now,
    }]);
    const parse = vi.fn().mockResolvedValue({
      parsed_output: { classifications: [{ claimId, kind: "requirement" }] },
      content: [{ type: "text", text: "{}" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
    await stage3Classify.run(ctx, emptyState("t"));
    expect(listClaims(db, s.id)[0]?.kind).toBe("requirement");
  });

  it("batches claims in groups of 40, splitting large sets across multiple calls", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "x\n\ny" });
    freezeTranscript(db, transcript.id);
    const now = new Date().toISOString();
    const claimIds = Array.from({ length: 41 }, () => newId("clm"));
    insertClaims(db, claimIds.map((id) => ({
      id,
      sessionId: s.id,
      transcriptId: transcript.id,
      segmentId: segments[0]!.id,
      quote: "invoices must be approved",
      statement: "invoices must be approved",
      speakerRole: "client" as const,
      kind: "requirement" as const,
      status: "validated" as const,
      charStart: 0,
      charEnd: 1,
      matchMode: "exact" as const,
      createdAt: now,
    })));
    const parse = vi.fn().mockResolvedValue({
      parsed_output: { classifications: claimIds.map((id) => ({ claimId: id, kind: "requirement" })) },
      content: [{ type: "text", text: "{}" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
    await stage3Classify.run(ctx, emptyState("t"));
    expect(parse).toHaveBeenCalledTimes(2);
    const allClaims = listClaims(db, s.id);
    expect(allClaims).toHaveLength(41);
    for (const claim of allClaims) expect(claim.kind).toBe("requirement");
  });

  it("defaults to ambiguity when model response omits a classification", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "x\n\ny" });
    freezeTranscript(db, transcript.id);
    const now = new Date().toISOString();
    const claimIds = [newId("clm"), newId("clm")];
    insertClaims(db, claimIds.map((id) => ({
      id,
      sessionId: s.id,
      transcriptId: transcript.id,
      segmentId: segments[0]!.id,
      quote: "invoices must be approved",
      statement: "invoices must be approved",
      speakerRole: "client" as const,
      kind: "requirement" as const,
      status: "validated" as const,
      charStart: 0,
      charEnd: 1,
      matchMode: "exact" as const,
      createdAt: now,
    })));
    const parse = vi.fn().mockResolvedValue({
      parsed_output: { classifications: [{ claimId: claimIds[0], kind: "requirement" }] },
      content: [{ type: "text", text: "{}" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
    await stage3Classify.run(ctx, emptyState("t"));
    const claims = listClaims(db, s.id);
    expect(claims[0]?.kind).toBe("requirement");
    expect(claims[1]?.kind).toBe("ambiguity");
  });
});
