export interface Token {
  token: string;
  start: number;
  end: number;
}

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

/**
 * Levenshtein distance over word arrays, expressed as a similarity ratio.
 *
 * Word-level rather than character-level is deliberate: a dropped filler word
 * ("um") costs exactly one edit instead of two or three characters' worth,
 * which is what makes the 0.90 threshold behave as intended.
 */
export function levenshteinRatio(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;

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
 * Windows are sized within ±2 tokens of the needle's token count, which
 * accommodates a couple of dropped or added filler words without letting the
 * search wander into unrelated text.
 */
export function bestWindow(
  haystackNorm: string,
  needleNorm: string,
): { ratio: number; start: number; end: number } | null {
  const hayTokens = tokenize(haystackNorm);
  const needleTokens = tokenize(needleNorm).map((t) => t.token);
  if (hayTokens.length === 0 || needleTokens.length === 0) return null;

  const n = needleTokens.length;
  const minLen = Math.max(1, n - 2);
  const maxLen = Math.min(hayTokens.length, n + 2);

  let best = { ratio: -1, start: 0, end: 0 };

  for (let len = minLen; len <= maxLen; len++) {
    for (let i = 0; i + len <= hayTokens.length; i++) {
      const window = hayTokens.slice(i, i + len);
      const ratio = levenshteinRatio(window.map((t) => t.token), needleTokens);
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
