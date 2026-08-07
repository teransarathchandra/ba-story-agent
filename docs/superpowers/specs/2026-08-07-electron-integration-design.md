# Electron Integration — Design Spec

**Status:** Approved 2026-08-07 (conversational approval; written up same session per the user's explicit "approve and implement" — see note in the brainstorming skill's written-spec-review gate, which this session's user instruction explicitly supersedes for this task).
**Branch:** new `feat/electron-integration`, branched from `feat/core-engine` at `90c7da1`.
**Depends on:** the local-LLM backend plan (complete, `docs/superpowers/plans/2026-08-07-local-llm-backend.md`) and the independently-built Electron review UI on `feat/electron-ui` (built by other agents — Codex and Gemini — outside this session, diverged from `feat/core-engine` at commit `d92e55d`).

## 1. Problem

Two branches of this repository each contain real, independently-built work that the other doesn't have:

- `feat/core-engine` has the complete local-LLM backend plan: the `llmBackend` per-project setting, `LocalBackend`/`AnthropicBackend` behind a shared `LlmBackend` interface, CLI backend selection, and a final-review-fixed, concurrency-safe `LocalBackend` implementation.
- `feat/electron-ui` has a real, working Electron desktop review UI whose IPC layer imports directly from this repo's `src/` and calls the actual `createProject`, `analyzeSession`, etc. — not mocked. It also independently built a transcript-amendment feature (re-editing a frozen transcript invalidates and cascades through downstream claims/requirements/stories/questions/recommendations/checkpoints) that doesn't exist on `feat/core-engine` at all.

Neither branch alone is a coherent, complete state. `feat/electron-ui`'s IPC layer hardcodes `new AnthropicBackend(createClient())` for every analyze call because the `llmBackend` setting didn't exist yet when that branch was built — so today, the Electron app cannot use the local backend at all, and has no way to expose backend choice to a user.

## 2. Goals and non-goals

**Goals:**
- Produce one branch containing both bodies of work: the full local-LLM backend plan and the full Electron review UI, including its transcript-amendment feature.
- Make the Electron app's analyze flow backend-aware: it should read a project's stored `llmBackend` setting and dispatch to `AnthropicBackend` or a real, properly-lifecycle-managed `LocalBackend`, mirroring the CLI's `selectBackend()` pattern from the local-LLM plan's Task 7 — not a separate, divergent implementation of the same idea.
- Let a user choose the backend at project-creation time in the Electron UI, mirroring the CLI's `--llm-backend` flag.
- Verify the resulting flow actually works end-to-end against a real local model — this session's environment has no `ANTHROPIC_API_KEY`, so "verify it works" necessarily means verifying the **local** backend path for real, not Claude.

**Non-goals:**
- Redesigning or polishing the Electron UI beyond the minimal backend-choice control this task requires. The UI already went through a design-review pass (the `FINDING-00X` commits on `feat/electron-ui`) — that work is preserved as-is, not revisited.
- Changing the transcript-amendment feature's behavior. It's merged in as-is; this task's scope is backend wiring, not a review of that feature's own design.
- Building UI-driven end-to-end test automation (Playwright-for-Electron or similar) as general-purpose infrastructure. None exists in this repo today, and building it is a separable investment this task doesn't need to make — see §6 for how verification is actually scoped instead.

## 3. Architecture

### 3.1 Branch reconciliation

`feat/electron-integration` is created from `feat/core-engine`, then `feat/electron-ui` is merged into it with a real `git merge` (not a rebase or cherry-pick, so both branches' histories are preserved). This is expected to merge cleanly: the two branches' independent changes to shared files (`src/store/schema.sql`, `src/types/domain.ts`, `src/store/projects.ts`) were diffed against their common ancestor (`d92e55d`) during design and found to touch non-overlapping regions — `feat/core-engine`'s Task 6 edits `projects` table columns and `createProject()`'s interior; `feat/electron-ui` adds a new `app_metadata` table and new, purely additive functions (`listProjects`, `deleteProject`, `deleteSession`) to the same files. A clean merge is expected, not guaranteed — the implementation task must actually run it and handle whatever real conflicts (if any) appear, rather than assume the diff-review holds.

### 3.2 Backend-selection wiring

`electron/src/main/ipc.ts`'s `session:analyze` handler currently constructs `new AnthropicBackend(createClient())` inline, unconditionally. This is replaced with a `selectBackend()`-shaped function — structurally the same pattern as the CLI's `selectBackend()` in `src/cli/index.ts` (Task 7 of the local-LLM plan): read the target project's `llmBackend` via `getProject()`, and for `"local"`, call `loadLocalBackend()` and thread its `release` through a `finally` around the `analyzeSession()` call; for `"claude"`, construct `AnthropicBackend(createClient())` with a no-op `release`. This is not a new design — it's the same pattern already reviewed and shipped for the CLI, applied to the second caller of `loadLocalBackend()`/`AnthropicBackend` that now exists.

Local model download progress reuses the existing `analyze:progress` IPC channel the renderer already subscribes to (via `event.sender.send('analyze:progress', { stage, status })` in the current handler) — `loadLocalBackend({ log })`'s `log` callback already produces plain progress lines (matching the CLI's `Log` pattern); the IPC handler forwards these through the same channel rather than inventing a second one, so the renderer's existing progress-display code needs no new channel to listen on.

### 3.3 UI backend choice

`electron/src/renderer/components/ProjectCreate.tsx` currently collects only `name` and `domain` (an earlier commit on `feat/electron-ui`, `ac924e0`, deliberately removed `regulatory`/`systemName` fields to simplify the form — hardcoding them to `'none'`/`undefined` in the create call). Backend choice is added as a minimal control consistent with that simplification intent: a two-option choice (Claude API / Local model), defaulting to Claude to match the CLI's default, with a short line explaining the tradeoff (local runs entirely on-device but is slower and lower-quality on judgment-heavy calls — matching the disclosed-gap framing from the local-LLM plan's own design decisions). This is not a new design decision about backend defaults or policy — it surfaces the choice that already exists at the data layer (`ProjectSchema.llmBackend`, defaulting to `"claude"`) in the one place a project is created through this UI.

The typed IPC contract (`electron/src/preload/index.ts`, `electron/src/renderer/types/api.ts`) gets `llmBackend` threaded through `project.create`'s parameter type so this is type-checked end-to-end, not passed as an untyped string.

## 4. Data flow

1. User opens "Create project" in the Electron UI, picks a backend (or accepts the Claude default), submits.
2. `window.api.project.create({ name, domain, llmBackend, ... })` → `project:create` IPC handler → `createProject(db, { ..., llmBackend })` (already supports this field since the local-LLM plan's Task 6) → persisted on the `projects` row.
3. User adds a session (existing flow, unchanged) and clicks Analyze.
4. `session:analyze` IPC handler → `getProject(db, projectId)` reads the stored `llmBackend` → the new `selectBackend()`-equivalent dispatches to `AnthropicBackend` or `loadLocalBackend()` → `analyzeSession()` runs exactly as it does today, parameterized by whichever backend was selected → `release()` always runs in a `finally`.
5. Progress streams to the renderer via the existing `analyze:progress` channel throughout — both pipeline-stage progress (already implemented) and, for the local path, model-download progress (new, via the same channel).
6. Results land in the same tables (`requirements`, `stories`, `open_questions`, `recommendations`) either backend produces them through, so the existing review-tab UI needs no changes to display them.

## 5. Error handling

A local model load failure (network interruption mid-download, insufficient disk space, etc.) rejects the `session:analyze` IPC call with a clear message; the renderer's existing `showErrorToast`/`formatErrorMessage` pattern (already used throughout the app, e.g. in `ProjectCreate.tsx`) surfaces it — no new error-handling pattern is introduced. `release()` runs in a `finally` regardless of whether `analyzeSession()` throws, so a failed local run never leaves a loaded model resident in the Electron main process.

## 6. Testing and verification

Two distinct kinds of verification apply here, and this spec is explicit about which is actually achievable with the tools available in this session:

**Automated, in this session:**
- `npm test` and `npx tsc --noEmit` clean at the repo root after the merge (Task 1) and after each subsequent wiring change.
- Electron's own `tsc`/build check (`electron/` has its own `tsconfig.json` and build script) stays clean.
- New unit test coverage for the extracted `selectBackend()`-equivalent function in `ipc.ts`, following the same mocking pattern the CLI's own tests and the local-client tests already use — verifying it dispatches to the right backend and releases correctly, without needing a real model load.
- A **real, non-mocked** functional check exercising the exact same code path the IPC handler calls (project creation with `llmBackend: "local"`, session creation, and a real `analyzeSession()` call against the already-downloaded local model from the earlier compatibility spike) — proving the wiring genuinely works against real local inference, the same rigor `scripts/run-live-eval.ts` already applies to the CLI path, just exercised through the Electron main-process code specifically.

**Not automatable in this session, disclosed rather than skipped silently:**
- This repo has no Playwright-for-Electron or equivalent UI-driving tooling, and no tool in this session's toolset can click buttons in a native Electron window. "Launch the app and click through project-create → session-add → analyze → review tabs" — the fullest form of verification — is something the user is best positioned to do themselves once the wiring is complete, using the exact steps this task will hand off. This spec does not claim GUI click-through as an automated verification step; it names it explicitly as a handoff item instead of quietly downgrading it or overclaiming it was covered.

## 7. Out of scope

- Any redesign of the Electron UI's visual system, layout, or the already-completed `FINDING-00X` design-review fixes.
- Changes to the transcript-amendment feature's behavior or the `app_metadata` table it depends on.
- Building general-purpose Electron UI test automation infrastructure.
- Any change to the local-LLM plan's own architecture, constants, or mitigation design (temperature ladder, `MAX_CONCURRENT_SEQUENCES`, `LOCAL_MAX_TOKENS`) — this task consumes that work as a stable dependency, it doesn't revisit it.
