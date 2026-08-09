import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { validateQuote, type GroundingSource } from "../../src/grounding/validator.js";
import { countWords, MIN_WORDS } from "../../src/pipeline/stage0-chunk.js";
import { isHedged } from "../../src/hedge/lexicon.js";
import { ExtractedClaimsSchema } from "../../src/pipeline/stage1-extract.js";
import { ClassificationSchema } from "../../src/pipeline/stage3-classify.js";
import { ReconcileSchema } from "../../src/pipeline/stage4-reconcile.js";
import { RequirementDraftsSchema } from "../../src/pipeline/stage5-requirements.js";
import { StoryDraftsSchema } from "../../src/pipeline/stage6-stories.js";
import { CritiqueFindingsSchema } from "../../src/pipeline/stage7-critique.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../fixtures/transcripts");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, `${name}.txt`), "utf8");
}

/**
 * These tests run WITHOUT the API. They assert the properties the
 * deterministic layer guarantees on real transcript text. The live pipeline
 * eval is `npm run eval:live` and is gated behind an env var because it
 * costs money.
 */
describe("adversarial fixtures — deterministic guarantees", () => {
  const names = readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.replace(/\.txt$/, ""));

  it("has all six fixtures", () => {
    expect(names).toHaveLength(6);
  });

  it("every fixture except small-talk clears the 200-word floor", () => {
    for (const name of names) {
      expect(countWords(loadFixture(name))).toBeGreaterThanOrEqual(MIN_WORDS);
    }
  });

  it("the grounding validator rejects every fabricated quote against every fixture", () => {
    const fabrications = [
      "passwords must be at least twelve characters long",
      "records are retained for thirty days",
      "the system supports single sign on via SAML",
      "invoices are archived to cold storage after one year",
    ];
    for (const name of names) {
      const text = loadFixture(name);
      const source: GroundingSource = {
        segments: [{ id: "s0", text, charStart: 0 }],
        windowText: text,
        windowCharStart: 0,
      };
      for (const quote of fabrications) {
        const result = validateQuote({ quote, segmentId: "s0" }, source);
        expect(
          result.status,
          `"${quote}" should be quarantined against ${name}`,
        ).toBe("quarantined");
      }
    }
  });

  it("the grounding validator accepts real spans lifted from each fixture", () => {
    for (const name of names) {
      const text = loadFixture(name);
      const line = text.split("\n").find((l) => countWords(l) > 8);
      if (!line) continue;
      const span = line.split(/\s+/).slice(1, 9).join(" ");
      const source: GroundingSource = {
        segments: [{ id: "s0", text, charStart: 0 }],
        windowText: text,
        windowCharStart: 0,
      };
      expect(validateQuote({ quote: span, segmentId: "s0" }, source).status).toBe("validated");
    }
  });

  it("the leading-question fixture's non-committal answers are all hedged", () => {
    // "Mm, possibly." and "I suppose so" must be caught by the lexicon so
    // they can never be promoted to requirements.
    expect(isHedged("Mm, possibly.")).toBe(true);
    expect(isHedged("I suppose so, yes.")).toBe(true);
    expect(isHedged("presumably a threshold of around ten thousand")).toBe(true);
  });

  it("the definite statements in the leading-question fixture are NOT hedged", () => {
    expect(isHedged("the list has to come off the printer in the packing area")).toBe(false);
    expect(isHedged("every order needs the customer reference on the picking list")).toBe(false);
  });

  it("documents an open invention vector: a mostly-filler needle can validate against unrelated context", () => {
    // "um uh honestly" strips down (via stripDisfluencies) to a single
    // substantive token, "honestly". bestWindow only rejects FULLY-filler
    // needles (empty after stripping) -- a needle with one leftover token can
    // still score a perfect match against any window containing that word,
    // even in a completely unrelated sentence. No minimum-substantive-token
    // guard exists yet (carried forward from Task 8's review). This test
    // pins the CURRENT behavior so a future fix to the validator is a
    // deliberate, visible decision rather than a silent change either way.
    const text = "The invoice process is fairly simple honestly and we rarely have issues with it at all.";
    const source: GroundingSource = {
      segments: [{ id: "s0", text, charStart: 0 }],
      windowText: text,
      windowCharStart: 0,
    };
    const result = validateQuote({ quote: "um uh honestly", segmentId: "s0" }, source);
    expect(result.status).toBe("validated");
    if (result.status === "validated") {
      expect(result.matchMode).toBe("fuzzy");
    }
  });
});

describe("every pipeline stage's structured-output schema is real and zodOutputFormat-compatible", () => {
  // Guards the systemic lesson from an earlier task: a mocked LLM boundary
  // let two consecutive Critical bugs (stale SDK version, stale zod version)
  // through a fully green suite. These are the ACTUAL schemas each stage
  // sends to the live API -- importing them for real, not a local lookalike.
  const schemas: Record<string, z.ZodType> = {
    ExtractedClaimsSchema, ClassificationSchema, ReconcileSchema,
    RequirementDraftsSchema, StoryDraftsSchema, CritiqueFindingsSchema,
  };
  for (const [name, schema] of Object.entries(schemas)) {
    it(`zodOutputFormat accepts ${name}`, () => {
      const output = zodOutputFormat(schema);
      expect(output).toHaveProperty("type", "json_schema");
      expect(output).toHaveProperty("schema");
    });
  }
});
