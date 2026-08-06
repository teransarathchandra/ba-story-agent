# Local LLM Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully in-process, opt-in local LLM backend (via `node-llama-cpp`) alongside the existing Claude API backend, selected once per project, with zero changes to the 9 pipeline stage files.

**Architecture:** Introduce an `LlmBackend` interface behind `callTyped()` (the single chokepoint every LLM-calling stage already goes through) with two implementations — `AnthropicBackend` (refactored from the existing code, behavior-preserving) and `LocalBackend` (new, `node-llama-cpp`-based, GBNF-grammar-constrained). A compatibility spike (Tasks 1–3) runs first and is a go/no-go gate: it empirically verifies the six production Zod schemas convert to node-llama-cpp's grammar format and measures real CPU-only throughput, before any backend-abstraction code is written.

**Tech Stack:** TypeScript (Node 22, ESM/NodeNext), `node-llama-cpp` (in-process GGUF inference), Zod v4 (`zod/v4` subpath — already bundled in the installed `zod@3.25.76`), vitest, better-sqlite3.

## Global Constraints

- Node 22, TypeScript strict + `noUncheckedIndexedAccess`, ESM/NodeNext — relative imports need `.js` extensions.
- Zod imports MUST be from `zod/v4`, not bare `"zod"` (the installed `zod@3.25.76` resolves bare imports to v3; `zodOutputFormat` and `z.toJSONSchema` both require v4). This has caused two Criticals in this codebase before — do not "clean up" these import paths.
- `npm test` and `npx tsc --noEmit` must both be clean before every commit in every task.
- None of `src/pipeline/stage0-chunk.ts` through `src/pipeline/stage8-assemble.ts` (9 files) may be modified by this plan. If any task's diff touches one of them, stop and reconsider — the whole point of the `LlmBackend` abstraction is that it doesn't need to.
- Claude stays the default backend (`llmBackend: "claude"`); local is opt-in. No task in this plan changes that default.
- No automatic fallback between backends on failure, in either direction. A backend that never produces schema-conforming output after retries throws `StageFailure` — exactly like today.
- The six production schemas (`ExtractedClaimsSchema`, `ClassificationSchema`, `ReconcileSchema`, `RequirementDraftsSchema`, `StoryDraftsSchema`, `CritiqueFindingsSchema`) must not change shape for the Claude path. If the Task 1–2 spike finds one needs a local-only reshape, that is scoped as a follow-up decision recorded in the findings doc, not silently done inline.
- Before trusting any library API fact not already verified in this plan's task text (e.g. if a task turns out to need an API call this plan didn't anticipate), verify it against the actually-installed package (`node_modules`) or its actual `.d.ts` files — not from memory. This plan itself was written that way; two library "facts" assumed from general knowledge (that node-llama-cpp consumes standard JSON Schema, and Zod v4's JSON-Schema-conversion availability in this exact installed version) turned out to need correction after checking the real, installed code — see Task 1 and Task 5 for what was actually found.

---

## Phase 0 — Compatibility Spike (go/no-go gate)

Everything in Phase 1 onward assumes the six production schemas can be represented in node-llama-cpp's grammar format and that CPU-only throughput is usable. Tasks 1–3 verify both, empirically, before any of that code exists.

### Task 1: Zod→GBNF schema translator + static grammar-construction check

**Files:**
- Create: `src/llm/zod-to-gbnf.ts`
- Create: `tests/llm/zod-to-gbnf.test.ts`
- Create: `scripts/spike/schema-grammar-check.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `zodToGbnfSchema(schema: z.ZodType): GbnfJsonSchema` — the production Zod→grammar-schema translator. `GbnfJsonSchema` is exported by `node-llama-cpp`. Consumed later by Task 5's `local-client.ts` and by this task's own spike script.

**Background (verified empirically before writing this task — do not re-derive from memory):**

node-llama-cpp does **not** consume standard JSON Schema. `llama.createGrammarForJsonSchema()` takes its own restricted `GbnfJsonSchema` type (`node_modules/node-llama-cpp`'s `dist/utils/gbnfJson/types.d.ts`, once installed). Real, checked constraints of that type, relevant to our six schemas:
- `required` is ignored — "required is always set to all keys in properties" (deprecated field, kept only for backward compat). None of our six schemas use `.optional()` (verified by grepping all six files), so this is a non-issue for us, not a gap to work around.
- No numeric `minimum`/`maximum` exist in the type at all — moot here, since none of our six schemas use `z.number()`.
- No regex `pattern` support (only `minLength`/`maxLength` on strings, and a fixed `format: "date-time"|"time"|"date"` enum) — moot here too, since none of our six schemas use `.regex()`/`.email()`/`.uuid()`.
- `$ref`/`$defs` are supported but easy to avoid. Zod v4's own `toJSONSchema()` (verified against the actually-installed `zod@3.25.76`'s `zod/v4` subpath — it exports `toJSONSchema`, confirmed via `node_modules/zod/v4/classic/external.d.ts`) does not emit `$ref` for any of our six schemas either, since none of them share a subschema through a registry. **The translator below never emits `$ref`/`$defs` — it always inlines** — which sidesteps the entire class of nested-`$ref` GBNF bugs the earlier research (see the design spec, §7.1) flagged as a risk, for these six schemas specifically.
- `.nullable()` (used once, in `StoryDraftsSchema`'s `question` field) needs translating: Zod's `toJSONSchema()` renders it as `{"anyOf": [{"type": "string"}, {"type": "null"}]}` (verified by running `z.toJSONSchema()` against a local test schema with the actually-installed package), but `GbnfJsonBasicSchema.type` directly accepts `string | readonly string[]`, so the translator's job is to convert that pattern into `{type: ["string", "null"]}` directly — no `anyOf`/`oneOf` needed for this case.

Given this, the translator is written as a **direct Zod-introspection walker** (using Zod v4's public `.def` property — verified as a real typed field, not an internal/private one, via `node_modules/zod/v4/core/schemas.d.ts`), not via Zod's `toJSONSchema()` as an intermediate step. This gives full control and fails loudly on anything the six schemas don't actually use, rather than silently mis-converting a future schema change.

- [ ] **Step 1: Confirm current library versions before installing**

Run: `npm view node-llama-cpp version`

This plan was written against `node-llama-cpp@3.19.1` (Node engine requirement `>=20.0.0`, compatible with this project's Node 22 floor). If a newer version has shipped since, use it, but re-check anything in this task and Task 5 that cites a specific `.d.ts` shape against the version you actually install — don't assume this plan's citations still hold verbatim.

- [ ] **Step 2: Install the dependency**

Run: `npm install node-llama-cpp@3.19.1` (or whatever current version Step 1 found)

- [ ] **Step 3: Write the failing test**

```typescript
// tests/llm/zod-to-gbnf.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import { zodToGbnfSchema } from "../../src/llm/zod-to-gbnf.js";
import { ExtractedClaimsSchema } from "../../src/pipeline/stage1-extract.js";
import { ClassificationSchema } from "../../src/pipeline/stage3-classify.js";
import { ReconcileSchema } from "../../src/pipeline/stage4-reconcile.js";
import { RequirementDraftsSchema } from "../../src/pipeline/stage5-requirements.js";
import { StoryDraftsSchema } from "../../src/pipeline/stage6-stories.js";
import { CritiqueFindingsSchema } from "../../src/pipeline/stage7-critique.js";

describe("zodToGbnfSchema", () => {
  it("converts a flat object of strings", () => {
    expect(zodToGbnfSchema(z.object({ a: z.string() }))).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    });
  });

  it("converts arrays of objects with an enum field", () => {
    const schema = z.object({ items: z.array(z.object({ kind: z.enum(["a", "b"]) })) });
    expect(zodToGbnfSchema(schema)).toEqual({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { kind: { enum: ["a", "b"] } },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    });
  });

  it("converts a nullable string to a two-member type array, not anyOf", () => {
    const schema = z.object({ q: z.string().nullable() });
    expect(zodToGbnfSchema(schema)).toEqual({
      type: "object",
      properties: { q: { type: ["string", "null"] } },
      additionalProperties: false,
    });
  });

  it("throws on an unsupported zod construct instead of silently mis-converting", () => {
    expect(() => zodToGbnfSchema(z.object({ n: z.number() }))).toThrow(/unsupported zod type/);
  });

  const productionSchemas = {
    ExtractedClaimsSchema, ClassificationSchema, ReconcileSchema,
    RequirementDraftsSchema, StoryDraftsSchema, CritiqueFindingsSchema,
  };
  for (const [name, schema] of Object.entries(productionSchemas)) {
    it(`converts the real production schema ${name} without throwing`, () => {
      expect(() => zodToGbnfSchema(schema)).not.toThrow();
    });
  }
});
```

- [ ] **Step 4: Run the test, confirm it fails**

Run: `npx vitest run tests/llm/zod-to-gbnf.test.ts`
Expected: FAIL — `src/llm/zod-to-gbnf.ts` doesn't exist yet.

- [ ] **Step 5: Implement the translator**

```typescript
// src/llm/zod-to-gbnf.ts
import type { z } from "zod/v4";
import type { GbnfJsonSchema } from "node-llama-cpp";

interface ObjectDef {
  type: "object";
  shape: Record<string, z.ZodType>;
}
interface ArrayDef {
  type: "array";
  element: z.ZodType;
}
interface EnumDef {
  type: "enum";
  entries: Record<string, string | number>;
}
interface NullableDef {
  type: "nullable";
  innerType: z.ZodType;
}

/**
 * Walks a Zod schema's public `.def` shape directly (not via Zod's own
 * toJSONSchema) so the output is under full control and anything this
 * function doesn't recognize fails loudly instead of being silently
 * mis-converted. Only handles the five constructs the six production
 * schemas actually use (object, array, string, enum, nullable) — extend
 * deliberately if a schema changes, don't guess at broader JSON Schema
 * support node-llama-cpp's GbnfJsonSchema type doesn't have anyway
 * (no numeric bounds, no regex pattern — see Task 1 in the plan for why).
 */
export function zodToGbnfSchema(schema: z.ZodType): GbnfJsonSchema {
  const def = schema.def;

  switch (def.type) {
    case "object": {
      const { shape } = def as unknown as ObjectDef;
      const properties: Record<string, GbnfJsonSchema> = {};
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToGbnfSchema(value);
      }
      return { type: "object", properties, additionalProperties: false };
    }
    case "array": {
      const { element } = def as unknown as ArrayDef;
      return { type: "array", items: zodToGbnfSchema(element) };
    }
    case "string":
      return { type: "string" };
    case "enum": {
      const { entries } = def as unknown as EnumDef;
      return { enum: Object.values(entries) };
    }
    case "nullable": {
      const { innerType } = def as unknown as NullableDef;
      const inner = zodToGbnfSchema(innerType);
      if (!("type" in inner) || Array.isArray(inner.type)) {
        throw new Error(
          `zodToGbnfSchema: cannot make ${JSON.stringify(inner)} nullable — ` +
            `only a basic single-typed schema (string/number/integer/boolean) can be widened to include "null"`,
        );
      }
      return { type: [inner.type, "null"] };
    }
    default:
      throw new Error(
        `zodToGbnfSchema: unsupported zod type "${def.type}" — extend this translator ` +
          `before using it on a schema with this construct`,
      );
  }
}
```

- [ ] **Step 6: Run the test, confirm it passes**

Run: `npx vitest run tests/llm/zod-to-gbnf.test.ts`
Expected: PASS (all cases, including all six real production schemas).

- [ ] **Step 7: Write the static grammar-construction spike script**

This checks that node-llama-cpp's own grammar builder accepts the translated output — this step needs no downloaded model, since grammar construction from a schema is pure CPU-side string generation.

```typescript
// scripts/spike/schema-grammar-check.ts
import { getLlama } from "node-llama-cpp";
import { zodToGbnfSchema } from "../../src/llm/zod-to-gbnf.js";
import { ExtractedClaimsSchema } from "../../src/pipeline/stage1-extract.js";
import { ClassificationSchema } from "../../src/pipeline/stage3-classify.js";
import { ReconcileSchema } from "../../src/pipeline/stage4-reconcile.js";
import { RequirementDraftsSchema } from "../../src/pipeline/stage5-requirements.js";
import { StoryDraftsSchema } from "../../src/pipeline/stage6-stories.js";
import { CritiqueFindingsSchema } from "../../src/pipeline/stage7-critique.js";

const schemas = {
  ExtractedClaimsSchema, ClassificationSchema, ReconcileSchema,
  RequirementDraftsSchema, StoryDraftsSchema, CritiqueFindingsSchema,
};

async function main() {
  const llama = await getLlama();
  for (const [name, schema] of Object.entries(schemas)) {
    try {
      const gbnf = zodToGbnfSchema(schema);
      await llama.createGrammarForJsonSchema(gbnf);
      console.log(`PASS  ${name}`);
    } catch (err) {
      console.log(`FAIL  ${name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main();
```

Add to `package.json`'s `"scripts"`: `"spike:schema": "tsx scripts/spike/schema-grammar-check.ts"`.

- [ ] **Step 8: Run it and record real output**

Run: `npm run spike:schema`

Note: this triggers node-llama-cpp's one-time native binding download/build (prebuilt binaries for common platforms) — this is a one-time, much-smaller-than-a-model download, separate from the multi-GB model download in Task 2.

Create `docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md` with a `# Local LLM Backend — Spike Findings` header, and paste the actual command output under a `## Schema→grammar construction (Task 1)` heading. If anything shows `FAIL`, write a short paragraph analyzing why, using the `GbnfJsonSchema` type's real constraints (see Background above) — do not guess; open the actually-installed `node_modules/node-llama-cpp/dist/utils/gbnfJson/types.d.ts` and check which constraint was violated.

- [ ] **Step 9: Commit**

```bash
git add src/llm/zod-to-gbnf.ts tests/llm/zod-to-gbnf.test.ts scripts/spike/schema-grammar-check.ts package.json package-lock.json docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md
git commit -m "spike: add Zod->GBNF translator and static schema-compatibility check"
```

---

### Task 2: Real generation spike against a candidate model

**Files:**
- Create: `scripts/spike/schema-generation-check.ts`
- Modify: `docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md`

**Interfaces:**
- Consumes: `zodToGbnfSchema` (Task 1).
- Produces: findings-doc content that Task 3 and Task 5 depend on (whether any schema needs local-only reshaping; the go/no-go call).

**Background:** This step needs a real downloaded model. The candidate — verified to actually exist on Hugging Face right now, as a **single, non-split** GGUF file (avoiding the multi-part-splicing complexity some quants of some repos have) — is:

```
hf:bartowski/Qwen2.5-7B-Instruct-GGUF/Qwen2.5-7B-Instruct-Q4_K_M.gguf
```

This is a starting candidate for the spike, not a final commitment — per the design spec (§7.2, §8), model choice is exactly what this spike is meant to inform. If this candidate performs badly in Task 3's throughput measurement, note that in the findings doc and try a smaller model (e.g. a 3B-class Qwen2.5 GGUF) before declaring the spike a no-go on throughput grounds alone.

- [ ] **Step 1: Write the generation spike script, covering all six real schemas with real fixture data**

Fixture data below is hand-constructed to satisfy each real Zod schema's actual shape (`ClaimSchema`, `RequirementSchema`, `StorySchema`, `AcceptanceCriterionSchema`, `SegmentSchema`, all in `src/types/domain.ts`) — not guessed, checked against the schema definitions directly.

```typescript
// scripts/spike/schema-generation-check.ts
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
  llmBackend: "local", createdAt: now,
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
```

- [ ] **Step 2: Run it for real**

Run: `npx tsx scripts/spike/schema-generation-check.ts`

This downloads the ~4.7GB model file on first run. Let it finish.

- [ ] **Step 3: Record the actual results**

Paste the full real output into `docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md` under `## Real generation against candidate model (Task 2)`. For each schema, state explicitly: grammar construction OK/FAIL, `grammar.parse` OK/FAIL, `schema.safeParse` OK/FAIL.

- [ ] **Step 4: If any schema failed, decide and record a mitigation**

If every schema passed: write "No schema required reshaping for the local path" in the findings doc, and move on.

If any schema failed `grammar.parse` or `schema.safeParse` in a way that looks structural (not just a one-off bad generation): write a paragraph identifying which part of the schema is implicated (cross-reference `zodToGbnfSchema`'s translation of that specific field against `GbnfJsonSchema`'s real constraints), and record a decision — e.g., "flatten `StoryDraftsSchema.stories[].acceptanceCriteria` into a top-level array with a `storyIndex` field for the local path only" — as a concrete, scoped addendum to Task 5's local backend implementation. Do not silently change the Claude-path schema to work around a local-only limitation.

- [ ] **Step 5: Commit**

```bash
git add scripts/spike/schema-generation-check.ts docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md
git commit -m "spike: real generation check against candidate model for all six schemas"
```

(Do not commit the downloaded model file — it lands in node-llama-cpp's own default models directory, `~/.node-llama-cpp/models`, outside the repo, not inside it. Confirm with `git status` that nothing model-related is untracked-and-about-to-be-added before this commit.)

---

### Task 3: CPU-only throughput measurement + finalize constants + go/no-go

**Files:**
- Modify: `scripts/spike/schema-generation-check.ts`
- Modify: `docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md`

**Interfaces:**
- Produces: the `LOCAL_MAX_TOKENS` value and effort-equivalent decision that Task 5 (`local-client.ts`) consumes directly.

- [ ] **Step 1: Add timing and token-count instrumentation**

Modify the per-check loop in `scripts/spike/schema-generation-check.ts` to measure wall-clock time and compute real output tokens/sec, using the model's own tokenizer (`model.tokenize(text: string): Token[]`, verified against the actually-installed `node-llama-cpp`'s `dist/bindings/LlamaModel.d.ts` — this is the same tokenizer node-llama-cpp uses internally, so it's an accurate count, not an approximation):

```typescript
    const start = performance.now();
    const raw = await session.prompt(user, { grammar, maxTokens: context.contextSize });
    const elapsedSeconds = (performance.now() - start) / 1000;
    const outputTokens = model.tokenize(raw).length;
    const tokensPerSecond = outputTokens / elapsedSeconds;
    console.log(`${name}: ${outputTokens} tokens in ${elapsedSeconds.toFixed(1)}s = ${tokensPerSecond.toFixed(1)} tok/s`);
```

- [ ] **Step 2: Confirm this run is actually CPU-only**

Before running, confirm no discrete GPU is being used for this measurement (this project's dev machine is Apple Silicon per the design spec's environment notes — Metal will be used by default there, which is not the CPU-only case the target Windows-laptop user base needs measured). If Metal/CUDA acceleration can't be disabled easily on this machine, note that explicitly in the findings doc as a caveat ("measured with Metal acceleration, not representative of the target CPU-only Windows case — needs re-measurement on real target hardware before shipping") rather than silently presenting an accelerated number as if it were the CPU-only figure the spec calls for.

- [ ] **Step 3: Run and record**

Run: `npx tsx scripts/spike/schema-generation-check.ts`

Paste the full tokens/sec output into the findings doc under `## Throughput (Task 3)`, including the CPU-only caveat from Step 2 if applicable.

- [ ] **Step 4: Decide LOCAL_MAX_TOKENS**

Based on the measured tokens/sec and the model's `context.contextSize` (log this value too), record a concrete `LOCAL_MAX_TOKENS` value in the findings doc — reasoned from "how long is an acceptable wait for one stage call" (e.g., if throughput is 8 tok/s and a 2048-token ceiling means a ~4.3-minute worst-case single call, decide whether that's acceptable for this tool's actual usage pattern, and adjust down if not). Write the chosen number and the reasoning into the findings doc under `## Constants decided by the spike`.

- [ ] **Step 5: Decide the effort-equivalent setting**

Note in the findings doc whether the candidate model has its own generation-depth control (Qwen2.5 does not have Qwen3's hybrid thinking-mode toggle) and what, if anything, `LocalBackend` should set for it. If the model has no such control, record: "local path omits an effort-equivalent parameter entirely — no mapping exists for this model."

- [ ] **Step 6: Write the go/no-go verdict**

Add a `## Go/no-go` section to the findings doc with an explicit verdict: proceed to Phase 1 as planned, proceed with a specific reshape/model-swap noted from Tasks 2–3, or stop and escalate to the user if throughput or schema compatibility make the whole approach non-viable. If the verdict is anything other than a clean "proceed," pause here and get the user's read before continuing to Task 4 — this is the gate the whole plan depends on.

- [ ] **Step 7: Commit**

```bash
git add scripts/spike/schema-generation-check.ts docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md
git commit -m "spike: measure CPU throughput, decide local generation constants, go/no-go"
```

---

## Phase 1 — Backend Abstraction

### Task 4: `LlmBackend` interface, `AnthropicBackend`, `callTyped` refactor

This task is atomic — the interface, the Anthropic implementation, `callTyped`'s dispatch, `logEgress`'s new parameter, and `StageContext`'s retype all have to land together to keep `tsc --noEmit` clean at the end of the task. Splitting it further would leave the tree in a non-compiling state mid-task.

**Files:**
- Create: `src/llm/backend.ts`
- Modify: `src/llm/client.ts`
- Modify: `src/llm/parse.ts`
- Modify: `src/pipeline/runner.ts`
- Modify: `tests/llm/parse.test.ts`
- Modify: `tests/llm/client.test.ts`

**Interfaces:**
- Produces: `LlmBackend` interface, `Effort` type (both `src/llm/backend.ts`) — consumed by `AnthropicBackend`, `LocalBackend` (Task 5), and `callTyped`. `AnthropicBackend` class (`src/llm/client.ts`) — consumed by Task 7's CLI wiring.
- Consumes: nothing new — this is a refactor of existing code.

**Why the field is still called `client`, holding an `LlmBackend`:** `StageContext.client`'s *type* changes from `Anthropic` to `LlmBackend`, but the *field name* does not, and neither does `callTyped`'s `client` parameter name. Every one of the 6 LLM-calling stage files calls `callTyped({ client: ctx.client, ... })` — since that's a value passed through structurally, not a type any stage file declares itself, keeping the name `client` means **none of the 9 stage files need to change**, only their retype at the `StageContext`/`callTyped` boundary. This was verified against the actual current code before being written into the design spec (`docs/superpowers/specs/2026-08-07-local-llm-backend-design.md`, §4.1) and is a load-bearing fact this task depends on — if a `git log`/`grep` check at the start of this task shows any stage file no longer does `client: ctx.client` verbatim, stop and re-verify the claim before proceeding.

- [ ] **Step 1: Verify the load-bearing claim before starting**

Run: `grep -n "client: ctx.client" src/pipeline/stage*.ts`
Expected: 6 matches (stage1, stage3, stage4, stage5, stage6, stage7). If this doesn't match, stop and re-read this task's design assumption before continuing.

- [ ] **Step 2: Write `src/llm/backend.ts`**

```typescript
// src/llm/backend.ts
import type { z } from "zod/v4";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * One provider-specific generation attempt. Implementations do not retry —
 * callTyped owns the shared retry loop across every backend, so a backend
 * only needs to make one honest attempt and report what happened.
 */
export interface LlmBackend {
  /** Recorded in egress_log.model for every call this backend makes. */
  readonly model: string;
  generate(args: {
    system: string;
    user: string;
    schema: z.ZodType<unknown>;
    effort?: Effort;
  }): Promise<{
    /** Raw text response, preserved on StageFailure for inspection. */
    raw: string;
    /** Parsed-but-not-yet-Zod-validated output. null/undefined means the model produced no schema-shaped output at all. */
    parsedOutput: unknown;
    /** Hashed into egress_log.request_hash — "what was sent," in whatever shape this backend actually sends. */
    requestPayload: unknown;
    /** Omitted when the provider reports no usage for this call — callTyped then skips logging egress for that attempt, matching current behavior. */
    usage?: { input_tokens: number; output_tokens: number };
  }>;
}
```

- [ ] **Step 3: Update `src/llm/client.ts` — `logEgress` takes a `model` parameter, add `AnthropicBackend`**

Read the current file first (`src/llm/client.ts`) to confirm nothing else has changed since this plan was written. Then:

```typescript
// src/llm/client.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createHash } from "node:crypto";
import type { z } from "zod/v4";
import type { Db } from "../store/db.js";
import { recordEgress } from "../store/audit.js";
import type { LlmBackend, Effort } from "./backend.js";

/** The only model this engine targets. Never append a date suffix. */
export const MODEL = "claude-opus-5";

/** Non-streaming ceiling for every pipeline call. */
export const MAX_TOKENS = 16000;

export function createClient(opts?: {
  apiKey?: string;
  maxRetries?: number;
  timeoutMs?: number;
}): Anthropic {
  return new Anthropic({
    ...(opts?.apiKey ? { apiKey: opts.apiKey } : {}),
    maxRetries: opts?.maxRetries ?? 3,
    timeout: opts?.timeoutMs ?? 10 * 60 * 1000,
  });
}

// canonical() and hashRequest() are UNCHANGED — copy verbatim from the
// current file, do not modify.

/**
 * Record what left the machine (or, for the local backend, what would have
 * — the row still records the request/response shape and token counts for
 * audit purposes, since the compliance promise is "we always log," not
 * "we only log when something actually left the machine").
 */
export function logEgress(
  db: Db,
  sessionId: string,
  stage: string,
  payload: unknown,
  usage: { input_tokens: number; output_tokens: number },
  model: string,
): void {
  recordEgress(db, {
    sessionId,
    stage,
    requestHash: hashRequest(payload),
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    model,
  });
}

// estimateInputTokens() is UNCHANGED — copy verbatim from the current file.

/**
 * Wraps the Anthropic SDK client to satisfy LlmBackend. The request shape
 * built here (model/max_tokens/output_config/messages, no temperature/top_p/
 * top_k/budget_tokens) is unchanged from callTyped's pre-refactor behavior —
 * only its location moved.
 */
export class AnthropicBackend implements LlmBackend {
  readonly model = MODEL;
  constructor(private readonly client: Anthropic) {}

  async generate(args: {
    system: string;
    user: string;
    schema: z.ZodType<unknown>;
    effort?: Effort;
  }) {
    const request = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: args.system,
      output_config: {
        effort: args.effort ?? "high",
        format: zodOutputFormat(args.schema),
      },
      messages: [{ role: "user" as const, content: args.user }],
    };

    const response = await this.client.messages.parse(request);
    const content = response.content ?? [];
    const raw = content.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("");

    return {
      raw,
      parsedOutput: response.parsed_output,
      requestPayload: request,
      usage: response.usage
        ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
        : undefined,
    };
  }
}
```

- [ ] **Step 4: Refactor `callTyped` in `src/llm/parse.ts` to dispatch through `LlmBackend`**

```typescript
// src/llm/parse.ts
import type { Db } from "../store/db.js";
import type { z } from "zod/v4";
import type { LlmBackend, Effort } from "./backend.js";
import { logEgress } from "./client.js";

export type { Effort } from "./backend.js";

export class StageFailure extends Error {
  constructor(
    readonly stage: string,
    message: string,
    readonly rawResponse: string | null,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StageFailure";
  }
}

const MAX_SCHEMA_RETRIES = 2;

/**
 * One typed structured-output call, backend-agnostic. The retry loop, error
 * feedback, and StageFailure contract are unchanged from before this
 * refactor — only the request-building and response-parsing moved into
 * whichever LlmBackend is passed in.
 */
export async function callTyped<T>(args: {
  client: LlmBackend;
  db: Db;
  sessionId: string;
  stage: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  effort?: Effort;
}): Promise<T> {
  const { client: backend, db, sessionId, stage, schema } = args;
  let user = args.user;
  let lastRaw: string | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= MAX_SCHEMA_RETRIES; attempt++) {
    const result = await backend.generate({
      system: args.system,
      user,
      schema: schema as z.ZodType<unknown>,
      effort: args.effort,
    });
    lastRaw = result.raw;

    if (result.usage) {
      logEgress(db, sessionId, stage, result.requestPayload, result.usage, backend.model);
    }

    if (result.parsedOutput === null || result.parsedOutput === undefined) {
      lastError = new Error("parsed_output was null — the model returned no schema-conforming JSON");
    } else {
      const parsed = schema.safeParse(result.parsedOutput);
      if (parsed.success) return parsed.data;
      lastError = parsed.error;
    }

    if (attempt < MAX_SCHEMA_RETRIES) {
      user =
        `${args.user}\n\n` +
        `Your previous response did not conform to the required schema. ` +
        `The validation error was:\n${String(lastError)}\n` +
        `Return a response that satisfies the schema exactly.`;
    }
  }

  throw new StageFailure(
    stage,
    `stage "${stage}" produced no schema-conforming output after ${MAX_SCHEMA_RETRIES + 1} attempts`,
    lastRaw,
    lastError,
  );
}
```

- [ ] **Step 5: Retype `StageContext` in `src/pipeline/runner.ts`**

```typescript
import type { LlmBackend } from "../llm/backend.js";
// remove: import type Anthropic from "@anthropic-ai/sdk";

export interface StageContext {
  db: Db;
  /** Holds an LlmBackend, not literally an Anthropic client — named `client`
   * because every stage file already destructures `ctx.client` and passing
   * `client: ctx.client` through unchanged to callTyped is what keeps this
   * refactor from touching any of the 9 stage files. See Task 4 in the plan. */
  client: LlmBackend;
  projectId: string;
  sessionId: string;
}
```

(The rest of `runner.ts` — `Stage`, `runPipeline` — is unchanged.)

- [ ] **Step 6: Run the type checker to confirm the stage files really didn't need changes**

Run: `npx tsc --noEmit`
Expected: clean. If any of the 9 stage files shows an error here, that means one of them constructs or annotates `ctx.client`'s type itself somewhere this plan didn't find — stop and investigate before patching around it.

- [ ] **Step 7: Rewrite `tests/llm/parse.test.ts` for the generic `LlmBackend` contract**

The existing Anthropic-request-shape-specific tests (no temperature/top_p/top_k, model pinning, `zodOutputFormat` against real schemas) move to `tests/llm/client.test.ts` in Step 8 — `parse.test.ts` keeps only backend-agnostic behavior.

```typescript
// tests/llm/parse.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { egressSummary } from "../../src/store/audit.js";
import { callTyped, StageFailure } from "../../src/llm/parse.js";
import type { LlmBackend } from "../../src/llm/backend.js";

const Shape = z.object({ items: z.array(z.object({ name: z.string() })) });

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  return { db, sessionId: s.id };
}

function fakeBackend(parsedOutputs: (unknown | null)[]) {
  const calls: unknown[] = [];
  const backend: LlmBackend = {
    model: "fake-model",
    async generate(args) {
      calls.push(args);
      const out = parsedOutputs[calls.length - 1];
      return {
        raw: JSON.stringify(out),
        parsedOutput: out,
        requestPayload: { attempt: calls.length },
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    },
  };
  return { backend, calls };
}

describe("callTyped", () => {
  it("returns the parsed payload on first success", async () => {
    const { db, sessionId } = seed();
    const { backend } = fakeBackend([{ items: [{ name: "a" }] }]);
    const out = await callTyped({ client: backend, db, sessionId, stage: "extract", system: "sys", user: "usr", schema: Shape });
    expect(out.items[0]?.name).toBe("a");
  });

  it("logs egress for every attempt", async () => {
    const { db, sessionId } = seed();
    const { backend } = fakeBackend([{ items: [] }]);
    await callTyped({ client: backend, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape });
    expect(egressSummary(db, sessionId).requests).toBe(1);
  });

  it("skips egress logging when the backend reports no usage", async () => {
    const { db, sessionId } = seed();
    const backend: LlmBackend = {
      model: "fake",
      async generate() {
        return { raw: "{}", parsedOutput: { items: [] }, requestPayload: {} };
      },
    };
    await callTyped({ client: backend, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape });
    expect(egressSummary(db, sessionId).requests).toBe(0);
  });

  it("retries once when the payload fails schema validation, then succeeds", async () => {
    const { db, sessionId } = seed();
    const { backend, calls } = fakeBackend([{ items: "not-an-array" }, { items: [{ name: "ok" }] }]);
    const out = await callTyped({ client: backend, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape });
    expect(out.items[0]?.name).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("throws StageFailure with the raw response after retries are exhausted", async () => {
    const { db, sessionId } = seed();
    const { backend } = fakeBackend([{ bad: 1 }, { bad: 2 }, { bad: 3 }]);
    await expect(
      callTyped({ client: backend, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape }),
    ).rejects.toBeInstanceOf(StageFailure);
  });

  it("throws StageFailure when parsed_output is null", async () => {
    const { db, sessionId } = seed();
    const { backend } = fakeBackend([null, null, null]);
    await expect(
      callTyped({ client: backend, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape }),
    ).rejects.toBeInstanceOf(StageFailure);
  });
});
```

- [ ] **Step 8: Move the Anthropic-specific tests into `tests/llm/client.test.ts`, update `logEgress`'s test call**

Add to the existing `tests/llm/client.test.ts` (keep everything already there — `MODEL`, `hashRequest`, `createClient` describe blocks are unchanged):

```typescript
// Update the existing logEgress test's call site to pass MODEL as the new 6th arg:
    logEgress(db, s.id, "extract", { prompt: "x" }, { input_tokens: 120, output_tokens: 40 }, MODEL);

// Add these new imports at the top:
import { vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { AnthropicBackend, MODEL, MAX_TOKENS, hashRequest, logEgress, createClient } from "../../src/llm/client.js";
import { RecommendationSchema } from "../../src/types/domain.js";

// Add this new describe block:
describe("AnthropicBackend", () => {
  function fakeAnthropicClient(response: unknown) {
    const parse = vi.fn().mockResolvedValue(response);
    return { messages: { parse } } as unknown as Anthropic;
  }

  it("never passes temperature, top_p, top_k, or budget_tokens, and pins model/max_tokens", async () => {
    const client = fakeAnthropicClient({
      parsed_output: { ok: true },
      content: [{ type: "text", text: "{}" }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "end_turn",
    });
    const backend = new AnthropicBackend(client);
    await backend.generate({ system: "s", user: "u", schema: z.object({ ok: z.boolean() }) });

    const args = (client.messages.parse as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(args).not.toHaveProperty("temperature");
    expect(args).not.toHaveProperty("top_p");
    expect(args).not.toHaveProperty("top_k");
    expect(JSON.stringify(args)).not.toContain("budget_tokens");
    expect(args.model).toBe(MODEL);
    expect(args.max_tokens).toBe(MAX_TOKENS);
  });

  it("reports MODEL as its egress model identifier", () => {
    const backend = new AnthropicBackend(fakeAnthropicClient({}));
    expect(backend.model).toBe(MODEL);
  });

  it("zodOutputFormat works with real production schemas from domain.ts", () => {
    // Guards against regression: if domain.ts reverts to bare "zod" import (v3),
    // zodOutputFormat will crash. Import the actual schema, not a local lookalike.
    const output = zodOutputFormat(RecommendationSchema);
    expect(output).toHaveProperty("type", "json_schema");
    expect(output).toHaveProperty("schema");
    expect(output.schema).toHaveProperty("properties");
    expect(output.schema.properties).toHaveProperty("rationale");
    expect(output.schema.properties).toHaveProperty("raisedBySessionId");
    expect(output.schema.properties).toHaveProperty("dispositionNote");
  });
});
```

- [ ] **Step 9: Run the full suite**

Run: `npm test && npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 10: Commit**

```bash
git add src/llm/backend.ts src/llm/client.ts src/llm/parse.ts src/pipeline/runner.ts tests/llm/parse.test.ts tests/llm/client.test.ts
git commit -m "refactor: introduce LlmBackend, extract AnthropicBackend, make callTyped backend-agnostic"
```

---

## Phase 2 — Local Backend

### Task 5: `src/llm/local-client.ts` — `LocalBackend` and model lifecycle

**Files:**
- Create: `src/llm/local-client.ts`
- Create: `tests/llm/local-client.test.ts`

**Interfaces:**
- Consumes: `zodToGbnfSchema` (Task 1), `LlmBackend`/`Effort` (Task 4).
- Produces: `LocalBackend` class implementing `LlmBackend`; `loadLocalBackend(opts?: { log?: Log }): Promise<{ backend: LocalBackend; release: () => Promise<void> }>` — consumed by Task 7's CLI wiring and Task 9's eval parameterization.

**Model storage location:** node-llama-cpp's own `resolveModelFile`/`createModelDownloader` already default to an OS-appropriate global directory (`~/.node-llama-cpp/models`, verified in the actually-installed package's `.d.ts` comments) — no custom app-data-directory logic needs to be written. Omit `dirPath`/`directory` in the calls below and let the library's own cross-platform default apply.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/llm/local-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod/v4";

const mockGrammar = { parse: vi.fn() };
const mockSession = { prompt: vi.fn() };
const mockLlama = { createGrammarForJsonSchema: vi.fn() };
const mockModel = { tokenize: vi.fn((t: string) => t.split(/\s+/)) };
const mockSequence = {};

vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(),
  resolveModelFile: vi.fn(),
  LlamaChatSession: vi.fn().mockImplementation(() => mockSession),
}));

import { LocalBackend } from "../../src/llm/local-client.js";

describe("LocalBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLlama.createGrammarForJsonSchema.mockResolvedValue(mockGrammar);
  });

  it("builds a grammar from the schema and returns the parsed output on valid generation", async () => {
    mockSession.prompt.mockResolvedValue('{"ok":true}');
    mockGrammar.parse.mockReturnValue({ ok: true });

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockSequence as never, "test-model");
    const result = await backend.generate({ system: "sys", user: "usr", schema: z.object({ ok: z.boolean() }) });

    expect(result.parsedOutput).toEqual({ ok: true });
    expect(result.usage).toBeDefined();
    expect(result.usage?.input_tokens).toBeGreaterThan(0);
    expect(mockSession.prompt).toHaveBeenCalledWith("usr", expect.objectContaining({ grammar: mockGrammar }));
  });

  it("returns parsedOutput null instead of throwing when grammar.parse fails", async () => {
    mockSession.prompt.mockResolvedValue("not valid json even under grammar");
    mockGrammar.parse.mockImplementation(() => {
      throw new Error("parse failed");
    });

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockSequence as never, "test-model");
    const result = await backend.generate({ system: "sys", user: "usr", schema: z.object({ ok: z.boolean() }) });

    expect(result.parsedOutput).toBeNull();
    expect(result.raw).toBe("not valid json even under grammar");
  });

  it("reports the configured model identifier", () => {
    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockSequence as never, "test-model");
    expect(backend.model).toBe("test-model");
  });
});
```

Note explicitly: these tests mock `node-llama-cpp` entirely and verify only `LocalBackend`'s own logic (grammar construction call, retry-safe error handling, token counting, model identifier). They do **not** verify real generation quality or real GBNF behavior — that's what Tasks 1–3's spike scripts (and Task 9's real eval run) are for. This mirrors how `tests/llm/parse.test.ts`/`client.test.ts` already mock the Anthropic SDK boundary rather than making real API calls in `npm test`.

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/llm/local-client.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/llm/local-client.ts`**

```typescript
// src/llm/local-client.ts
import {
  getLlama, resolveModelFile, LlamaChatSession,
  type Llama, type LlamaModel, type LlamaContextSequence,
} from "node-llama-cpp";
import type { z } from "zod/v4";
import type { LlmBackend, Effort } from "./backend.js";
import { zodToGbnfSchema } from "./zod-to-gbnf.js";

type Log = (line: string) => void;

/**
 * Starting candidate from the Task 1-3 compatibility spike — see
 * docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md for why,
 * and re-check that doc before changing this without re-running the spike.
 */
const CANDIDATE_MODEL_URI = "hf:bartowski/Qwen2.5-7B-Instruct-GGUF/Qwen2.5-7B-Instruct-Q4_K_M.gguf";

/**
 * Ceiling for a single local generation call. MUST be set from Task 3's
 * measured throughput (docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md,
 * "## Constants decided by the spike") — replace this value with the one
 * actually recorded there, do not leave the placeholder below.
 */
export const LOCAL_MAX_TOKENS = 4096;

export class LocalBackend implements LlmBackend {
  constructor(
    private readonly llama: Llama,
    private readonly llamaModel: LlamaModel,
    private readonly sequence: LlamaContextSequence,
    readonly model: string,
  ) {}

  async generate(args: {
    system: string;
    user: string;
    schema: z.ZodType<unknown>;
    effort?: Effort;
  }) {
    const gbnfSchema = zodToGbnfSchema(args.schema);
    const grammar = await this.llama.createGrammarForJsonSchema(gbnfSchema);
    const session = new LlamaChatSession({ contextSequence: this.sequence, systemPrompt: args.system });

    const raw = await session.prompt(args.user, { grammar, maxTokens: LOCAL_MAX_TOKENS });

    let parsedOutput: unknown = null;
    try {
      parsedOutput = grammar.parse(raw);
    } catch {
      parsedOutput = null;
    }

    const promptTokens = this.llamaModel.tokenize(`${args.system}\n\n${args.user}`).length;
    const completionTokens = this.llamaModel.tokenize(raw).length;

    return {
      raw,
      parsedOutput,
      requestPayload: { system: args.system, user: args.user },
      usage: { input_tokens: promptTokens, output_tokens: completionTokens },
    };
  }
}

/**
 * Resolves (downloading on first use), loads, and prepares a local model for
 * one analyzeSession run. Load once, reuse across every stage call in that
 * run, release after — reloading a multi-GB model per stage call would be
 * far too slow. Download progress reports through the same Log callback
 * pattern buildProgram already uses elsewhere in the CLI.
 */
export async function loadLocalBackend(opts?: { log?: Log }): Promise<{
  backend: LocalBackend;
  release: () => Promise<void>;
}> {
  const log = opts?.log ?? (() => {});

  const modelPath = await resolveModelFile(CANDIDATE_MODEL_URI, {
    cli: false,
    onProgress: (status) => {
      const pct = status.totalSize > 0 ? ((status.downloadedSize / status.totalSize) * 100).toFixed(1) : "?";
      log(`Downloading local model: ${pct}%`);
    },
  });

  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext();
  const sequence = context.getSequence();

  const backend = new LocalBackend(llama, model, sequence, CANDIDATE_MODEL_URI);
  const release = async () => {
    await context.dispose();
    await model.dispose();
  };

  return { backend, release };
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npx vitest run tests/llm/local-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `LOCAL_MAX_TOKENS` from Task 3's findings**

Open `docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md`'s "Constants decided by the spike" section and replace the `4096` placeholder above with the actual recorded value. Re-run `npx vitest run tests/llm/local-client.test.ts` to confirm nothing depends on the specific number.

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/llm/local-client.ts tests/llm/local-client.test.ts
git commit -m "feat: add LocalBackend and model lifecycle management for node-llama-cpp"
```

---

## Phase 3 — Config Surface

### Task 6: `llmBackend` project setting (data layer)

**Files:**
- Modify: `src/types/domain.ts`
- Modify: `src/store/schema.sql`
- Modify: `src/store/projects.ts`
- Modify: `tests/store/projects.test.ts`

**Interfaces:**
- Produces: `LlmBackendSetting = z.enum(["claude", "local"])` and `ProjectSchema.llmBackend` (`src/types/domain.ts`) — consumed by Task 7's CLI flag and backend selection.

(Named `LlmBackendSetting`, not `LlmBackend`, to avoid colliding with the `LlmBackend` TypeScript interface from Task 4's `src/llm/backend.ts` — both get imported into `src/cli/index.ts` in Task 7.)

- [ ] **Step 1: Write the failing test**

Add to `tests/store/projects.test.ts` (mirroring its existing `regulatoryContext` test):

```typescript
it("defaults llmBackend to claude and can be set to local", () => {
  const db = openDb(":memory:");
  const p1 = createProject(db, { name: "P1", domain: "invoice approval for logistics operators" });
  expect(p1.llmBackend).toBe("claude");

  const p2 = createProject(db, { name: "P2", domain: "invoice approval for logistics operators", llmBackend: "local" });
  const fetched = getProject(db, p2.id);
  expect(fetched?.llmBackend).toBe("local");
});
```

(Check the file's existing imports first — it likely already imports `openDb`, `createProject`, `getProject`; add only what's missing.)

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/store/projects.test.ts`
Expected: FAIL — `llmBackend` doesn't exist yet.

- [ ] **Step 3: Add the enum and schema field in `src/types/domain.ts`**

Add near `RegulatoryContext`:

```typescript
export const LlmBackendSetting = z.enum(["claude", "local"]);
```

Add to `ProjectSchema`, after `glossary`:

```typescript
export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  domain: z.string().min(10, "project domain must be a meaningful one-liner"),
  regulatoryContext: RegulatoryContext,
  systemName: z.string().nullable(),
  glossary: z.string().nullable(),
  llmBackend: LlmBackendSetting,
  createdAt: Iso,
});
```

- [ ] **Step 4: Add the column in `src/store/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  regulatory_context TEXT NOT NULL DEFAULT 'none',
  system_name TEXT,
  glossary TEXT,
  llm_backend TEXT NOT NULL DEFAULT 'claude',
  created_at TEXT NOT NULL
);
```

(Place `llm_backend` right after `glossary`, matching `ProjectSchema`'s field order — cosmetic, but keeps the two in sync for anyone reading both side by side.)

- [ ] **Step 5: Update `src/store/projects.ts`**

```typescript
interface ProjectRow {
  id: string; name: string; domain: string; regulatory_context: string;
  system_name: string | null; glossary: string | null; llm_backend: string; created_at: string;
}

function toProject(row: ProjectRow): Project {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    domain: row.domain,
    regulatoryContext: row.regulatory_context,
    systemName: row.system_name,
    glossary: row.glossary,
    llmBackend: row.llm_backend,
    createdAt: row.created_at,
  });
}

export function createProject(
  db: Db,
  input: {
    name: string;
    domain: string;
    regulatoryContext?: Project["regulatoryContext"];
    systemName?: string | null;
    glossary?: string | null;
    llmBackend?: Project["llmBackend"];
  },
): Project {
  const project = ProjectSchema.parse({
    id: newId("prj"),
    name: input.name,
    domain: input.domain,
    regulatoryContext: input.regulatoryContext ?? "none",
    systemName: input.systemName ?? null,
    glossary: input.glossary ?? null,
    llmBackend: input.llmBackend ?? "claude",
    createdAt: new Date().toISOString(),
  });
  db.prepare(
    `INSERT INTO projects (id, name, domain, regulatory_context, system_name, glossary, llm_backend, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    project.id, project.name, project.domain, project.regulatoryContext,
    project.systemName, project.glossary, project.llmBackend, project.createdAt,
  );
  return project;
}
```

(`getProject` and everything else in the file is unchanged — `toProject` already handles the new column.)

- [ ] **Step 6: Run, confirm pass**

Run: `npx vitest run tests/store/projects.test.ts`
Expected: PASS.

- [ ] **Step 7: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`

This will surface every other place `ProjectSchema.parse(...)` is called with a fixture object missing `llmBackend` (e.g. other test files that construct project rows by hand rather than through `createProject`). Fix each one by adding `llmBackend: "claude"` to the fixture, rather than making the field optional in the schema — the whole point is a real, always-present default.

Expected after fixes: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/types/domain.ts src/store/schema.sql src/store/projects.ts tests/store/projects.test.ts
git commit -m "feat: add llmBackend project setting (data layer)"
```

---

### Task 7: `--llm-backend` CLI flag + `analyze` command backend selection

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `tests/cli/index.test.ts`

**Interfaces:**
- Consumes: `LlmBackendSetting` (Task 6), `AnthropicBackend` (Task 4), `loadLocalBackend` (Task 5).

- [ ] **Step 1: Write the failing tests**

Add to `tests/cli/index.test.ts`, matching its existing `run()` helper (line 21) and the regex-extraction pattern its other `project create` tests already use:

```typescript
it("project create defaults llmBackend to claude", async () => {
  const out = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
  const projectId = /prj_[0-9A-Z]+/.exec(out)![0];
  const { openDb } = await import("../../src/store/db.js");
  const { getProject } = await import("../../src/store/projects.js");
  const db = openDb(dbPath);
  expect(getProject(db, projectId)?.llmBackend).toBe("claude");
});

it("project create --llm-backend local persists local", async () => {
  const out = await run([
    "project", "create", "--name", "P",
    "--domain", "invoice approval for logistics operators",
    "--llm-backend", "local",
  ]);
  const projectId = /prj_[0-9A-Z]+/.exec(out)![0];
  const { openDb } = await import("../../src/store/db.js");
  const { getProject } = await import("../../src/store/projects.js");
  const db = openDb(dbPath);
  expect(getProject(db, projectId)?.llmBackend).toBe("local");
});
```

(Dynamic `import()` here matches the existing style already used in this file's "approves a proposed requirement" test, rather than introducing a new static-import convention partway through the file.)

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/cli/index.test.ts`
Expected: FAIL — `--llm-backend` isn't a recognized option yet.

- [ ] **Step 3: Add the CLI flag to `project create`**

```typescript
import { RegulatoryContext, LlmBackendSetting } from "../types/domain.js";
import { AnthropicBackend } from "../llm/client.js";
import { loadLocalBackend } from "../llm/local-client.js";
import type { LlmBackend } from "../llm/backend.js";

// ...

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
      // ... keep any other existing log() lines from this action as-is ...
    });
```

- [ ] **Step 4: Add backend selection to the `analyze` command**

```typescript
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

// ...

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
```

Add the `getProject` import if `cli/index.ts` doesn't already import it (check first — `getProject` may already be imported for another command).

- [ ] **Step 5: Run, confirm pass**

Run: `npx vitest run tests/cli/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite + typecheck + manual smoke test**

Run: `npm test && npx tsc --noEmit`

Then manually smoke-test the CLI end to end with the default (Claude) backend — do not attempt a local-backend smoke test here, since that requires the multi-GB model download and a real generation call, which is exactly what Task 9's parameterized `eval:live` run is for:

```bash
npm run cli -- project create --name "Smoke" --domain "test domain for CLI smoke test" --db /tmp/smoke.db
npm run cli -- project create --name "Smoke2" --domain "test domain for CLI smoke test" --llm-backend local --db /tmp/smoke.db
```

Confirm both commands exit 0 and the second prints `llmBackend:  local`.

- [ ] **Step 7: Commit**

```bash
git add src/cli/index.ts tests/cli/index.test.ts
git commit -m "feat: add --llm-backend CLI flag and analyze command backend selection"
```

---

## Phase 4 — Eval Gate

### Task 8: Fix `run-live-eval.ts`'s `Expectation` gaps

This is Plan 1 debt (flagged in that plan's closing self-review, not fixed there per the user's explicit "leave Plan 1 as-is" instruction) that this plan's own local/Claude comparison work (Task 9) directly depends on — see the design spec §10 for why fixing it now is in scope.

**Files:**
- Modify: `scripts/run-live-eval.ts`

**Background, verified against the actual current code (not assumed):**
- `minContradictions` is already declared in the `Expectation` interface but the check loop never reads it — dead on arrival. The most precise, unambiguous mechanical signal for "how many contradictions did this run detect and retain" is `listLinks(db, project.id).filter(l => l.linkKind === "contradicts").length` — `src/pipeline/stage4-reconcile.ts` inserts exactly one `"contradicts"`-kind link per retained contradiction (line 82 of that file, `linkKind: "contradicts" as const`), so this count matches `result.contradictions.length` after the known-claims filter exactly.
- `mustNotAutoResolve` isn't in the interface at all yet. `stage4-reconcile.ts`'s own comment states the invariant plainly: "Contradictions: both sides retained, question auto-raised, never resolved" — every contradiction-derived question is inserted with a hardcoded `status: "open"` (line 69), and nothing in the automated pipeline ever transitions a question's status afterward (status changes only happen through the human-approval CLI flow, which `eval:live` never invokes). The check that actually exercises this invariant is: among `open_questions` with `status: "open"` matching the fixture's existing `mustContainQuestionMatching` pattern, at least one must exist. This reuses the pattern the fixture already declares — no new fixture field needed beyond the boolean itself.
- `hallucinationRate` isn't in the interface either. There is no separate "hallucination" metric anywhere in this codebase — `quarantineRate()` (`src/pipeline/stage2-validate.ts`) is already, by its own doc comment, "the mechanical gate that turns 'never invent client details' from a prompt instruction into a property of the system." `hallucinationRate` is implemented as the same computed value, checked as an upper bound — for `05-clean-baseline`, it's a strictly tighter check (`0` tolerance) layered on top of the existing looser `maxQuarantineRate` (`0.2`) check already in that fixture, not a different underlying signal. This is stated explicitly in code comments so a future reader doesn't think two independent metrics are being computed.

- [ ] **Step 1: Add the missing fields to the `Expectation` interface**

```typescript
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
```

- [ ] **Step 2: Import `listLinks`**

```typescript
import { listLinks } from "../src/store/links.js";
```

- [ ] **Step 3: Implement the three checks**

Add after the existing `maxQuarantineRate` check block, before the closing of the per-fixture `for` loop:

```typescript
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
    const rate = quarantineRate(state);
    check(
      name,
      `hallucination rate <= ${exp.hallucinationRate} (same metric as quarantine rate, checked at a tighter tolerance — see Task 8 in the plan)`,
      rate <= exp.hallucinationRate,
      rate.toFixed(3),
    );
  }
```

(The `openMatches`/`check` line for `mustNotAutoResolve` above has redundant computation for clarity — simplify to just the `stillOpen` boolean check if the `openMatches` variable isn't otherwise useful; keep whichever reads more clearly once written.)

- [ ] **Step 4: Run against the existing fixtures**

Run: `ANTHROPIC_API_KEY=... npm run eval:live`

This makes real, billed API calls — only run it if you have a key available and the cost is acceptable, per the script's own header comment. If a key isn't available in this environment, skip running it live here and instead verify the new code compiles and the logic is correct by inspection plus `npx tsc --noEmit`; note in the commit message that the live run wasn't performed and should happen before this is relied on as a real gate.

Expected if run: `02-contradiction`'s new `minContradictions`/`mustNotAutoResolve` checks and `05-clean-baseline`'s new `hallucinationRate` check should PASS against the current Claude-only baseline (they're checking invariants the system already holds structurally) — if any FAILs, that's a real finding, not a bug in the check; investigate before assuming the check itself is wrong.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add scripts/run-live-eval.ts
git commit -m "fix: implement minContradictions, mustNotAutoResolve, hallucinationRate checks in run-live-eval"
```

---

### Task 9: Parameterize `run-live-eval.ts` for both backends, produce comparison report

**Files:**
- Modify: `scripts/run-live-eval.ts`

**Interfaces:**
- Consumes: `AnthropicBackend` (Task 4), `loadLocalBackend` (Task 5), the fixed `Expectation` checks (Task 8).

**Design:** the current script's per-fixture loop body becomes a function taking a backend and a label, called once per requested backend. Which backends run is controlled by an env var (`LLM_BACKENDS`, comma-separated, default `claude` — so existing zero-config usage of `npm run eval:live` doesn't suddenly trigger a multi-GB download). A local backend, if requested, is loaded once and reused across all fixtures in that pass — same one-load-per-run lifecycle rule as the CLI's `analyze` command, extended here to "per eval pass over all fixtures" as the unit of work. Results collect into a flat list and print as a final comparison table.

- [ ] **Step 1: Restructure the script**

```typescript
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
import { readFileSync, readdirSync } from "node:fs";
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
      record(check(name, `at least ${exp.minContradictions} contradiction(s) detected`, contradictionLinks.length >= exp.minContradictions, `got ${contradictionLinks.length}`));
    }
    if (exp.mustNotAutoResolve) {
      const openQuestionTexts = listQuestions(db, project.id, { status: "open" }).map((q) => q.text.toLowerCase());
      const stillOpen = (exp.mustContainQuestionMatching ?? []).some((p) => {
        const re = new RegExp(p, "i");
        return openQuestionTexts.some((t) => re.test(t));
      });
      record(check(name, "matched question(s) remain open, not auto-resolved", stillOpen));
    }
    if (exp.hallucinationRate !== undefined) {
      const rate = quarantineRate(state);
      record(check(name, `hallucination rate <= ${exp.hallucinationRate}`, rate <= exp.hallucinationRate, rate.toFixed(3)));
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run the default (Claude-only) path, confirm no regression**

Run: `ANTHROPIC_API_KEY=... npm run eval:live`
Expected: same pass/fail results as Task 8's run, plus the new `=== Comparison ===` table showing only the `claude` column. If no API key is available in this environment, skip and note it in the commit message, same as Task 8.

- [ ] **Step 4: Run the local comparison, record the real findings**

Run: `LLM_BACKENDS=claude,local ANTHROPIC_API_KEY=... npm run eval:live` (requires both a Claude key and the local model already downloaded from Task 2).

Append the actual comparison table output to `docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md` under a new `## Local vs Claude comparison (Task 9)` heading. This is the disclosed gap the design spec's decision 8 calls for — do not interpret a local shortfall here as something this task needs to fix; record it honestly.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-live-eval.ts docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md
git commit -m "feat: parameterize run-live-eval for both backends, add comparison report"
```

---

## After this plan

- `npm run cli -- project create ... --llm-backend local` and `npm run cli -- analyze --session ...` should now work end-to-end against a real local model, with the same retry-then-hard-fail contract as the Claude path.
- The local/Claude quality gap is measured and recorded, not closed — per the design spec's decision 8, that's the intended end state, not a gap to close in a follow-up task of this same plan.
- The Electron review UI (Plan 2) and ASR/capture (Plan 3), if picked up later, call into the same `LlmBackend` abstraction this plan built — no further backend work should be needed for them.
