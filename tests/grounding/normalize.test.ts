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
});
