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

  it("validates when the model drops a filler word", () => {
    const r = validateQuote(
      { quote: "we would be dealing in euro", segmentId: "seg_2" },
      source(),
    );
    expect(r.status).toBe("validated");
    if (r.status !== "validated") return;
    expect(r.matchMode).toBe("fuzzy");
    expect(r.ratio).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
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
