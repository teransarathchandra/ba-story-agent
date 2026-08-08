// tests/pipeline/stage8-assemble.test.ts
import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession, getSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { stage8Assemble } from "../../src/pipeline/stage8-assemble.js";
import { ALL_STAGES, analyzeSession } from "../../src/pipeline/index.js";
import { emptyState } from "../../src/pipeline/state.js";
import type { StageContext } from "../../src/pipeline/runner.js";

const LONG = Array.from({ length: 30 }, (_, i) =>
  `Client: statement number ${i} about invoice approval thresholds and routing rules in detail`,
).join("\n\n");

describe("stage8Assemble", () => {
  it("marks the session awaiting-review", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: LONG });
    freezeTranscript(db, transcript.id);
    const ctx: StageContext = { db, client: {} as never, projectId: p.id, sessionId: s.id };
    await stage8Assemble.run(ctx, emptyState(transcript.id));
    expect(getSession(db, s.id)?.status).toBe("awaiting-review");
  });
});

describe("ALL_STAGES", () => {
  it("runs the ten stages in spec order", () => {
    expect(ALL_STAGES.map((s) => s.name)).toEqual([
      "chunk", "extract", "validate", "requote", "classify", "reconcile",
      "requirements", "stories", "critique", "assemble",
    ]);
  });
});

describe("analyzeSession", () => {
  it("runs end to end and leaves the session awaiting review", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: LONG });
    freezeTranscript(db, transcript.id);
    // Every LLM stage returns empty results; the pipeline should still complete.
    const parse = vi.fn().mockResolvedValue({
      raw: "{}",
      parsedOutput: { claims: [], classifications: [], contradictions: [], links: [], requirements: [], stories: [], questions: [], recommendations: [] },
      requestPayload: {},
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    const state = await analyzeSession(ctx, transcript.id);
    expect(state.extracted).toBe(0);
    expect(getSession(db, s.id)?.status).toBe("awaiting-review");
  });

  it("refuses to run when the project has no domain set, without touching session status or the LLM client", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P" }); // no domain
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: LONG });
    freezeTranscript(db, transcript.id);
    const generate = vi.fn();
    const ctx: StageContext = { db, client: { model: "test", generate } as never, projectId: p.id, sessionId: s.id };

    await expect(analyzeSession(ctx, transcript.id)).rejects.toThrow(/no domain set/);

    expect(generate).not.toHaveBeenCalled();
    expect(getSession(db, s.id)?.status).toBe("draft"); // never advanced to "analyzing"
  });
});
