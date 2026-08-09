// Thin CLI adapter: evaluate an ALREADY-persisted, already-analyzed
// session in an arbitrary SQLite DB file (e.g. the real Electron app's
// database), read-only, WITHOUT calling analyzeSession() and, by default,
// WITHOUT calling the semantic judge.
//
// No new evaluation logic lives here — this only opens the DB read-only
// (SQLITE_OPEN_READONLY via better-sqlite3's `readonly: true`, so any
// accidental write throws instead of silently succeeding), reads the
// session's own recorded generator model from its egress_log, and calls
// the exact same runGoldEval()/persistArtifact()/printGoldEvalReport()
// functions the live-eval harness uses for a freshly-generated run.
//
// --session-id is REQUIRED, not optional: requirements/questions in this
// domain model are stored project-scoped, not session-scoped (see
// collectGeneratedCandidates()'s doc comment in gold-match.ts), and
// nothing in the schema prevents a second session existing under the
// same project — a --project-id-only invocation could silently mix a
// different session's persisted output into this one's evaluation.
//
//   npx tsx scripts/eval/run-existing-session.ts \
//     --db "/path/to/ba-story-agent.db" \
//     --project-id prj_XXXXXXXXXXXXXXXXXXXXXXXXXX \
//     --session-id ses_XXXXXXXXXXXXXXXXXXXXXXXXXX \
//     --fixture 06-salon-booking
//
// Add --with-judge to also make the one real judge call (costs money,
// requires ANTHROPIC_API_KEY) — omitted by default, so a bare invocation
// makes zero external model calls and every judge-dependent metric
// reports SKIPPED.
import Database from "better-sqlite3";
import { loadGoldFixture } from "../../src/eval/gold-schema.js";
import { runGoldEval, persistArtifact } from "./gold-match.js";
import { printGoldEvalReport } from "./gold-report.js";
import type { Db } from "../../src/store/db.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const dbPath = arg("db");
  const projectId = arg("project-id");
  const sessionId = arg("session-id");
  const fixtureName = arg("fixture");
  const withJudge = process.argv.includes("--with-judge");

  if (!dbPath || !projectId || !sessionId || !fixtureName) {
    process.stderr.write(
      "Usage: run-existing-session.ts --db <path> --project-id <id> --session-id <id> --fixture <name> [--with-judge]\n" +
        "  --session-id is required: requirements/questions are stored project-scoped\n" +
        "  in this schema, and a second session under the same project would\n" +
        "  otherwise silently contaminate a supposedly session-specific evaluation.\n" +
        "  Without --with-judge (default), this makes NO external model call —\n" +
        "  only the two hard deterministic invariants run; every judge-dependent\n" +
        "  metric reports SKIPPED.\n",
    );
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true }) as Db;

  const fixture = loadGoldFixture(`tests/fixtures/golden/${fixtureName}.gold.json`);

  // Read-only lookup of this exact session's own recorded generator model
  // — never asserted, always taken from the DB's own egress_log.
  const modelRow = db
    .prepare(`SELECT model FROM egress_log WHERE session_id = ? ORDER BY at ASC LIMIT 1`)
    .get(sessionId) as { model: string } | undefined;
  const model = modelRow?.model ?? "unknown";

  process.stdout.write(`\n[existing-session, read-only] db=${dbPath}\n`);
  process.stdout.write(`  project=${projectId} session=${sessionId} fixture=${fixtureName}\n`);
  if (!withJudge) {
    process.stdout.write(`  judge: not requested — zero external model calls in this run\n`);
  }

  const artifact = await runGoldEval({
    fixture,
    generator: { backendLabel: model.startsWith("hf:") ? "local" : "claude", model },
    db,
    projectId,
    sessionId,
    skipJudge: !withJudge,
  });

  const artifactPath = persistArtifact(artifact);
  printGoldEvalReport(artifact, artifactPath);
  db.close();
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
