import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { GoldCategory, GoldFixture } from "./gold-schema.js";

/**
 * Maps this fixture's frozen markdown section headings to gold categories.
 * Deliberately a fixed table, not a heuristic guess from heading text — a
 * heading rename in the markdown should surface as a parse-diff failure
 * (an ID landing in "unknown"), not silently resolve to the wrong category.
 */
const SECTION_TO_CATEGORY: Record<string, GoldCategory> = {
  "Confirmed Requirements": "requirement",
  "Unresolved Decisions": "unresolved",
  "Assumptions / Tentative Statements": "assumption",
  "Business Rules / Constraints": "rule",
  "Current State / Problem": "state",
  "Business Objectives / Success Criteria": "objective",
  "Out of Scope": "scope",
};

export interface ParsedMarkdownItem {
  id: string;
  category: GoldCategory | "unknown";
  proposition: string;
}

/**
 * Every gold-taxonomy table in the frozen markdown has ID as column 1 and
 * Proposition as column 2, regardless of what the remaining columns are
 * named (Type/Facets, "Why it doesn't clear the bar", "Requirement twin?",
 * etc.) — those differences are why this only extracts the two common
 * fields, not a full-row parse.
 */
export function parseMarkdownGoldItems(markdown: string): ParsedMarkdownItem[] {
  const lines = markdown.split("\n");
  const items: ParsedMarkdownItem[] = [];
  let currentCategory: GoldCategory | "unknown" = "unknown";

  for (const line of lines) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      const title = heading[1]!;
      // "### Positive: facts..." / "### Negative: constants..." live under
      // a different top-level section (Supporting eval invariants) and
      // share no ID scheme with the gold tables — treat as unknown so a
      // stray ID-shaped token there can't be silently absorbed.
      currentCategory = SECTION_TO_CATEGORY[title] ?? "unknown";
      continue;
    }

    const row = line.match(/^\|\s*([A-Z]+-\d+)\s*\|\s*(.+?)\s*\|/);
    if (!row) continue;
    const [, id, proposition] = row;
    items.push({ id: id!, category: currentCategory, proposition: proposition! });
  }

  return items;
}

export function hashFileContent(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export interface SyncCheckResult {
  hashMatches: boolean;
  actualHash: string;
  expectedHash: string;
  itemDiffs: Array<{
    id: string;
    field: "existence" | "category" | "proposition";
    inMarkdown: string | null;
    inJson: string | null;
  }>;
}

/**
 * Primary gate: does the .gold.json's recorded hash of the frozen markdown
 * match the markdown's actual current content? If this fails, the
 * itemDiffs below are still computed as a debugging aid — but the gate
 * itself is the hash, not "did every item happen to still line up."
 */
export function checkGoldSync(markdownPath: string, fixture: GoldFixture): SyncCheckResult {
  const actualHash = hashFileContent(markdownPath);
  const hashMatches = actualHash === fixture.frozenMarkdownContentHash;

  const markdownItems = parseMarkdownGoldItems(readFileSync(markdownPath, "utf8"));
  const markdownById = new Map(markdownItems.map((i) => [i.id, i]));
  const jsonById = new Map(fixture.items.map((i) => [i.id, i]));

  const itemDiffs: SyncCheckResult["itemDiffs"] = [];
  const allIds = new Set([...markdownById.keys(), ...jsonById.keys()]);

  for (const id of allIds) {
    const md = markdownById.get(id);
    const js = jsonById.get(id);

    if (!md || !js) {
      itemDiffs.push({
        id,
        field: "existence",
        inMarkdown: md ? "present" : null,
        inJson: js ? "present" : null,
      });
      continue;
    }
    if (md.category !== js.category) {
      itemDiffs.push({ id, field: "category", inMarkdown: md.category, inJson: js.category });
    }
    if (md.proposition !== js.proposition) {
      itemDiffs.push({ id, field: "proposition", inMarkdown: md.proposition, inJson: js.proposition });
    }
  }

  return { hashMatches, actualHash, expectedHash: fixture.frozenMarkdownContentHash, itemDiffs };
}
