import { z } from "zod/v4";

/**
 * The response shape for ONE correspondence batch call (small local judge
 * path — scripts/eval/gold-local-judge-batching.ts): a handful of gold
 * items (see CORRESPONDENCE_GOLD_BATCH_SIZE in gold-batching.ts) judged
 * against every generated candidate. Deliberately excludes
 * generatedEvidence — evidence fidelity is a wholly separate,
 * generated-item-centric task judged by EvidenceBatchSchema below, never
 * mixed into the same call (gold-batch-orchestration design note: a small
 * local model reliably completes a narrow enumeration task but loses
 * coverage on a large mixed one — see the failed monolithic-schema baseline
 * run this replaces).
 *
 * `reviewedGoldIds` is the field that makes per-batch coverage checkable
 * without asking the model to also enumerate unmatchedGoldIds: the
 * orchestrator already knows exactly which gold ids were sent in this
 * batch, so it only needs the model to CONFIRM it considered exactly that
 * set — any gold id in reviewedGoldIds that never appears in matches[] is
 * deterministically "no relationship found in this batch" (see
 * deriveUnmatchedGoldIds in gold-batching.ts). Coverage validation rejects
 * the batch outright if reviewedGoldIds doesn't exactly equal the batch's
 * sent gold ids (missing, extra, hallucinated, or malformed).
 */
export const CorrespondenceBatchSchema = z.object({
  reviewedGoldIds: z.array(z.string()),
  matches: z.array(
    z.object({
      goldId: z.string(),
      generatedItemId: z.string(),
      generatedBucket: z.enum(["requirement", "question", "assumptionClaim"]),
      correspondence: z.enum(["equivalent", "partial", "contradicts"]),
      // REQUIRED for the same reason as GoldMatchSchema's identical field —
      // node-llama-cpp's grammar-constrained decoding has no concept of an
      // optional object property. false is the ordinary "not applicable or
      // no violation" value, not an omission.
      meetingStateViolation: z.boolean(),
    }),
  ),
});
export type CorrespondenceBatchResult = z.infer<typeof CorrespondenceBatchSchema>;
export type BatchMatch = CorrespondenceBatchResult["matches"][number];

/**
 * The response shape for ONE evidence-fidelity batch call: a handful of
 * generated candidates (see EVIDENCE_CANDIDATE_BATCH_SIZE in
 * gold-batching.ts), judged purely on whether each candidate's own cited
 * quote supports its own text — no gold items or correspondence
 * information involved at all. Coverage validation requires
 * generatedEvidence[] to contain EXACTLY one entry per candidate id sent in
 * this batch; unlike the correspondence batch, no separate "reviewed"
 * field is needed because every sent candidate must produce exactly one
 * verdict by construction, so the entries' own ids fully prove coverage.
 */
export const EvidenceBatchSchema = z.object({
  generatedEvidence: z.array(
    z.object({
      generatedItemId: z.string(),
      evidenceFidelity: z.enum(["pass", "fail"]),
      reason: z.string(),
    }),
  ),
});
export type EvidenceBatchResult = z.infer<typeof EvidenceBatchSchema>;
export type BatchEvidenceEntry = EvidenceBatchResult["generatedEvidence"][number];
