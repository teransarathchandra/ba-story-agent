// tests/export/markdown.test.ts
import { describe, it, expect } from "vitest";
import { markdownPublisher, formatTimestamp } from "../../src/export/markdown.js";
import { SNAPSHOT_SCHEMA_VERSION, type ExportSnapshot } from "../../src/export/snapshot.js";

const snapshot: ExportSnapshot = {
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  project: { name: "Nordic Freight", domain: "B2B freight invoicing", regulatoryContext: "GDPR" },
  generatedAt: "2026-08-05T00:00:00.000Z",
  requirements: [{
    key: "REQ-014", statement: "Invoices over EUR 10,000 must be approved by a manager.",
    status: "finalized", origin: "client-stated",
    evidence: [{ quote: "anything over ten thousand euro has to go to a manager", sessionTitle: "Session 2", occurredAt: "2026-07-01T00:00:00.000Z", startMs: 724000, matchMode: "exact" }],
  }],
  stories: [{
    key: "US-007", asA: "finance clerk", iWant: "invoices routed", soThat: "spend is checked",
    implements: ["REQ-014"],
    acceptanceCriteria: [
      { gherkin: "Given an invoice of EUR 10,001, when submitted, then it is routed", source: "client-stated", linkedQuestionKey: null },
      { gherkin: "Given no response in 48h, then it escalates", source: "derived", linkedQuestionKey: "OQ-021" },
    ],
  }],
  assumptions: [{ quote: "we would usually be dealing in euro", statement: "All invoices are in EUR.", sessionTitle: "Session 1", occurredAt: "2026-06-01T00:00:00.000Z" }],
  openQuestions: [{ key: "OQ-021", text: "Is 48h correct?", category: "domain", status: "open", raisedIn: "Session 2", answerText: null }],
  recommendations: [{ key: "REC-009", text: "Add an immutable audit trail.", rationale: "No audit mechanism discussed.", category: "security", status: "open" }],
  quarantined: [{ quote: "passwords rotate every ninety days", statement: "invented", sessionTitle: "Session 2" }],
  provenance: { engineVersion: "0.1.0", llmModel: "claude-opus-5", sessions: [{ title: "Session 2", occurredAt: "2026-07-01T00:00:00.000Z", transcriptHash: "a".repeat(64), wordCount: 4200 }], egress: { requests: 12, promptTokens: 184000, completionTokens: 9000 } },
};

describe("formatTimestamp", () => {
  it("renders mm:ss", () => {
    expect(formatTimestamp(724000)).toBe("12:04");
    expect(formatTimestamp(65000)).toBe("01:05");
  });
  it("renders a dash for null", () => {
    expect(formatTimestamp(null)).toBe("—");
  });
});

describe("markdownPublisher", () => {
  const md = markdownPublisher.publish(snapshot);

  it("attaches a verbatim quote to every confirmed requirement", () => {
    expect(md).toMatch(/### REQ-014/);
    expect(md).toMatch(/anything over ten thousand euro has to go to a manager/);
    expect(md).toMatch(/12:04/);
  });

  it("flags a requirement that has not been approved", () => {
    const proposed = markdownPublisher.publish({
      ...snapshot,
      requirements: [{ ...snapshot.requirements[0]!, status: "proposed" }],
    });
    expect(proposed).toMatch(/\[NOT YET APPROVED\]/);
    expect(md).not.toMatch(/\[NOT YET APPROVED\]/);
  });

  it("marks derived acceptance criteria inline and links the question", () => {
    expect(md).toMatch(/\[client-stated\]/);
    expect(md).toMatch(/\[DERIVED — UNCONFIRMED\]/);
    expect(md).toMatch(/OQ-021/);
  });

  it("titles the assumptions section as NOT client-confirmed", () => {
    expect(md).toMatch(/## 3\. Assumptions — NOT client-confirmed/);
  });

  it("titles the recommendations section as not client requirements", () => {
    expect(md).toMatch(/## 5\. Recommendations — tool-generated, not client requirements/);
  });

  it("publishes the quarantine appendix with a count", () => {
    expect(md).toMatch(/Appendix A — Quarantined extractions \(n=1\)/);
    expect(md).toMatch(/passwords rotate every ninety days/);
  });

  it("publishes the provenance appendix", () => {
    expect(md).toMatch(/Appendix B — Provenance/);
    expect(md).toMatch(/claude-opus-5/);
    expect(md).toMatch(/12 requests/);
    expect(md).toMatch(/aaaaaaaa/);
  });

  it("is stable for a fixed snapshot", () => {
    expect(markdownPublisher.publish(snapshot)).toBe(md);
  });

  it("renders empty sections gracefully", () => {
    const empty: ExportSnapshot = { ...snapshot, requirements: [], stories: [], assumptions: [], openQuestions: [], recommendations: [], quarantined: [] };
    const out = markdownPublisher.publish(empty);
    expect(out).toMatch(/No confirmed requirements/);
    expect(out).toMatch(/Appendix A — Quarantined extractions \(n=0\)/);
  });
});
