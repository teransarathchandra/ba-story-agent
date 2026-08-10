import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runCorrespondenceBatches, runEvidenceBatches } from "../../scripts/eval/gold-local-judge-batching.js";
import type { GoldItem } from "../../src/eval/gold-schema.js";
import type { GeneratedCandidate } from "../../src/eval/gold-metrics.js";
import type { JudgeConfig } from "../../scripts/eval/judge-config.js";
import type { LlmBackend } from "../../src/llm/backend.js";
import type { CorrespondenceBatchResult, EvidenceBatchResult } from "../../src/eval/gold-batch-schema.js";

const CACHE_DIR = join(".eval-runs", ".cache");

function listCacheFiles(): Set<string> {
  if (!existsSync(CACHE_DIR)) return new Set();
  return new Set(readdirSync(CACHE_DIR));
}

// EVERY test in this file (not just the explicit cache-reuse tests) can
// write real batch cache files to disk — any successful batch call saves
// unconditionally, regardless of which test triggered it. A file-wide
// beforeEach/afterEach snapshot-diff-cleanup catches all of them, cleaning
// up only what THIS run created, never touching any pre-existing cache
// content. Each test also uses a uniquely-tagged fake judge model id so its
// cache keys can never collide with a real run's cache in the first place.
let cacheBefore: Set<string>;
beforeEach(() => {
  cacheBefore = listCacheFiles();
});
afterEach(() => {
  cleanupNewCacheFiles();
});
function cleanupNewCacheFiles() {
  const after = listCacheFiles();
  for (const f of after) {
    if (!cacheBefore.has(f)) rmSync(join(CACHE_DIR, f));
  }
}

function makeGoldItems(count: number): GoldItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `TG-${String(i + 1).padStart(2, "0")}`,
    category: "requirement" as const,
    proposition: `test proposition ${i + 1}`,
    quotes: [`quote ${i + 1}`],
  }));
}

function makeCandidates(count: number): GeneratedCandidate[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `test_cand_${i + 1}`,
    bucket: "requirement" as const,
    text: `test candidate ${i + 1}`,
    quote: `test candidate quote ${i + 1}`,
  }));
}

function goodCorrespondenceResponse(batchGoldIds: string[]): CorrespondenceBatchResult {
  return { reviewedGoldIds: [...batchGoldIds], matches: [] };
}

function goodEvidenceResponse(batchCandidateIds: string[]): EvidenceBatchResult {
  return { generatedEvidence: batchCandidateIds.map((id) => ({ generatedItemId: id, evidenceFidelity: "pass" as const, reason: "ok" })) };
}

describe("runCorrespondenceBatches — every generated candidate is visible to every batch", () => {
  it("sends the FULL candidate set to every correspondence batch, not chunked", async () => {
    const goldItems = makeGoldItems(7); // batch size 5 -> 2 batches (5, 2)
    const candidates = makeCandidates(4);
    const judge: JudgeConfig = { backendLabel: "local", model: `test-model-visibility-${Date.now()}` };

    const seenUserPrompts: string[] = [];
    const generate: LlmBackend["generate"] = vi.fn(async (args) => {
      seenUserPrompts.push(args.user);
      // Figure out which batch this is from the prompt content so we can
      // return a coverage-valid response for whichever batch was sent.
      const batchIds = goldItems.filter((g) => args.user.includes(`"${g.id}"`)).map((g) => g.id);
      return { raw: "", parsedOutput: goodCorrespondenceResponse(batchIds), requestPayload: {}, usage: undefined };
    });

    const outcome = await runCorrespondenceBatches(generate, goldItems, candidates, judge);
    expect(outcome.valid, !outcome.valid ? outcome.reason : "").toBe(true);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(seenUserPrompts).toHaveLength(2);
    for (const prompt of seenUserPrompts) {
      for (const c of candidates) {
        expect(prompt.includes(c.id)).toBe(true);
      }
    }
  });
});

describe("runCorrespondenceBatches / runEvidenceBatches — per-batch diagnostic logging", () => {
  it("logs one [diag] line per attempt with real measured tokens, latency, RSS, and coverage result", async () => {
    const goldItems = makeGoldItems(5);
    const candidates = makeCandidates(2);
    const judge: JudgeConfig = { backendLabel: "local", model: `test-model-diag-${Date.now()}` };

    const generate: LlmBackend["generate"] = vi.fn(async (args) => {
      const batchIds = goldItems.filter((g) => args.user.includes(`"${g.id}"`)).map((g) => g.id);
      return { raw: "", parsedOutput: goodCorrespondenceResponse(batchIds), requestPayload: {}, usage: { input_tokens: 1234, output_tokens: 56 } };
    });

    const lines: string[] = [];
    const outcome = await runCorrespondenceBatches(generate, goldItems, candidates, judge, (l) => lines.push(l));
    expect(outcome.valid).toBe(true);

    const diagLines = lines.filter((l) => l.startsWith("[diag]"));
    expect(diagLines).toHaveLength(1);
    expect(diagLines[0]).toMatch(/attempt=1/);
    expect(diagLines[0]).toMatch(/inputTokens=1234/);
    expect(diagLines[0]).toMatch(/outputTokens=56/);
    expect(diagLines[0]).toMatch(/latencyMs=\d+/);
    expect(diagLines[0]).toMatch(/rssMB=\d+/);
    expect(diagLines[0]).toMatch(/coverage=valid/);
  });

  it("logs a distinct attempt=1 (failed) then attempt=2 (succeeded) line when a batch needs its retry", async () => {
    const goldItems = makeGoldItems(5);
    const candidates = makeCandidates(2);
    const judge: JudgeConfig = { backendLabel: "local", model: `test-model-diag-retry-${Date.now()}` };

    let call = 0;
    const generate: LlmBackend["generate"] = vi.fn(async (args) => {
      call++;
      const batchIds = goldItems.filter((g) => args.user.includes(`"${g.id}"`)).map((g) => g.id);
      if (call === 1) {
        return { raw: "", parsedOutput: { reviewedGoldIds: batchIds.slice(0, -1), matches: [] }, requestPayload: {}, usage: { input_tokens: 111, output_tokens: 22 } };
      }
      return { raw: "", parsedOutput: goodCorrespondenceResponse(batchIds), requestPayload: {}, usage: { input_tokens: 111, output_tokens: 40 } };
    });

    const lines: string[] = [];
    const outcome = await runCorrespondenceBatches(generate, goldItems, candidates, judge, (l) => lines.push(l));
    expect(outcome.valid).toBe(true);

    const diagLines = lines.filter((l) => l.startsWith("[diag]"));
    expect(diagLines).toHaveLength(2);
    expect(diagLines[0]).toMatch(/attempt=1/);
    expect(diagLines[0]).toMatch(/coverage=invalid/);
    expect(diagLines[1]).toMatch(/attempt=2/);
    expect(diagLines[1]).toMatch(/coverage=valid/);
  });
});

describe("runCorrespondenceBatches / runEvidenceBatches — one failed batch invalidates, no partial scores", () => {
  it("stops at the first batch that fails coverage even after its retry, and never attempts later batches", async () => {
    const goldItems = makeGoldItems(12); // 3 batches of 5,5,2
    const candidates = makeCandidates(3);
    const judge: JudgeConfig = { backendLabel: "local", model: `test-model-failure-${Date.now()}` };

    let call = 0;
    const generate: LlmBackend["generate"] = vi.fn(async (args) => {
      call++;
      const batchIds = goldItems.filter((g) => args.user.includes(`"${g.id}"`)).map((g) => g.id);
      const isBatch2 = batchIds[0] === "TG-06"; // second batch starts at item 6
      if (isBatch2) {
        // Always return a broken response for batch 2 (missing a reviewed
        // id) — both the first attempt and the one retry.
        return { raw: "", parsedOutput: { reviewedGoldIds: batchIds.slice(0, -1), matches: [] }, requestPayload: {}, usage: undefined };
      }
      return { raw: "", parsedOutput: goodCorrespondenceResponse(batchIds), requestPayload: {}, usage: undefined };
    });

    const outcome = await runCorrespondenceBatches(generate, goldItems, candidates, judge);

    expect(outcome.valid).toBe(false);
    if (!outcome.valid) {
      expect(outcome.reason).toMatch(/failed after retry/);
      expect("result" in outcome).toBe(false); // no partial match data leaks out on failure
    }
    // batch1 (1 call) + batch2 (1 call + 1 retry) = 3 calls; batch3 never attempted.
    expect(call).toBe(3);
  });

  it("evidence batches: a batch failing after retry marks the whole evidence pass invalid, never producing a partial evidence array", async () => {
    const candidates = makeCandidates(15); // 2 batches of 10, 5
    const judge: JudgeConfig = { backendLabel: "local", model: `test-model-evidence-fail-${Date.now()}` };

    let call = 0;
    const generate: LlmBackend["generate"] = vi.fn(async (args) => {
      call++;
      const batchIds = candidates.filter((c) => args.user.includes(c.id)).map((c) => c.id);
      // Always drop one entry — coverage-invalid on every attempt.
      return { raw: "", parsedOutput: { generatedEvidence: goodEvidenceResponse(batchIds).generatedEvidence.slice(0, -1) }, requestPayload: {}, usage: undefined };
    });

    const outcome = await runEvidenceBatches(generate, candidates, judge);
    expect(outcome.valid).toBe(false);
    if (!outcome.valid) {
      expect("result" in outcome).toBe(false);
    }
    // Fails on the FIRST batch (1 call + 1 retry = 2), never reaches the second batch.
    expect(call).toBe(2);
  });
});

describe("runCorrespondenceBatches / runEvidenceBatches — successful cached batches are reused", () => {
  it("does not re-call the judge for a correspondence batch already cached from a prior run", async () => {
    const goldItems = makeGoldItems(5); // exactly one batch
    const candidates = makeCandidates(2);
    const judge: JudgeConfig = { backendLabel: "local", model: `test-model-cache-corr-${Date.now()}` };

    const generate: LlmBackend["generate"] = vi.fn(async (args) => {
      const batchIds = goldItems.filter((g) => args.user.includes(`"${g.id}"`)).map((g) => g.id);
      return { raw: "", parsedOutput: goodCorrespondenceResponse(batchIds), requestPayload: {}, usage: undefined };
    });

    const first = await runCorrespondenceBatches(generate, goldItems, candidates, judge);
    expect(first.valid).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);

    const second = await runCorrespondenceBatches(generate, goldItems, candidates, judge);
    expect(second.valid).toBe(true);
    // No additional calls — the batch was served from cache.
    expect(generate).toHaveBeenCalledTimes(1);
    expect(first.valid && second.valid ? second.result : null).toEqual(first.valid ? first.result : null);
  });

  it("does not re-call the judge for an evidence batch already cached from a prior run", async () => {
    const candidates = makeCandidates(4); // exactly one batch (size 10 > 4)
    const judge: JudgeConfig = { backendLabel: "local", model: `test-model-cache-evidence-${Date.now()}` };

    const generate: LlmBackend["generate"] = vi.fn(async (args) => {
      const batchIds = candidates.filter((c) => args.user.includes(c.id)).map((c) => c.id);
      return { raw: "", parsedOutput: goodEvidenceResponse(batchIds), requestPayload: {}, usage: undefined };
    });

    const first = await runEvidenceBatches(generate, candidates, judge);
    expect(first.valid).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);

    const second = await runEvidenceBatches(generate, candidates, judge);
    expect(second.valid).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("retries a batch once on failure, then caches the successful retry result (no third call on a later run)", async () => {
    const goldItems = makeGoldItems(5);
    const candidates = makeCandidates(2);
    const judge: JudgeConfig = { backendLabel: "local", model: `test-model-retry-then-cache-${Date.now()}` };

    let call = 0;
    const generate: LlmBackend["generate"] = vi.fn(async (args) => {
      call++;
      const batchIds = goldItems.filter((g) => args.user.includes(`"${g.id}"`)).map((g) => g.id);
      if (call === 1) {
        // First attempt: broken (missing one reviewed id).
        return { raw: "", parsedOutput: { reviewedGoldIds: batchIds.slice(0, -1), matches: [] }, requestPayload: {}, usage: undefined };
      }
      return { raw: "", parsedOutput: goodCorrespondenceResponse(batchIds), requestPayload: {}, usage: undefined };
    });

    const first = await runCorrespondenceBatches(generate, goldItems, candidates, judge);
    expect(first.valid).toBe(true);
    expect(call).toBe(2); // one failed attempt + one successful retry

    const second = await runCorrespondenceBatches(generate, goldItems, candidates, judge);
    expect(second.valid).toBe(true);
    expect(call).toBe(2); // cache hit — no further calls
  });
});
