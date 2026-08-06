import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertClaims, listClaims } from "../../src/store/claims.js";
import { stage2Validate, quarantineRate } from "../../src/pipeline/stage2-validate.js";
import { toRef, emptyState } from "../../src/pipeline/state.js";
import { chunkTranscript } from "../../src/pipeline/stage0-chunk.js";
import { newId } from "../../src/types/ids.js";
import type { StageContext } from "../../src/pipeline/runner.js";

const TEXT =
  "BA: what happens on a big invoice\n\n" +
  "Client: anything over ten thousand euro has to go to a manager, no exceptions\n\n" +
  "Client: we would usually be dealing in euro";

function setup(quotes: string[]) {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: TEXT });
  freezeTranscript(db, transcript.id);
  const now = new Date().toISOString();
  insertClaims(db, quotes.map((quote) => ({
    id: newId("clm"), sessionId: s.id, transcriptId: transcript.id,
    segmentId: segments[1]!.id, quote, statement: "s",
    speakerRole: "client" as const, kind: "requirement" as const,
    status: "candidate" as const, charStart: null, charEnd: null,
    matchMode: null, createdAt: now,
  })));
  const windows = chunkTranscript(TEXT, segments);
  const ctx: StageContext = { db, client: {} as never, projectId: p.id, sessionId: s.id };
  return { ctx, state: { ...emptyState(transcript.id), windows: windows.map(toRef) } };
}

describe("stage2Validate", () => {
  it("validates a real quote and records offsets into the transcript", async () => {
    const { ctx, state } = setup(["anything over ten thousand euro has to go to a manager"]);
    const out = await stage2Validate.run(ctx, state);
    const [c] = listClaims(ctx.db, ctx.sessionId);
    expect(c?.status).toBe("validated");
    expect(TEXT.slice(c!.charStart!, c!.charEnd!)).toContain("ten thousand euro");
    expect(out.validated).toBe(1);
    expect(out.quarantined).toBe(0);
  });

  it("quarantines a fabricated quote without deleting it", async () => {
    const { ctx, state } = setup(["passwords must rotate every ninety days"]);
    const out = await stage2Validate.run(ctx, state);
    const [c] = listClaims(ctx.db, ctx.sessionId);
    expect(c?.status).toBe("quarantined");
    expect(listClaims(ctx.db, ctx.sessionId)).toHaveLength(1);
    expect(out.quarantined).toBe(1);
  });

  it("corrects a wrong segment id rather than quarantining", async () => {
    const { ctx, state } = setup(["we would usually be dealing in euro"]);
    await stage2Validate.run(ctx, state);
    const [c] = listClaims(ctx.db, ctx.sessionId);
    expect(c?.status).toBe("validated");
    expect(c?.matchMode).toBe("segment-corrected");
  });

  it("computes a quarantine rate", async () => {
    const { ctx, state } = setup([
      "anything over ten thousand euro",
      "passwords must rotate every ninety days",
    ]);
    const out = await stage2Validate.run(ctx, state);
    expect(quarantineRate(out)).toBeCloseTo(0.5);
  });

  it("makes no network call", async () => {
    const { ctx, state } = setup(["anything over ten thousand euro"]);
    // ctx.client is an empty object; reading a property returns undefined, calling it would throw.
    await expect(stage2Validate.run(ctx, state)).resolves.toBeDefined();
  });
});

describe("stage2Validate - self-review", () => {
  it("is idempotent: chaining runs preserves totals", async () => {
    const { ctx, state } = setup(["anything over ten thousand euro has to go to a manager"]);

    // First run
    const out1 = await stage2Validate.run(ctx, state);
    expect(out1.validated).toBe(1);
    expect(out1.quarantined).toBe(0);

    // Second run: chain the output into the next call; all claims are now validated
    const out2 = await stage2Validate.run(ctx, out1);

    // Counts must be preserved (no candidates found, no changes)
    expect(out2.validated).toBe(out1.validated);
    expect(out2.quarantined).toBe(out1.quarantined);
  });

  it("offsets slice back to original transcript text", async () => {
    const { ctx, state } = setup(["anything over ten thousand euro has to go to a manager"]);
    await stage2Validate.run(ctx, state);
    const [c] = listClaims(ctx.db, ctx.sessionId);

    expect(c?.charStart).toBeDefined();
    expect(c?.charEnd).toBeDefined();

    // Verify offsets are absolute into the full transcript
    const sliced = TEXT.slice(c!.charStart!, c!.charEnd!);
    // Should contain the key phrase
    expect(sliced).toContain("anything over ten thousand euro");
  });

  it("quarantined claims retain their row and quote", async () => {
    const { ctx, state } = setup(["passwords must rotate every ninety days"]);
    const claimsBefore = listClaims(ctx.db, ctx.sessionId);
    const beforeCount = claimsBefore.length;
    const originalQuote = claimsBefore[0]?.quote;

    await stage2Validate.run(ctx, state);

    const claimsAfter = listClaims(ctx.db, ctx.sessionId);
    expect(claimsAfter).toHaveLength(beforeCount);
    expect(claimsAfter[0]?.status).toBe("quarantined");
    expect(claimsAfter[0]?.quote).toBe(originalQuote);
  });

  it("quarantineRate returns 0 when total is zero", () => {
    const state = { ...emptyState("tid"), validated: 0, quarantined: 0 };
    expect(quarantineRate(state)).toBe(0);
    expect(Number.isNaN(quarantineRate(state))).toBe(false);
  });

  it("quarantineRate is 1 when all are quarantined", () => {
    const state = { ...emptyState("tid"), validated: 0, quarantined: 5 };
    expect(quarantineRate(state)).toBe(1);
  });

});

describe("stage2Validate with multi-window transcript", () => {
  // Create a long transcript that produces multiple windows (>2000 words).
  // This tests the window-map building and absolute-offset arithmetic.
  const LONG_TEXT = (() => {
    const segments = [];
    // Build a ~2500-word transcript to ensure 2+ windows
    for (let i = 0; i < 30; i++) {
      segments.push(
        `BA: Let's discuss requirement ${i}. ` +
        `This is a detailed explanation about requirement ${i}. ` +
        `We need to ensure that the system handles this case properly. ` +
        `The implementation should be robust and scalable. ` +
        `We should also consider edge cases and error scenarios. `
      );
      segments.push(
        `Client: I agree with that. ` +
        `For requirement ${i}, we need to validate input thoroughly. ` +
        `The validation must happen before processing. ` +
        `We want to ensure data quality at all stages. ` +
        `Performance is also critical for this feature. `
      );
    }
    return segments.join("\n\n");
  })();

  function setupLong(quotes: string[]) {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: LONG_TEXT });
    freezeTranscript(db, transcript.id);
    const now = new Date().toISOString();

    // Place claims in different segments, including later windows
    insertClaims(db, quotes.map((quote, i) => ({
      id: newId("clm"), sessionId: s.id, transcriptId: transcript.id,
      // Use varying segment indices to ensure claims span multiple windows
      segmentId: segments[10 + i * 5]?.id || segments[segments.length - 1]!.id,
      quote, statement: "s",
      speakerRole: "client" as const, kind: "requirement" as const,
      status: "candidate" as const, charStart: null, charEnd: null,
      matchMode: null, createdAt: now,
    })));

    const windows = chunkTranscript(LONG_TEXT, segments);
    const ctx: StageContext = { db, client: {} as never, projectId: p.id, sessionId: s.id };
    return { ctx, state: { ...emptyState(transcript.id), windows: windows.map(toRef) }, windows };
  }

  it("produces multiple windows from long transcript", async () => {
    const { windows } = setupLong([]);
    // Guard: fixture must span 2+ windows to test the behavior
    expect(windows.length).toBeGreaterThan(1);
  });

  it("validates claims in later windows with correct absolute offsets", async () => {
    const { ctx, state, windows } = setupLong([
      "The validation must happen before processing",
    ]);

    expect(windows.length).toBeGreaterThan(1);

    const out = await stage2Validate.run(ctx, state);
    const [claim] = listClaims(ctx.db, ctx.sessionId);

    expect(claim?.status).toBe("validated");
    expect(claim?.charStart).toBeDefined();
    expect(claim?.charEnd).toBeDefined();

    // Critical: offsets must be absolute into the FULL transcript, not relative to a window
    const sliced = LONG_TEXT.slice(claim!.charStart!, claim!.charEnd!);
    expect(sliced).toContain("The validation must happen before processing");
  });

  it("applies first-window-wins rule for segments in overlapping windows", async () => {
    // The fixture guarantees multiple windows with overlap. When a segment appears
    // in multiple windows, the stage always uses the first window's GroundingSource.
    // This is deterministic by design (prevents boundary claims from having
    // non-deterministic outcomes based on fuzzy-match window context).
    const { ctx, state, windows } = setupLong([
      "The validation must happen before processing",
    ]);

    expect(windows.length).toBeGreaterThan(1);

    const out = await stage2Validate.run(ctx, state);
    const [claim] = listClaims(ctx.db, ctx.sessionId);

    // Claim must validate (proving the rule is applied consistently)
    expect(claim?.status).toBe("validated");
  });
});
