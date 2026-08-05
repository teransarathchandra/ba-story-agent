import { describe, it, expect } from "vitest";
import { tokenize, levenshteinRatio, bestWindow, stripDisfluencies } from "../../src/grounding/similarity.js";

describe("tokenize", () => {
  it("splits on whitespace and records offsets", () => {
    const toks = tokenize("we need approval");
    expect(toks.map((t) => t.token)).toEqual(["we", "need", "approval"]);
    expect("we need approval".slice(toks[2]!.start, toks[2]!.end)).toBe("approval");
  });

  it("returns an empty array for empty input", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("stripDisfluencies", () => {
  it("removes single-token disfluencies", () => {
    const tokens = ["um", "we", "would", "uh", "want", "approval"];
    expect(stripDisfluencies(tokens)).toEqual(["we", "would", "want", "approval"]);
  });

  it("removes multi-word disfluency phrases", () => {
    const tokens = ["we", "you", "know", "want", "i", "mean", "approval"];
    expect(stripDisfluencies(tokens)).toEqual(["we", "want", "approval"]);
  });

  it("leaves ordinary words untouched", () => {
    const tokens = ["we", "would", "want", "manager", "approval"];
    expect(stripDisfluencies(tokens)).toEqual(["we", "would", "want", "manager", "approval"]);
  });

  it("returns empty array when all tokens are disfluencies", () => {
    const tokens = ["um", "uh", "er"];
    expect(stripDisfluencies(tokens)).toEqual([]);
  });
});

describe("levenshteinRatio", () => {
  it("returns 1 for identical token arrays", () => {
    expect(levenshteinRatio(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
  });

  it("returns 1 for two empty arrays", () => {
    expect(levenshteinRatio([], [])).toBe(1);
  });

  it("returns 0 when nothing matches", () => {
    expect(levenshteinRatio(["a", "b"], ["x", "y"])).toBe(0);
  });

  it("scores one deleted filler word out of eleven above 0.90", () => {
    const withFiller = "um we would want manager approval on anything over ten thousand".split(" ");
    const stripped = "we would want manager approval on anything over ten thousand".split(" ");
    expect(levenshteinRatio(withFiller, stripped)).toBeGreaterThan(0.9);
  });

  it("scores an invented sentence far below 0.90", () => {
    const real = "we would want manager approval on invoices".split(" ");
    const invented = "passwords must contain a special character and a digit".split(" ");
    expect(levenshteinRatio(real, invented)).toBeLessThan(0.3);
  });
});

describe("bestWindow", () => {
  it("finds an exact span and reports its offsets", () => {
    const hay = "so anything over ten thousand euro has to go to a manager no exceptions";
    const found = bestWindow(hay, "over ten thousand euro");
    expect(found).not.toBeNull();
    expect(found!.ratio).toBe(1);
    expect(hay.slice(found!.start, found!.end)).toBe("over ten thousand euro");
  });

  it("strips disfluencies from both sides and scores 1.0 for a real quote", () => {
    const hay = "um we would uh want manager approval on that";
    const found = bestWindow(hay, "we would want manager approval");
    expect(found).not.toBeNull();
    expect(found!.ratio).toBe(1);
  });

  it("offsets include unstripped filler words in the matched span", () => {
    const hay = "um we would uh want manager approval on that";
    const found = bestWindow(hay, "we would want manager approval");
    expect(found).not.toBeNull();
    // Span should include the "uh" even though it was stripped for scoring
    expect(hay.slice(found!.start, found!.end)).toBe("we would uh want manager approval");
  });

  it("returns null when needle consists only of disfluencies", () => {
    const hay = "um we would uh want manager approval";
    const found = bestWindow(hay, "um uh er");
    expect(found).toBeNull();
  });

  it("returns a low ratio for text that is not present", () => {
    const hay = "we discussed the login screen and nothing else";
    const found = bestWindow(hay, "passwords must be at least twelve characters long");
    expect(found!.ratio).toBeLessThan(0.5);
  });

  it("scores long quotes above threshold with one disfluency", () => {
    const hay = "um we would uh want manager approval on that is really important here";
    const found = bestWindow(hay, "we would want manager approval on that is really important");
    expect(found).not.toBeNull();
    expect(found!.ratio).toBeGreaterThan(0.9);
  });

  it("returns null when either side has no tokens", () => {
    expect(bestWindow("", "abc")).toBeNull();
    expect(bestWindow("abc", "")).toBeNull();
  });
});
