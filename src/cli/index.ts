import { Command, CommanderError } from "commander";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../store/db.js";
import { createProject, createSession, getProject, listSessions } from "../store/projects.js";
import { createTranscript, freezeTranscript, getFrozenTranscript } from "../store/transcripts.js";
import { countByStatus } from "../store/claims.js";
import { listRequirements, listStories } from "../store/artifacts.js";
import { listQuestions, listRecommendations } from "../store/findings.js";
import { createClient, AnthropicBackend } from "../llm/client.js";
import { loadLocalBackend } from "../llm/local-client.js";
import type { LlmBackend } from "../llm/backend.js";
import { analyzeSession, quarantineRate } from "../pipeline/index.js";
import { countWords, MIN_WORDS } from "../pipeline/stage0-chunk.js";
import { buildSnapshot } from "../export/snapshot.js";
import { jsonPublisher } from "../export/json.js";
import { markdownPublisher } from "../export/markdown.js";
import { recordApproval } from "../store/audit.js";
import { setRequirementStatus } from "../store/artifacts.js";
import { hashText } from "../store/transcripts.js";
import { RegulatoryContext, LlmBackendSetting } from "../types/domain.js";

type Log = (line: string) => void;

async function selectBackend(
  llmBackend: "claude" | "local",
  log: Log,
): Promise<{ client: LlmBackend; release: () => Promise<void> }> {
  if (llmBackend === "local") {
    const { backend, release } = await loadLocalBackend({ log });
    return { client: backend, release };
  }
  return { client: new AnthropicBackend(createClient()), release: async () => {} };
}

export function buildProgram(opts?: { log?: Log }): Command {
  const log: Log = opts?.log ?? ((s) => process.stdout.write(`${s}\n`));
  const program = new Command();

  program
    .name("bsa")
    .description("BA Story Agent — turn client discussions into traceable requirements")
    .option("--db <path>", "SQLite database path", "./ba-story-agent.db")
    .exitOverride(); // throw instead of process.exit, so tests can assert

  const dbPath = (cmd: Command): string =>
    (cmd.optsWithGlobals() as { db: string }).db;

  const project = program.command("project").description("manage projects");

  project
    .command("create")
    .requiredOption("--name <name>")
    .requiredOption("--domain <domain>", "one-line description of the business domain")
    .option("--regulatory <context>", "none | GDPR | HIPAA | PCI-DSS | SOC2", "none")
    .option("--system-name <name>")
    .option("--glossary-file <path>")
    .option("--llm-backend <backend>", "claude | local", "claude")
    .action(function (this: Command, o: {
      name: string; domain: string; regulatory: string;
      systemName?: string; glossaryFile?: string; llmBackend: string;
    }) {
      const db = openDb(dbPath(this));
      const regulatory = RegulatoryContext.parse(o.regulatory);
      const llmBackend = LlmBackendSetting.parse(o.llmBackend);
      const p = createProject(db, {
        name: o.name,
        domain: o.domain,
        regulatoryContext: regulatory,
        systemName: o.systemName ?? null,
        glossary: o.glossaryFile ? readFileSync(o.glossaryFile, "utf8") : null,
        llmBackend,
      });
      log(`Created project ${p.id}`);
      log(`  name:        ${p.name}`);
      log(`  domain:      ${p.domain}`);
      log(`  llmBackend:  ${p.llmBackend}`);
    });

  const session = program.command("session").description("manage sessions");

  session
    .command("add")
    .requiredOption("--project <id>")
    .requiredOption("--title <title>")
    .requiredOption("--file <path>", "transcript or notes, plain text")
    .option("--occurred-at <iso>")
    .action(function (this: Command, o: { project: string; title: string; file: string; occurredAt?: string }) {
      const db = openDb(dbPath(this));
      const text = readFileSync(o.file, "utf8");
      const words = countWords(text);
      if (words < MIN_WORDS) {
        throw new Error(
          `input is ${words} words; at least ${MIN_WORDS} words are required. ` +
            `Below this, extraction produces noise rather than requirements.`,
        );
      }
      const s = createSession(db, {
        projectId: o.project,
        title: o.title,
        ...(o.occurredAt ? { occurredAt: o.occurredAt } : {}),
      });
      const { transcript } = createTranscript(db, { sessionId: s.id, text });
      freezeTranscript(db, transcript.id);
      log(`Created session ${s.id} (${words} words, transcript ${transcript.id} frozen)`);
    });

  program
    .command("analyze")
    .requiredOption("--session <id>")
    .option("--resume", "skip stages already completed", false)
    .action(async function (this: Command, o: { session: string; resume: boolean }) {
      const db = openDb(dbPath(this));
      const frozen = getFrozenTranscript(db, o.session);
      if (!frozen) throw new Error(`session ${o.session} has no frozen transcript`);
      const row = db
        .prepare("SELECT project_id FROM sessions WHERE id = ?")
        .get(o.session) as { project_id: string } | undefined;
      if (!row) throw new Error(`session ${o.session} not found`);
      const project = getProject(db, row.project_id);
      if (!project) throw new Error(`project ${row.project_id} not found`);

      const { client, release } = await selectBackend(project.llmBackend, log);
      try {
        const state = await analyzeSession(
          { db, client, projectId: row.project_id, sessionId: o.session },
          frozen.transcript.id,
          {
            resume: o.resume,
            onProgress: (name, status) => log(`  [${status.padEnd(8)}] ${name}`),
          },
        );

        log("");
        log(`Extracted:      ${state.extracted}`);
        log(`Validated:      ${state.validated}`);
        log(`Quarantined:    ${state.quarantined} (${(quarantineRate(state) * 100).toFixed(1)}%)`);
        log(`Requirements:   ${state.requirements}`);
        log(`Stories:        ${state.stories}`);
        log(`Open questions: ${state.questions}`);
        log(`Recommendations:${state.recommendations}`);
        if (state.extracted === 0) {
          log("");
          log("No requirements were found in this transcript.");
        }
      } finally {
        await release();
      }
    });

  program
    .command("approve")
    .description("approve a proposed requirement, moving it into the baseline")
    .requiredOption("--requirement <key>", "requirement key, e.g. REQ-001")
    .requiredOption("--project <id>")
    .option("--note <text>", "how this was verified, if relevant")
    .action(function (this: Command, o: { requirement: string; project: string; note?: string }) {
      const db = openDb(dbPath(this));
      const req = listRequirements(db, o.project).find((r) => r.key === o.requirement);
      if (!req) throw new Error(`requirement ${o.requirement} not found in project ${o.project}`);
      // Approval attaches to CONTENT, not to a row id: if the statement is
      // later edited, this hash no longer matches and the requirement drops
      // out of the baseline until it is approved again.
      recordApproval(db, {
        entityType: "requirement",
        entityId: req.id,
        action: "approve",
        actorNote: o.note ?? null,
        contentHash: hashText(req.statement),
      });
      setRequirementStatus(db, req.id, "finalized");
      log(`Approved ${req.key}: ${req.statement}`);
    });

  program
    .command("export")
    .requiredOption("--project <id>")
    .requiredOption("--out <dir>")
    .option(
      "--include-proposed",
      "also export requirements the BA has not approved, marked NOT YET APPROVED",
      false,
    )
    .action(function (this: Command, o: { project: string; out: string; includeProposed: boolean }) {
      const db = openDb(dbPath(this));
      const snapshot = buildSnapshot(db, o.project, { includeProposed: o.includeProposed });
      mkdirSync(o.out, { recursive: true });
      const mdPath = join(o.out, "requirements.md");
      const jsonPath = join(o.out, "requirements.json");
      writeFileSync(mdPath, markdownPublisher.publish(snapshot), "utf8");
      writeFileSync(jsonPath, jsonPublisher.publish(snapshot), "utf8");
      log(`Wrote ${mdPath}`);
      log(`Wrote ${jsonPath}`);
    });

  program
    .command("status")
    .requiredOption("--project <id>")
    .action(function (this: Command, o: { project: string }) {
      const db = openDb(dbPath(this));
      const p = getProject(db, o.project);
      if (!p) throw new Error(`project ${o.project} not found`);
      const sessions = listSessions(db, o.project);
      log(`Project: ${p.name} (${p.domain})`);
      log(`Sessions: ${sessions.length}`);
      for (const s of sessions) {
        const counts = countByStatus(db, s.id);
        log(`  ${s.title} — ${s.status} — claims: ${JSON.stringify(counts)}`);
      }
      log(`Requirements:    ${listRequirements(db, o.project).length}`);
      log(`Stories:         ${listStories(db, o.project).length}`);
      log(`Open questions:  ${listQuestions(db, o.project, { status: "open" }).length}`);
      log(`Recommendations: ${listRecommendations(db, o.project).length}`);
    });

  return program;
}

/**
 * Classify a thrown value from parseAsync() into a message (or null for a
 * benign display) and an exit code. commander's exitOverride() throws a
 * CommanderError even for --help/--version, which should exit 0 silently
 * rather than being reported as a failure.
 */
export function classifyCliError(err: unknown): { message: string | null; exitCode: number } {
  if (err instanceof CommanderError) {
    if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
      return { message: null, exitCode: err.exitCode };
    }
    return { message: err.message, exitCode: err.exitCode };
  }
  if (err instanceof Error) {
    return { message: err.message, exitCode: 1 };
  }
  return { message: String(err), exitCode: 1 };
}

// Only run when invoked directly, not when imported by tests.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  buildProgram()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      const { message, exitCode } = classifyCliError(err);
      if (message !== null) process.stderr.write(`${message}\n`);
      process.exitCode = exitCode;
    });
}
