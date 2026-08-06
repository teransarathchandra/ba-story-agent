import { describe, it, expect } from "vitest";
import { detectHedges, isHedged } from "../../src/hedge/lexicon.js";

describe("detectHedges", () => {
  it("finds a single-word hedge", () => {
    expect(detectHedges("we would probably want approvals")).toContain("probably");
  });

  it("finds multi-word hedges", () => {
    expect(detectHedges("I think we usually do it that way")).toEqual(
      expect.arrayContaining(["i think", "usually"]),
    );
  });

  it("is case-insensitive", () => {
    expect(isHedged("PROBABLY yes")).toBe(true);
  });

  it("matches on word boundaries only", () => {
    expect(isHedged("the mightily impressive result")).toBe(false);
    expect(isHedged("we might need it")).toBe(true);
  });

  it("returns false for a firm statement", () => {
    expect(isHedged("anything over ten thousand euro must go to a manager")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(isHedged("")).toBe(false);
    expect(detectHedges("")).toEqual([]);
  });

  it("catches the hedges most likely to be promoted to requirements", () => {
    for (const s of [
      "we'd probably want that",
      "I assume it's monthly",
      "typically we invoice weekly",
      "something like a dashboard",
      "it might be quarterly",
      "I guess so",
      "more or less that",
    ]) {
      expect(isHedged(s)).toBe(true);
    }
  });
});
