import { describe, it, expect } from "vitest";
import { ClaimSchema, RequirementSchema, RecommendationSchema } from "../../src/types/domain.js";

describe("ClaimSchema", () => {
  it("accepts a well-formed claim", () => {
    const parsed = ClaimSchema.parse({
      id: "clm_01J000000000000000000000AA",
      sessionId: "ses_01J000000000000000000000AB",
      transcriptId: "trs_01J000000000000000000000AC",
      segmentId: "seg_01J000000000000000000000AD",
      quote: "anything over ten thousand euro goes to a manager",
      statement: "Invoices over EUR 10,000 require manager approval.",
      speakerRole: "client",
      kind: "requirement",
      status: "validated",
      charStart: 120,
      charEnd: 169,
      matchMode: "exact",
      createdAt: "2026-08-05T10:00:00.000Z",
    });
    expect(parsed.kind).toBe("requirement");
  });

  it("rejects an empty quote", () => {
    expect(() =>
      ClaimSchema.parse({
        id: "clm_01J000000000000000000000AA",
        sessionId: "ses_01J000000000000000000000AB",
        transcriptId: "trs_01J000000000000000000000AC",
        segmentId: "seg_01J000000000000000000000AD",
        quote: "",
        statement: "x",
        speakerRole: "client",
        kind: "requirement",
        status: "candidate",
        charStart: null,
        charEnd: null,
        matchMode: null,
        createdAt: "2026-08-05T10:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("RequirementSchema", () => {
  it("rejects a requirement with no origin claims", () => {
    expect(() =>
      RequirementSchema.parse({
        id: "req_01J000000000000000000000AA",
        projectId: "prj_01J000000000000000000000AB",
        key: "REQ-001",
        statement: "Invoices over EUR 10,000 require manager approval.",
        status: "proposed",
        origin: "client-stated",
        originClaimIds: [],
        supersedesId: null,
        createdAt: "2026-08-05T10:00:00.000Z",
      }),
    ).toThrow(/at least one origin claim/);
  });
});

describe("RecommendationSchema", () => {
  it("has no field capable of expressing a requirement", () => {
    const keys = Object.keys(RecommendationSchema.shape);
    expect(keys).not.toContain("requirement");
    expect(keys).not.toContain("statement");
  });
});
