import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertClaims } from "../../src/store/claims.js";
import { insertRequirements } from "../../src/store/artifacts.js";
import { insertQuestions } from "../../src/store/findings.js";
import { newId } from "../../src/types/ids.js";
import { collectGeneratedCandidates, checkJudgeIndependence, resolveJudgeConfig, runGoldEval } from "../../scripts/eval/gold-match.js";
import { checkCoverage } from "../../src/eval/gold-coverage.js";
import { computeGoldMetrics } from "../../src/eval/gold-metrics.js";
import type { GoldFixture } from "../../src/eval/gold-schema.js";
import type { GoldMatchResult } from "../../src/eval/gold-match-schema.js";

/**
 * Confirms the DB-integration seam (collectGeneratedCandidates) produces
 * candidates that actually flow correctly through coverage validation and
 * metrics computation — real store functions, real schema constraints, no
 * network call. Isolated unit tests already cover each piece; this proves
 * they fit together end to end on the one seam none of them individually
 * exercises: normalizing real DB rows into GeneratedCandidate[].
 */
describe("collectGeneratedCandidates — real store integration, no network", () => {
  it("resolves a requirement's quote via its origin claim, and a question's quote as empty", () => {
    const db = openDb(":memory:");
    const project = createProject(db, { name: "P", domain: "test domain for integration check" });
    const session = createSession(db, { projectId: project.id, title: "S" });
    const { transcript, segments } = createTranscript(db, { sessionId: session.id, text: "Client: some real transcript text here that is long enough." });
    freezeTranscript(db, transcript.id);
    const segmentId = segments[0]!.id;

    const claimId = newId("clm");
    insertClaims(db, [
      {
        id: claimId,
        sessionId: session.id,
        transcriptId: transcript.id,
        segmentId,
        quote: "some real transcript text",
        statement: "A normalized restatement",
        speakerRole: "client",
        kind: "requirement",
        status: "validated",
        charStart: 0,
        charEnd: 10,
        matchMode: "exact",
        createdAt: new Date().toISOString(),
      },
      {
        id: newId("clm"),
        sessionId: session.id,
        transcriptId: transcript.id,
        segmentId,
        quote: "an assumption-kind quote",
        statement: "A tentative statement",
        speakerRole: "client",
        kind: "assumption",
        status: "validated",
        charStart: 0,
        charEnd: 10,
        matchMode: "exact",
        createdAt: new Date().toISOString(),
      },
    ]);

    insertRequirements(db, [
      {
        id: newId("req"),
        projectId: project.id,
        key: "REQ-001",
        statement: "The system must do the thing",
        status: "confirmed",
        origin: "client-stated",
        originClaimIds: [claimId],
        supersedesId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    insertQuestions(db, [
      {
        id: newId("oqn"),
        projectId: project.id,
        key: "OQ-001",
        text: "What happens in edge case X?",
        category: "edge-case",
        raisedBySessionId: session.id,
        status: "open",
        answerText: null,
        answeredBySessionId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    const generated = collectGeneratedCandidates(db, project.id);

    expect(generated.requirements).toHaveLength(1);
    expect(generated.requirements[0]!.text).toBe("The system must do the thing");
    expect(generated.requirements[0]!.quote).toBe("some real transcript text");
    expect(generated.requirements[0]!.bucket).toBe("requirement");

    expect(generated.questions).toHaveLength(1);
    expect(generated.questions[0]!.text).toBe("What happens in edge case X?");
    expect(generated.questions[0]!.quote).toBe("");
    expect(generated.questions[0]!.bucket).toBe("question");

    expect(generated.assumptionClaims).toHaveLength(1);
    expect(generated.assumptionClaims[0]!.quote).toBe("an assumption-kind quote");
    expect(generated.assumptionClaims[0]!.bucket).toBe("assumptionClaim");
  });

  it("feeds real candidates through checkCoverage and computeGoldMetrics without error, given a synthetic (non-LLM) judge response", () => {
    const db = openDb(":memory:");
    const project = createProject(db, { name: "P2", domain: "test domain for integration check" });
    const session = createSession(db, { projectId: project.id, title: "S2" });
    const { transcript, segments } = createTranscript(db, { sessionId: session.id, text: "Client: another transcript with enough words in it." });
    freezeTranscript(db, transcript.id);
    const segmentId = segments[0]!.id;

    const claimId = newId("clm");
    insertClaims(db, [
      {
        id: claimId,
        sessionId: session.id,
        transcriptId: transcript.id,
        segmentId,
        quote: "another transcript",
        statement: "Restated",
        speakerRole: "client",
        kind: "requirement",
        status: "validated",
        charStart: 0,
        charEnd: 10,
        matchMode: "exact",
        createdAt: new Date().toISOString(),
      },
    ]);
    insertRequirements(db, [
      {
        id: newId("req"),
        projectId: project.id,
        key: "REQ-001",
        statement: "Some requirement",
        status: "confirmed",
        origin: "client-stated",
        originClaimIds: [claimId],
        supersedesId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    const generated = collectGeneratedCandidates(db, project.id);
    const allIds = [...generated.requirements, ...generated.questions, ...generated.assumptionClaims].map((c) => c.id);
    expect(allIds).toHaveLength(1);

    const fixture: GoldFixture = {
      fixtureName: "integration-synthetic",
      transcriptFile: "n/a",
      frozenMarkdownContentHash: "n/a",
      items: [{ id: "REQ-A", category: "requirement", proposition: "Some requirement", quotes: ["q"] }],
      unsupportedDetailChecks: [],
      answeredQuestionChecks: [],
    };

    const matchResult: GoldMatchResult = {
      matches: [
        {
          goldId: "REQ-A",
          generatedItemId: allIds[0]!,
          generatedBucket: "requirement",
          correspondence: "equivalent",
          meetingStateViolation: false,
        },
      ],
      unmatchedGoldIds: [],
      unmatchedGeneratedItemIds: [],
      generatedEvidence: [{ generatedItemId: allIds[0]!, evidenceFidelity: "pass", reason: "matches the claim quote" }],
    };

    const coverage = checkCoverage(matchResult, ["REQ-A"], allIds);
    expect(coverage.valid).toBe(true);

    const metrics = computeGoldMetrics(fixture, generated, matchResult);
    expect(metrics.recall.capturedCount).toBe(1);
    expect(metrics.recall.rate).toBe(1);
    expect(metrics.requirementPrecision.strictPrecision).toBe(1);
  });
});

describe("collectGeneratedCandidates — session-scoping prevents cross-session contamination", () => {
  function seedSession(db: ReturnType<typeof openDb>, projectId: string, label: string) {
    const session = createSession(db, { projectId, title: label });
    const { transcript, segments } = createTranscript(db, {
      sessionId: session.id,
      text: `Client: ${label} transcript text with enough words in it to be valid.`,
    });
    freezeTranscript(db, transcript.id);
    const segmentId = segments[0]!.id;

    const claimId = newId("clm");
    insertClaims(db, [
      {
        id: claimId,
        sessionId: session.id,
        transcriptId: transcript.id,
        segmentId,
        quote: `${label} quote`,
        statement: `${label} statement`,
        speakerRole: "client",
        kind: "assumption",
        status: "validated",
        charStart: 0,
        charEnd: 10,
        matchMode: "exact",
        createdAt: new Date().toISOString(),
      },
    ]);
    insertRequirements(db, [
      {
        id: newId("req"),
        projectId,
        key: label === "session-one" ? "REQ-001" : "REQ-002",
        statement: `${label} requirement`,
        status: "confirmed",
        origin: "client-stated",
        originClaimIds: [claimId],
        supersedesId: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    insertQuestions(db, [
      {
        id: newId("oqn"),
        projectId,
        key: label === "session-one" ? "OQ-001" : "OQ-002",
        text: `${label} question`,
        category: "edge-case",
        raisedBySessionId: session.id,
        status: "open",
        answerText: null,
        answeredBySessionId: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    return session;
  }

  it("with NO sessionId (project-only scoping), both sessions' output mixes together — this is the contamination risk itself, proven, not assumed", () => {
    const db = openDb(":memory:");
    const project = createProject(db, { name: "Shared project", domain: "test domain for contamination check" });
    seedSession(db, project.id, "session-one");
    seedSession(db, project.id, "session-two");

    const generated = collectGeneratedCandidates(db, project.id);

    expect(generated.requirements).toHaveLength(2);
    expect(generated.questions).toHaveLength(2);
    expect(generated.assumptionClaims).toHaveLength(2);
    expect(generated.requirements.map((r) => r.text)).toEqual(
      expect.arrayContaining(["session-one requirement", "session-two requirement"]),
    );
  });

  it("with sessionId provided, only that session's requirements/questions/claims are returned — the other session is fully excluded", () => {
    const db = openDb(":memory:");
    const project = createProject(db, { name: "Shared project", domain: "test domain for contamination check" });
    const sessionOne = seedSession(db, project.id, "session-one");
    const sessionTwo = seedSession(db, project.id, "session-two");

    const genOne = collectGeneratedCandidates(db, project.id, sessionOne.id);
    expect(genOne.requirements).toHaveLength(1);
    expect(genOne.requirements[0]!.text).toBe("session-one requirement");
    expect(genOne.questions).toHaveLength(1);
    expect(genOne.questions[0]!.text).toBe("session-one question");
    expect(genOne.assumptionClaims).toHaveLength(1);
    expect(genOne.assumptionClaims[0]!.text).toBe("session-one statement");

    const genTwo = collectGeneratedCandidates(db, project.id, sessionTwo.id);
    expect(genTwo.requirements).toHaveLength(1);
    expect(genTwo.requirements[0]!.text).toBe("session-two requirement");
    expect(genTwo.questions).toHaveLength(1);
    expect(genTwo.questions[0]!.text).toBe("session-two question");
    expect(genTwo.assumptionClaims).toHaveLength(1);
    expect(genTwo.assumptionClaims[0]!.text).toBe("session-two statement");

    // Cross-check: neither session's candidate IDs appear in the other's result.
    const oneIds = new Set([...genOne.requirements, ...genOne.questions, ...genOne.assumptionClaims].map((c) => c.id));
    const twoIds = [...genTwo.requirements, ...genTwo.questions, ...genTwo.assumptionClaims].map((c) => c.id);
    for (const id of twoIds) expect(oneIds.has(id)).toBe(false);
  });
});

describe("checkJudgeIndependence / resolveJudgeConfig — real env-driven defaults", () => {
  it("defaults the judge to a model distinct from the AnthropicBackend generator model", () => {
    const judge = resolveJudgeConfig();
    const independence = checkJudgeIndependence({ backendLabel: "claude", model: "claude-opus-5" }, judge);
    expect(independence.independent, independence.reason).toBe(true);
  });

  it("flags non-independence when generator and judge resolve to the identical model string", () => {
    const independence = checkJudgeIndependence({ backendLabel: "claude", model: "claude-sonnet-5" }, { backendLabel: "claude", model: "claude-sonnet-5" });
    expect(independence.independent).toBe(false);
  });
});

describe("resolveJudgeConfig — local judge env-var resolution", () => {
  // Save/restore every env var this suite touches, per-test, so mutating
  // process.env here can never leak into a different test file's run
  // (vitest runs test FILES in separate workers by default, but tests
  // WITHIN this file still share one process.env, and this describe block
  // sits alongside the "real env-driven defaults" block above, which reads
  // process.env's ambient state too).
  const ENV_KEYS = ["EVAL_JUDGE_BACKEND", "EVAL_JUDGE_MODEL", "EVAL_JUDGE_CONTEXT_SIZE", "EVAL_JUDGE_MAX_OUTPUT_TOKENS"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("never falls back to the Claude DEFAULT_JUDGE_MODEL for a local backend with no EVAL_JUDGE_MODEL set", () => {
    process.env.EVAL_JUDGE_BACKEND = "local";
    delete process.env.EVAL_JUDGE_MODEL;
    const config = resolveJudgeConfig();
    expect(config.backendLabel).toBe("local");
    // Must be empty, not silently "claude-sonnet-5" (a Claude model id is
    // never a valid GGUF URI) — runGoldEval() treats this empty string as
    // its own explicit SKIPPED reason rather than attempting to resolve it.
    expect(config.model).toBe("");
  });

  it("resolves EVAL_JUDGE_MODEL verbatim for a local backend", () => {
    process.env.EVAL_JUDGE_BACKEND = "local";
    process.env.EVAL_JUDGE_MODEL = "hf:some-org/Llama-3.2-3B-Instruct-GGUF:Q4_K_M";
    const config = resolveJudgeConfig();
    expect(config.model).toBe("hf:some-org/Llama-3.2-3B-Instruct-GGUF:Q4_K_M");
  });

  it("parses EVAL_JUDGE_CONTEXT_SIZE and EVAL_JUDGE_MAX_OUTPUT_TOKENS as integers when set", () => {
    process.env.EVAL_JUDGE_BACKEND = "local";
    process.env.EVAL_JUDGE_MODEL = "some-model";
    process.env.EVAL_JUDGE_CONTEXT_SIZE = "16000";
    process.env.EVAL_JUDGE_MAX_OUTPUT_TOKENS = "6000";
    const config = resolveJudgeConfig();
    expect(config.contextSize).toBe(16000);
    expect(config.maxOutputTokens).toBe(6000);
  });

  it("leaves contextSize/maxOutputTokens undefined (not NaN, not 0) when the env vars are unset", () => {
    delete process.env.EVAL_JUDGE_CONTEXT_SIZE;
    delete process.env.EVAL_JUDGE_MAX_OUTPUT_TOKENS;
    const config = resolveJudgeConfig();
    expect(config.contextSize).toBeUndefined();
    expect(config.maxOutputTokens).toBeUndefined();
  });

  it("leaves contextSize undefined (does not silently coerce to NaN) when the env var is set but non-numeric", () => {
    process.env.EVAL_JUDGE_CONTEXT_SIZE = "not-a-number";
    const config = resolveJudgeConfig();
    expect(config.contextSize).toBeUndefined();
  });

  it("defaults EVAL_JUDGE_BACKEND to claude when unset", () => {
    delete process.env.EVAL_JUDGE_BACKEND;
    const config = resolveJudgeConfig();
    expect(config.backendLabel).toBe("claude");
  });
});

describe("runGoldEval — local-judge validation branches never reach loadLocalBackend (no download risk)", () => {
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
    const project = createProject(db, { name: "P", domain: "test domain for runGoldEval validation" });
    return { db, projectId: project.id };
  }

  it("reports SKIPPED with a clear reason for an unknown EVAL_JUDGE_BACKEND, without attempting any model load", async () => {
    process.env.EVAL_JUDGE_BACKEND = "not-a-real-backend";
    process.env.EVAL_JUDGE_MODEL = "irrelevant";
    const { db, projectId } = seedEmptyProject();

    const artifact = await runGoldEval({
      fixture: emptyFixture,
      generator: { backendLabel: "claude", model: "claude-opus-5" },
      db,
      projectId,
    });

    expect(artifact.judge).toMatchObject({ skipped: true });
    if ("skipped" in artifact.judge) {
      expect(artifact.judge.reason).toMatch(/unknown EVAL_JUDGE_BACKEND/);
    }
  });

  it("reports SKIPPED with a clear reason when EVAL_JUDGE_BACKEND=local has no EVAL_JUDGE_MODEL set, without attempting any model load", async () => {
    process.env.EVAL_JUDGE_BACKEND = "local";
    delete process.env.EVAL_JUDGE_MODEL;
    const { db, projectId } = seedEmptyProject();

    const artifact = await runGoldEval({
      fixture: emptyFixture,
      generator: { backendLabel: "claude", model: "claude-opus-5" },
      db,
      projectId,
    });

    expect(artifact.judge).toMatchObject({ skipped: true });
    if ("skipped" in artifact.judge) {
      expect(artifact.judge.reason).toMatch(/EVAL_JUDGE_MODEL/);
    }
  });
});
