import { describe, it, expect } from "vitest";
import { checkCoverage } from "../../src/eval/gold-coverage.js";
import type { GoldMatchResult } from "../../src/eval/gold-match-schema.js";

const GOLD_IDS = ["G1", "G2", "G3"];
const GENERATED_IDS = ["r1", "r2"];

function baseResponse(overrides: Partial<GoldMatchResult> = {}): GoldMatchResult {
  return {
    matches: [
      { goldId: "G1", generatedItemId: "r1", generatedBucket: "requirement", correspondence: "equivalent" },
    ],
    unmatchedGoldIds: ["G2", "G3"],
    unmatchedGeneratedItemIds: ["r2"],
    generatedEvidence: [
      { generatedItemId: "r1", evidenceFidelity: "pass", reason: "matches quote" },
      { generatedItemId: "r2", evidenceFidelity: "fail", reason: "no support" },
    ],
    ...overrides,
  };
}

describe("checkCoverage", () => {
  it("passes when every gold and generated id is accounted for exactly once", () => {
    const result = checkCoverage(baseResponse(), GOLD_IDS, GENERATED_IDS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when a gold id is missing from both matches[] and unmatchedGoldIds", () => {
    const response = baseResponse({ unmatchedGoldIds: ["G2"] }); // G3 dropped
    const result = checkCoverage(response, GOLD_IDS, GENERATED_IDS);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("G3"))).toBe(true);
  });

  it("fails when a gold id appears in BOTH matches[] and unmatchedGoldIds", () => {
    const response = baseResponse({ unmatchedGoldIds: ["G1", "G2", "G3"] }); // G1 double-reported
    const result = checkCoverage(response, GOLD_IDS, GENERATED_IDS);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("BOTH") && e.includes("G1"))).toBe(true);
  });

  it("fails when a generated item id is missing from both matches[] and unmatchedGeneratedItemIds", () => {
    const response = baseResponse({ unmatchedGeneratedItemIds: [] }); // r2 dropped
    const result = checkCoverage(response, GOLD_IDS, GENERATED_IDS);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("r2"))).toBe(true);
  });

  it("fails when matches[] references a goldId never sent to the judge", () => {
    const response = baseResponse({
      matches: [
        { goldId: "G1", generatedItemId: "r1", generatedBucket: "requirement", correspondence: "equivalent" },
        { goldId: "G99-NEVER-SENT", generatedItemId: "r1", generatedBucket: "requirement", correspondence: "equivalent" },
      ],
    });
    const result = checkCoverage(response, GOLD_IDS, GENERATED_IDS);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("G99-NEVER-SENT"))).toBe(true);
  });

  it("fails when generatedEvidence[] has a duplicate entry for the same generated item", () => {
    const response = baseResponse({
      generatedEvidence: [
        { generatedItemId: "r1", evidenceFidelity: "pass", reason: "a" },
        { generatedItemId: "r1", evidenceFidelity: "fail", reason: "b" },
        { generatedItemId: "r2", evidenceFidelity: "fail", reason: "c" },
      ],
    });
    const result = checkCoverage(response, GOLD_IDS, GENERATED_IDS);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate") && e.includes("r1"))).toBe(true);
  });

  it("fails when generatedEvidence[] is missing an entry for a sent generated item", () => {
    const response = baseResponse({
      generatedEvidence: [{ generatedItemId: "r1", evidenceFidelity: "pass", reason: "a" }],
    });
    const result = checkCoverage(response, GOLD_IDS, GENERATED_IDS);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("missing") && e.includes("r2"))).toBe(true);
  });

  it("collects multiple independent errors in one pass, not just the first", () => {
    const response = baseResponse({
      unmatchedGoldIds: [], // drops G2, G3
      generatedEvidence: [{ generatedItemId: "r1", evidenceFidelity: "pass", reason: "a" }], // drops r2's evidence
    });
    const result = checkCoverage(response, GOLD_IDS, GENERATED_IDS);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
