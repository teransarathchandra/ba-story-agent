# Graph Report - ba-story-agent  (2026-08-07)

## Corpus Check
- 80 files · ~69,920 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 383 nodes · 1308 edges · 13 communities (11 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.57)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3ddb7ab8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- domain.ts
- createProject
- projects.ts
- validator.ts
- Db
- db.ts
- Package and Build Tooling
- TypeScript Compiler Configuration
- SQLite Schema
- adversarial.test.ts
- AGENTS.md
- CLAUDE.md

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

## Communities (13 total, 2 thin omitted)

### Community 0 - "domain.ts"
Cohesion: 0.07
Nodes (47): stage4Reconcile, stage6Stories, Category, CritiqueFindingsSchema, stage7Critique, buildCritiqueUser(), Reviewer, ReviewerContext (+39 more)

### Community 1 - "createProject"
Cohesion: 0.17
Nodes (40): chunkTranscript(), emptyState(), toRef(), insertRequirements(), insertClaims(), openDb(), insertRecommendations(), createProject() (+32 more)

### Community 2 - "projects.ts"
Cohesion: 0.10
Nodes (33): ALL_STAGES, analyzeSession(), runPipeline(), Stage, StageContext, MIN_WORDS, Window, ExtractedClaimsSchema (+25 more)

### Community 3 - "validator.ts"
Cohesion: 0.17
Nodes (18): denormalizeRange(), FOLD, normalize(), Normalized, bestWindow(), DISFLUENCIES, DISFLUENCY_PHRASES, levenshteinRatio() (+10 more)

### Community 4 - "Db"
Cohesion: 0.10
Nodes (35): buildProgram(), classifyCliError(), Log, jsonPublisher, Publisher, formatTimestamp(), markdownPublisher, buildSnapshot() (+27 more)

### Community 5 - "db.ts"
Cohesion: 0.09
Nodes (26): Expectation, expectations, fixturesDir, here, canonical(), createClient(), hashRequest(), logEgress() (+18 more)

### Community 6 - "Package and Build Tooling"
Cohesion: 0.06
Nodes (35): @anthropic-ai/sdk, better-sqlite3, commander, dependencies, @anthropic-ai/sdk, better-sqlite3, commander, ulid (+27 more)

### Community 7 - "TypeScript Compiler Configuration"
Cohesion: 0.10
Nodes (19): ES2023, src/**/*.ts, tests/**/*.ts, compilerOptions, declaration, esModuleInterop, lib, module (+11 more)

### Community 8 - "SQLite Schema"
Cohesion: 0.30
Nodes (14): acceptance_criteria, approval_events, claim_links, claims, egress_log, open_questions, projects, recommendations (+6 more)

### Community 9 - "adversarial.test.ts"
Cohesion: 0.10
Nodes (25): detectHedges(), HEDGE_MARKERS, isHedged(), PATTERNS, ClassificationSchema, stage3Classify, ReconcileSchema, RequirementDraftsSchema (+17 more)

## Knowledge Gaps
- **97 isolated node(s):** `graphify`, `graphify`, `name`, `version`, `private` (+92 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Db` connect `Db` to `domain.ts`, `createProject`, `projects.ts`, `db.ts`, `adversarial.test.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `createProject()` connect `createProject` to `adversarial.test.ts`, `projects.ts`, `Db`, `db.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `newId()` connect `createProject` to `domain.ts`, `projects.ts`, `Db`, `db.ts`, `adversarial.test.ts`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `graphify`, `graphify`, `name` to the rest of the system?**
  _97 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `domain.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06533575317604355 - nodes in this community are weakly interconnected._
- **Should `projects.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10119047619047619 - nodes in this community are weakly interconnected._
- **Should `Db` be split into smaller, more focused modules?**
  _Cohesion score 0.10195035460992907 - nodes in this community are weakly interconnected._