/**
 * Live pipeline evaluation against the adversarial fixtures.
 *
 * This makes real API calls and costs money, so it is not part of `npm test`.
 * Run it before any model version change — model upgrades are the most likely
 * source of a silent quality regression.
 *
 *   ANTHROPIC_API_KEY=... npm run eval:live
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/store/db.js";
import { createProject, createSession } from "../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../src/store/transcripts.js";
import { createClient } from "../src/llm/client.js";
import { analyzeSession, quarantineRate } from "../src/pipeline/index.js";
import { listRequirements } from "../src/store/artifacts.js";
import { listQuestions } from "../src/store/findings.js";
import { listProjectClaims } from "../src/store/claims.js";
import { listLinks } from "../src/store/links.js";

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

let failures = 0;

function check(name: string, label: string, ok: boolean, detail = ""): void {
  if (ok) {
    process.stdout.write(`  PASS  ${label}\n`);
  } else {
    failures++;
    process.stdout.write(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}\n`);
  }
}

for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith(".txt"))) {
  const name = file.replace(/\.txt$/, "");
  const exp = expectations[name];
  if (!exp) continue;

  process.stdout.write(`\n${name}\n`);

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

  const state = await analyzeSession(
    { db, client: createClient(), projectId: project.id, sessionId: session.id },
    transcript.id,
  );

  const reqs = listRequirements(db, project.id).map((r) => r.statement.toLowerCase());
  const questions = listQuestions(db, project.id).map((q) => q.text.toLowerCase());
  const assumptions = listProjectClaims(db, project.id, { status: "validated", kind: "assumption" });

  for (const pattern of exp.mustNotContainRequirementMatching ?? []) {
    const re = new RegExp(pattern, "i");
    const hit = reqs.find((r) => re.test(r));
    check(name, `no requirement matching /${pattern}/`, !hit, hit);
  }
  for (const pattern of exp.mustContainRequirementMatching ?? []) {
    const re = new RegExp(pattern, "i");
    check(name, `a requirement matching /${pattern}/`, reqs.some((r) => re.test(r)));
  }
  for (const pattern of exp.mustContainQuestionMatching ?? []) {
    const re = new RegExp(pattern, "i");
    check(name, `a question matching /${pattern}/`, questions.some((q) => re.test(q)));
  }
  if (exp.maxRequirements !== undefined) {
    check(name, `at most ${exp.maxRequirements} requirements`, reqs.length <= exp.maxRequirements, `got ${reqs.length}`);
  }
  if (exp.minRequirements !== undefined) {
    check(name, `at least ${exp.minRequirements} requirements`, reqs.length >= exp.minRequirements, `got ${reqs.length}`);
  }
  if (exp.minAssumptions !== undefined) {
    check(name, `at least ${exp.minAssumptions} assumptions`, assumptions.length >= exp.minAssumptions, `got ${assumptions.length}`);
  }
  if (exp.maxQuarantineRate !== undefined) {
    const rate = quarantineRate(state);
    check(name, `quarantine rate <= ${exp.maxQuarantineRate}`, rate <= exp.maxQuarantineRate, rate.toFixed(3));
  }
  if (exp.minContradictions !== undefined) {
    const contradictionLinks = listLinks(db, project.id).filter((l) => l.linkKind === "contradicts");
    check(
      name,
      `at least ${exp.minContradictions} contradiction(s) detected`,
      contradictionLinks.length >= exp.minContradictions,
      `got ${contradictionLinks.length}`,
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
    check(name, "matched question(s) remain open, not auto-resolved", stillOpen);
  }
  if (exp.hallucinationRate !== undefined) {
    // Same underlying metric as maxQuarantineRate above (quarantineRate()),
    // checked at a tighter/different tolerance — not a separately invented
    // "hallucination" signal. See Task 8 in the plan.
    const rate = quarantineRate(state);
    check(
      name,
      `hallucination rate <= ${exp.hallucinationRate} (same metric as quarantine rate, checked at a tighter tolerance — see Task 8 in the plan)`,
      rate <= exp.hallucinationRate,
      rate.toFixed(3),
    );
  }
}

process.stdout.write(`\n${failures === 0 ? "All eval checks passed." : `${failures} eval check(s) FAILED.`}\n`);
process.exitCode = failures === 0 ? 0 : 1;
