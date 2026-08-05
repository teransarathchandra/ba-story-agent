/** Characters models routinely substitute, folded to their ASCII equivalents. */
const FOLD: Record<string, string> = {
  [String.fromCodePoint(0x2018)]: "'", // ' left single quotation mark
  [String.fromCodePoint(0x2019)]: "'", // ' right single quotation mark
  [String.fromCodePoint(0x201a)]: "'", // ‚ single low-9 quotation mark
  [String.fromCodePoint(0x201b)]: "'", // ‛ single high-reversed-9 quotation mark
  [String.fromCodePoint(0x201c)]: '"', // " left double quotation mark
  [String.fromCodePoint(0x201d)]: '"', // " right double quotation mark
  [String.fromCodePoint(0x201e)]: '"', // „ double low-9 quotation mark
  [String.fromCodePoint(0x201f)]: '"', // ‟ double high-reversed-9 quotation mark
  [String.fromCodePoint(0x2013)]: "-", // – en dash
  [String.fromCodePoint(0x2014)]: "-", // — em dash
  [String.fromCodePoint(0x2212)]: "-", // − minus sign
  [String.fromCodePoint(0xa0)]: " ",   // non-breaking space
  [String.fromCodePoint(0x2026)]: "...", // … horizontal ellipsis
};

export interface Normalized {
  /** Lowercased, whitespace-collapsed, quote-folded text. */
  text: string;
  /** `map[i]` is the index in the original string that produced `text[i]`. */
  map: number[];
}

/**
 * Normalize text for matching while retaining a per-character index back into
 * the original. This is what allows a match found on normalized text to be
 * reported as exact character offsets into the untouched transcript.
 *
 * Note: `…` folds to three characters ("..."), so one original index is
 * repeated three times in the map. That is correct — every normalized
 * character must map to some original character.
 */
export function normalize(input: string): Normalized {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    const folded = FOLD[ch] ?? ch;

    if (/\s/.test(folded)) {
      if (out.length > 0) pendingSpace = true;
      continue;
    }

    if (pendingSpace) {
      out.push(" ");
      map.push(i);
      pendingSpace = false;
    }

    const lowered = folded.toLowerCase();
    for (const c of lowered) {
      out.push(c);
      map.push(i);
    }
  }

  return { text: out.join(""), map };
}

/**
 * Translate a [start, end) range on normalized text into a range on the
 * original text. `end` is exclusive on both sides.
 */
export function denormalizeRange(
  map: number[],
  originalLength: number,
  start: number,
  end: number,
): { start: number; end: number } {
  if (map.length === 0 || start >= end) return { start: 0, end: 0 };
  const clampedStart = Math.max(0, Math.min(start, map.length - 1));
  const clampedEnd = Math.max(clampedStart, Math.min(end, map.length));
  const originalStart = map[clampedStart]!;
  const lastIdx = map[clampedEnd - 1]!;
  return {
    start: originalStart,
    end: Math.min(lastIdx + 1, originalLength),
  };
}
