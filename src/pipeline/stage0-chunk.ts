import type { Segment } from "../types/domain.js";

/**
 * Below this the pipeline hard-blocks rather than warning: extraction on a
 * shorter input produces noise, and noise is worse than no output.
 */
export const MIN_WORDS = 200;

export interface Window {
  idx: number;
  segments: Segment[];
  /** Exact slice of the transcript spanned by this window's segments. */
  text: string;
  /** Offset of `text` within the whole transcript. */
  charStart: number;
}

export function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Window the transcript for extraction.
 *
 * A 90-minute meeting is roughly 12k words. That fits in context, but
 * single-shot extraction over it degrades quietly — thorough early, skimming
 * later. Windows are ~2000 words with ~200 words of overlap, split only on
 * segment boundaries so quote anchoring survives chunking.
 */
export function chunkTranscript(
  transcriptText: string,
  segments: Segment[],
  opts?: { targetWords?: number; overlapWords?: number },
): Window[] {
  if (segments.length === 0) return [];
  const target = opts?.targetWords ?? 2000;
  const overlap = opts?.overlapWords ?? 200;

  const counts = segments.map((s) => countWords(s.text));
  const windows: Window[] = [];
  let start = 0;
  let idx = 0;

  while (start < segments.length) {
    let end = start;
    let words = 0;
    while (end < segments.length && (words === 0 || words + counts[end]! <= target)) {
      words += counts[end]!;
      end++;
    }
    if (end === start) end = start + 1; // a single oversized segment still forms a window

    const slice = segments.slice(start, end);
    const first = slice[0]!;
    const last = slice[slice.length - 1]!;
    windows.push({
      idx: idx++,
      segments: slice,
      text: transcriptText.slice(first.charStart, last.charEnd),
      charStart: first.charStart,
    });

    if (end >= segments.length) break;

    // Step back far enough to carry ~`overlap` words into the next window.
    // Always include at least one segment in the overlap, even if it exceeds budget.
    let back = end - 1;
    let carried = 0;
    if (back >= start) {
      carried = counts[back]!;
      back--;
      while (back >= start && carried + counts[back]! <= overlap) {
        carried += counts[back]!;
        back--;
      }
    }
    start = Math.max(start + 1, back + 1);
  }

  return windows;
}
