import { z } from "zod/v4";

/**
 * The one structured judge call per fixture per generator run (design §5).
 * `matches[]` judges semantic correspondence only — never evidence
 * fidelity, which lives exclusively in `generatedEvidence[]` and is joined
 * back by `generatedItemId` in the metrics layer (gold-metrics.ts). There
 * is deliberately no `categoryCorrect` field: placement correctness is
 * derived from `generatedBucket` against the expected-bucket table in
 * gold-schema.ts, not asked of the model — see the design doc's rationale
 * for why a derived value can't be internally inconsistent the way an
 * independently-asked one could.
 *
 * `unmatchedGoldIds` / `unmatchedGeneratedItemIds` make the judge state
 * "I considered this and found nothing" explicitly, so a genuinely
 * unconsidered item (the judge silently forgetting one) is distinguishable
 * from a real negative result — see gold-coverage.ts for the validation
 * this enables.
 */
export const GoldMatchSchema = z.object({
  matches: z.array(
    z.object({
      goldId: z.string(),
      generatedItemId: z.string(),
      generatedBucket: z.enum(["requirement", "question", "assumptionClaim"]),
      correspondence: z.enum(["equivalent", "partial", "contradicts"]),
      meetingStateViolation: z.boolean().optional(),
    }),
  ),
  unmatchedGoldIds: z.array(z.string()),
  unmatchedGeneratedItemIds: z.array(z.string()),
  generatedEvidence: z.array(
    z.object({
      generatedItemId: z.string(),
      evidenceFidelity: z.enum(["pass", "fail"]),
      reason: z.string(),
    }),
  ),
});
export type GoldMatchResult = z.infer<typeof GoldMatchSchema>;
export type Match = GoldMatchResult["matches"][number];
export type EvidenceEntry = GoldMatchResult["generatedEvidence"][number];
