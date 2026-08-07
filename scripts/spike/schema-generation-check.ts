import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getLlama, resolveModelFile, LlamaChatSession } from "node-llama-cpp";
import type { z } from "zod/v4";
import { zodToGbnfSchema } from "../../src/llm/zod-to-gbnf.js";
import { ExtractedClaimsSchema } from "../../src/pipeline/stage1-extract.js";
import { ClassificationSchema } from "../../src/pipeline/stage3-classify.js";
import { ReconcileSchema } from "../../src/pipeline/stage4-reconcile.js";
import { RequirementDraftsSchema } from "../../src/pipeline/stage5-requirements.js";
import { StoryDraftsSchema } from "../../src/pipeline/stage6-stories.js";
import { CritiqueFindingsSchema } from "../../src/pipeline/stage7-critique.js";
import { EXTRACT_SYSTEM, buildExtractUser } from "../../src/prompts/extract.js";
import { CLASSIFY_SYSTEM, buildClassifyUser } from "../../src/prompts/classify.js";
import { RECONCILE_SYSTEM, buildReconcileUser } from "../../src/prompts/reconcile.js";
import { REQUIREMENTS_SYSTEM, buildRequirementsUser } from "../../src/prompts/requirements.js";
import { STORIES_SYSTEM, buildStoriesUser } from "../../src/prompts/stories.js";
import { REVIEWERS, buildCritiqueUser } from "../../src/prompts/critique.js";
import type { Window } from "../../src/pipeline/stage0-chunk.js";
import type { Claim, Requirement, Story, AcceptanceCriterion, Project, Segment } from "../../src/types/domain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_URI = "hf:bartowski/Qwen2.5-7B-Instruct-GGUF/Qwen2.5-7B-Instruct-Q4_K_M.gguf";

// Representative real input, not a synthetic toy prompt: the same fixture
// the adversarial suite already uses for its "clean" baseline.
const transcript = readFileSync(
  join(__dirname, "../../tests/fixtures/transcripts/05-clean-baseline.txt"),
  "utf8",
);

const now = new Date().toISOString();

const project: Project = {
  id: "spike-project", name: "Spike",
  domain: "warehouse order fulfilment and purchase approval for a logistics operator",
  regulatoryContext: "none", systemName: null, glossary: null,
  createdAt: now,
};

const segment: Segment = {
  id: "seg-1", transcriptId: "spike-transcript", idx: 0,
  startMs: null, endMs: null, speakerLabel: null,
  text: transcript, charStart: 0, charEnd: transcript.length,
};
const window: Window = { idx: 0, segments: [segment], text: transcript, charStart: 0 };

const sampleClaims: Claim[] = [
  {
    id: "clm-1", sessionId: "spike-session", transcriptId: "spike-transcript", segmentId: "seg-1",
    quote: "anything over ten thousand euro has to go to a manager",
    statement: "Invoices over EUR 10,000 require manager approval.",
    speakerRole: "client", kind: "requirement", status: "validated",
    charStart: 0, charEnd: 50, matchMode: "exact", createdAt: now,
  },
  {
    id: "clm-2", sessionId: "spike-session", transcriptId: "spike-transcript", segmentId: "seg-1",
    quote: "we'd usually be dealing in euro",
    statement: "Transactions are typically in EUR.",
    speakerRole: "client", kind: "assumption", status: "validated",
    charStart: 51, charEnd: 90, matchMode: "exact", createdAt: now,
  },
];

const sampleRequirements: Requirement[] = [
  {
    id: "req-1", projectId: "spike-project", key: "REQ-001",
    statement: "Invoices over EUR 10,000 must be routed to a manager for approval.",
    status: "proposed", origin: "client-stated", originClaimIds: ["clm-1"],
    supersedesId: null, createdAt: now,
  },
];

const sampleStories: { story: Story; criteria: AcceptanceCriterion[] }[] = [
  {
    story: {
      id: "story-1", projectId: "spike-project", key: "US-001",
      asA: "finance approver", iWant: "to review invoices over EUR 10,000",
      soThat: "large payments are authorized before they are sent",
      requirementIds: ["req-1"], createdAt: now,
    },
    criteria: [
      {
        id: "ac-1", storyId: "story-1", idx: 0,
        gherkin: "Given an invoice of EUR 10,001, when submitted, then it is routed to the manager queue",
        source: "client-stated", linkedQuestionId: null,
      },
    ],
  },
];

async function main() {
  console.log(`Resolving model (downloads on first run — this can take a while): ${MODEL_URI}`);
  const modelPath = await resolveModelFile(MODEL_URI, { cli: true });

  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext();
  const sequence = context.getSequence();

  // One representative check per schema. This is a compatibility/quality
  // spike, not the adversarial suite — one prompt per schema is enough to
  // learn whether grammar-constrained generation round-trips through each
  // schema shape at all.
  const checks: { name: string; schema: z.ZodType; system: string; user: string }[] = [
    { name: "ExtractedClaimsSchema", schema: ExtractedClaimsSchema, system: EXTRACT_SYSTEM, user: buildExtractUser(window, project) },
    { name: "ClassificationSchema", schema: ClassificationSchema, system: CLASSIFY_SYSTEM, user: buildClassifyUser(sampleClaims, project) },
    { name: "ReconcileSchema", schema: ReconcileSchema, system: RECONCILE_SYSTEM, user: buildReconcileUser(sampleClaims, sampleRequirements, project) },
    { name: "RequirementDraftsSchema", schema: RequirementDraftsSchema, system: REQUIREMENTS_SYSTEM, user: buildRequirementsUser(sampleClaims, project) },
    { name: "StoryDraftsSchema", schema: StoryDraftsSchema, system: STORIES_SYSTEM, user: buildStoriesUser(sampleRequirements, project) },
    {
      name: "CritiqueFindingsSchema",
      schema: CritiqueFindingsSchema,
      // REVIEWERS[0] is the "domain" reviewer — representative of all four;
      // they share CritiqueFindingsSchema, only the system prompt differs.
      system: REVIEWERS[0]!.system({ regulatoryContext: project.regulatoryContext }),
      user: buildCritiqueUser(project, sampleRequirements, sampleStories),
    },
  ];

  for (const { name, schema, system, user } of checks) {
    const gbnf = zodToGbnfSchema(schema);
    const grammar = await llama.createGrammarForJsonSchema(gbnf);
    const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: system });

    const raw = await session.prompt(user, { grammar, maxTokens: context.contextSize });

    let grammarParseOk = true;
    let parsed: unknown = null;
    try {
      parsed = grammar.parse(raw);
    } catch (err) {
      grammarParseOk = false;
      console.log(`${name}: grammar.parse FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }

    if (grammarParseOk) {
      const result = schema.safeParse(parsed);
      console.log(`${name}: grammar.parse OK, zod safeParse ${result.success ? "OK" : "FAILED"}`);
      if (!result.success) console.log(`  zod error: ${result.error.message}`);
    }
    console.log(`${name}: raw output (first 500 chars): ${raw.slice(0, 500)}`);
    console.log("---");
  }

  await context.dispose();
  await model.dispose();
}

main();
