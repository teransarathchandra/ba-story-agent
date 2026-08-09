import type { DeterministicCheck } from "./gold-schema.js";
import type { GeneratedCandidate } from "./gold-metrics.js";

/**
 * Bucket scope default per design §6: the three GROUNDED buckets only,
 * never `recommendation`. A hallucinated detail is a violation when
 * emitted as if the client said it (requirement/question/assumptionClaim);
 * the identical detail in a `recommendation` is a legitimate, explicitly
 * AI-suggested idea — a different, not-yet-designed metric, not this one.
 */
const DEFAULT_SCOPE: ReadonlyArray<GeneratedCandidate["bucket"]> = [
  "requirement",
  "question",
  "assumptionClaim",
];

export interface DeterministicViolation {
  checkId: string;
  candidateId: string;
  bucket: GeneratedCandidate["bucket"];
  matchedText: string;
}

/**
 * Runs every DeterministicCheck against the candidates in its scope,
 * scanning both `text` and `quote` (a hallucinated detail can surface in
 * either). Regex is case-insensitive by convention — every hand-authored
 * pattern in the gold file is written assuming that.
 */
function runChecks(
  checks: DeterministicCheck[],
  candidates: GeneratedCandidate[],
): DeterministicViolation[] {
  const violations: DeterministicViolation[] = [];
  for (const check of checks) {
    const scope = check.bucketScope ?? DEFAULT_SCOPE;
    const re = new RegExp(check.pattern, "i");
    for (const candidate of candidates) {
      if (!scope.includes(candidate.bucket)) continue;
      const haystack = `${candidate.text}\n${candidate.quote}`;
      const match = haystack.match(re);
      if (match) {
        violations.push({
          checkId: check.id,
          candidateId: candidate.id,
          bucket: candidate.bucket,
          matchedText: match[0],
        });
      }
    }
  }
  return violations;
}

export function checkUnsupportedDetails(
  unsupportedDetailChecks: DeterministicCheck[],
  candidates: GeneratedCandidate[],
): DeterministicViolation[] {
  return runChecks(unsupportedDetailChecks, candidates);
}

export function checkAlreadyAnsweredQuestions(
  answeredQuestionChecks: DeterministicCheck[],
  candidates: GeneratedCandidate[],
): DeterministicViolation[] {
  return runChecks(answeredQuestionChecks, candidates);
}
