import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { egressSummary } from "../../src/store/audit.js";
import { MODEL, hashRequest, logEgress, createClient } from "../../src/llm/client.js";

describe("MODEL", () => {
  it("is exactly claude-opus-5 with no date suffix", () => {
    expect(MODEL).toBe("claude-opus-5");
  });
});

describe("hashRequest", () => {
  it("is stable regardless of key insertion order", () => {
    expect(hashRequest({ a: 1, b: 2 })).toBe(hashRequest({ b: 2, a: 1 }));
  });

  it("differs for different content", () => {
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
  });

  it("returns 64 hex chars", () => {
    expect(hashRequest({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("distinguishes different Date values", () => {
    const old = new Date("2020-01-01");
    const new_ = new Date("2025-06-01");
    expect(hashRequest({ date: old })).not.toBe(hashRequest({ date: new_ }));
  });

  it("distinguishes undefined, null, and functions from each other", () => {
    const undefinedHash = hashRequest({ a: undefined });
    const nullHash = hashRequest({ a: null });
    const functionHash = hashRequest({ a: () => {} });
    expect(undefinedHash).not.toBe(nullHash);
    expect(undefinedHash).not.toBe(functionHash);
    expect(nullHash).not.toBe(functionHash);
  });

  it("distinguishes NaN from null", () => {
    expect(hashRequest({ a: NaN })).not.toBe(hashRequest({ a: null }));
  });

  it("is order-independent at nested levels", () => {
    const nested1 = hashRequest({ a: { y: 1, x: 2 }, b: 3 });
    const nested2 = hashRequest({ b: 3, a: { x: 2, y: 1 } });
    expect(nested1).toBe(nested2);
  });

  it("is consistent for arrays of objects with reordered keys", () => {
    const arr1 = hashRequest([{ a: 1, b: 2 }, { x: 10, y: 20 }]);
    const arr2 = hashRequest([{ b: 2, a: 1 }, { y: 20, x: 10 }]);
    expect(arr1).toBe(arr2);
  });
});

describe("logEgress", () => {
  it("writes an egress row that the summary picks up", () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    logEgress(db, s.id, "extract", { prompt: "x" }, { input_tokens: 120, output_tokens: 40 });
    expect(egressSummary(db, s.id)).toEqual({ requests: 1, promptTokens: 120, completionTokens: 40 });
  });
});

describe("createClient", () => {
  it("applies the configured retry count and timeout", () => {
    const client = createClient({ apiKey: "sk-test", maxRetries: 5, timeoutMs: 1234 });
    expect(client.maxRetries).toBe(5);
    expect(client.timeout).toBe(1234);
  });

  it("defaults the timeout in MILLISECONDS, not seconds", () => {
    // The TypeScript SDK takes ms; the Python SDK takes seconds. Passing
    // 600 here instead of 600_000 would give a 0.6s timeout and fail every
    // real call, so pin the unit.
    const client = createClient({ apiKey: "sk-test" });
    expect(client.timeout).toBe(600_000);
  });
});
