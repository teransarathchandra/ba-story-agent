# Graph Report - .  (2026-08-07)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 379 nodes · 1306 edges · 11 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.57)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `416b0f15`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Domain Models and Reconciliation
- Transcript Storage and IDs
- Pipeline and Claim Processing
- Transcript Grounding and Segmentation
- CLI Snapshot and Publishing
- LLM Audit and Checkpoints
- Package and Build Tooling
- TypeScript Compiler Configuration
- SQLite Schema
- Project and Session Store

## God Nodes (most connected - your core abstractions)
1. `Db` - 50 edges
2. `createProject()` - 42 edges
3. `openDb()` - 41 edges
4. `createSession()` - 40 edges
5. `newId()` - 39 edges
6. `createTranscript()` - 31 edges
7. `freezeTranscript()` - 26 edges
8. `buildProgram()` - 25 edges
9. `emptyState()` - 16 edges
10. `insertClaims()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `buildProgram()`  [EXTRACTED]
  tests/cli/index.test.ts → src/cli/index.ts
- `source()` --references--> `Window`  [EXTRACTED]
  tests/grounding/validator.test.ts → src/pipeline/stage0-chunk.ts
- `setup()` --indirect_call--> `toRef()`  [INFERRED]
  tests/pipeline/stage2-validate.test.ts → src/pipeline/state.ts
- `setupLong()` --indirect_call--> `toRef()`  [INFERRED]
  tests/pipeline/stage2-validate.test.ts → src/pipeline/state.ts
- `seed()` --calls--> `insertStory()`  [EXTRACTED]
  tests/export/snapshot.test.ts → src/store/artifacts.ts

## Import Cycles
- None detected.

## Communities (11 total, 0 thin omitted)

### Community 0 - "Domain Models and Reconciliation"
Cohesion: 0.05
Nodes (61): Expectation, expectations, fixturesDir, here, ReconcileSchema, stage4Reconcile, stage6Stories, StoryDraftsSchema (+53 more)

### Community 1 - "Transcript Storage and IDs"
Cohesion: 0.17
Nodes (40): StageContext, chunkTranscript(), emptyState(), toRef(), insertRequirements(), insertClaims(), openDb(), createProject() (+32 more)

### Community 2 - "Pipeline and Claim Processing"
Cohesion: 0.11
Nodes (33): ALL_STAGES, analyzeSession(), runPipeline(), Stage, ExtractedClaimsSchema, stage0Chunk, stage1Extract, stage2Validate (+25 more)

### Community 3 - "Transcript Grounding and Segmentation"
Cohesion: 0.09
Nodes (28): denormalizeRange(), FOLD, normalize(), Normalized, bestWindow(), DISFLUENCIES, DISFLUENCY_PHRASES, levenshteinRatio() (+20 more)

### Community 4 - "CLI Snapshot and Publishing"
Cohesion: 0.11
Nodes (27): buildProgram(), classifyCliError(), Log, jsonPublisher, Publisher, formatTimestamp(), markdownPublisher, buildSnapshot() (+19 more)

### Community 5 - "LLM Audit and Checkpoints"
Cohesion: 0.12
Nodes (25): canonical(), hashRequest(), logEgress(), MAX_TOKENS, MODEL, NOTE: the TypeScript SDK takes milliseconds, unlike the Python SDK., callTyped(), Effort (+17 more)

### Community 6 - "Package and Build Tooling"
Cohesion: 0.06
Nodes (35): @anthropic-ai/sdk, better-sqlite3, commander, dependencies, @anthropic-ai/sdk, better-sqlite3, commander, ulid (+27 more)

### Community 7 - "TypeScript Compiler Configuration"
Cohesion: 0.10
Nodes (19): ES2023, src/**/*.ts, tests/**/*.ts, compilerOptions, declaration, esModuleInterop, lib, module (+11 more)

### Community 8 - "SQLite Schema"
Cohesion: 0.30
Nodes (14): acceptance_criteria, approval_events, claim_links, claims, egress_log, open_questions, projects, recommendations (+6 more)

### Community 9 - "Project and Session Store"
Cohesion: 0.23
Nodes (10): getSession(), ProjectRow, SessionRow, toProject(), toSession(), ProjectSchema, Session, SessionSchema (+2 more)

## Knowledge Gaps
- **95 isolated node(s):** `name`, `version`, `private`, `type`, `node` (+90 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Db` connect `LLM Audit and Checkpoints` to `Domain Models and Reconciliation`, `Transcript Storage and IDs`, `Pipeline and Claim Processing`, `CLI Snapshot and Publishing`, `Project and Session Store`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `createProject()` connect `Transcript Storage and IDs` to `Domain Models and Reconciliation`, `Pipeline and Claim Processing`, `Transcript Grounding and Segmentation`, `CLI Snapshot and Publishing`, `LLM Audit and Checkpoints`, `Project and Session Store`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `newId()` connect `Transcript Storage and IDs` to `Domain Models and Reconciliation`, `Project and Session Store`, `Pipeline and Claim Processing`, `LLM Audit and Checkpoints`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _95 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Domain Models and Reconciliation` be split into smaller, more focused modules?**
  _Cohesion score 0.05087719298245614 - nodes in this community are weakly interconnected._
- **Should `Pipeline and Claim Processing` be split into smaller, more focused modules?**
  _Cohesion score 0.10549645390070922 - nodes in this community are weakly interconnected._
- **Should `Transcript Grounding and Segmentation` be split into smaller, more focused modules?**
  _Cohesion score 0.08748615725359911 - nodes in this community are weakly interconnected._