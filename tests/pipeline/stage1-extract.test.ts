import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { listClaims } from "../../src/store/claims.js";
import { ExtractedClaimsSchema, stage0Chunk, stage1Extract } from "../../src/pipeline/stage1-extract.js";
import { EXTRACT_SYSTEM } from "../../src/prompts/extract.js";
import type { StageContext } from "../../src/pipeline/runner.js";

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

  it("calls the model once per window", async () => {
    const { ctx, transcriptId, parse } = setup([{ claims: [] }, { claims: [] }, { claims: [] }, { claims: [] }]);
    const state = await stage0Chunk.run(ctx, { transcriptId });
    expect(state.windows.length).toBeGreaterThan(1); // Guard: fixture spans multiple windows
    await stage1Extract.run(ctx, state);
    expect(parse).toHaveBeenCalledTimes(state.windows.length);
  });
});
