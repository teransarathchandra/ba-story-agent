import { describe, it, expect } from "vitest";
import type { GoldFixture } from "../../src/eval/gold-schema.js";
import type { GoldMatchResult } from "../../src/eval/gold-match-schema.js";
import { computeGoldMetrics, type GeneratedCandidate } from "../../src/eval/gold-metrics.js";

/**
 * One synthetic fixture exercising every metric's edge cases at once,
 * rather than one micro-fixture per metric — this is deliberate: several
 * of these metrics interact (e.g. an item captured across two buckets is
 * both a taxonomy data point and an exclusivity violation), and testing
 * them together catches interaction bugs a series of isolated fixtures
 * would miss. Every synthetic item's role is named after what it tests.
 */
const fixture: GoldFixture = {
  fixtureName: "synthetic",
  transcriptFile: "synthetic.txt",
  frozenMarkdownContentHash: "n/a",
  items: [
    { id: "REQ-PASS", category: "requirement", proposition: "captured correctly, single bucket", quotes: ["q"] },
    { id: "REQ-MISPLACED", category: "requirement", proposition: "captured but in the wrong bucket", quotes: ["q"] },
    { id: "REQ-CONTRADICTED", category: "requirement", proposition: "never captured, has a contradiction and a partial", quotes: ["q"] },
    { id: "REQ-EXCLUSIVITY", category: "requirement", proposition: "captured in two distinct buckets", quotes: ["q"] },
    { id: "RULE-PROXY", category: "rule", proposition: "PROXY tier, captured via requirements bucket", quotes: ["q"] },
    { id: "UNR-PROXY", category: "unresolved", proposition: "PROXY tier, captured via questions bucket (grounded)", quotes: ["q"] },
    { id: "UNR-PARTIAL", category: "unresolved", proposition: "only a partial match, never captured", quotes: ["q"] },
    { id: "ASM-DUP", category: "assumption", proposition: "captured twice in the same bucket", quotes: ["q"] },
    { id: "ASM-MISSED", category: "assumption", proposition: "never appears in matches at all", quotes: ["q"] },
    {
      id: "ASM-SENSITIVE",
      category: "assumption",
      proposition: "meeting-state sensitive, violated",
      quotes: ["q"],
      meetingStateSensitive: { mustNotReflect: "earlier provisional state", mustReflect: "later resolution" },
    },
    { id: "ASM-PROMOTE-SOURCE", category: "assumption", proposition: "promoted into a requirement", quotes: ["q"] },
    { id: "STATE-UNSUPPORTED", category: "state", proposition: "structurally unsupported, never scored", quotes: ["q"] },
  ],
  unsupportedDetailChecks: [],
  answeredQuestionChecks: [],
};

const generatedRequirements: GeneratedCandidate[] = [
  { id: "r-pass", bucket: "requirement", text: "t", quote: "q" },
  { id: "r-contradiction", bucket: "requirement", text: "t", quote: "q" },
  { id: "r-promoted", bucket: "requirement", text: "t", quote: "q" },
  { id: "r-partial", bucket: "requirement", text: "t", quote: "q" },
  { id: "r-unmatched", bucket: "requirement", text: "t", quote: "q" },
  { id: "r-evidence-fail", bucket: "requirement", text: "t", quote: "q" },
  { id: "r-exclusivity1", bucket: "requirement", text: "t", quote: "q" },
  { id: "r-rule-proxy", bucket: "requirement", text: "t", quote: "q" },
];
const generatedQuestions: GeneratedCandidate[] = [
  { id: "q-exclusivity2", bucket: "question", text: "t", quote: "q" },
  { id: "q-unr-proxy", bucket: "question", text: "t", quote: "q" },
  { id: "q-unr-partial", bucket: "question", text: "t", quote: "q" },
  { id: "q-novel", bucket: "question", text: "t", quote: "q" },
];
const generatedAssumptionClaims: GeneratedCandidate[] = [
  { id: "a-misplace", bucket: "assumptionClaim", text: "t", quote: "q" },
  { id: "a-dup1", bucket: "assumptionClaim", text: "t", quote: "q" },
  { id: "a-dup2", bucket: "assumptionClaim", text: "t", quote: "q" },
  { id: "a-sensitive", bucket: "assumptionClaim", text: "t", quote: "q" },
];

const matchResult: GoldMatchResult = {
  matches: [
    { goldId: "REQ-PASS", generatedItemId: "r-pass", generatedBucket: "requirement", correspondence: "equivalent" },
    { goldId: "REQ-CONTRADICTED", generatedItemId: "r-contradiction", generatedBucket: "requirement", correspondence: "contradicts" },
    { goldId: "ASM-PROMOTE-SOURCE", generatedItemId: "r-promoted", generatedBucket: "requirement", correspondence: "equivalent" },
    { goldId: "REQ-CONTRADICTED", generatedItemId: "r-partial", generatedBucket: "requirement", correspondence: "partial" },
    { goldId: "REQ-MISPLACED", generatedItemId: "r-evidence-fail", generatedBucket: "requirement", correspondence: "equivalent" },
    { goldId: "REQ-EXCLUSIVITY", generatedItemId: "r-exclusivity1", generatedBucket: "requirement", correspondence: "equivalent" },
    { goldId: "RULE-PROXY", generatedItemId: "r-rule-proxy", generatedBucket: "requirement", correspondence: "equivalent" },
    { goldId: "REQ-EXCLUSIVITY", generatedItemId: "q-exclusivity2", generatedBucket: "question", correspondence: "equivalent" },
    { goldId: "UNR-PROXY", generatedItemId: "q-unr-proxy", generatedBucket: "question", correspondence: "equivalent" },
    { goldId: "UNR-PARTIAL", generatedItemId: "q-unr-partial", generatedBucket: "question", correspondence: "partial" },
    { goldId: "REQ-MISPLACED", generatedItemId: "a-misplace", generatedBucket: "assumptionClaim", correspondence: "equivalent" },
    { goldId: "ASM-DUP", generatedItemId: "a-dup1", generatedBucket: "assumptionClaim", correspondence: "equivalent" },
    { goldId: "ASM-DUP", generatedItemId: "a-dup2", generatedBucket: "assumptionClaim", correspondence: "equivalent" },
    {
      goldId: "ASM-SENSITIVE",
      generatedItemId: "a-sensitive",
      generatedBucket: "assumptionClaim",
      correspondence: "equivalent",
      meetingStateViolation: true,
    },
  ],
  unmatchedGoldIds: ["ASM-MISSED"],
  unmatchedGeneratedItemIds: ["r-unmatched", "q-novel"],
  generatedEvidence: [
    ...generatedRequirements.map((r) => ({
      generatedItemId: r.id,
      evidenceFidelity: (r.id === "r-evidence-fail" ? "fail" : "pass") as "pass" | "fail",
      reason: "synthetic",
    })),
    ...generatedQuestions.map((q) => ({ generatedItemId: q.id, evidenceFidelity: "pass" as const, reason: "synthetic" })),
    ...generatedAssumptionClaims.map((a) => ({ generatedItemId: a.id, evidenceFidelity: "pass" as const, reason: "synthetic" })),
  ],
};

const metrics = computeGoldMetrics(
  fixture,
  { requirements: generatedRequirements, questions: generatedQuestions, assumptionClaims: generatedAssumptionClaims },
  matchResult,
);

describe("computeRecall", () => {
  it("counts only equivalent+evidence-pass matches as captured, against the 11-item supported denominator", () => {
    expect(metrics.recall.supportedDenominator).toBe(11);
    expect(metrics.recall.totalGoldItems).toBe(12);
    expect(metrics.recall.structurallyUnsupportedCount).toBe(1);
    // Captured: REQ-PASS, REQ-EXCLUSIVITY, RULE-PROXY, UNR-PROXY, REQ-MISPLACED,
    // ASM-DUP, ASM-SENSITIVE, ASM-PROMOTE-SOURCE = 8. NOT captured: REQ-CONTRADICTED
    // (only contradicts/partial), UNR-PARTIAL (only partial), ASM-MISSED (nothing).
    expect(metrics.recall.capturedCount).toBe(8);
    expect(metrics.recall.rate).toBeCloseTo(8 / 11);
    expect(new Set(metrics.recall.capturedGoldIds)).toEqual(
      new Set(["REQ-PASS", "REQ-EXCLUSIVITY", "RULE-PROXY", "UNR-PROXY", "REQ-MISPLACED", "ASM-DUP", "ASM-SENSITIVE", "ASM-PROMOTE-SOURCE"]),
    );
  });
});

describe("computeTaxonomyAccuracy", () => {
  it("scores placement only for PRIMARY-tier categories, never PROXY", () => {
    // PRIMARY recalled: REQ-PASS, REQ-EXCLUSIVITY, REQ-MISPLACED, ASM-DUP,
    // ASM-SENSITIVE, ASM-PROMOTE-SOURCE = 6. PROXY recalled (RULE-PROXY, UNR-PROXY) excluded.
    expect(metrics.taxonomyAccuracy.primaryRecalledCount).toBe(6);
    expect(metrics.taxonomyAccuracy.proxyRecalledCount).toBe(2);
  });

  it("counts a gold item as correctly placed if ANY of its passing matches lands in the expected bucket", () => {
    // Correct: REQ-PASS (requirement), REQ-EXCLUSIVITY (has a requirement-bucket
    // match among its two), ASM-DUP (assumptionClaim), ASM-SENSITIVE (assumptionClaim).
    // Incorrect: REQ-MISPLACED (only passing match is assumptionClaim, expected requirement),
    // ASM-PROMOTE-SOURCE (only passing match is requirement, expected assumptionClaim).
    expect(metrics.taxonomyAccuracy.primaryCorrectCount).toBe(4);
    expect(metrics.taxonomyAccuracy.rate).toBeCloseTo(4 / 6);
  });

  it("ignores a match whose evidence fails when deriving placement", () => {
    // REQ-MISPLACED's r-evidence-fail match (requirement bucket) does NOT count —
    // its only real capture is a-misplace (assumptionClaim), so placement is incorrect,
    // not "correct because SOME match happened to be in the requirement bucket."
    const placement = metrics.taxonomyAccuracy.derivedPlacement.filter((p) => p.goldId === "REQ-MISPLACED");
    expect(placement).toHaveLength(1);
    expect(placement[0]!.generatedItemId).toBe("a-misplace");
    expect(placement[0]!.placementCorrect).toBe(false);
  });
});

describe("computeRequirementPrecision", () => {
  it("partitions every generated requirement into exactly one of 5 mutually exclusive buckets", () => {
    const { buckets, total } = metrics.requirementPrecision;
    expect(total).toBe(8);
    const sum = Object.values(buckets).reduce((s, b) => s + b.count, 0);
    expect(sum).toBe(total);
  });

  it("computes strict precision as passing / total, and non-precision as its exact complement", () => {
    // passing: r-pass, r-exclusivity1, r-rule-proxy = 3
    expect(metrics.requirementPrecision.buckets.passing.count).toBe(3);
    expect(metrics.requirementPrecision.strictPrecision).toBeCloseTo(3 / 8);
    expect(metrics.requirementPrecision.nonPrecisionRate).toBeCloseTo(5 / 8);
    expect(metrics.requirementPrecision.strictPrecision! + metrics.requirementPrecision.nonPrecisionRate!).toBeCloseTo(1);
  });

  it("buckets a contradicting item as contradiction, checked before other categories", () => {
    expect(metrics.requirementPrecision.buckets.contradiction.ids).toEqual(["r-contradiction"]);
  });

  it("buckets an equivalent+pass match to an unresolved/assumption gold item as promoted", () => {
    expect(metrics.requirementPrecision.buckets.promoted.ids).toEqual(["r-promoted"]);
  });

  it("buckets a partial-only match (no passing/contradiction/promoted) as partial-only", () => {
    expect(metrics.requirementPrecision.buckets["partial-only"].ids).toEqual(["r-partial"]);
  });

  it("buckets a fully unmatched item, AND an equivalent-match-with-failed-evidence item, both as unmatched", () => {
    // r-unmatched has literally zero matches. r-evidence-fail has an
    // `equivalent` match to a requirement-category gold item, but its
    // evidence fails — per this module's uniform rule (a match without
    // passing evidence never counts as a real capture anywhere), it falls
    // through every earlier bucket and lands here too, not in "passing".
    expect(new Set(metrics.requirementPrecision.buckets.unmatched.ids)).toEqual(
      new Set(["r-unmatched", "r-evidence-fail"]),
    );
  });

  it("treats a rule-category gold item as equally valid for the passing bucket as a requirement-category one", () => {
    expect(metrics.requirementPrecision.buckets.passing.ids).toContain("r-rule-proxy");
  });
});

describe("computeCrossCategoryExclusivity", () => {
  it("flags a gold item captured by passing matches from 2+ distinct generated buckets", () => {
    expect(metrics.crossCategoryExclusivity.violationCount).toBe(1);
    expect(metrics.crossCategoryExclusivity.violations[0]!.goldId).toBe("REQ-EXCLUSIVITY");
    expect(new Set(metrics.crossCategoryExclusivity.violations[0]!.buckets)).toEqual(new Set(["requirement", "question"]));
  });

  it("does not flag a gold item captured multiple times within the SAME bucket", () => {
    const violatingIds = metrics.crossCategoryExclusivity.violations.map((v) => v.goldId);
    expect(violatingIds).not.toContain("ASM-DUP");
  });
});

describe("computeDuplicateRate", () => {
  it("flags a gold item captured 2+ times within the same bucket", () => {
    expect(metrics.duplicateRate.violationCount).toBe(1);
    expect(metrics.duplicateRate.violations[0]).toMatchObject({ goldId: "ASM-DUP", bucket: "assumptionClaim", count: 2 });
  });
});

describe("computeEvidenceFidelity", () => {
  it("computes the pass rate across every generated candidate's evidence entry, matched or not", () => {
    // 16 total candidates (8 req + 4 questions + 4 assumptionClaims), only
    // r-evidence-fail fails.
    expect(metrics.evidenceFidelity.total).toBe(16);
    expect(metrics.evidenceFidelity.passing).toBe(15);
    expect(metrics.evidenceFidelity.rate).toBeCloseTo(15 / 16);
  });
});

describe("computeMeetingStateResolution", () => {
  it("flags a meeting-state-sensitive gold item whose match reports a violation", () => {
    expect(metrics.meetingStateResolution.sensitiveCount).toBe(1);
    expect(metrics.meetingStateResolution.violationCount).toBe(1);
    expect(metrics.meetingStateResolution.violatingGoldIds).toEqual(["ASM-SENSITIVE"]);
  });
});

describe("computeGroundedVsNovelQuestions", () => {
  it("counts a question grounded only if it equivalent+pass-matches an UNRESOLVED-category gold item specifically", () => {
    // q-unr-proxy -> UNR-PROXY (unresolved): grounded.
    // q-exclusivity2 -> REQ-EXCLUSIVITY (requirement, not unresolved): novel for this metric.
    // q-unr-partial -> only a partial match: novel.
    // q-novel -> no match: novel.
    expect(metrics.groundedVsNovelQuestions.grounded).toBe(1);
    expect(metrics.groundedVsNovelQuestions.novel).toBe(3);
    expect(metrics.groundedVsNovelQuestions.total).toBe(4);
  });
});

describe("computeSupplementaryDiagnostics", () => {
  it("counts a gold item as partial-only when it has a partial match but no passing match", () => {
    expect(new Set(metrics.supplementary.partialOnlyGoldIds)).toEqual(new Set(["REQ-CONTRADICTED", "UNR-PARTIAL"]));
    expect(metrics.supplementary.partialOnlyGoldCount).toBe(2);
  });

  it("counts a gold item as contradicted when any match reports correspondence: contradicts", () => {
    expect(metrics.supplementary.contradictedGoldIds).toEqual(["REQ-CONTRADICTED"]);
    expect(metrics.supplementary.contradictedGoldCount).toBe(1);
  });

  it("flags a generated item as ungrounded-equivalent when its match is equivalent but its own evidence fails", () => {
    // r-evidence-fail: equivalent correspondence to REQ-MISPLACED, evidence fails.
    // Diagnostic only — this is the same pair already proven NOT to count
    // toward recall/taxonomy/precision (see the isolated precedence block
    // below and the earlier "unmatched" precision-bucket test); this test
    // covers the separate, additive diagnostic surfacing it as its own
    // named signal.
    expect(metrics.supplementary.ungroundedEquivalentItemIds).toContain("r-evidence-fail");
  });
});

describe("computeSupplementaryDiagnostics — ungroundedEquivalent, isolated cases", () => {
  // Three minimal, single-purpose fixtures — one per case the diagnostic
  // must distinguish. Purely diagnostic: none of these change recall,
  // precision, taxonomy, or evidence-fidelity, which already correctly
  // treat "equivalent + evidence fail" as non-capture via isPassingMatch().
  const baseFixture: GoldFixture = {
    fixtureName: "ungrounded-equivalent-cases",
    transcriptFile: "n/a",
    frozenMarkdownContentHash: "n/a",
    items: [{ id: "GOLD-1", category: "requirement", proposition: "some proposition", quotes: ["q"] }],
    unsupportedDetailChecks: [],
    answeredQuestionChecks: [],
  };
  const candidate: GeneratedCandidate = { id: "gen-1", bucket: "requirement", text: "t", quote: "q" };

  function metricsFor(correspondence: "equivalent" | "partial", evidenceFidelity: "pass" | "fail") {
    const matchResult: GoldMatchResult = {
      matches: [{ goldId: "GOLD-1", generatedItemId: "gen-1", generatedBucket: "requirement", correspondence }],
      unmatchedGoldIds: [],
      unmatchedGeneratedItemIds: [],
      generatedEvidence: [{ generatedItemId: "gen-1", evidenceFidelity, reason: "test" }],
    };
    return computeGoldMetrics(baseFixture, { requirements: [candidate], questions: [], assumptionClaims: [] }, matchResult);
  }

  it("equivalent + evidence fail -> appears in the ungrounded-equivalent diagnostic", () => {
    const m = metricsFor("equivalent", "fail");
    expect(m.supplementary.ungroundedEquivalentItemIds).toEqual(["gen-1"]);
    expect(m.supplementary.ungroundedEquivalentCount).toBe(1);
  });

  it("equivalent + evidence pass -> does NOT appear (this is a real, grounded capture)", () => {
    const m = metricsFor("equivalent", "pass");
    expect(m.supplementary.ungroundedEquivalentItemIds).toEqual([]);
    expect(m.supplementary.ungroundedEquivalentCount).toBe(0);
  });

  it("partial + evidence fail -> does NOT appear (this diagnostic is specifically semantic-equivalent-but-ungrounded, not any-correspondence-but-ungrounded)", () => {
    const m = metricsFor("partial", "fail");
    expect(m.supplementary.ungroundedEquivalentItemIds).toEqual([]);
    expect(m.supplementary.ungroundedEquivalentCount).toBe(0);
  });
});

describe("equivalent correspondence + failing evidence — isolated precedence regression", () => {
  // A minimal, dedicated fixture (not the shared one above) so this
  // specific rule is unambiguous: a gold item whose ONLY relationship to
  // any generated item is an `equivalent` correspondence riding on
  // FAILING evidence must count as NOT captured for recall/taxonomy/
  // precision — a real, verbatim-sounding quote attached to a wrong
  // interpretation is not a grounded match, no matter how close the
  // wording reads. This must never silently degrade into "close enough."
  const isolatedFixture: GoldFixture = {
    fixtureName: "isolated-evidence-fail",
    transcriptFile: "n/a",
    frozenMarkdownContentHash: "n/a",
    items: [{ id: "GOLD-ONLY-EVIDENCE-FAIL", category: "requirement", proposition: "some real requirement", quotes: ["q"] }],
    unsupportedDetailChecks: [],
    answeredQuestionChecks: [],
  };
  const generatedReq: GeneratedCandidate = { id: "gen-1", bucket: "requirement", text: "t", quote: "q" };
  const isolatedMatchResult: GoldMatchResult = {
    matches: [
      {
        goldId: "GOLD-ONLY-EVIDENCE-FAIL",
        generatedItemId: "gen-1",
        generatedBucket: "requirement",
        correspondence: "equivalent",
      },
    ],
    unmatchedGoldIds: [],
    unmatchedGeneratedItemIds: [],
    generatedEvidence: [{ generatedItemId: "gen-1", evidenceFidelity: "fail", reason: "quote does not support the stated text" }],
  };
  const isolatedMetrics = computeGoldMetrics(
    isolatedFixture,
    { requirements: [generatedReq], questions: [], assumptionClaims: [] },
    isolatedMatchResult,
  );

  it("is NOT captured for recall — the sole match's evidence fails", () => {
    expect(isolatedMetrics.recall.capturedCount).toBe(0);
    expect(isolatedMetrics.recall.capturedGoldIds).toEqual([]);
  });

  it("is NOT credited in taxonomy accuracy — never recalled, so never eligible for a placement verdict", () => {
    expect(isolatedMetrics.taxonomyAccuracy.primaryRecalledCount).toBe(0);
  });

  it("does NOT count toward strict requirement precision — the generated item lands in the unmatched bucket, not passing", () => {
    expect(isolatedMetrics.requirementPrecision.strictPrecision).toBe(0);
    expect(isolatedMetrics.requirementPrecision.buckets.passing.ids).toEqual([]);
    expect(isolatedMetrics.requirementPrecision.buckets.unmatched.ids).toEqual(["gen-1"]);
  });

  it("remains fully visible in the raw judge-match-table data — not stripped anywhere, only excluded from aggregate positive-credit metrics", () => {
    // This is the "still visible diagnostically" half of the requirement:
    // computeGoldMetrics never mutates or filters the raw response — the
    // orchestrator (scripts/eval/gold-match.ts) persists the ENTIRE
    // GoldMatchResult (matches[] + generatedEvidence[]) verbatim into the
    // audit artifact's `judgeMatchTable` field regardless of what any
    // aggregate metric concludes, so this exact pair — the equivalent
    // correspondence AND its failing evidence reason — is always
    // recoverable from the persisted run, even though no positive metric
    // credits it.
    expect(isolatedMatchResult.matches).toHaveLength(1);
    expect(isolatedMatchResult.matches[0]).toMatchObject({
      goldId: "GOLD-ONLY-EVIDENCE-FAIL",
      correspondence: "equivalent",
    });
    expect(isolatedMatchResult.generatedEvidence[0]).toMatchObject({
      generatedItemId: "gen-1",
      evidenceFidelity: "fail",
    });
  });
});

describe("computeGoldMetrics with zero generated candidates", () => {
  it("reports null rates instead of dividing by zero", () => {
    const empty = computeGoldMetrics(
      fixture,
      { requirements: [], questions: [], assumptionClaims: [] },
      { matches: [], unmatchedGoldIds: fixture.items.map((i) => i.id), unmatchedGeneratedItemIds: [], generatedEvidence: [] },
    );
    expect(empty.requirementPrecision.strictPrecision).toBeNull();
    expect(empty.requirementPrecision.nonPrecisionRate).toBeNull();
    expect(empty.recall.capturedCount).toBe(0);
    expect(empty.evidenceFidelity.rate).toBeNull();
  });
});
