import { describe, it, expect } from "vitest";
import { normalize, denormalizeRange } from "../../src/grounding/normalize.js";

describe("normalize", () => {
  it("lowercases", () => {
    expect(normalize("Hello WORLD").text).toBe("hello world");
  });

  it("collapses runs of whitespace to a single space", () => {
    expect(normalize("a   \n\t b").text).toBe("a b");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalize("   padded   ").text).toBe("padded");
  });

  it("folds smart quotes and dashes to ASCII", () => {
    // Input: left double quote, quoted, right double quote, space, left single quote, x, right single quote, space, em dash, space, y
    const input = "“quoted” ‘x’ — y";
    const expected = '"quoted" \'x\' - y';
    expect(normalize(input).text).toBe(expected);
  });

  it("maps every normalized index back to an original index", () => {
    const original = "Hello   WORLD";
    const { text, map } = normalize(original);
    expect(text).toBe("hello world");
    expect(map).toHaveLength(text.length);
    expect(original[map[0]!]).toBe("H");
    expect(original[map[6]!]).toBe("W");
  });

  it("denormalizes a range back to original offsets", () => {
    const original = "Hello   WORLD tail";
    const { text, map } = normalize(original);
    const start = text.indexOf("world");
    const range = denormalizeRange(map, original.length, start, start + "world".length);
    expect(original.slice(range.start, range.end)).toBe("WORLD");
  });

  it("returns an empty map for an all-whitespace string", () => {
    const { text, map } = normalize("   \n  ");
    expect(text).toBe("");
    expect(map).toEqual([]);
  });

  // Edge cases
  it("handles ellipsis folding to three characters with repeated index", () => {
    const { text, map } = normalize("a…b");
    expect(text).toBe("a...b");
    expect(map).toHaveLength(text.length);
    // The ellipsis at original index 1 should produce three dots in output
    expect(map[1]).toBe(1);
    expect(map[2]).toBe(1);
    expect(map[3]).toBe(1);
    // Verify the invariant: map.length === text.length
    expect(map.length).toBe(5);
  });

  it("handles CRLF line endings collapsing to single space", () => {
    const { text, map } = normalize("a\r\nb");
    expect(text).toBe("a b");
    expect(map).toHaveLength(3);
  });

  it("maps collapsed whitespace to the last whitespace character in the run", () => {
    // This test pins the fix for Finding 1: the collapsed space must map to
    // the last whitespace in the run, not the following non-space character
    const original = "  a  b  ";
    const { text, map } = normalize(original);
    expect(text).toBe("a b");
    // map[0] is 'a' from index 2
    expect(map[0]).toBe(2);
    // map[1] is the space, should map to index 4 (the last space before 'b')
    // not to index 5 ('b' itself)
    expect(map[1]).toBe(4);
    // map[2] is 'b' from index 5
    expect(map[2]).toBe(5);
  });

  it("denormalizeRange respects whitespace boundaries", () => {
    // Verify that denormalizeRange does not include characters from the
    // following word when the range ends at a collapsed space
    const original = "  a  b  ";
    const { text, map } = normalize(original);
    // "a b" has 'a' at [0], space at [1], 'b' at [2]
    // Denormalize range [0, 2) which should be just "a "
    const range = denormalizeRange(map, original.length, 0, 2);
    const denormalized = original.slice(range.start, range.end);
    expect(denormalized).toBe("a  ");
    // Verify it doesn't include 'b'
    expect(denormalized).not.toContain("b");
  });

  describe("denormalizeRange edge cases", () => {
    it("handles empty map", () => {
      const range = denormalizeRange([], 10, 0, 1);
      expect(range).toEqual({ start: 0, end: 0 });
    });

    it("handles start >= end", () => {
      const range = denormalizeRange([0, 1, 2], 10, 5, 2);
      expect(range).toEqual({ start: 0, end: 0 });
    });

    it("clamps end beyond map.length", () => {
      const map = [0, 1, 2];
      const range = denormalizeRange(map, 10, 1, 100);
      expect(range.start).toBe(1);
      expect(range.end).toBeLessThanOrEqual(10);
    });

    it("clamps start beyond map.length", () => {
      const map = [0, 1, 2];
      const range = denormalizeRange(map, 10, 100, 101);
      expect(range).toEqual({ start: 2, end: 3 });
    });
  });
});
