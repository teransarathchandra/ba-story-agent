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
    // ctx.client is an empty object; any property access would throw.
    await expect(stage2Validate.run(ctx, state)).resolves.toBeDefined();
  });
});
