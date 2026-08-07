# Local LLM Backend — Spike Findings

## Schema→grammar construction (Task 1)

```
> ba-story-agent@0.1.0 spike:schema
> tsx scripts/spike/schema-grammar-check.ts

PASS  ExtractedClaimsSchema
PASS  ClassificationSchema
PASS  ReconcileSchema
PASS  RequirementDraftsSchema
PASS  StoryDraftsSchema
PASS  CritiqueFindingsSchema
```

### Summary

All six production schemas successfully convert to GBNF via the `zodToGbnfSchema` translator and are accepted by `node-llama-cpp`'s `createGrammarForJsonSchema`. No failures.

The translator's direct Zod `.def` introspection approach correctly handles:
- Flat and nested objects with `additionalProperties: false`
- Arrays with typed items
- String fields
- Enum fields (`.enum()`)
- Nullable fields (`.nullable()`) — converted to `type: ["string", "null"]` instead of `anyOf`

None of the six schemas use unsupported constructs (numeric bounds, regex patterns, union types, or shared `$ref` subschemas), so the translator's fail-loud approach on unknown types confirms the schemas are within the safe subset for GBNF generation.

## Real generation against candidate model (Task 2)

Model: `hf:bartowski/Qwen2.5-7B-Instruct-GGUF/Qwen2.5-7B-Instruct-Q4_K_M.gguf`, resolved via `resolveModelFile`. Downloaded 4.68GB in 6 minutes to `~/.node-llama-cpp/models` on first run (Apple M4, 16GB, Metal-accelerated). `context.contextSize` was 32768 — no truncation risk for these prompts.

Real input: `tests/fixtures/transcripts/05-clean-baseline.txt` (the adversarial suite's clean-baseline fixture — a realistic ~500-word invoice-approval transcript with a manager-approval threshold, an escalation window, an audit-log retention rule, and a hedged currency statement).

Command: `npx tsx scripts/spike/schema-generation-check.ts`

Real output (verbatim, download progress spinner omitted):

```
Resolving model (downloads on first run — this can take a while): hf:bartowski/Qwen2.5-7B-Instruct-GGUF/Qwen2.5-7B-Instruct-Q4_K_M.gguf
Downloading to ~/.node-llama-cpp/models
✔ hf_bartow...K_M.gguf downloaded 4.68GB in 6m
Downloaded to ~/.node-llama-cpp/models/hf_bartowski_Qwen2.5-7B-Instruct-Q4_K_M.gguf
ExtractedClaimsSchema: grammar.parse OK, zod safeParse OK
ExtractedClaimsSchema: raw output (first 500 chars): {
    "claims": [
    ]
}
---
ClassificationSchema: grammar.parse OK, zod safeParse OK
ClassificationSchema: raw output (first 500 chars): {
    "classifications": [
    ]
}
---
ReconcileSchema: grammar.parse OK, zod safeParse OK
ReconcileSchema: raw output (first 500 chars): {
    "contradictions": [
    ],
    "links": [
    ]
}
---
RequirementDraftsSchema: grammar.parse OK, zod safeParse OK
RequirementDraftsSchema: raw output (first 500 chars): {
    "requirements": [
    ]
}
---
StoryDraftsSchema: grammar.parse OK, zod safeParse OK
StoryDraftsSchema: raw output (first 500 chars): {
    "stories": [
    ]
}
---
CritiqueFindingsSchema: grammar.parse OK, zod safeParse OK
CritiqueFindingsSchema: raw output (first 500 chars): {
    "questions": [
    ],
    "recommendations": [
    ]
}
---
```

### Per-schema result

| Schema | Grammar construction | `grammar.parse` | `schema.safeParse` | Content |
|---|---|---|---|---|
| ExtractedClaimsSchema | OK | OK | OK | Empty (`claims: []`) |
| ClassificationSchema | OK | OK | OK | Empty (`classifications: []`) |
| ReconcileSchema | OK | OK | OK | Empty (`contradictions: []`, `links: []`) |
| RequirementDraftsSchema | OK | OK | OK | Empty (`requirements: []`) |
| StoryDraftsSchema | OK | OK | OK | Empty (`stories: []`) |
| CritiqueFindingsSchema | OK | OK | OK | Empty (`questions: []`, `recommendations: []`) |

By the letter of the three checks this script runs, all six schemas pass: grammar construction succeeds, `grammar.parse` succeeds, and `schema.safeParse` succeeds for every one. But the substance behind that pass is not usable: **every single schema returned a structurally-valid but completely empty result**, despite a transcript containing at least four clearly extractable, unambiguous rules (the EUR 10,000 approval threshold, the 48-hour escalation window, the seven-year audit-log retention, and a hedged currency statement that should classify as an assumption). This is not "the model correctly found nothing" — it is a degenerate, information-free completion on every one of six differently-shaped, differently-worded prompts, which is a much stronger signal than a single bad generation would be.

### Investigation: why the six checks "pass" while producing nothing

This did not fit Step 4's literal trigger (a `grammar.parse` or `safeParse` failure) since nothing failed those checks — but per the standing instruction not to silently gloss over a failure, and because uniform emptiness across all six schemas is exactly the kind of "schema's generation quality looked off even though it technically parsed" case that warrants investigation rather than a pass-through "no schema required reshaping" note, three follow-up experiments were run against the same already-downloaded model (not part of the committed script; ad hoc, deleted after use):

1. **Temperature sweep with the real `ExtractedClaimsSchema` grammar** (`node-llama-cpp`'s `LlamaChatSession.prompt()` defaults `temperature` to `0` — pure greedy decoding — when the caller does not pass it, which the brief's script does not). At `temperature: 0` and `temperature: 0.4`, output was still the empty array. At `temperature: 0.7`, output was still effectively empty (just picked up a stray whitespace token inside the brackets). At `temperature: 1.1`, the *exact same grammar, exact same prompt* produced correct, well-formed, accurate claims (all four rules above, verbatim-quoted, correctly attributed).
2. **Same prompt and schema, grammar removed entirely** (plain free-form JSON-in-text request instead of `createGrammarForJsonSchema`), at `temperature: 0.4`: produced correct, complete, accurate claims immediately. This rules out the prompts, the fixture data, or the model's basic extraction capability as the cause — the model can clearly do this task.
3. **Grammar complexity isolation**: a minimal flat schema (`{ items: string[] }`) under grammar constraint at `temperature: 0.4` produced ten accurate, real extracted rules without difficulty. But the real `ExtractedClaimsSchema` grammar (array of objects with string + enum fields), even with `additionalProperties` loosened, still produced the empty array at `temperature: 0.4`.

Conclusion: this is **not** a structural incompatibility in `zodToGbnfSchema`'s translation, and **not** a defect in the six production schemas' shapes — the same nested-object-array grammar produces correct output once decoding is not near-greedy. The failure is a **decoding-parameter problem specific to grammar-constrained sampling of nested object-array schemas at low temperature**: under a strict GBNF grammar, low-temperature (especially greedy, `temperature: 0`) sampling systematically collapses to the trivial always-grammar-valid empty-array completion for schemas whose top-level arrays have no `minItems` — the "close early" path apparently carries a higher raw per-token logit than "open another item" once the model's usual free-text elaboration is removed by the grammar mask, and only a higher temperature reintroduces enough sampling variance to escape that path. This reproduces on every one of the six schemas because they all share the same shape (an object whose fields are arrays of objects), and it is orthogonal to which specific system/user prompt is used.

### Mitigation decision (addendum to Task 5's local backend implementation)

Task 5's `LocalBackend` must **not** call `session.prompt()` for grammar-constrained generation without an explicit, non-zero `temperature` — `node-llama-cpp`'s implicit default of `0` is unsafe for this codebase's schema shapes and will silently produce empty, technically-valid results that pass grammar and Zod validation while discarding all real content. Concretely:

- Set an explicit `temperature` (this spike's evidence: `0.4` and `0.7` still failed, `1.1` succeeded, for `ExtractedClaimsSchema`'s specific grammar/prompt combination — Task 5 should treat this as a starting point, not a proven-safe value, and sweep/tune it per schema against non-degenerate output, not just grammar/Zod validity, before shipping).
- Task 3's throughput measurement and Task 5's implementation must check **generation content**, not just grammar/Zod pass/fail, when validating the local path — an empty array is a false-positive "pass" under this spike script's own success criteria, so any future automated check for the local backend needs an explicit non-emptiness/content assertion (or a documented allowance for legitimately-empty results, e.g. `ExtractedClaimsSchema` when a transcript truly has no claims) to avoid this exact blind spot recurring silently.
- This is a decoding-parameter fix, not a schema-shape fix: no reshaping of `zodToGbnfSchema`'s output or any of the six production schemas is implicated, and nothing about the Claude-path schema needs to change.

No schema was structurally incompatible with GBNF generation. But "no schema required reshaping" alone would understate what was found — the default decoding path this spike script exercises (matching what a naive local backend implementation would do) silently produces unusable output for every schema, and Task 5 must not repeat that default.
