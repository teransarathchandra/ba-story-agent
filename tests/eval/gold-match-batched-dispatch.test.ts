import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks the batch orchestrator itself (not node-llama-cpp) — this test
// proves runGoldEval()'s DISPATCH wiring is correct (routes the local
// backend through runBatchedLocalJudge, and maps a batch failure to
// invalid metrics with no partial scores), complementing the lower-level
// unit tests of the batching/retry/cache logic in gold-local-judge-batching
// itself (tests/eval/gold-local-judge-batching.test.ts).
vi.mock("../../scripts/eval/gold-local-judge-batching.js", () => ({
  runBatchedLocalJudge: vi.fn(),
  BATCH_CORRESPONDENCE_PROMPT_VERSION: "v1",
  BATCH_CORRESPONDENCE_SCHEMA_VERSION: "v1",
}));

import { runBatchedLocalJudge } from "../../scripts/eval/gold-local-judge-batching.js";
import { runGoldEval } from "../../scripts/eval/gold-match.js";
import { openDb } from "../../src/store/db.js";
import { createProject } from "../../src/store/projects.js";
import type { GoldFixture } from "../../src/eval/gold-schema.js";

const ENV_KEYS = ["EVAL_JUDGE_BACKEND", "EVAL_JUDGE_MODEL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.mocked(runBatchedLocalJudge).mockReset();
});

const emptyFixture: GoldFixture = {
  fixtureName: "empty",
  transcriptFile: "n/a",
  frozenMarkdownContentHash: "n/a",
  items: [],
  unsupportedDetailChecks: [],
  answeredQuestionChecks: [],
};

function seedEmptyProject() {
  const db = openDb(":memory:");
  const project = createProject(db, { name: "P", domain: "test domain for batched-dispatch check" });
  return { db, projectId: project.id };
}

describe("runGoldEval — local backend dispatch", () => {
  it("routes EVAL_JUDGE_BACKEND=local through runBatchedLocalJudge exactly once, using the batch prompt/schema version", async () => {
    process.env.EVAL_JUDGE_BACKEND = "local";
    process.env.EVAL_JUDGE_MODEL = "test-local-model";
    const fakeRawAttempt = {
      batchKind: "correspondence" as const,
      batchLabel: "correspondence batch 1/1 [TG-01]",
      attempt: 1,
      raw: '{"reviewedGoldIds":["TG-01"],"matches":[]}',
      usage: { input_tokens: 100, output_tokens: 10 },
      latencyMs: 500,
      coverageValid: true,
      coverageErrors: [],
    };
    vi.mocked(runBatchedLocalJudge).mockResolvedValue({
      matchResult: { matches: [], unmatchedGoldIds: [], unmatchedGeneratedItemIds: [], generatedEvidence: [] },
      coverage: { valid: true, errors: [] },
      rawAttempts: [fakeRawAttempt],
    });

    const { db, projectId } = seedEmptyProject();
    const artifact = await runGoldEval({
      fixture: emptyFixture,
      generator: { backendLabel: "claude", model: "claude-opus-5" },
      db,
      projectId,
    });

    expect(runBatchedLocalJudge).toHaveBeenCalledTimes(1);
    expect(artifact.judge).toMatchObject({ backendLabel: "local", model: "test-local-model", coverageValid: true, promptVersion: "v1", schemaVersion: "v1" });
    expect(artifact.metrics).not.toHaveProperty("invalid");
    expect(artifact.metrics).not.toHaveProperty("skipped");
    // The raw batch attempt (including pre-parse text) survives onto the
    // persisted artifact — this is what makes a failed run reviewable
    // later without needing captured console output.
    expect(artifact.rawBatchAttempts).toEqual([fakeRawAttempt]);
  });

  it("a batch that fails after its retry surfaces as INVALID metrics, never a partial/successful score", async () => {
    process.env.EVAL_JUDGE_BACKEND = "local";
    process.env.EVAL_JUDGE_MODEL = "test-local-model";
    vi.mocked(runBatchedLocalJudge).mockResolvedValue({
      matchResult: null,
      coverage: { valid: false, errors: ["correspondence batch 2/8 [TG-06, TG-07, TG-08, TG-09, TG-10]: failed after retry: reviewedGoldIds is missing batch goldId(s): TG-10"] },
      rawAttempts: [],
    });

    const { db, projectId } = seedEmptyProject();
    const artifact = await runGoldEval({
      fixture: emptyFixture,
      generator: { backendLabel: "claude", model: "claude-opus-5" },
      db,
      projectId,
    });

    expect(artifact.judgeMatchTable).toBeNull();
    expect(artifact.metrics).toMatchObject({ invalid: true });
    if ("invalid" in artifact.metrics) {
      expect(artifact.metrics.reason).toMatch(/failed after retry/);
    }
    // No requirement/recall/precision fields leak through on an invalid run.
    expect(artifact.metrics).not.toHaveProperty("recall");
  });

  // The Claude single-call path itself (callClaudeJudge, the top-level
  // whole-result cache, buildJudgePrompt) is untouched by this change — not
  // exercised by a new test here, since making a real Claude call is
  // deliberately excluded from `npm test` (see gold-match.ts's header
  // comment). Its behavior is proven unchanged by the existing
  // resolveJudgeConfig/checkJudgeIndependence/validation-branch tests in
  // gold-match-integration.test.ts continuing to pass without modification.
  it("the local branch never falls through to attempt a Claude call — resolveJudgeConfig's backendLabel alone decides the dispatch", async () => {
    process.env.EVAL_JUDGE_BACKEND = "local";
    process.env.EVAL_JUDGE_MODEL = "test-local-model";
    vi.mocked(runBatchedLocalJudge).mockResolvedValue({
      matchResult: { matches: [], unmatchedGoldIds: [], unmatchedGeneratedItemIds: [], generatedEvidence: [] },
      coverage: { valid: true, errors: [] },
      rawAttempts: [],
    });

    const { db, projectId } = seedEmptyProject();
    // No anthropicApiKey passed at all — if the dispatch ever fell through
    // to the Claude path for a "local" backend, createClient() would throw
    // immediately for lack of an API key, and this call would reject.
    await expect(
      runGoldEval({ fixture: emptyFixture, generator: { backendLabel: "claude", model: "claude-opus-5" }, db, projectId }),
    ).resolves.toBeDefined();
  });
});

describe("runGoldEval — generatedCandidatesOverride (frozen candidate snapshot path)", () => {
  it("uses the override candidates directly, never touching the DB for candidate collection", async () => {
    // Deliberately pass NO db/projectId at all — if the override path ever
    // silently fell through to collectGeneratedCandidates(), this would
    // throw on `opts.db!`/`opts.projectId!` being undefined.
    const artifact = await runGoldEval({
      fixture: emptyFixture,
      generator: { backendLabel: "local", model: "some-generator" },
      generatedCandidatesOverride: {
        requirements: [{ id: "req_1", bucket: "requirement", text: "must do X", quote: "do X" }],
        questions: [],
        assumptionClaims: [],
      },
      skipJudge: true,
    });

    expect(artifact.normalizedPipelineOutputs.requirements).toHaveLength(1);
    expect(artifact.normalizedPipelineOutputs.requirements[0]!.id).toBe("req_1");
  });

  it("throws a clear error when neither generatedCandidatesOverride nor db+projectId is provided", async () => {
    await expect(
      runGoldEval({ fixture: emptyFixture, generator: { backendLabel: "local", model: "some-generator" }, skipJudge: true }),
    ).rejects.toThrow(/requires either generatedCandidatesOverride/);
  });

  it("leaves rawBatchAttempts undefined (not an empty array) for a skipped-judge run — never populated outside the local-batched path", async () => {
    const artifact = await runGoldEval({
      fixture: emptyFixture,
      generator: { backendLabel: "local", model: "some-generator" },
      generatedCandidatesOverride: { requirements: [], questions: [], assumptionClaims: [] },
      skipJudge: true,
    });
    expect(artifact.rawBatchAttempts).toBeUndefined();
  });
});
