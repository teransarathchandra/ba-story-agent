import type { GoldItem } from "./gold-schema.js";
import type { GeneratedCandidate } from "./gold-metrics.js";
import type { Match, EvidenceEntry, GoldMatchResult } from "./gold-match-schema.js";
import type { CorrespondenceBatchResult, EvidenceBatchResult } from "./gold-batch-schema.js";
import type { CoverageResult } from "./gold-coverage.js";

/**
 * ~8 correspondence calls for the frozen 06-salon-booking fixture's 38
 * supported gold items (design: bounded local judge batching, replacing
 * the single monolithic GoldMatchSchema call a 3B local judge could not
 * reliably complete — see the failed coverage baseline this design
 * replaces). All 30 generated candidates are sent in full to EVERY
 * correspondence batch (never chunked on that side) — only the gold side
 * is batched, since correspondence must be checked against the whole
 * candidate set to be meaningful.
 */
export const CORRESPONDENCE_GOLD_BATCH_SIZE = 5;

/** ~3 evidence calls for 30 generated candidates. */
export const EVIDENCE_CANDIDATE_BATCH_SIZE = 10;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

export function buildCorrespondenceBatches(goldItems: readonly GoldItem[]): GoldItem[][] {
  return chunk(goldItems, CORRESPONDENCE_GOLD_BATCH_SIZE);
}

export function buildEvidenceBatches(candidates: readonly GeneratedCandidate[]): GeneratedCandidate[][] {
  return chunk(candidates, EVIDENCE_CANDIDATE_BATCH_SIZE);
}

function duplicates<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const dups = new Set<T>();
  for (const v of values) {
    if (seen.has(v)) dups.add(v);
    seen.add(v);
  }
  return [...dups];
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Validates ONE correspondence batch response in isolation — the batch
 * equivalent of gold-coverage.ts's checkCoverage(), scoped to a single
 * batch's gold ids rather than the whole fixture. reviewedGoldIds must
 * equal EXACTLY the batch's sent gold ids (this is what lets the
 * orchestrator later derive "no relationship found" for any id that never
 * appears in matches[], without asking the model to enumerate that
 * itself). Every matches[] entry must reference a goldId from THIS batch
 * (not another batch, not invented) and a generatedItemId from the full
 * sent candidate set (all candidates are visible to every correspondence
 * batch, so any of them is a legal reference).
 */
export function checkCorrespondenceBatchCoverage(
  response: CorrespondenceBatchResult,
  batchGoldIds: readonly string[],
  allSentGeneratedItemIds: readonly string[],
): CoverageResult {
  const errors: string[] = [];
  const expectedGoldIds = new Set(batchGoldIds);
  const expectedGeneratedIds = new Set(allSentGeneratedItemIds);

  const reviewedDupes = duplicates(response.reviewedGoldIds);
  if (reviewedDupes.length > 0) {
    errors.push(`reviewedGoldIds has duplicate entries for: ${reviewedDupes.join(", ")}`);
  }
  const reviewedSet = new Set(response.reviewedGoldIds);
  if (!setsEqual(reviewedSet, expectedGoldIds)) {
    const missing = batchGoldIds.filter((id) => !reviewedSet.has(id));
    const hallucinated = response.reviewedGoldIds.filter((id) => !expectedGoldIds.has(id));
    if (missing.length > 0) errors.push(`reviewedGoldIds is missing batch goldId(s): ${missing.join(", ")}`);
    if (hallucinated.length > 0) errors.push(`reviewedGoldIds references goldId(s) not in this batch: ${hallucinated.join(", ")}`);
  }

  for (const m of response.matches) {
    if (!expectedGoldIds.has(m.goldId)) {
      errors.push(`matches[] references goldId "${m.goldId}" not in this batch`);
    }
    if (!expectedGeneratedIds.has(m.generatedItemId)) {
      errors.push(`matches[] references unknown generatedItemId "${m.generatedItemId}" (not sent to the judge)`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates ONE evidence-fidelity batch response in isolation:
 * generatedEvidence[] must contain exactly one entry per candidate id sent
 * in this batch — no missing, no duplicate, no hallucinated id. Unlike the
 * correspondence batch, there is no separate "reviewed" field to check: an
 * evidence verdict is required for every sent candidate by construction,
 * so the entries' own ids are sufficient proof of coverage.
 */
export function checkEvidenceBatchCoverage(response: EvidenceBatchResult, batchCandidateIds: readonly string[]): CoverageResult {
  const errors: string[] = [];
  const expected = new Set(batchCandidateIds);
  const ids = response.generatedEvidence.map((e) => e.generatedItemId);

  const dupes = duplicates(ids);
  if (dupes.length > 0) errors.push(`generatedEvidence[] has duplicate entries for: ${dupes.join(", ")}`);

  const hallucinated = ids.filter((id) => !expected.has(id));
  if (hallucinated.length > 0) errors.push(`generatedEvidence[] references unknown generatedItemId(s): ${[...new Set(hallucinated)].join(", ")}`);

  const idSet = new Set(ids);
  const missing = batchCandidateIds.filter((id) => !idSet.has(id));
  if (missing.length > 0) errors.push(`generatedEvidence[] missing entries for: ${missing.join(", ")}`);

  return { valid: errors.length === 0, errors };
}

/**
 * Derives "no relationship found" deterministically from the aggregated
 * match table rather than asking the model to enumerate it — every gold id
 * that never appears as a matches[].goldId across ALL validated batches is
 * unmatched. Safe only once every batch has passed checkCorrespondenceBatchCoverage
 * (which guarantees every gold id was genuinely reviewed, not just never sent).
 */
export function deriveUnmatchedGoldIds(allGoldIds: readonly string[], matches: readonly Match[]): string[] {
  const matched = new Set(matches.map((m) => m.goldId));
  return allGoldIds.filter((id) => !matched.has(id));
}

export function deriveUnmatchedGeneratedItemIds(allGeneratedIds: readonly string[], matches: readonly Match[]): string[] {
  const matched = new Set(matches.map((m) => m.generatedItemId));
  return allGeneratedIds.filter((id) => !matched.has(id));
}

/**
 * Assembles validated batch results into the exact canonical GoldMatchResult
 * shape the single-call judge path (and the existing metrics layer)
 * already consumes — from computeGoldMetrics()'s perspective, a
 * successfully-aggregated batched result is indistinguishable from a
 * successful single large judge call. Metric definitions are never
 * touched: this function only assembles data, it computes nothing metric-like.
 */
export function aggregateBatchedMatch(
  allGoldIds: readonly string[],
  allGeneratedIds: readonly string[],
  matches: readonly Match[],
  generatedEvidence: readonly EvidenceEntry[],
): GoldMatchResult {
  return {
    matches: [...matches],
    unmatchedGoldIds: deriveUnmatchedGoldIds(allGoldIds, matches),
    unmatchedGeneratedItemIds: deriveUnmatchedGeneratedItemIds(allGeneratedIds, matches),
    generatedEvidence: [...generatedEvidence],
  };
}
