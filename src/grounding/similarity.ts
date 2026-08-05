export interface Token {
  token: string;
  start: number;
  end: number;
}

export const DISFLUENCIES: ReadonlySet<string> = new Set([
  "um", "uh", "erm", "er", "ah", "eh", "hm", "hmm", "mm", "mhm",
  "like", "sorta", "kinda", "basically", "literally",
]);

const DISFLUENCY_PHRASES: readonly string[][] = [
  ["you", "know"],
  ["i", "mean"],
  ["sort", "of"],
  ["kind", "of"],
];

/** Word tokens with offsets into the string passed in (expected to be already normalized). */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ token: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/** Leading/trailing punctuation stripped from tokens before scoring — never before offsets. */
const PUNCT_TRIM = /^[.,;:!?"'()[\]-]+|[.,;:!?"'()[\]-]+$/g;

/**
 * Strip leading/trailing punctuation from a single token for *scoring* purposes.
 *
 * A model quoting speech constantly differs from the transcript in trailing
 * commas, periods, or an inserted dash at a natural pause — none of that is
 * invention. `tokenize()`'s offsets (what `bestWindow` reports spans in) are
 * never touched; this only cleans the strings handed to `levenshteinRatio`.
 */
function trimPunct(token: string): string {
  return token.replace(PUNCT_TRIM, "");
}

/**
 * Remove filler words (single-token disfluencies and multi-word phrases) from a token array.
 * Used for scoring similarity without penalizing natural speech patterns.
 *
 * Tokens are punctuation-trimmed first (see `trimPunct`) so that "manager,"
 * and "manager" score as equal, and a token that is punctuation alone (an
 * inserted "-", a stray ",") disappears entirely rather than costing an edit.
 */
export function stripDisfluencies(tokens: string[]): string[] {
  const cleaned = tokens.map(trimPunct).filter((t) => t.length > 0);

  const out: string[] = [];
  let i = 0;
  outer: while (i < cleaned.length) {
    for (const phrase of DISFLUENCY_PHRASES) {
      if (phrase.every((w, k) => cleaned[i + k] === w)) {
        i += phrase.length;
        continue outer;
      }
    }
    const tok = cleaned[i]!;
    if (!DISFLUENCIES.has(tok)) out.push(tok);
    i++;
  }
  return out;
}

/**
 * Levenshtein distance over word arrays, expressed as a similarity ratio.
 *
 * Word-level rather than character-level is deliberate: a dropped filler word
 * ("um") costs exactly one edit instead of two or three characters' worth.
 */
export function levenshteinRatio(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const max = Math.max(a.length, b.length);

  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }

  return 1 - prev[b.length]! / max;
}

/**
 * Find the span of `haystackNorm` most similar to `needleNorm`.
 *
 * Windows are sized within ±2 tokens of the raw needle's token count, widening
 * to ±3 to accommodate extra filler words. Scoring strips disfluencies and
 * leading/trailing punctuation from both sides so a dropped "um" or a comma
 * mismatch at a match boundary costs no edit distance, allowing real quotes
 * to score ~1.0. Offsets remain based on the unstripped window so the
 * returned span shows the actual transcript text, fillers and punctuation
 * included.
 */
export function bestWindow(
  haystackNorm: string,
  needleNorm: string,
): { ratio: number; start: number; end: number } | null {
  const hayTokens = tokenize(haystackNorm);
  const rawNeedleTokens = tokenize(needleNorm).map((t) => t.token);
  if (hayTokens.length === 0 || rawNeedleTokens.length === 0) return null;

  const strippedNeedle = stripDisfluencies(rawNeedleTokens);
  if (strippedNeedle.length === 0) return null;

  const n = rawNeedleTokens.length;
  const minLen = Math.max(1, n - 2);
  const maxLen = Math.min(hayTokens.length, n + 3);

  let best = { ratio: -1, start: 0, end: 0 };

  for (let len = minLen; len <= maxLen; len++) {
    for (let i = 0; i + len <= hayTokens.length; i++) {
      const window = hayTokens.slice(i, i + len);
      const windowTokens = window.map((t) => t.token);
      const strippedWindow = stripDisfluencies(windowTokens);
      const ratio = levenshteinRatio(strippedWindow, strippedNeedle);
      if (ratio > best.ratio) {
        best = {
          ratio,
          start: window[0]!.start,
          end: window[window.length - 1]!.end,
        };
        if (ratio === 1) return best;
      }
    }
  }

  return best.ratio < 0 ? null : best;
}
