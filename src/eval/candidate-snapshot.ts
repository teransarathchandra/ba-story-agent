import { z } from "zod/v4";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const SnapshotCandidateSchema = z.object({
  id: z.string(),
  bucket: z.enum(["requirement", "question", "assumptionClaim"]),
  text: z.string(),
  quote: z.string(),
});

/**
 * An immutable, promoted evaluation-input artifact: the exact normalized
 * candidate set (requirements/questions/assumptionClaims) a benchmark run
 * was judged against, frozen at extraction time — so re-running that
 * benchmark later never silently depends on whatever happens to be in the
 * live, mutable Electron SQLite DB that day. Distinct from an eval RUN
 * artifact (EvalRunArtifact in gold-match.ts, which records a judge's
 * verdict) — this is purely the INPUT side, reviewed and committed like the
 * frozen gold fixture itself.
 *
 * candidateContentSha256 is a self-check: hashes normalizedPipelineOutputs
 * so a hand-edited or corrupted snapshot file fails loudly at load time
 * (see loadCandidateSnapshot) instead of silently evaluating drifted
 * content under an unchanged snapshotId.
 */
export const CandidateSnapshotSchema = z.object({
  snapshotId: z.string(),
  fixtureName: z.string(),
  /** Provenance: exactly where this candidate set was read from, and when. Never used to re-fetch anything at eval time — the point of freezing is to never touch the DB again. */
  sourceProjectId: z.string(),
  sourceSessionId: z.string(),
  /** sha256 of the source DB FILE at the moment of extraction — proves what state the DB was in, not a live pointer to it. */
  sourceDbHashAtExtraction: z.string(),
  extractionTimestamp: z.string(),
  /** Read from the session's own egress_log at extraction time (never asserted) — so a snapshot-based eval run doesn't need the generator identity passed in by hand. */
  sourceGeneratorBackendLabel: z.string(),
  sourceGeneratorModel: z.string(),
  candidateContentSha256: z.string(),
  normalizedPipelineOutputs: z.object({
    requirements: z.array(SnapshotCandidateSchema),
    questions: z.array(SnapshotCandidateSchema),
    assumptionClaims: z.array(SnapshotCandidateSchema),
  }),
});
export type CandidateSnapshot = z.infer<typeof CandidateSnapshotSchema>;

export function computeCandidateContentHash(outputs: CandidateSnapshot["normalizedPipelineOutputs"]): string {
  return createHash("sha256").update(JSON.stringify(outputs)).digest("hex");
}

/**
 * Parses and self-verifies a candidate snapshot: candidateContentSha256
 * must match a freshly-recomputed hash of normalizedPipelineOutputs, or
 * this throws rather than returning silently-drifted content. This is the
 * only integrity check performed here — it does NOT re-check against the
 * live DB (that would defeat the point of freezing).
 */
export function loadCandidateSnapshot(path: string): CandidateSnapshot {
  const snapshot = CandidateSnapshotSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const recomputed = computeCandidateContentHash(snapshot.normalizedPipelineOutputs);
  if (recomputed !== snapshot.candidateContentSha256) {
    throw new Error(
      `candidate snapshot content hash mismatch at ${path}: file claims candidateContentSha256="${snapshot.candidateContentSha256}" but the actual content hashes to "${recomputed}" — the snapshot may have been hand-edited without updating its hash, or corrupted`,
    );
  }
  return snapshot;
}
