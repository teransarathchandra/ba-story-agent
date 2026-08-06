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

  it("repeat calls return identical results", () => {
    const input = "we might probably do this eventually";
    const first = detectHedges(input);
    const second = detectHedges(input);
    expect(first).toEqual(second);

    // Also test calling on a long string with late matches, then on a short string
    const longInput = "we have a process that typically and usually and often happens this way";
    const longResult = detectHedges(longInput);
    const shortInput = "might";
    const shortResult = detectHedges(shortInput);
    expect(shortResult).toEqual(["might"]);
    expect(detectHedges(longInput)).toEqual(longResult);
  });

  it("returns markers in exact order of first appearance", () => {
    const result = detectHedges("probably at first, then might happen, and usually after");
    expect(result).toEqual(["probably", "might", "usually"]);
  });

  it("new expanded markers do not produce false positives on firm statements", () => {
    expect(isHedged("anything over ten thousand euro must go to a manager")).toBe(false);
    // Also test some other firm statements that shouldn't match new markers
    expect(isHedged("we process invoices weekly in standard format")).toBe(false);
    expect(isHedged("all transactions require manager approval")).toBe(false);
  });
});
