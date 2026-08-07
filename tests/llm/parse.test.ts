import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { egressSummary } from "../../src/store/audit.js";
import { callTyped, StageFailure } from "../../src/llm/parse.js";
import type { LlmBackend } from "../../src/llm/backend.js";

const Shape = z.object({ items: z.array(z.object({ name: z.string() })) });

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  return { db, sessionId: s.id };
}

function fakeBackend(parsedOutputs: (unknown | null)[]) {
  const calls: unknown[] = [];
  const backend: LlmBackend = {
    model: "fake-model",
    async generate(args) {
      calls.push(args);
      const out = parsedOutputs[calls.length - 1];
      return {
        raw: JSON.stringify(out),
        parsedOutput: out,
        requestPayload: { attempt: calls.length },
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    },
  };
  return { backend, calls };
}

describe("callTyped", () => {
  it("returns the parsed payload on first success", async () => {
    const { db, sessionId } = seed();
    const { backend } = fakeBackend([{ items: [{ name: "a" }] }]);
    const out = await callTyped({ client: backend, db, sessionId, stage: "extract", system: "sys", user: "usr", schema: Shape });
    expect(out.items[0]?.name).toBe("a");
  });

  it("logs egress for every attempt", async () => {
    const { db, sessionId } = seed();
    const { backend } = fakeBackend([{ items: [] }]);
    await callTyped({ client: backend, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape });
    expect(egressSummary(db, sessionId).requests).toBe(1);
  });

  it("skips egress logging when the backend reports no usage", async () => {
    const { db, sessionId } = seed();
    const backend: LlmBackend = {
      model: "fake",
      async generate() {
        return { raw: "{}", parsedOutput: { items: [] }, requestPayload: {} };
      },
    };
    await callTyped({ client: backend, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape });
    expect(egressSummary(db, sessionId).requests).toBe(0);
  });

  it("retries once when the payload fails schema validation, then succeeds", async () => {
    const { db, sessionId } = seed();
    const { backend, calls } = fakeBackend([{ items: "not-an-array" }, { items: [{ name: "ok" }] }]);
    const out = await callTyped({ client: backend, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape });
    expect(out.items[0]?.name).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("throws StageFailure with the raw response after retries are exhausted", async () => {
    const { db, sessionId } = seed();
    const { backend } = fakeBackend([{ bad: 1 }, { bad: 2 }, { bad: 3 }]);
    await expect(
      callTyped({ client: backend, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape }),
    ).rejects.toBeInstanceOf(StageFailure);
  });

  it("throws StageFailure when parsed_output is null", async () => {
    const { db, sessionId } = seed();
    const { backend } = fakeBackend([null, null, null]);
    await expect(
      callTyped({ client: backend, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape }),
    ).rejects.toBeInstanceOf(StageFailure);
  });
});
