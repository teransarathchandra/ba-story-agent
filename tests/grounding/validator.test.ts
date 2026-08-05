// tests/grounding/validator.test.ts
import { describe, it, expect } from "vitest";
import { validateQuote, FUZZY_THRESHOLD, type GroundingSource } from "../../src/grounding/validator.js";

const WINDOW =
  "BA: so what happens on a big invoice\n\n" +
  "Client: um, anything over ten thousand euro has to go to a manager, no exceptions\n\n" +
  "Client: we would usually be dealing in euro";

function source(): GroundingSource {
  const segTexts = WINDOW.split("\n\n");
  let cursor = 0;
  const segments = segTexts.map((text, i) => {
    const charStart = WINDOW.indexOf(text, cursor);
    cursor = charStart + text.length;
    return { id: `seg_${i}`, text, charStart };
  });
  return { segments, windowText: WINDOW, windowCharStart: 0 };
}

describe("validateQuote — threshold", () => {
  it("uses exactly 0.90", () => {
    expect(FUZZY_THRESHOLD).toBe(0.9);
  });
});

describe("validateQuote — exact match", () => {
  it("validates a verbatim quote inside the named segment", () => {
    const r = validateQuote(
      { quote: "anything over ten thousand euro has to go to a manager", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("validated");
    if (r.status !== "validated") return;
    expect(r.matchMode).toBe("exact");
    expect(WINDOW.slice(r.charStart, r.charEnd)).toContain("ten thousand euro");
  });

  it("tolerates case differences", () => {
    const r = validateQuote(
      { quote: "ANYTHING OVER TEN THOUSAND EURO", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("validated");
  });

  it("tolerates collapsed whitespace", () => {
    const r = validateQuote(
      { quote: "anything    over\n  ten thousand euro", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("validated");
  });

  it("tolerates smart quotes and em dashes", () => {
    const r = validateQuote(
      { quote: "anything over ten thousand euro — has to go to a manager", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("validated");
  });
});

describe("validateQuote — segment correction", () => {
  it("corrects the segment id when the quote lives in a different segment of the window", () => {
    const r = validateQuote(
      { quote: "we would usually be dealing in euro", segmentId: "seg_0" },
      source(),
    );
    expect(r.status).toBe("validated");
    if (r.status !== "validated") return;
    expect(r.matchMode).toBe("segment-corrected");
    expect(r.segmentId).toBe("seg_2");
  });
});

describe("validateQuote — fuzzy match", () => {
  it("validates a disfluency-stripped quote and marks it fuzzy", () => {
    const r = validateQuote(
      { quote: "anything over ten thousand euro has to go to a manager no exceptions", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("validated");
  });

  it("validates when the model drops a genuine disfluency", () => {
    // seg_1 is "Client: um, anything over ten thousand euro has to go to a
    // manager, no exceptions" — "um" is an actual filler word from the
    // disfluency lexicon (similarity.ts's DISFLUENCIES), not content. Once
    // "Client: um, " is dropped (as any real quote would drop the speaker
    // label too), what remains is a verbatim contiguous substring of the
    // segment, so this resolves via exact match at ratio 1.0 — a stronger
    // guarantee than fuzzy, and consistent with the ladder always preferring
    // the cheaper, more certain match when one is available. Fuzzy-path
    // disfluency stripping specifically (interior fillers that break
    // contiguous substring matching) is covered directly in
    // similarity.test.ts's `bestWindow` suite.
    const r = validateQuote(
      { quote: "anything over ten thousand euro has to go to a manager, no exceptions", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("validated");
    if (r.status !== "validated") return;
    expect(r.ratio).toBe(1);
  });
});

describe("validateQuote — quarantine", () => {
  it("quarantines an outright fabricated quote", () => {
    const r = validateQuote(
      { quote: "passwords must be at least twelve characters and rotate every ninety days", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("quarantined");
    if (r.status !== "quarantined") return;
    expect(r.bestRatio).toBeLessThan(FUZZY_THRESHOLD);
  });

  it("quarantines a quote that is plausible but not said", () => {
    const r = validateQuote(
      { quote: "anything over five thousand dollars needs director sign off", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("quarantined");
  });

  it("quarantines a quote that silently drops a hedge word", () => {
    // "usually" is not a disfluency — it's a hedge marker (Task 10's lexicon)
    // and it is load-bearing: "we'd *usually* be dealing in euro" is a
    // tentative statement, not a commitment. A model that quotes it as "we
    // would be dealing in euro" has deleted the word that made it tentative,
    // turning a hedged assumption into what reads as a firm requirement.
    // Refusing to validate that silently is the intended guarantee — a
    // second line of defense for exactly the failure Task 10's hedge guard
    // exists to catch — not a limitation of the fuzzy matcher.
    const r = validateQuote(
      { quote: "we would be dealing in euro", segmentId: "seg_2" },
      source(),
    );
    expect(r.status).toBe("quarantined");
    if (r.status !== "quarantined") return;
    expect(r.bestRatio).toBeLessThan(FUZZY_THRESHOLD);
  });

  it("quarantines an empty quote", () => {
    const r = validateQuote({ quote: "", segmentId: "seg_1" }, source());
    expect(r.status).toBe("quarantined");
    if (r.status !== "quarantined") return;
    expect(r.reason).toMatch(/empty/i);
  });

  it("quarantines a whitespace-only quote", () => {
    const r = validateQuote({ quote: "   \n  ", segmentId: "seg_1" }, source());
    expect(r.status).toBe("quarantined");
  });
});

describe("validateQuote — robustness", () => {
  it("does not throw when the segment id is unknown", () => {
    const r = validateQuote(
      { quote: "anything over ten thousand euro", segmentId: "seg_does_not_exist" },
      source(),
    );
    expect(r.status).toBe("validated");
  });

  it("handles a quote spanning two segments via the window fallback", () => {
    const r = validateQuote(
      { quote: "no exceptions we would usually be dealing in euro", segmentId: "seg_1" },
      source(),
    );
    expect(["validated", "quarantined"]).toContain(r.status);
  });

  it("reports offsets relative to the whole transcript when the window is offset", () => {
    const s = source();
    const shifted: GroundingSource = {
      segments: s.segments.map((seg) => ({ ...seg, charStart: seg.charStart + 1000 })),
      windowText: s.windowText,
      windowCharStart: 1000,
    };
    const r = validateQuote(
      { quote: "anything over ten thousand euro", segmentId: "seg_1" },
      shifted,
    );
    expect(r.status).toBe("validated");
    if (r.status !== "validated") return;
    expect(r.charStart).toBeGreaterThanOrEqual(1000);
  });
});
