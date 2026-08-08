import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript, getFrozenTranscript } from "../../src/store/transcripts.js";
import { insertClaims, listClaims } from "../../src/store/claims.js";
import { stage3Classify } from "../../src/pipeline/stage3-classify.js";
import { emptyState } from "../../src/pipeline/state.js";
import { newId } from "../../src/types/ids.js";
import { CLASSIFY_SYSTEM } from "../../src/prompts/classify.js";
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
    raw: "{}",
    parsedOutput: { classifications: modelKinds.map((kind, i) => ({ index: i + 1, kind })) },
    requestPayload: {},
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
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
      raw: "{}",
      parsedOutput: { classifications: [{ index: 1, kind: "requirement" }] },
      requestPayload: {},
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
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
      raw: "{}",
      parsedOutput: { classifications: [{ index: 1, kind: "requirement" }] },
      requestPayload: {},
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
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
      raw: "{}",
      parsedOutput: { classifications: Array.from({ length: 40 }, (_, i) => ({ index: i + 1, kind: "requirement" })) },
      requestPayload: {},
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
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
      raw: "{}",
      parsedOutput: { classifications: [{ index: 1, kind: "requirement" }] },
      requestPayload: {},
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    await stage3Classify.run(ctx, emptyState("t"));
    const claims = listClaims(db, s.id);
    expect(claims[0]?.kind).toBe("requirement");
    expect(claims[1]?.kind).toBe("ambiguity");
  });

  it("does not abort the stage when the model emits a 0-based index instead of 1-based", async () => {
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
      statement: "invoices over ten thousand must go to a manager",
      speakerRole: "client" as const,
      kind: "requirement" as const,
      status: "validated" as const,
      charStart: 0,
      charEnd: 1,
      matchMode: "exact" as const,
      createdAt: now,
    }]);
    const parse = vi.fn().mockResolvedValue({
      raw: "{}",
      parsedOutput: { classifications: [{ index: 0, kind: "requirement" }] },
      requestPayload: {},
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    // Should not throw or abort; should complete normally.
    await expect(stage3Classify.run(ctx, emptyState("t"))).resolves.toBeDefined();
    const [claim] = listClaims(db, ctx.sessionId);
    // index 0 matches nothing (real claims are indexed from 1), so it falls
    // through to the default rather than aborting the stage.
    expect(claim?.kind).toBe("ambiguity");
  });
});

describe("CLASSIFY_SYSTEM", () => {
  it("gives the model an honest home for a plain current-state description", () => {
    expect(CLASSIFY_SYSTEM).toMatch(/current state|today's process|happens now/i);
  });
});

describe("stage3Classify speaker-role floor", () => {
  it("corrects speakerRole using the claim's FINAL (post-grounding) segment, not a stale pre-validation one", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "salon scheduling" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const text = "Maya: How do staff schedules work?\n\nKevin: Usually 9 to 6.";
    const { transcript, segments } = createTranscript(db, { sessionId: s.id, text });
    freezeTranscript(db, transcript.id);

    // Simulates the real bug: the extraction model quoted Maya's own
    // question but tagged it speakerRole "client", AND the segmentId now
    // on the claim (post-grounding correction) is Maya's segment — this is
    // the state a claim is actually in by the time stage3Classify runs, in
    // both the real bug and this reproduction.
    //
    // applySpeakerRoleFloor (unchanged by this task) is a majority vote
    // across every claim sharing a segment label, not a per-claim rule — a
    // single claim can never out-vote itself. The two sibling claims below,
    // both correctly tagged "ba" from Maya's own segment, are what actually
    // produced the majority signal in the real session (Maya's segment
    // yielded several claims; only this one quote was mistagged) and is
    // what this in-memory reproduction needs to give the floor a real
    // majority to act on.
    const now = new Date().toISOString();
    const claimId = newId("clm");
    insertClaims(db, [
      {
        id: claimId, sessionId: s.id, transcriptId: transcript.id,
        segmentId: segments[0]!.id, // Maya's segment
        quote: "How do staff schedules work?", statement: "how staff schedules work",
        speakerRole: "client" as const, // wrong, as extracted
        kind: "requirement" as const, status: "validated" as const,
        charStart: 0, charEnd: 1, matchMode: "segment-corrected" as const, createdAt: now,
      },
      {
        id: newId("clm"), sessionId: s.id, transcriptId: transcript.id,
        segmentId: segments[0]!.id, // Maya's segment, correctly tagged "ba"
        quote: "How do staff schedules work?", statement: "asks how staff schedules work",
        speakerRole: "ba" as const,
        kind: "requirement" as const, status: "validated" as const,
        charStart: 0, charEnd: 1, matchMode: "exact" as const, createdAt: now,
      },
      {
        id: newId("clm"), sessionId: s.id, transcriptId: transcript.id,
        segmentId: segments[0]!.id, // Maya's segment, correctly tagged "ba"
        quote: "How do staff schedules work?", statement: "wants to understand staff scheduling",
        speakerRole: "ba" as const,
        kind: "requirement" as const, status: "validated" as const,
        charStart: 0, charEnd: 1, matchMode: "exact" as const, createdAt: now,
      },
    ]);

    const parse = vi.fn().mockResolvedValue({
      raw: "{}",
      parsedOutput: { classifications: [{ index: 1, kind: "ambiguity" }] },
      requestPayload: {}, usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    await stage3Classify.run(ctx, emptyState("t"));

    const [claim] = listClaims(db, s.id);
    expect(claim?.speakerRole).toBe("ba");
  });

  it("leaves speakerRole unchanged when the claim's segment has no parsed speaker label", async () => {
    const { ctx, ids } = setup(["it should be fast"], ["ambiguity"]);
    // setup()'s transcript text ("x\n\ny") has no "Name: " prefix, so segments
    // have speakerLabel: null — the floor must not touch anything here.
    await stage3Classify.run(ctx, emptyState("t"));
    const [claim] = listClaims(ctx.db, ctx.sessionId);
    expect(claim?.speakerRole).toBe("client"); // unchanged from setup()'s default
    expect(ids).toHaveLength(1); // guard: setup() ran as expected
  });

  it("corrects a speaker the model was wrong about on every single claim, via the first-speaker override", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "salon scheduling" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const text =
      "Maya: Okay, thanks everyone. The main thing I want to understand today is how appointments work.\n\n" +
      "Sarah: Sure, happy to explain.\n\n" +
      "Maya: How do staff schedules work?\n\n" +
      "Kevin: Usually 9 to 6.\n\n" +
      "Maya: Walk me through what the customer needs to select.\n\n" +
      "Sarah: Service, staff, date, time.";
    const { transcript, segments } = createTranscript(db, { sessionId: s.id, text });
    freezeTranscript(db, transcript.id);

    // All three of Maya's claims are wrongly tagged "client" by "extraction" —
    // reproducing the real bug's 3-for-0 systematic bias, unfixable by
    // ordinary majority voting alone.
    const now = new Date().toISOString();
    const mayaSegmentIndices = segments
      .map((seg, i) => ({ seg, i }))
      .filter(({ seg }) => seg.speakerLabel === "Maya")
      .map(({ i }) => i);
    insertClaims(db, mayaSegmentIndices.map((i) => ({
      id: newId("clm"), sessionId: s.id, transcriptId: transcript.id,
      segmentId: segments[i]!.id, quote: segments[i]!.text.replace(/^Maya:\s*/, ""),
      statement: "s", speakerRole: "client" as const, kind: "requirement" as const,
      status: "validated" as const, charStart: 0, charEnd: 1,
      matchMode: "exact" as const, createdAt: now,
    })));

    const parse = vi.fn().mockResolvedValue({
      raw: "{}",
      parsedOutput: { classifications: mayaSegmentIndices.map((_, i) => ({ index: i + 1, kind: "ambiguity" })) },
      requestPayload: {}, usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    await stage3Classify.run(ctx, emptyState("t"));

    const claims = listClaims(db, s.id);
    expect(claims.length).toBeGreaterThan(0); // guard: fixture produced Maya claims
    for (const claim of claims) expect(claim.speakerRole).toBe("ba");
  });
});
