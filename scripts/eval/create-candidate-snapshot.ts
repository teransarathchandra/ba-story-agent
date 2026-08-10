// Creates an immutable, promoted candidate-snapshot artifact (see
// src/eval/candidate-snapshot.ts) from a real, already-persisted,
// already-analyzed session — read-only, single execution, meant to be run
// once when promoting a benchmark's input, not part of any regular eval
// loop. The resulting file is what scripts/eval/run-candidate-snapshot.ts
// evaluates against instead of the live DB.
//
//   npx tsx scripts/eval/create-candidate-snapshot.ts \
//     --db "/path/to/ba-story-agent.db" \
//     --project-id prj_XXXXXXXXXXXXXXXXXXXXXXXXXX \
//     --session-id ses_XXXXXXXXXXXXXXXXXXXXXXXXXX \
//     --fixture 06-salon-booking \
//     --out tests/fixtures/golden/06-salon-booking.candidates-snapshot.json
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { collectGeneratedCandidates } from "./gold-match.js";
import { computeCandidateContentHash, CandidateSnapshotSchema } from "../../src/eval/candidate-snapshot.js";
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
  const out = arg("out");

  if (!dbPath || !projectId || !sessionId || !fixtureName || !out) {
    process.stderr.write(
      "Usage: create-candidate-snapshot.ts --db <path> --project-id <id> --session-id <id> --fixture <name> --out <path>\n" +
        "  Read-only against the source DB. Writes a self-verifying, immutable\n" +
        "  candidate-snapshot artifact for scripts/eval/run-candidate-snapshot.ts\n" +
        "  to evaluate against later without ever touching the live DB again.\n",
    );
    process.exit(1);
  }

  const sourceDbHashAtExtraction = createHash("sha256").update(readFileSync(dbPath)).digest("hex");

  const db = new Database(dbPath, { readonly: true }) as Db;
  const normalizedPipelineOutputs = collectGeneratedCandidates(db, projectId, sessionId);

  // Read-only lookup of this exact session's own recorded generator model
  // — never asserted, always taken from the DB's own egress_log, same
  // convention as run-existing-session.ts. Baked into the snapshot so a
  // snapshot-based eval run never needs the generator identity passed in
  // by hand.
  const modelRow = db.prepare(`SELECT model FROM egress_log WHERE session_id = ? ORDER BY at ASC LIMIT 1`).get(sessionId) as
    | { model: string }
    | undefined;
  const sourceGeneratorModel = modelRow?.model ?? "unknown";
  const sourceGeneratorBackendLabel = sourceGeneratorModel.startsWith("hf:") ? "local" : "claude";

  db.close();

  const candidateContentSha256 = computeCandidateContentHash(normalizedPipelineOutputs);
  const snapshot = CandidateSnapshotSchema.parse({
    snapshotId: randomUUID(),
    fixtureName,
    sourceProjectId: projectId,
    sourceSessionId: sessionId,
    sourceDbHashAtExtraction,
    extractionTimestamp: new Date().toISOString(),
    sourceGeneratorBackendLabel,
    sourceGeneratorModel,
    candidateContentSha256,
    normalizedPipelineOutputs,
  });

  writeFileSync(out, JSON.stringify(snapshot, null, 2));
  const total = normalizedPipelineOutputs.requirements.length + normalizedPipelineOutputs.questions.length + normalizedPipelineOutputs.assumptionClaims.length;
  process.stdout.write(
    `Wrote candidate snapshot to ${out}\n` +
      `  ${total} candidates (${normalizedPipelineOutputs.requirements.length} req + ${normalizedPipelineOutputs.questions.length} q + ${normalizedPipelineOutputs.assumptionClaims.length} assumption)\n` +
      `  source: project=${projectId} session=${sessionId}\n` +
      `  source DB hash at extraction: ${sourceDbHashAtExtraction}\n` +
      `  generator: ${sourceGeneratorBackendLabel} / ${sourceGeneratorModel}\n`,
  );
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
