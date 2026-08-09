// Formats an EvalRunArtifact for console output. Individual metrics only —
// no aggregate score, no pass/fail gate (design §7: "no single number, no
// weighting"). The artifact itself is the source of truth; this is a
// human-readable view of it.
import type { EvalRunArtifact } from "./gold-match.js";
import type { GoldMetrics } from "../../src/eval/gold-metrics.js";

function pct(rate: number | null): string {
  return rate === null ? "n/a" : `${(rate * 100).toFixed(1)}%`;
}

function line(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(48)} ${value}\n`);
}

function printMetrics(m: GoldMetrics): void {
  process.stdout.write("\n  -- 1. Gold-item recall --\n");
  line(
    "captured / supported",
    `${m.recall.capturedCount}/${m.recall.supportedDenominator} (${pct(m.recall.rate)})`,
  );
  line(
    "context",
    `${m.recall.totalGoldItems} total gold items, ${m.recall.structurallyUnsupportedCount} structurally unsupported (never scored)`,
  );

  process.stdout.write("\n  -- 2. Taxonomy accuracy — supported categories (PRIMARY only) --\n");
  line(
    "correct placement / recalled (requirement, assumption)",
    `${m.taxonomyAccuracy.primaryCorrectCount}/${m.taxonomyAccuracy.primaryRecalledCount} (${pct(m.taxonomyAccuracy.rate)})`,
  );
  line("PROXY-tier recalled (rule, unresolved) — not taxonomy-scored", String(m.taxonomyAccuracy.proxyRecalledCount));

  process.stdout.write("\n  -- 3. Requirement precision --\n");
  line("strict precision (passing / total)", `${m.requirementPrecision.buckets.passing.count}/${m.requirementPrecision.total} (${pct(m.requirementPrecision.strictPrecision)})`);
  line("non-precision rate", pct(m.requirementPrecision.nonPrecisionRate));
  line("  -> contradiction", `${m.requirementPrecision.buckets.contradiction.count} (${pct(m.requirementPrecision.buckets.contradiction.rate)})`);
  line("  -> promoted from unresolved/assumption", `${m.requirementPrecision.buckets.promoted.count} (${pct(m.requirementPrecision.buckets.promoted.rate)})`);
  line("  -> partial-only", `${m.requirementPrecision.buckets["partial-only"].count} (${pct(m.requirementPrecision.buckets["partial-only"].rate)})`);
  line("  -> completely unmatched/unsupported", `${m.requirementPrecision.buckets.unmatched.count} (${pct(m.requirementPrecision.buckets.unmatched.rate)})`);

  process.stdout.write("\n  -- 4. Cross-category exclusivity --\n");
  line("violations (gold item captured across 2+ buckets)", String(m.crossCategoryExclusivity.violationCount));
  for (const v of m.crossCategoryExclusivity.violations) line(`  ${v.goldId}`, v.buckets.join(", "));

  process.stdout.write("\n  -- 5. Duplicate rate --\n");
  line("violations (gold item captured 2+ times, same bucket)", String(m.duplicateRate.violationCount));
  for (const v of m.duplicateRate.violations) line(`  ${v.goldId} (${v.bucket})`, `x${v.count}`);

  process.stdout.write("\n  -- 6. Evidence fidelity --\n");
  line("passing / total generated candidates", `${m.evidenceFidelity.passing}/${m.evidenceFidelity.total} (${pct(m.evidenceFidelity.rate)})`);

  process.stdout.write("\n  -- 7. Meeting-state resolution --\n");
  line("violations / sensitive items", `${m.meetingStateResolution.violationCount}/${m.meetingStateResolution.sensitiveCount}`);
  if (m.meetingStateResolution.violatingGoldIds.length > 0) {
    line("  violating", m.meetingStateResolution.violatingGoldIds.join(", "));
  }

  process.stdout.write("\n  -- 10. Grounded vs. AI-generated questions --\n");
  line("grounded (matched to a gold UNR) / novel / total", `${m.groundedVsNovelQuestions.grounded} / ${m.groundedVsNovelQuestions.novel} / ${m.groundedVsNovelQuestions.total}`);

  process.stdout.write("\n  -- Supplementary --\n");
  line("partial-only gold items", String(m.supplementary.partialOnlyGoldCount));
  line("contradicted gold items", String(m.supplementary.contradictedGoldCount));
}

export function printGoldEvalReport(artifact: EvalRunArtifact, artifactPath: string): void {
  process.stdout.write(`  generator: ${artifact.generator.backendLabel} (${artifact.generator.model})\n`);

  if ("skipped" in artifact.judge) {
    process.stdout.write(`  judge: SKIPPED — ${artifact.judge.reason}\n`);
  } else {
    process.stdout.write(
      `  judge: ${artifact.judge.backendLabel} (${artifact.judge.model}), prompt v${artifact.judge.promptVersion}, schema v${artifact.judge.schemaVersion}\n`,
    );
    if (!artifact.judge.coverageValid) {
      process.stdout.write(`  judge coverage: INVALID\n`);
      for (const e of artifact.judge.coverageErrors) process.stdout.write(`    - ${e}\n`);
    }
  }

  process.stdout.write("\n  -- 8. Unsupported-detail violations (hard, deterministic) --\n");
  line("count", String(artifact.deterministicInvariantResults.unsupportedDetailViolations.length));
  for (const v of artifact.deterministicInvariantResults.unsupportedDetailViolations) {
    line(`  ${v.checkId} (${v.bucket}/${v.candidateId})`, `"${v.matchedText}"`);
  }

  process.stdout.write("\n  -- 9. Already-answered-question violations (hard, deterministic) --\n");
  line("count", String(artifact.deterministicInvariantResults.alreadyAnsweredQuestionViolations.length));
  for (const v of artifact.deterministicInvariantResults.alreadyAnsweredQuestionViolations) {
    line(`  ${v.checkId} (${v.candidateId})`, `"${v.matchedText}"`);
  }

  if ("skipped" in artifact.metrics) {
    process.stdout.write(`\n  Metrics 1-7, 10: SKIPPED — ${artifact.metrics.reason}\n`);
  } else if ("invalid" in artifact.metrics) {
    process.stdout.write(`\n  Metrics 1-7, 10: INVALID — ${artifact.metrics.reason}\n`);
  } else {
    printMetrics(artifact.metrics);
  }

  process.stdout.write(`\n  full audit artifact: ${artifactPath}\n`);
}
