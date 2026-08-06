import { describe, it, expect } from "vitest";
import { jsonPublisher } from "../../src/export/json.js";
import { SNAPSHOT_SCHEMA_VERSION, type ExportSnapshot } from "../../src/export/snapshot.js";

const snapshot: ExportSnapshot = {
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  project: { name: "P", domain: "d", regulatoryContext: "none" },
  generatedAt: "2026-08-05T00:00:00.000Z",
  requirements: [{ key: "REQ-001", statement: "s", status: "finalized", origin: "client-stated", evidence: [{ quote: "q", sessionTitle: "S", occurredAt: "2026-08-05T00:00:00.000Z", startMs: null, matchMode: "exact" }] }],
  stories: [], assumptions: [], openQuestions: [], recommendations: [], quarantined: [],
  provenance: { engineVersion: "0.1.0", llmModel: "claude-opus-5", sessions: [], egress: { requests: 0, promptTokens: 0, completionTokens: 0 } },
};

describe("jsonPublisher", () => {
  it("emits valid JSON that round-trips", () => {
    const parsed = JSON.parse(jsonPublisher.publish(snapshot)) as ExportSnapshot;
    expect(parsed.requirements[0]?.key).toBe("REQ-001");
  });

  it("includes $schema and schemaVersion", () => {
    const parsed = JSON.parse(jsonPublisher.publish(snapshot)) as Record<string, unknown>;
    expect(parsed.$schema).toBeDefined();
    expect(parsed.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
  });

  it("is stable for a fixed snapshot", () => {
    expect(jsonPublisher.publish(snapshot)).toBe(jsonPublisher.publish(snapshot));
  });

  it("never drops the evidence array", () => {
    const parsed = JSON.parse(jsonPublisher.publish(snapshot)) as ExportSnapshot;
    expect(parsed.requirements[0]?.evidence[0]?.quote).toBe("q");
  });
});
