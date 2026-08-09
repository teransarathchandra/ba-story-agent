import { describe, it, expect } from "vitest";
import { loadGoldFixture } from "../../src/eval/gold-schema.js";
import { checkUnsupportedDetails, checkAlreadyAnsweredQuestions } from "../../src/eval/gold-deterministic-checks.js";
import type { GeneratedCandidate } from "../../src/eval/gold-metrics.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = loadGoldFixture(join(here, "../fixtures/golden/06-salon-booking.gold.json"));

describe("06-salon-booking unsupportedDetailChecks — assertion-specificity", () => {
  it("does NOT false-positive on the legitimate men's-haircut 30-minute duration example", () => {
    const candidates: GeneratedCandidate[] = [
      { id: "r1", bucket: "requirement", text: "Men's haircut takes 30 minutes", quote: "Men's haircut is 30." },
    ];
    expect(checkUnsupportedDetails(fixture.unsupportedDetailChecks, candidates)).toEqual([]);
  });

  it("DOES flag an invented no-show grace period co-occurring with a minute count", () => {
    const candidates: GeneratedCandidate[] = [
      { id: "r2", bucket: "requirement", text: "No-shows are only counted after 30 minutes", quote: "" },
    ];
    const violations = checkUnsupportedDetails(fixture.unsupportedDetailChecks, candidates);
    expect(violations.map((v) => v.checkId)).toEqual(["UDC-01"]);
  });

  it("does NOT false-positive on legitimate uses of 'required' elsewhere in generated text", () => {
    const candidates: GeneratedCandidate[] = [
      { id: "r3", bucket: "requirement", text: "Reminders are required for every appointment", quote: "" },
    ];
    expect(checkUnsupportedDetails(fixture.unsupportedDetailChecks, candidates)).toEqual([]);
  });

  it("flags an invented 'sales representative' role", () => {
    const candidates: GeneratedCandidate[] = [
      { id: "r4", bucket: "requirement", text: "Sales representatives can view all customer bookings", quote: "" },
    ];
    const violations = checkUnsupportedDetails(fixture.unsupportedDetailChecks, candidates);
    expect(violations.map((v) => v.checkId)).toEqual(["UDC-02"]);
  });

  it("flags an invented 'dropdown' UI mechanism", () => {
    const candidates: GeneratedCandidate[] = [
      { id: "r5", bucket: "requirement", text: "Customer selects a stylist via a dropdown menu", quote: "" },
    ];
    const violations = checkUnsupportedDetails(fixture.unsupportedDetailChecks, candidates);
    expect(violations.map((v) => v.checkId)).toEqual(["UDC-03"]);
  });

  it("none of the fixture's unsupportedDetailChecks scope recommendation, and bucketScope is always omitted (defaulting to the 3 grounded buckets) or an explicit subset of them", () => {
    // "Dropdown" is a hallucination if emitted as a requirement/question/
    // assumption, but a legitimate AI-suggested idea in a recommendation —
    // design §6, applied uniformly to every UDC check. Recommendations are
    // never part of the GeneratedCandidate type this module accepts (see
    // gold-metrics.ts), so this is enforced structurally, not just by
    // convention — this test pins that every check in the frozen fixture
    // actually follows the convention its scope declares.
    for (const check of fixture.unsupportedDetailChecks) {
      expect(check.bucketScope ?? []).not.toContain("recommendation");
    }
  });
});

describe("06-salon-booking answeredQuestionChecks — legitimate follow-up preserved", () => {
  it("flags a question re-asking the branch count, already explicitly settled", () => {
    const candidates: GeneratedCandidate[] = [
      { id: "q1", bucket: "question", text: "How many branches does the salon operate?", quote: "" },
    ];
    const violations = checkAlreadyAnsweredQuestions(fixture.answeredQuestionChecks, candidates);
    expect(violations.map((v) => v.checkId)).toEqual(["AAQ-01"]);
  });

  it("does NOT flag a follow-up question about staff working-hours detail (AAQ-02 removed — legitimate follow-up remains)", () => {
    const candidates: GeneratedCandidate[] = [
      { id: "q2", bucket: "question", text: "What are the exact working hours for each individual staff member?", quote: "" },
    ];
    expect(checkAlreadyAnsweredQuestions(fixture.answeredQuestionChecks, candidates)).toEqual([]);
  });

  it("the fixture's answeredQuestionChecks contains exactly AAQ-01 (branch count) — AAQ-02 was removed", () => {
    expect(fixture.answeredQuestionChecks.map((c) => c.id)).toEqual(["AAQ-01"]);
  });
});
