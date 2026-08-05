// src/grounding/validator.ts
import { normalize, denormalizeRange } from "./normalize.js";
import { bestWindow } from "./similarity.js";

/**
 * The similarity floor for accepting a non-exact match.
 *
 * 0.90 on word-token Levenshtein rejects invention, which does not score
 * anywhere near 0.90 against real transcript text. Changing this number
 * changes the product's core safety guarantee — do not tune it without
 * re-running the adversarial fixture suite (Task 27).
 *
 * Note that the threshold alone does NOT absorb disfluency-stripping: for an
 * N-token quote missing one filler word the ratio is exactly N/(N+1), which
 * only reaches 0.90 at N >= 9, so short quotes would be wrongly quarantined.
 * That is handled upstream in `similarity.ts`, which strips a disfluency
 * lexicon from both sides before scoring — see DISFLUENCIES there. The two
 * mechanisms are complementary: stripping makes real quotes score ~1.0, and
 * the threshold rejects everything that isn't a real quote.
 */
export const FUZZY_THRESHOLD = 0.9;

export interface GroundingInput {
  quote: string;
  segmentId: string;
}

export interface GroundingSource {
  /** Segments belonging to the window, with offsets into the whole transcript. */
  segments: { id: string; text: string; charStart: number }[];
  /** The full window text, used as the widening fallback. */
  windowText: string;
  /** Offset of `windowText` within the whole transcript. */
  windowCharStart: number;
}

export type GroundingResult =
  | {
      status: "validated";
      matchMode: "exact" | "segment-corrected" | "fuzzy";
      segmentId: string;
      charStart: number;
      charEnd: number;
      ratio: number;
    }
  | { status: "quarantined"; reason: string; bestRatio: number };

/** Find an exact normalized substring, returning original-text offsets. */
function exactMatch(
  haystack: string,
  haystackCharStart: number,
  quoteNorm: string,
): { charStart: number; charEnd: number } | null {
  const { text: hayNorm, map } = normalize(haystack);
  const at = hayNorm.indexOf(quoteNorm);
  if (at === -1) return null;
  const range = denormalizeRange(map, haystack.length, at, at + quoteNorm.length);
  return {
    charStart: haystackCharStart + range.start,
    charEnd: haystackCharStart + range.end,
  };
}

/**
 * The four-step ladder. Contains no LLM call and no network I/O by design:
 * the anti-hallucination guarantee must not itself depend on a model
 * behaving well.
 */
export function validateQuote(
  input: GroundingInput,
  source: GroundingSource,
): GroundingResult {
  const { text: quoteNorm } = normalize(input.quote);
  if (quoteNorm.length === 0) {
    return { status: "quarantined", reason: "quote is empty after normalization", bestRatio: 0 };
  }

  // Step 1+2: exact match within the named segment.
  const named = source.segments.find((s) => s.id === input.segmentId);
  if (named) {
    const hit = exactMatch(named.text, named.charStart, quoteNorm);
    if (hit) {
      return {
        status: "validated",
        matchMode: "exact",
        segmentId: named.id,
        charStart: hit.charStart,
        charEnd: hit.charEnd,
        ratio: 1,
      };
    }
  }

  // Step 3: exact match anywhere in the window; correct the segment id.
  for (const seg of source.segments) {
    if (seg.id === input.segmentId) continue;
    const hit = exactMatch(seg.text, seg.charStart, quoteNorm);
    if (hit) {
      return {
        status: "validated",
        matchMode: "segment-corrected",
        segmentId: seg.id,
        charStart: hit.charStart,
        charEnd: hit.charEnd,
        ratio: 1,
      };
    }
  }

  // Step 4: fuzzy match against the whole window.
  const { text: windowNorm, map } = normalize(source.windowText);
  const best = bestWindow(windowNorm, quoteNorm);
  if (!best) {
    return { status: "quarantined", reason: "window has no tokens to match against", bestRatio: 0 };
  }
  if (best.ratio < FUZZY_THRESHOLD) {
    return {
      status: "quarantined",
      reason: `best similarity ${best.ratio.toFixed(3)} is below the ${FUZZY_THRESHOLD} threshold`,
      bestRatio: best.ratio,
    };
  }

  const range = denormalizeRange(map, source.windowText.length, best.start, best.end);
  const absStart = source.windowCharStart + range.start;
  const absEnd = source.windowCharStart + range.end;

  // Attribute the fuzzy hit to whichever segment contains its midpoint.
  const mid = (absStart + absEnd) / 2;
  const owner =
    source.segments.find((s) => mid >= s.charStart && mid <= s.charStart + s.text.length) ??
    named ??
    source.segments[0];

  return {
    status: "validated",
    matchMode: "fuzzy",
    segmentId: owner?.id ?? input.segmentId,
    charStart: absStart,
    charEnd: absEnd,
    ratio: best.ratio,
  };
}
