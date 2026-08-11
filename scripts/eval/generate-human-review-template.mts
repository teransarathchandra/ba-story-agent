// Generates the human review template — pure data transformation from an
// already-frozen gold fixture and candidate snapshot, ZERO LLM calls, ZERO
// pre-filled verdicts. Every reviewed/matches/evidenceFidelity field is
// left blank for a human to fill in manually.
//
//   npx tsx scripts/eval/generate-human-review-template.mts --fixture 06-salon-booking
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { loadGoldFixture, supportedItems } from "../../src/eval/gold-schema.js";
import { loadCandidateSnapshot } from "../../src/eval/candidate-snapshot.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const FIXTURE_NAME = arg("fixture");
if (!FIXTURE_NAME) {
  process.stderr.write("Usage: generate-human-review-template.mts --fixture <name>\n");
  process.exit(1);
}
const fixture = loadGoldFixture(`tests/fixtures/golden/${FIXTURE_NAME}.gold.json`);
const snapshot = loadCandidateSnapshot(`tests/fixtures/golden/${FIXTURE_NAME}.candidates-snapshot.json`);
const goldItems = supportedItems(fixture);
const allCandidates = [
  ...snapshot.normalizedPipelineOutputs.requirements,
  ...snapshot.normalizedPipelineOutputs.questions,
  ...snapshot.normalizedPipelineOutputs.assumptionClaims,
];

const template = {
  reviewTemplateVersion: "v1",
  fixtureName: FIXTURE_NAME,
  createdAt: new Date().toISOString(),
  provenance: {
    frozenMarkdownContentHash: fixture.frozenMarkdownContentHash,
    goldFixtureContentHash: createHash("sha256").update(JSON.stringify(fixture)).digest("hex"),
    candidateSnapshotId: snapshot.snapshotId,
    candidateContentSha256: snapshot.candidateContentSha256,
    sourceProjectId: snapshot.sourceProjectId,
    sourceSessionId: snapshot.sourceSessionId,
  },
  instructions:
    "For each gold item below, determine whether one or more generated candidates express an equivalent, partial, or contradicting relationship to it. Add an entry to that gold item's matches[] for each real relationship found (correspondence: equivalent | partial | contradicts; meetingStateViolation: true only if this gold item is meetingStateSensitive AND the candidate reflects the earlier/superseded state). Leave matches[] empty and set reviewed:true if nothing genuinely relates. Separately, for every generated candidate, set evidenceFidelity to pass or fail based on whether its own quote actually supports its own text, and set reviewed:true. Do not use any AI-generated suggestions to fill these in - this is the authoritative human review. unmatchedGoldIds/unmatchedGeneratedItemIds are derived automatically afterward from what you do and don't record here - never author them directly.",
  goldItems: goldItems.map((g) => ({
    goldId: g.id,
    category: g.category,
    proposition: g.proposition,
    quotes: g.quotes,
    ...(g.meetingStateSensitive ? { meetingStateSensitive: g.meetingStateSensitive } : {}),
    reviewed: false,
    matches: [] as { generatedItemId: string; correspondence: string; meetingStateViolation: boolean; reviewerNote: string }[],
    reviewerNote: "",
  })),
  generatedCandidates: allCandidates.map((c) => ({
    generatedItemId: c.id,
    bucket: c.bucket,
    text: c.text,
    quote: c.quote,
    reviewed: false,
    evidenceFidelity: null as "pass" | "fail" | null,
    reviewerNote: "",
  })),
};

const jsonPath = `tests/fixtures/human-review/${FIXTURE_NAME}.review-template-v1.json`;
writeFileSync(jsonPath, JSON.stringify(template, null, 2));
console.log(`Wrote ${jsonPath}`);
console.log(`  ${template.goldItems.length} gold items, ${template.generatedCandidates.length} candidates, all verdict fields empty.`);

// --- Human-readable Markdown companion ---
const categoryLabel: Record<string, string> = {
  requirement: "Requirement",
  rule: "Business Rule",
  unresolved: "Unresolved Decision",
  assumption: "Assumption",
};

let md = `# ${FIXTURE_NAME} — human semantic review template (v1)\n\n`;
md += `**Not yet reviewed.** Every verdict field below is blank. Fill in a correspondence/evidence decision for each item, then this file (or its JSON twin) becomes the input to freezing the authoritative human match map. Do not treat anything here as a decision until a human has actually filled it in.\n\n`;
md += `**Provenance:** gold fixture hash \`${template.provenance.goldFixtureContentHash.slice(0, 16)}...\`, candidate snapshot \`${template.provenance.candidateSnapshotId}\` (content hash \`${template.provenance.candidateContentSha256.slice(0, 16)}...\`), source session \`${template.provenance.sourceSessionId}\`.\n\n`;
md += `---\n\n## Part 1 — Gold items (${goldItems.length}): for each, which candidate(s) below correspond to it, if any?\n\n`;
md += `For every item: pick **equivalent**, **partial**, **contradicts** (name the candidate ID), or **no match**.\n\n`;

for (const g of goldItems) {
  md += `### ${g.id} — ${categoryLabel[g.category] ?? g.category}\n\n`;
  md += `**Proposition:** ${g.proposition}\n\n`;
  md += `**Quotes:**\n${g.quotes.map((q) => `- "${q}"`).join("\n")}\n\n`;
  if (g.meetingStateSensitive) {
    md += `**Meeting-state sensitive** — must NOT reflect: _${g.meetingStateSensitive.mustNotReflect}_; must reflect (final): _${g.meetingStateSensitive.mustReflect}_\n\n`;
  }
  md += `**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match\n`;
  md += `**Matched candidate ID(s):** _________________\n`;
  md += `**meetingStateViolation (if applicable):** ☐ true ☐ false\n`;
  md += `**Reviewer note:** _________________\n\n`;
  md += `---\n\n`;
}

md += `## Part 2 — Generated candidates (${allCandidates.length}): evidence fidelity\n\n`;
md += `For every candidate: does its own cited quote actually support its own text? **pass** or **fail**.\n\n`;

for (const c of allCandidates) {
  md += `### ${c.id} (${c.bucket})\n\n`;
  md += `**Text:** ${c.text}\n\n`;
  md += `**Quote:** ${c.quote ? `"${c.quote}"` : "_(none — question-bucket items are not required to carry a verbatim citation)_"}\n\n`;
  md += `**Evidence fidelity:** ☐ pass ☐ fail\n`;
  md += `**Reviewer note:** _________________\n\n`;
  md += `---\n\n`;
}

const mdPath = `tests/fixtures/human-review/${FIXTURE_NAME}.review-template-v1.md`;
writeFileSync(mdPath, md);
console.log(`Wrote ${mdPath}`);
