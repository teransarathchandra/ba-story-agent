import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeCandidateContentHash, loadCandidateSnapshot, CandidateSnapshotSchema } from "../../src/eval/candidate-snapshot.js";

function baseOutputs() {
  return {
    requirements: [{ id: "req_1", bucket: "requirement" as const, text: "The system must do X", quote: "do X" }],
    questions: [{ id: "oqn_1", bucket: "question" as const, text: "What about Y?", quote: "" }],
    assumptionClaims: [{ id: "clm_1", bucket: "assumptionClaim" as const, text: "Assume Z", quote: "Z" }],
  };
}

function buildSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  const normalizedPipelineOutputs = baseOutputs();
  const base = {
    snapshotId: "snap-1",
    fixtureName: "test-fixture",
    sourceProjectId: "prj_test",
    sourceSessionId: "ses_test",
    sourceDbHashAtExtraction: "deadbeef",
    extractionTimestamp: "2026-08-10T00:00:00.000Z",
    sourceGeneratorBackendLabel: "local",
    sourceGeneratorModel: "hf:some/model",
    candidateContentSha256: computeCandidateContentHash(normalizedPipelineOutputs),
    normalizedPipelineOutputs,
  };
  return { ...base, ...overrides };
}

describe("computeCandidateContentHash", () => {
  it("is deterministic for the same content", () => {
    const outputs = baseOutputs();
    expect(computeCandidateContentHash(outputs)).toBe(computeCandidateContentHash(outputs));
  });

  it("changes when a candidate's text changes", () => {
    const a = baseOutputs();
    const b = baseOutputs();
    b.requirements[0]!.text = "different text";
    expect(computeCandidateContentHash(a)).not.toBe(computeCandidateContentHash(b));
  });
});

describe("loadCandidateSnapshot — self-verification", () => {
  let dir: string;

  function withTempFile(content: unknown): string {
    dir = mkdtempSync(join(tmpdir(), "candidate-snapshot-test-"));
    const path = join(dir, "snapshot.json");
    writeFileSync(path, JSON.stringify(content, null, 2));
    return path;
  }

  it("loads a valid, hash-consistent snapshot without throwing", () => {
    const path = withTempFile(buildSnapshot());
    const loaded = loadCandidateSnapshot(path);
    expect(loaded.snapshotId).toBe("snap-1");
    expect(loaded.normalizedPipelineOutputs.requirements).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when candidateContentSha256 doesn't match the actual content (hand-edited or corrupted)", () => {
    const snapshot = buildSnapshot();
    // Tamper with content AFTER the hash was computed — simulates a
    // hand-edit that forgot to update candidateContentSha256.
    (snapshot.normalizedPipelineOutputs as ReturnType<typeof baseOutputs>).requirements[0]!.text = "tampered text";
    const path = withTempFile(snapshot);
    expect(() => loadCandidateSnapshot(path)).toThrow(/content hash mismatch/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a snapshot missing required provenance fields via schema validation", () => {
    const snapshot = buildSnapshot();
    delete (snapshot as Record<string, unknown>).sourceDbHashAtExtraction;
    const path = withTempFile(snapshot);
    expect(() => loadCandidateSnapshot(path)).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("CandidateSnapshotSchema", () => {
  it("accepts a well-formed snapshot", () => {
    expect(() => CandidateSnapshotSchema.parse(buildSnapshot())).not.toThrow();
  });

  it("rejects a candidate bucket outside the three known buckets", () => {
    const snapshot = buildSnapshot();
    (snapshot.normalizedPipelineOutputs as any).requirements[0].bucket = "not-a-real-bucket";
    expect(() => CandidateSnapshotSchema.parse(snapshot)).toThrow();
  });
});
