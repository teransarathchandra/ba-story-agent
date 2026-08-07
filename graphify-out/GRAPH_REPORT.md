# Graph Report - ba-story-electron  (2026-08-07)

## Corpus Check
- 120 files · ~102,711 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 763 nodes · 2036 edges · 45 communities (36 shown, 9 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bebd184c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- domain.ts
- projects.ts
- pipeline/index.ts
- validator.ts
- Db
- local-client.ts
- package.json
- TypeScript Compiler Configuration
- schema.sql
- schema-grammar-check.ts
- AGENTS.md
- CLAUDE.md
- showErrorToast
- devDependencies
- File Structure
- compilerOptions
- schema-generation-check.ts
- User Story Review Agent with Voice-to-Text — Design
- dependencies
- stage1-extract.ts
- Local LLM Backend — Design Spec
- Local LLM Backend Implementation Plan
- Local LLM Backend — Spike Findings
- Sidebar.tsx
- tsconfig.node.json
- preload/index.ts
- ReviewWorkspace.tsx
- Layout.tsx
- stage4-reconcile.ts
- QuestionsTab.tsx
- RequirementsTab.tsx
- parse.ts
- electron/package.json
- AnalyzeButton.tsx
- stage6-stories.ts
- better-sqlite3
- lucide-react
- react-dom
- @electron-toolkit/tsconfig
- @types/better-sqlite3
- @vitejs/plugin-react

## God Nodes (most connected - your core abstractions)
1. `Db` - 56 edges
2. `createProject()` - 48 edges
3. `openDb()` - 46 edges
4. `createSession()` - 46 edges
5. `newId()` - 43 edges
6. `createTranscript()` - 39 edges
7. `freezeTranscript()` - 33 edges
8. `setupIpc()` - 29 edges
9. `buildProgram()` - 25 edges
10. `showErrorToast()` - 22 edges

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

## Communities (45 total, 9 thin omitted)

### Community 0 - "domain.ts"
Cohesion: 0.07
Nodes (33): AnthropicBackend, canonical(), hashRequest(), logEgress(), MAX_TOKENS, MODEL, NOTE: the TypeScript SDK takes milliseconds, unlike the Python SDK., toRequirement() (+25 more)

### Community 1 - "projects.ts"
Cohesion: 0.11
Nodes (63): CLAIM_DEFINITIONS, seedDemoWorkspace(), StageContext, emptyState(), toRef(), insertRequirements(), saveCheckpoint(), insertClaims() (+55 more)

### Community 2 - "pipeline/index.ts"
Cohesion: 0.18
Nodes (17): ALL_STAGES, analyzeSession(), runPipeline(), Stage, stage0Chunk, stage1Extract, stage2Validate, stage3Classify (+9 more)

### Community 3 - "validator.ts"
Cohesion: 0.12
Nodes (22): denormalizeRange(), FOLD, normalize(), Normalized, bestWindow(), DISFLUENCIES, DISFLUENCY_PHRASES, levenshteinRatio() (+14 more)

### Community 4 - "Db"
Cohesion: 0.08
Nodes (60): DEMO_MARKER_KEY, getDb(), setupIpc(), Expectation, expectations, fixturesDir, here, buildProgram() (+52 more)

### Community 5 - "local-client.ts"
Cohesion: 0.16
Nodes (9): isDegenerateEmpty(), LOCAL_MAX_TOKENS, LocalBackend, Log, mockGrammar, mockLlama, mockModel, mockSequence (+1 more)

### Community 6 - "package.json"
Cohesion: 0.05
Nodes (38): dependencies, @anthropic-ai/sdk, better-sqlite3, commander, node-llama-cpp, ulid, zod, devDependencies (+30 more)

### Community 7 - "TypeScript Compiler Configuration"
Cohesion: 0.10
Nodes (19): ES2023, src/**/*.ts, tests/**/*.ts, compilerOptions, declaration, esModuleInterop, lib, module (+11 more)

### Community 8 - "schema.sql"
Cohesion: 0.27
Nodes (15): acceptance_criteria, app_metadata, approval_events, claim_links, claims, egress_log, open_questions, projects (+7 more)

### Community 9 - "schema-grammar-check.ts"
Cohesion: 0.18
Nodes (15): main(), schemas, ArrayDef, EnumDef, IMMUTABLE_TYPES, isNullableImmutableType(), NullableDef, ObjectDef (+7 more)

### Community 13 - "showErrorToast"
Cohesion: 0.33
Nodes (10): ExportButton(), ExportState, Props, ProjectCreate(), Props, Props, SessionAdd(), formatErrorMessage() (+2 more)

### Community 14 - "devDependencies"
Cohesion: 0.10
Nodes (21): autoprefixer, electron, devDependencies, autoprefixer, electron, electron-vite, postcss, tailwindcss (+13 more)

### Community 15 - "File Structure"
Cohesion: 0.06
Nodes (32): BA Story Agent — Core Engine Implementation Plan, Definition of done for this plan, File Structure, Global Constraints, Pipeline data flow, Task 10: Hedge lexicon guard, Task 11: LLM client with egress log, Task 12: Typed structured-output helper (+24 more)

### Community 16 - "compilerOptions"
Cohesion: 0.07
Nodes (29): compilerOptions, allowSyntheticDefaultImports, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, jsx, lib, module (+21 more)

### Community 17 - "schema-generation-check.ts"
Cohesion: 0.12
Nodes (24): ClaimDefinition, __dirname, main(), now, project, sampleClaims, sampleRequirements, sampleStories (+16 more)

### Community 18 - "User Story Review Agent with Voice-to-Text — Design"
Cohesion: 0.07
Nodes (26): Architecture, Build order — front-load the risk, Data model, Decisions, Error handling, Minimum required inputs, Modules, MVP scope (+18 more)

### Community 19 - "dependencies"
Cohesion: 0.10
Nodes (21): dependencies, @anthropic-ai/sdk, commander, @electron-toolkit/utils, @fontsource-variable/inter, @fontsource-variable/manrope, node-llama-cpp, react (+13 more)

### Community 20 - "stage1-extract.ts"
Cohesion: 0.24
Nodes (9): chunkTranscript(), countWords(), MIN_WORDS, Window, buildExtractUser(), EXTRACT_SYSTEM, Segment, fixturesDir (+1 more)

### Community 21 - "Local LLM Backend — Design Spec"
Cohesion: 0.11
Nodes (18): 10. Testing and the eval gate, 11. Out of scope for this spec, 1. Problem, 2. Goals and non-goals, 3. Decisions, 4.1 Insertion point, 4.2 New component: `src/llm/local-client.ts`, 4.3 Model lifecycle (+10 more)

### Community 22 - "Local LLM Backend Implementation Plan"
Cohesion: 0.11
Nodes (17): After this plan, Global Constraints, Local LLM Backend Implementation Plan, Phase 0 — Compatibility Spike (go/no-go gate), Phase 1 — Backend Abstraction, Phase 2 — Local Backend, Phase 3 — Config Surface, Phase 4 — Eval Gate (+9 more)

### Community 23 - "Local LLM Backend — Spike Findings"
Cohesion: 0.12
Nodes (16): Command and real output (Step 3), Constants decided by the spike, CPU-only confirmation (Step 2), Effort-equivalent setting, Follow-up investigation: is this fixable by tuning temperature per schema?, Go/no-go, Investigation: why the six checks "pass" while producing nothing, Local LLM Backend — Spike Findings (+8 more)

### Community 24 - "Sidebar.tsx"
Cohesion: 0.13
Nodes (18): ConfirmDialog(), Props, Theme, Props, Props, TranscriptDialog(), AnalyzeResult, Claim (+10 more)

### Community 25 - "tsconfig.node.json"
Cohesion: 0.18
Nodes (10): compilerOptions, composite, types, extends, include, @electron-toolkit/tsconfig/tsconfig.node.json, electron.vite.config.*, node (+2 more)

### Community 30 - "ReviewWorkspace.tsx"
Cohesion: 0.15
Nodes (10): AssumptionsTab(), Claim, PromoteModalProps, Props, DeclineModalProps, Props, Recommendation, RecommendationsTab() (+2 more)

### Community 31 - "Layout.tsx"
Cohesion: 0.17
Nodes (10): App(), ClaimDetail, EvidencePanel(), highlightQuoteInContext(), KIND_META, Props, STATUS_META, Layout() (+2 more)

### Community 32 - "stage4-reconcile.ts"
Cohesion: 0.27
Nodes (7): stage4Reconcile, Category, stage7Critique, buildReconcileUser(), RECONCILE_SYSTEM, nextKey(), OpenQuestion

### Community 33 - "QuestionsTab.tsx"
Cohesion: 0.40
Nodes (5): OpenQuestion, Props, QuestionsTab(), STATUS_META, STATUS_ORDER

### Community 34 - "RequirementsTab.tsx"
Cohesion: 0.33
Nodes (4): Props, RejectModalProps, Requirement, RequirementsTab()

### Community 35 - "parse.ts"
Cohesion: 0.26
Nodes (5): Effort, LlmBackend, callTyped(), StageFailure, Shape

### Community 36 - "electron/package.json"
Cohesion: 0.18
Nodes (10): description, main, name, scripts, build, dev, preview, rebuild (+2 more)

### Community 37 - "AnalyzeButton.tsx"
Cohesion: 0.33
Nodes (5): AnalyzeButton(), AnalyzeState, ProgressEvent, Props, STAGE_LABELS

### Community 38 - "stage6-stories.ts"
Cohesion: 0.60
Nodes (3): stage6Stories, buildStoriesUser(), STORIES_SYSTEM

## Knowledge Gaps
- **313 isolated node(s):** `name`, `version`, `description`, `main`, `dev` (+308 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `claim()` connect `projects.ts` to `ReviewWorkspace.tsx`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `AssumptionsTab()` connect `ReviewWorkspace.tsx` to `projects.ts`, `showErrorToast`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `newId()` connect `projects.ts` to `stage4-reconcile.ts`, `domain.ts`, `Db`, `stage6-stories.ts`, `schema-generation-check.ts`, `stage1-extract.ts`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _313 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `domain.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07084785133565621 - nodes in this community are weakly interconnected._
- **Should `projects.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10560875512995896 - nodes in this community are weakly interconnected._
- **Should `validator.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11895161290322581 - nodes in this community are weakly interconnected._