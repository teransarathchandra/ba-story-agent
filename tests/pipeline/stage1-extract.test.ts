import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { listClaims } from "../../src/store/claims.js";
import { ExtractedClaimsSchema, stage0Chunk, stage1Extract, applySpeakerRoleFloor } from "../../src/pipeline/stage1-extract.js";
import { emptyState, hydrateWindow } from "../../src/pipeline/state.js";
import { EXTRACT_SYSTEM, buildExtractUser } from "../../src/prompts/extract.js";
import type { StageContext } from "../../src/pipeline/runner.js";
import type { Window } from "../../src/pipeline/stage0-chunk.js";
import type { Project, Claim } from "../../src/types/domain.js";

const LONG = Array.from({ length: 40 }, (_, i) =>
  `Client: point number ${i} about invoice approval thresholds and routing rules for the logistics operator. We need to implement detailed requirements for threshold management including escalation procedures, approval chains, and exception handling in various scenarios. The system should support different approval workflows based on invoice amount, vendor classification, and business relationship history. We also need audit trails and compliance reporting.`,
).join("\n\n");

function setup(parsedOutputs: unknown[]) {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "B2B freight invoicing for EU logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript } = createTranscript(db, { sessionId: s.id, text: LONG });
  freezeTranscript(db, transcript.id);
  const parse = vi.fn();
  for (const out of parsedOutputs) {
    parse.mockResolvedValueOnce({
      raw: JSON.stringify(out),
      parsedOutput: out,
      requestPayload: {},
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  }
  // Fallback for any call beyond the explicit queue above — e.g. the
  // zero-coverage retry firing on a window whose queued response was empty
  // but the caller didn't also queue a retry response. Tests that care about
  // exact call counts for the retry itself build their own full queue via
  // setupSingleWindow() below instead of this shared helper.
  parse.mockResolvedValue({
    raw: "{}", parsedOutput: { claims: [] },
    requestPayload: {}, usage: { input_tokens: 10, output_tokens: 5 },
  });
  const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
  return { ctx, transcriptId: transcript.id, parse };
}

describe("EXTRACT_SYSTEM", () => {
  it("forbids emitting a claim without a quote", () => {
    expect(EXTRACT_SYSTEM).toMatch(/cannot quote it, do not emit/i);
  });

  it("does not ask the model for character offsets", () => {
    expect(EXTRACT_SYSTEM).not.toMatch(/charStart|character offset|charEnd/i);
  });
});

describe("ExtractedClaimsSchema", () => {
  it("has no field for character offsets", () => {
    const inner = ExtractedClaimsSchema.shape.claims.element.shape;
    expect(Object.keys(inner)).not.toContain("charStart");
    expect(Object.keys(inner)).not.toContain("charEnd");
  });
});

describe("stage0Chunk + stage1Extract", () => {
  it("rejects a transcript shorter than 200 words", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: "too short" });
    freezeTranscript(db, transcript.id);
    const ctx: StageContext = { db, client: {} as never, projectId: p.id, sessionId: s.id };
    await expect(stage0Chunk.run(ctx, { transcriptId: transcript.id })).rejects.toThrow(/200 words/);
  });

  it("persists extracted claims as candidates", async () => {
    const { ctx, transcriptId } = setup([
      { claims: [{ quote: "point number 0 about invoice approval thresholds", statement: "There is an approval threshold.", segmentId: "IGNORED", speakerRole: "client" }] },
      { claims: [] },
    ]);
    const state = await stage0Chunk.run(ctx, { transcriptId });
    const after = await stage1Extract.run(ctx, state);
    const claims = listClaims(ctx.db, ctx.sessionId);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.status).toBe("candidate");
    expect(after.extracted).toBe(1);
  });

  it("calls the model once per window when each returns real claims", async () => {
    // A window with real (non-empty) output should not trigger the
    // zero-coverage retry below — this only verifies "one call per window,"
    // not "one call regardless of yield."
    const claimOut = {
      claims: [{ quote: "point number 0 about invoice approval thresholds", statement: "There is an approval threshold.", segmentId: "IGNORED", speakerRole: "client" }],
    };
    const { ctx, transcriptId, parse } = setup([claimOut, claimOut, claimOut, claimOut]);
    const state = await stage0Chunk.run(ctx, { transcriptId });
    expect(state.windows.length).toBeGreaterThan(1); // Guard: fixture spans multiple windows
    await stage1Extract.run(ctx, state);
    expect(parse).toHaveBeenCalledTimes(state.windows.length);
  });
});

describe("stage1Extract zero-coverage retry", () => {
  // Short enough to guarantee exactly one window (target is 2000 words),
  // long enough to clear stage0Chunk's 200-word minimum.
  const SHORT = Array.from({ length: 30 }, (_, i) =>
    `Client: point number ${i} about invoice approval thresholds and routing rules.`,
  ).join("\n\n");

  function setupSingleWindow() {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "B2B freight invoicing for EU logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: SHORT });
    freezeTranscript(db, transcript.id);
    const generate = vi.fn();
    const ctx: StageContext = { db, client: { model: "test", generate } as never, projectId: p.id, sessionId: s.id };
    return { ctx, transcriptId: transcript.id, generate };
  }

  it("retries a window that comes back with zero claims, and applies the retry's real result", async () => {
    const { ctx, transcriptId, generate } = setupSingleWindow();
    const state = await stage0Chunk.run(ctx, { transcriptId });
    expect(state.windows.length).toBe(1); // Guard: fixture fits in one window

    // Mirrors stage3-classify.test.ts's zero-coverage retry test: first call
    // degenerates to an empty claims array (the local model's known failure
    // mode — see isDegenerateEmpty in src/llm/local-client.ts, and the
    // direct repro in scripts/repro-window1-extract.ts), second call
    // succeeds.
    generate
      .mockResolvedValueOnce({
        raw: "{}", parsedOutput: { claims: [] },
        requestPayload: {}, usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockResolvedValueOnce({
        raw: "{}",
        parsedOutput: {
          claims: [{ quote: "point number 0 about invoice approval thresholds", statement: "There is an approval threshold.", segmentId: "IGNORED", speakerRole: "client" }],
        },
        requestPayload: {}, usage: { input_tokens: 1, output_tokens: 1 },
      });

    const after = await stage1Extract.run(ctx, state);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(after.extracted).toBe(1);
    expect(after.extractFailures).toBe(0);
  });

  it("marks extractFailures and leaves the window empty when the retry ALSO comes back empty", async () => {
    const { ctx, transcriptId, generate } = setupSingleWindow();
    const state = await stage0Chunk.run(ctx, { transcriptId });
    expect(state.windows.length).toBe(1);

    generate.mockResolvedValue({
      raw: "{}", parsedOutput: { claims: [] },
      requestPayload: {}, usage: { input_tokens: 1, output_tokens: 1 },
    });

    const after = await stage1Extract.run(ctx, state);

    // One retry attempt per window, not an unbounded loop.
    expect(generate).toHaveBeenCalledTimes(2);
    expect(after.extracted).toBe(0);
    expect(after.extractFailures).toBe(1);
  });

  it("retries each window independently and counts failures cumulatively across windows", async () => {
    // Three disjoint segment groups, manually assembled into three
    // WindowRefs, so each window's outcome (immediate success / recover on
    // retry / fail after retry) can be controlled precisely regardless of
    // stage0Chunk's real windowing thresholds.
    const MULTI = Array.from({ length: 45 }, (_, i) =>
      `Client: point number ${i} about invoice approval thresholds and routing rules.`,
    ).join("\n\n");
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "B2B freight invoicing for EU logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: MULTI });
    freezeTranscript(db, transcript.id);

    const segRows = db
      .prepare("SELECT id, char_start as charStart, char_end as charEnd FROM segments WHERE transcript_id = ? ORDER BY idx")
      .all(transcript.id) as { id: string; charStart: number; charEnd: number }[];
    expect(segRows.length).toBe(45); // Guard: one segment per line

    const groups = [segRows.slice(0, 15), segRows.slice(15, 30), segRows.slice(30, 45)];
    const windows = groups.map((g, idx) => ({
      idx,
      segmentIds: g.map((r) => r.id),
      charStart: g[0]!.charStart,
      charEnd: g[g.length - 1]!.charEnd,
    }));

    const generate = vi.fn();
    const ctx: StageContext = { db, client: { model: "test", generate } as never, projectId: p.id, sessionId: s.id };
    const state = { ...emptyState(transcript.id), windows };

    const claimResponse = (n: number) => ({
      raw: "{}",
      parsedOutput: {
        claims: [{ quote: `point number ${n} about invoice approval thresholds`, statement: "There is an approval threshold.", segmentId: "IGNORED", speakerRole: "client" }],
      },
      requestPayload: {}, usage: { input_tokens: 1, output_tokens: 1 },
    });
    const emptyResponse = {
      raw: "{}", parsedOutput: { claims: [] },
      requestPayload: {}, usage: { input_tokens: 1, output_tokens: 1 },
    };

    generate
      .mockResolvedValueOnce(claimResponse(0)) // window 0: succeeds immediately, no retry
      .mockResolvedValueOnce(emptyResponse) // window 1: empty, then recovers on retry
      .mockResolvedValueOnce(claimResponse(15))
      .mockResolvedValueOnce(emptyResponse) // window 2: empty on both attempts, stays failed
      .mockResolvedValueOnce(emptyResponse);

    const after = await stage1Extract.run(ctx, state);

    expect(generate).toHaveBeenCalledTimes(5); // 1 + 2 + 2
    expect(after.extracted).toBe(2); // window 0's claim + window 1's recovered claim
    expect(after.extractFailures).toBe(1); // only window 2 stayed empty after its retry

    // Verify each call actually carried its OWN window's exact content, not
    // just that the queue was drained in the right order — a retry that
    // accidentally reused another window's prompt would still pass the
    // count/total assertions above. Compare each call's `user` field against
    // the real buildExtractUser() output for its window (the same function
    // stage1-extract.ts itself calls), rather than substring checks that a
    // partially-wrong prompt (e.g. one window's text mixed into another's)
    // could still slip past.
    const expectedPrompts = windows.map((ref) =>
      buildExtractUser(hydrateWindow(db, transcript.text, ref), p),
    );
    const calls = generate.mock.calls.map((c) => (c[0] as { user: string }).user);
    expect(calls[0]).toBe(expectedPrompts[0]); // window 0, single call
    expect(calls[1]).toBe(expectedPrompts[1]); // window 1, initial call
    expect(calls[2]).toBe(expectedPrompts[1]); // window 1, retry — identical prompt
    expect(calls[3]).toBe(expectedPrompts[2]); // window 2, initial call
    expect(calls[4]).toBe(expectedPrompts[2]); // window 2, retry — identical prompt
    // Guard against a degenerate test where every window's prompt happens to
    // be identical (e.g. a bug in the group-slicing above).
    expect(new Set(expectedPrompts).size).toBe(3);
  });
});

describe("EXTRACT_SYSTEM confirmation rule", () => {
  it("instructs extracting a claim from an analyst-proposal + client-confirmation exchange", () => {
    expect(EXTRACT_SYSTEM).toMatch(/unhedged confirmation/i);
  });

  it("tells the model to use the segment's speaker label instead of guessing", () => {
    expect(EXTRACT_SYSTEM).toMatch(/\[speaker:/);
  });

  it("tells the model speakerRole is a role, not the speaker's name, and to derive it from context", () => {
    expect(EXTRACT_SYSTEM).toMatch(/not a role/i);
    expect(EXTRACT_SYSTEM).not.toMatch(/set speakerRole — do not guess/i);
  });

  it("tells the model not to extract a claim when the confirmed proposal was to leave something unresolved", () => {
    expect(EXTRACT_SYSTEM).toMatch(/unresolved|deferred|not.{0,10}yet.{0,10}decided/i);
  });
});

describe("buildExtractUser", () => {
  it("includes each segment's speaker label in the prompt", () => {
    const window: Window = {
      idx: 0,
      charStart: 0,
      text: "Maya: hello\n\nSarah: hi",
      segments: [
        { id: "seg_1", transcriptId: "t", idx: 0, startMs: null, endMs: null, speakerLabel: "Maya", text: "Maya: hello", charStart: 0, charEnd: 11 },
        { id: "seg_2", transcriptId: "t", idx: 1, startMs: null, endMs: null, speakerLabel: "Sarah", text: "Sarah: hi", charStart: 13, charEnd: 22 },
      ],
    };
    const project = { domain: "salon scheduling", glossary: null } as Project;
    const user = buildExtractUser(window, project);
    expect(user).toContain("[speaker: Maya]");
    expect(user).toContain("[speaker: Sarah]");
  });

  it('falls back to "unknown" when a segment has no speaker label', () => {
    const window: Window = {
      idx: 0,
      charStart: 0,
      text: "just text",
      segments: [
        { id: "seg_1", transcriptId: "t", idx: 0, startMs: null, endMs: null, speakerLabel: null, text: "just text", charStart: 0, charEnd: 9 },
      ],
    };
    const project = { domain: "salon scheduling", glossary: null } as Project;
    const user = buildExtractUser(window, project);
    expect(user).toContain("[speaker: unknown]");
  });
});

describe("applySpeakerRoleFloor", () => {
  it("forces every claim from a speaker label to that label's majority role", () => {
    const claims = [
      { id: "c1", segmentId: "seg_1", speakerRole: "client" },
      { id: "c2", segmentId: "seg_1", speakerRole: "ba" },
      { id: "c3", segmentId: "seg_1", speakerRole: "ba" },
    ] as unknown as Claim[];
    const labels = new Map<string, string | null>([["seg_1", "Maya"]]);
    applySpeakerRoleFloor(claims, labels);
    expect(claims.map((c) => c.speakerRole)).toEqual(["ba", "ba", "ba"]);
  });

  it("leaves claims alone when their segment has no parsed speaker label", () => {
    const claims = [{ id: "c1", segmentId: "seg_1", speakerRole: "client" }] as unknown as Claim[];
    const labels = new Map<string, string | null>([["seg_1", null]]);
    applySpeakerRoleFloor(claims, labels);
    expect(claims[0]?.speakerRole).toBe("client");
  });

  it("applies a session override, taking priority over the majority vote", () => {
    const claims = [
      { id: "c1", segmentId: "seg_1", speakerRole: "client" },
      { id: "c2", segmentId: "seg_1", speakerRole: "client" },
    ] as unknown as Claim[];
    const labels = new Map<string, string | null>([["seg_1", "Kevin"]]);
    const overrides = new Map<string, Claim["speakerRole"]>([["Kevin", "ba"]]);
    applySpeakerRoleFloor(claims, labels, undefined, overrides);
    expect(claims.map((c) => c.speakerRole)).toEqual(["ba", "ba"]);
  });

  it("applies a session override even against a unanimous wrong vote", () => {
    const claims = [
      { id: "c1", segmentId: "seg_maya", speakerRole: "client" },
      { id: "c2", segmentId: "seg_maya", speakerRole: "client" },
      { id: "c3", segmentId: "seg_maya", speakerRole: "client" },
    ] as unknown as Claim[];
    const labels = new Map<string, string | null>([["seg_maya", "Maya"]]);
    const overrides = new Map<string, Claim["speakerRole"]>([["Maya", "ba"]]);
    applySpeakerRoleFloor(claims, labels, undefined, overrides);
    expect(claims.map((c) => c.speakerRole)).toEqual(["ba", "ba", "ba"]);
  });

  it("leaves ordinary majority-vote labels untouched when they have no session override", () => {
    const claims = [
      { id: "c1", segmentId: "seg_maya", speakerRole: "ba" },
      { id: "c2", segmentId: "seg_sarah1", speakerRole: "client" },
      { id: "c3", segmentId: "seg_sarah2", speakerRole: "ba" },
      { id: "c4", segmentId: "seg_sarah3", speakerRole: "client" },
    ] as unknown as Claim[];
    const labels = new Map<string, string | null>([
      ["seg_maya", "Maya"],
      ["seg_sarah1", "Sarah"], ["seg_sarah2", "Sarah"], ["seg_sarah3", "Sarah"],
    ]);
    const overrides = new Map<string, Claim["speakerRole"]>([["Maya", "ba"]]);
    applySpeakerRoleFloor(claims, labels, undefined, overrides);
    // Maya's override wins (redundant with her existing role here, but proves
    // the override path). Sarah has no override, so ordinary majority vote
    // (2 client vs 1 ba) still resolves her claims to "client".
    expect(claims.map((c) => c.speakerRole)).toEqual(["ba", "client", "client", "client"]);
  });

  it("has no effect when sessionOverrides is omitted (backward compatible)", () => {
    const claims = [{ id: "c1", segmentId: "seg_1", speakerRole: "client" }] as unknown as Claim[];
    const labels = new Map<string, string | null>([["seg_1", "Kevin"]]);
    applySpeakerRoleFloor(claims, labels);
    expect(claims[0]?.speakerRole).toBe("client");
  });

  it("has no effect when sessionOverrides is an empty Map", () => {
    const claims = [{ id: "c1", segmentId: "seg_1", speakerRole: "client" }] as unknown as Claim[];
    const labels = new Map<string, string | null>([["seg_1", "Kevin"]]);
    applySpeakerRoleFloor(claims, labels, undefined, new Map());
    expect(claims[0]?.speakerRole).toBe("client");
  });

  it("breaks a tie in favor of the first-listed role (client)", () => {
    const claims = [
      { id: "c1", segmentId: "seg_1", speakerRole: "client" },
      { id: "c2", segmentId: "seg_1", speakerRole: "ba" },
    ] as unknown as Claim[];
    const labels = new Map<string, string | null>([["seg_1", "Kevin"]]);
    applySpeakerRoleFloor(claims, labels);
    expect(claims.map((c) => c.speakerRole)).toEqual(["client", "client"]);
  });

  it("votes independently per speaker label", () => {
    const claims = [
      { id: "c1", segmentId: "seg_maya", speakerRole: "ba" },
      { id: "c2", segmentId: "seg_maya", speakerRole: "ba" },
      { id: "c3", segmentId: "seg_sarah", speakerRole: "client" },
    ] as unknown as Claim[];
    const labels = new Map<string, string | null>([
      ["seg_maya", "Maya"],
      ["seg_sarah", "Sarah"],
    ]);
    applySpeakerRoleFloor(claims, labels);
    expect(claims.map((c) => c.speakerRole)).toEqual(["ba", "ba", "client"]);
  });

  it("overrides the vote for the first-speaker label even against a unanimous wrong vote", () => {
    const claims = [
      { id: "c1", segmentId: "seg_maya1", speakerRole: "client" },
      { id: "c2", segmentId: "seg_maya2", speakerRole: "client" },
      { id: "c3", segmentId: "seg_maya3", speakerRole: "client" },
    ] as unknown as Claim[];
    const labels = new Map<string, string | null>([
      ["seg_maya1", "Maya"], ["seg_maya2", "Maya"], ["seg_maya3", "Maya"],
    ]);
    applySpeakerRoleFloor(claims, labels, "Maya");
    expect(claims.map((c) => c.speakerRole)).toEqual(["ba", "ba", "ba"]);
  });

  it("leaves normal majority voting alone for every label other than the first speaker", () => {
    const claims = [
      { id: "c1", segmentId: "seg_maya", speakerRole: "client" },
      { id: "c2", segmentId: "seg_sarah1", speakerRole: "client" },
      { id: "c3", segmentId: "seg_sarah2", speakerRole: "ba" },
      { id: "c4", segmentId: "seg_sarah3", speakerRole: "client" },
    ] as unknown as Claim[];
    const labels = new Map<string, string | null>([
      ["seg_maya", "Maya"],
      ["seg_sarah1", "Sarah"], ["seg_sarah2", "Sarah"], ["seg_sarah3", "Sarah"],
    ]);
    applySpeakerRoleFloor(claims, labels, "Maya");
    // Maya's single claim is overridden to "ba" regardless of its own vote.
    // Sarah's 3 claims are untouched by the override and still resolve by
    // ordinary majority vote (2 client vs 1 ba -> client).
    expect(claims.map((c) => c.speakerRole)).toEqual(["ba", "client", "client", "client"]);
  });

  it("has no effect when firstSpeakerLabel is omitted (backward compatible)", () => {
    const claims = [{ id: "c1", segmentId: "seg_1", speakerRole: "client" }] as unknown as Claim[];
    const labels = new Map<string, string | null>([["seg_1", "Maya"]]);
    applySpeakerRoleFloor(claims, labels);
    expect(claims[0]?.speakerRole).toBe("client"); // unchanged: majority-of-one, no override requested
  });
});
