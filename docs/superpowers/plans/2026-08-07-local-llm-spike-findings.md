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

## Throughput (Task 3)

### CPU-only confirmation (Step 2)

This machine (Apple M4, 16GB, macOS 26.6) is Apple Silicon, where `getLlama()`'s default (`gpu: "auto"`) picks Metal — not the CPU-only case the target Windows-laptop user base needs measured. Metal/CUDA **can** be disabled on this machine: `node-llama-cpp`'s `LlamaGpuType` explicitly includes `false` (`"metal" | "cuda" | "vulkan" | false`), so the script was changed to call `getLlama({ gpu: false })`, and the run logs `llama.gpu` to confirm at runtime (`GPU backend: false` in the output below). This is a real CPU-only measurement, not a caveated Metal number.

Because this was the first-ever CPU-only invocation on this machine, `node-llama-cpp` had no cached prebuilt binary for the CPU-only backend and built `llama.cpp` from source (clang, ~4-5 minutes, confirmed via `ps` showing active `clang -cc1 -O3` compiles). That build cost is one-time and orthogonal to the tok/s figure below — it is omitted from the pasted output for readability.

### Command and real output (Step 3)

Temperature: **explicit, non-zero — `1.1`** (`TEMPERATURE` constant added next to `MODEL_URI`), for the reason documented in "Mitigation decision" above: `session.prompt()`'s implicit default (`0`) is proven unsafe for this codebase's schema shapes. `1.1` was Task 2's evidence for `ExtractedClaimsSchema` specifically — this run reuses it as a single global starting point across all six schemas to see whether it generalizes. (Spoiler, developed further below: it does not.)

Command: `npx tsx scripts/spike/schema-generation-check.ts`

Real output (verbatim from the point GPU mode is confirmed onward; the from-source CPU build log and model-download spinner are omitted):

```
GPU backend: false (false = CPU-only)
context.contextSize: 32768
ExtractedClaimsSchema: 737 tokens in 70.0s = 10.5 tok/s
ExtractedClaimsSchema: grammar.parse OK, zod safeParse OK
ExtractedClaimsSchema: raw output (first 500 chars): {
    "claims": [
        {
            "quote": "any invoice over ten thousand euro has to be approved by a department manager before it goes to finance.",
            "statement": "Invoices over ten thousand euros must be approved by a department manager before going to finance.",
            "segmentId": "seg-1",
            "speakerRole": "client"
        },
        {
            "quote": "the finance clerk can approve it directly without escalation below that threshold.",
            "state
---
ClassificationSchema: 10 tokens in 7.1s = 1.4 tok/s
ClassificationSchema: grammar.parse OK, zod safeParse OK
ClassificationSchema: raw output (first 500 chars): {
    "classifications": [
    ]
}
---
ReconcileSchema: 19 tokens in 8.9s = 2.1 tok/s
ReconcileSchema: grammar.parse OK, zod safeParse OK
ReconcileSchema: raw output (first 500 chars): {
    "contradictions": [
    ],
    "links": [
        
    ]
}
---
RequirementDraftsSchema: 9 tokens in 6.8s = 1.3 tok/s
RequirementDraftsSchema: grammar.parse OK, zod safeParse OK
RequirementDraftsSchema: raw output (first 500 chars): {
    "requirements": [
    ]
}
---
StoryDraftsSchema: 9 tokens in 7.7s = 1.2 tok/s
StoryDraftsSchema: grammar.parse OK, zod safeParse OK
StoryDraftsSchema: raw output (first 500 chars): {
    "stories": [
    ]
}
---
CritiqueFindingsSchema: 17 tokens in 8.2s = 2.1 tok/s
CritiqueFindingsSchema: grammar.parse OK, zod safeParse OK
CritiqueFindingsSchema: raw output (first 500 chars): {
    "questions": [
    ],
    "recommendations": [
    ]
}
---
```

`context.contextSize`: **32768** (unchanged from Task 2's Metal run — context size is a model/config property, not backend-dependent).

### Reading these numbers honestly

Only **one of six** checks (`ExtractedClaimsSchema`) produced real, substantive output at `temperature: 1.1`: 737 tokens in 70.0s = **10.5 tok/s**, CPU-only, and the raw output was visually inspected and confirmed non-empty and accurate against the transcript (the manager-approval-threshold claim, correctly quoted and attributed — matches the same content Task 2 verified).

The other five (`ClassificationSchema`, `ReconcileSchema`, `RequirementDraftsSchema`, `StoryDraftsSchema`, `CritiqueFindingsSchema`) reproduced the exact empty-array collapse from Task 2 — **despite the non-zero temperature** — even though the fixed sample inputs (2 claims, 1 requirement, 1 story) clearly warrant non-empty answers (e.g. `ClassificationSchema` should classify both of the 2 sample claims; `RequirementDraftsSchema` should draft at least one requirement from the one `kind: "requirement"` claim). Their "tok/s" figures (1.2–2.1 tok/s) are **not usable throughput numbers** — they are the time to emit a few structural-only tokens (`{ "x": [ ] }`) and must not be used for the `LOCAL_MAX_TOKENS` decision. This is exactly the false-optimism risk flagged going into this task: had this run been taken at face value, it would have reported five near-instant "successes" that are actually content-free.

**This means Task 2's finding does not generalize as hoped**: `temperature: 1.1` fixed the collapse for the one schema it was validated against, but is not a safe universal constant. A follow-up investigation (below) was run to determine whether this is fixable by tuning temperature per schema, or a deeper problem.

### Follow-up investigation: is this fixable by tuning temperature per schema?

Three additional ad hoc sweeps were run against the same already-downloaded model and the same CPU-only (`gpu: false`) config (not part of the committed script — temporary files created under `scripts/spike/.tmp-temp-sweep*.ts` so `node-llama-cpp` module resolution worked, deleted after use; single draws, `maxTokens: 512`, no repeated sampling per point):

| Schema | 1.1 | 1.3 | 1.5 | 1.7 | 2.0 |
|---|---|---|---|---|---|
| `ExtractedClaimsSchema` | ✅ correct (main run) | — | — | — | — |
| `ClassificationSchema` | ❌ empty | ✅ correct | ✅ correct | — | — |
| `ReconcileSchema` | ❌ empty | ❌ empty | — | ✅ substantive | ❌ **empty again** |
| `RequirementDraftsSchema` | ❌ empty | ❌ empty | ❌ empty | — | ✅ correct |
| `StoryDraftsSchema` | ❌ empty | ❌ empty | — | ✅ substantive | ❌ **empty again** |
| `CritiqueFindingsSchema` | ❌ empty | ✅ substantive | — | — | — |

("✅ correct/substantive" means visually verified: real, schema-appropriate, transcript-grounded content — e.g. at `temperature: 1.3`, `ClassificationSchema` correctly returned `clm-1 → requirement`, `clm-2 → assumption`; at `temperature: 2.0`, `RequirementDraftsSchema` correctly drafted "Employees must submit invoices over €10,000 to a manager for approval" sourced from `clm-1`; at `temperature: 1.7`, `ReconcileSchema` and `StoryDraftsSchema` both produced detailed, on-topic content.)

The important finding here is **not** "every schema has its own safe temperature" — it's that **the relationship is not monotonic or stable**. `ReconcileSchema` and `StoryDraftsSchema` both succeeded at `1.7` and then *regressed back to empty at `2.0`* — a higher temperature made things worse, on the same schema, in the same session. This is consistent with the empty-array collapse being a **stochastic** risk that a given temperature only lowers the probability of, not a deterministic threshold that a single "safe" constant eliminates. A single successful draw at any tested temperature is not proof that temperature is "solved" for that schema — it could as easily have landed on empty, the way `RequirementDraftsSchema` did three times in a row (`1.1`, `1.3`, `1.5`) before succeeding at `2.0`.

No single value in `[1.1, 2.0]` produced non-empty output for all six schemas. This is a materially more serious finding than Task 2's (which had evidence for one schema and treated `1.1` as a promising starting point) — the full six-schema sweep shows that lead does not generalize into one safe constant, and the underlying phenomenon appears to have a real chance component that per-schema tuning alone may not fully close.

## Constants decided by the spike

### `LOCAL_MAX_TOKENS`

Grounded in the one real, verified throughput measurement from this spike (`ExtractedClaimsSchema`, CPU-only, `temperature: 1.1`): **10.5 tok/s**.

The current spike script passes `maxTokens: context.contextSize` (32768) as the ceiling — at 10.5 tok/s that is a **~52-minute** worst-case wait for a single stage call if generation ever ran to the context limit (e.g. a decoding loop that doesn't terminate cleanly). That is not acceptable for this tool's usage pattern: `ba-story-agent` is a CLI invoked per-stage or as a pipeline run, where a human is plausibly waiting on the terminal, not a fire-and-forget background batch job.

Reasoning from "how long is an acceptable wait for one stage call," using the same style of calculation the brief's example uses: target a worst-case single-call wait of **~3 minutes** as the outer bound for a CPU-only local run (already generous relative to the Anthropic-backend path's typical latency, but the whole point of the local backend is to trade speed for cost/offline capability — a user picking it has already accepted slower turnaround, just not open-ended).

3 minutes × 60s × 10.5 tok/s ≈ 1890 tokens → round to **`LOCAL_MAX_TOKENS = 2048`** (2048 / 10.5 tok/s ≈ 195s ≈ **3.25 minutes** worst case).

Caveats on this number:
- It is derived from **one** real full-length generation (737 tokens). A larger production transcript with more claims/requirements than the thin spike fixture could legitimately need more than 2048 output tokens for `ExtractedClaimsSchema` in particular (the schema most likely to produce long output) — 2048 may truncate legitimate content on a busy transcript. Task 5 should treat this as a starting point subject to real-transcript validation, not a proven-sufficient ceiling.
- This number bounds worst-case *wait time*, but does **not** address the empty-output reliability problem above — a call can still return well within `LOCAL_MAX_TOKENS` and still be empty/degenerate. `LOCAL_MAX_TOKENS` and the temperature/decoding-reliability problem are orthogonal risks; fixing one does not fix the other.

### Effort-equivalent setting

Qwen2.5-7B-Instruct (the candidate model) has **no hybrid thinking-mode toggle** — that is a Qwen3 feature (e.g. `/think` / `/no_think` or an `enable_thinking` chat-template flag), not present in Qwen2.5's chat template or generation API. There is no generation-depth / reasoning-effort control on this model to map `LocalBackend`'s effort parameter onto.

Decision: **local path omits an effort-equivalent parameter entirely — no mapping exists for this model.** `LocalBackend` should accept and ignore (or reject with a clear no-op message, Task 5's call) any effort-level input rather than attempting to simulate it via an unrelated parameter (e.g. temperature, which is already fully committed to the decoding-reliability mitigation above and must not be double-purposed as an effort dial).

## Go/no-go

**Verdict: not a clean "proceed."** Per this task's own escalation criteria ("even with a tuned temperature you cannot get usable, non-empty output for most/all schemas... report it honestly rather than forcing a 'go' verdict") and the explicit instruction that a non-clean verdict must pause before Task 4, this section states the honest finding plainly:

- **Schema/grammar compatibility (Task 1) is solid.** No changes needed there.
- **The model can do the underlying tasks (Task 2 + this task's follow-up).** Every one of the six schemas produced correct, real, transcript-grounded content at *some* tested temperature. This is not a capability problem or a schema-shape problem.
- **There is no single decoding-parameter setting found in this spike that reliably produces usable output across all six schemas.** `temperature: 1.1` (Task 2's evidence) works for exactly one of six. Widening the sweep to `1.3`–`2.0` found *a* working value for four more schemas (`ClassificationSchema`, `CritiqueFindingsSchema` at `1.3`; `ReconcileSchema`, `StoryDraftsSchema` at `1.7`; `RequirementDraftsSchema` at `2.0`) — but the same schemas that succeeded at one temperature reverted to empty at a *higher* temperature in the same sweep (`ReconcileSchema`, `StoryDraftsSchema` at `2.0`), which means single-draw success at a given temperature is not proof that temperature is a solved variable for that schema. This looks like a probabilistic risk that per-schema tuning reduces but that this spike has not shown is eliminated.
- **Real CPU-only throughput (10.5 tok/s) and the resulting `LOCAL_MAX_TOKENS = 2048` are usable, real numbers** — that part of Task 3's job is done and grounded in verified non-empty output, not a false-optimistic empty-array measurement.

Recommendation: **proceed to Phase 1's backend-abstraction work (Task 4) is likely safe to start in parallel**, since `LlmBackend` interface design and the `AnthropicBackend`/`callTyped` refactor do not depend on how the local decoding-reliability question is eventually resolved. But **Task 5 (`local-client.ts`) cannot ship a single hardcoded default temperature and call the reliability problem solved** — before Task 5 is built, this needs one of: (a) more investigation with repeated draws per temperature per schema to characterize the failure rate rather than single-sample anecdotes, (b) an alternative mitigation (e.g. sampling parameters beyond temperature — `minP`, repetition penalty — or a detect-empty-and-retry-at-higher-temperature loop in `LocalBackend` itself), or (c) a scope/timeline conversation with the user about whether this decoding-reliability risk is acceptable to ship with a documented caveat, revisit later, or blocks the local-backend feature entirely.

Per this task's brief ("If the verdict is anything other than a clean 'proceed,' pause here and get the user's read before continuing to Task 4"), **this finding should be surfaced to the user before Task 4 is dispatched**, even though Task 4 itself is not technically blocked by it — the brief's gate is explicit and this is not a clean pass.
