import { describe, it, expect } from "vitest";
import { GoldMatchSchema } from "../../src/eval/gold-match-schema.js";

/**
 * Runtime proof (not just the type system) that GoldMatchSchema requires
 * meetingStateViolation on every match entry — this is what a real judge
 * response actually gets validated against, and the type-level enforcement
 * alone doesn't prove .safeParse() behaves the same way at runtime.
 */
describe("GoldMatchSchema — meetingStateViolation is a required boolean", () => {
  function baseResponse(matchOverrides: Record<string, unknown> = {}) {
    return {
      matches: [
        {
          goldId: "G1",
          generatedItemId: "r1",
          generatedBucket: "requirement",
          correspondence: "equivalent",
          meetingStateViolation: false,
          ...matchOverrides,
        },
      ],
      unmatchedGoldIds: [],
      unmatchedGeneratedItemIds: [],
      generatedEvidence: [{ generatedItemId: "r1", evidenceFidelity: "pass", reason: "ok" }],
    };
  }

  it("rejects a match entry missing meetingStateViolation entirely", () => {
    const response = baseResponse();
    delete (response.matches[0] as Record<string, unknown>).meetingStateViolation;
    const result = GoldMatchSchema.safeParse(response);
    expect(result.success).toBe(false);
  });

  it("accepts meetingStateViolation: false — the ordinary, no-violation default", () => {
    const result = GoldMatchSchema.safeParse(baseResponse({ meetingStateViolation: false }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.matches[0]!.meetingStateViolation).toBe(false);
  });

  it("accepts meetingStateViolation: true — a real violation, semantics preserved", () => {
    const result = GoldMatchSchema.safeParse(baseResponse({ meetingStateViolation: true }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.matches[0]!.meetingStateViolation).toBe(true);
  });

  it("rejects a non-boolean value (e.g. a stray string) for meetingStateViolation", () => {
    const result = GoldMatchSchema.safeParse(baseResponse({ meetingStateViolation: "false" }));
    expect(result.success).toBe(false);
  });
});
