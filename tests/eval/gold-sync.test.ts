import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { loadGoldFixture } from "../../src/eval/gold-schema.js";
import { checkGoldSync, parseMarkdownGoldItems, hashFileContent } from "../../src/eval/gold-sync.js";

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(here, "../fixtures/golden");
const markdownPath = join(goldenDir, "06-salon-booking.goldlabels.md");
const jsonPath = join(goldenDir, "06-salon-booking.gold.json");

describe("06-salon-booking gold fixture — markdown/JSON sync", () => {
  it("the .gold.json's recorded hash matches the frozen markdown's actual current content", () => {
    // This is the primary drift gate (design §8): any edit to the frozen
    // markdown, even a wording fix with no ID changes, must fail this
    // check until the .gold.json is deliberately re-synced.
    const fixture = loadGoldFixture(jsonPath);
    const result = checkGoldSync(markdownPath, fixture);
    expect(
      result.hashMatches,
      `.gold.json's frozenMarkdownContentHash (${result.expectedHash}) does not match the ` +
        `markdown's current hash (${result.actualHash}) — the frozen markdown was edited without ` +
        `re-syncing the .gold.json, or vice versa. Re-run the hash computation and update ` +
        `frozenMarkdownContentHash deliberately.`,
    ).toBe(true);
  });

  it("every id/category/proposition in the .gold.json matches the frozen markdown exactly", () => {
    const fixture = loadGoldFixture(jsonPath);
    const result = checkGoldSync(markdownPath, fixture);
    expect(result.itemDiffs, JSON.stringify(result.itemDiffs, null, 2)).toEqual([]);
  });

  it("the .gold.json's item count matches the markdown's frozen counts table (52 total)", () => {
    const fixture = loadGoldFixture(jsonPath);
    expect(fixture.items).toHaveLength(52);
  });

  it("the markdown parser extracts all 7 gold categories with the frozen counts", () => {
    const items = parseMarkdownGoldItems(
      readFileSync(markdownPath, "utf8"),
    );
    const byCategory: Record<string, number> = {};
    for (const item of items) byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
    expect(byCategory).toEqual({
      requirement: 21,
      unresolved: 10,
      assumption: 3,
      rule: 4,
      state: 10,
      objective: 3,
      scope: 1,
    });
  });

  it("no parsed markdown item lands in the 'unknown' category", () => {
    const items = parseMarkdownGoldItems(
      readFileSync(markdownPath, "utf8"),
    );
    const unknowns = items.filter((i) => i.category === "unknown");
    expect(unknowns, `Unrecognized section heading produced unknown-category items: ${JSON.stringify(unknowns)}`).toEqual([]);
  });

  it("hashFileContent is deterministic for the same file", () => {
    expect(hashFileContent(markdownPath)).toBe(hashFileContent(markdownPath));
  });

  it("detects a hash mismatch when the fixture's recorded hash is stale", () => {
    const fixture = loadGoldFixture(jsonPath);
    const staleFixture = { ...fixture, frozenMarkdownContentHash: "0".repeat(64) };
    const result = checkGoldSync(markdownPath, staleFixture);
    expect(result.hashMatches).toBe(false);
  });

  it("detects an itemized diff when a JSON item's proposition drifts from the markdown", () => {
    const fixture = loadGoldFixture(jsonPath);
    const mutated = {
      ...fixture,
      items: fixture.items.map((item) =>
        item.id === "REQ-01" ? { ...item, proposition: "deliberately wrong text" } : item,
      ),
    };
    const result = checkGoldSync(markdownPath, mutated);
    const reqDiff = result.itemDiffs.find((d) => d.id === "REQ-01" && d.field === "proposition");
    expect(reqDiff).toBeDefined();
  });

  it("detects a missing item (present in markdown, absent from JSON)", () => {
    const fixture = loadGoldFixture(jsonPath);
    const mutated = { ...fixture, items: fixture.items.filter((i) => i.id !== "UNR-05") };
    const result = checkGoldSync(markdownPath, mutated);
    const existenceDiff = result.itemDiffs.find((d) => d.id === "UNR-05" && d.field === "existence");
    expect(existenceDiff).toBeDefined();
    expect(existenceDiff?.inMarkdown).toBe("present");
    expect(existenceDiff?.inJson).toBeNull();
  });
});
