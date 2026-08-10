// Evaluates a FROZEN candidate snapshot (see src/eval/candidate-snapshot.ts)
// instead of a live, mutable DB — for reproducible benchmark reruns that
// never depend on whatever happens to be in the Electron app's SQLite
// database on a given day. NO DB access at all in this path: the snapshot
// carries its own provenance (source project/session, source DB hash at
// extraction, extraction timestamp, generator identity) and is
// self-verifying (candidateContentSha256, checked on load).
//
// Live-DB evaluation (scripts/eval/run-existing-session.ts) is completely
// untouched by this — this is an ADDITIONAL mode, not a replacement.
//
//   npx tsx scripts/eval/run-candidate-snapshot.ts \
//     --snapshot tests/fixtures/golden/06-salon-booking.candidates-snapshot.json \
//     --fixture 06-salon-booking \
//     [--with-judge]
//
// Judge configuration is via the same EVAL_JUDGE_BACKEND/EVAL_JUDGE_MODEL/
// EVAL_JUDGE_CONTEXT_SIZE/EVAL_JUDGE_MAX_OUTPUT_TOKENS env vars as
// run-existing-session.ts (see gold-match.ts's resolveJudgeConfig()).
import { loadGoldFixture } from "../../src/eval/gold-schema.js";
import { loadCandidateSnapshot } from "../../src/eval/candidate-snapshot.js";
import { runGoldEval, persistArtifact } from "./gold-match.js";
import { printGoldEvalReport } from "./gold-report.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const snapshotPath = arg("snapshot");
  const fixtureName = arg("fixture");
  const withJudge = process.argv.includes("--with-judge");

  if (!snapshotPath || !fixtureName) {
    process.stderr.write(
      "Usage: run-candidate-snapshot.ts --snapshot <path> --fixture <name> [--with-judge]\n" +
        "  Evaluates a FROZEN candidate snapshot, not the live DB — see\n" +
        "  scripts/eval/create-candidate-snapshot.ts to create one.\n" +
        "  Without --with-judge (default), this makes NO external model call —\n" +
        "  only the two hard deterministic invariants run; every judge-dependent\n" +
        "  metric reports SKIPPED.\n",
    );
    process.exit(1);
  }

  const snapshot = loadCandidateSnapshot(snapshotPath); // throws on hash mismatch — never evaluates silently-drifted content
  const fixture = loadGoldFixture(`tests/fixtures/golden/${fixtureName}.gold.json`);

  process.stdout.write(`\n[candidate-snapshot, NO DB access] snapshot=${snapshotPath}\n`);
  process.stdout.write(`  fixture=${fixtureName} snapshotId=${snapshot.snapshotId}\n`);
  process.stdout.write(`  source: project=${snapshot.sourceProjectId} session=${snapshot.sourceSessionId}\n`);
  process.stdout.write(`  extracted=${snapshot.extractionTimestamp} source DB hash=${snapshot.sourceDbHashAtExtraction}\n`);
  process.stdout.write(`  generator: ${snapshot.sourceGeneratorBackendLabel} / ${snapshot.sourceGeneratorModel}\n`);
  if (!withJudge) {
    process.stdout.write(`  judge: not requested — zero external model calls in this run\n`);
  }

  const artifact = await runGoldEval({
    fixture,
    generator: { backendLabel: snapshot.sourceGeneratorBackendLabel, model: snapshot.sourceGeneratorModel },
    generatedCandidatesOverride: snapshot.normalizedPipelineOutputs,
    skipJudge: !withJudge,
    judgeLog: (line) => process.stdout.write(`  [judge] ${line}\n`),
  });

  const artifactPath = persistArtifact(artifact);
  printGoldEvalReport(artifact, artifactPath);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
