# Graph Report - ba-story-agent  (2026-08-09)

## Corpus Check
- 139 files · ~153,471 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 901 nodes · 2494 edges · 52 communities (42 shown, 10 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e837dedb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Global Constraints
- projects.ts
- File Structure
- validator.ts
- ipc.ts
- compilerOptions
- dependencies
- TypeScript Compiler Configuration
- schema.sql
- Local LLM Backend Implementation Plan
- AGENTS.md
- CLAUDE.md
- User Story Review Agent with Voice-to-Text — Design
- Local LLM Backend — Design Spec
- Local LLM Backend — Spike Findings
- scripts
- Electron Integration — Design Spec
- electron/package.json
- Global Constraints
- schema-generation-check.ts
- devDependencies
- stage7-critique.ts
- Layout.tsx
- api.ts
- showErrorToast
- ReviewWorkspace.tsx
- react
- package.json
- @electron/rebuild
- preload/index.ts
- tsconfig.node.json
- claims.ts
- AnalyzeButton.tsx
- QuestionsTab.tsx
- Sidebar.tsx
- electron-vite
- zod-to-gbnf.ts
- Global Constraints
- tailwindcss
- @types/react
- vitest
- RequirementsTab.tsx
- domain.ts
- audit.ts
- stage5-requirements.ts
- commander
- Project
- stage6-stories.ts

## God Nodes (most connected - your core abstractions)
1. `createProject()` - 62 edges
2. `openDb()` - 61 edges
3. `createSession()` - 60 edges
4. `createTranscript()` - 53 edges
5. `newId()` - 48 edges
6. `freezeTranscript()` - 47 edges
7. `setupIpc()` - 35 edges
8. `buildProgram()` - 31 edges
9. `showErrorToast()` - 26 edges
10. `showSuccessToast()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `AssumptionsTab()` --indirect_call--> `claim()`  [INFERRED]
  electron/src/renderer/components/AssumptionsTab.tsx → tests/store/claims.test.ts
- `ClaimDefinition` --references--> `Claim`  [EXTRACTED]
  electron/src/main/demo-data.ts → src/types/domain.ts
- `seedDemoWorkspace()` --calls--> `setSessionStatus()`  [EXTRACTED]
  electron/src/main/demo-data.ts → src/store/projects.ts
- `getDb()` --calls--> `openDb()`  [EXTRACTED]
  electron/src/main/ipc.ts → src/store/db.ts
- `setupIpc()` --calls--> `countWords()`  [EXTRACTED]
  electron/src/main/ipc.ts → src/pipeline/stage0-chunk.ts

## Import Cycles
- None detected.

## Communities (52 total, 10 thin omitted)

### Community 0 - "Global Constraints"
Cohesion: 0.13
Nodes (14): Global Constraints, Post-final-review fix round, Speaker Role Confirmation Modal Implementation Plan, Task 10: Fix stale speaker state in Sidebar (amendment reload + session-switch race), Task 11: Widen client-attribution exclusion to "other", and close the snapshot.ts gap, Task 1: Speaker role override schema and store module, Task 2: Wire session overrides into the pipeline; remove the automatic first-speaker override, Task 3: Extend the `ba`-exclusion to stage4-reconcile (+6 more)

### Community 1 - "projects.ts"
Cohesion: 0.09
Nodes (75): CLAIM_DEFINITIONS, seedDemoWorkspace(), handlers, mockAnalyzeSession, mockAnthropicBackend, mockAnthropicInstance, mockCreateClient, mockLoadLocalBackend (+67 more)

### Community 2 - "File Structure"
Cohesion: 0.06
Nodes (32): BA Story Agent — Core Engine Implementation Plan, Definition of done for this plan, File Structure, Global Constraints, Pipeline data flow, Task 10: Hedge lexicon guard, Task 11: LLM client with egress log, Task 12: Typed structured-output helper (+24 more)

### Community 3 - "validator.ts"
Cohesion: 0.12
Nodes (22): denormalizeRange(), FOLD, normalize(), Normalized, bestWindow(), DISFLUENCIES, DISFLUENCY_PHRASES, levenshteinRatio() (+14 more)

### Community 4 - "ipc.ts"
Cohesion: 0.07
Nodes (66): DEMO_MARKER_KEY, getDb(), Log, selectBackend(), setupIpc(), main(), TRANSCRIPT_TEXT, check() (+58 more)

### Community 5 - "compilerOptions"
Cohesion: 0.07
Nodes (29): compilerOptions, allowSyntheticDefaultImports, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, jsx, lib, module (+21 more)

### Community 6 - "dependencies"
Cohesion: 0.09
Nodes (23): dependencies, @anthropic-ai/sdk, better-sqlite3, @electron-toolkit/utils, @fontsource-variable/inter, @fontsource-variable/manrope, lucide-react, node-llama-cpp (+15 more)

### Community 7 - "TypeScript Compiler Configuration"
Cohesion: 0.10
Nodes (19): ES2023, src/**/*.ts, tests/**/*.ts, compilerOptions, declaration, esModuleInterop, lib, module (+11 more)

### Community 8 - "schema.sql"
Cohesion: 0.25
Nodes (16): acceptance_criteria, app_metadata, approval_events, claim_links, claims, egress_log, open_questions, projects (+8 more)

### Community 9 - "Local LLM Backend Implementation Plan"
Cohesion: 0.11
Nodes (17): After this plan, Global Constraints, Local LLM Backend Implementation Plan, Phase 0 — Compatibility Spike (go/no-go gate), Phase 1 — Backend Abstraction, Phase 2 — Local Backend, Phase 3 — Config Surface, Phase 4 — Eval Gate (+9 more)

### Community 13 - "User Story Review Agent with Voice-to-Text — Design"
Cohesion: 0.07
Nodes (26): Architecture, Build order — front-load the risk, Data model, Decisions, Error handling, Minimum required inputs, Modules, MVP scope (+18 more)

### Community 14 - "Local LLM Backend — Design Spec"
Cohesion: 0.11
Nodes (18): 10. Testing and the eval gate, 11. Out of scope for this spec, 1. Problem, 2. Goals and non-goals, 3. Decisions, 4.1 Insertion point, 4.2 New component: `src/llm/local-client.ts`, 4.3 Model lifecycle (+10 more)

### Community 15 - "Local LLM Backend — Spike Findings"
Cohesion: 0.12
Nodes (16): Command and real output (Step 3), Constants decided by the spike, CPU-only confirmation (Step 2), Effort-equivalent setting, Follow-up investigation: is this fixable by tuning temperature per schema?, Go/no-go, Investigation: why the six checks "pass" while producing nothing, Local LLM Backend — Spike Findings (+8 more)

### Community 16 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, preview, rebuild, start, test

### Community 17 - "Electron Integration — Design Spec"
Cohesion: 0.17
Nodes (11): 1. Problem, 2. Goals and non-goals, 3.1 Branch reconciliation, 3.2 Backend-selection wiring, 3.3 UI backend choice, 3. Architecture, 4. Data flow, 5. Error handling (+3 more)

### Community 18 - "electron/package.json"
Cohesion: 0.40
Nodes (4): description, main, name, version

### Community 19 - "Global Constraints"
Cohesion: 0.25
Nodes (7): After this plan, Electron Integration Implementation Plan, Global Constraints, Task 1: Merge `feat/electron-ui` into `feat/electron-integration`, Task 2: Backend-selection wiring in `electron/src/main/ipc.ts`, Task 3: Typed IPC contract + UI backend picker, Task 4: Real functional verification against the local backend

### Community 20 - "schema-generation-check.ts"
Cohesion: 0.15
Nodes (17): __dirname, main(), now, project, sampleClaims, sampleRequirements, sampleStories, segment (+9 more)

### Community 21 - "devDependencies"
Cohesion: 0.10
Nodes (21): autoprefixer, electron, devDependencies, autoprefixer, electron, @electron-toolkit/tsconfig, postcss, @types/better-sqlite3 (+13 more)

### Community 22 - "stage7-critique.ts"
Cohesion: 0.18
Nodes (13): schemas, ClassificationSchema, ReconcileSchema, RequirementDraftsSchema, StoryDraftsSchema, Category, CritiqueFindingsSchema, stage7Critique (+5 more)

### Community 23 - "Layout.tsx"
Cohesion: 0.19
Nodes (9): App(), ClaimDetail, EvidencePanel(), highlightQuoteInContext(), KIND_META, Props, STATUS_META, Layout() (+1 more)

### Community 24 - "api.ts"
Cohesion: 0.13
Nodes (16): Props, ROLE_OPTIONS, Props, TranscriptDialog(), AnalyzeResult, Claim, DetectedSpeaker, OpenQuestion (+8 more)

### Community 25 - "showErrorToast"
Cohesion: 0.31
Nodes (11): ExportButton(), ExportState, Props, ProjectCreate(), Props, Props, SessionAdd(), SpeakerRoleDialog() (+3 more)

### Community 26 - "ReviewWorkspace.tsx"
Cohesion: 0.13
Nodes (12): AssumptionsTab(), Claim, PromoteModalProps, Props, STATUS_LABEL, DeclineModalProps, Props, Recommendation (+4 more)

### Community 28 - "package.json"
Cohesion: 0.05
Nodes (38): dependencies, @anthropic-ai/sdk, better-sqlite3, commander, node-llama-cpp, ulid, zod, devDependencies (+30 more)

### Community 31 - "tsconfig.node.json"
Cohesion: 0.18
Nodes (10): compilerOptions, composite, types, extends, include, @electron-toolkit/tsconfig/tsconfig.node.json, electron.vite.config.*, node (+2 more)

### Community 32 - "claims.ts"
Cohesion: 0.08
Nodes (47): db, segRows, transcript, windows, ALL_STAGES, runPipeline(), Stage, StageContext (+39 more)

### Community 33 - "AnalyzeButton.tsx"
Cohesion: 0.33
Nodes (5): AnalyzeButton(), AnalyzeState, ProgressEvent, Props, STAGE_LABELS

### Community 34 - "QuestionsTab.tsx"
Cohesion: 0.40
Nodes (5): OpenQuestion, Props, QuestionsTab(), STATUS_META, STATUS_ORDER

### Community 35 - "Sidebar.tsx"
Cohesion: 0.31
Nodes (7): ConfirmDialog(), Props, Theme, Props, SetDomainDialog(), Props, Project

### Community 40 - "zod-to-gbnf.ts"
Cohesion: 0.28
Nodes (8): main(), ArrayDef, EnumDef, IMMUTABLE_TYPES, isNullableImmutableType(), NullableDef, ObjectDef, zodToGbnfSchema()

### Community 41 - "Global Constraints"
Cohesion: 0.13
Nodes (14): Global Constraints, Requirements Extraction Cascade Fix Implementation Plan, Task 10 (post-final-review addendum #3): Exclude analyst-attributed claims from the Assumptions UI too, Task 11 (post-final-review addendum #4): Don't extract a confirmed requirement from a BA proposal to leave something unresolved, Task 12 (post-final-review addendum #5): First-speaker heuristic as a stronger BA-identification signal, Task 1: Parse speaker labels during transcript segmentation, Task 2: Surface speaker labels in extraction and add the confirmation-pattern rule, Task 3: Deterministic per-session speaker-role self-consistency floor (+6 more)

### Community 45 - "RequirementsTab.tsx"
Cohesion: 0.33
Nodes (4): Props, RejectModalProps, Requirement, RequirementsTab()

### Community 46 - "domain.ts"
Cohesion: 0.10
Nodes (24): AcRow, KEYED_TABLES, KeyedTable, nextKey(), RequirementRow, StoryRow, toRequirement(), AcceptanceCriterionSchema (+16 more)

### Community 47 - "audit.ts"
Cohesion: 0.06
Nodes (41): Effort, LlmBackend, AnthropicBackend, canonical(), hashRequest(), logEgress(), MAX_TOKENS, MODEL (+33 more)

### Community 48 - "stage5-requirements.ts"
Cohesion: 0.32
Nodes (6): ClaimDefinition, stage5Requirements, buildRequirementsUser(), REQUIREMENTS_SYSTEM, DetectedSpeaker, Claim

### Community 50 - "Project"
Cohesion: 0.28
Nodes (6): Reviewer, ReviewerContext, RECONCILE_SYSTEM, AcceptanceCriterion, Project, Requirement

### Community 51 - "stage6-stories.ts"
Cohesion: 0.60
Nodes (3): stage6Stories, buildStoriesUser(), STORIES_SYSTEM

## Knowledge Gaps
- **379 isolated node(s):** `name`, `version`, `description`, `main`, `dev` (+374 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `claim()` connect `claims.ts` to `projects.ts`, `ReviewWorkspace.tsx`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Why does `AssumptionsTab()` connect `ReviewWorkspace.tsx` to `claims.ts`, `showErrorToast`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Why does `newId()` connect `projects.ts` to `claims.ts`, `ipc.ts`, `audit.ts`, `stage5-requirements.ts`, `stage6-stories.ts`, `stage7-critique.ts`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _379 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Global Constraints` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `projects.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09106529209621993 - nodes in this community are weakly interconnected._
- **Should `File Structure` be split into smaller, more focused modules?**
  _Cohesion score 0.06060606060606061 - nodes in this community are weakly interconnected._