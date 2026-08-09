import { z } from "zod/v4";
import { readFileSync } from "node:fs";

export const DeterministicCheckSchema = z.object({
  id: z.string(),
  pattern: z.string(),
  rationale: z.string(),
  bucketScope: z
    .array(z.enum(["requirement", "question", "assumptionClaim", "recommendation"]))
    .optional(),
});
export type DeterministicCheck = z.infer<typeof DeterministicCheckSchema>;

export const GoldCategorySchema = z.enum([
  "requirement",
  "rule",
  "unresolved",
  "assumption",
  "state",
  "objective",
  "scope",
]);
export type GoldCategory = z.infer<typeof GoldCategorySchema>;

export const GoldItemSchema = z.object({
  id: z.string(),
  category: GoldCategorySchema,
  proposition: z.string(),
  quotes: z.array(z.string()),
  meetingStateSensitive: z
    .object({ mustNotReflect: z.string(), mustReflect: z.string() })
    .optional(),
});
export type GoldItem = z.infer<typeof GoldItemSchema>;

export const GoldFixtureSchema = z.object({
  fixtureName: z.string(),
  transcriptFile: z.string(),
  frozenMarkdownContentHash: z.string(),
  items: z.array(GoldItemSchema),
  unsupportedDetailChecks: z.array(DeterministicCheckSchema),
  answeredQuestionChecks: z.array(DeterministicCheckSchema),
});
export type GoldFixture = z.infer<typeof GoldFixtureSchema>;

export type GeneratedBucket = "requirement" | "question" | "assumptionClaim";

/**
 * Categories with no real pipeline output bucket today (design §2) — state
 * facts and objectives/scope are documented in the gold file for
 * completeness but never sent to the judge or scored for recall.
 */
type SupportedCategory = "requirement" | "rule" | "unresolved" | "assumption";
const SUPPORTED_CATEGORIES: ReadonlySet<GoldCategory> = new Set([
  "requirement",
  "rule",
  "unresolved",
  "assumption",
]);

export function isSupportedCategory(category: GoldCategory): category is SupportedCategory {
  return SUPPORTED_CATEGORIES.has(category);
}

export function supportedItems(fixture: GoldFixture): GoldItem[] {
  return fixture.items.filter((item) => isSupportedCategory(item.category));
}

/**
 * PRIMARY-tier categories get a placement/taxonomy-correctness verdict;
 * PROXY-tier (rule, unresolved) only get recall, never taxonomy credit —
 * design §2/§5. Landing in the only available bucket is not evidence of
 * correct categorization when there was no alternative to be wrong about.
 */
export const PRIMARY_CATEGORIES: ReadonlySet<GoldCategory> = new Set(["requirement", "assumption"]);

/** The bucket a supported gold category is expected to land in, for placement scoring only — not a search restriction (design §5). */
export const EXPECTED_BUCKET: Record<SupportedCategory, GeneratedBucket> = {
  requirement: "requirement",
  rule: "requirement",
  unresolved: "question",
  assumption: "assumptionClaim",
};

export function loadGoldFixture(path: string): GoldFixture {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  return GoldFixtureSchema.parse(raw);
}
