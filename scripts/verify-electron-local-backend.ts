// scripts/verify-electron-local-backend.ts
/**
 * Verifies real local-model inference + the analyzeSession pipeline work
 * end-to-end against the actual cached local model — real model, real
 * transcript, real DB writes, no mocks. Not part of `npm test` (multi-minute,
 * uses real local compute) — same category as scripts/run-live-eval.ts.
 *
 * Scope, stated precisely: this proves loadLocalBackend() + analyzeSession()
 * genuinely produce real, non-empty output together. It does NOT exercise
 * electron/src/main/ipc.ts's own dispatch logic (selectBackend(), the real
 * session:analyze handler) — 'electron' cannot be meaningfully imported
 * outside a real launched Electron process, so a plain script like this one
 * structurally cannot invoke that code path directly. That half of the claim
 * — that Electron's IPC layer correctly dispatches to whichever backend a
 * project's llmBackend setting selects — is covered separately by
 * electron/tests/main/ipc.test.ts, which captures and invokes the REAL
 * session:analyze handler (via a mocked 'electron' module, which vitest CAN
 * do) with a MOCKED backend/pipeline. Together: ipc.test.ts proves the
 * wiring is correct; this script proves the backend it wires to actually
 * works. Neither alone proves the full chain — read them as a pair.
 *
 *   npx tsx scripts/verify-electron-local-backend.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/store/db.js";
import { createProject, createSession } from "../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../src/store/transcripts.js";
import { loadLocalBackend } from "../src/llm/local-client.js";
import { analyzeSession, quarantineRate } from "../src/pipeline/index.js";
import { listRequirements } from "../src/store/artifacts.js";

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("Loading local backend (model already cached from the compatibility spike)...");
  const { backend, release } = await loadLocalBackend({
    log: (line) => console.log(`  [local model] ${line}`),
  });

  try {
    const db = openDb(":memory:");
    const project = createProject(db, {
      name: "Electron local-backend verification",
      domain: "warehouse order fulfilment and purchase approval for a logistics operator",
      llmBackend: "local",
    });
    const session = createSession(db, { projectId: project.id, title: "Verification session" });
    const { transcript } = createTranscript(db, {
      sessionId: session.id,
      text: readFileSync(join(here, "../tests/fixtures/transcripts/05-clean-baseline.txt"), "utf8"),
    });
    freezeTranscript(db, transcript.id);

    console.log("Running analyzeSession against the real local model — this will take real time...");
    const start = Date.now();
    const state = await analyzeSession(
      { db, client: backend, projectId: project.id, sessionId: session.id },
      transcript.id,
      { onProgress: (name, status) => console.log(`  [${status.padEnd(8)}] ${name}`) },
    );
    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

    const reqs = listRequirements(db, project.id);
    console.log(`\nCompleted in ${elapsedSec}s.`);
    console.log(`Extracted: ${state.extracted}, Validated: ${state.validated}, Quarantined: ${state.quarantined} (${(quarantineRate(state) * 100).toFixed(1)}%)`);
    console.log(`Requirements: ${reqs.length}`);
    for (const r of reqs) console.log(`  - ${r.statement}`);

    if (reqs.length === 0) {
      console.log("\nFAIL: zero requirements produced from a transcript with known extractable content.");
      process.exitCode = 1;
    } else {
      console.log(
        "\nPASS: real local-model inference and the analyzeSession pipeline produce real, " +
        "non-empty output. (Electron's IPC dispatch logic itself is verified separately by " +
        "electron/tests/main/ipc.test.ts.)",
      );
    }
  } finally {
    await release();
  }
}

main();
