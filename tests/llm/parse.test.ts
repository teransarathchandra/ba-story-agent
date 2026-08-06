import { describe, it, expect, vi } from "vitest";
import type * as z from "zod";
import * as zv4 from "zod/v4";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { egressSummary } from "../../src/store/audit.js";
import { callTyped, StageFailure } from "../../src/llm/parse.js";

const Shape = zv4.object({ items: zv4.array(zv4.object({ name: zv4.string() })) }) as unknown as z.ZodType<{ items: Array<{ name: string }> }>;

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  return { db, sessionId: s.id };
}

function fakeClient(parsedOutputs: (unknown | null)[]) {
  const parse = vi.fn();
  for (const out of parsedOutputs) {
    parse.mockResolvedValueOnce({
      parsed_output: out,
      content: [{ type: "text", text: JSON.stringify(out) }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "end_turn",
    });
  }
  return { messages: { parse }, __parse: parse } as never;
}

describe("callTyped", () => {
  it("returns the parsed payload on first success", async () => {
    const { db, sessionId } = seed();
    const client = fakeClient([{ items: [{ name: "a" }] }]);
    const out = await callTyped({
      client, db, sessionId, stage: "extract",
      system: "sys", user: "usr", schema: Shape,
    });
    expect(out.items[0]?.name).toBe("a");
  });

  it("logs egress for every attempt", async () => {
    const { db, sessionId } = seed();
    const client = fakeClient([{ items: [] }]);
    await callTyped({ client, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape });
    expect(egressSummary(db, sessionId).requests).toBe(1);
  });

  it("never passes temperature, top_p, top_k, or budget_tokens", async () => {
    const { db, sessionId } = seed();
    const client = fakeClient([{ items: [] }]);
    await callTyped({ client, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape });
    const args = (client as unknown as { __parse: { mock: { calls: unknown[][] } } }).__parse.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).not.toHaveProperty("temperature");
    expect(args).not.toHaveProperty("top_p");
    expect(args).not.toHaveProperty("top_k");
    expect(JSON.stringify(args)).not.toContain("budget_tokens");
    expect(args.model).toBe("claude-opus-5");
    expect(args.max_tokens).toBe(16000);
  });

  it("retries once when the payload fails schema validation, then succeeds", async () => {
    const { db, sessionId } = seed();
    const client = fakeClient([{ items: "not-an-array" }, { items: [{ name: "ok" }] }]);
    const out = await callTyped({ client, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape });
    expect(out.items[0]?.name).toBe("ok");
    expect((client as unknown as { __parse: { mock: { calls: unknown[] } } }).__parse.mock.calls).toHaveLength(2);
  });

  it("throws StageFailure with the raw response after retries are exhausted", async () => {
    const { db, sessionId } = seed();
    const client = fakeClient([{ bad: 1 }, { bad: 2 }, { bad: 3 }]);
    await expect(
      callTyped({ client, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape }),
    ).rejects.toBeInstanceOf(StageFailure);
  });

  it("throws StageFailure when parsed_output is null", async () => {
    const { db, sessionId } = seed();
    const client = fakeClient([null, null, null]);
    await expect(
      callTyped({ client, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape }),
    ).rejects.toBeInstanceOf(StageFailure);
  });
});
