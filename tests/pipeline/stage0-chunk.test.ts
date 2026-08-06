import { describe, it, expect } from "vitest";
import { chunkTranscript, countWords, MIN_WORDS } from "../../src/pipeline/stage0-chunk.js";
import type { Segment } from "../../src/types/domain.js";

function makeSegments(texts: string[]): { text: string; segments: Segment[] } {
  let cursor = 0;
  const parts: string[] = [];
  const segments: Segment[] = [];
  texts.forEach((t, i) => {
    if (i > 0) { parts.push("\n\n"); cursor += 2; }
    parts.push(t);
    segments.push({
      id: `seg_${i}`, transcriptId: "trs_1", idx: i,
      startMs: null, endMs: null, speakerLabel: null,
      text: t, charStart: cursor, charEnd: cursor + t.length,
    });
    cursor += t.length;
  });
  return { text: parts.join(""), segments };
}

const filler = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");

describe("countWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countWords("one two  three")).toBe(3);
    expect(countWords("   ")).toBe(0);
  });
});

describe("MIN_WORDS", () => {
  it("is exactly 200", () => {
    expect(MIN_WORDS).toBe(200);
  });
});

describe("chunkTranscript", () => {
  it("returns a single window for short input", () => {
    const { text, segments } = makeSegments(["hello there", "goodbye now"]);
    const windows = chunkTranscript(text, segments);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.segments).toHaveLength(2);
  });

  it("splits long input into multiple windows", () => {
    const { text, segments } = makeSegments([
      filler(900, "a"), filler(900, "b"), filler(900, "c"), filler(900, "d"),
    ]);
    const windows = chunkTranscript(text, segments, { targetWords: 1000, overlapWords: 200 });
    expect(windows.length).toBeGreaterThan(1);
  });

  it("never splits inside a segment", () => {
    const { text, segments } = makeSegments([filler(900, "a"), filler(900, "b"), filler(900, "c")]);
    const windows = chunkTranscript(text, segments, { targetWords: 1000, overlapWords: 100 });
    const allIds = windows.flatMap((w) => w.segments.map((s) => s.id));
    for (const s of segments) expect(allIds).toContain(s.id);
    for (const w of windows) {
      for (const s of w.segments) {
        expect(w.text).toContain(s.text);
      }
    }
  });

  it("overlaps consecutive windows", () => {
    const { text, segments } = makeSegments([
      filler(300, "a"), filler(300, "b"), filler(300, "c"), filler(300, "d"), filler(300, "e"), filler(300, "f"),
    ]);
    const windows = chunkTranscript(text, segments, { targetWords: 1000, overlapWords: 500 });
    const first = new Set(windows[0]!.segments.map((s) => s.id));
    const second = windows[1]!.segments.map((s) => s.id);
    expect(second.some((id) => first.has(id))).toBe(true);
  });

  it("reports charStart consistent with the original transcript", () => {
    const { text, segments } = makeSegments([filler(700, "a"), filler(700, "b"), filler(700, "c")]);
    const windows = chunkTranscript(text, segments, { targetWords: 800, overlapWords: 100 });
    for (const w of windows) {
      expect(text.slice(w.charStart, w.charStart + w.text.length)).toBe(w.text);
    }
  });

  it("covers every segment at least once", () => {
    const { text, segments } = makeSegments(Array.from({ length: 12 }, (_, i) => filler(300, `s${i}_`)));
    const windows = chunkTranscript(text, segments, { targetWords: 900, overlapWords: 150 });
    const covered = new Set(windows.flatMap((w) => w.segments.map((s) => s.id)));
    expect(covered.size).toBe(segments.length);
  });

  it("returns no windows for empty segment input", () => {
    expect(chunkTranscript("", [])).toEqual([]);
  });

  it("produces no overlap when a single segment exceeds the target", () => {
    // When segments are larger than targetWords (e.g., speaker turns > 1000 words),
    // the algorithm must create one-segment windows with no overlap.
    // This is degenerate but valid: coverage is maintained (every segment appears),
    // just without overlapping protection. In practice, segments are speaker turns
    // of a few dozen words against a 2000-word target, so overlap works normally.
    const { text, segments } = makeSegments([
      filler(1200, "a"), filler(1200, "b"), filler(1200, "c"),
    ]);
    const windows = chunkTranscript(text, segments, { targetWords: 1000, overlapWords: 500 });
    // Each window contains exactly one segment
    expect(windows).toHaveLength(3);
    windows.forEach((w) => expect(w.segments).toHaveLength(1));
    // Consecutive windows do not overlap
    for (let i = 0; i < windows.length - 1; i++) {
      const first = new Set(windows[i]!.segments.map((s) => s.id));
      const second = windows[i + 1]!.segments.map((s) => s.id);
      expect(second.some((id) => first.has(id))).toBe(false);
    }
    // But coverage is maintained: every segment appears in at least one window
    const covered = new Set(windows.flatMap((w) => w.segments.map((s) => s.id)));
    expect(covered.size).toBe(segments.length);
  });
});
