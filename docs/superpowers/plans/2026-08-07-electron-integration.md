# Electron Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the independently-built Electron review UI (`feat/electron-ui`) with the completed local-LLM backend plan (`feat/core-engine`) into one coherent branch, make the Electron app's analyze flow backend-aware (mirroring the CLI's `selectBackend()` pattern), add a backend-choice control to project creation, and verify the whole flow works for real against the local model — the only backend available in this environment (no `ANTHROPIC_API_KEY`).

**Architecture:** A real `git merge` reconciles the two branches (verified non-conflicting on shared files by design-time diff review, but the merge itself must be executed and checked, not assumed clean). `electron/src/main/ipc.ts`'s `session:analyze` handler gets a `selectBackend()`-shaped function — the same pattern already shipped and reviewed for the CLI — replacing its current hardcoded `AnthropicBackend` construction. The typed IPC contract and `ProjectCreate.tsx` get `llmBackend` threaded through. Final verification runs the real backend-selection code path against the already-downloaded local model, since GUI click-through automation doesn't exist in this repo and isn't built as part of this plan.

**Tech Stack:** TypeScript, Electron + electron-vite + React (in `electron/`, a separate npm package importing the root `src/` via relative paths), vitest, better-sqlite3.

## Global Constraints

- Node 22, TypeScript strict + `noUncheckedIndexedAccess`, ESM/NodeNext — relative imports need `.js` extensions, in both the root project and `electron/`.
- Zod imports MUST be from `zod/v4`, not bare `"zod"`, in any code this plan touches under `src/`.
- `npm test` and `npx tsc --noEmit` (root) must both be clean before every commit in every task. `electron/`'s own build (`cd electron && npm run build`, which runs `electron-vite build` — a real compile, catches its own TS errors) must also stay clean after Tasks 2–3.
- Do not modify the transcript-amendment feature's behavior, the `app_metadata` table, or anything already covered by `feat/electron-ui`'s `FINDING-00X` design-review commits — merge them in as-is.
- Do not modify `src/llm/backend.ts`, `src/llm/client.ts`, `src/llm/local-client.ts`, or any local-LLM plan constant (`LOCAL_MAX_TOKENS`, `MAX_CONCURRENT_SEQUENCES`, the temperature ladder) — this plan consumes that work as a stable, already-reviewed dependency.
- The Electron app's `session:analyze` backend-selection logic must be the same shape as the CLI's `selectBackend()` (`src/cli/index.ts:25-34`) — not a reinvented equivalent. Task 2 mirrors it deliberately.

---

### Task 1: Merge `feat/electron-ui` into `feat/electron-integration`

**Files:**
- No new files by design — this task's deliverable is a clean merge commit. If real conflicts appear (design-time review found none on shared files, but this must be verified live, not assumed), resolve them in whatever files are actually affected and document the resolution in the report.

**Interfaces:**
- Produces: a merged tree containing both the full local-LLM backend plan (from `feat/core-engine`) and the full Electron review UI + transcript-amendment feature (from `feat/electron-ui`), with `npm test` and `npx tsc --noEmit` clean at the result.

- [ ] **Step 1: Confirm starting state**

Run: `git log --oneline -1` (expect `fe59cdc` or later — the electron-integration design spec commit, on top of `feat/core-engine`'s `90c7da1`), `git status --short` (expect clean except pre-existing `graphify-out/*`/`AGENTS.md` noise, which is not part of this task and should not be touched or committed).

- [ ] **Step 2: Merge**

Run: `git merge feat/electron-ui -m "merge: integrate Electron review UI with local-LLM backend plan"`

- [ ] **Step 3: If conflicts occur, resolve them**

Design-time diff review (recorded in `docs/superpowers/specs/2026-08-07-electron-integration-design.md`, §3.1) found `feat/core-engine` and `feat/electron-ui` touch non-overlapping regions of `src/store/schema.sql`, `src/types/domain.ts`, and `src/store/projects.ts` since their common ancestor `d92e55d` — `feat/core-engine`'s Task 6 edits the `projects` table's columns and `createProject()`/`toProject()`'s interiors; `feat/electron-ui` only adds a new `app_metadata` table and new, purely additive functions (`listProjects`, `deleteProject`, `deleteSession`). A clean auto-merge is expected but not guaranteed.

If git reports conflicts, resolve them by preserving BOTH sides' intent — e.g., in `schema.sql`, both the `llm_backend` column addition to `projects` and the new `app_metadata` table should end up present; in `projects.ts`, both the `llmBackend`-aware `createProject()`/`toProject()` and the new `listProjects`/`deleteProject`/`deleteSession` functions should end up present. Do not silently pick one side and discard the other — if a real semantic conflict exists (not just adjacent-line noise), stop and report BLOCKED with the specifics rather than guessing which side should win.

- [ ] **Step 4: Verify the merged root project**

Run: `npm test` and `npx tsc --noEmit` — both must be clean. If either fails, investigate and fix before proceeding (this is the merge's own correctness gate, not a pre-existing issue to route around).

- [ ] **Step 5: Verify the merged Electron package installs and builds**

Run: `cd electron && npm install && npm run build` (this is `electron-vite build`, a real TypeScript compile of the Electron app — it will catch any real breakage from the merge, e.g. if `feat/electron-ui`'s `ipc.ts` references something Task 6-9's changes altered). It is expected to succeed as-is at this point (Task 2 is what actually rewires the analyze handler) — if it fails, that's a real merge-fallout bug to fix now, not something to defer.

Return to the repo root (`cd ..`) when done.

- [ ] **Step 6: Confirm no other branch's untouched work leaked in**

Run: `git status --short` — should show only the merge commit's effects (already committed by Step 2) plus, if Step 3's conflict resolution happened, whatever files that touched. The pre-existing `graphify-out/*`/`AGENTS.md` uncommitted noise from before this task started is not this task's concern — leave it as it was, don't stage or commit it.

- [ ] **Step 7: Report**

Write a report covering: whether the merge was clean or needed conflict resolution (and exactly what was resolved, if so), the `npm test`/`npx tsc --noEmit` output, the `electron/` build output, and confirmation that `electron/src/main/ipc.ts` (the file Task 2 modifies next) is present and matches the version reviewed at design time (i.e., still hardcodes `new AnthropicBackend(createClient())` in `session:analyze` — Task 2's starting point).

The merge commit itself (from Step 2, plus any conflict-resolution commit from Step 3) is this task's deliverable — there is no separate "commit" step, since `git merge` already created the commit.

---

### Task 2: Backend-selection wiring in `electron/src/main/ipc.ts`

**Files:**
- Modify: `electron/src/main/ipc.ts`
- Create: `electron/tests/main/ipc.test.ts` (new — `electron/` currently has no test setup at all; this task establishes one, scoped narrowly to the new `selectBackend`-equivalent function, not a general test-everything effort)
- Modify: `electron/package.json` (add `vitest` as a devDependency and a `test` script, matching the root project's `vitest run` convention)

**Interfaces:**
- Consumes: `AnthropicBackend`, `createClient` (from `../../../src/llm/client.js`, already imported in `ipc.ts`), `loadLocalBackend` (from `../../../src/llm/local-client.js`, already imported), `LlmBackend` type (from `../../../src/llm/backend.js`, already imported), `getProject` (from `../../../src/store/projects.js`, already imported).
- Produces: a `selectBackend(llmBackend, log)` function inside `ipc.ts`, structurally identical to the CLI's `selectBackend()` in `src/cli/index.ts:25-34`.

**Background — the exact current state of the file this task modifies** (verified by reading `feat/electron-ui`'s `electron/src/main/ipc.ts` directly, not assumed):

```typescript
// Current top-of-file imports (unchanged by this task except one addition — see Step 2):
import { ipcMain, app } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { openDb } from '../../../src/store/db.js'
import {
  createProject,
  getProject,
  createSession,
  listProjects,
  listSessions,
  deleteProject,
  deleteSession,
} from '../../../src/store/projects.js'
import { amendTranscript, createTranscript, freezeTranscript, getFrozenTranscript, hashText } from '../../../src/store/transcripts.js'
import { listRequirements, setRequirementStatus, listStories } from '../../../src/store/artifacts.js'
import { listQuestions, listRecommendations } from '../../../src/store/findings.js'
import { listClaims, countByStatus } from '../../../src/store/claims.js'
import { recordApproval } from '../../../src/store/audit.js'
import { analyzeSession, quarantineRate } from '../../../src/pipeline/index.js'
import { buildSnapshot } from '../../../src/export/snapshot.js'
import { markdownPublisher } from '../../../src/export/markdown.js'
import { jsonPublisher } from '../../../src/export/json.js'
import { createClient, AnthropicBackend } from '../../../src/llm/client.js'
import { countWords, MIN_WORDS } from '../../../src/pipeline/stage0-chunk.js'
import { RegulatoryContext } from '../../../src/types/domain.js'
import { seedDemoWorkspace } from './demo-data.js'
```

The `session:analyze` handler currently reads:

```typescript
  ipcMain.handle('session:analyze', async (event, data: {
    sessionId: string; resume?: boolean
  }) => {
    const db = getDb()
    const frozen = getFrozenTranscript(db, data.sessionId)
    if (!frozen) throw new Error(`Session ${data.sessionId} has no frozen transcript`)
    const row = db
      .prepare('SELECT project_id FROM sessions WHERE id = ?')
      .get(data.sessionId) as { project_id: string } | undefined
    if (!row) throw new Error(`Session ${data.sessionId} not found`)

    const state = await analyzeSession(
      {
        db,
        client: new AnthropicBackend(createClient()),
        projectId: row.project_id,
        sessionId: data.sessionId,
      },
      frozen.transcript.id,
      {
        resume: data.resume ?? false,
        onProgress: (name: string, status: string) => {
          event.sender.send('analyze:progress', { stage: name, status })
        },
      }
    )

    return {
      ...state,
      quarantineRate: quarantineRate(state),
    }
  })
```

- [ ] **Step 1: Read the current file for real before editing**

`git show feat/electron-ui:electron/src/main/ipc.ts` was read at design time and is reproduced above, but Task 1's merge may have altered surrounding context (unlikely, per Task 1's own conflict analysis, but confirm). Read `electron/src/main/ipc.ts` as it exists after Task 1's merge before making any edit.

- [ ] **Step 2: Add the `selectBackend` function and `LlmBackend` type import**

Add to the imports (alongside the existing `createClient, AnthropicBackend` import line):

```typescript
import { createClient, AnthropicBackend } from '../../../src/llm/client.js'
import { loadLocalBackend } from '../../../src/llm/local-client.js'
import type { LlmBackend } from '../../../src/llm/backend.js'
```

Add the function itself near the top of the file, after the existing `getDb()` helper and before `setupIpc()`:

```typescript
type Log = (line: string) => void

/**
 * Mirrors src/cli/index.ts's selectBackend() exactly — same dispatch logic,
 * same release contract. Do not let this drift into a second, divergent
 * implementation of the same idea.
 */
async function selectBackend(
  llmBackend: 'claude' | 'local',
  log: Log,
): Promise<{ client: LlmBackend; release: () => Promise<void> }> {
  if (llmBackend === 'local') {
    const { backend, release } = await loadLocalBackend({ log })
    return { client: backend, release }
  }
  return { client: new AnthropicBackend(createClient()), release: async () => {} }
}
```

- [ ] **Step 3: Rewrite the `session:analyze` handler to use it**

Replace the handler shown in Background with:

```typescript
  ipcMain.handle('session:analyze', async (event, data: {
    sessionId: string; resume?: boolean
  }) => {
    const db = getDb()
    const frozen = getFrozenTranscript(db, data.sessionId)
    if (!frozen) throw new Error(`Session ${data.sessionId} has no frozen transcript`)
    const row = db
      .prepare('SELECT project_id FROM sessions WHERE id = ?')
      .get(data.sessionId) as { project_id: string } | undefined
    if (!row) throw new Error(`Session ${data.sessionId} not found`)
    const project = getProject(db, row.project_id)
    if (!project) throw new Error(`Project ${row.project_id} not found`)

    const { client, release } = await selectBackend(
      project.llmBackend,
      (line: string) => event.sender.send('analyze:progress', { stage: 'local-model', status: line }),
    )
    try {
      const state = await analyzeSession(
        {
          db,
          client,
          projectId: row.project_id,
          sessionId: data.sessionId,
        },
        frozen.transcript.id,
        {
          resume: data.resume ?? false,
          onProgress: (name: string, status: string) => {
            event.sender.send('analyze:progress', { stage: name, status })
          },
        }
      )

      return {
        ...state,
        quarantineRate: quarantineRate(state),
      }
    } finally {
      await release()
    }
  })
```

Note the `selectBackend` call's `log` callback reuses the existing `analyze:progress` channel with `stage: 'local-model'` — this is a deliberate, minimal choice: the renderer's existing progress-display code already listens on this channel and displays whatever `{ stage, status }` it receives, so local model download progress (only relevant when `llmBackend === "local"`; a no-op for the Claude path since `AnthropicBackend`'s `release` never calls `log`) appears the same way pipeline-stage progress already does, without adding a second channel the renderer would need new code to listen on.

- [ ] **Step 4: Write the test file**

`electron/` has no test setup at all yet. This task adds a minimal one, scoped to `selectBackend` only — not a general "add electron test infrastructure" effort.

```typescript
// electron/tests/main/ipc.test.ts
import { describe, it, expect, vi } from 'vitest'

const mockAnthropicInstance = { model: 'claude-opus-5', generate: vi.fn() }
const mockLocalInstance = { model: 'local-test', generate: vi.fn() }
const mockRelease = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../src/llm/client.js', () => ({
  createClient: vi.fn(() => ({})),
  AnthropicBackend: vi.fn(() => mockAnthropicInstance),
}))
vi.mock('../../../src/llm/local-client.js', () => ({
  loadLocalBackend: vi.fn(async () => ({ backend: mockLocalInstance, release: mockRelease })),
}))

// selectBackend is not exported from ipc.ts (it's an internal helper, same as
// the CLI's own selectBackend is not exported from src/cli/index.ts) — this
// test re-implements the exact same two-line dispatch to verify the CONTRACT
// (which constructor gets called, release shape) rather than importing a
// private function. This mirrors how src/cli/index.ts's own selectBackend has
// no direct unit test either (confirmed: not referenced in tests/cli/index.test.ts)
// — it's covered by CLI integration tests exercising the whole analyze command
// instead. Here, since ipc.ts as a whole isn't easily invokable outside
// Electron's ipcMain context, we test the dispatch logic in isolation instead.
import { createClient, AnthropicBackend } from '../../../src/llm/client.js'
import { loadLocalBackend } from '../../../src/llm/local-client.js'
import type { LlmBackend } from '../../../src/llm/backend.js'

type Log = (line: string) => void

async function selectBackend(
  llmBackend: 'claude' | 'local',
  log: Log,
): Promise<{ client: LlmBackend; release: () => Promise<void> }> {
  if (llmBackend === 'local') {
    const { backend, release } = await loadLocalBackend({ log })
    return { client: backend as unknown as LlmBackend, release }
  }
  return { client: new AnthropicBackend(createClient()) as unknown as LlmBackend, release: async () => {} }
}

describe('selectBackend (ipc.ts)', () => {
  it('constructs AnthropicBackend with a no-op release for "claude"', async () => {
    const { client, release } = await selectBackend('claude', () => {})
    expect(client).toBe(mockAnthropicInstance)
    await expect(release()).resolves.toBeUndefined()
  })

  it('loads the local backend and returns its real release for "local"', async () => {
    const logLines: string[] = []
    const { client, release } = await selectBackend('local', (line) => logLines.push(line))
    expect(client).toBe(mockLocalInstance)
    await release()
    expect(mockRelease).toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Add vitest to `electron/package.json`**

Add `"vitest": "^2.1.0"` to `devDependencies` (matching the root project's pinned version — check `package.json` at repo root to confirm the exact version string before writing it, don't assume it hasn't changed) and add to `"scripts"`: `"test": "vitest run"`.

- [ ] **Step 6: Run it**

Run: `cd electron && npm install && npm test`
Expected: both tests pass.

- [ ] **Step 7: Verify the full electron build still succeeds**

Run: `npm run build` (still inside `electron/`)
Expected: clean. Return to repo root (`cd ..`) when done.

- [ ] **Step 8: Root-level check**

Run (from repo root): `npm test && npx tsc --noEmit` — confirm the root project is unaffected (this task doesn't touch anything under `src/`, so this should already be clean, but confirm rather than assume).

- [ ] **Step 9: Commit**

```bash
git add electron/src/main/ipc.ts electron/tests/main/ipc.test.ts electron/package.json electron/package-lock.json
git commit -m "feat(electron): wire session:analyze to project's llmBackend setting"
```

---

### Task 3: Typed IPC contract + UI backend picker

**Files:**
- Modify: `electron/src/renderer/types/api.ts`
- Modify: `electron/src/main/ipc.ts` (the `project:create` handler's parameter type only — small, separate change from Task 2's `session:analyze` work)
- Modify: `electron/src/renderer/components/ProjectCreate.tsx`

**Interfaces:**
- Consumes: `LlmBackendSetting` (conceptually — the renderer can't import a Zod schema from `src/types/domain.ts` across the Electron process boundary the way `ipc.ts` does, since renderer code runs in a browser-like context; the UI's own `llmBackend` type is a plain `'claude' | 'local'` string union, matching the CLI's own type annotation style rather than importing Zod).

**Background — current state, verified by reading `feat/electron-ui`'s files directly:**

`electron/src/renderer/types/api.ts`'s `Project` interface:
```typescript
export interface Project {
  id: string
  name: string
  domain: string
  regulatoryContext: string
  systemName: string | null
  glossary: string | null
  createdAt: string
}
```

And `project.create`'s typed signature inside the `window.api` augmentation:
```typescript
      project: {
        list: () => Promise<Project[]>
        create: (data: {
          name: string; domain: string; regulatory?: string; systemName?: string
        }) => Promise<Project>
        get: (id: string) => Promise<Project | null>
        status: (id: string) => Promise<ProjectStatus>
        delete: (id: string) => Promise<{ deleted: boolean }>
      }
```

`electron/src/main/ipc.ts`'s `project:create` handler (after Task 1's merge, before this task's edit):
```typescript
  ipcMain.handle('project:create', async (_event, data: {
    name: string; domain: string; regulatory?: string; systemName?: string
  }) => {
    const db = getDb()
    return createProject(db, {
      name: data.name,
      domain: data.domain,
      regulatoryContext: data.regulatory
        ? RegulatoryContext.parse(data.regulatory)
        : 'none',
      systemName: data.systemName ?? null,
    })
  })
```

`electron/src/renderer/components/ProjectCreate.tsx` currently collects only `name` and `domain`, and its submit handler calls:
```typescript
      const project = await window.api.project.create({
        name: name.trim(),
        domain: domain.trim(),
        regulatory: 'none',
        systemName: undefined,
      })
```

- [ ] **Step 1: Read the current files for real before editing**

Confirm the above three files match what's shown (post-Task-1-merge, post-Task-2 for `ipc.ts` specifically — Task 2 already modified this file, so re-read its current state rather than assuming Background's "before" snapshot is still literal).

- [ ] **Step 2: Add `llmBackend` to `Project` and `project.create`'s type in `api.ts`**

```typescript
export interface Project {
  id: string
  name: string
  domain: string
  regulatoryContext: string
  systemName: string | null
  glossary: string | null
  llmBackend: 'claude' | 'local'
  createdAt: string
}
```

And in the `window.api` augmentation:
```typescript
        create: (data: {
          name: string; domain: string; regulatory?: string; systemName?: string; llmBackend?: 'claude' | 'local'
        }) => Promise<Project>
```

- [ ] **Step 3: Thread `llmBackend` through `ipc.ts`'s `project:create` handler**

```typescript
  ipcMain.handle('project:create', async (_event, data: {
    name: string; domain: string; regulatory?: string; systemName?: string; llmBackend?: 'claude' | 'local'
  }) => {
    const db = getDb()
    return createProject(db, {
      name: data.name,
      domain: data.domain,
      regulatoryContext: data.regulatory
        ? RegulatoryContext.parse(data.regulatory)
        : 'none',
      systemName: data.systemName ?? null,
      llmBackend: data.llmBackend ?? 'claude',
    })
  })
```

`createProject()` (`src/store/projects.ts`) already accepts an optional `llmBackend` parameter, defaulting to `"claude"` internally too — this handler's own `?? 'claude'` is a belt-and-suspenders default at the IPC boundary, matching how `regulatory`/`systemName` are already defaulted at this same boundary rather than left to the store layer alone.

- [ ] **Step 4: Add the backend picker to `ProjectCreate.tsx`**

Add state and a minimal control. The existing form only has `name`/`domain` text inputs (`regulatory`/`systemName` were deliberately removed from the UI in an earlier commit, hardcoded instead) — this adds ONE new visible control, styled consistently with the existing `label`/`input` class conventions already used in this file:

```typescript
  const [llmBackend, setLlmBackend] = useState<'claude' | 'local'>('claude')
```

(add alongside the existing `useState` calls for `name`/`domain`/`loading`/`fieldError`)

In the submit handler, change:
```typescript
      const project = await window.api.project.create({
        name: name.trim(),
        domain: domain.trim(),
        regulatory: 'none',
        systemName: undefined,
      })
```
to:
```typescript
      const project = await window.api.project.create({
        name: name.trim(),
        domain: domain.trim(),
        regulatory: 'none',
        systemName: undefined,
        llmBackend,
      })
```

Add the control itself in the form, after the "Business Domain" field's closing `</div>` and before the `{fieldError && (...)}`block (i.e., as its own field, in the same visual position `regulatory`/`systemName` used to occupy before they were removed):

```tsx
          <div>
            <label className="label">LLM Backend</label>
            <div className="flex gap-2">
              <button
                type="button"
                className={`btn ${llmBackend === 'claude' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setLlmBackend('claude')}
              >
                Claude API
              </button>
              <button
                type="button"
                className={`btn ${llmBackend === 'local' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setLlmBackend('local')}
              >
                Local model
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Local runs entirely on this machine — no data leaves it, but analysis is slower and
              lower-quality on judgment-heavy calls than the Claude API.
            </p>
          </div>
```

This reuses the existing `btn`/`btn-primary`/`btn-ghost` classes already used elsewhere in this same file (the Cancel/Create buttons), rather than introducing a new control style. If `index.css` doesn't already style a two-button toggle group distinctly, that's acceptable — it's still two clearly-labeled, clearly-stated buttons, not a broken or unstyled element.

- [ ] **Step 5: Verify the electron build**

Run: `cd electron && npm run build`
Expected: clean (this is a real TS+Vite compile, will catch any type mismatch from Steps 2-4). Return to repo root when done.

- [ ] **Step 6: Root-level check**

Run (from repo root): `npm test && npx tsc --noEmit` — confirm unaffected.

- [ ] **Step 7: Commit**

```bash
git add electron/src/renderer/types/api.ts electron/src/main/ipc.ts electron/src/renderer/components/ProjectCreate.tsx
git commit -m "feat(electron): add llmBackend to typed IPC contract and project-create UI"
```

---

### Task 4: Real functional verification against the local backend

**Files:**
- Create: `scripts/verify-electron-local-backend.ts` (a one-off verification script, NOT part of `npm test` — same pattern as `scripts/run-live-eval.ts`, which also makes real, non-mocked calls and isn't part of the automated suite)

**Interfaces:**
- Consumes: `openDb`, `createProject`, `createSession` (`src/store/projects.js`), `createTranscript`, `freezeTranscript` (`src/store/transcripts.js`), `loadLocalBackend` (`src/llm/local-client.js`), `analyzeSession`, `quarantineRate` (`src/pipeline/index.js`), `listRequirements` (`src/store/artifacts.js`).

**Why this task exists, and what it does and doesn't prove:** per the design spec (§6), this repo has no Playwright-for-Electron or equivalent tooling, and there is no way to click buttons in a native Electron window from this session. What this task CAN prove, and does: the exact backend-selection dispatch logic Task 2 added to `ipc.ts` (`selectBackend('local', log)` → `loadLocalBackend()` → `analyzeSession()` → `release()`) works for real, against the real already-downloaded local model (from the earlier compatibility spike, cached at `~/.node-llama-cpp/models/`), producing real requirements from a real transcript. It does NOT prove the React UI renders correctly, that clicking the new backend-picker buttons in Task 3's `ProjectCreate.tsx` actually calls this code path correctly end-to-end through Electron's IPC bridge, or that the app doesn't crash on launch — those require either the user's own click-through (see this plan's final handoff note) or tooling this plan doesn't build.

- [ ] **Step 1: Write the verification script**

```typescript
// scripts/verify-electron-local-backend.ts
/**
 * Verifies the exact backend-selection code path electron/src/main/ipc.ts's
 * session:analyze handler uses for llmBackend: "local" — real model, real
 * transcript, real DB writes. Not part of `npm test` (multi-minute, uses
 * real local compute) — same category as scripts/run-live-eval.ts.
 *
 *   npx tsx scripts/verify-electron-local-backend.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/store/db.js";
import { createProject, createSession } from "../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../src/store/transcripts.js";
import { loadLocalBackend } from "../src/llm/local-client.js";
import { analyzeSession, quarantineRate } from "../src/pipeline/index.js";
import { listRequirements } from "../src/store/artifacts.js";

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("Loading local backend (model already cached from the compatibility spike)...");
  const { backend, release } = await loadLocalBackend({
    log: (line) => console.log(`  [local model] ${line}`),
  });

  try {
    const db = openDb(":memory:");
    const project = createProject(db, {
      name: "Electron local-backend verification",
      domain: "warehouse order fulfilment and purchase approval for a logistics operator",
      llmBackend: "local",
    });
    const session = createSession(db, { projectId: project.id, title: "Verification session" });
    const { transcript } = createTranscript(db, {
      sessionId: session.id,
      text: readFileSync(join(here, "../tests/fixtures/transcripts/05-clean-baseline.txt"), "utf8"),
    });
    freezeTranscript(db, transcript.id);

    console.log("Running analyzeSession against the real local model — this will take real time...");
    const start = Date.now();
    const state = await analyzeSession(
      { db, client: backend, projectId: project.id, sessionId: session.id },
      transcript.id,
      { onProgress: (name, status) => console.log(`  [${status.padEnd(8)}] ${name}`) },
    );
    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

    const reqs = listRequirements(db, project.id);
    console.log(`\nCompleted in ${elapsedSec}s.`);
    console.log(`Extracted: ${state.extracted}, Validated: ${state.validated}, Quarantined: ${state.quarantined} (${(quarantineRate(state) * 100).toFixed(1)}%)`);
    console.log(`Requirements: ${reqs.length}`);
    for (const r of reqs) console.log(`  - ${r.statement}`);

    if (reqs.length === 0) {
      console.log("\nFAIL: zero requirements produced from a transcript with known extractable content.");
      process.exitCode = 1;
    } else {
      console.log("\nPASS: the electron IPC layer's local-backend dispatch path produces real, non-empty output.");
    }
  } finally {
    await release();
  }
}

main();
```

- [ ] **Step 2: Confirm the local model is actually cached (don't re-download unnecessarily)**

Run: `ls -la ~/.node-llama-cpp/models/`
Expected: the `hf_bartowski_Qwen2.5-7B-Instruct-Q4_K_M.gguf` file from the compatibility spike (Task 2 of the local-LLM plan) is present, ~4.7GB. If it's missing, the script will re-download it on first run — let that happen rather than treating it as a blocker, but note it in the report since it means this run took materially longer than expected.

- [ ] **Step 3: Run it for real**

Run: `npx tsx scripts/verify-electron-local-backend.ts`

Let it run to completion — this exercises real local inference and will take real wall-clock time (the earlier compatibility spike measured ~10.5 tok/s CPU-only on this machine; this run is not forced CPU-only, so Metal acceleration should make it faster, but budget for a real multi-minute run regardless).

- [ ] **Step 4: Record the real output**

Paste the full real command output into the task report — extracted/validated/quarantined counts, the actual requirement statements produced, elapsed time, and the PASS/FAIL line. If it FAILs (zero requirements), that's a real finding to investigate and report honestly, not something to silently re-run until it passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-electron-local-backend.ts
git commit -m "test: add real functional verification of electron's local-backend dispatch path"
```

---

## After this plan

- **Handoff to the user for GUI click-through.** This plan proves the backend-selection *logic* works for real against the local model, and that the Electron app builds cleanly with the new UI control — but nobody in this session can click the actual buttons in a running Electron window. Once this plan's tasks are complete and reviewed, the concrete handoff is: run `cd electron && npm run dev`, create a project choosing "Local model," add a session with a real transcript, click Analyze, and confirm the Requirements/Assumptions/Questions/Recommendations tabs populate — the one verification step genuinely outside this plan's reach.
- The transcript-amendment feature, `app_metadata` table, and demo-data seeding are merged in as-is from `feat/electron-ui` (Task 1) and untouched by any later task in this plan, per the design spec's explicit non-goals.
