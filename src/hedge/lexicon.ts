import { normalize } from "../grounding/normalize.js";

/**
 * Markers of hedged speech. A claim whose quote contains any of these is
 * forced to `assumption` regardless of how the model classified it.
 *
 * This is a deterministic floor under model judgment: "we'd probably want
 * manager approval" is background belief, not a stated requirement, and
 * models are eager to promote it.
 */
export const HEDGE_MARKERS: readonly string[] = [
  "probably", "possibly", "perhaps", "maybe",
  "might", "may be", "could be", "would be",
  "i think", "i believe", "i assume", "i guess", "i suppose", "i'd say",
  "usually", "typically", "normally", "generally", "often", "tend to",
  "something like", "sort of", "kind of", "more or less",
  "roughly", "approximately", "or so",
  "i imagine", "presumably", "in principle", "off the top of my head",
];

/** Escape a literal string for safe use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PATTERNS: { marker: string; re: RegExp }[] = HEDGE_MARKERS.map((marker) => ({
  marker,
  re: new RegExp(`(?<![a-z0-9])${escapeRe(marker)}(?![a-z0-9])`, "g"),
}));

/** Return every hedge marker present in `text`, ordered by first appearance. */
export function detectHedges(text: string): string[] {
  const { text: norm } = normalize(text);
  if (norm.length === 0) return [];
  const found: { marker: string; at: number }[] = [];
  for (const { marker, re } of PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(norm);
    if (m) found.push({ marker, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.marker);
}

export function isHedged(text: string): boolean {
  return detectHedges(text).length > 0;
}
