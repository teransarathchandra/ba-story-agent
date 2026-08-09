/**
 * Live pipeline evaluation against the adversarial fixtures.
 *
 * This makes real calls (Claude API, and/or local inference) and the Claude
 * path costs money, so it is not part of `npm test`. Run it before any model
 * version change.
 *
 *   ANTHROPIC_API_KEY=... npm run eval:live                    # Claude only (default)
 *   LLM_BACKENDS=local npm run eval:live                       # local only
 *   ANTHROPIC_API_KEY=... LLM_BACKENDS=claude,local npm run eval:live  # both, compared
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/store/db.js";
import { createProject, createSession } from "../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../src/store/transcripts.js";
import { createClient, AnthropicBackend } from "../src/llm/client.js";
import { loadLocalBackend } from "../src/llm/local-client.js";
import type { LlmBackend } from "../src/llm/backend.js";
import { analyzeSession, quarantineRate } from "../src/pipeline/index.js";
import { listRequirements } from "../src/store/artifacts.js";
import { listQuestions } from "../src/store/findings.js";
import { listProjectClaims } from "../src/store/claims.js";
import { listLinks } from "../src/store/links.js";
import { loadGoldFixture } from "../src/eval/gold-schema.js";
import { runGoldEval, persistArtifact } from "./eval/gold-match.js";
import { printGoldEvalReport } from "./eval/gold-report.js";

interface Expectation {
  mustNotContainRequirementMatching?: string[];
  mustContainRequirementMatching?: string[];
  mustContainQuestionMatching?: string[];
  minContradictions?: number;
  mustNotAutoResolve?: boolean;
  maxRequirements?: number;
  maxStories?: number;
  minRequirements?: number;
  minAssumptions?: number;
  maxQuarantineRate?: number;
  hallucinationRate?: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../tests/fixtures/transcripts");
const expectations = JSON.parse(
  readFileSync(join(here, "../tests/fixtures/golden/expectations.json"), "utf8"),
) as Record<string, Expectation>;

// Comma-separated list of backends to run this eval pass against. Defaults to
// "claude" only, so existing zero-config `npm run eval:live` usage never
// triggers a multi-GB local model download it didn't ask for.
const requestedBackends = (process.env.LLM_BACKENDS ?? "claude").split(",").map((b) => b.trim());

interface FixtureResult {
  backendLabel: string;
  fixture: string;
  passed: number;
  failed: number;
}

const results: FixtureResult[] = [];

function check(name: string, label: string, ok: boolean, detail = ""): boolean {
  if (ok) {
    process.stdout.write(`  PASS  ${label}\n`);
  } else {
    process.stdout.write(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}\n`);
  }
  return ok;
}

async function runAgainstBackend(backendLabel: string, client: LlmBackend): Promise<void> {
  for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith(".txt"))) {
    const name = file.replace(/\.txt$/, "");
    const goldPath = join(here, "../tests/fixtures/golden", `${name}.gold.json`);

    // Gold-fixture path (design doc: docs/superpowers/specs/2026-08-09-gold-eval-harness-design.md)
    // is mutually exclusive with the regex-Expectation path below — a
    // fixture gets ONE or the other, never both. The 5 original fixtures
    // have no .gold.json and are completely untouched by this branch.
    if (existsSync(goldPath)) {
      process.stdout.write(`\n[${backendLabel}] ${name} (gold-fixture eval)\n`);

      const fixture = loadGoldFixture(goldPath);
      const db = openDb(":memory:");
      const project = createProject(db, {
        name,
        domain: "appointment booking and management for a multi-branch beauty salon",
      });
      const session = createSession(db, { projectId: project.id, title: name });
      const { transcript } = createTranscript(db, {
        sessionId: session.id,
        text: readFileSync(join(fixturesDir, file), "utf8"),
      });
      freezeTranscript(db, transcript.id);

      await analyzeSession({ db, client, projectId: project.id, sessionId: session.id }, transcript.id);

      const artifact = await runGoldEval({
        fixture,
        generator: { backendLabel, model: client.model },
        db,
        projectId: project.id,
        sessionId: session.id,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      });
      const artifactPath = persistArtifact(artifact);
      printGoldEvalReport(artifact, artifactPath);
      continue;
    }

    const exp = expectations[name];
    if (!exp) continue;

    process.stdout.write(`\n[${backendLabel}] ${name}\n`);

    const db = openDb(":memory:");
    const project = createProject(db, {
      name,
      domain: "warehouse order fulfilment and purchase approval for a logistics operator",
    });
    const session = createSession(db, { projectId: project.id, title: name });
    const { transcript } = createTranscript(db, {
      sessionId: session.id,
      text: readFileSync(join(fixturesDir, file), "utf8"),
    });
    freezeTranscript(db, transcript.id);

    const state = await analyzeSession({ db, client, projectId: project.id, sessionId: session.id }, transcript.id);

    const reqs = listRequirements(db, project.id).map((r) => r.statement.toLowerCase());
    const questions = listQuestions(db, project.id).map((q) => q.text.toLowerCase());
    const assumptions = listProjectClaims(db, project.id, { status: "validated", kind: "assumption" });

    let passed = 0;
    let failed = 0;
    const record = (ok: boolean) => (ok ? passed++ : failed++);

    for (const pattern of exp.mustNotContainRequirementMatching ?? []) {
      const re = new RegExp(pattern, "i");
      const hit = reqs.find((r) => re.test(r));
      record(check(name, `no requirement matching /${pattern}/`, !hit, hit));
    }
    for (const pattern of exp.mustContainRequirementMatching ?? []) {
      const re = new RegExp(pattern, "i");
      record(check(name, `a requirement matching /${pattern}/`, reqs.some((r) => re.test(r))));
    }
    for (const pattern of exp.mustContainQuestionMatching ?? []) {
      const re = new RegExp(pattern, "i");
      record(check(name, `a question matching /${pattern}/`, questions.some((q) => re.test(q))));
    }
    if (exp.maxRequirements !== undefined) {
      record(check(name, `at most ${exp.maxRequirements} requirements`, reqs.length <= exp.maxRequirements, `got ${reqs.length}`));
    }
    if (exp.minRequirements !== undefined) {
      record(check(name, `at least ${exp.minRequirements} requirements`, reqs.length >= exp.minRequirements, `got ${reqs.length}`));
    }
    if (exp.minAssumptions !== undefined) {
      record(check(name, `at least ${exp.minAssumptions} assumptions`, assumptions.length >= exp.minAssumptions, `got ${assumptions.length}`));
    }
    if (exp.maxQuarantineRate !== undefined) {
      const rate = quarantineRate(state);
      record(check(name, `quarantine rate <= ${exp.maxQuarantineRate}`, rate <= exp.maxQuarantineRate, rate.toFixed(3)));
    }
    if (exp.minContradictions !== undefined) {
      const contradictionLinks = listLinks(db, project.id).filter((l) => l.linkKind === "contradicts");
      record(
        check(
          name,
          `at least ${exp.minContradictions} contradiction(s) detected`,
          contradictionLinks.length >= exp.minContradictions,
          `got ${contradictionLinks.length}`,
        ),
      );
    }
    if (exp.mustNotAutoResolve) {
      // `questions` (built above for mustContainQuestionMatching) isn't
      // status-filtered, so this re-queries with status: "open" — the point
      // of this check is specifically that a matching question is still open,
      // not merely that one was ever raised.
      const openQuestionTexts = listQuestions(db, project.id, { status: "open" }).map((q) => q.text.toLowerCase());
      const stillOpen = (exp.mustContainQuestionMatching ?? []).some((p) => {
        const re = new RegExp(p, "i");
        return openQuestionTexts.some((t) => re.test(t));
      });
      record(check(name, "matched question(s) remain open, not auto-resolved", stillOpen));
    }
    if (exp.hallucinationRate !== undefined) {
      // Same underlying metric as maxQuarantineRate above (quarantineRate()),
      // checked at a tighter/different tolerance — not a separately invented
      // "hallucination" signal. See Task 8 in the plan.
      const rate = quarantineRate(state);
      record(
        check(
          name,
          `hallucination rate <= ${exp.hallucinationRate} (same metric as quarantine rate, checked at a tighter tolerance — see Task 8 in the plan)`,
          rate <= exp.hallucinationRate,
          rate.toFixed(3),
        ),
      );
    }

    results.push({ backendLabel, fixture: name, passed, failed });
  }
}

async function main() {
  for (const backendLabel of requestedBackends) {
    if (backendLabel === "claude") {
      await runAgainstBackend("claude", new AnthropicBackend(createClient()));
    } else if (backendLabel === "local") {
      const { backend, release } = await loadLocalBackend({ log: (line) => process.stdout.write(`${line}\n`) });
      try {
        await runAgainstBackend("local", backend);
      } finally {
        await release();
      }
    } else {
      throw new Error(`unknown LLM_BACKENDS entry "${backendLabel}" — expected "claude" or "local"`);
    }
  }

  process.stdout.write("\n\n=== Comparison ===\n");
  process.stdout.write(`${"fixture".padEnd(24)}${requestedBackends.map((b) => b.padEnd(16)).join("")}\n`);
  const fixtureNames = [...new Set(results.map((r) => r.fixture))];
  for (const fixture of fixtureNames) {
    const row = requestedBackends
      .map((b) => {
        const r = results.find((x) => x.fixture === fixture && x.backendLabel === b);
        return r ? `${r.passed}/${r.passed + r.failed}`.padEnd(16) : "—".padEnd(16);
      })
      .join("");
    process.stdout.write(`${fixture.padEnd(24)}${row}\n`);
  }

  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  process.stdout.write(`\n${totalFailed === 0 ? "All eval checks passed." : `${totalFailed} eval check(s) FAILED across all requested backends.`}\n`);
  // Non-zero exit only reflects the CLAUDE pass, if requested, per the design
  // spec's decision that local is judged by a disclosed comparison, not a
  // pass/fail gate — a local shortfall alone should not fail CI-adjacent runs.
  const claudeFailed = results.filter((r) => r.backendLabel === "claude").reduce((sum, r) => sum + r.failed, 0);
  process.exitCode = claudeFailed === 0 ? 0 : 1;
}

main();
