// Orchestrates the gold-fixture semantic-match eval: collects generated
// pipeline output, runs the hard deterministic invariants, calls the
// semantic judge (one call, per design), validates its response's
// coverage, computes every metric, and persists an audit artifact.
//
// This is real-LLM eval code (the Claude judge path costs money; the local
// judge path costs real inference time/compute) — it lives alongside
// run-live-eval.ts's gating, not in npm test.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "../../src/llm/client.js";
import { loadLocalBackend } from "../../src/llm/local-client.js";
import type { Db } from "../../src/store/db.js";
import { listRequirements } from "../../src/store/artifacts.js";
import { listQuestions } from "../../src/store/findings.js";
import { listClaims, listProjectClaims } from "../../src/store/claims.js";
import { supportedItems, type GoldFixture } from "../../src/eval/gold-schema.js";
import { GoldMatchSchema, type GoldMatchResult } from "../../src/eval/gold-match-schema.js";
import { checkCoverage, type CoverageResult } from "../../src/eval/gold-coverage.js";
import {
  checkAlreadyAnsweredQuestions,
  checkUnsupportedDetails,
  type DeterministicViolation,
} from "../../src/eval/gold-deterministic-checks.js";
import { computeGoldMetrics, type GeneratedCandidate, type GoldMetrics } from "../../src/eval/gold-metrics.js";

export const JUDGE_PROMPT_VERSION = "v1";
export const JUDGE_SCHEMA_VERSION = "v1";
/**
 * Deliberately distinct from AnthropicBackend's generator model
 * (`claude-opus-5`, src/llm/client.ts) — design §4: a benchmark run
 * against the default `claude` generator should get real, independent
 * semantic scoring out of the box, not silently SKIPPED because judge and
 * generator happened to default to the same model.
 */
export const DEFAULT_JUDGE_MODEL = "claude-sonnet-5";
/**
 * Default output-token ceiling for a LOCAL judge call — deliberately
 * distinct from and much larger than LOCAL_MAX_TOKENS (2048, the
 * production per-stage default in src/llm/local-client.ts): measured
 * directly against the real frozen 06-salon-booking fixture + a real
 * persisted 31-candidate pipeline output, the judge's GoldMatchSchema
 * response is estimated at ~3,400 output tokens for that fixture alone —
 * comfortably below this ceiling, but a fixture with more gold items or
 * more generated candidates could need more. Overridable via
 * EVAL_JUDGE_MAX_OUTPUT_TOKENS; this default is a generous starting
 * point, not a measured maximum for every possible fixture.
 */
export const DEFAULT_JUDGE_MAX_OUTPUT_TOKENS = 8192;
const EVAL_RUNS_DIR = ".eval-runs";

export interface JudgeConfig {
  backendLabel: string;
  model: string;
  /** LOCAL judge only — passed through to loadLocalBackend()'s contextSize. Undefined lets node-llama-cpp use the model's own trained context. */
  contextSize?: number;
  /** LOCAL judge only — passed through to loadLocalBackend()'s maxTokens (the output-token ceiling for the judge's one generate() call). */
  maxOutputTokens?: number;
}

/**
 * EVAL_JUDGE_BACKEND: "claude" (default) or "local". EVAL_JUDGE_MODEL: for
 * "claude", any Claude model id (default DEFAULT_JUDGE_MODEL); for
 * "local", an hf:/URL/local-path GGUF model URI resolved through
 * loadLocalBackend() exactly like the production generator resolves
 * CANDIDATE_MODEL_URI — genuinely independent judge and generator
 * configuration, never sharing state (see checkJudgeIndependence, which
 * compares the resolved model identifiers regardless of runtime — a local
 * judge model and a local generator model both going through
 * node-llama-cpp is still independent, since independence is about the
 * MODEL, not the runtime). EVAL_JUDGE_CONTEXT_SIZE / EVAL_JUDGE_MAX_OUTPUT_TOKENS
 * are local-only; both are parsed as integers and ignored (left undefined)
 * if unset or non-numeric, in which case loadLocalBackend()'s own
 * production-safe defaults apply.
 */
export function resolveJudgeConfig(): JudgeConfig {
  const backendLabel = process.env.EVAL_JUDGE_BACKEND ?? "claude";
  // DEFAULT_JUDGE_MODEL ("claude-sonnet-5") is a Claude model id — it is
  // NEVER a sensible fallback for a local judge (it isn't a GGUF URI, and
  // would either fail confusingly deep inside resolveModelFile() or, worse,
  // attempt a nonsensical download). Only the "claude" backend gets that
  // default; a "local" backend with no explicit EVAL_JUDGE_MODEL is left
  // with model: "" so the caller can detect and report the real
  // configuration error clearly instead of silently misconfiguring.
  const model = process.env.EVAL_JUDGE_MODEL ?? (backendLabel === "claude" ? DEFAULT_JUDGE_MODEL : "");
  const contextSizeRaw = process.env.EVAL_JUDGE_CONTEXT_SIZE;
  const maxOutputTokensRaw = process.env.EVAL_JUDGE_MAX_OUTPUT_TOKENS;
  const contextSize = contextSizeRaw ? Number.parseInt(contextSizeRaw, 10) : undefined;
  const maxOutputTokens = maxOutputTokensRaw ? Number.parseInt(maxOutputTokensRaw, 10) : undefined;
  return {
    backendLabel,
    model,
    ...(contextSize !== undefined && Number.isFinite(contextSize) ? { contextSize } : {}),
    ...(maxOutputTokens !== undefined && Number.isFinite(maxOutputTokens) ? { maxOutputTokens } : {}),
  };
}

export interface GeneratorInfo {
  backendLabel: string;
  model: string;
}

/**
 * A generator judging its own output is never benchmark-authoritative
 * (design §4) — compares resolved model identifiers, not backend labels,
 * since two differently-labeled backends could in principle resolve to
 * the same underlying model.
 */
export function checkJudgeIndependence(
  generator: GeneratorInfo,
  judge: JudgeConfig,
): { independent: boolean; reason?: string } {
  if (generator.model === judge.model) {
    return {
      independent: false,
      reason: `generator and judge share the same model ("${generator.model}") — not an independent measurement`,
    };
  }
  return { independent: true };
}

/**
 * Pulls the pipeline's current output for a project into the flat
 * candidate shape the judge and metrics both consume. Requirements have
 * no quote field of their own in this domain model (RequirementSchema) —
 * only their origin claim(s) do — so this resolves each requirement's
 * quote via its `originClaimIds`. OpenQuestion carries no quote field at
 * all (critique-stage questions are BA-suggested, not claim-extracted),
 * so question candidates always report an empty quote; that is expected,
 * not a bug, and the judge prompt says so explicitly.
 *
 * `sessionId`, when provided, scopes every bucket to exactly that
 * session's own persisted output — never another session under the same
 * project. This matters because `requirements` and `open_questions` are
 * stored project-scoped, not session-scoped: RequirementSchema carries no
 * sessionId field at all (only `originClaimIds`, which trace back to a
 * session indirectly via each claim's own `sessionId`), and while
 * OpenQuestionSchema does carry `raisedBySessionId`, the underlying
 * `listQuestions()` store function doesn't filter by it. Nothing in the
 * schema stops a second session existing under the same project, so
 * project-only scoping (the sessionId-omitted path below, kept for the
 * fresh-in-memory-run caller where exactly one session ever exists by
 * construction) would silently mix a different session's output into a
 * supposedly session-specific evaluation if one is ever added. Claims
 * already have a genuinely session-scoped store function (`listClaims`),
 * used directly here instead of the project-scoped `listProjectClaims`
 * when a session is specified — requirements and questions are filtered
 * client-side against that same claim set / session id, not by adding new
 * session-scoped store functions.
 */
export function collectGeneratedCandidates(
  db: Db,
  projectId: string,
  sessionId?: string,
): { requirements: GeneratedCandidate[]; questions: GeneratedCandidate[]; assumptionClaims: GeneratedCandidate[] } {
  const claims = sessionId ? listClaims(db, sessionId) : listProjectClaims(db, projectId);
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const claimIdsInSession = sessionId ? new Set(claims.map((c) => c.id)) : null;

  const requirements: GeneratedCandidate[] = listRequirements(db, projectId)
    .filter((r) => {
      if (!claimIdsInSession) return true;
      // A requirement belongs to this session if ANY of its origin claims
      // does. A client-stated requirement always cites at least one origin
      // claim (RequirementSchema's own .refine() enforces this); a
      // ba-authored requirement with zero origin claims can't be
      // attributed to any specific session and is excluded when
      // session-scoping is requested.
      return r.originClaimIds.some((cid) => claimIdsInSession.has(cid));
    })
    .map((r) => ({
      id: r.id,
      bucket: "requirement",
      text: r.statement,
      quote: r.originClaimIds
        .map((cid) => claimById.get(cid)?.quote)
        .filter((q): q is string => Boolean(q))
        .join(" | "),
    }));

  const questions: GeneratedCandidate[] = listQuestions(db, projectId)
    .filter((q) => !sessionId || q.raisedBySessionId === sessionId)
    .map((q) => ({ id: q.id, bucket: "question", text: q.text, quote: "" }));

  const assumptionClaims: GeneratedCandidate[] = claims
    .filter((c) => c.kind === "assumption" && c.status === "validated")
    .map((c) => ({ id: c.id, bucket: "assumptionClaim", text: c.statement, quote: c.quote }));

  return { requirements, questions, assumptionClaims };
}

function buildJudgePrompt(
  fixture: GoldFixture,
  candidates: GeneratedCandidate[],
): { system: string; user: string } {
  const goldForPrompt = supportedItems(fixture).map((item) => ({
    id: item.id,
    category: item.category,
    proposition: item.proposition,
    quotes: item.quotes,
    ...(item.meetingStateSensitive ? { meetingStateSensitive: item.meetingStateSensitive } : {}),
  }));
  const candidatesForPrompt = candidates.map((c) => ({ id: c.id, bucket: c.bucket, text: c.text, quote: c.quote }));

  const system = `You are an independent semantic judge comparing a business analyst pipeline's generated output against a hand-reviewed, frozen gold truth set for one transcript. You make two SEPARATE kinds of judgment for every relevant pair:

1. CORRESPONDENCE — does a generated item mean the same real-world thing as a gold item?
   - "equivalent": the generated item asserts the same substantive proposition as the gold item, allowing for paraphrase. Wording differences are fine; meaning differences are not.
   - "partial": the generated item overlaps with the gold item's meaning but is materially narrower, broader, or missing a load-bearing qualifier the gold item specifies.
   - "contradicts": the generated item asserts something that conflicts with the gold item (e.g. states the opposite, or asserts a specific detail — a number, an actor, a mechanism — that the gold item's evidence does not support and that changes the meaning).
   - If you find no real relationship between a gold item and a generated item, do not create an entry for that pair at all — report the gold item under unmatchedGoldIds instead if it has no relationship to ANY generated item, and the generated item under unmatchedGeneratedItemIds if it has no relationship to ANY gold item.

2. EVIDENCE FIDELITY — for EVERY generated candidate, independent of whether it corresponds to any gold item: does the candidate's own cited quote (if any) actually support what the candidate's text asserts? A real, verbatim-sounding quote attached to a wrong or unsupported interpretation of it FAILS evidence fidelity, even if the candidate's text happens to be true for some other reason. A candidate with an empty quote (this happens for "question"-bucket items, which are not required to carry a verbatim citation in this pipeline) should be judged on whether its text is a reasonable, non-fabricated question given the transcript context you can infer from the gold items — not penalized merely for lacking a quote.

Some gold items are flagged "meetingStateSensitive" — the transcript contains an earlier, provisional statement on that topic that was LATER explicitly superseded. meetingStateViolation is a REQUIRED field on every match entry, not optional: set it to true ONLY if the generated item reflects the EARLIER provisional state as if it were final (matching mustNotReflect) rather than the correct later resolution (mustReflect). Set it to false for every other match — including every match against a gold item that has no meetingStateSensitive flag at all, and every match against a meetingStateSensitive gold item that correctly reflects the later resolution (or doesn't touch the provisional/final distinction either way). false is the ordinary, default, "not applicable or no violation" value — it is not an omission and must always be present.

COVERAGE IS MANDATORY: every gold item id sent to you must appear in either matches[] (at least once) or unmatchedGoldIds (if it has no relationship to anything) — never both, never neither. Every generated candidate id sent to you must appear in either matches[] (at least once) or unmatchedGeneratedItemIds — never both, never neither. Every generated candidate id sent to you must appear EXACTLY ONCE in generatedEvidence[], regardless of match status. Do not invent ids that were not sent to you. This coverage is verified programmatically after your response — an incomplete or inconsistent response invalidates the entire evaluation run.`;

  const user = `GOLD ITEMS (${goldForPrompt.length}, frozen, hand-reviewed — this is the ground truth):
${JSON.stringify(goldForPrompt, null, 2)}

GENERATED CANDIDATES (${candidatesForPrompt.length}, from the pipeline run under evaluation):
${JSON.stringify(candidatesForPrompt, null, 2)}

Compare every gold item against every generated candidate for a real correspondence, judge evidence fidelity for every generated candidate, and return the matches/unmatchedGoldIds/unmatchedGeneratedItemIds/generatedEvidence exactly as specified.`;

  return { system, user };
}

export interface EvalRunArtifact {
  runId: string;
  timestamp: string;
  fixtureName: string;
  goldFixtureContentHash: string;
  generator: GeneratorInfo;
  judge:
    | { backendLabel: string; model: string; promptVersion: string; schemaVersion: string; coverageValid: boolean; coverageErrors: string[] }
    | { skipped: true; reason: string };
  normalizedPipelineOutputs: {
    requirements: GeneratedCandidate[];
    questions: GeneratedCandidate[];
    assumptionClaims: GeneratedCandidate[];
  };
  deterministicInvariantResults: {
    unsupportedDetailViolations: DeterministicViolation[];
    alreadyAnsweredQuestionViolations: DeterministicViolation[];
  };
  judgeMatchTable: GoldMatchResult | null;
  metrics: GoldMetrics | { skipped: true; reason: string } | { invalid: true; reason: string };
}

function cacheKeyFor(
  goldFixtureContentHash: string,
  normalizedOutputs: EvalRunArtifact["normalizedPipelineOutputs"],
  judge: JudgeConfig,
): string {
  const outputsHash = createHash("sha256").update(JSON.stringify(normalizedOutputs)).digest("hex");
  // contextSize/maxOutputTokens are folded in alongside model — a change to
  // either is a judge-configuration change, and per this design's own rule
  // (a judge-config change starts a new eval series, never silently
  // compared to a prior run), it must invalidate the cache too, not just a
  // model-string change.
  return createHash("sha256")
    .update(
      `${goldFixtureContentHash}|${outputsHash}|${judge.model}|${judge.contextSize ?? ""}|${judge.maxOutputTokens ?? ""}|${JUDGE_PROMPT_VERSION}|${JUDGE_SCHEMA_VERSION}`,
    )
    .digest("hex");
}

function cacheDir(): string {
  return join(EVAL_RUNS_DIR, ".cache");
}

function loadCachedMatch(cacheKey: string): GoldMatchResult | null {
  const path = join(cacheDir(), `${cacheKey}.json`);
  if (!existsSync(path)) return null;
  return GoldMatchSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function saveCachedMatch(cacheKey: string, result: GoldMatchResult): void {
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(join(cacheDir(), `${cacheKey}.json`), JSON.stringify(result, null, 2));
}

async function callClaudeJudge(
  client: Anthropic,
  model: string,
  system: string,
  user: string,
): Promise<GoldMatchResult> {
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    system,
    output_config: { effort: "high", format: zodOutputFormat(GoldMatchSchema) },
    messages: [{ role: "user", content: user }],
  });
  return GoldMatchSchema.parse(response.parsed_output);
}

/**
 * The local-judge equivalent of callClaudeJudge — loads a SEPARATE local
 * model (never the production generator's CANDIDATE_MODEL_URI, and never
 * held loaded any longer than this one call) through the exact same
 * node-llama-cpp runtime abstraction the production generator uses, via
 * loadLocalBackend()'s modelUri/contextSize/sequences/maxTokens
 * parameterization. `sequences: 1` because this is a single sequential
 * call, not concurrent — no reason to allocate KV-cache slots for
 * concurrency this call never uses. Loaded, used once, and released in a
 * finally block: the judge model is never resident in memory alongside a
 * fresh generator run, and for the historical-session evaluation path
 * (scripts/eval/run-existing-session.ts) the generator is never loaded at
 * all in the first place, so there is only ever the judge model loaded,
 * never both.
 */
async function callLocalJudge(
  judge: JudgeConfig,
  system: string,
  user: string,
  log?: (line: string) => void,
): Promise<GoldMatchResult> {
  const { backend, release } = await loadLocalBackend({
    modelUri: judge.model,
    contextSize: judge.contextSize,
    sequences: 1,
    maxTokens: judge.maxOutputTokens ?? DEFAULT_JUDGE_MAX_OUTPUT_TOKENS,
    log,
  });
  try {
    const result = await backend.generate({ system, user, schema: GoldMatchSchema, effort: "high" });
    if (result.parsedOutput === null || result.parsedOutput === undefined) {
      throw new Error(
        "local judge produced no schema-conforming output — the grammar-constrained decode may have collapsed to a degenerate result even after LocalBackend's internal retry ladder",
      );
    }
    return GoldMatchSchema.parse(result.parsedOutput);
  } finally {
    await release();
  }
}

function goldFixtureContentHash(fixture: GoldFixture): string {
  return createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
}

/**
 * Runs one full gold-eval pass for a completed pipeline run: hard
 * deterministic invariants always run; the semantic judge runs only if
 * independence holds and doesn't error, otherwise every judge-dependent
 * metric reports SKIPPED (never a silently substituted judge, never
 * computed against a partial/invalid response). One judge call per run
 * (or zero, on a cache hit) — never a second call to "double check."
 */
export async function runGoldEval(opts: {
  fixture: GoldFixture;
  generator: GeneratorInfo;
  db: Db;
  projectId: string;
  /**
   * Scopes candidate collection to exactly this session — see
   * collectGeneratedCandidates()'s doc comment for why this matters
   * (requirements/questions are stored project-scoped, not
   * session-scoped, and nothing in the schema stops a second session
   * existing under the same project). Omit only for a fresh
   * single-session in-memory run where project-level scoping is safe by
   * construction; always pass this for evaluating a historical/persisted
   * session.
   */
  sessionId?: string;
  anthropicApiKey?: string;
  /**
   * Skips the judge entirely — no independence check, no API call, not even
   * a cache lookup. For a deterministic-only pass (e.g. against an
   * already-persisted session where a paid judge call hasn't been
   * authorized yet): every judge-dependent metric reports SKIPPED with an
   * explicit reason, and the two hard invariants still run in full. This
   * branches BEFORE any judge-path code runs — it doesn't reuse or
   * reinterpret that path's logic, it simply declines to enter it.
   */
  skipJudge?: boolean;
  /** Forwarded to a local judge's loadLocalBackend() call for download-progress logging. Ignored for the Claude judge path. */
  judgeLog?: (line: string) => void;
}): Promise<EvalRunArtifact> {
  const generated = collectGeneratedCandidates(opts.db, opts.projectId, opts.sessionId);
  const allCandidates = [...generated.requirements, ...generated.questions, ...generated.assumptionClaims];

  const unsupportedDetailViolations = checkUnsupportedDetails(opts.fixture.unsupportedDetailChecks, allCandidates);
  const alreadyAnsweredQuestionViolations = checkAlreadyAnsweredQuestions(opts.fixture.answeredQuestionChecks, allCandidates);

  const fixtureHash = goldFixtureContentHash(opts.fixture);

  let judgeField: EvalRunArtifact["judge"];
  let matchResult: GoldMatchResult | null = null;
  let coverage: CoverageResult | null = null;

  if (opts.skipJudge) {
    judgeField = { skipped: true, reason: "judge not requested for this run (deterministic-only invocation)" };
  } else {
    const judgeConfig = resolveJudgeConfig();

    if (judgeConfig.backendLabel !== "claude" && judgeConfig.backendLabel !== "local") {
      judgeField = { skipped: true, reason: `unknown EVAL_JUDGE_BACKEND "${judgeConfig.backendLabel}" — expected "claude" or "local"` };
    } else if (judgeConfig.backendLabel === "local" && judgeConfig.model === "") {
      judgeField = { skipped: true, reason: "EVAL_JUDGE_BACKEND=local requires EVAL_JUDGE_MODEL to be set to a GGUF model URI/path — no default local judge model exists" };
    } else {
      const independence = checkJudgeIndependence(opts.generator, judgeConfig);

      if (!independence.independent) {
        judgeField = { skipped: true, reason: independence.reason! };
      } else {
        try {
          const cacheKey = cacheKeyFor(fixtureHash, generated, judgeConfig);
          matchResult = loadCachedMatch(cacheKey);
          if (!matchResult) {
            const { system, user } = buildJudgePrompt(opts.fixture, allCandidates);
            matchResult =
              judgeConfig.backendLabel === "claude"
                ? await callClaudeJudge(createClient({ apiKey: opts.anthropicApiKey }), judgeConfig.model, system, user)
                : await callLocalJudge(judgeConfig, system, user, opts.judgeLog);
            saveCachedMatch(cacheKey, matchResult);
          }

          coverage = checkCoverage(
            matchResult,
            supportedItems(opts.fixture).map((i) => i.id),
            allCandidates.map((c) => c.id),
          );
          judgeField = {
            backendLabel: judgeConfig.backendLabel,
            model: judgeConfig.model,
            promptVersion: JUDGE_PROMPT_VERSION,
            schemaVersion: JUDGE_SCHEMA_VERSION,
            coverageValid: coverage.valid,
            coverageErrors: coverage.errors,
          };
        } catch (err) {
          judgeField = { skipped: true, reason: err instanceof Error ? err.message : String(err) };
        }
      }
    }
  }

  let metrics: EvalRunArtifact["metrics"];
  if ("skipped" in judgeField) {
    metrics = { skipped: true, reason: judgeField.reason };
  } else if (!coverage!.valid) {
    metrics = { invalid: true, reason: `judge response failed coverage validation: ${coverage!.errors.join("; ")}` };
  } else {
    metrics = computeGoldMetrics(opts.fixture, generated, matchResult!);
  }

  return {
    runId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    fixtureName: opts.fixture.fixtureName,
    goldFixtureContentHash: fixtureHash,
    generator: opts.generator,
    judge: judgeField,
    normalizedPipelineOutputs: generated,
    deterministicInvariantResults: { unsupportedDetailViolations, alreadyAnsweredQuestionViolations },
    judgeMatchTable: matchResult,
    metrics,
  };
}

export function persistArtifact(artifact: EvalRunArtifact): string {
  const dir = join(EVAL_RUNS_DIR, artifact.fixtureName);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${artifact.runId}.json`);
  writeFileSync(path, JSON.stringify(artifact, null, 2));
  return path;
}
