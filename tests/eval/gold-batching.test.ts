import { describe, it, expect } from "vitest";
import {
  CORRESPONDENCE_GOLD_BATCH_SIZE,
  EVIDENCE_CANDIDATE_BATCH_SIZE,
  buildCorrespondenceBatches,
  buildEvidenceBatches,
  checkCorrespondenceBatchCoverage,
  checkEvidenceBatchCoverage,
  deriveUnmatchedGoldIds,
  deriveUnmatchedGeneratedItemIds,
  aggregateBatchedMatch,
} from "../../src/eval/gold-batching.js";
import { GoldMatchSchema } from "../../src/eval/gold-match-schema.js";
import { checkCoverage } from "../../src/eval/gold-coverage.js";
import type { GoldItem } from "../../src/eval/gold-schema.js";
import type { GeneratedCandidate } from "../../src/eval/gold-metrics.js";
import type { CorrespondenceBatchResult, EvidenceBatchResult } from "../../src/eval/gold-batch-schema.js";
import type { Match, EvidenceEntry } from "../../src/eval/gold-match-schema.js";

function makeGoldItems(count: number): GoldItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `REQ-${String(i + 1).padStart(2, "0")}`,
    category: "requirement" as const,
    proposition: `proposition ${i + 1}`,
    quotes: [`quote ${i + 1}`],
  }));
}

function makeCandidates(count: number): GeneratedCandidate[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `cand_${i + 1}`,
    bucket: "requirement" as const,
    text: `candidate ${i + 1}`,
    quote: `candidate quote ${i + 1}`,
  }));
}

describe("buildCorrespondenceBatches — 38 gold items split into bounded batches", () => {
  it("splits 38 gold items into batches of CORRESPONDENCE_GOLD_BATCH_SIZE (5), last batch a remainder", () => {
    const goldItems = makeGoldItems(38);
    const batches = buildCorrespondenceBatches(goldItems);

    expect(batches).toHaveLength(8); // ceil(38/5)
    for (const batch of batches.slice(0, -1)) {
      expect(batch).toHaveLength(CORRESPONDENCE_GOLD_BATCH_SIZE);
    }
    expect(batches.at(-1)).toHaveLength(3); // 38 - 7*5

    // No missing, no duplicate gold ids across the batches.
    const allIds = batches.flat().map((g) => g.id);
    expect(allIds).toHaveLength(38);
    expect(new Set(allIds).size).toBe(38);
    expect(new Set(allIds)).toEqual(new Set(goldItems.map((g) => g.id)));
  });

  it("produces exactly one batch for a count under the batch size", () => {
    const batches = buildCorrespondenceBatches(makeGoldItems(3));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it("produces zero batches for an empty gold set", () => {
    expect(buildCorrespondenceBatches([])).toEqual([]);
  });
});

describe("buildEvidenceBatches — candidates split into complete, non-overlapping batches", () => {
  it("splits 30 candidates into batches of EVIDENCE_CANDIDATE_BATCH_SIZE (10)", () => {
    const candidates = makeCandidates(30);
    const batches = buildEvidenceBatches(candidates);

    expect(batches).toHaveLength(3); // 30/10 exactly
    for (const batch of batches) expect(batch).toHaveLength(EVIDENCE_CANDIDATE_BATCH_SIZE);

    const allIds = batches.flat().map((c) => c.id);
    expect(allIds).toHaveLength(30);
    expect(new Set(allIds).size).toBe(30); // no duplicates
    expect(new Set(allIds)).toEqual(new Set(candidates.map((c) => c.id))); // no missing

    // Non-overlapping: no candidate id appears in more than one batch.
    for (let i = 0; i < batches.length; i++) {
      for (let j = i + 1; j < batches.length; j++) {
        const idsI = new Set(batches[i]!.map((c) => c.id));
        const overlap = batches[j]!.filter((c) => idsI.has(c.id));
        expect(overlap).toEqual([]);
      }
    }
  });

  it("handles a remainder batch correctly (31 candidates -> 4 batches, last one smaller)", () => {
    const batches = buildEvidenceBatches(makeCandidates(31));
    expect(batches).toHaveLength(4);
    expect(batches.slice(0, 3).every((b) => b.length === 10)).toBe(true);
    expect(batches.at(-1)).toHaveLength(1);
  });
});

describe("checkCorrespondenceBatchCoverage — rejects missing/hallucinated/duplicate ids", () => {
  const batchGoldIds = ["G1", "G2", "G3", "G4", "G5"];
  const candidateIds = ["c1", "c2"];

  function baseResponse(overrides: Partial<CorrespondenceBatchResult> = {}): CorrespondenceBatchResult {
    return {
      reviewedGoldIds: [...batchGoldIds],
      matches: [{ goldId: "G1", generatedItemId: "c1", generatedBucket: "requirement", correspondence: "equivalent", meetingStateViolation: false }],
      ...overrides,
    };
  }

  it("passes when reviewedGoldIds exactly equals the batch's gold ids and matches reference only sent ids", () => {
    const result = checkCorrespondenceBatchCoverage(baseResponse(), batchGoldIds, candidateIds);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a batch missing a gold id from reviewedGoldIds", () => {
    const response = baseResponse({ reviewedGoldIds: ["G1", "G2", "G3", "G4"] }); // G5 dropped
    const result = checkCorrespondenceBatchCoverage(response, batchGoldIds, candidateIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("missing") && e.includes("G5"))).toBe(true);
  });

  it("rejects a batch with a hallucinated gold id in reviewedGoldIds (not in this batch)", () => {
    const response = baseResponse({ reviewedGoldIds: [...batchGoldIds, "G99-NOT-IN-BATCH"] });
    const result = checkCorrespondenceBatchCoverage(response, batchGoldIds, candidateIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("G99-NOT-IN-BATCH"))).toBe(true);
  });

  it("rejects a batch with a duplicate gold id in reviewedGoldIds", () => {
    const response = baseResponse({ reviewedGoldIds: ["G1", "G1", "G2", "G3", "G4", "G5"] });
    const result = checkCorrespondenceBatchCoverage(response, batchGoldIds, candidateIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("rejects matches[] referencing a goldId outside this batch (e.g. hallucinated or belonging to another batch)", () => {
    const response = baseResponse({
      matches: [{ goldId: "REQ-20-FROM-ANOTHER-BATCH", generatedItemId: "c1", generatedBucket: "requirement", correspondence: "partial", meetingStateViolation: false }],
    });
    const result = checkCorrespondenceBatchCoverage(response, batchGoldIds, candidateIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("REQ-20-FROM-ANOTHER-BATCH"))).toBe(true);
  });

  it("rejects matches[] referencing a generatedItemId never sent to the judge", () => {
    const response = baseResponse({
      matches: [{ goldId: "G1", generatedItemId: "c99-never-sent", generatedBucket: "requirement", correspondence: "equivalent", meetingStateViolation: false }],
    });
    const result = checkCorrespondenceBatchCoverage(response, batchGoldIds, candidateIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("c99-never-sent"))).toBe(true);
  });
});

describe("checkEvidenceBatchCoverage — rejects missing/hallucinated/duplicate ids", () => {
  const candidateIds = ["c1", "c2", "c3"];

  function baseResponse(overrides: Partial<EvidenceBatchResult> = {}): EvidenceBatchResult {
    return {
      generatedEvidence: candidateIds.map((id) => ({ generatedItemId: id, evidenceFidelity: "pass" as const, reason: "ok" })),
      ...overrides,
    };
  }

  it("passes when generatedEvidence[] has exactly one entry per sent candidate id", () => {
    const result = checkEvidenceBatchCoverage(baseResponse(), candidateIds);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a missing candidate id", () => {
    const response = baseResponse({ generatedEvidence: [{ generatedItemId: "c1", evidenceFidelity: "pass", reason: "ok" }] });
    const result = checkEvidenceBatchCoverage(response, candidateIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("missing") && e.includes("c2") && e.includes("c3"))).toBe(true);
  });

  it("rejects a hallucinated candidate id not sent to the judge", () => {
    const response = baseResponse({
      generatedEvidence: [...baseResponse().generatedEvidence, { generatedItemId: "c99-never-sent", evidenceFidelity: "fail", reason: "n/a" }],
    });
    const result = checkEvidenceBatchCoverage(response, candidateIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("c99-never-sent"))).toBe(true);
  });

  it("rejects a duplicate entry for the same candidate id", () => {
    const response = baseResponse({
      generatedEvidence: [...baseResponse().generatedEvidence, { generatedItemId: "c1", evidenceFidelity: "fail", reason: "dup" }],
    });
    const result = checkEvidenceBatchCoverage(response, candidateIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate") && e.includes("c1"))).toBe(true);
  });
});

describe("deriveUnmatchedGoldIds / deriveUnmatchedGeneratedItemIds — deterministic derivation", () => {
  it("derives unmatched gold ids as exactly those never referenced by a match", () => {
    const matches: Match[] = [
      { goldId: "G1", generatedItemId: "c1", generatedBucket: "requirement", correspondence: "equivalent", meetingStateViolation: false },
    ];
    expect(deriveUnmatchedGoldIds(["G1", "G2", "G3"], matches)).toEqual(["G2", "G3"]);
  });

  it("derives unmatched generated item ids as exactly those never referenced by a match", () => {
    const matches: Match[] = [
      { goldId: "G1", generatedItemId: "c1", generatedBucket: "requirement", correspondence: "equivalent", meetingStateViolation: false },
    ];
    expect(deriveUnmatchedGeneratedItemIds(["c1", "c2"], matches)).toEqual(["c2"]);
  });

  it("a gold id matched multiple times (e.g. two partial matches) is not unmatched", () => {
    const matches: Match[] = [
      { goldId: "G1", generatedItemId: "c1", generatedBucket: "requirement", correspondence: "partial", meetingStateViolation: false },
      { goldId: "G1", generatedItemId: "c2", generatedBucket: "requirement", correspondence: "partial", meetingStateViolation: false },
    ];
    expect(deriveUnmatchedGoldIds(["G1"], matches)).toEqual([]);
  });
});

describe("aggregateBatchedMatch — produces the same canonical GoldMatchResult shape used today", () => {
  it("assembles matches + evidence + deterministically-derived unmatched arrays into a schema-valid, coverage-valid result", () => {
    const allGoldIds = ["G1", "G2", "G3"];
    const allGeneratedIds = ["c1", "c2"];
    const matches: Match[] = [
      { goldId: "G1", generatedItemId: "c1", generatedBucket: "requirement", correspondence: "equivalent", meetingStateViolation: false },
    ];
    const evidence: EvidenceEntry[] = [
      { generatedItemId: "c1", evidenceFidelity: "pass", reason: "supports it" },
      { generatedItemId: "c2", evidenceFidelity: "fail", reason: "no support" },
    ];

    const aggregated = aggregateBatchedMatch(allGoldIds, allGeneratedIds, matches, evidence);

    // Same shape the single-call judge path produces — schema-valid.
    expect(() => GoldMatchSchema.parse(aggregated)).not.toThrow();

    // From the metrics layer's perspective this is indistinguishable from
    // a successful single large judge call: it passes the exact same
    // global coverage check that gates the single-call path.
    const coverage = checkCoverage(aggregated, allGoldIds, allGeneratedIds);
    expect(coverage.valid, coverage.errors.join("; ")).toBe(true);

    expect(aggregated.matches).toEqual(matches);
    expect(aggregated.generatedEvidence).toEqual(evidence);
    expect(aggregated.unmatchedGoldIds).toEqual(["G2", "G3"]);
    // c2 has an evidence verdict but no correspondence match — evidence
    // fidelity and correspondence are independent concerns (matching the
    // existing GoldMatchSchema/checkCoverage semantics), so c2 correctly
    // remains "unmatched" for correspondence purposes despite being
    // evidence-covered.
    expect(aggregated.unmatchedGeneratedItemIds).toEqual(["c2"]);
  });

  it("aggregating batches for the full 38-gold/30-candidate scale still passes global coverage", () => {
    const goldItems = makeGoldItems(38);
    const candidates = makeCandidates(30);
    const allGoldIds = goldItems.map((g) => g.id);
    const allGeneratedIds = candidates.map((c) => c.id);

    // Simulate every correspondence batch reporting no relationships found
    // (an empty matches[] is a legal, fully-covered outcome once
    // reviewedGoldIds confirms every id was considered) and every evidence
    // batch passing every candidate.
    const matches: Match[] = [];
    const evidence: EvidenceEntry[] = candidates.map((c) => ({ generatedItemId: c.id, evidenceFidelity: "pass", reason: "ok" }));

    const aggregated = aggregateBatchedMatch(allGoldIds, allGeneratedIds, matches, evidence);
    const coverage = checkCoverage(aggregated, allGoldIds, allGeneratedIds);
    expect(coverage.valid, coverage.errors.join("; ")).toBe(true);
    expect(aggregated.unmatchedGoldIds).toHaveLength(38);
    // No matches[] entries at all in this simulation, so every candidate is
    // correctly unmatched for correspondence even though all 30 passed
    // evidence fidelity — the two concerns are independent.
    expect(aggregated.unmatchedGeneratedItemIds).toHaveLength(30);
  });
});
