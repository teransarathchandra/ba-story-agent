import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { listClaims } from "../../src/store/claims.js";
import { ExtractedClaimsSchema, stage0Chunk, stage1Extract, applySpeakerRoleFloor } from "../../src/pipeline/stage1-extract.js";
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
});
