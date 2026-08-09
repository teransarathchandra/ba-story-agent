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
      // REQUIRED, not optional: node-llama-cpp's grammar-constrained
      // decoding has no concept of an optional object property — every
      // declared property is always required in the generated JSON (see
      // zodToGbnfSchema's doc comment for the verified source). The judge
      // prompt instructs the model to return `false` for every match on a
      // non-meeting-state-sensitive gold item, or where no violation
      // exists — `false` IS the "not applicable" value, not an omission.
      // Semantics unchanged from the prior optional field: `true` = the
      // generated item reflects an outdated/provisional meeting state
      // that the transcript's final resolution overrides; `false` = no
      // such violation.
      meetingStateViolation: z.boolean(),
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
