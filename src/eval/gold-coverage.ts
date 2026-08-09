import type { GoldMatchResult } from "./gold-match-schema.js";

export interface CoverageResult {
  valid: boolean;
  errors: string[];
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function intersection<T>(a: Set<T>, b: Set<T>): T[] {
  return [...a].filter((v) => b.has(v));
}

function duplicates<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const dups = new Set<T>();
  for (const v of values) {
    if (seen.has(v)) dups.add(v);
    seen.add(v);
  }
  return [...dups];
}

/**
 * Verifies the judge's one response is structurally complete before any
 * metric touches it (design §5): every sent gold ID and every sent
 * generated-item ID must be accounted for exactly once, either in a match
 * or in the corresponding unmatched list — never both, never neither, and
 * `generatedEvidence[]` must cover every sent generated item exactly once
 * regardless of match status. A failure here means the judge's response
 * itself is unreliable (it forgot an item, double-reported one, or
 * invented an ID never sent to it) — distinct from the judge being
 * unavailable, and distinct from a genuine "no correspondence found."
 */
export function checkCoverage(
  response: GoldMatchResult,
  allSupportedGoldIds: readonly string[],
  allSentGeneratedItemIds: readonly string[],
): CoverageResult {
  const errors: string[] = [];

  const expectedGoldIds = new Set(allSupportedGoldIds);
  const expectedGeneratedIds = new Set(allSentGeneratedItemIds);

  const matchedGoldIds = new Set(response.matches.map((m) => m.goldId));
  const matchedGeneratedIds = new Set(response.matches.map((m) => m.generatedItemId));
  const unmatchedGoldIds = new Set(response.unmatchedGoldIds);
  const unmatchedGeneratedIds = new Set(response.unmatchedGeneratedItemIds);
  const evidenceGeneratedIds = response.generatedEvidence.map((e) => e.generatedItemId);
  const evidenceGeneratedIdSet = new Set(evidenceGeneratedIds);

  // Unknown IDs: anything referenced that was never sent to the judge.
  for (const id of matchedGoldIds) {
    if (!expectedGoldIds.has(id)) errors.push(`matches[] references unknown goldId "${id}" (not in the sent gold set)`);
  }
  for (const id of unmatchedGoldIds) {
    if (!expectedGoldIds.has(id)) errors.push(`unmatchedGoldIds references unknown goldId "${id}" (not in the sent gold set)`);
  }
  for (const id of matchedGeneratedIds) {
    if (!expectedGeneratedIds.has(id)) errors.push(`matches[] references unknown generatedItemId "${id}" (not sent to the judge)`);
  }
  for (const id of unmatchedGeneratedIds) {
    if (!expectedGeneratedIds.has(id)) errors.push(`unmatchedGeneratedItemIds references unknown generatedItemId "${id}" (not sent to the judge)`);
  }
  for (const id of evidenceGeneratedIdSet) {
    if (!expectedGeneratedIds.has(id)) errors.push(`generatedEvidence[] references unknown generatedItemId "${id}" (not sent to the judge)`);
  }

  // Overlap: an ID reported as both matched and unmatched.
  const goldOverlap = intersection(matchedGoldIds, unmatchedGoldIds);
  if (goldOverlap.length > 0) {
    errors.push(`goldId(s) reported in BOTH matches[] and unmatchedGoldIds: ${goldOverlap.join(", ")}`);
  }
  const generatedOverlap = intersection(matchedGeneratedIds, unmatchedGeneratedIds);
  if (generatedOverlap.length > 0) {
    errors.push(`generatedItemId(s) reported in BOTH matches[] and unmatchedGeneratedItemIds: ${generatedOverlap.join(", ")}`);
  }

  // Union: every sent ID must appear somewhere.
  const goldUnion = new Set([...matchedGoldIds, ...unmatchedGoldIds]);
  if (!setsEqual(goldUnion, expectedGoldIds)) {
    const missing = allSupportedGoldIds.filter((id) => !goldUnion.has(id));
    if (missing.length > 0) errors.push(`goldId(s) never accounted for (missing from both matches[] and unmatchedGoldIds): ${missing.join(", ")}`);
  }
  const generatedUnion = new Set([...matchedGeneratedIds, ...unmatchedGeneratedIds]);
  if (!setsEqual(generatedUnion, expectedGeneratedIds)) {
    const missing = allSentGeneratedItemIds.filter((id) => !generatedUnion.has(id));
    if (missing.length > 0) errors.push(`generatedItemId(s) never accounted for (missing from both matches[] and unmatchedGeneratedItemIds): ${missing.join(", ")}`);
  }

  // generatedEvidence[] must cover every sent generated item exactly once.
  const evidenceDupes = duplicates(evidenceGeneratedIds);
  if (evidenceDupes.length > 0) {
    errors.push(`generatedEvidence[] has duplicate entries for: ${evidenceDupes.join(", ")}`);
  }
  if (!setsEqual(evidenceGeneratedIdSet, expectedGeneratedIds)) {
    const missing = allSentGeneratedItemIds.filter((id) => !evidenceGeneratedIdSet.has(id));
    if (missing.length > 0) errors.push(`generatedEvidence[] missing entries for: ${missing.join(", ")}`);
  }

  return { valid: errors.length === 0, errors };
}
