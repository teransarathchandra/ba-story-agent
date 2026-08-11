# Graph Report - ba-story-agent  (2026-08-11)

## Corpus Check
- 178 files · ~201,885 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1225 nodes · 3180 edges · 74 communities (63 shown, 11 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c3243d6a`
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
- stage4-reconcile.ts
- Layout.tsx
- api.ts
- showErrorToast
- ReviewWorkspace.tsx
- react
- package.json
- @electron/rebuild
- preload/index.ts
- tsconfig.node.json
- gold-local-judge-batching.test.ts
- AnalyzeButton.tsx
- QuestionsTab.tsx
- Sidebar.tsx
- electron-vite
- pipeline/index.ts
- Global Constraints
- tailwindcss
- @types/react
- vitest
- RequirementsTab.tsx
- domain.ts
- local-client.ts
- Review matrix
- gold-schema.ts
- gold-local-judge-batching.ts
- gold-metrics.ts
- generate-human-review-template.mts
- gold-match.ts
- gold-coverage.ts
- Gold-fixture eval harness — design (v4, approved — implementation follows)
- gold-batching.ts
- cli/index.ts
- claims.ts
- 06-salon-booking — local semantic pre-fix baseline (2026-08-10)
- snapshot.ts
- Part 1 — Gold items (38): for each, which candidate(s) below correspond to it, if any?
- 06-salon-booking — deterministic-only baseline (2026-08-09)
- state.ts
- audit.ts
- run-live-eval.ts
- gold-sync.ts
- Part 2 — Generated candidates (31): evidence fidelity
- inspect-windows.ts
- Pairwise semantic calibration set v1
- gold-report.ts
- artifacts.ts
- @anthropic-ai/sdk
- 06-salon-booking — human semantic review template (v1)

## God Nodes (most connected - your core abstractions)
1. `createProject()` - 66 edges
2. `openDb()` - 65 edges
3. `createSession()` - 62 edges
4. `createTranscript()` - 55 edges
5. `newId()` - 50 edges
6. `freezeTranscript()` - 49 edges
7. `Part 1 — Gold items (38): for each, which candidate(s) below correspond to it, if any?` - 39 edges
8. `setupIpc()` - 35 edges
9. `Part 2 — Generated candidates (31): evidence fidelity` - 32 edges
10. `buildProgram()` - 31 edges

## Surprising Connections (you probably didn't know these)
- `AssumptionsTab()` --indirect_call--> `claim()`  [INFERRED]
  electron/src/renderer/components/AssumptionsTab.tsx → tests/store/claims.test.ts
- `metricsFor()` --calls--> `computeGoldMetrics()`  [EXTRACTED]
  tests/eval/gold-metrics.test.ts → src/eval/gold-metrics.ts
- `ClaimDefinition` --references--> `Claim`  [EXTRACTED]
  electron/src/main/demo-data.ts → src/types/domain.ts
- `seedDemoWorkspace()` --calls--> `setSessionStatus()`  [EXTRACTED]
  electron/src/main/demo-data.ts → src/store/projects.ts
- `getDb()` --calls--> `openDb()`  [EXTRACTED]
  electron/src/main/ipc.ts → src/store/db.ts

## Import Cycles
- None detected.

## Communities (74 total, 11 thin omitted)

### Community 0 - "Global Constraints"
Cohesion: 0.13
Nodes (14): Global Constraints, Post-final-review fix round, Speaker Role Confirmation Modal Implementation Plan, Task 10: Fix stale speaker state in Sidebar (amendment reload + session-switch race), Task 11: Widen client-attribution exclusion to "other", and close the snapshot.ts gap, Task 1: Speaker role override schema and store module, Task 2: Wire session overrides into the pipeline; remove the automatic first-speaker override, Task 3: Extend the `ba`-exclusion to stage4-reconcile (+6 more)

### Community 1 - "projects.ts"
Cohesion: 0.08
Nodes (91): CLAIM_DEFINITIONS, seedDemoWorkspace(), handlers, mockAnalyzeSession, mockAnthropicBackend, mockAnthropicInstance, mockCreateClient, mockLoadLocalBackend (+83 more)

### Community 2 - "File Structure"
Cohesion: 0.06
Nodes (32): BA Story Agent — Core Engine Implementation Plan, Definition of done for this plan, File Structure, Global Constraints, Pipeline data flow, Task 10: Hedge lexicon guard, Task 11: LLM client with egress log, Task 12: Typed structured-output helper (+24 more)

### Community 3 - "validator.ts"
Cohesion: 0.12
Nodes (22): denormalizeRange(), FOLD, normalize(), Normalized, bestWindow(), DISFLUENCIES, DISFLUENCY_PHRASES, levenshteinRatio() (+14 more)

### Community 4 - "ipc.ts"
Cohesion: 0.19
Nodes (20): DEMO_MARKER_KEY, getDb(), Log, setupIpc(), countWords(), suggestProjectDomain(), setRequirementStatus(), countByStatus() (+12 more)

### Community 5 - "compilerOptions"
Cohesion: 0.07
Nodes (29): compilerOptions, allowSyntheticDefaultImports, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, jsx, lib, module (+21 more)

### Community 6 - "dependencies"
Cohesion: 0.09
Nodes (23): dependencies, better-sqlite3, commander, @electron-toolkit/utils, @fontsource-variable/inter, @fontsource-variable/manrope, lucide-react, node-llama-cpp (+15 more)

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
Cohesion: 0.12
Nodes (25): __dirname, main(), now, project, sampleClaims, sampleRequirements, sampleStories, segment (+17 more)

### Community 21 - "devDependencies"
Cohesion: 0.10
Nodes (21): autoprefixer, electron, devDependencies, autoprefixer, electron, @electron-toolkit/tsconfig, postcss, @types/better-sqlite3 (+13 more)

### Community 22 - "stage4-reconcile.ts"
Cohesion: 0.12
Nodes (22): main(), schemas, ArrayDef, EnumDef, IMMUTABLE_TYPES, isNullableImmutableType(), NullableDef, ObjectDef (+14 more)

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

### Community 32 - "gold-local-judge-batching.test.ts"
Cohesion: 0.22
Nodes (5): DEFAULT_JUDGE_MAX_OUTPUT_TOKENS, JudgeConfig, CACHE_DIR, cleanupNewCacheFiles(), listCacheFiles()

### Community 33 - "AnalyzeButton.tsx"
Cohesion: 0.33
Nodes (5): AnalyzeButton(), AnalyzeState, ProgressEvent, Props, STAGE_LABELS

### Community 34 - "QuestionsTab.tsx"
Cohesion: 0.40
Nodes (5): OpenQuestion, Props, QuestionsTab(), STATUS_META, STATUS_ORDER

### Community 35 - "Sidebar.tsx"
Cohesion: 0.31
Nodes (7): ConfirmDialog(), Props, Theme, Props, SetDomainDialog(), Props, Project

### Community 40 - "pipeline/index.ts"
Cohesion: 0.18
Nodes (16): callTyped(), StageFailure, ALL_STAGES, runPipeline(), Stage, applySpeakerRoleFloor(), stage2Validate, stage3Classify (+8 more)

### Community 41 - "Global Constraints"
Cohesion: 0.13
Nodes (14): Global Constraints, Requirements Extraction Cascade Fix Implementation Plan, Task 10 (post-final-review addendum #3): Exclude analyst-attributed claims from the Assumptions UI too, Task 11 (post-final-review addendum #4): Don't extract a confirmed requirement from a BA proposal to leave something unresolved, Task 12 (post-final-review addendum #5): First-speaker heuristic as a stronger BA-identification signal, Task 1: Parse speaker labels during transcript segmentation, Task 2: Surface speaker labels in extraction and add the confirmation-pattern rule, Task 3: Deterministic per-session speaker-role self-consistency floor (+6 more)

### Community 45 - "RequirementsTab.tsx"
Cohesion: 0.33
Nodes (4): Props, RejectModalProps, Requirement, RequirementsTab()

### Community 46 - "domain.ts"
Cohesion: 0.14
Nodes (13): AcSource, ClaimKind, ClaimStatus, CritiqueCategory, Iso, LinkKind, MatchMode, QuestionStatus (+5 more)

### Community 47 - "local-client.ts"
Cohesion: 0.09
Nodes (21): Effort, LlmBackend, isDegenerateEmpty(), loadNodeLlamaCpp(), LOCAL_MAX_TOKENS, LocalBackend, Log, MAX_CONCURRENT_SEQUENCES (+13 more)

### Community 48 - "Review matrix"
Cohesion: 0.12
Nodes (15): Assumptions / Tentative Statements, Business Objectives / Success Criteria, Business Rules / Constraints, Confirmed Requirements, Current State / Problem, Dangling-reference check, Final counts, Final list of annotation rules (+7 more)

### Community 49 - "gold-schema.ts"
Cohesion: 0.12
Nodes (16): DeterministicCheck, DeterministicCheckSchema, EXPECTED_BUCKET, GoldCategorySchema, GoldFixture, GoldItemSchema, SupportedCategory, emptyFixture (+8 more)

### Community 50 - "gold-local-judge-batching.ts"
Cohesion: 0.16
Nodes (24): BATCH_EVIDENCE_PROMPT_VERSION, BATCH_EVIDENCE_SCHEMA_VERSION, batchCacheDir(), BatchOutcome, buildCorrespondenceBatchPrompt(), buildEvidenceBatchPrompt(), callCorrespondenceBatch(), callEvidenceBatch() (+16 more)

### Community 51 - "gold-metrics.ts"
Cohesion: 0.14
Nodes (27): buildJudgePrompt(), assignPrecisionBucket(), computeCrossCategoryExclusivity(), computeDuplicateRate(), computeEvidenceFidelity(), computeGoldMetrics(), computeGroundedVsNovelQuestions(), computeMeetingStateResolution() (+19 more)

### Community 52 - "generate-human-review-template.mts"
Cohesion: 0.14
Nodes (17): arg(), main(), allCandidates, categoryLabel, fixture, FIXTURE_NAME, goldItems, snapshot (+9 more)

### Community 53 - "gold-match.ts"
Cohesion: 0.12
Nodes (27): BATCH_CORRESPONDENCE_PROMPT_VERSION, BATCH_CORRESPONDENCE_SCHEMA_VERSION, RawBatchAttempt, cacheDir(), cacheKeyFor(), callClaudeJudge(), checkJudgeIndependence(), DEFAULT_JUDGE_MODEL (+19 more)

### Community 54 - "gold-coverage.ts"
Cohesion: 0.27
Nodes (8): checkCoverage(), CoverageResult, duplicates(), intersection(), setsEqual(), GoldMatchResult, GENERATED_IDS, GOLD_IDS

### Community 55 - "Gold-fixture eval harness — design (v4, approved — implementation follows)"
Cohesion: 0.15
Nodes (12): 10. Integration point (unchanged from v1/v2), 1. Gold file — updated shape, 2. Gold-category → output-bucket mapping (three tiers, unchanged from v2), 3. Unresolved Decisions vs. the mixed Questions bucket (unchanged principle, now cross-bucket-aware), 4. Judge policy, 5. Semantic-judge schema — cross-bucket, evidence fidelity fully decoupled, explicit coverage accounting, 6. Hard deterministic invariants — hand-authored, assertion-specific, 7. Metrics — corrected formulas (+4 more)

### Community 56 - "gold-batching.ts"
Cohesion: 0.19
Nodes (15): BatchMatch, CorrespondenceBatchResult, EvidenceBatchResult, aggregateBatchedMatch(), buildCorrespondenceBatches(), buildEvidenceBatches(), chunk(), CORRESPONDENCE_GOLD_BATCH_SIZE (+7 more)

### Community 57 - "cli/index.ts"
Cohesion: 0.22
Nodes (21): main(), TRANSCRIPT_TEXT, runAgainstBackend(), buildProgram(), classifyCliError(), Log, buildSnapshot(), analyzeSession() (+13 more)

### Community 58 - "claims.ts"
Cohesion: 0.15
Nodes (16): ClaimDefinition, RequoteSchema, stage2bRequote, buildRequoteUser(), REQUOTE_SYSTEM, applyFilters(), ClaimRow, listClaims() (+8 more)

### Community 59 - "06-salon-booking — local semantic pre-fix baseline (2026-08-10)"
Cohesion: 0.22
Nodes (8): 06-salon-booking — local semantic pre-fix baseline (2026-08-10), Deterministic checks (unaffected by the above — judge-independent), Input provenance, Per-batch diagnostics (real measured, not estimated), Raw responses preserved, Relationship to the existing deterministic-only baseline, Runtime finding, not a context-size problem, What ran

### Community 60 - "snapshot.ts"
Cohesion: 0.19
Nodes (11): jsonPublisher, Publisher, formatTimestamp(), markdownPublisher, Evidence, ExportSnapshot, SNAPSHOT_SCHEMA_VERSION, AcceptanceCriterion (+3 more)

### Community 61 - "Part 1 — Gold items (38): for each, which candidate(s) below correspond to it, if any?"
Cohesion: 0.05
Nodes (39): ASM-01 — Assumption, ASM-02 — Assumption, ASM-03 — Assumption, Part 1 — Gold items (38): for each, which candidate(s) below correspond to it, if any?, REQ-01 — Requirement, REQ-02 — Requirement, REQ-03 — Requirement, REQ-04 — Requirement (+31 more)

### Community 62 - "06-salon-booking — deterministic-only baseline (2026-08-09)"
Cohesion: 0.33
Nodes (5): 06-salon-booking — deterministic-only baseline (2026-08-09), How to compare against this later, What ran, and what didn't, What this is, What this snapshot already shows

### Community 63 - "state.ts"
Cohesion: 0.22
Nodes (9): MIN_WORDS, Window, stage0Chunk, stage1Extract, WindowRef, buildExtractUser(), EXTRACT_SYSTEM, Segment (+1 more)

### Community 64 - "audit.ts"
Cohesion: 0.15
Nodes (16): AnthropicBackend, canonical(), hashRequest(), logEgress(), MAX_TOKENS, MODEL, NOTE: the TypeScript SDK takes milliseconds, unlike the Python SDK., CheckpointStatus (+8 more)

### Community 65 - "run-live-eval.ts"
Cohesion: 0.19
Nodes (13): selectBackend(), check(), Expectation, expectations, FixtureResult, fixturesDir, here, main() (+5 more)

### Community 66 - "gold-sync.ts"
Cohesion: 0.23
Nodes (11): GoldCategory, checkGoldSync(), hashFileContent(), ParsedMarkdownItem, parseMarkdownGoldItems(), SECTION_TO_CATEGORY, SyncCheckResult, goldenDir (+3 more)

### Community 67 - "Part 2 — Generated candidates (31): evidence fidelity"
Cohesion: 0.06
Nodes (32): clm_01KZK7N2AA0G84SY55420PB60H (assumptionClaim), clm_01KZK7N2AA0G84SY55420PB60J (assumptionClaim), clm_01KZK7N2AA0G84SY55420PB60K (assumptionClaim), clm_01KZK7N2AA0G84SY55420PB60M (assumptionClaim), clm_01KZK7P5FQ0QMPTPP8MJASJNAM (assumptionClaim), oqn_01KZK7T6DJJZ798TPHJX4YPH93 (question), oqn_01KZK7T6DMD1QP1ES9RCQCKYDR (question), oqn_01KZK7XT432KP7DGZW5J94JMJF (question) (+24 more)

### Community 68 - "inspect-windows.ts"
Cohesion: 0.40
Nodes (4): db, segRows, transcript, windows

### Community 69 - "Pairwise semantic calibration set v1"
Cohesion: 0.40
Nodes (4): Acceptance criteria (for whichever judge model/prompt is being calibrated), Pairwise semantic calibration set v1, Relationship to the salon benchmark, Why these 24

### Community 70 - "gold-report.ts"
Cohesion: 0.32
Nodes (11): persistArtifact(), line(), pct(), printGoldEvalReport(), printMetrics(), arg(), main(), arg() (+3 more)

### Community 71 - "artifacts.ts"
Cohesion: 0.19
Nodes (11): AcRow, KEYED_TABLES, KeyedTable, listStories(), RequirementRow, StoryRow, toRequirement(), AcceptanceCriterionSchema (+3 more)

## Knowledge Gaps
- **528 isolated node(s):** `name`, `version`, `description`, `main`, `dev` (+523 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `claim()` connect `projects.ts` to `ReviewWorkspace.tsx`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `AssumptionsTab()` connect `ReviewWorkspace.tsx` to `showErrorToast`, `projects.ts`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `newId()` connect `projects.ts` to `audit.ts`, `pipeline/index.ts`, `schema-generation-check.ts`, `stage4-reconcile.ts`, `cli/index.ts`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _528 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Global Constraints` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `projects.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07506887052341597 - nodes in this community are weakly interconnected._
- **Should `File Structure` be split into smaller, more focused modules?**
  _Cohesion score 0.06060606060606061 - nodes in this community are weakly interconnected._