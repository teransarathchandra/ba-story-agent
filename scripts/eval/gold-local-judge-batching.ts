// Bounded local-judge batching for the small (3B-class) local semantic
// judge: replaces a single giant GoldMatchSchema call — which a small
// local model could not reliably complete (see the failed coverage
// baseline this design responds to: only 3 of 38 gold items and 3 of 30
// generated candidates were ever accounted for in one monolithic call) —
// with many small, independently-schema'd, independently-cached calls.
//
// Two genuinely separate judge tasks, never mixed into one call:
//   A. Correspondence batches — ~5 gold items at a time, judged against
//      ALL generated candidates (CorrespondenceBatchSchema).
//   B. Evidence-fidelity batches — ~10 generated candidates at a time,
//      judged independently of gold items (EvidenceBatchSchema).
//
// Every retry/cache/aggregation function here takes an injected `generate`
// function (LlmBackend["generate"]) rather than loading a model itself, so
// this logic is fully unit-testable with a mock generate() — no
// node-llama-cpp mocking required. Only runBatchedLocalJudge (the thin
// load/loop/release wrapper at the bottom) touches loadLocalBackend()
// directly.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { loadLocalBackend } from "../../src/llm/local-client.js";
import type { LlmBackend } from "../../src/llm/backend.js";
import type { GoldItem } from "../../src/eval/gold-schema.js";
import type { GeneratedCandidate } from "../../src/eval/gold-metrics.js";
import type { Match, EvidenceEntry, GoldMatchResult } from "../../src/eval/gold-match-schema.js";
import { CorrespondenceBatchSchema, EvidenceBatchSchema, type BatchMatch, type BatchEvidenceEntry } from "../../src/eval/gold-batch-schema.js";
import {
  buildCorrespondenceBatches,
  buildEvidenceBatches,
  checkCorrespondenceBatchCoverage,
  checkEvidenceBatchCoverage,
  aggregateBatchedMatch,
} from "../../src/eval/gold-batching.js";
import { checkCoverage, type CoverageResult } from "../../src/eval/gold-coverage.js";
import { DEFAULT_JUDGE_MAX_OUTPUT_TOKENS, type JudgeConfig } from "./judge-config.js";

export const BATCH_CORRESPONDENCE_PROMPT_VERSION = "v1";
export const BATCH_CORRESPONDENCE_SCHEMA_VERSION = "v1";
export const BATCH_EVIDENCE_PROMPT_VERSION = "v1";
export const BATCH_EVIDENCE_SCHEMA_VERSION = "v1";
const EVAL_RUNS_DIR = ".eval-runs";

function contentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function batchCacheDir(): string {
  return join(EVAL_RUNS_DIR, ".cache");
}

function loadCachedBatch<T>(kind: "correspondence" | "evidence", key: string, schema: z.ZodType<T>): T | null {
  const path = join(batchCacheDir(), `batch-${kind}-${key}.json`);
  if (!existsSync(path)) return null;
  return schema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function saveCachedBatch(kind: "correspondence" | "evidence", key: string, value: unknown): void {
  mkdirSync(batchCacheDir(), { recursive: true });
  writeFileSync(join(batchCacheDir(), `batch-${kind}-${key}.json`), JSON.stringify(value, null, 2));
}

/**
 * Cache key components per the design: gold subset hash, generated
 * candidate hash (full content, not just ids — a text/quote change should
 * invalidate the cache even if ids happened to collide), judge model,
 * prompt version, schema version, context size. maxOutputTokens is folded
 * in alongside context size for the same reason the top-level
 * single-call cache in gold-match.ts includes it: a different output-token
 * ceiling can change the actual response.
 */
function correspondenceBatchCacheKey(goldBatch: readonly GoldItem[], allCandidates: readonly GeneratedCandidate[], judge: JudgeConfig): string {
  return createHash("sha256")
    .update(
      `${contentHash(goldBatch)}|${contentHash(allCandidates)}|${judge.model}|${judge.contextSize ?? ""}|${judge.maxOutputTokens ?? ""}|${BATCH_CORRESPONDENCE_PROMPT_VERSION}|${BATCH_CORRESPONDENCE_SCHEMA_VERSION}`,
    )
    .digest("hex");
}

/** No gold subset applies to an evidence batch — evidence fidelity never references gold items. */
function evidenceBatchCacheKey(candidateBatch: readonly GeneratedCandidate[], judge: JudgeConfig): string {
  return createHash("sha256")
    .update(
      `${contentHash(candidateBatch)}|${judge.model}|${judge.contextSize ?? ""}|${judge.maxOutputTokens ?? ""}|${BATCH_EVIDENCE_PROMPT_VERSION}|${BATCH_EVIDENCE_SCHEMA_VERSION}`,
    )
    .digest("hex");
}

export function buildCorrespondenceBatchPrompt(goldBatch: readonly GoldItem[], allCandidates: readonly GeneratedCandidate[]): { system: string; user: string } {
  const goldForPrompt = goldBatch.map((item) => ({
    id: item.id,
    category: item.category,
    proposition: item.proposition,
    quotes: item.quotes,
    ...(item.meetingStateSensitive ? { meetingStateSensitive: item.meetingStateSensitive } : {}),
  }));
  const candidatesForPrompt = allCandidates.map((c) => ({ id: c.id, bucket: c.bucket, text: c.text, quote: c.quote }));
  const goldIds = goldForPrompt.map((g) => g.id);

  const system = `You are an independent semantic judge comparing a business analyst pipeline's generated output against a handful of hand-reviewed gold-truth items from a larger frozen set. You are being sent a SMALL BATCH of gold items — not the whole gold set — precisely so you can give each one careful, complete attention. Judge CORRESPONDENCE only:
- "equivalent": the generated item asserts the same substantive proposition as the gold item, allowing for paraphrase. Wording differences are fine; meaning differences are not.
- "partial": the generated item overlaps with the gold item's meaning but is materially narrower, broader, or missing a load-bearing qualifier the gold item specifies.
- "contradicts": the generated item asserts something that conflicts with the gold item (e.g. states the opposite, or asserts a specific detail — a number, an actor, a mechanism — that the gold item's evidence does not support and that changes the meaning).
- If a gold item in this batch has no real relationship to any generated candidate, do not create a matches[] entry for it at all — simply do not mention it in matches[]. Your reviewedGoldIds already proves you considered it; a gold item's absence from matches[] IS the "no relationship found" signal.

Do NOT judge evidence fidelity in this call — that is judged separately, elsewhere. Do NOT enumerate unmatched generated candidate ids — that is derived automatically from what you do and don't report a relationship for.

Some gold items are flagged "meetingStateSensitive" — the transcript contains an earlier, provisional statement on that topic that was LATER explicitly superseded. meetingStateViolation is a REQUIRED field on every match entry, not optional: set it to true ONLY if the generated item reflects the EARLIER provisional state as if it were final (matching mustNotReflect) rather than the correct later resolution (mustReflect). Set it to false for every other match. false is the ordinary, default, "not applicable or no violation" value.

COVERAGE IS MANDATORY for this batch: set reviewedGoldIds to EXACTLY these ${goldIds.length} ids, no more, no fewer, no others: ${JSON.stringify(goldIds)}. Every matches[].goldId must be one of these ${goldIds.length} ids — never a gold id from outside this batch. Every matches[].generatedItemId must be one of the generated candidate ids actually sent to you below. Do not invent ids. This is verified programmatically after your response — a batch that fails this check is retried once, and if it fails again the entire semantic evaluation is invalidated.`;

  const user = `GOLD ITEMS IN THIS BATCH (${goldForPrompt.length} of a larger frozen set — this batch's COMPLETE responsibility):
${JSON.stringify(goldForPrompt, null, 2)}

ALL GENERATED CANDIDATES (${candidatesForPrompt.length}, from the pipeline run under evaluation — compare EVERY gold item above against ALL of these):
${JSON.stringify(candidatesForPrompt, null, 2)}

Set reviewedGoldIds to exactly ${JSON.stringify(goldIds)}. For each, decide if it corresponds to any generated candidate above and report every real correspondence in matches[].`;

  return { system, user };
}

export function buildEvidenceBatchPrompt(candidateBatch: readonly GeneratedCandidate[]): { system: string; user: string } {
  const candidatesForPrompt = candidateBatch.map((c) => ({ id: c.id, bucket: c.bucket, text: c.text, quote: c.quote }));
  const ids = candidatesForPrompt.map((c) => c.id);

  const system = `You are an independent evidence-fidelity judge. You are being sent a SMALL BATCH of generated candidates from a business analyst pipeline — not the whole set — precisely so you can give each one careful, complete attention. For EVERY candidate: does its own cited quote (if any) actually support what its text asserts? A real, verbatim-sounding quote attached to a wrong or unsupported interpretation of it FAILS evidence fidelity, even if the candidate's text happens to be true for some other reason. A candidate with an empty quote (this happens for "question"-bucket items, which are not required to carry a verbatim citation in this pipeline) should be judged on whether its text is a reasonable, non-fabricated question given what you can infer — not penalized merely for lacking a quote.

Do NOT judge correspondence to any gold item in this call — that is judged separately, elsewhere. You are not given any gold items here because this task does not need them.

COVERAGE IS MANDATORY for this batch: generatedEvidence[] must contain EXACTLY one entry for each of these ${ids.length} candidate ids, no more, no fewer, no others: ${JSON.stringify(ids)}. Do not invent ids. This is verified programmatically after your response — a batch that fails this check is retried once, and if it fails again the entire semantic evaluation is invalidated.`;

  const user = `GENERATED CANDIDATES IN THIS BATCH (${candidatesForPrompt.length} — this batch's COMPLETE responsibility):
${JSON.stringify(candidatesForPrompt, null, 2)}

Return exactly one evidence-fidelity verdict per candidate id: ${JSON.stringify(ids)}.`;

  return { system, user };
}

type BatchOutcome<T> = { valid: true; result: T } | { valid: false; reason: string };

/**
 * A permanent, structured record of exactly what one generate() attempt
 * produced — including the raw, pre-parse text — for every attempt made
 * (successful or not). Not part of the canonical GoldMatchResult/metrics
 * shape at all; this exists purely so a failed run can be reviewed later
 * without needing to have captured console output live. Persisted
 * alongside the run artifact (see EvalRunArtifact.rawBatchAttempts in
 * gold-match.ts) rather than baked into GoldMatchResult itself, since it's
 * debugging/audit data, not evaluation input or output.
 */
export interface RawBatchAttempt {
  batchKind: "correspondence" | "evidence";
  batchLabel: string;
  attempt: number;
  raw: string;
  usage?: { input_tokens: number; output_tokens: number };
  latencyMs: number;
  coverageValid: boolean;
  coverageErrors: string[];
}

/**
 * One structured, greppable diagnostic line per generate() ATTEMPT (not per
 * batch — a batch that retries produces two lines), covering everything a
 * runtime finding about context accumulation/truncation/coverage failure
 * across a long sequence of calls sharing one loaded model would need:
 * which attempt, real measured input/output tokens (from the backend's own
 * tokenMeter — never estimated), wall-clock latency, and process RSS
 * sampled immediately after the call. Cache hits skip this entirely (no
 * call was made, nothing to measure) and are logged separately by
 * runBatchWithRetryAndCache. Also appends a RawBatchAttempt to `rawAttempts`
 * (when provided) so the exact raw text survives even for a run whose
 * console output wasn't captured.
 */
function logDiagnostic(
  log: ((line: string) => void) | undefined,
  rawAttempts: RawBatchAttempt[] | undefined,
  batchKind: "correspondence" | "evidence",
  batchLabel: string,
  attemptNum: number,
  latencyMs: number,
  raw: string,
  usage: { input_tokens: number; output_tokens: number } | undefined,
  coverageValid: boolean,
  coverageErrors: string[],
): void {
  const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const inputTok = usage?.input_tokens ?? "n/a";
  const outputTok = usage?.output_tokens ?? "n/a";
  const coverage = coverageValid ? "valid" : `invalid (${coverageErrors.join("; ")})`;
  log?.(`[diag] ${batchLabel} attempt=${attemptNum + 1} latencyMs=${latencyMs} inputTokens=${inputTok} outputTokens=${outputTok} rssMB=${rssMB} coverage=${coverage}`);
  rawAttempts?.push({ batchKind, batchLabel, attempt: attemptNum + 1, raw, usage, latencyMs, coverageValid, coverageErrors });
}

/**
 * Shared retry/cache protocol for a single batch call, regardless of which
 * of the two judge tasks it is: check cache, else call once, validate,
 * retry ONCE at the exact same inputs on failure, then give up. Never
 * retries a batch whose cache already holds a valid result, and never
 * silently drops a batch that fails twice — the caller (runCorrespondenceBatches
 * / runEvidenceBatches) treats any BatchOutcome with valid:false as a
 * terminal failure for the whole run.
 */
async function runBatchWithRetryAndCache<T>(opts: {
  cacheKind: "correspondence" | "evidence";
  cacheKey: string;
  cacheSchema: z.ZodType<T>;
  attempt: (attemptNum: number) => Promise<BatchOutcome<T>>;
  batchLabel: string;
  log?: (line: string) => void;
}): Promise<BatchOutcome<T>> {
  const cached = loadCachedBatch(opts.cacheKind, opts.cacheKey, opts.cacheSchema);
  if (cached !== null) {
    opts.log?.(`${opts.batchLabel}: cache hit, skipping call`);
    return { valid: true, result: cached };
  }

  for (let attemptNum = 0; attemptNum < 2; attemptNum++) {
    const outcome = await opts.attempt(attemptNum);
    if (outcome.valid) {
      saveCachedBatch(opts.cacheKind, opts.cacheKey, outcome.result);
      return outcome;
    }
    if (attemptNum === 1) {
      return { valid: false, reason: `${opts.batchLabel} failed after retry: ${outcome.reason}` };
    }
    opts.log?.(`${opts.batchLabel}: coverage failed, retrying once — ${outcome.reason}`);
  }
  /* c8 ignore next */
  throw new Error("unreachable: runBatchWithRetryAndCache loop always returns");
}

async function callCorrespondenceBatch(
  generate: LlmBackend["generate"],
  goldBatch: readonly GoldItem[],
  allCandidates: readonly GeneratedCandidate[],
  batchLabel: string,
  attemptNum: number,
  log?: (line: string) => void,
  rawAttempts?: RawBatchAttempt[],
): Promise<BatchOutcome<BatchMatch[]>> {
  const goldIds = goldBatch.map((g) => g.id);
  const candidateIds = allCandidates.map((c) => c.id);
  const { system, user } = buildCorrespondenceBatchPrompt(goldBatch, allCandidates);

  const t0 = Date.now();
  const result = await generate({ system, user, schema: CorrespondenceBatchSchema, effort: "high" });
  const latencyMs = Date.now() - t0;

  if (result.parsedOutput === null || result.parsedOutput === undefined) {
    logDiagnostic(log, rawAttempts, "correspondence", batchLabel, attemptNum, latencyMs, result.raw, result.usage, false, ["produced no schema-conforming output"]);
    return { valid: false, reason: "produced no schema-conforming output" };
  }
  const parsed = CorrespondenceBatchSchema.safeParse(result.parsedOutput);
  if (!parsed.success) {
    logDiagnostic(log, rawAttempts, "correspondence", batchLabel, attemptNum, latencyMs, result.raw, result.usage, false, [`schema parse failed: ${parsed.error.message}`]);
    return { valid: false, reason: `schema parse failed: ${parsed.error.message}` };
  }
  const coverage = checkCorrespondenceBatchCoverage(parsed.data, goldIds, candidateIds);
  logDiagnostic(log, rawAttempts, "correspondence", batchLabel, attemptNum, latencyMs, result.raw, result.usage, coverage.valid, coverage.errors);
  if (!coverage.valid) {
    return { valid: false, reason: coverage.errors.join("; ") };
  }
  return { valid: true, result: parsed.data.matches };
}

async function callEvidenceBatch(
  generate: LlmBackend["generate"],
  candidateBatch: readonly GeneratedCandidate[],
  batchLabel: string,
  attemptNum: number,
  log?: (line: string) => void,
  rawAttempts?: RawBatchAttempt[],
): Promise<BatchOutcome<BatchEvidenceEntry[]>> {
  const candidateIds = candidateBatch.map((c) => c.id);
  const { system, user } = buildEvidenceBatchPrompt(candidateBatch);

  const t0 = Date.now();
  const result = await generate({ system, user, schema: EvidenceBatchSchema, effort: "high" });
  const latencyMs = Date.now() - t0;

  if (result.parsedOutput === null || result.parsedOutput === undefined) {
    logDiagnostic(log, rawAttempts, "evidence", batchLabel, attemptNum, latencyMs, result.raw, result.usage, false, ["produced no schema-conforming output"]);
    return { valid: false, reason: "produced no schema-conforming output" };
  }
  const parsed = EvidenceBatchSchema.safeParse(result.parsedOutput);
  if (!parsed.success) {
    logDiagnostic(log, rawAttempts, "evidence", batchLabel, attemptNum, latencyMs, result.raw, result.usage, false, [`schema parse failed: ${parsed.error.message}`]);
    return { valid: false, reason: `schema parse failed: ${parsed.error.message}` };
  }
  const coverage = checkEvidenceBatchCoverage(parsed.data, candidateIds);
  logDiagnostic(log, rawAttempts, "evidence", batchLabel, attemptNum, latencyMs, result.raw, result.usage, coverage.valid, coverage.errors);
  if (!coverage.valid) {
    return { valid: false, reason: coverage.errors.join("; ") };
  }
  return { valid: true, result: parsed.data.generatedEvidence };
}

/**
 * Runs every correspondence batch in order, stopping at the first terminal
 * failure (a batch that still fails coverage after its one retry) — later
 * batches are simply never attempted, so a subsequent run only needs to
 * redo the batch that failed (and anything after it), never the ones that
 * already succeeded and were cached.
 */
export async function runCorrespondenceBatches(
  generate: LlmBackend["generate"],
  goldItems: readonly GoldItem[],
  allCandidates: readonly GeneratedCandidate[],
  judge: JudgeConfig,
  log?: (line: string) => void,
  rawAttempts?: RawBatchAttempt[],
): Promise<BatchOutcome<Match[]>> {
  const batches = buildCorrespondenceBatches(goldItems);
  const allMatches: Match[] = [];

  for (const [i, batch] of batches.entries()) {
    const label = `correspondence batch ${i + 1}/${batches.length} [${batch.map((g) => g.id).join(", ")}]`;
    const cacheKey = correspondenceBatchCacheKey(batch, allCandidates, judge);
    const outcome = await runBatchWithRetryAndCache({
      cacheKind: "correspondence",
      cacheKey,
      cacheSchema: CorrespondenceBatchSchema.shape.matches,
      attempt: (attemptNum) => callCorrespondenceBatch(generate, batch, allCandidates, label, attemptNum, log, rawAttempts),
      batchLabel: label,
      log,
    });
    if (!outcome.valid) {
      return { valid: false, reason: `${label}: ${outcome.reason}` };
    }
    allMatches.push(...outcome.result);
  }

  return { valid: true, result: allMatches };
}

export async function runEvidenceBatches(
  generate: LlmBackend["generate"],
  allCandidates: readonly GeneratedCandidate[],
  judge: JudgeConfig,
  log?: (line: string) => void,
  rawAttempts?: RawBatchAttempt[],
): Promise<BatchOutcome<EvidenceEntry[]>> {
  const batches = buildEvidenceBatches(allCandidates);
  const allEvidence: EvidenceEntry[] = [];

  for (const [i, batch] of batches.entries()) {
    const label = `evidence batch ${i + 1}/${batches.length} [${batch.map((c) => c.id).join(", ")}]`;
    const cacheKey = evidenceBatchCacheKey(batch, judge);
    const outcome = await runBatchWithRetryAndCache({
      cacheKind: "evidence",
      cacheKey,
      cacheSchema: EvidenceBatchSchema.shape.generatedEvidence,
      attempt: (attemptNum) => callEvidenceBatch(generate, batch, label, attemptNum, log, rawAttempts),
      batchLabel: label,
      log,
    });
    if (!outcome.valid) {
      return { valid: false, reason: `${label}: ${outcome.reason}` };
    }
    allEvidence.push(...outcome.result);
  }

  return { valid: true, result: allEvidence };
}

/**
 * The full local-judge entry point: loads the judge model ONCE (never the
 * production generator's model, never held loaded any longer than this
 * call — same contract the old single-shot callLocalJudge had), runs every
 * correspondence batch and then every evidence batch through it, and
 * releases. Skips evidence batches entirely if correspondence already
 * failed terminally — the run is already invalid, so there is no reason to
 * spend further local compute on it.
 */
export async function runBatchedLocalJudge(
  goldItems: readonly GoldItem[],
  allCandidates: readonly GeneratedCandidate[],
  judge: JudgeConfig,
  log?: (line: string) => void,
): Promise<{ matchResult: GoldMatchResult | null; coverage: CoverageResult; rawAttempts: RawBatchAttempt[] }> {
  const { backend, release } = await loadLocalBackend({
    modelUri: judge.model,
    contextSize: judge.contextSize,
    sequences: 1,
    maxTokens: judge.maxOutputTokens ?? DEFAULT_JUDGE_MAX_OUTPUT_TOKENS,
    log,
  });
  const rawAttempts: RawBatchAttempt[] = [];

  try {
    const generate: LlmBackend["generate"] = (args) => backend.generate(args);

    const correspondence = await runCorrespondenceBatches(generate, goldItems, allCandidates, judge, log, rawAttempts);
    if (!correspondence.valid) {
      return { matchResult: null, coverage: { valid: false, errors: [correspondence.reason] }, rawAttempts };
    }

    const evidence = await runEvidenceBatches(generate, allCandidates, judge, log, rawAttempts);
    if (!evidence.valid) {
      return { matchResult: null, coverage: { valid: false, errors: [evidence.reason] }, rawAttempts };
    }

    const goldIds = goldItems.map((g) => g.id);
    const candidateIds = allCandidates.map((c) => c.id);
    const matchResult = aggregateBatchedMatch(goldIds, candidateIds, correspondence.result, evidence.result);
    // Defense-in-depth: an aggregate built from validated batches should
    // always pass the exact same global invariant a successful single-call
    // judge response would have to — this re-check costs nothing (pure,
    // no LLM call) and catches a bug in aggregation itself, not the model.
    const coverage = checkCoverage(matchResult, goldIds, candidateIds);
    return { matchResult, coverage, rawAttempts };
  } finally {
    await release();
  }
}
