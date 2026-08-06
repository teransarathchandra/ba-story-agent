# Local LLM Backend — Design Spec

**Status:** Approved conversationally 2026-08-06; written up and self-reviewed 2026-08-07.
**Branch:** `feat/core-engine` (continues on the same branch as Plan 1; no new branch cut for this work).
**Depends on:** Plan 1 (text-driven core engine, Claude API only) — complete, frozen, not modified by this spec.

## 1. Problem

BA Story Agent's only LLM backend today is the Anthropic API. That's a hard requirement for some prospective users: BAs on confidentiality-sensitive engagements, or on corporate laptops where sending transcript content to an external API is not permitted at all, cannot use the tool. This spec adds a second backend — a model that runs entirely on the user's machine — as an opt-in alternative to the Claude API, without changing what the tool promises (every confirmed requirement still traces to a verbatim quote, proven mechanically) or how the existing Claude path behaves.

## 2. Goals and non-goals

**Goals:**
- Let a project choose "local" instead of "Claude API" as its LLM backend, with the pipeline behaving identically from the stage logic's point of view regardless of which one is active.
- Keep the local backend fully in-process (no daemon, no background service) so it survives on locked-down corporate Windows laptops — the actual target environment for most prospective local-mode users.
- Manage model download and storage automatically; a BA should never need to locate or handle a GGUF file by hand.
- Preserve the existing egress-audit invariant (`egress_log`) for local calls too, without pretending anything left the machine.
- Know and disclose the quality gap between local and Claude output, rather than assume parity.

**Non-goals (explicitly rejected during brainstorming):**
- Per-stage hybrid routing (e.g. extraction on Claude, critique local). Rejected in favor of one backend for the whole pipeline, chosen per project.
- Gating this work on the Electron review UI (Plan 2, still unwritten). This backend is a CLI/core-engine feature now; a future UI calls into the same abstraction.
- Automatic fallback from local to Claude (or vice versa) on failure. A local generation that never validates against its schema is a hard failure, identical in shape to how the Claude path already behaves.
- Matching Claude's exact pass/fail thresholds on the adversarial eval suite. The bar is a disclosed, measured gap — not parity.

## 3. Decisions

These were made explicitly during brainstorming (2026-08-06) and are treated as settled inputs to this spec, not open questions:

1. **Scope:** switchable backend, chosen once per project, not a per-invocation flag and not a per-stage mix.
2. **Target:** the current CLI/core-engine now, not gated on Plan 2's Electron UI.
3. **Runtime:** `node-llama-cpp` (in-process Node bindings), not Ollama. See §8 for why.
4. **Gate:** a compatibility spike runs before any backend-abstraction code is written (§7).
5. **Failure handling:** retry then hard-fail, matching the existing Claude path exactly. No silent degradation, no auto-fallback to Claude.
6. **Model distribution:** the CLI auto-downloads and manages the model on first local-mode use.
7. **Config surface:** a new per-project setting, not a CLI flag.
8. **Eval gate:** the adversarial suite runs against local too and produces a disclosed comparison report; the plan is "done" when the gap is known, not when local matches Claude's thresholds.

## 4. Architecture

### 4.1 Insertion point

Every LLM call in the pipeline — across all 9 pipeline stages, of which 6 call an LLM (extraction, classification, reconciliation, requirement synthesis, story synthesis, critique) — funnels through one function: `callTyped()` in `src/llm/parse.ts`. Its current signature:

```ts
export async function callTyped<T>(args: {
  client: Anthropic;
  db: Db;
  sessionId: string;
  stage: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  effort?: Effort;
}): Promise<T>
```

It retries up to `MAX_SCHEMA_RETRIES` (2) times on schema-validation failure, feeding the validation error back into the next attempt's user turn, and throws a `StageFailure` (carrying the stage name, message, last raw response, and cause) if no attempt ever produces schema-conforming output. This retry/fail shape does not change for the local backend — see §6.

This spec introduces an `LlmBackend` interface with two implementations — the existing Anthropic path, refactored but behaviorally unchanged, and a new local path — and has `callTyped` dispatch to whichever one the calling project's `llmBackend` setting selects. The interface's exact method signatures are a plan-level detail (this spec fixes the architecture and contract, not the full type authoring), but its shape is constrained by what `callTyped` already needs to do: given a system prompt, a user prompt, and a Zod schema, produce either a value satisfying that schema or a definitive failure — no third outcome.

**What does and doesn't need to change, confirmed by reading the current code (not assumed from memory):**
- **The 9 stage files themselves (`src/pipeline/stage0..8-*.ts`) need no changes.** Each stage calls `callTyped({ client: ctx.client, ... })`, passing through whatever `ctx.client` already is — it's the caller's context object, not a type the stage file declares itself.
- **`StageContext` in `src/pipeline/runner.ts`** currently types its `client` field as `Anthropic` explicitly. This interface's `client` field type is the first thing that has to change to the new backend abstraction.
- **`analyzeSession()`'s context parameter in `src/pipeline/index.ts`**, and the two places that construct a client and pass it in — `src/cli/index.ts` (via `createClient()` from `src/llm/client.ts`) and `scripts/run-live-eval.ts` (same) — also need to construct/select a backend instead of an `Anthropic` client directly, based on the project's `llmBackend` setting.
- **`logEgress()` in `src/llm/client.ts` currently hardcodes `model: MODEL`** (the module-level `"claude-opus-5"` constant) into every `egress_log` row it writes — it does not take a model identifier as a parameter. This is a real, code-verified gap against the earlier assumption that egress logging is already backend-agnostic: it isn't, quite. `logEgress` needs a small signature change to accept the model identifier as an argument (the Anthropic path passes `MODEL` as before; the local path passes the loaded model's identifier) so a local call's `egress_log` row correctly records which local model produced it instead of silently mislabeling it `claude-opus-5`.

### 4.2 New component: `src/llm/local-client.ts`

Naming matches the existing `src/llm/client.ts`. Responsibilities:
- Load a local model into memory via `node-llama-cpp` and keep a handle to it for the lifetime of an `analyze` run.
- Translate each of the six production Zod schemas (`ExtractedClaimsSchema` in `stage1-extract.ts`, `ClassificationSchema` in `stage3-classify.ts`, `ReconcileSchema` in `stage4-reconcile.ts`, `RequirementDraftsSchema` in `stage5-requirements.ts`, `StoryDraftsSchema` in `stage6-stories.ts`, `CritiqueFindingsSchema` in `stage7-critique.ts`) to JSON Schema and then to a GBNF grammar, and run grammar-constrained generation against it.
- Implement the same retry contract `callTyped` already expects: on a schema-validation failure, feed the error back in and retry, up to the same `MAX_SCHEMA_RETRIES`; on exhaustion, let `callTyped` raise `StageFailure` exactly as it does today.
- Report model-download progress through the existing `Log` callback shape already defined in `src/cli/index.ts` (`type Log = (line: string) => void`, threaded into `buildProgram(opts?: { log?: Log })`) — no new logging convention introduced.

### 4.3 Model lifecycle

Loaded once at the start of an `analyzeSession()` run, held resident across that run's stage calls, released when the run completes. Not loaded per-stage-call — reloading a multi-GB model repeatedly within one run would be far too slow to be usable. This mirrors how the Anthropic `client` is already constructed once per run and threaded through `StageContext`.

### 4.4 Model distribution

On first local-mode use, the CLI downloads the selected GGUF model file, stores it in an OS-appropriate application-data directory (e.g. via a package such as `env-paths` or Node's own platform conventions — exact mechanism decided at implementation time), and reuses the cached copy on subsequent runs. No manual file handling by the user. Download progress reports through the same `Log` callback used elsewhere in `buildProgram`.

### 4.5 Config surface

A new field on the project settings, alongside the existing `regulatoryContext` / `systemName` / `glossary` fields already defined in `ProjectSchema` (`src/types/domain.ts`) and the `projects` table (`src/store/schema.sql`):

```ts
llmBackend: z.enum(["claude", "local"])
```

Following the existing pattern exactly: a new nullable-or-defaulted column on `projects` (`llm_backend TEXT NOT NULL DEFAULT 'claude'`, mirroring how `regulatory_context` already defaults to `'none'`), a matching field on `ProjectSchema`, and a new `--llm-backend <claude|local>` option on `project create` in `src/cli/index.ts`, following the existing `--regulatory <context>` option exactly (required-with-default, parsed and validated the same way `RegulatoryContext.parse(o.regulatory)` already validates today).

### 4.6 `egress_log`

No table schema change needed — confirmed by reading `src/store/schema.sql`: the `egress_log` table's `model` column is a plain `TEXT NOT NULL` with no Anthropic-specific constraint, and the table is deliberately not foreign-key-bound to `sessions` (so a session delete can never erase the compliance record — this was a Task 3 human ruling in Plan 1 and is preserved unchanged). What does need a change is the `logEgress()` *function*, per §4.1 — it must accept the model identifier as a parameter instead of hardcoding the Anthropic `MODEL` constant. Local calls get a normal `egress_log` row: stage, request hash, prompt/completion token counts, and a `model` value that identifies the local model (e.g. its GGUF filename or a model-card identifier) instead of `claude-opus-5`.

## 5. Data flow

1. A BA runs `bsa project create ... --llm-backend local` (or `claude`, the default). The choice is persisted on the `projects` row.
2. A BA runs `bsa analyze ...` against a session in that project. `analyzeSession()` reads the project's `llmBackend` setting and constructs the corresponding backend — an `Anthropic` client via the existing `createClient()`, or a `local-client.ts` instance that loads the cached model (downloading it first if this is the first local-mode use in this environment, reporting progress via `log`).
3. The backend instance is threaded into `StageContext.client` exactly as the `Anthropic` client is today.
4. Each of the 6 LLM-calling stages calls `callTyped({ client: ctx.client, ... })` unchanged. `callTyped` dispatches internally based on which backend it received: Anthropic path uses `zodOutputFormat` + `client.messages.parse` as it does today; local path uses the GBNF-grammar-constrained generation in `local-client.ts`.
5. Every call — either backend — writes one `egress_log` row via `logEgress()` (now backend-parameterized per §4.1) once a response with usable token/generation counts comes back.
6. On completion (success or exhausted-retries failure), the model handle is released if it was the local backend; the run's stage checkpoints and artifacts are written exactly as they are today, regardless of which backend produced them.

## 6. Error handling

Identical policy to the existing Claude path, deliberately: `callTyped` retries up to `MAX_SCHEMA_RETRIES` (2) times total per call, appending the validation error to the next attempt's prompt each time, and raises `StageFailure` (stage name, message, last raw response, cause) if no attempt ever validates. The local backend's implementation must satisfy this same contract from the outside — `callTyped`'s calling code and the stage files that depend on its throw/return behavior do not need to know which backend produced the failure.

Explicitly rejected: silently falling back to the Claude API when local generation fails schema validation after retries, or vice versa. If the compatibility spike (§7) finds a schema that genuinely cannot be grammar-constrained reliably on the local runtime, that is a schema-design problem to solve directly (see §7's carried risk), not a case for a hidden runtime fallback.

## 7. The compatibility spike (runs first, before any backend-abstraction code)

Two things get measured empirically before the architecture in §4 gets built out, because both are currently unknown facts, not assumptions:

**7.1 Schema compatibility.** Convert each of the six production schemas listed in §4.2 to JSON Schema and grammar-fire them through `node-llama-cpp` with a real candidate model. llama.cpp's GBNF grammar engine has open, current, platform-independent bugs in this area: nested `$ref`/`$defs` resolution, `maxLength` constraints inside nested schemas, empty-object schemas, and stack overflow on deeply nested/recursive schemas. Whether any of these six specific schemas trip one of these bugs is unknown until tested directly — this is the spike's primary go/no-go question. If a schema does trip a bug, the fallback is reshaping that schema's *local-path* representation (e.g. flattening a nested array-of-objects) while keeping its semantic content and Claude-path shape unchanged — a genuine local/Claude schema divergence, to be resolved with whatever the spike actually finds, not pre-solved here.

**7.2 CPU-only throughput.** Measure real tokens/sec for an 8–12B-class model with no discrete GPU (CPU-only inference), because the target user base skews toward corporate laptops with integrated graphics rather than a discrete GPU. No current hard benchmark data exists for this combination. If throughput is too low for a BA to use in practice, that is a bigger blocker than any schema bug and must be known before the rest of this plan is built on an assumption that CPU-only local inference is viable at all.

Both checks are a go/no-go gate on the implementation plan derived from this spec, not general early-task scaffolding — the plan built from this spec should treat the spike as its own explicit first phase.

## 8. Why `node-llama-cpp`, not Ollama

Two research passes (summarized here; see the prior handoff document for the full trail) initially recommended Ollama for its Apple-Silicon MLX routing and mature structured-output support, then reversed that recommendation after the actual target user base was established: **~99% of end users are on Windows laptops, not Macs.**

On Windows, Ollama loses its MLX advantage entirely (MLX doesn't exist there) and falls back to the same CUDA-or-CPU/llama.cpp path `node-llama-cpp` already uses — so structured-output reliability is a wash between the two runtimes on the actual target platform, not a point in Ollama's favor. What decided the choice instead is corporate-IT deployability: Ollama's daemon (`ollama_llama_server.exe`) has documented history of being flagged as malware by Avast, blocked by Windows Defender on update, and blocked outright by Windows 11 24H2's Smart App Control — every fix requires admin rights a locked-down corporate laptop (the actual target persona: a BA, not a developer) does not have. `node-llama-cpp` runs in-process inside the already-running CLI: no separate executable, no background daemon, no listening port for corporate EDR to flag. The GBNF grammar bug risk described in §7.1 is confirmed identical for both runtimes on Windows, so it is a mandatory spike item regardless of runtime choice, not a differentiator between them.

**This decision should not be silently re-litigated back to Ollama** without re-reading this reasoning — the deciding factor was corporate-IT friction on the real target platform, not a technical capability gap.

## 9. Not directly portable from the Claude path — resolved by the spike, not by this spec

Two of the Claude path's tuning constants have no portable local-model equivalent. Rather than invent placeholder values here, this spec fixes them as concrete, sequenced deliverables of the compatibility spike (§7) — the spike must produce both before backend-abstraction implementation starts, because both depend on which model the spike settles on:

- **`effort` (low/medium/high/xhigh/max)** — Claude's structured-output "thinking depth" dial has no generic local-model equivalent; where the candidate model has its own depth control (e.g. Qwen3's hybrid thinking mode), the spike must record what setting was used and why. If the chosen model has no such control, the local path simply omits the concept rather than faking a mapping.
- **`MAX_TOKENS`** — the local path needs its own `LOCAL_MAX_TOKENS` constant, analogous to `client.ts`'s existing `MAX_TOKENS = 16000`. Its value is fixed by §7.2's measured tokens/sec and the candidate model's practical context window, not chosen ahead of that measurement — a number picked before the spike runs would be a guess dressed up as a spec decision.

Both values are recorded as part of the spike's findings and become fixed constants in `local-client.ts` from that point on — they are not re-opened as design questions once the spike concludes.

## 10. Testing and the eval gate

The existing adversarial fixture suite (`tests/eval/adversarial.test.ts`, `tests/fixtures/golden/expectations.json`, `scripts/run-live-eval.ts`, all delivered in Plan 1's Task 27) gets parameterized to run against the local backend as well as Claude, producing a report that compares the two rather than asserting local must clear Claude's exact thresholds (per decision 8, §3).

**A pre-existing gap in `run-live-eval.ts`, confirmed by reading the current file, should be fixed as part of this parameterization work** (it predates this spec and was already flagged in Plan 1's closing self-review, but is directly relevant here since local-mode eval depends on this same script): the `Expectation` interface declares `minContradictions?: number`, but the check loop never reads it — no local fixture's contradiction-count expectation is actually enforced despite being typed and present in `tests/fixtures/golden/expectations.json` for `02-contradiction`. Two further fields present in that same golden file, `mustNotAutoResolve` (`02-contradiction`) and `hallucinationRate` (`05-clean-baseline`), aren't in the `Expectation` interface at all, so they're silently ignored at parse time. Since the local/Claude comparison report this spec calls for depends on this script actually enforcing what the golden file declares, these three fields need real check-loop implementations before the comparison report can be trusted.

Every source consulted during research agreed that a model sized to fit a realistic RAM budget will measurably underperform Claude specifically on judgment-heavy calls — hedge vs. firm language, genuine contradiction vs. compatible statement. The comparison report is expected to surface exactly this kind of gap; the plan is done when it's measured and disclosed, not when it disappears.

## 11. Out of scope for this spec

- The Electron review UI (Plan 2) and ASR/capture (Plan 3) — unaffected; a future UI calls into the same `LlmBackend` abstraction described here.
- Per-stage backend mixing — explicitly rejected in §2/§3.
- Automatic backend fallback on failure — explicitly rejected in §2/§6.
- Closing the local/Claude quality gap — explicitly out of scope per decision 8; the gate is disclosure, not parity.
- Fixing the two items Plan 1's closing self-review left deliberately unfixed (`listProjectClaims`'s single-session-only test coverage; anything about `run-live-eval.ts` *other* than the `Expectation` fields this spec's own eval-gate work depends on) — those remain frozen per the explicit instruction to leave Plan 1's implementation as-is, except where, as in §10, this spec's own new functionality directly depends on fixing them.
