import {
  EXPECTED_BUCKET,
  PRIMARY_CATEGORIES,
  isSupportedCategory,
  supportedItems,
  type GeneratedBucket,
  type GoldFixture,
  type GoldItem,
} from "./gold-schema.js";
import type { EvidenceEntry, GoldMatchResult, Match } from "./gold-match-schema.js";

export interface GeneratedCandidate {
  id: string;
  bucket: GeneratedBucket;
  text: string;
  quote: string;
}

function evidenceMap(evidence: EvidenceEntry[]): Map<string, EvidenceEntry> {
  return new Map(evidence.map((e) => [e.generatedItemId, e]));
}

/**
 * The one definition of "a real capture" used throughout every metric
 * below: `equivalent` correspondence AND passing evidence fidelity. A
 * `partial` correspondence, a `contradicts` correspondence, or an
 * `equivalent` correspondence riding on evidence that doesn't actually
 * support it never counts as a positive signal anywhere in this module —
 * this is the design's own stated principle (§5/§7a), applied uniformly
 * rather than re-derived per metric.
 */
function isPassingMatch(match: Match, evidenceByItem: Map<string, EvidenceEntry>): boolean {
  if (match.correspondence !== "equivalent") return false;
  return evidenceByItem.get(match.generatedItemId)?.evidenceFidelity === "pass";
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

// ---------------------------------------------------------------------
// Metric 1: Gold-item recall
// ---------------------------------------------------------------------

export interface RecallResult {
  capturedCount: number;
  supportedDenominator: number;
  totalGoldItems: number;
  structurallyUnsupportedCount: number;
  rate: number | null;
  capturedGoldIds: string[];
}

export function computeRecall(
  fixture: GoldFixture,
  matches: Match[],
  evidenceByItem: Map<string, EvidenceEntry>,
): RecallResult {
  const supported = supportedItems(fixture);
  const capturedGoldIds = new Set(
    matches.filter((m) => isPassingMatch(m, evidenceByItem)).map((m) => m.goldId),
  );
  const capturedCount = supported.filter((item) => capturedGoldIds.has(item.id)).length;
  return {
    capturedCount,
    supportedDenominator: supported.length,
    totalGoldItems: fixture.items.length,
    structurallyUnsupportedCount: fixture.items.length - supported.length,
    rate: supported.length > 0 ? capturedCount / supported.length : null,
    capturedGoldIds: supported.filter((item) => capturedGoldIds.has(item.id)).map((i) => i.id),
  };
}

// ---------------------------------------------------------------------
// Metric 2: Taxonomy accuracy — supported categories (PRIMARY tier only)
// ---------------------------------------------------------------------

export interface TaxonomyAccuracyResult {
  primaryRecalledCount: number;
  primaryCorrectCount: number;
  rate: number | null;
  proxyRecalledCount: number; // structurally-proxy, informational only, never blended into `rate`
  derivedPlacement: Array<{
    goldId: string;
    generatedItemId: string;
    generatedBucket: GeneratedBucket;
    placementCorrect: boolean | null; // null = PROXY-tier gold item, no verdict
  }>;
}

export function computeTaxonomyAccuracy(
  fixture: GoldFixture,
  matches: Match[],
  evidenceByItem: Map<string, EvidenceEntry>,
): TaxonomyAccuracyResult {
  const itemById = new Map(fixture.items.map((i) => [i.id, i]));
  const passingMatches = matches.filter((m) => isPassingMatch(m, evidenceByItem));
  const passingByGoldId = groupBy(passingMatches, (m) => m.goldId);

  let primaryRecalledCount = 0;
  let primaryCorrectCount = 0;
  let proxyRecalledCount = 0;
  const derivedPlacement: TaxonomyAccuracyResult["derivedPlacement"] = [];

  for (const [goldId, ms] of passingByGoldId) {
    const item = itemById.get(goldId);
    if (!item || !isSupportedCategory(item.category)) continue;
    const isPrimary = PRIMARY_CATEGORIES.has(item.category);
    const expected = EXPECTED_BUCKET[item.category];

    if (isPrimary) {
      primaryRecalledCount++;
      const correct = ms.some((m) => m.generatedBucket === expected);
      if (correct) primaryCorrectCount++;
    } else {
      proxyRecalledCount++;
    }

    for (const m of ms) {
      derivedPlacement.push({
        goldId,
        generatedItemId: m.generatedItemId,
        generatedBucket: m.generatedBucket,
        placementCorrect: isPrimary ? m.generatedBucket === expected : null,
      });
    }
  }

  return {
    primaryRecalledCount,
    primaryCorrectCount,
    rate: primaryRecalledCount > 0 ? primaryCorrectCount / primaryRecalledCount : null,
    proxyRecalledCount,
    derivedPlacement,
  };
}

// ---------------------------------------------------------------------
// Metric 3: Requirement precision — strict precision + 5-way partition
// ---------------------------------------------------------------------

export type PrecisionBucket = "passing" | "contradiction" | "promoted" | "partial-only" | "unmatched";

/**
 * Assigns exactly one bucket per generated requirement, in the precedence
 * order the design specifies. Note on an edge case the design's prose
 * didn't spell out: a generated requirement with an `equivalent` match to
 * a requirement/rule gold item whose evidence FAILS doesn't literally have
 * "zero matches" (bucket 4's literal wording), but per this module's
 * uniform `isPassingMatch` principle above, a match without passing
 * evidence never counts as a real capture anywhere else in this design —
 * so it falls through every earlier bucket's checks (all of which require
 * either a `contradicts`/`partial` correspondence, or an `equivalent` +
 * evidence-pass pair) and lands in "unmatched" by the same logic that
 * governs every other metric, not a special case bolted on here.
 */
function assignPrecisionBucket(
  generatedId: string,
  matchesForItem: Match[],
  evidenceByItem: Map<string, EvidenceEntry>,
  itemById: Map<string, GoldItem>,
): PrecisionBucket {
  const evidencePass = evidenceByItem.get(generatedId)?.evidenceFidelity === "pass";

  const hasPassingRequirementMatch = matchesForItem.some((m) => {
    if (m.correspondence !== "equivalent" || !evidencePass) return false;
    const item = itemById.get(m.goldId);
    return item?.category === "requirement" || item?.category === "rule";
  });
  if (hasPassingRequirementMatch) return "passing";

  if (matchesForItem.some((m) => m.correspondence === "contradicts")) return "contradiction";

  const hasPromotedMatch = matchesForItem.some((m) => {
    if (m.correspondence !== "equivalent" || !evidencePass) return false;
    const item = itemById.get(m.goldId);
    return item?.category === "unresolved" || item?.category === "assumption";
  });
  if (hasPromotedMatch) return "promoted";

  if (matchesForItem.some((m) => m.correspondence === "partial")) return "partial-only";

  return "unmatched";
}

export interface PrecisionBucketStats {
  count: number;
  ids: string[];
  rate: number | null;
}

export interface RequirementPrecisionResult {
  total: number;
  strictPrecision: number | null;
  nonPrecisionRate: number | null;
  buckets: Record<PrecisionBucket, PrecisionBucketStats>;
  derivedPrecisionBuckets: Array<{ generatedItemId: string; bucket: PrecisionBucket }>;
}

export function computeRequirementPrecision(
  fixture: GoldFixture,
  generatedRequirements: GeneratedCandidate[],
  matches: Match[],
  evidenceByItem: Map<string, EvidenceEntry>,
): RequirementPrecisionResult {
  const itemById = new Map(fixture.items.map((i) => [i.id, i]));
  const matchesByGeneratedId = groupBy(matches, (m) => m.generatedItemId);

  const idsByBucket: Record<PrecisionBucket, string[]> = {
    passing: [],
    contradiction: [],
    promoted: [],
    "partial-only": [],
    unmatched: [],
  };
  const derivedPrecisionBuckets: RequirementPrecisionResult["derivedPrecisionBuckets"] = [];

  for (const req of generatedRequirements) {
    const matchesForItem = matchesByGeneratedId.get(req.id) ?? [];
    const bucket = assignPrecisionBucket(req.id, matchesForItem, evidenceByItem, itemById);
    idsByBucket[bucket].push(req.id);
    derivedPrecisionBuckets.push({ generatedItemId: req.id, bucket });
  }

  const total = generatedRequirements.length;
  const rate = (ids: string[]) => (total > 0 ? ids.length / total : null);
  const buckets = Object.fromEntries(
    (Object.keys(idsByBucket) as PrecisionBucket[]).map((b) => [
      b,
      { count: idsByBucket[b].length, ids: idsByBucket[b], rate: rate(idsByBucket[b]) },
    ]),
  ) as Record<PrecisionBucket, PrecisionBucketStats>;

  const strictPrecision = rate(idsByBucket.passing);
  return {
    total,
    strictPrecision,
    nonPrecisionRate: strictPrecision === null ? null : 1 - strictPrecision,
    buckets,
    derivedPrecisionBuckets,
  };
}

// ---------------------------------------------------------------------
// Metric 4: Cross-category exclusivity
// ---------------------------------------------------------------------

export interface ExclusivityViolation {
  goldId: string;
  buckets: GeneratedBucket[];
}

export function computeCrossCategoryExclusivity(
  matches: Match[],
  evidenceByItem: Map<string, EvidenceEntry>,
): { violationCount: number; violations: ExclusivityViolation[] } {
  const passingMatches = matches.filter((m) => isPassingMatch(m, evidenceByItem));
  const bucketsByGoldId = new Map<string, Set<GeneratedBucket>>();
  for (const m of passingMatches) {
    const set = bucketsByGoldId.get(m.goldId) ?? new Set<GeneratedBucket>();
    set.add(m.generatedBucket);
    bucketsByGoldId.set(m.goldId, set);
  }
  const violations = [...bucketsByGoldId.entries()]
    .filter(([, buckets]) => buckets.size >= 2)
    .map(([goldId, buckets]) => ({ goldId, buckets: [...buckets] }));
  return { violationCount: violations.length, violations };
}

// ---------------------------------------------------------------------
// Metric 5: Duplicate rate
// ---------------------------------------------------------------------

export interface DuplicateViolation {
  goldId: string;
  bucket: GeneratedBucket;
  count: number;
}

export function computeDuplicateRate(
  matches: Match[],
  evidenceByItem: Map<string, EvidenceEntry>,
): { violationCount: number; violations: DuplicateViolation[] } {
  const passingMatches = matches.filter((m) => isPassingMatch(m, evidenceByItem));
  const counts = new Map<string, { goldId: string; bucket: GeneratedBucket; count: number }>();
  for (const m of passingMatches) {
    const key = `${m.goldId} ${m.generatedBucket}`;
    const entry = counts.get(key) ?? { goldId: m.goldId, bucket: m.generatedBucket, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  const violations = [...counts.values()].filter((v) => v.count >= 2);
  return { violationCount: violations.length, violations };
}

// ---------------------------------------------------------------------
// Metric 6: Evidence fidelity
// ---------------------------------------------------------------------

export function computeEvidenceFidelity(evidence: EvidenceEntry[]): {
  total: number;
  passing: number;
  rate: number | null;
} {
  const total = evidence.length;
  const passing = evidence.filter((e) => e.evidenceFidelity === "pass").length;
  return { total, passing, rate: total > 0 ? passing / total : null };
}

// ---------------------------------------------------------------------
// Metric 7: Meeting-state resolution
// ---------------------------------------------------------------------

export function computeMeetingStateResolution(
  fixture: GoldFixture,
  matches: Match[],
): { sensitiveCount: number; violationCount: number; violatingGoldIds: string[] } {
  const sensitiveItems = fixture.items.filter((i) => i.meetingStateSensitive);
  const violatingGoldIds = sensitiveItems
    .filter((item) => matches.some((m) => m.goldId === item.id && m.meetingStateViolation === true))
    .map((i) => i.id);
  return { sensitiveCount: sensitiveItems.length, violationCount: violatingGoldIds.length, violatingGoldIds };
}

// ---------------------------------------------------------------------
// Metric 10: Grounded vs. AI-generated separation (questions bucket)
// ---------------------------------------------------------------------

export function computeGroundedVsNovelQuestions(
  fixture: GoldFixture,
  generatedQuestions: GeneratedCandidate[],
  matches: Match[],
  evidenceByItem: Map<string, EvidenceEntry>,
): { grounded: number; novel: number; total: number } {
  const unresolvedIds = new Set(fixture.items.filter((i) => i.category === "unresolved").map((i) => i.id));
  const groundedGeneratedIds = new Set(
    matches
      .filter(
        (m) =>
          m.generatedBucket === "question" &&
          unresolvedIds.has(m.goldId) &&
          isPassingMatch(m, evidenceByItem),
      )
      .map((m) => m.generatedItemId),
  );
  const grounded = generatedQuestions.filter((q) => groundedGeneratedIds.has(q.id)).length;
  return { grounded, novel: generatedQuestions.length - grounded, total: generatedQuestions.length };
}

// ---------------------------------------------------------------------
// Supplementary diagnostics (design §7b: partial-match count, contradiction count)
// ---------------------------------------------------------------------

export function computeSupplementaryDiagnostics(
  fixture: GoldFixture,
  matches: Match[],
  evidenceByItem: Map<string, EvidenceEntry>,
): {
  partialOnlyGoldCount: number;
  partialOnlyGoldIds: string[];
  contradictedGoldCount: number;
  contradictedGoldIds: string[];
  ungroundedEquivalentCount: number;
  ungroundedEquivalentItemIds: string[];
} {
  const supported = new Set(supportedItems(fixture).map((i) => i.id));
  const passingGoldIds = new Set(
    matches.filter((m) => isPassingMatch(m, evidenceByItem)).map((m) => m.goldId),
  );
  const partialGoldIds = new Set(
    matches.filter((m) => m.correspondence === "partial" && supported.has(m.goldId)).map((m) => m.goldId),
  );
  const contradictedGoldIds = new Set(
    matches.filter((m) => m.correspondence === "contradicts" && supported.has(m.goldId)).map((m) => m.goldId),
  );

  const partialOnlyGoldIds = [...partialGoldIds].filter((id) => !passingGoldIds.has(id));

  // Diagnostic only — does not feed recall, taxonomy, precision, or
  // evidence-fidelity, all of which already correctly treat this case as
  // non-capture via isPassingMatch()'s requirement of BOTH `equivalent`
  // correspondence AND passing evidence. This surfaces it as its own named
  // signal because it represents a distinct product-relevant failure mode:
  // the pipeline got a requirement's MEANING right, but the evidence it
  // cited for that meaning doesn't actually establish it — a traceability
  // failure, not a comprehension failure, and one worth counting on its
  // own rather than only being recoverable from the raw judge-match table.
  const equivalentGeneratedIds = new Set(
    matches.filter((m) => m.correspondence === "equivalent").map((m) => m.generatedItemId),
  );
  const ungroundedEquivalentItemIds = [...equivalentGeneratedIds].filter(
    (id) => evidenceByItem.get(id)?.evidenceFidelity === "fail",
  );

  return {
    partialOnlyGoldCount: partialOnlyGoldIds.length,
    partialOnlyGoldIds,
    contradictedGoldCount: contradictedGoldIds.size,
    contradictedGoldIds: [...contradictedGoldIds],
    ungroundedEquivalentCount: ungroundedEquivalentItemIds.length,
    ungroundedEquivalentItemIds,
  };
}

// ---------------------------------------------------------------------
// Top-level aggregation
// ---------------------------------------------------------------------

export interface GoldMetrics {
  recall: RecallResult;
  taxonomyAccuracy: TaxonomyAccuracyResult;
  requirementPrecision: RequirementPrecisionResult;
  crossCategoryExclusivity: ReturnType<typeof computeCrossCategoryExclusivity>;
  duplicateRate: ReturnType<typeof computeDuplicateRate>;
  evidenceFidelity: ReturnType<typeof computeEvidenceFidelity>;
  meetingStateResolution: ReturnType<typeof computeMeetingStateResolution>;
  groundedVsNovelQuestions: ReturnType<typeof computeGroundedVsNovelQuestions>;
  supplementary: ReturnType<typeof computeSupplementaryDiagnostics>;
}

export function computeGoldMetrics(
  fixture: GoldFixture,
  generated: { requirements: GeneratedCandidate[]; questions: GeneratedCandidate[]; assumptionClaims: GeneratedCandidate[] },
  matchResult: GoldMatchResult,
): GoldMetrics {
  const evByItem = evidenceMap(matchResult.generatedEvidence);
  const { matches } = matchResult;

  return {
    recall: computeRecall(fixture, matches, evByItem),
    taxonomyAccuracy: computeTaxonomyAccuracy(fixture, matches, evByItem),
    requirementPrecision: computeRequirementPrecision(fixture, generated.requirements, matches, evByItem),
    crossCategoryExclusivity: computeCrossCategoryExclusivity(matches, evByItem),
    duplicateRate: computeDuplicateRate(matches, evByItem),
    evidenceFidelity: computeEvidenceFidelity(matchResult.generatedEvidence),
    meetingStateResolution: computeMeetingStateResolution(fixture, matches),
    groundedVsNovelQuestions: computeGroundedVsNovelQuestions(fixture, generated.questions, matches, evByItem),
    supplementary: computeSupplementaryDiagnostics(fixture, matches, evByItem),
  };
}
