# Graph Report - ba-story-agent  (2026-08-08)

## Corpus Check
- 128 files · ~116,522 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 832 nodes · 2238 edges · 39 communities (36 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ba038d18`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- domain.ts
- createProject
- File Structure
- validator.ts
- projects.ts
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
- stage7-critique.ts
- Electron Integration — Design Spec
- schema-generation-check.ts
- Global Constraints
- pipeline/index.ts
- devDependencies
- stage1-extract.ts
- Layout.tsx
- Sidebar.tsx
- showErrorToast
- ReviewWorkspace.tsx
- run-live-eval.ts
- package.json
- artifacts.ts
- preload/index.ts
- tsconfig.node.json
- stage3-classify.ts
- AnalyzeButton.tsx
- QuestionsTab.tsx
- RecommendationsTab.tsx

## God Nodes (most connected - your core abstractions)
1. `Db` - 60 edges
2. `createProject()` - 54 edges
3. `openDb()` - 53 edges
4. `createSession()` - 52 edges
5. `createTranscript()` - 45 edges
6. `newId()` - 43 edges
7. `freezeTranscript()` - 39 edges
8. `setupIpc()` - 31 edges
9. `buildProgram()` - 28 edges
10. `showErrorToast()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `AssumptionsTab()` --indirect_call--> `claim()`  [INFERRED]
  electron/src/renderer/components/AssumptionsTab.tsx → tests/store/claims.test.ts
- `ClaimDefinition` --references--> `Claim`  [EXTRACTED]
  electron/src/main/demo-data.ts → src/types/domain.ts
- `seedDemoWorkspace()` --references--> `Db`  [EXTRACTED]
  electron/src/main/demo-data.ts → src/store/db.ts
- `seedDemoWorkspace()` --calls--> `setSessionStatus()`  [EXTRACTED]
  electron/src/main/demo-data.ts → src/store/projects.ts
- `getDb()` --calls--> `openDb()`  [EXTRACTED]
  electron/src/main/ipc.ts → src/store/db.ts

## Import Cycles
- None detected.

## Communities (39 total, 3 thin omitted)

### Community 0 - "domain.ts"
Cohesion: 0.08
Nodes (30): toRequirement(), CheckpointStatus, listApprovals(), recordEgress(), saveCheckpoint(), QuestionRow, RecommendationRow, AcSource (+22 more)

### Community 1 - "createProject"
Cohesion: 0.09
Nodes (67): CLAIM_DEFINITIONS, seedDemoWorkspace(), handlers, mockAnalyzeSession, mockAnthropicBackend, mockAnthropicInstance, mockCreateClient, mockLoadLocalBackend (+59 more)

### Community 2 - "File Structure"
Cohesion: 0.06
Nodes (32): BA Story Agent — Core Engine Implementation Plan, Definition of done for this plan, File Structure, Global Constraints, Pipeline data flow, Task 10: Hedge lexicon guard, Task 11: LLM client with egress log, Task 12: Typed structured-output helper (+24 more)

### Community 3 - "validator.ts"
Cohesion: 0.12
Nodes (22): denormalizeRange(), FOLD, normalize(), Normalized, bestWindow(), DISFLUENCIES, DISFLUENCY_PHRASES, levenshteinRatio() (+14 more)

### Community 4 - "projects.ts"
Cohesion: 0.08
Nodes (63): DEMO_MARKER_KEY, getDb(), Log, selectBackend(), setupIpc(), main(), buildProgram(), classifyCliError() (+55 more)

### Community 5 - "compilerOptions"
Cohesion: 0.07
Nodes (29): compilerOptions, allowSyntheticDefaultImports, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, jsx, lib, module (+21 more)

### Community 6 - "dependencies"
Cohesion: 0.05
Nodes (38): dependencies, @anthropic-ai/sdk, better-sqlite3, commander, @electron-toolkit/utils, @fontsource-variable/inter, @fontsource-variable/manrope, lucide-react (+30 more)

### Community 7 - "TypeScript Compiler Configuration"
Cohesion: 0.10
Nodes (19): ES2023, src/**/*.ts, tests/**/*.ts, compilerOptions, declaration, esModuleInterop, lib, module (+11 more)

### Community 8 - "schema.sql"
Cohesion: 0.27
Nodes (15): acceptance_criteria, app_metadata, approval_events, claim_links, claims, egress_log, open_questions, projects (+7 more)

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

### Community 16 - "stage7-critique.ts"
Cohesion: 0.14
Nodes (17): main(), schemas, ArrayDef, EnumDef, IMMUTABLE_TYPES, isNullableImmutableType(), NullableDef, ObjectDef (+9 more)

### Community 17 - "Electron Integration — Design Spec"
Cohesion: 0.17
Nodes (11): 1. Problem, 2. Goals and non-goals, 3.1 Branch reconciliation, 3.2 Backend-selection wiring, 3.3 UI backend choice, 3. Architecture, 4. Data flow, 5. Error handling (+3 more)

### Community 18 - "schema-generation-check.ts"
Cohesion: 0.13
Nodes (23): ClaimDefinition, __dirname, main(), now, project, sampleClaims, sampleRequirements, sampleStories (+15 more)

### Community 19 - "Global Constraints"
Cohesion: 0.25
Nodes (7): After this plan, Electron Integration Implementation Plan, Global Constraints, Task 1: Merge `feat/electron-ui` into `feat/electron-integration`, Task 2: Backend-selection wiring in `electron/src/main/ipc.ts`, Task 3: Typed IPC contract + UI backend picker, Task 4: Real functional verification against the local backend

### Community 20 - "pipeline/index.ts"
Cohesion: 0.21
Nodes (15): ALL_STAGES, analyzeSession(), runPipeline(), Stage, StageContext, stage2Validate, stage4Reconcile, stage8Assemble (+7 more)

### Community 21 - "devDependencies"
Cohesion: 0.06
Nodes (31): autoprefixer, electron, devDependencies, autoprefixer, electron, @electron/rebuild, @electron-toolkit/tsconfig, electron-vite (+23 more)

### Community 22 - "stage1-extract.ts"
Cohesion: 0.21
Nodes (11): chunkTranscript(), MIN_WORDS, Window, ExtractedClaimsSchema, stage0Chunk, stage1Extract, WindowRef, buildExtractUser() (+3 more)

### Community 23 - "Layout.tsx"
Cohesion: 0.19
Nodes (9): App(), ClaimDetail, EvidencePanel(), highlightQuoteInContext(), KIND_META, Props, STATUS_META, Layout() (+1 more)

### Community 24 - "Sidebar.tsx"
Cohesion: 0.12
Nodes (19): ConfirmDialog(), Props, Theme, Props, Props, Props, TranscriptDialog(), AnalyzeResult (+11 more)

### Community 25 - "showErrorToast"
Cohesion: 0.32
Nodes (11): ExportButton(), ExportState, Props, ProjectCreate(), Props, Props, SessionAdd(), SetDomainDialog() (+3 more)

### Community 26 - "ReviewWorkspace.tsx"
Cohesion: 0.14
Nodes (11): AssumptionsTab(), Claim, PromoteModalProps, Props, Props, RejectModalProps, Requirement, RequirementsTab() (+3 more)

### Community 27 - "run-live-eval.ts"
Cohesion: 0.06
Nodes (38): check(), Expectation, expectations, FixtureResult, fixturesDir, here, requestedBackends, results (+30 more)

### Community 28 - "package.json"
Cohesion: 0.05
Nodes (38): dependencies, @anthropic-ai/sdk, better-sqlite3, commander, node-llama-cpp, ulid, zod, devDependencies (+30 more)

### Community 29 - "artifacts.ts"
Cohesion: 0.19
Nodes (13): stage6Stories, buildStoriesUser(), STORIES_SYSTEM, AcRow, insertStory(), KEYED_TABLES, KeyedTable, nextKey() (+5 more)

### Community 31 - "tsconfig.node.json"
Cohesion: 0.18
Nodes (10): compilerOptions, composite, types, extends, include, @electron-toolkit/tsconfig/tsconfig.node.json, electron.vite.config.*, node (+2 more)

### Community 32 - "stage3-classify.ts"
Cohesion: 0.38
Nodes (5): ClassificationSchema, stage3Classify, buildClassifyUser(), CLASSIFY_SYSTEM, setClaimKind()

### Community 33 - "AnalyzeButton.tsx"
Cohesion: 0.33
Nodes (5): AnalyzeButton(), AnalyzeState, ProgressEvent, Props, STAGE_LABELS

### Community 34 - "QuestionsTab.tsx"
Cohesion: 0.40
Nodes (5): OpenQuestion, Props, QuestionsTab(), STATUS_META, STATUS_ORDER

### Community 35 - "RecommendationsTab.tsx"
Cohesion: 0.33
Nodes (4): DeclineModalProps, Props, Recommendation, RecommendationsTab()

## Knowledge Gaps
- **348 isolated node(s):** `name`, `version`, `description`, `main`, `dev` (+343 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `claim()` connect `createProject` to `ReviewWorkspace.tsx`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Why does `AssumptionsTab()` connect `ReviewWorkspace.tsx` to `showErrorToast`, `createProject`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Why does `newId()` connect `createProject` to `domain.ts`, `projects.ts`, `stage7-critique.ts`, `schema-generation-check.ts`, `stage1-extract.ts`, `artifacts.ts`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _348 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `domain.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08235294117647059 - nodes in this community are weakly interconnected._
- **Should `createProject` be split into smaller, more focused modules?**
  _Cohesion score 0.09430512016718913 - nodes in this community are weakly interconnected._
- **Should `File Structure` be split into smaller, more focused modules?**
  _Cohesion score 0.06060606060606061 - nodes in this community are weakly interconnected._