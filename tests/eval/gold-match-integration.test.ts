import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertClaims } from "../../src/store/claims.js";
import { insertRequirements } from "../../src/store/artifacts.js";
import { insertQuestions } from "../../src/store/findings.js";
import { newId } from "../../src/types/ids.js";
import { collectGeneratedCandidates, checkJudgeIndependence, resolveJudgeConfig } from "../../scripts/eval/gold-match.js";
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
