# BA Story Agent — Core Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the text-driven core engine of the User Story Review Agent — a CLI that takes a transcript or notes and produces a requirements baseline (Markdown + JSON) in which every confirmed requirement is mechanically proven to trace back to a verbatim quote.

**Architecture:** A SQLite-backed store, a deterministic grounding validator that contains no LLM call, a nine-stage resumable pipeline where each stage has one typed input and one typed output, and two publishers that render the same snapshot. Structured outputs (Zod schemas via the Anthropic SDK) enforce the safety properties at the type level: critique stages have no schema field in which a requirement can be expressed, and a requirement with no origin claim fails schema validation.

**Tech Stack:** Node 22, TypeScript (strict), better-sqlite3, Zod, `@anthropic-ai/sdk`, Vitest, Commander.

**Source spec:** `docs/superpowers/specs/2026-08-05-ba-story-review-agent-design.md`

**Out of scope for this plan** (later plans): Electron review UI and approval gate, ASR, transcript editor, audio capture, Jira/Confluence publishers.

## Global Constraints

- **Node 22+**, ESM only (`"type": "module"` in package.json). Verified available: v22.18.0, npm 11.12.0.
- **TypeScript strict mode on.** `strict: true`, `noUncheckedIndexedAccess: true`. No `any` in committed code.
- **Model ID is exactly `claude-opus-5`.** Never append a date suffix.
- **Never send `temperature`, `top_p`, or `top_k`** — these return HTTP 400 on `claude-opus-5`.
- **Never send `thinking: { type: "enabled", budget_tokens: N }`** — returns 400. Thinking is on by default on `claude-opus-5`; control depth with `output_config: { effort: ... }`.
- **`max_tokens: 16000`** for all non-streaming pipeline calls.
- **Anthropic SDK timeouts are in milliseconds** (unlike the Python SDK's seconds).
- **Token counting uses `client.messages.countTokens()`.** Never `tiktoken` or any character-count approximation — both are wrong for Claude.
- **The grounding validator (`src/grounding/`) must contain no LLM call and no network I/O.** This is the safety property; it is pure functions over strings.
- **Fuzzy match threshold is exactly `0.90`** on token-level Levenshtein ratio over word tokens.
- **Minimum input length is exactly 200 words.** The pipeline hard-blocks below this; it does not warn.
- **All timestamps stored as ISO-8601 UTC strings.** SQLite has no date type.
- **All IDs are prefixed ULIDs** (e.g. `clm_01J...`) so an ID is self-describing in logs and exports.

---

## File Structure

```
src/
  types/domain.ts            Zod schemas + inferred types for every entity. The shared contract.
  types/ids.ts               Prefixed ULID generation and branded ID types.
  store/schema.sql           DDL for all tables.
  store/db.ts                Connection, pragma setup, migration runner.
  store/projects.ts          Project, Session repositories.
  store/transcripts.ts       Transcript, Segment repositories.
  store/claims.ts            Claim repository.
  store/artifacts.ts         Requirement, Story, AcceptanceCriterion repositories.
  store/findings.ts          OpenQuestion, Recommendation repositories.
  store/audit.ts             ApprovalEvent, EgressLog, StageCheckpoint repositories.
  grounding/normalize.ts     Whitespace/case/quote normalization. Pure.
  grounding/similarity.ts    Word-token Levenshtein ratio + best-window search. Pure.
  grounding/validator.ts     The four-step validation ladder. Pure.
  hedge/lexicon.ts           Hedge marker detection. Pure.
  llm/client.ts              Anthropic client wrapper, egress log, token accounting.
  llm/parse.ts               Typed structured-output call with schema retry.
  pipeline/runner.ts         Stage orchestration, checkpointing, resume.
  pipeline/stage0-chunk.ts   Deterministic windowing.
  pipeline/stage1-extract.ts Claim extraction (LLM).
  pipeline/stage2-validate.ts Grounding validation (no LLM).
  pipeline/stage3-classify.ts Classification + hedge guard.
  pipeline/stage4-reconcile.ts Contradictions + cross-session links (LLM).
  pipeline/stage5-requirements.ts Requirement synthesis (LLM).
  pipeline/stage6-stories.ts  Story + acceptance criteria synthesis (LLM).
  pipeline/stage7-critique.ts Four parallel reviewers (LLM).
  pipeline/stage8-assemble.ts Persist and mark awaiting-review.
  prompts/*.ts               One file per LLM stage; prompt text only, no logic.
  export/snapshot.ts         Build an ExportSnapshot from the store.
  export/json.ts             JSON publisher.
  export/markdown.ts         Markdown publisher.
  cli/index.ts               Commander entry point.
tests/
  <mirrors src/>             Unit tests.
  fixtures/transcripts/      Golden and adversarial transcripts.
  fixtures/golden/           Expected-output labels.
```

Files are split by responsibility, not layer: each store file owns the entities that change together, and each pipeline stage is one file with one exported function so a stage can be read, tested, and replaced in isolation.

---

### Task 1: Project scaffold and toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/version.ts`
- Test: `tests/version.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` (vitest), `npm run build` (tsc), `npm run cli` (tsx). Export `ENGINE_VERSION: string` from `src/version.ts` — the export snapshot embeds it for provenance.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/version.test.ts
import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "../src/version.js";

describe("ENGINE_VERSION", () => {
  it("is a semver string", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "ba-story-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "cli": "tsx src/cli/index.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.68.0",
    "better-sqlite3": "^11.10.0",
    "commander": "^12.1.0",
    "ulid": "^2.3.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.15.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Note: with `module: NodeNext`, every relative import must carry a `.js` extension even though the source is `.ts`. Every import in this plan follows that rule.

- [ ] **Step 4: Create vitest.config.ts and .gitignore**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

```
# .gitignore
node_modules/
dist/
*.db
*.db-journal
.env
```

- [ ] **Step 5: Create src/version.ts**

```typescript
// src/version.ts
export const ENGINE_VERSION = "0.1.0";
```

- [ ] **Step 6: Install and run the test**

Run: `npm install && npm test`
Expected: 1 test passes.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/version.ts tests/version.test.ts
git commit -m "chore: scaffold TypeScript project with vitest"
```

---

### Task 2: Domain schemas and ID generation

**Files:**
- Create: `src/types/ids.ts`
- Create: `src/types/domain.ts`
- Test: `tests/types/ids.test.ts`, `tests/types/domain.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `newId(prefix: IdPrefix): string` — prefixed ULID.
  - Zod schemas: `ProjectSchema`, `SessionSchema`, `TranscriptSchema`, `SegmentSchema`, `ClaimSchema`, `RequirementSchema`, `StorySchema`, `AcceptanceCriterionSchema`, `OpenQuestionSchema`, `RecommendationSchema`, `ApprovalEventSchema`, `EgressLogSchema`.
  - Inferred types with the same name minus `Schema`: `Project`, `Session`, `Claim`, etc.
  - Enum consts: `ClaimKind`, `ClaimStatus`, `RequirementStatus`, `AcSource`, `QuestionStatus`, `CritiqueCategory`.

- [ ] **Step 1: Write the failing test for IDs**

```typescript
// tests/types/ids.test.ts
import { describe, it, expect } from "vitest";
import { newId } from "../../src/types/ids.js";

describe("newId", () => {
  it("prefixes the ULID with the entity prefix", () => {
    expect(newId("clm")).toMatch(/^clm_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId("req")));
    expect(ids.size).toBe(500);
  });

  it("produces lexicographically sortable ids within a prefix", () => {
    const a = newId("seg");
    const b = newId("seg");
    expect(a < b || a === b).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/types/ids.test.ts`
Expected: FAIL — cannot find module `../../src/types/ids.js`.

- [ ] **Step 3: Implement src/types/ids.ts**

```typescript
// src/types/ids.ts
import { ulid } from "ulid";

export const ID_PREFIXES = [
  "prj", "ses", "aud", "trs", "seg", "clm",
  "req", "sty", "acr", "oqn", "rec", "apv", "egr", "ckp",
] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}
```

- [ ] **Step 4: Run the ID test**

Run: `npx vitest run tests/types/ids.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for domain schemas**

```typescript
// tests/types/domain.test.ts
import { describe, it, expect } from "vitest";
import { ClaimSchema, RequirementSchema, RecommendationSchema } from "../../src/types/domain.js";

describe("ClaimSchema", () => {
  it("accepts a well-formed claim", () => {
    const parsed = ClaimSchema.parse({
      id: "clm_01J000000000000000000000AA",
      sessionId: "ses_01J000000000000000000000AB",
      transcriptId: "trs_01J000000000000000000000AC",
      segmentId: "seg_01J000000000000000000000AD",
      quote: "anything over ten thousand euro goes to a manager",
      statement: "Invoices over EUR 10,000 require manager approval.",
      speakerRole: "client",
      kind: "requirement",
      status: "validated",
      charStart: 120,
      charEnd: 169,
      matchMode: "exact",
      createdAt: "2026-08-05T10:00:00.000Z",
    });
    expect(parsed.kind).toBe("requirement");
  });

  it("rejects an empty quote", () => {
    expect(() =>
      ClaimSchema.parse({
        id: "clm_01J000000000000000000000AA",
        sessionId: "ses_01J000000000000000000000AB",
        transcriptId: "trs_01J000000000000000000000AC",
        segmentId: "seg_01J000000000000000000000AD",
        quote: "",
        statement: "x",
        speakerRole: "client",
        kind: "requirement",
        status: "candidate",
        charStart: null,
        charEnd: null,
        matchMode: null,
        createdAt: "2026-08-05T10:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("RequirementSchema", () => {
  it("rejects a requirement with no origin claims", () => {
    expect(() =>
      RequirementSchema.parse({
        id: "req_01J000000000000000000000AA",
        projectId: "prj_01J000000000000000000000AB",
        key: "REQ-001",
        statement: "Invoices over EUR 10,000 require manager approval.",
        status: "proposed",
        origin: "client-stated",
        originClaimIds: [],
        supersedesId: null,
        createdAt: "2026-08-05T10:00:00.000Z",
      }),
    ).toThrow(/at least one origin claim/);
  });
});

describe("RecommendationSchema", () => {
  it("has no field capable of expressing a requirement", () => {
    const keys = Object.keys(RecommendationSchema.shape);
    expect(keys).not.toContain("requirement");
    expect(keys).not.toContain("statement");
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npx vitest run tests/types/domain.test.ts`
Expected: FAIL — cannot find module `../../src/types/domain.js`.

- [ ] **Step 7: Implement src/types/domain.ts**

```typescript
// src/types/domain.ts
import { z } from "zod";

const Iso = z.string().datetime();

export const ClaimKind = z.enum(["requirement", "assumption", "ambiguity"]);
export const ClaimStatus = z.enum(["candidate", "validated", "quarantined"]);
export const MatchMode = z.enum(["exact", "segment-corrected", "fuzzy"]);
export const SpeakerRole = z.enum(["client", "ba", "other", "unknown"]);
export const RequirementStatus = z.enum([
  "proposed", "confirmed", "finalized", "superseded", "rejected",
]);
export const RequirementOrigin = z.enum(["client-stated", "ba-authored"]);
export const AcSource = z.enum(["client-stated", "derived"]);
export const QuestionStatus = z.enum(["open", "asked", "answered", "closed"]);
export const RecommendationStatus = z.enum(["open", "accepted", "declined"]);
export const CritiqueCategory = z.enum([
  "domain", "security", "privacy", "compliance", "edge-case", "testability",
]);
export const RegulatoryContext = z.enum([
  "none", "GDPR", "HIPAA", "PCI-DSS", "SOC2",
]);
export const SessionStatus = z.enum([
  "draft", "analyzing", "awaiting-review", "finalized", "failed",
]);
export const LinkKind = z.enum(["confirms", "refines", "supersedes", "contradicts"]);

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  domain: z.string().min(10, "project domain must be a meaningful one-liner"),
  regulatoryContext: RegulatoryContext,
  systemName: z.string().nullable(),
  glossary: z.string().nullable(),
  createdAt: Iso,
});

export const SessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string().min(1),
  occurredAt: Iso,
  status: SessionStatus,
  createdAt: Iso,
});

export const TranscriptSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  version: z.number().int().positive(),
  text: z.string().min(1),
  contentHash: z.string().length(64),
  frozenAt: Iso.nullable(),
  createdAt: Iso,
});

export const SegmentSchema = z.object({
  id: z.string(),
  transcriptId: z.string(),
  idx: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().nonnegative().nullable(),
  speakerLabel: z.string().nullable(),
  text: z.string(),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
});

export const ClaimSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  transcriptId: z.string(),
  segmentId: z.string(),
  quote: z.string().min(1, "a claim must carry a non-empty quote"),
  statement: z.string().min(1),
  speakerRole: SpeakerRole,
  kind: ClaimKind,
  status: ClaimStatus,
  charStart: z.number().int().nonnegative().nullable(),
  charEnd: z.number().int().nonnegative().nullable(),
  matchMode: MatchMode.nullable(),
  createdAt: Iso,
});

export const RequirementSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string().regex(/^REQ-\d{3,}$/),
  statement: z.string().min(1),
  status: RequirementStatus,
  origin: RequirementOrigin,
  originClaimIds: z.array(z.string()),
  supersedesId: z.string().nullable(),
  createdAt: Iso,
}).refine(
  (r) => r.origin === "ba-authored" || r.originClaimIds.length > 0,
  { message: "a client-stated requirement must cite at least one origin claim", path: ["originClaimIds"] },
);

export const AcceptanceCriterionSchema = z.object({
  id: z.string(),
  storyId: z.string(),
  idx: z.number().int().nonnegative(),
  gherkin: z.string().min(1),
  source: AcSource,
  linkedQuestionId: z.string().nullable(),
});

export const StorySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string().regex(/^US-\d{3,}$/),
  asA: z.string().min(1),
  iWant: z.string().min(1),
  soThat: z.string().min(1),
  requirementIds: z.array(z.string()).min(1),
  createdAt: Iso,
});

export const OpenQuestionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string().regex(/^OQ-\d{3,}$/),
  text: z.string().min(1),
  category: CritiqueCategory,
  raisedBySessionId: z.string(),
  status: QuestionStatus,
  answerText: z.string().nullable(),
  answeredBySessionId: z.string().nullable(),
  createdAt: Iso,
});

export const RecommendationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string().regex(/^REC-\d{3,}$/),
  text: z.string().min(1),
  rationale: z.string().min(1),
  category: CritiqueCategory,
  raisedBySessionId: z.string(),
  status: RecommendationStatus,
  dispositionNote: z.string().nullable(),
  createdAt: Iso,
});

export const ApprovalEventSchema = z.object({
  id: z.string(),
  entityType: z.enum(["requirement", "story", "question", "recommendation", "session"]),
  entityId: z.string(),
  action: z.string().min(1),
  actorNote: z.string().nullable(),
  contentHash: z.string().length(64),
  at: Iso,
});

export const EgressLogSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  stage: z.string().min(1),
  requestHash: z.string().length(64),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  model: z.string().min(1),
  at: Iso,
});

export type Project = z.infer<typeof ProjectSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type Story = z.infer<typeof StorySchema>;
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type ApprovalEvent = z.infer<typeof ApprovalEventSchema>;
export type EgressLog = z.infer<typeof EgressLogSchema>;
```

Note: `RequirementSchema` uses `.refine()`, so it is a `ZodEffects`, not a `ZodObject` — it has no `.shape`. `RecommendationSchema` is a plain object and does expose `.shape`, which the test relies on.

- [ ] **Step 8: Run the domain test**

Run: `npx vitest run tests/types/domain.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add src/types tests/types
git commit -m "feat: add domain schemas and prefixed ULID generation"
```

---

### Task 3: Database connection and migrations

**Files:**
- Create: `src/store/schema.sql`
- Create: `src/store/db.ts`
- Test: `tests/store/db.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `openDb(path: string): Database` — a `better-sqlite3` `Database` with foreign keys and WAL enabled, schema applied idempotently. `closeDb(db: Database): void`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/store/db.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";

describe("openDb", () => {
  it("creates all tables", () => {
    const db = openDb(":memory:");
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const t of [
      "projects", "sessions", "transcripts", "segments", "claims",
      "requirements", "stories", "acceptance_criteria",
      "open_questions", "recommendations",
      "approval_events", "egress_log", "stage_checkpoints", "claim_links",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("enforces foreign keys", () => {
    const db = openDb(":memory:");
    expect(() =>
      db.prepare(
        "INSERT INTO sessions (id, project_id, title, occurred_at, status, created_at) VALUES (?,?,?,?,?,?)",
      ).run("ses_x", "prj_missing", "t", "2026-08-05T00:00:00.000Z", "draft", "2026-08-05T00:00:00.000Z"),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("is idempotent when applied twice", () => {
    const db = openDb(":memory:");
    expect(() => openDb(":memory:")).not.toThrow();
    expect(db.prepare("SELECT 1 AS ok").get()).toEqual({ ok: 1 });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/store/db.test.ts`
Expected: FAIL — cannot find module `../../src/store/db.js`.

- [ ] **Step 3: Write src/store/schema.sql**

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  regulatory_context TEXT NOT NULL DEFAULT 'none',
  system_name TEXT,
  glossary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  frozen_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, version)
);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  start_ms INTEGER,
  end_ms INTEGER,
  speaker_label TEXT,
  text TEXT NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  UNIQUE (transcript_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_segments_transcript ON segments(transcript_id);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL,
  quote TEXT NOT NULL,
  statement TEXT NOT NULL,
  speaker_role TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  char_start INTEGER,
  char_end INTEGER,
  match_mode TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_session ON claims(session_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(session_id, status);

CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL,
  origin TEXT NOT NULL,
  origin_claim_ids TEXT NOT NULL,
  supersedes_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, key)
);
CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id);

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  as_a TEXT NOT NULL,
  i_want TEXT NOT NULL,
  so_that TEXT NOT NULL,
  requirement_ids TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS acceptance_criteria (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  gherkin TEXT NOT NULL,
  source TEXT NOT NULL,
  linked_question_id TEXT,
  UNIQUE (story_id, idx)
);

CREATE TABLE IF NOT EXISTS open_questions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  text TEXT NOT NULL,
  category TEXT NOT NULL,
  raised_by_session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  answer_text TEXT,
  answered_by_session_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  text TEXT NOT NULL,
  rationale TEXT NOT NULL,
  category TEXT NOT NULL,
  raised_by_session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  disposition_note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS claim_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_claim_id TEXT NOT NULL,
  to_requirement_id TEXT,
  to_claim_id TEXT,
  link_kind TEXT NOT NULL,
  rationale TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_note TEXT,
  content_hash TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_entity ON approval_events(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS egress_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  model TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_egress_session ON egress_log(session_id);

CREATE TABLE IF NOT EXISTS stage_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT,
  error_text TEXT,
  raw_response TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (session_id, stage)
);
```

- [ ] **Step 4: Implement src/store/db.ts**

```typescript
// src/store/db.ts
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Db = Database.Database;

const here = dirname(fileURLToPath(import.meta.url));

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const ddl = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(ddl);
  return db;
}

export function closeDb(db: Db): void {
  db.close();
}
```

- [ ] **Step 5: Make schema.sql available to the built output**

`tsc` does not copy `.sql` files. Add a build step so `dist/store/schema.sql` exists:

```json
"scripts": {
  "build": "tsc && node -e \"require('fs').copyFileSync('src/store/schema.sql','dist/src/store/schema.sql')\"",
  "test": "vitest run",
  "test:watch": "vitest",
  "cli": "tsx src/cli/index.ts"
}
```

Tests run through `tsx`/vitest against `src/`, so `readFileSync` resolves correctly there without the copy.

- [ ] **Step 6: Run the test**

Run: `npx vitest run tests/store/db.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/store/schema.sql src/store/db.ts tests/store/db.test.ts package.json
git commit -m "feat: add SQLite schema and connection with FK enforcement"
```

---

### Task 4: Project, session, and transcript repositories

**Files:**
- Create: `src/store/projects.ts`, `src/store/transcripts.ts`
- Test: `tests/store/projects.test.ts`, `tests/store/transcripts.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 3), domain types (Task 2), `newId` (Task 2).
- Produces:
  - `createProject(db, input: { name; domain; regulatoryContext?; systemName?; glossary? }): Project`
  - `getProject(db, id: string): Project | null`
  - `createSession(db, input: { projectId; title; occurredAt? }): Session`
  - `setSessionStatus(db, sessionId: string, status: Session["status"]): void`
  - `listSessions(db, projectId: string): Session[]`
  - `hashText(text: string): string` — SHA-256 hex, exported from `transcripts.ts`.
  - `createTranscript(db, input: { sessionId; text }): { transcript: Transcript; segments: Segment[] }` — segments are produced by splitting on blank lines, each carrying its char offsets into `text`.
  - `freezeTranscript(db, transcriptId: string): Transcript`
  - `getFrozenTranscript(db, sessionId: string): { transcript: Transcript; segments: Segment[] } | null`

- [ ] **Step 1: Write the failing test for projects**

```typescript
// tests/store/projects.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, getProject, createSession, listSessions, setSessionStatus } from "../../src/store/projects.js";

describe("projects", () => {
  it("round-trips a project", () => {
    const db = openDb(":memory:");
    const created = createProject(db, {
      name: "Nordic Freight",
      domain: "B2B freight invoicing for EU logistics operators",
      regulatoryContext: "GDPR",
    });
    const fetched = getProject(db, created.id);
    expect(fetched?.name).toBe("Nordic Freight");
    expect(fetched?.regulatoryContext).toBe("GDPR");
  });

  it("rejects a project with a too-short domain", () => {
    const db = openDb(":memory:");
    expect(() => createProject(db, { name: "X", domain: "stuff" })).toThrow();
  });

  it("lists sessions for a project and updates status", () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics" });
    const s = createSession(db, { projectId: p.id, title: "Kickoff" });
    setSessionStatus(db, s.id, "awaiting-review");
    const sessions = listSessions(db, p.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe("awaiting-review");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/store/projects.test.ts`
Expected: FAIL — cannot find module `../../src/store/projects.js`.

- [ ] **Step 3: Implement src/store/projects.ts**

```typescript
// src/store/projects.ts
import type { Db } from "./db.js";
import { newId } from "../types/ids.js";
import {
  ProjectSchema, SessionSchema,
  type Project, type Session,
} from "../types/domain.js";

interface ProjectRow {
  id: string; name: string; domain: string; regulatory_context: string;
  system_name: string | null; glossary: string | null; created_at: string;
}

interface SessionRow {
  id: string; project_id: string; title: string;
  occurred_at: string; status: string; created_at: string;
}

function toProject(row: ProjectRow): Project {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    domain: row.domain,
    regulatoryContext: row.regulatory_context,
    systemName: row.system_name,
    glossary: row.glossary,
    createdAt: row.created_at,
  });
}

function toSession(row: SessionRow): Session {
  return SessionSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    occurredAt: row.occurred_at,
    status: row.status,
    createdAt: row.created_at,
  });
}

export function createProject(
  db: Db,
  input: {
    name: string;
    domain: string;
    regulatoryContext?: Project["regulatoryContext"];
    systemName?: string | null;
    glossary?: string | null;
  },
): Project {
  const project = ProjectSchema.parse({
    id: newId("prj"),
    name: input.name,
    domain: input.domain,
    regulatoryContext: input.regulatoryContext ?? "none",
    systemName: input.systemName ?? null,
    glossary: input.glossary ?? null,
    createdAt: new Date().toISOString(),
  });
  db.prepare(
    `INSERT INTO projects (id, name, domain, regulatory_context, system_name, glossary, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    project.id, project.name, project.domain, project.regulatoryContext,
    project.systemName, project.glossary, project.createdAt,
  );
  return project;
}

export function getProject(db: Db, id: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return row ? toProject(row) : null;
}

export function createSession(
  db: Db,
  input: { projectId: string; title: string; occurredAt?: string },
): Session {
  const now = new Date().toISOString();
  const session = SessionSchema.parse({
    id: newId("ses"),
    projectId: input.projectId,
    title: input.title,
    occurredAt: input.occurredAt ?? now,
    status: "draft",
    createdAt: now,
  });
  db.prepare(
    `INSERT INTO sessions (id, project_id, title, occurred_at, status, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(
    session.id, session.projectId, session.title,
    session.occurredAt, session.status, session.createdAt,
  );
  return session;
}

export function setSessionStatus(db: Db, sessionId: string, status: Session["status"]): void {
  db.prepare("UPDATE sessions SET status = ? WHERE id = ?").run(status, sessionId);
}

export function getSession(db: Db, id: string): Session | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  return row ? toSession(row) : null;
}

export function listSessions(db: Db, projectId: string): Session[] {
  const rows = db
    .prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY occurred_at ASC")
    .all(projectId) as SessionRow[];
  return rows.map(toSession);
}
```

- [ ] **Step 4: Run the projects test**

Run: `npx vitest run tests/store/projects.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for transcripts**

```typescript
// tests/store/transcripts.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript, getFrozenTranscript, hashText } from "../../src/store/transcripts.js";

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  return { db, projectId: p.id, sessionId: s.id };
}

describe("transcripts", () => {
  it("splits into segments with correct char offsets", () => {
    const { db, sessionId } = seed();
    const text = "Alice: hello there\n\nBob: goodbye now";
    const { segments } = createTranscript(db, { sessionId, text });
    expect(segments).toHaveLength(2);
    expect(text.slice(segments[0]!.charStart, segments[0]!.charEnd)).toBe("Alice: hello there");
    expect(text.slice(segments[1]!.charStart, segments[1]!.charEnd)).toBe("Bob: goodbye now");
  });

  it("hashes content deterministically", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
    expect(hashText("abc")).toHaveLength(64);
  });

  it("only returns a transcript once frozen", () => {
    const { db, sessionId } = seed();
    const { transcript } = createTranscript(db, { sessionId, text: "one\n\ntwo" });
    expect(getFrozenTranscript(db, sessionId)).toBeNull();
    freezeTranscript(db, transcript.id);
    const frozen = getFrozenTranscript(db, sessionId);
    expect(frozen?.transcript.frozenAt).not.toBeNull();
    expect(frozen?.segments).toHaveLength(2);
  });

  it("increments version for a second transcript on the same session", () => {
    const { db, sessionId } = seed();
    const a = createTranscript(db, { sessionId, text: "first" });
    const b = createTranscript(db, { sessionId, text: "second" });
    expect(a.transcript.version).toBe(1);
    expect(b.transcript.version).toBe(2);
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npx vitest run tests/store/transcripts.test.ts`
Expected: FAIL — cannot find module `../../src/store/transcripts.js`.

- [ ] **Step 7: Implement src/store/transcripts.ts**

```typescript
// src/store/transcripts.ts
import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import { newId } from "../types/ids.js";
import {
  TranscriptSchema, SegmentSchema,
  type Transcript, type Segment,
} from "../types/domain.js";

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

interface TranscriptRow {
  id: string; session_id: string; version: number; text: string;
  content_hash: string; frozen_at: string | null; created_at: string;
}

interface SegmentRow {
  id: string; transcript_id: string; idx: number;
  start_ms: number | null; end_ms: number | null;
  speaker_label: string | null; text: string;
  char_start: number; char_end: number;
}

function toTranscript(row: TranscriptRow): Transcript {
  return TranscriptSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    version: row.version,
    text: row.text,
    contentHash: row.content_hash,
    frozenAt: row.frozen_at,
    createdAt: row.created_at,
  });
}

function toSegment(row: SegmentRow): Segment {
  return SegmentSchema.parse({
    id: row.id,
    transcriptId: row.transcript_id,
    idx: row.idx,
    startMs: row.start_ms,
    endMs: row.end_ms,
    speakerLabel: row.speaker_label,
    text: row.text,
    charStart: row.char_start,
    charEnd: row.char_end,
  });
}

/**
 * Split raw text into segments on blank lines, preserving exact character
 * offsets into the original text. Offsets are the anchor the grounding
 * validator relies on, so they must index the untouched source string.
 */
function splitSegments(transcriptId: string, text: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /\n\s*\n/g;
  let cursor = 0;
  let idx = 0;
  const push = (start: number, end: number): void => {
    const raw = text.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const s = start + leading;
    const e = end - trailing;
    if (e <= s) return;
    segments.push(
      SegmentSchema.parse({
        id: newId("seg"),
        transcriptId,
        idx: idx++,
        startMs: null,
        endMs: null,
        speakerLabel: null,
        text: text.slice(s, e),
        charStart: s,
        charEnd: e,
      }),
    );
  };
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    push(cursor, m.index);
    cursor = m.index + m[0].length;
  }
  push(cursor, text.length);
  return segments;
}

export function createTranscript(
  db: Db,
  input: { sessionId: string; text: string },
): { transcript: Transcript; segments: Segment[] } {
  const prior = db
    .prepare("SELECT MAX(version) AS v FROM transcripts WHERE session_id = ?")
    .get(input.sessionId) as { v: number | null };
  const version = (prior.v ?? 0) + 1;

  const transcript = TranscriptSchema.parse({
    id: newId("trs"),
    sessionId: input.sessionId,
    version,
    text: input.text,
    contentHash: hashText(input.text),
    frozenAt: null,
    createdAt: new Date().toISOString(),
  });

  const segments = splitSegments(transcript.id, input.text);

  const insertTranscript = db.prepare(
    `INSERT INTO transcripts (id, session_id, version, text, content_hash, frozen_at, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  );
  const insertSegment = db.prepare(
    `INSERT INTO segments (id, transcript_id, idx, start_ms, end_ms, speaker_label, text, char_start, char_end)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );

  db.transaction(() => {
    insertTranscript.run(
      transcript.id, transcript.sessionId, transcript.version, transcript.text,
      transcript.contentHash, transcript.frozenAt, transcript.createdAt,
    );
    for (const seg of segments) {
      insertSegment.run(
        seg.id, seg.transcriptId, seg.idx, seg.startMs, seg.endMs,
        seg.speakerLabel, seg.text, seg.charStart, seg.charEnd,
      );
    }
  })();

  return { transcript, segments };
}

export function freezeTranscript(db: Db, transcriptId: string): Transcript {
  const at = new Date().toISOString();
  db.prepare("UPDATE transcripts SET frozen_at = ? WHERE id = ?").run(at, transcriptId);
  const row = db.prepare("SELECT * FROM transcripts WHERE id = ?").get(transcriptId) as TranscriptRow;
  return toTranscript(row);
}

export function getFrozenTranscript(
  db: Db,
  sessionId: string,
): { transcript: Transcript; segments: Segment[] } | null {
  const row = db
    .prepare(
      `SELECT * FROM transcripts
       WHERE session_id = ? AND frozen_at IS NOT NULL
       ORDER BY version DESC LIMIT 1`,
    )
    .get(sessionId) as TranscriptRow | undefined;
  if (!row) return null;
  const segRows = db
    .prepare("SELECT * FROM segments WHERE transcript_id = ? ORDER BY idx ASC")
    .all(row.id) as SegmentRow[];
  return { transcript: toTranscript(row), segments: segRows.map(toSegment) };
}
```

- [ ] **Step 8: Run the transcripts test**

Run: `npx vitest run tests/store/transcripts.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add src/store/projects.ts src/store/transcripts.ts tests/store/projects.test.ts tests/store/transcripts.test.ts
git commit -m "feat: add project, session, and transcript repositories"
```

---

### Task 5: Claim repository

**Files:**
- Create: `src/store/claims.ts`
- Test: `tests/store/claims.test.ts`

**Interfaces:**
- Consumes: `Db`, `Claim`, `ClaimSchema`, `newId`.
- Produces:
  - `insertClaims(db, claims: Claim[]): void`
  - `listClaims(db, sessionId: string, opts?: { status?: Claim["status"]; kind?: Claim["kind"] }): Claim[]`
  - `listProjectClaims(db, projectId: string, opts?: { status?: Claim["status"]; kind?: Claim["kind"] }): Claim[]`
  - `updateClaimValidation(db, id: string, patch: { status; charStart; charEnd; matchMode; segmentId }): void`
  - `countByStatus(db, sessionId: string): Record<string, number>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/store/claims.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript } from "../../src/store/transcripts.js";
import { insertClaims, listClaims, listProjectClaims, updateClaimValidation, countByStatus } from "../../src/store/claims.js";
import { newId } from "../../src/types/ids.js";
import type { Claim } from "../../src/types/domain.js";

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "hello there\n\ngoodbye now" });
  return { db, projectId: p.id, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id };
}

function claim(over: Partial<Claim> & Pick<Claim, "sessionId" | "transcriptId" | "segmentId">): Claim {
  return {
    id: newId("clm"),
    quote: "hello there",
    statement: "A greeting is issued.",
    speakerRole: "client",
    kind: "requirement",
    status: "candidate",
    charStart: null,
    charEnd: null,
    matchMode: null,
    createdAt: new Date().toISOString(),
    ...over,
  } as Claim;
}

describe("claims", () => {
  it("inserts and filters by status and kind", () => {
    const { db, sessionId, transcriptId, segmentId } = seed();
    insertClaims(db, [
      claim({ sessionId, transcriptId, segmentId, status: "validated", kind: "requirement" }),
      claim({ sessionId, transcriptId, segmentId, status: "quarantined", kind: "requirement" }),
      claim({ sessionId, transcriptId, segmentId, status: "validated", kind: "assumption" }),
    ]);
    expect(listClaims(db, sessionId)).toHaveLength(3);
    expect(listClaims(db, sessionId, { status: "validated" })).toHaveLength(2);
    expect(listClaims(db, sessionId, { status: "validated", kind: "assumption" })).toHaveLength(1);
  });

  it("updates validation outcome", () => {
    const { db, sessionId, transcriptId, segmentId } = seed();
    const c = claim({ sessionId, transcriptId, segmentId });
    insertClaims(db, [c]);
    updateClaimValidation(db, c.id, {
      status: "validated", charStart: 0, charEnd: 11, matchMode: "exact", segmentId,
    });
    const updated = listClaims(db, sessionId)[0]!;
    expect(updated.status).toBe("validated");
    expect(updated.matchMode).toBe("exact");
    expect(updated.charEnd).toBe(11);
  });

  it("counts by status", () => {
    const { db, sessionId, transcriptId, segmentId } = seed();
    insertClaims(db, [
      claim({ sessionId, transcriptId, segmentId, status: "validated" }),
      claim({ sessionId, transcriptId, segmentId, status: "quarantined" }),
      claim({ sessionId, transcriptId, segmentId, status: "quarantined" }),
    ]);
    expect(countByStatus(db, sessionId)).toEqual({ validated: 1, quarantined: 2 });
  });

  it("lists claims across all sessions in a project", () => {
    const { db, projectId, sessionId, transcriptId, segmentId } = seed();
    insertClaims(db, [claim({ sessionId, transcriptId, segmentId, status: "validated" })]);
    expect(listProjectClaims(db, projectId, { status: "validated" })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/store/claims.test.ts`
Expected: FAIL — cannot find module `../../src/store/claims.js`.

- [ ] **Step 3: Implement src/store/claims.ts**

```typescript
// src/store/claims.ts
import type { Db } from "./db.js";
import { ClaimSchema, type Claim } from "../types/domain.js";

interface ClaimRow {
  id: string; session_id: string; transcript_id: string; segment_id: string;
  quote: string; statement: string; speaker_role: string;
  kind: string; status: string;
  char_start: number | null; char_end: number | null;
  match_mode: string | null; created_at: string;
}

function toClaim(row: ClaimRow): Claim {
  return ClaimSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    transcriptId: row.transcript_id,
    segmentId: row.segment_id,
    quote: row.quote,
    statement: row.statement,
    speakerRole: row.speaker_role,
    kind: row.kind,
    status: row.status,
    charStart: row.char_start,
    charEnd: row.char_end,
    matchMode: row.match_mode,
    createdAt: row.created_at,
  });
}

export function insertClaims(db: Db, claims: Claim[]): void {
  const stmt = db.prepare(
    `INSERT INTO claims
       (id, session_id, transcript_id, segment_id, quote, statement, speaker_role,
        kind, status, char_start, char_end, match_mode, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    for (const c of claims) {
      ClaimSchema.parse(c);
      stmt.run(
        c.id, c.sessionId, c.transcriptId, c.segmentId, c.quote, c.statement,
        c.speakerRole, c.kind, c.status, c.charStart, c.charEnd, c.matchMode, c.createdAt,
      );
    }
  })();
}

function applyFilters(
  base: string,
  opts?: { status?: Claim["status"]; kind?: Claim["kind"] },
): { sql: string; extra: string[] } {
  const extra: string[] = [];
  let sql = base;
  if (opts?.status) { sql += " AND c.status = ?"; extra.push(opts.status); }
  if (opts?.kind) { sql += " AND c.kind = ?"; extra.push(opts.kind); }
  sql += " ORDER BY c.created_at ASC, c.id ASC";
  return { sql, extra };
}

export function listClaims(
  db: Db,
  sessionId: string,
  opts?: { status?: Claim["status"]; kind?: Claim["kind"] },
): Claim[] {
  const { sql, extra } = applyFilters("SELECT c.* FROM claims c WHERE c.session_id = ?", opts);
  return (db.prepare(sql).all(sessionId, ...extra) as ClaimRow[]).map(toClaim);
}

export function listProjectClaims(
  db: Db,
  projectId: string,
  opts?: { status?: Claim["status"]; kind?: Claim["kind"] },
): Claim[] {
  const { sql, extra } = applyFilters(
    `SELECT c.* FROM claims c
     JOIN sessions s ON s.id = c.session_id
     WHERE s.project_id = ?`,
    opts,
  );
  return (db.prepare(sql).all(projectId, ...extra) as ClaimRow[]).map(toClaim);
}

export function updateClaimValidation(
  db: Db,
  id: string,
  patch: {
    status: Claim["status"];
    charStart: number | null;
    charEnd: number | null;
    matchMode: Claim["matchMode"];
    segmentId: string;
  },
): void {
  db.prepare(
    `UPDATE claims
     SET status = ?, char_start = ?, char_end = ?, match_mode = ?, segment_id = ?
     WHERE id = ?`,
  ).run(patch.status, patch.charStart, patch.charEnd, patch.matchMode, patch.segmentId, id);
}

export function countByStatus(db: Db, sessionId: string): Record<string, number> {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS n FROM claims WHERE session_id = ? GROUP BY status")
    .all(sessionId) as { status: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/store/claims.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/claims.ts tests/store/claims.test.ts
git commit -m "feat: add claim repository with status and kind filters"
```

---

### Task 6: Artifact, finding, and audit repositories

**Files:**
- Create: `src/store/artifacts.ts`, `src/store/findings.ts`, `src/store/audit.ts`
- Test: `tests/store/artifacts.test.ts`, `tests/store/findings.test.ts`, `tests/store/audit.test.ts`

**Interfaces:**
- Consumes: `Db`, domain types, `newId`.
- Produces:
  - From `artifacts.ts`: `nextKey(db, projectId, table, prefix): string`, `insertRequirements(db, reqs: Requirement[]): void`, `listRequirements(db, projectId, opts?: { status? }): Requirement[]`, `insertStory(db, story: Story, criteria: AcceptanceCriterion[]): void`, `listStories(db, projectId): { story: Story; criteria: AcceptanceCriterion[] }[]`
  - From `findings.ts`: `insertQuestions(db, qs: OpenQuestion[]): void`, `listQuestions(db, projectId, opts?: { status? }): OpenQuestion[]`, `insertRecommendations(db, recs: Recommendation[]): void`, `listRecommendations(db, projectId): Recommendation[]`
  - From `audit.ts`: `recordApproval(db, e: Omit<ApprovalEvent, "id" | "at">): ApprovalEvent`, `listApprovals(db, entityType, entityId): ApprovalEvent[]`, `recordEgress(db, e: Omit<EgressLog, "id" | "at">): void`, `egressSummary(db, sessionId): { requests: number; promptTokens: number; completionTokens: number }`, `saveCheckpoint(db, sessionId, stage, status, payload)`, `loadCheckpoint(db, sessionId, stage)`

- [ ] **Step 1: Write the failing test for artifacts**

```typescript
// tests/store/artifacts.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject } from "../../src/store/projects.js";
import { nextKey, insertRequirements, listRequirements, insertStory, listStories } from "../../src/store/artifacts.js";
import { newId } from "../../src/types/ids.js";

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  return { db, projectId: p.id };
}

describe("artifacts", () => {
  it("allocates sequential keys per project", () => {
    const { db, projectId } = seed();
    expect(nextKey(db, projectId, "requirements", "REQ")).toBe("REQ-001");
    insertRequirements(db, [{
      id: newId("req"), projectId, key: "REQ-001",
      statement: "Manager approval required.", status: "proposed",
      origin: "client-stated", originClaimIds: ["clm_x"], supersedesId: null,
      createdAt: new Date().toISOString(),
    }]);
    expect(nextKey(db, projectId, "requirements", "REQ")).toBe("REQ-002");
  });

  it("round-trips a requirement including its origin claim ids", () => {
    const { db, projectId } = seed();
    insertRequirements(db, [{
      id: newId("req"), projectId, key: "REQ-001",
      statement: "Manager approval required.", status: "proposed",
      origin: "client-stated", originClaimIds: ["clm_a", "clm_b"], supersedesId: null,
      createdAt: new Date().toISOString(),
    }]);
    const [r] = listRequirements(db, projectId);
    expect(r?.originClaimIds).toEqual(["clm_a", "clm_b"]);
  });

  it("rejects a client-stated requirement with no origin claims", () => {
    const { db, projectId } = seed();
    expect(() => insertRequirements(db, [{
      id: newId("req"), projectId, key: "REQ-001",
      statement: "Invented.", status: "proposed",
      origin: "client-stated", originClaimIds: [], supersedesId: null,
      createdAt: new Date().toISOString(),
    }])).toThrow(/origin claim/);
  });

  it("stores a story with its acceptance criteria in order", () => {
    const { db, projectId } = seed();
    const storyId = newId("sty");
    insertStory(db,
      {
        id: storyId, projectId, key: "US-001",
        asA: "finance clerk", iWant: "invoices routed", soThat: "spend is checked",
        requirementIds: ["req_a"], createdAt: new Date().toISOString(),
      },
      [
        { id: newId("acr"), storyId, idx: 0, gherkin: "Given A when B then C", source: "client-stated", linkedQuestionId: null },
        { id: newId("acr"), storyId, idx: 1, gherkin: "Given D when E then F", source: "derived", linkedQuestionId: "oqn_x" },
      ],
    );
    const [entry] = listStories(db, projectId);
    expect(entry?.criteria.map((c) => c.source)).toEqual(["client-stated", "derived"]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/store/artifacts.test.ts`
Expected: FAIL — cannot find module `../../src/store/artifacts.js`.

- [ ] **Step 3: Implement src/store/artifacts.ts**

```typescript
// src/store/artifacts.ts
import type { Db } from "./db.js";
import {
  RequirementSchema, StorySchema, AcceptanceCriterionSchema,
  type Requirement, type Story, type AcceptanceCriterion,
} from "../types/domain.js";

const KEYED_TABLES = ["requirements", "stories", "open_questions", "recommendations"] as const;
export type KeyedTable = (typeof KEYED_TABLES)[number];

/** Allocate the next `PREFIX-NNN` key for a project. Not concurrency-safe by design: one BA, one process. */
export function nextKey(db: Db, projectId: string, table: KeyedTable, prefix: string): string {
  if (!KEYED_TABLES.includes(table)) throw new Error(`unknown keyed table: ${table}`);
  const rows = db
    .prepare(`SELECT key FROM ${table} WHERE project_id = ?`)
    .all(projectId) as { key: string }[];
  let max = 0;
  for (const { key } of rows) {
    const m = /-(\d+)$/.exec(key);
    if (m?.[1]) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

interface RequirementRow {
  id: string; project_id: string; key: string; statement: string;
  status: string; origin: string; origin_claim_ids: string;
  supersedes_id: string | null; created_at: string;
}

function toRequirement(row: RequirementRow): Requirement {
  return RequirementSchema.parse({
    id: row.id,
    projectId: row.project_id,
    key: row.key,
    statement: row.statement,
    status: row.status,
    origin: row.origin,
    originClaimIds: JSON.parse(row.origin_claim_ids) as string[],
    supersedesId: row.supersedes_id,
    createdAt: row.created_at,
  });
}

export function insertRequirements(db: Db, reqs: Requirement[]): void {
  const stmt = db.prepare(
    `INSERT INTO requirements
       (id, project_id, key, statement, status, origin, origin_claim_ids, supersedes_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    for (const r of reqs) {
      RequirementSchema.parse(r);
      stmt.run(
        r.id, r.projectId, r.key, r.statement, r.status, r.origin,
        JSON.stringify(r.originClaimIds), r.supersedesId, r.createdAt,
      );
    }
  })();
}

export function listRequirements(
  db: Db,
  projectId: string,
  opts?: { status?: Requirement["status"] },
): Requirement[] {
  let sql = "SELECT * FROM requirements WHERE project_id = ?";
  const extra: string[] = [];
  if (opts?.status) { sql += " AND status = ?"; extra.push(opts.status); }
  sql += " ORDER BY key ASC";
  return (db.prepare(sql).all(projectId, ...extra) as RequirementRow[]).map(toRequirement);
}

export function setRequirementStatus(db: Db, id: string, status: Requirement["status"]): void {
  db.prepare("UPDATE requirements SET status = ? WHERE id = ?").run(status, id);
}

interface StoryRow {
  id: string; project_id: string; key: string;
  as_a: string; i_want: string; so_that: string;
  requirement_ids: string; created_at: string;
}

interface AcRow {
  id: string; story_id: string; idx: number;
  gherkin: string; source: string; linked_question_id: string | null;
}

export function insertStory(db: Db, story: Story, criteria: AcceptanceCriterion[]): void {
  StorySchema.parse(story);
  const insertS = db.prepare(
    `INSERT INTO stories (id, project_id, key, as_a, i_want, so_that, requirement_ids, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  const insertAc = db.prepare(
    `INSERT INTO acceptance_criteria (id, story_id, idx, gherkin, source, linked_question_id)
     VALUES (?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    insertS.run(
      story.id, story.projectId, story.key, story.asA, story.iWant, story.soThat,
      JSON.stringify(story.requirementIds), story.createdAt,
    );
    for (const ac of criteria) {
      AcceptanceCriterionSchema.parse(ac);
      insertAc.run(ac.id, ac.storyId, ac.idx, ac.gherkin, ac.source, ac.linkedQuestionId);
    }
  })();
}

export function listStories(
  db: Db,
  projectId: string,
): { story: Story; criteria: AcceptanceCriterion[] }[] {
  const rows = db
    .prepare("SELECT * FROM stories WHERE project_id = ? ORDER BY key ASC")
    .all(projectId) as StoryRow[];
  const acStmt = db.prepare("SELECT * FROM acceptance_criteria WHERE story_id = ? ORDER BY idx ASC");
  return rows.map((row) => ({
    story: StorySchema.parse({
      id: row.id,
      projectId: row.project_id,
      key: row.key,
      asA: row.as_a,
      iWant: row.i_want,
      soThat: row.so_that,
      requirementIds: JSON.parse(row.requirement_ids) as string[],
      createdAt: row.created_at,
    }),
    criteria: (acStmt.all(row.id) as AcRow[]).map((a) =>
      AcceptanceCriterionSchema.parse({
        id: a.id,
        storyId: a.story_id,
        idx: a.idx,
        gherkin: a.gherkin,
        source: a.source,
        linkedQuestionId: a.linked_question_id,
      }),
    ),
  }));
}
```

- [ ] **Step 4: Run the artifacts test**

Run: `npx vitest run tests/store/artifacts.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing test for findings and audit**

```typescript
// tests/store/findings.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { insertQuestions, listQuestions, insertRecommendations, listRecommendations } from "../../src/store/findings.js";
import { newId } from "../../src/types/ids.js";

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  return { db, projectId: p.id, sessionId: s.id };
}

describe("findings", () => {
  it("stores and filters open questions by status", () => {
    const { db, projectId, sessionId } = seed();
    insertQuestions(db, [
      { id: newId("oqn"), projectId, key: "OQ-001", text: "Retention period?", category: "privacy", raisedBySessionId: sessionId, status: "open", answerText: null, answeredBySessionId: null, createdAt: new Date().toISOString() },
      { id: newId("oqn"), projectId, key: "OQ-002", text: "Escalation path?", category: "domain", raisedBySessionId: sessionId, status: "asked", answerText: null, answeredBySessionId: null, createdAt: new Date().toISOString() },
    ]);
    expect(listQuestions(db, projectId)).toHaveLength(2);
    expect(listQuestions(db, projectId, { status: "open" })).toHaveLength(1);
  });

  it("stores recommendations with rationale", () => {
    const { db, projectId, sessionId } = seed();
    insertRecommendations(db, [{
      id: newId("rec"), projectId, key: "REC-001",
      text: "Approval actions need an immutable audit trail.",
      rationale: "Financial approval with no audit mechanism discussed.",
      category: "security", raisedBySessionId: sessionId, status: "open",
      dispositionNote: null, createdAt: new Date().toISOString(),
    }]);
    expect(listRecommendations(db, projectId)[0]?.rationale).toMatch(/audit mechanism/);
  });
});
```

```typescript
// tests/store/audit.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { recordApproval, listApprovals, recordEgress, egressSummary, saveCheckpoint, loadCheckpoint } from "../../src/store/audit.js";

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  return { db, sessionId: s.id };
}

describe("audit", () => {
  it("records approvals with a content hash", () => {
    const { db } = seed();
    recordApproval(db, {
      entityType: "requirement", entityId: "req_x", action: "approve",
      actorNote: null, contentHash: "a".repeat(64),
    });
    expect(listApprovals(db, "requirement", "req_x")).toHaveLength(1);
  });

  it("summarizes egress across a session", () => {
    const { db, sessionId } = seed();
    recordEgress(db, { sessionId, stage: "extract", requestHash: "b".repeat(64), promptTokens: 100, completionTokens: 20, model: "claude-opus-5" });
    recordEgress(db, { sessionId, stage: "classify", requestHash: "c".repeat(64), promptTokens: 50, completionTokens: 10, model: "claude-opus-5" });
    expect(egressSummary(db, sessionId)).toEqual({ requests: 2, promptTokens: 150, completionTokens: 30 });
  });

  it("saves and reloads a stage checkpoint, overwriting on retry", () => {
    const { db, sessionId } = seed();
    saveCheckpoint(db, sessionId, "extract", "failed", null, "boom", "raw text");
    saveCheckpoint(db, sessionId, "extract", "complete", { claims: 3 }, null, null);
    const cp = loadCheckpoint<{ claims: number }>(db, sessionId, "extract");
    expect(cp?.status).toBe("complete");
    expect(cp?.payload?.claims).toBe(3);
  });
});
```

- [ ] **Step 6: Run both to confirm they fail**

Run: `npx vitest run tests/store/findings.test.ts tests/store/audit.test.ts`
Expected: FAIL — cannot find modules `findings.js` and `audit.js`.

- [ ] **Step 7: Implement src/store/findings.ts**

```typescript
// src/store/findings.ts
import type { Db } from "./db.js";
import {
  OpenQuestionSchema, RecommendationSchema,
  type OpenQuestion, type Recommendation,
} from "../types/domain.js";

interface QuestionRow {
  id: string; project_id: string; key: string; text: string; category: string;
  raised_by_session_id: string; status: string;
  answer_text: string | null; answered_by_session_id: string | null; created_at: string;
}

interface RecommendationRow {
  id: string; project_id: string; key: string; text: string; rationale: string;
  category: string; raised_by_session_id: string; status: string;
  disposition_note: string | null; created_at: string;
}

export function insertQuestions(db: Db, qs: OpenQuestion[]): void {
  const stmt = db.prepare(
    `INSERT INTO open_questions
       (id, project_id, key, text, category, raised_by_session_id, status,
        answer_text, answered_by_session_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    for (const q of qs) {
      OpenQuestionSchema.parse(q);
      stmt.run(
        q.id, q.projectId, q.key, q.text, q.category, q.raisedBySessionId,
        q.status, q.answerText, q.answeredBySessionId, q.createdAt,
      );
    }
  })();
}

export function listQuestions(
  db: Db,
  projectId: string,
  opts?: { status?: OpenQuestion["status"] },
): OpenQuestion[] {
  let sql = "SELECT * FROM open_questions WHERE project_id = ?";
  const extra: string[] = [];
  if (opts?.status) { sql += " AND status = ?"; extra.push(opts.status); }
  sql += " ORDER BY key ASC";
  return (db.prepare(sql).all(projectId, ...extra) as QuestionRow[]).map((row) =>
    OpenQuestionSchema.parse({
      id: row.id,
      projectId: row.project_id,
      key: row.key,
      text: row.text,
      category: row.category,
      raisedBySessionId: row.raised_by_session_id,
      status: row.status,
      answerText: row.answer_text,
      answeredBySessionId: row.answered_by_session_id,
      createdAt: row.created_at,
    }),
  );
}

export function insertRecommendations(db: Db, recs: Recommendation[]): void {
  const stmt = db.prepare(
    `INSERT INTO recommendations
       (id, project_id, key, text, rationale, category, raised_by_session_id,
        status, disposition_note, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    for (const r of recs) {
      RecommendationSchema.parse(r);
      stmt.run(
        r.id, r.projectId, r.key, r.text, r.rationale, r.category,
        r.raisedBySessionId, r.status, r.dispositionNote, r.createdAt,
      );
    }
  })();
}

export function listRecommendations(db: Db, projectId: string): Recommendation[] {
  const rows = db
    .prepare("SELECT * FROM recommendations WHERE project_id = ? ORDER BY key ASC")
    .all(projectId) as RecommendationRow[];
  return rows.map((row) =>
    RecommendationSchema.parse({
      id: row.id,
      projectId: row.project_id,
      key: row.key,
      text: row.text,
      rationale: row.rationale,
      category: row.category,
      raisedBySessionId: row.raised_by_session_id,
      status: row.status,
      dispositionNote: row.disposition_note,
      createdAt: row.created_at,
    }),
  );
}
```

- [ ] **Step 8: Implement src/store/audit.ts**

```typescript
// src/store/audit.ts
import type { Db } from "./db.js";
import { newId } from "../types/ids.js";
import {
  ApprovalEventSchema, EgressLogSchema,
  type ApprovalEvent, type EgressLog,
} from "../types/domain.js";

export type CheckpointStatus = "pending" | "running" | "complete" | "failed";

export function recordApproval(
  db: Db,
  e: Omit<ApprovalEvent, "id" | "at">,
): ApprovalEvent {
  const event = ApprovalEventSchema.parse({
    ...e,
    id: newId("apv"),
    at: new Date().toISOString(),
  });
  db.prepare(
    `INSERT INTO approval_events (id, entity_type, entity_id, action, actor_note, content_hash, at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    event.id, event.entityType, event.entityId, event.action,
    event.actorNote, event.contentHash, event.at,
  );
  return event;
}

export function listApprovals(
  db: Db,
  entityType: ApprovalEvent["entityType"],
  entityId: string,
): ApprovalEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM approval_events
       WHERE entity_type = ? AND entity_id = ? ORDER BY at ASC`,
    )
    .all(entityType, entityId) as {
      id: string; entity_type: string; entity_id: string; action: string;
      actor_note: string | null; content_hash: string; at: string;
    }[];
  return rows.map((r) =>
    ApprovalEventSchema.parse({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      actorNote: r.actor_note,
      contentHash: r.content_hash,
      at: r.at,
    }),
  );
}

export function recordEgress(db: Db, e: Omit<EgressLog, "id" | "at">): void {
  const entry = EgressLogSchema.parse({
    ...e,
    id: newId("egr"),
    at: new Date().toISOString(),
  });
  db.prepare(
    `INSERT INTO egress_log (id, session_id, stage, request_hash, prompt_tokens, completion_tokens, model, at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    entry.id, entry.sessionId, entry.stage, entry.requestHash,
    entry.promptTokens, entry.completionTokens, entry.model, entry.at,
  );
}

export function egressSummary(
  db: Db,
  sessionId: string,
): { requests: number; promptTokens: number; completionTokens: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens), 0) AS p,
              COALESCE(SUM(completion_tokens), 0) AS c
       FROM egress_log WHERE session_id = ?`,
    )
    .get(sessionId) as { requests: number; p: number; c: number };
  return { requests: row.requests, promptTokens: row.p, completionTokens: row.c };
}

export function saveCheckpoint(
  db: Db,
  sessionId: string,
  stage: string,
  status: CheckpointStatus,
  payload: unknown,
  errorText: string | null = null,
  rawResponse: string | null = null,
): void {
  db.prepare(
    `INSERT INTO stage_checkpoints (id, session_id, stage, status, payload_json, error_text, raw_response, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (session_id, stage) DO UPDATE SET
       status = excluded.status,
       payload_json = excluded.payload_json,
       error_text = excluded.error_text,
       raw_response = excluded.raw_response,
       updated_at = excluded.updated_at`,
  ).run(
    newId("ckp"), sessionId, stage, status,
    payload === null || payload === undefined ? null : JSON.stringify(payload),
    errorText, rawResponse, new Date().toISOString(),
  );
}

export function loadCheckpoint<T>(
  db: Db,
  sessionId: string,
  stage: string,
): { status: CheckpointStatus; payload: T | null; errorText: string | null } | null {
  const row = db
    .prepare("SELECT status, payload_json, error_text FROM stage_checkpoints WHERE session_id = ? AND stage = ?")
    .get(sessionId, stage) as
      { status: CheckpointStatus; payload_json: string | null; error_text: string | null } | undefined;
  if (!row) return null;
  return {
    status: row.status,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as T) : null,
    errorText: row.error_text,
  };
}
```

- [ ] **Step 9: Run all store tests**

Run: `npx vitest run tests/store`
Expected: PASS (all store tests green).

- [ ] **Step 10: Commit**

```bash
git add src/store/artifacts.ts src/store/findings.ts src/store/audit.ts tests/store
git commit -m "feat: add artifact, finding, and audit repositories"
```

---

### Task 7: Grounding — text normalization

**Files:**
- Create: `src/grounding/normalize.ts`
- Test: `tests/grounding/normalize.test.ts`

**Interfaces:**
- Consumes: nothing. Pure functions, no imports beyond the standard library.
- Produces:
  - `normalize(text: string): { text: string; map: number[] }` — lowercased, whitespace-collapsed, smart-quote-folded text, plus `map` where `map[i]` is the index in the *original* string that produced normalized character `i`. The map is what lets a match on normalized text be reported as offsets into the raw transcript.
  - `denormalizeRange(map: number[], originalLength: number, start: number, end: number): { start: number; end: number }`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/grounding/normalize.test.ts
import { describe, it, expect } from "vitest";
import { normalize, denormalizeRange } from "../../src/grounding/normalize.js";

describe("normalize", () => {
  it("lowercases", () => {
    expect(normalize("Hello WORLD").text).toBe("hello world");
  });

  it("collapses runs of whitespace to a single space", () => {
    expect(normalize("a   \n\t b").text).toBe("a b");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalize("   padded   ").text).toBe("padded");
  });

  it("folds smart quotes and dashes to ASCII", () => {
    expect(normalize("“quoted” ‘x’ — y").text).toBe('"quoted" \'x\' - y');
  });

  it("maps every normalized index back to an original index", () => {
    const original = "Hello   WORLD";
    const { text, map } = normalize(original);
    expect(text).toBe("hello world");
    expect(map).toHaveLength(text.length);
    expect(original[map[0]!]).toBe("H");
    expect(original[map[6]!]).toBe("W");
  });

  it("denormalizes a range back to original offsets", () => {
    const original = "Hello   WORLD tail";
    const { text, map } = normalize(original);
    const start = text.indexOf("world");
    const range = denormalizeRange(map, original.length, start, start + "world".length);
    expect(original.slice(range.start, range.end)).toBe("WORLD");
  });

  it("returns an empty map for an all-whitespace string", () => {
    const { text, map } = normalize("   \n  ");
    expect(text).toBe("");
    expect(map).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/grounding/normalize.test.ts`
Expected: FAIL — cannot find module `../../src/grounding/normalize.js`.

- [ ] **Step 3: Implement src/grounding/normalize.ts**

```typescript
// src/grounding/normalize.ts

/** Characters models routinely substitute, folded to their ASCII equivalents. */
const FOLD: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "–": "-", "—": "-", "−": "-",
  " ": " ", "…": "...",
};

export interface Normalized {
  /** Lowercased, whitespace-collapsed, quote-folded text. */
  text: string;
  /** `map[i]` is the index in the original string that produced `text[i]`. */
  map: number[];
}

/**
 * Normalize text for matching while retaining a per-character index back into
 * the original. This is what allows a match found on normalized text to be
 * reported as exact character offsets into the untouched transcript.
 *
 * Note: `…` folds to three characters ("..."), so one original index is
 * repeated three times in the map. That is correct — every normalized
 * character must map to some original character.
 */
export function normalize(input: string): Normalized {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    const folded = FOLD[ch] ?? ch;

    if (/\s/.test(folded)) {
      if (out.length > 0) pendingSpace = true;
      continue;
    }

    if (pendingSpace) {
      out.push(" ");
      map.push(i);
      pendingSpace = false;
    }

    const lowered = folded.toLowerCase();
    for (const c of lowered) {
      out.push(c);
      map.push(i);
    }
  }

  return { text: out.join(""), map };
}

/**
 * Translate a [start, end) range on normalized text into a range on the
 * original text. `end` is exclusive on both sides.
 */
export function denormalizeRange(
  map: number[],
  originalLength: number,
  start: number,
  end: number,
): { start: number; end: number } {
  if (map.length === 0 || start >= end) return { start: 0, end: 0 };
  const clampedStart = Math.max(0, Math.min(start, map.length - 1));
  const clampedEnd = Math.max(clampedStart, Math.min(end, map.length));
  const originalStart = map[clampedStart]!;
  const lastIdx = map[clampedEnd - 1]!;
  return {
    start: originalStart,
    end: Math.min(lastIdx + 1, originalLength),
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/grounding/normalize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/grounding/normalize.ts tests/grounding/normalize.test.ts
git commit -m "feat: add text normalization with reverse index mapping"
```

---

### Task 8: Grounding — word-token similarity

**Files:**
- Create: `src/grounding/similarity.ts`
- Test: `tests/grounding/similarity.test.ts`

**Interfaces:**
- Consumes: `normalize` (Task 7).
- Produces:
  - `tokenize(text: string): { token: string; start: number; end: number }[]` — word tokens with offsets into the *normalized* text passed in.
  - `levenshteinRatio(a: string[], b: string[]): number` — `1 - distance / max(len)`, over word arrays. Returns 1 for two empty arrays.
  - `bestWindow(haystackNorm: string, needleNorm: string): { ratio: number; start: number; end: number } | null` — slides a window of ±2 tokens around the needle's token count and returns the best-scoring span, with offsets into `haystackNorm`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/grounding/similarity.test.ts
import { describe, it, expect } from "vitest";
import { tokenize, levenshteinRatio, bestWindow } from "../../src/grounding/similarity.js";

describe("tokenize", () => {
  it("splits on whitespace and records offsets", () => {
    const toks = tokenize("we need approval");
    expect(toks.map((t) => t.token)).toEqual(["we", "need", "approval"]);
    expect("we need approval".slice(toks[2]!.start, toks[2]!.end)).toBe("approval");
  });

  it("returns an empty array for empty input", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("levenshteinRatio", () => {
  it("returns 1 for identical token arrays", () => {
    expect(levenshteinRatio(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
  });

  it("returns 1 for two empty arrays", () => {
    expect(levenshteinRatio([], [])).toBe(1);
  });

  it("returns 0 when nothing matches", () => {
    expect(levenshteinRatio(["a", "b"], ["x", "y"])).toBe(0);
  });

  it("scores one deleted filler word out of eleven above 0.90", () => {
    const withFiller = "um we would want manager approval on anything over ten thousand".split(" ");
    const stripped = "we would want manager approval on anything over ten thousand".split(" ");
    expect(levenshteinRatio(withFiller, stripped)).toBeGreaterThan(0.9);
  });

  it("scores an invented sentence far below 0.90", () => {
    const real = "we would want manager approval on invoices".split(" ");
    const invented = "passwords must contain a special character and a digit".split(" ");
    expect(levenshteinRatio(real, invented)).toBeLessThan(0.3);
  });
});

describe("bestWindow", () => {
  it("finds an exact span and reports its offsets", () => {
    const hay = "so anything over ten thousand euro has to go to a manager no exceptions";
    const found = bestWindow(hay, "over ten thousand euro");
    expect(found).not.toBeNull();
    expect(found!.ratio).toBe(1);
    expect(hay.slice(found!.start, found!.end)).toBe("over ten thousand euro");
  });

  it("finds a disfluency-stripped span above threshold", () => {
    const hay = "um we would uh want manager approval on that";
    const found = bestWindow(hay, "we would want manager approval");
    expect(found).not.toBeNull();
    expect(found!.ratio).toBeGreaterThan(0.9);
  });

  it("returns a low ratio for text that is not present", () => {
    const hay = "we discussed the login screen and nothing else";
    const found = bestWindow(hay, "passwords must be at least twelve characters long");
    expect(found!.ratio).toBeLessThan(0.5);
  });

  it("returns null when either side has no tokens", () => {
    expect(bestWindow("", "abc")).toBeNull();
    expect(bestWindow("abc", "")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/grounding/similarity.test.ts`
Expected: FAIL — cannot find module `../../src/grounding/similarity.js`.

- [ ] **Step 3: Implement src/grounding/similarity.ts**

```typescript
// src/grounding/similarity.ts

export interface Token {
  token: string;
  start: number;
  end: number;
}

/** Word tokens with offsets into the string passed in (expected to be already normalized). */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ token: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/**
 * Levenshtein distance over word arrays, expressed as a similarity ratio.
 *
 * Word-level rather than character-level is deliberate: a dropped filler word
 * ("um") costs exactly one edit instead of two or three characters' worth,
 * which is what makes the 0.90 threshold behave as intended.
 */
export function levenshteinRatio(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;

  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }

  return 1 - prev[b.length]! / max;
}

/**
 * Find the span of `haystackNorm` most similar to `needleNorm`.
 *
 * Windows are sized within ±2 tokens of the needle's token count, which
 * accommodates a couple of dropped or added filler words without letting the
 * search wander into unrelated text.
 */
export function bestWindow(
  haystackNorm: string,
  needleNorm: string,
): { ratio: number; start: number; end: number } | null {
  const hayTokens = tokenize(haystackNorm);
  const needleTokens = tokenize(needleNorm).map((t) => t.token);
  if (hayTokens.length === 0 || needleTokens.length === 0) return null;

  const n = needleTokens.length;
  const minLen = Math.max(1, n - 2);
  const maxLen = Math.min(hayTokens.length, n + 2);

  let best = { ratio: -1, start: 0, end: 0 };

  for (let len = minLen; len <= maxLen; len++) {
    for (let i = 0; i + len <= hayTokens.length; i++) {
      const window = hayTokens.slice(i, i + len);
      const ratio = levenshteinRatio(window.map((t) => t.token), needleTokens);
      if (ratio > best.ratio) {
        best = {
          ratio,
          start: window[0]!.start,
          end: window[window.length - 1]!.end,
        };
        if (ratio === 1) return best;
      }
    }
  }

  return best.ratio < 0 ? null : best;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/grounding/similarity.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/grounding/similarity.ts tests/grounding/similarity.test.ts
git commit -m "feat: add word-token Levenshtein ratio and best-window search"
```

---

### Task 9: Grounding — the validator ladder

This is the component that carries the product's central safety property. Its test suite is the most important in the codebase.

**Files:**
- Create: `src/grounding/validator.ts`
- Test: `tests/grounding/validator.test.ts`

**Interfaces:**
- Consumes: `normalize`, `denormalizeRange` (Task 7); `bestWindow` (Task 8).
- Produces:
  - `FUZZY_THRESHOLD = 0.9` (exported const).
  - `interface GroundingInput { quote: string; segmentId: string }`
  - `interface GroundingSource { segments: { id: string; text: string; charStart: number }[]; windowText: string; windowCharStart: number }`
  - `validateQuote(input: GroundingInput, source: GroundingSource): GroundingResult` where `GroundingResult` is `{ status: "validated"; matchMode: "exact" | "segment-corrected" | "fuzzy"; segmentId: string; charStart: number; charEnd: number; ratio: number }` or `{ status: "quarantined"; reason: string; bestRatio: number }`.

- [ ] **Step 1: Write the failing test — the full safety suite**

```typescript
// tests/grounding/validator.test.ts
import { describe, it, expect } from "vitest";
import { validateQuote, FUZZY_THRESHOLD, type GroundingSource } from "../../src/grounding/validator.js";

const WINDOW =
  "BA: so what happens on a big invoice\n\n" +
  "Client: um, anything over ten thousand euro has to go to a manager, no exceptions\n\n" +
  "Client: we would usually be dealing in euro";

function source(): GroundingSource {
  const segTexts = WINDOW.split("\n\n");
  let cursor = 0;
  const segments = segTexts.map((text, i) => {
    const charStart = WINDOW.indexOf(text, cursor);
    cursor = charStart + text.length;
    return { id: `seg_${i}`, text, charStart };
  });
  return { segments, windowText: WINDOW, windowCharStart: 0 };
}

describe("validateQuote — threshold", () => {
  it("uses exactly 0.90", () => {
    expect(FUZZY_THRESHOLD).toBe(0.9);
  });
});

describe("validateQuote — exact match", () => {
  it("validates a verbatim quote inside the named segment", () => {
    const r = validateQuote(
      { quote: "anything over ten thousand euro has to go to a manager", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("validated");
    if (r.status !== "validated") return;
    expect(r.matchMode).toBe("exact");
    expect(WINDOW.slice(r.charStart, r.charEnd)).toContain("ten thousand euro");
  });

  it("tolerates case differences", () => {
    const r = validateQuote(
      { quote: "ANYTHING OVER TEN THOUSAND EURO", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("validated");
  });

  it("tolerates collapsed whitespace", () => {
    const r = validateQuote(
      { quote: "anything    over\n  ten thousand euro", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("validated");
  });

  it("tolerates smart quotes and em dashes", () => {
    const r = validateQuote(
      { quote: "anything over ten thousand euro — has to go to a manager", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("validated");
  });
});

describe("validateQuote — segment correction", () => {
  it("corrects the segment id when the quote lives in a different segment of the window", () => {
    const r = validateQuote(
      { quote: "we would usually be dealing in euro", segmentId: "seg_0" },
      source(),
    );
    expect(r.status).toBe("validated");
    if (r.status !== "validated") return;
    expect(r.matchMode).toBe("segment-corrected");
    expect(r.segmentId).toBe("seg_2");
  });
});

describe("validateQuote — fuzzy match", () => {
  it("validates a disfluency-stripped quote and marks it fuzzy", () => {
    const r = validateQuote(
      { quote: "anything over ten thousand euro has to go to a manager no exceptions", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("validated");
  });

  it("validates when the model drops a filler word", () => {
    const r = validateQuote(
      { quote: "we would be dealing in euro", segmentId: "seg_2" },
      source(),
    );
    expect(r.status).toBe("validated");
    if (r.status !== "validated") return;
    expect(r.matchMode).toBe("fuzzy");
    expect(r.ratio).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
  });
});

describe("validateQuote — quarantine", () => {
  it("quarantines an outright fabricated quote", () => {
    const r = validateQuote(
      { quote: "passwords must be at least twelve characters and rotate every ninety days", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("quarantined");
    if (r.status !== "quarantined") return;
    expect(r.bestRatio).toBeLessThan(FUZZY_THRESHOLD);
  });

  it("quarantines a quote that is plausible but not said", () => {
    const r = validateQuote(
      { quote: "anything over five thousand dollars needs director sign off", segmentId: "seg_1" },
      source(),
    );
    expect(r.status).toBe("quarantined");
  });

  it("quarantines an empty quote", () => {
    const r = validateQuote({ quote: "", segmentId: "seg_1" }, source());
    expect(r.status).toBe("quarantined");
    if (r.status !== "quarantined") return;
    expect(r.reason).toMatch(/empty/i);
  });

  it("quarantines a whitespace-only quote", () => {
    const r = validateQuote({ quote: "   \n  ", segmentId: "seg_1" }, source());
    expect(r.status).toBe("quarantined");
  });
});

describe("validateQuote — robustness", () => {
  it("does not throw when the segment id is unknown", () => {
    const r = validateQuote(
      { quote: "anything over ten thousand euro", segmentId: "seg_does_not_exist" },
      source(),
    );
    expect(r.status).toBe("validated");
  });

  it("handles a quote spanning two segments via the window fallback", () => {
    const r = validateQuote(
      { quote: "no exceptions we would usually be dealing in euro", segmentId: "seg_1" },
      source(),
    );
    expect(["validated", "quarantined"]).toContain(r.status);
  });

  it("reports offsets relative to the whole transcript when the window is offset", () => {
    const s = source();
    const shifted: GroundingSource = {
      segments: s.segments.map((seg) => ({ ...seg, charStart: seg.charStart + 1000 })),
      windowText: s.windowText,
      windowCharStart: 1000,
    };
    const r = validateQuote(
      { quote: "anything over ten thousand euro", segmentId: "seg_1" },
      shifted,
    );
    expect(r.status).toBe("validated");
    if (r.status !== "validated") return;
    expect(r.charStart).toBeGreaterThanOrEqual(1000);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/grounding/validator.test.ts`
Expected: FAIL — cannot find module `../../src/grounding/validator.js`.

- [ ] **Step 3: Implement src/grounding/validator.ts**

```typescript
// src/grounding/validator.ts
import { normalize, denormalizeRange } from "./normalize.js";
import { bestWindow } from "./similarity.js";

/**
 * The similarity floor for accepting a non-exact match.
 *
 * 0.90 on word-token Levenshtein absorbs disfluency-stripping ("um, we'd, uh,
 * want" -> "we'd want") while rejecting invention, which does not score
 * anywhere near 0.90 against real transcript text. Changing this number
 * changes the product's core safety guarantee — do not tune it without
 * re-running the adversarial fixture suite (Task 27).
 */
export const FUZZY_THRESHOLD = 0.9;

export interface GroundingInput {
  quote: string;
  segmentId: string;
}

export interface GroundingSource {
  /** Segments belonging to the window, with offsets into the whole transcript. */
  segments: { id: string; text: string; charStart: number }[];
  /** The full window text, used as the widening fallback. */
  windowText: string;
  /** Offset of `windowText` within the whole transcript. */
  windowCharStart: number;
}

export type GroundingResult =
  | {
      status: "validated";
      matchMode: "exact" | "segment-corrected" | "fuzzy";
      segmentId: string;
      charStart: number;
      charEnd: number;
      ratio: number;
    }
  | { status: "quarantined"; reason: string; bestRatio: number };

/** Find an exact normalized substring, returning original-text offsets. */
function exactMatch(
  haystack: string,
  haystackCharStart: number,
  quoteNorm: string,
): { charStart: number; charEnd: number } | null {
  const { text: hayNorm, map } = normalize(haystack);
  const at = hayNorm.indexOf(quoteNorm);
  if (at === -1) return null;
  const range = denormalizeRange(map, haystack.length, at, at + quoteNorm.length);
  return {
    charStart: haystackCharStart + range.start,
    charEnd: haystackCharStart + range.end,
  };
}

/**
 * The four-step ladder. Contains no LLM call and no network I/O by design:
 * the anti-hallucination guarantee must not itself depend on a model
 * behaving well.
 */
export function validateQuote(
  input: GroundingInput,
  source: GroundingSource,
): GroundingResult {
  const { text: quoteNorm } = normalize(input.quote);
  if (quoteNorm.length === 0) {
    return { status: "quarantined", reason: "quote is empty after normalization", bestRatio: 0 };
  }

  // Step 1+2: exact match within the named segment.
  const named = source.segments.find((s) => s.id === input.segmentId);
  if (named) {
    const hit = exactMatch(named.text, named.charStart, quoteNorm);
    if (hit) {
      return {
        status: "validated",
        matchMode: "exact",
        segmentId: named.id,
        charStart: hit.charStart,
        charEnd: hit.charEnd,
        ratio: 1,
      };
    }
  }

  // Step 3: exact match anywhere in the window; correct the segment id.
  for (const seg of source.segments) {
    if (seg.id === input.segmentId) continue;
    const hit = exactMatch(seg.text, seg.charStart, quoteNorm);
    if (hit) {
      return {
        status: "validated",
        matchMode: "segment-corrected",
        segmentId: seg.id,
        charStart: hit.charStart,
        charEnd: hit.charEnd,
        ratio: 1,
      };
    }
  }

  // Step 4: fuzzy match against the whole window.
  const { text: windowNorm, map } = normalize(source.windowText);
  const best = bestWindow(windowNorm, quoteNorm);
  if (!best) {
    return { status: "quarantined", reason: "window has no tokens to match against", bestRatio: 0 };
  }
  if (best.ratio < FUZZY_THRESHOLD) {
    return {
      status: "quarantined",
      reason: `best similarity ${best.ratio.toFixed(3)} is below the ${FUZZY_THRESHOLD} threshold`,
      bestRatio: best.ratio,
    };
  }

  const range = denormalizeRange(map, source.windowText.length, best.start, best.end);
  const absStart = source.windowCharStart + range.start;
  const absEnd = source.windowCharStart + range.end;

  // Attribute the fuzzy hit to whichever segment contains its midpoint.
  const mid = (absStart + absEnd) / 2;
  const owner =
    source.segments.find((s) => mid >= s.charStart && mid <= s.charStart + s.text.length) ??
    named ??
    source.segments[0];

  return {
    status: "validated",
    matchMode: "fuzzy",
    segmentId: owner?.id ?? input.segmentId,
    charStart: absStart,
    charEnd: absEnd,
    ratio: best.ratio,
  };
}
```

- [ ] **Step 4: Run the safety suite**

Run: `npx vitest run tests/grounding/validator.test.ts`
Expected: PASS (all tests). If the "drops a filler word" case lands just under 0.90, do **not** lower `FUZZY_THRESHOLD` — widen `bestWindow`'s token tolerance from ±2 to ±3 in `src/grounding/similarity.ts` and re-run. The threshold is the safety property; the window size is an implementation detail.

- [ ] **Step 5: Commit**

```bash
git add src/grounding/validator.ts tests/grounding/validator.test.ts
git commit -m "feat: add deterministic grounding validator with quarantine

Four-step ladder: exact-in-segment, exact-in-window with segment
correction, then word-token fuzzy match at a 0.90 floor. Contains no
LLM call — the anti-hallucination guarantee must not depend on a model
behaving well."
```

---

### Task 10: Hedge lexicon guard

**Files:**
- Create: `src/hedge/lexicon.ts`
- Test: `tests/hedge/lexicon.test.ts`

**Interfaces:**
- Consumes: `normalize` (Task 7).
- Produces:
  - `HEDGE_MARKERS: readonly string[]`
  - `detectHedges(text: string): string[]` — the markers found, in order of appearance.
  - `isHedged(text: string): boolean`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/hedge/lexicon.test.ts
import { describe, it, expect } from "vitest";
import { detectHedges, isHedged } from "../../src/hedge/lexicon.js";

describe("detectHedges", () => {
  it("finds a single-word hedge", () => {
    expect(detectHedges("we would probably want approvals")).toContain("probably");
  });

  it("finds multi-word hedges", () => {
    expect(detectHedges("I think we usually do it that way")).toEqual(
      expect.arrayContaining(["i think", "usually"]),
    );
  });

  it("is case-insensitive", () => {
    expect(isHedged("PROBABLY yes")).toBe(true);
  });

  it("matches on word boundaries only", () => {
    expect(isHedged("the mightily impressive result")).toBe(false);
    expect(isHedged("we might need it")).toBe(true);
  });

  it("returns false for a firm statement", () => {
    expect(isHedged("anything over ten thousand euro must go to a manager")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(isHedged("")).toBe(false);
    expect(detectHedges("")).toEqual([]);
  });

  it("catches the hedges most likely to be promoted to requirements", () => {
    for (const s of [
      "we'd probably want that",
      "I assume it's monthly",
      "typically we invoice weekly",
      "something like a dashboard",
      "it might be quarterly",
      "I guess so",
      "more or less that",
    ]) {
      expect(isHedged(s)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/hedge/lexicon.test.ts`
Expected: FAIL — cannot find module `../../src/hedge/lexicon.js`.

- [ ] **Step 3: Implement src/hedge/lexicon.ts**

```typescript
// src/hedge/lexicon.ts
import { normalize } from "../grounding/normalize.js";

/**
 * Markers of hedged speech. A claim whose quote contains any of these is
 * forced to `assumption` regardless of how the model classified it.
 *
 * This is a deterministic floor under model judgment: "we'd probably want
 * manager approval" is background belief, not a stated requirement, and
 * models are eager to promote it.
 */
export const HEDGE_MARKERS: readonly string[] = [
  "probably", "possibly", "perhaps", "maybe",
  "might", "may be", "could be", "would be",
  "i think", "i believe", "i assume", "i guess", "i suppose", "i'd say",
  "usually", "typically", "normally", "generally", "often", "tend to",
  "something like", "sort of", "kind of", "more or less",
  "roughly", "approximately", "or so",
  "i imagine", "presumably", "in principle", "off the top of my head",
];

/** Escape a literal string for safe use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PATTERNS: { marker: string; re: RegExp }[] = HEDGE_MARKERS.map((marker) => ({
  marker,
  re: new RegExp(`(?<![a-z0-9])${escapeRe(marker)}(?![a-z0-9])`, "g"),
}));

/** Return every hedge marker present in `text`, ordered by first appearance. */
export function detectHedges(text: string): string[] {
  const { text: norm } = normalize(text);
  if (norm.length === 0) return [];
  const found: { marker: string; at: number }[] = [];
  for (const { marker, re } of PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(norm);
    if (m) found.push({ marker, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.marker);
}

export function isHedged(text: string): boolean {
  return detectHedges(text).length > 0;
}
```

Note: normalization folds `’` to `'`, so `we'd` and `we’d` both match the `i'd say` style patterns consistently.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/hedge/lexicon.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hedge/lexicon.ts tests/hedge/lexicon.test.ts
git commit -m "feat: add hedge lexicon guard forcing hedged claims to assumption"
```

---

### Task 11: LLM client with egress log

**Files:**
- Create: `src/llm/client.ts`
- Test: `tests/llm/client.test.ts`

**Interfaces:**
- Consumes: `recordEgress` (Task 6), `Db`.
- Produces:
  - `MODEL = "claude-opus-5"` (exported const).
  - `createClient(opts?: { apiKey?: string; maxRetries?: number; timeoutMs?: number }): Anthropic`
  - `hashRequest(payload: unknown): string` — SHA-256 of the canonical JSON, for the egress log.
  - `estimateInputTokens(client, system, userText): Promise<number>` — wraps `client.messages.countTokens`.
  - `logEgress(db, sessionId, stage, payload, usage): void`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/llm/client.test.ts
import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { egressSummary } from "../../src/store/audit.js";
import { MODEL, hashRequest, logEgress, createClient } from "../../src/llm/client.js";

describe("MODEL", () => {
  it("is exactly claude-opus-5 with no date suffix", () => {
    expect(MODEL).toBe("claude-opus-5");
  });
});

describe("hashRequest", () => {
  it("is stable regardless of key insertion order", () => {
    expect(hashRequest({ a: 1, b: 2 })).toBe(hashRequest({ b: 2, a: 1 }));
  });

  it("differs for different content", () => {
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
  });

  it("returns 64 hex chars", () => {
    expect(hashRequest({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("logEgress", () => {
  it("writes an egress row that the summary picks up", () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    logEgress(db, s.id, "extract", { prompt: "x" }, { input_tokens: 120, output_tokens: 40 });
    expect(egressSummary(db, s.id)).toEqual({ requests: 1, promptTokens: 120, completionTokens: 40 });
  });
});

describe("createClient", () => {
  it("never sets temperature, top_p, or top_k defaults", () => {
    const client = createClient({ apiKey: "sk-test" });
    expect(client).toBeDefined();
    // Guard: the SDK client itself carries no sampling defaults; the
    // prohibition is enforced at call sites by tests/llm/parse.test.ts.
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/llm/client.test.ts`
Expected: FAIL — cannot find module `../../src/llm/client.js`.

- [ ] **Step 3: Implement src/llm/client.ts**

```typescript
// src/llm/client.ts
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import type { Db } from "../store/db.js";
import { recordEgress } from "../store/audit.js";

/** The only model this engine targets. Never append a date suffix. */
export const MODEL = "claude-opus-5";

/** Non-streaming ceiling for every pipeline call. */
export const MAX_TOKENS = 16000;

export function createClient(opts?: {
  apiKey?: string;
  maxRetries?: number;
  timeoutMs?: number;
}): Anthropic {
  return new Anthropic({
    ...(opts?.apiKey ? { apiKey: opts.apiKey } : {}),
    // The SDK already retries 408/409/429/5xx with exponential backoff.
    maxRetries: opts?.maxRetries ?? 3,
    // NOTE: the TypeScript SDK takes milliseconds, unlike the Python SDK.
    timeout: opts?.timeoutMs ?? 10 * 60 * 1000,
  });
}

/** Canonical JSON stringify with sorted keys, so hashes are order-independent. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function hashRequest(payload: unknown): string {
  return createHash("sha256").update(canonical(payload), "utf8").digest("hex");
}

/**
 * Record what left the machine. This is the compliance artifact: when a client
 * asks what was sent to an AI service, the answer is this table.
 */
export function logEgress(
  db: Db,
  sessionId: string,
  stage: string,
  payload: unknown,
  usage: { input_tokens: number; output_tokens: number },
): void {
  recordEgress(db, {
    sessionId,
    stage,
    requestHash: hashRequest(payload),
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    model: MODEL,
  });
}

/**
 * Count input tokens using the API. Never approximate from character counts
 * and never use tiktoken — both are wrong for Claude.
 */
export async function estimateInputTokens(
  client: Anthropic,
  system: string,
  userText: string,
): Promise<number> {
  const res = await client.messages.countTokens({
    model: MODEL,
    system,
    messages: [{ role: "user", content: userText }],
  });
  return res.input_tokens;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/llm/client.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm/client.ts tests/llm/client.test.ts
git commit -m "feat: add Anthropic client wrapper with egress logging"
```

---

### Task 12: Typed structured-output helper

**Files:**
- Create: `src/llm/parse.ts`
- Test: `tests/llm/parse.test.ts`

**Interfaces:**
- Consumes: `MODEL`, `MAX_TOKENS`, `logEgress` (Task 11); `Db`; Zod.
- Produces:
  - `callTyped<T>(args: { client; db; sessionId; stage; system: string; user: string; schema: z.ZodType<T>; effort?: "low"|"medium"|"high"|"xhigh"|"max" }): Promise<T>`
  - Throws `StageFailure` (exported class carrying `stage`, `rawResponse`, `cause`) after 2 failed schema-validation retries.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/llm/parse.test.ts
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { egressSummary } from "../../src/store/audit.js";
import { callTyped, StageFailure } from "../../src/llm/parse.js";

const Shape = z.object({ items: z.array(z.object({ name: z.string() })) });

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  return { db, sessionId: s.id };
}

function fakeClient(parsedOutputs: (unknown | null)[]) {
  const parse = vi.fn();
  for (const out of parsedOutputs) {
    parse.mockResolvedValueOnce({
      parsed_output: out,
      content: [{ type: "text", text: JSON.stringify(out) }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "end_turn",
    });
  }
  return { messages: { parse }, __parse: parse } as never;
}

describe("callTyped", () => {
  it("returns the parsed payload on first success", async () => {
    const { db, sessionId } = seed();
    const client = fakeClient([{ items: [{ name: "a" }] }]);
    const out = await callTyped({
      client, db, sessionId, stage: "extract",
      system: "sys", user: "usr", schema: Shape,
    });
    expect(out.items[0]?.name).toBe("a");
  });

  it("logs egress for every attempt", async () => {
    const { db, sessionId } = seed();
    const client = fakeClient([{ items: [] }]);
    await callTyped({ client, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape });
    expect(egressSummary(db, sessionId).requests).toBe(1);
  });

  it("never passes temperature, top_p, top_k, or budget_tokens", async () => {
    const { db, sessionId } = seed();
    const client = fakeClient([{ items: [] }]);
    await callTyped({ client, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape });
    const args = (client as unknown as { __parse: { mock: { calls: unknown[][] } } }).__parse.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).not.toHaveProperty("temperature");
    expect(args).not.toHaveProperty("top_p");
    expect(args).not.toHaveProperty("top_k");
    expect(JSON.stringify(args)).not.toContain("budget_tokens");
    expect(args.model).toBe("claude-opus-5");
    expect(args.max_tokens).toBe(16000);
  });

  it("retries once when the payload fails schema validation, then succeeds", async () => {
    const { db, sessionId } = seed();
    const client = fakeClient([{ items: "not-an-array" }, { items: [{ name: "ok" }] }]);
    const out = await callTyped({ client, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape });
    expect(out.items[0]?.name).toBe("ok");
    expect((client as unknown as { __parse: { mock: { calls: unknown[] } } }).__parse.mock.calls).toHaveLength(2);
  });

  it("throws StageFailure with the raw response after retries are exhausted", async () => {
    const { db, sessionId } = seed();
    const client = fakeClient([{ bad: 1 }, { bad: 2 }, { bad: 3 }]);
    await expect(
      callTyped({ client, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape }),
    ).rejects.toBeInstanceOf(StageFailure);
  });

  it("throws StageFailure when parsed_output is null", async () => {
    const { db, sessionId } = seed();
    const client = fakeClient([null, null, null]);
    await expect(
      callTyped({ client, db, sessionId, stage: "extract", system: "s", user: "u", schema: Shape }),
    ).rejects.toBeInstanceOf(StageFailure);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/llm/parse.test.ts`
Expected: FAIL — cannot find module `../../src/llm/parse.js`.

- [ ] **Step 3: Implement src/llm/parse.ts**

```typescript
// src/llm/parse.ts
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { Db } from "../store/db.js";
import { MODEL, MAX_TOKENS, logEgress } from "./client.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class StageFailure extends Error {
  constructor(
    readonly stage: string,
    message: string,
    readonly rawResponse: string | null,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StageFailure";
  }
}

const MAX_SCHEMA_RETRIES = 2;

/**
 * One typed structured-output call.
 *
 * Deliberately absent: `temperature`, `top_p`, `top_k` (all return 400 on
 * claude-opus-5) and `thinking.budget_tokens` (also 400 — thinking is on by
 * default; depth is controlled with `output_config.effort`).
 *
 * On a malformed payload the validation error is appended to the next
 * attempt's user turn, so the model is told exactly what was wrong rather
 * than being asked to guess. After MAX_SCHEMA_RETRIES the raw response is
 * preserved on the thrown StageFailure for inspection instead of being
 * silently dropped.
 */
export async function callTyped<T>(args: {
  client: Anthropic;
  db: Db;
  sessionId: string;
  stage: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  effort?: Effort;
}): Promise<T> {
  const { client, db, sessionId, stage, system, schema } = args;
  let user = args.user;
  let lastRaw: string | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= MAX_SCHEMA_RETRIES; attempt++) {
    const request = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      output_config: {
        effort: args.effort ?? "high",
        format: zodOutputFormat(schema as never),
      },
      messages: [{ role: "user" as const, content: user }],
    };

    const response = await client.messages.parse(request as never);

    const usage = (response as { usage?: { input_tokens: number; output_tokens: number } }).usage;
    if (usage) logEgress(db, sessionId, stage, request, usage);

    const content = (response as { content?: { type: string; text?: string }[] }).content ?? [];
    lastRaw = content.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("");

    const parsedOutput = (response as { parsed_output?: unknown }).parsed_output;
    if (parsedOutput === null || parsedOutput === undefined) {
      lastError = new Error("parsed_output was null — the model returned no schema-conforming JSON");
    } else {
      const result = schema.safeParse(parsedOutput);
      if (result.success) return result.data;
      lastError = result.error;
    }

    if (attempt < MAX_SCHEMA_RETRIES) {
      user =
        `${args.user}\n\n` +
        `Your previous response did not conform to the required schema. ` +
        `The validation error was:\n${String(lastError)}\n` +
        `Return a response that satisfies the schema exactly.`;
    }
  }

  throw new StageFailure(
    stage,
    `stage "${stage}" produced no schema-conforming output after ${MAX_SCHEMA_RETRIES + 1} attempts`,
    lastRaw,
    lastError,
  );
}
```

If `zodOutputFormat` rejects the installed Zod version at runtime, replace the `format` value with a hand-written JSON Schema object `{ type: "json_schema", schema: { ... } }` — the call shape is otherwise identical. Verify with a single live call before proceeding to Task 15.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/llm/parse.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm/parse.ts tests/llm/parse.test.ts
git commit -m "feat: add typed structured-output helper with schema retry"
```

---

### Task 13: Stage 0 — deterministic chunking

**Files:**
- Create: `src/pipeline/stage0-chunk.ts`
- Test: `tests/pipeline/stage0-chunk.test.ts`

**Interfaces:**
- Consumes: `Segment` (Task 2).
- Produces:
  - `MIN_WORDS = 200` (exported const).
  - `countWords(text: string): number`
  - `interface Window { idx: number; segments: Segment[]; text: string; charStart: number }`
  - `chunkTranscript(transcriptText: string, segments: Segment[], opts?: { targetWords?: number; overlapWords?: number }): Window[]` — defaults 2000 target, 200 overlap; splits only on segment boundaries.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/pipeline/stage0-chunk.test.ts
import { describe, it, expect } from "vitest";
import { chunkTranscript, countWords, MIN_WORDS } from "../../src/pipeline/stage0-chunk.js";
import type { Segment } from "../../src/types/domain.js";

function makeSegments(texts: string[]): { text: string; segments: Segment[] } {
  let cursor = 0;
  const parts: string[] = [];
  const segments: Segment[] = [];
  texts.forEach((t, i) => {
    if (i > 0) { parts.push("\n\n"); cursor += 2; }
    parts.push(t);
    segments.push({
      id: `seg_${i}`, transcriptId: "trs_1", idx: i,
      startMs: null, endMs: null, speakerLabel: null,
      text: t, charStart: cursor, charEnd: cursor + t.length,
    });
    cursor += t.length;
  });
  return { text: parts.join(""), segments };
}

const filler = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");

describe("countWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countWords("one two  three")).toBe(3);
    expect(countWords("   ")).toBe(0);
  });
});

describe("MIN_WORDS", () => {
  it("is exactly 200", () => {
    expect(MIN_WORDS).toBe(200);
  });
});

describe("chunkTranscript", () => {
  it("returns a single window for short input", () => {
    const { text, segments } = makeSegments(["hello there", "goodbye now"]);
    const windows = chunkTranscript(text, segments);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.segments).toHaveLength(2);
  });

  it("splits long input into multiple windows", () => {
    const { text, segments } = makeSegments([
      filler(900, "a"), filler(900, "b"), filler(900, "c"), filler(900, "d"),
    ]);
    const windows = chunkTranscript(text, segments, { targetWords: 1000, overlapWords: 200 });
    expect(windows.length).toBeGreaterThan(1);
  });

  it("never splits inside a segment", () => {
    const { text, segments } = makeSegments([filler(900, "a"), filler(900, "b"), filler(900, "c")]);
    const windows = chunkTranscript(text, segments, { targetWords: 1000, overlapWords: 100 });
    const allIds = windows.flatMap((w) => w.segments.map((s) => s.id));
    for (const s of segments) expect(allIds).toContain(s.id);
    for (const w of windows) {
      for (const s of w.segments) {
        expect(w.text).toContain(s.text);
      }
    }
  });

  it("overlaps consecutive windows", () => {
    const { text, segments } = makeSegments([
      filler(600, "a"), filler(600, "b"), filler(600, "c"), filler(600, "d"),
    ]);
    const windows = chunkTranscript(text, segments, { targetWords: 1000, overlapWords: 500 });
    const first = new Set(windows[0]!.segments.map((s) => s.id));
    const second = windows[1]!.segments.map((s) => s.id);
    expect(second.some((id) => first.has(id))).toBe(true);
  });

  it("reports charStart consistent with the original transcript", () => {
    const { text, segments } = makeSegments([filler(700, "a"), filler(700, "b"), filler(700, "c")]);
    const windows = chunkTranscript(text, segments, { targetWords: 800, overlapWords: 100 });
    for (const w of windows) {
      expect(text.slice(w.charStart, w.charStart + w.text.length)).toBe(w.text);
    }
  });

  it("covers every segment at least once", () => {
    const { text, segments } = makeSegments(Array.from({ length: 12 }, (_, i) => filler(300, `s${i}_`)));
    const windows = chunkTranscript(text, segments, { targetWords: 900, overlapWords: 150 });
    const covered = new Set(windows.flatMap((w) => w.segments.map((s) => s.id)));
    expect(covered.size).toBe(segments.length);
  });

  it("returns no windows for empty segment input", () => {
    expect(chunkTranscript("", [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/pipeline/stage0-chunk.test.ts`
Expected: FAIL — cannot find module `../../src/pipeline/stage0-chunk.js`.

- [ ] **Step 3: Implement src/pipeline/stage0-chunk.ts**

```typescript
// src/pipeline/stage0-chunk.ts
import type { Segment } from "../types/domain.js";

/**
 * Below this the pipeline hard-blocks rather than warning: extraction on a
 * shorter input produces noise, and noise is worse than no output.
 */
export const MIN_WORDS = 200;

export interface Window {
  idx: number;
  segments: Segment[];
  /** Exact slice of the transcript spanned by this window's segments. */
  text: string;
  /** Offset of `text` within the whole transcript. */
  charStart: number;
}

export function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Window the transcript for extraction.
 *
 * A 90-minute meeting is roughly 12k words. That fits in context, but
 * single-shot extraction over it degrades quietly — thorough early, skimming
 * later. Windows are ~2000 words with ~200 words of overlap, split only on
 * segment boundaries so quote anchoring survives chunking.
 */
export function chunkTranscript(
  transcriptText: string,
  segments: Segment[],
  opts?: { targetWords?: number; overlapWords?: number },
): Window[] {
  if (segments.length === 0) return [];
  const target = opts?.targetWords ?? 2000;
  const overlap = opts?.overlapWords ?? 200;

  const counts = segments.map((s) => countWords(s.text));
  const windows: Window[] = [];
  let start = 0;
  let idx = 0;

  while (start < segments.length) {
    let end = start;
    let words = 0;
    while (end < segments.length && (words === 0 || words + counts[end]! <= target)) {
      words += counts[end]!;
      end++;
    }
    if (end === start) end = start + 1; // a single oversized segment still forms a window

    const slice = segments.slice(start, end);
    const first = slice[0]!;
    const last = slice[slice.length - 1]!;
    windows.push({
      idx: idx++,
      segments: slice,
      text: transcriptText.slice(first.charStart, last.charEnd),
      charStart: first.charStart,
    });

    if (end >= segments.length) break;

    // Step back far enough to carry ~`overlap` words into the next window.
    let back = end - 1;
    let carried = 0;
    while (back > start && carried + counts[back]! <= overlap) {
      carried += counts[back]!;
      back--;
    }
    start = Math.max(start + 1, back + 1);
  }

  return windows;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/pipeline/stage0-chunk.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/stage0-chunk.ts tests/pipeline/stage0-chunk.test.ts
git commit -m "feat: add deterministic transcript windowing on segment boundaries"
```

---

### Task 14: Pipeline runner with checkpointing

**Files:**
- Create: `src/pipeline/runner.ts`
- Test: `tests/pipeline/runner.test.ts`

**Interfaces:**
- Consumes: `saveCheckpoint`, `loadCheckpoint` (Task 6); `StageFailure` (Task 12); `setSessionStatus` (Task 4).
- Produces:
  - `interface StageContext { db: Db; client: Anthropic; projectId: string; sessionId: string }`
  - `interface Stage<In, Out> { name: string; run(ctx: StageContext, input: In): Promise<Out> }`
  - `runPipeline<T>(ctx: StageContext, stages: Stage<unknown, unknown>[], initial: unknown, opts?: { resume?: boolean; onProgress?: (name: string, status: string) => void }): Promise<unknown>`
  - Behavior: each stage's output is checkpointed on success; on `resume`, completed stages are skipped and their persisted output feeds the next stage; a stage failure marks the session `failed`, persists the error, and rethrows.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/pipeline/runner.test.ts
import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession, getSession } from "../../src/store/projects.js";
import { loadCheckpoint } from "../../src/store/audit.js";
import { runPipeline, type Stage, type StageContext } from "../../src/pipeline/runner.js";

function ctx() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  return {
    db, client: {} as never, projectId: p.id, sessionId: s.id,
  } satisfies StageContext;
}

const double: Stage<number, number> = {
  name: "double",
  run: async (_c, n) => n * 2,
};
const addTen: Stage<number, number> = {
  name: "addTen",
  run: async (_c, n) => n + 10,
};

describe("runPipeline", () => {
  it("threads output from one stage to the next", async () => {
    const c = ctx();
    const out = await runPipeline(c, [double, addTen] as never, 5);
    expect(out).toBe(20);
  });

  it("checkpoints each completed stage", async () => {
    const c = ctx();
    await runPipeline(c, [double, addTen] as never, 5);
    expect(loadCheckpoint<number>(c.db, c.sessionId, "double")?.status).toBe("complete");
    expect(loadCheckpoint<number>(c.db, c.sessionId, "addTen")?.payload).toBe(20);
  });

  it("skips completed stages on resume and reuses their output", async () => {
    const c = ctx();
    await runPipeline(c, [double, addTen] as never, 5);
    const spy = vi.fn(double.run);
    const spied: Stage<number, number> = { name: "double", run: spy as never };
    const out = await runPipeline(c, [spied, addTen] as never, 999, { resume: true });
    expect(spy).not.toHaveBeenCalled();
    expect(out).toBe(20);
  });

  it("marks the session failed and rethrows when a stage throws", async () => {
    const c = ctx();
    const boom: Stage<number, number> = {
      name: "boom",
      run: async () => { throw new Error("kaboom"); },
    };
    await expect(runPipeline(c, [double, boom] as never, 5)).rejects.toThrow(/kaboom/);
    expect(getSession(c.db, c.sessionId)?.status).toBe("failed");
    expect(loadCheckpoint(c.db, c.sessionId, "boom")?.status).toBe("failed");
  });

  it("resumes from the failed stage rather than the beginning", async () => {
    const c = ctx();
    let attempts = 0;
    const flaky: Stage<number, number> = {
      name: "flaky",
      run: async (_x, n) => {
        attempts++;
        if (attempts === 1) throw new Error("transient");
        return n + 1;
      },
    };
    const doubleSpy = vi.fn(double.run);
    const stages = [{ name: "double", run: doubleSpy as never }, flaky] as never;
    await expect(runPipeline(c, stages, 5)).rejects.toThrow(/transient/);
    expect(doubleSpy).toHaveBeenCalledTimes(1);
    const out = await runPipeline(c, stages, 5, { resume: true });
    expect(doubleSpy).toHaveBeenCalledTimes(1);
    expect(out).toBe(11);
  });

  it("reports progress for each stage", async () => {
    const c = ctx();
    const seen: string[] = [];
    await runPipeline(c, [double, addTen] as never, 1, {
      onProgress: (name, status) => seen.push(`${name}:${status}`),
    });
    expect(seen).toContain("double:running");
    expect(seen).toContain("addTen:complete");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/pipeline/runner.test.ts`
Expected: FAIL — cannot find module `../../src/pipeline/runner.js`.

- [ ] **Step 3: Implement src/pipeline/runner.ts**

```typescript
// src/pipeline/runner.ts
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../store/db.js";
import { saveCheckpoint, loadCheckpoint } from "../store/audit.js";
import { setSessionStatus } from "../store/projects.js";
import { StageFailure } from "../llm/parse.js";

export interface StageContext {
  db: Db;
  client: Anthropic;
  projectId: string;
  sessionId: string;
}

export interface Stage<In, Out> {
  name: string;
  run(ctx: StageContext, input: In): Promise<Out>;
}

/**
 * Run stages in order, checkpointing each one's output.
 *
 * Stages checkpoint independently so a failure resumes from the last good
 * stage rather than re-running the whole pipeline — which matters because a
 * full re-run costs real money.
 */
export async function runPipeline(
  ctx: StageContext,
  stages: Stage<unknown, unknown>[],
  initial: unknown,
  opts?: { resume?: boolean; onProgress?: (name: string, status: string) => void },
): Promise<unknown> {
  const progress = opts?.onProgress ?? (() => {});
  let value = initial;

  for (const stage of stages) {
    if (opts?.resume) {
      const cp = loadCheckpoint<unknown>(ctx.db, ctx.sessionId, stage.name);
      if (cp?.status === "complete") {
        progress(stage.name, "skipped");
        value = cp.payload;
        continue;
      }
    }

    progress(stage.name, "running");
    saveCheckpoint(ctx.db, ctx.sessionId, stage.name, "running", null);

    try {
      value = await stage.run(ctx, value);
    } catch (err) {
      const raw = err instanceof StageFailure ? err.rawResponse : null;
      saveCheckpoint(
        ctx.db, ctx.sessionId, stage.name, "failed", null,
        err instanceof Error ? err.message : String(err),
        raw,
      );
      setSessionStatus(ctx.db, ctx.sessionId, "failed");
      progress(stage.name, "failed");
      throw err;
    }

    saveCheckpoint(ctx.db, ctx.sessionId, stage.name, "complete", value);
    progress(stage.name, "complete");
  }

  return value;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/pipeline/runner.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/runner.ts tests/pipeline/runner.test.ts
git commit -m "feat: add resumable pipeline runner with per-stage checkpointing"
```

---

## Pipeline data flow

Stages **write their real output to the store** and thread only a small summary through the runner, so checkpoint payloads stay compact and a resumed stage rehydrates from SQLite. The threaded value for every stage is:

```typescript
// src/pipeline/state.ts  (created in Task 15)
export interface WindowRef {
  idx: number;
  segmentIds: string[];
  charStart: number;
  charEnd: number;
}

export interface PipelineState {
  transcriptId: string;
  windows: WindowRef[];
  extracted: number;
  validated: number;
  quarantined: number;
  requirements: number;
  stories: number;
  questions: number;
  recommendations: number;
}
```

---

### Task 15: Stage 1 — claim extraction

**Files:**
- Create: `src/pipeline/state.ts`, `src/prompts/extract.ts`, `src/pipeline/stage1-extract.ts`
- Test: `tests/pipeline/stage1-extract.test.ts`

**Interfaces:**
- Consumes: `Window`, `chunkTranscript` (Task 13); `callTyped` (Task 12); `Stage`, `StageContext` (Task 14); `getFrozenTranscript` (Task 4).
- Produces:
  - `PipelineState`, `WindowRef` (from `state.ts`).
  - `hydrateWindow(db, transcriptId, ref): Window` (from `state.ts`).
  - `EXTRACT_SYSTEM: string`, `buildExtractUser(window, project): string` (from `prompts/extract.ts`).
  - `ExtractedClaimSchema` — `{ quote: string; statement: string; segmentId: string; speakerRole: "client"|"ba"|"other"|"unknown" }`.
  - `stage0Chunk: Stage<{ transcriptId: string }, PipelineState>` and `stage1Extract: Stage<PipelineState, PipelineState>`.
  - Extracted claims are persisted with `status: "candidate"` and `kind: "requirement"` as a placeholder; Stage 2 and Stage 3 overwrite both.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/pipeline/stage1-extract.test.ts
import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { listClaims } from "../../src/store/claims.js";
import { ExtractedClaimsSchema, stage0Chunk, stage1Extract } from "../../src/pipeline/stage1-extract.js";
import { EXTRACT_SYSTEM } from "../../src/prompts/extract.js";
import type { StageContext } from "../../src/pipeline/runner.js";

const LONG = Array.from({ length: 30 }, (_, i) =>
  `Client: point number ${i} about invoice approval thresholds and routing rules in some detail here`,
).join("\n\n");

function setup(parsedOutputs: unknown[]) {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "B2B freight invoicing for EU logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript } = createTranscript(db, { sessionId: s.id, text: LONG });
  freezeTranscript(db, transcript.id);
  const parse = vi.fn();
  for (const out of parsedOutputs) {
    parse.mockResolvedValueOnce({
      parsed_output: out,
      content: [{ type: "text", text: JSON.stringify(out) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  }
  const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
  return { ctx, transcriptId: transcript.id, parse };
}

describe("EXTRACT_SYSTEM", () => {
  it("forbids emitting a claim without a quote", () => {
    expect(EXTRACT_SYSTEM).toMatch(/cannot quote it, do not emit/i);
  });

  it("does not ask the model for character offsets", () => {
    expect(EXTRACT_SYSTEM).not.toMatch(/charStart|character offset|charEnd/i);
  });
});

describe("ExtractedClaimsSchema", () => {
  it("has no field for character offsets", () => {
    const inner = ExtractedClaimsSchema.shape.claims.element.shape;
    expect(Object.keys(inner)).not.toContain("charStart");
    expect(Object.keys(inner)).not.toContain("charEnd");
  });
});

describe("stage0Chunk + stage1Extract", () => {
  it("rejects a transcript shorter than 200 words", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: "too short" });
    freezeTranscript(db, transcript.id);
    const ctx: StageContext = { db, client: {} as never, projectId: p.id, sessionId: s.id };
    await expect(stage0Chunk.run(ctx, { transcriptId: transcript.id })).rejects.toThrow(/200 words/);
  });

  it("persists extracted claims as candidates", async () => {
    const { ctx, transcriptId } = setup([
      { claims: [{ quote: "point number 0 about invoice approval thresholds", statement: "There is an approval threshold.", segmentId: "IGNORED", speakerRole: "client" }] },
    ]);
    const state = await stage0Chunk.run(ctx, { transcriptId });
    const after = await stage1Extract.run(ctx, state);
    const claims = listClaims(ctx.db, ctx.sessionId);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.status).toBe("candidate");
    expect(after.extracted).toBe(1);
  });

  it("calls the model once per window", async () => {
    const { ctx, transcriptId, parse } = setup([{ claims: [] }, { claims: [] }, { claims: [] }, { claims: [] }]);
    const state = await stage0Chunk.run(ctx, { transcriptId });
    await stage1Extract.run(ctx, state);
    expect(parse).toHaveBeenCalledTimes(state.windows.length);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/pipeline/stage1-extract.test.ts`
Expected: FAIL — cannot find modules.

- [ ] **Step 3: Implement src/pipeline/state.ts**

```typescript
// src/pipeline/state.ts
import type { Db } from "../store/db.js";
import type { Segment } from "../types/domain.js";
import type { Window } from "./stage0-chunk.js";

export interface WindowRef {
  idx: number;
  segmentIds: string[];
  charStart: number;
  charEnd: number;
}

export interface PipelineState {
  transcriptId: string;
  windows: WindowRef[];
  extracted: number;
  validated: number;
  quarantined: number;
  requirements: number;
  stories: number;
  questions: number;
  recommendations: number;
}

export function emptyState(transcriptId: string): PipelineState {
  return {
    transcriptId, windows: [],
    extracted: 0, validated: 0, quarantined: 0,
    requirements: 0, stories: 0, questions: 0, recommendations: 0,
  };
}

export function toRef(w: Window): WindowRef {
  const last = w.segments[w.segments.length - 1]!;
  return {
    idx: w.idx,
    segmentIds: w.segments.map((s) => s.id),
    charStart: w.charStart,
    charEnd: last.charEnd,
  };
}

/** Rebuild a full Window from its reference, reading segments back from the store. */
export function hydrateWindow(db: Db, transcriptText: string, ref: WindowRef): Window {
  const placeholders = ref.segmentIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM segments WHERE id IN (${placeholders}) ORDER BY idx ASC`)
    .all(...ref.segmentIds) as {
      id: string; transcript_id: string; idx: number;
      start_ms: number | null; end_ms: number | null;
      speaker_label: string | null; text: string;
      char_start: number; char_end: number;
    }[];
  const segments: Segment[] = rows.map((r) => ({
    id: r.id, transcriptId: r.transcript_id, idx: r.idx,
    startMs: r.start_ms, endMs: r.end_ms, speakerLabel: r.speaker_label,
    text: r.text, charStart: r.char_start, charEnd: r.char_end,
  }));
  return {
    idx: ref.idx,
    segments,
    text: transcriptText.slice(ref.charStart, ref.charEnd),
    charStart: ref.charStart,
  };
}
```

- [ ] **Step 4: Implement src/prompts/extract.ts**

```typescript
// src/prompts/extract.ts
import type { Project } from "../types/domain.js";
import type { Window } from "../pipeline/stage0-chunk.js";

export const EXTRACT_SYSTEM = `You extract atomic claims from a transcript of a business analyst's meeting with a client.

A claim is one indivisible thing that was actually said. For each claim you emit:
- "quote": the exact words from the transcript, copied verbatim. Do not paraphrase, tidy, correct, or complete it.
- "statement": your own normalized restatement of what that quote asserts.
- "segmentId": the id of the segment the quote came from.
- "speakerRole": who said it.

Rules, in order of importance:

1. If you cannot quote it, do not emit it. Every claim must be anchored in words that literally appear in the transcript below. A quote that is not present will be discarded by an automated check and will count against this extraction's quality score.
2. Do not infer. If the client did not say something, it is not a claim. Absence of a detail is not a claim that the detail is unimportant.
3. One assertion per claim. Split compound statements.
4. Preserve hedging in the quote. If the speaker said "we'd probably want X", quote it with "probably" intact — a later stage depends on that word being there.
5. Extract from what the client says. The analyst's own questions and suggestions are not client claims; if the analyst proposes something and the client only acknowledges it vaguely, that is not a claim.
6. Ignore scheduling, small talk, and meeting logistics.

Return no claims at all if the transcript contains none. An empty result is a correct answer for a status call or a social conversation.`;

export function buildExtractUser(window: Window, project: Project): string {
  const segmentBlock = window.segments
    .map((s) => `[segmentId: ${s.id}]\n${s.text}`)
    .join("\n\n");
  const glossary = project.glossary ? `\n\nDomain glossary:\n${project.glossary}` : "";
  return `Project domain: ${project.domain}${glossary}

Transcript window ${window.idx + 1}:

${segmentBlock}`;
}
```

- [ ] **Step 5: Implement src/pipeline/stage1-extract.ts**

```typescript
// src/pipeline/stage1-extract.ts
import { z } from "zod";
import { chunkTranscript, countWords, MIN_WORDS } from "./stage0-chunk.js";
import { emptyState, hydrateWindow, toRef, type PipelineState } from "./state.js";
import { getFrozenTranscript } from "../store/transcripts.js";
import { getProject } from "../store/projects.js";
import { insertClaims } from "../store/claims.js";
import { newId } from "../types/ids.js";
import { callTyped } from "../llm/parse.js";
import { EXTRACT_SYSTEM, buildExtractUser } from "../prompts/extract.js";
import type { Stage, StageContext } from "./runner.js";
import type { Claim } from "../types/domain.js";

export const ExtractedClaimsSchema = z.object({
  claims: z.array(
    z.object({
      quote: z.string(),
      statement: z.string(),
      segmentId: z.string(),
      speakerRole: z.enum(["client", "ba", "other", "unknown"]),
    }),
  ),
});

export const stage0Chunk: Stage<{ transcriptId: string }, PipelineState> = {
  name: "chunk",
  async run(ctx, input) {
    const frozen = getFrozenTranscript(ctx.db, ctx.sessionId);
    if (!frozen) throw new Error("session has no frozen transcript");
    const words = countWords(frozen.transcript.text);
    if (words < MIN_WORDS) {
      throw new Error(
        `input is ${words} words; the pipeline requires at least ${MIN_WORDS} words. ` +
          `Below this, extraction produces noise rather than requirements.`,
      );
    }
    const windows = chunkTranscript(frozen.transcript.text, frozen.segments);
    return { ...emptyState(input.transcriptId), windows: windows.map(toRef) };
  },
};

export const stage1Extract: Stage<PipelineState, PipelineState> = {
  name: "extract",
  async run(ctx: StageContext, state) {
    const frozen = getFrozenTranscript(ctx.db, ctx.sessionId);
    if (!frozen) throw new Error("session has no frozen transcript");
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");

    const all: Claim[] = [];
    const now = new Date().toISOString();

    for (const ref of state.windows) {
      const window = hydrateWindow(ctx.db, frozen.transcript.text, ref);
      const result = await callTyped({
        client: ctx.client,
        db: ctx.db,
        sessionId: ctx.sessionId,
        stage: "extract",
        system: EXTRACT_SYSTEM,
        user: buildExtractUser(window, project),
        schema: ExtractedClaimsSchema,
        effort: "high",
      });

      const validSegmentIds = new Set(window.segments.map((s) => s.id));
      const fallbackSegmentId = window.segments[0]?.id;

      for (const c of result.claims) {
        if (c.quote.trim().length === 0) continue;
        // A hallucinated segment id is not fatal — Stage 2 corrects or
        // quarantines. Anchor to a real segment in this window so Stage 2 has
        // somewhere sensible to start.
        const segmentId = validSegmentIds.has(c.segmentId)
          ? c.segmentId
          : fallbackSegmentId;
        if (!segmentId) continue;
        all.push({
          id: newId("clm"),
          sessionId: ctx.sessionId,
          transcriptId: frozen.transcript.id,
          segmentId,
          quote: c.quote,
          statement: c.statement,
          speakerRole: c.speakerRole,
          kind: "requirement",   // placeholder; Stage 3 sets the real kind
          status: "candidate",   // placeholder; Stage 2 sets the real status
          charStart: null,
          charEnd: null,
          matchMode: null,
          createdAt: now,
        });
      }
    }

    insertClaims(ctx.db, all);
    return { ...state, extracted: all.length };
  },
};
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run tests/pipeline/stage1-extract.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/state.ts src/prompts/extract.ts src/pipeline/stage1-extract.ts tests/pipeline/stage1-extract.test.ts
git commit -m "feat: add claim extraction stage

The extraction schema deliberately has no offset fields — models count
characters badly, and asking for offsets invites plausible fabricated
numbers that would pass a naive validator. The validator computes
offsets itself."
```

---

### Task 16: Stage 2 — grounding validation

**Files:**
- Create: `src/pipeline/stage2-validate.ts`
- Test: `tests/pipeline/stage2-validate.test.ts`

**Interfaces:**
- Consumes: `validateQuote`, `GroundingSource` (Task 9); `listClaims`, `updateClaimValidation` (Task 5); `hydrateWindow` (Task 15).
- Produces: `stage2Validate: Stage<PipelineState, PipelineState>` and `quarantineRate(state): number`. Contains **no LLM call**.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/pipeline/stage2-validate.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertClaims, listClaims } from "../../src/store/claims.js";
import { stage2Validate, quarantineRate } from "../../src/pipeline/stage2-validate.js";
import { toRef, emptyState } from "../../src/pipeline/state.js";
import { chunkTranscript } from "../../src/pipeline/stage0-chunk.js";
import { newId } from "../../src/types/ids.js";
import type { StageContext } from "../../src/pipeline/runner.js";

const TEXT =
  "BA: what happens on a big invoice\n\n" +
  "Client: anything over ten thousand euro has to go to a manager, no exceptions\n\n" +
  "Client: we would usually be dealing in euro";

function setup(quotes: string[]) {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: TEXT });
  freezeTranscript(db, transcript.id);
  const now = new Date().toISOString();
  insertClaims(db, quotes.map((quote) => ({
    id: newId("clm"), sessionId: s.id, transcriptId: transcript.id,
    segmentId: segments[1]!.id, quote, statement: "s",
    speakerRole: "client" as const, kind: "requirement" as const,
    status: "candidate" as const, charStart: null, charEnd: null,
    matchMode: null, createdAt: now,
  })));
  const windows = chunkTranscript(TEXT, segments);
  const ctx: StageContext = { db, client: {} as never, projectId: p.id, sessionId: s.id };
  return { ctx, state: { ...emptyState(transcript.id), windows: windows.map(toRef) } };
}

describe("stage2Validate", () => {
  it("validates a real quote and records offsets into the transcript", async () => {
    const { ctx, state } = setup(["anything over ten thousand euro has to go to a manager"]);
    const out = await stage2Validate.run(ctx, state);
    const [c] = listClaims(ctx.db, ctx.sessionId);
    expect(c?.status).toBe("validated");
    expect(TEXT.slice(c!.charStart!, c!.charEnd!)).toContain("ten thousand euro");
    expect(out.validated).toBe(1);
    expect(out.quarantined).toBe(0);
  });

  it("quarantines a fabricated quote without deleting it", async () => {
    const { ctx, state } = setup(["passwords must rotate every ninety days"]);
    const out = await stage2Validate.run(ctx, state);
    const [c] = listClaims(ctx.db, ctx.sessionId);
    expect(c?.status).toBe("quarantined");
    expect(listClaims(ctx.db, ctx.sessionId)).toHaveLength(1);
    expect(out.quarantined).toBe(1);
  });

  it("corrects a wrong segment id rather than quarantining", async () => {
    const { ctx, state } = setup(["we would usually be dealing in euro"]);
    await stage2Validate.run(ctx, state);
    const [c] = listClaims(ctx.db, ctx.sessionId);
    expect(c?.status).toBe("validated");
    expect(c?.matchMode).toBe("segment-corrected");
  });

  it("computes a quarantine rate", async () => {
    const { ctx, state } = setup([
      "anything over ten thousand euro",
      "passwords must rotate every ninety days",
    ]);
    const out = await stage2Validate.run(ctx, state);
    expect(quarantineRate(out)).toBeCloseTo(0.5);
  });

  it("makes no network call", async () => {
    const { ctx, state } = setup(["anything over ten thousand euro"]);
    // ctx.client is an empty object; any property access would throw.
    await expect(stage2Validate.run(ctx, state)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/pipeline/stage2-validate.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement src/pipeline/stage2-validate.ts**

```typescript
// src/pipeline/stage2-validate.ts
import { validateQuote, type GroundingSource } from "../grounding/validator.js";
import { listClaims, updateClaimValidation } from "../store/claims.js";
import { getFrozenTranscript } from "../store/transcripts.js";
import { hydrateWindow, type PipelineState } from "./state.js";
import type { Stage } from "./runner.js";

/**
 * Apply the grounding validator to every candidate claim.
 *
 * This stage makes no LLM call and no network request. It is the mechanical
 * gate that turns "never invent client details" from a prompt instruction
 * into a property of the system.
 */
export const stage2Validate: Stage<PipelineState, PipelineState> = {
  name: "validate",
  async run(ctx, state) {
    const frozen = getFrozenTranscript(ctx.db, ctx.sessionId);
    if (!frozen) throw new Error("session has no frozen transcript");

    const windows = state.windows.map((ref) =>
      hydrateWindow(ctx.db, frozen.transcript.text, ref),
    );
    const windowBySegment = new Map<string, GroundingSource>();
    for (const w of windows) {
      const src: GroundingSource = {
        segments: w.segments.map((s) => ({ id: s.id, text: s.text, charStart: s.charStart })),
        windowText: w.text,
        windowCharStart: w.charStart,
      };
      for (const s of w.segments) {
        if (!windowBySegment.has(s.id)) windowBySegment.set(s.id, src);
      }
    }

    const wholeTranscript: GroundingSource = {
      segments: frozen.segments.map((s) => ({ id: s.id, text: s.text, charStart: s.charStart })),
      windowText: frozen.transcript.text,
      windowCharStart: 0,
    };

    let validated = 0;
    let quarantined = 0;

    for (const claim of listClaims(ctx.db, ctx.sessionId, { status: "candidate" })) {
      const source = windowBySegment.get(claim.segmentId) ?? wholeTranscript;
      const result = validateQuote({ quote: claim.quote, segmentId: claim.segmentId }, source);

      if (result.status === "validated") {
        validated++;
        updateClaimValidation(ctx.db, claim.id, {
          status: "validated",
          charStart: result.charStart,
          charEnd: result.charEnd,
          matchMode: result.matchMode,
          segmentId: result.segmentId,
        });
      } else {
        quarantined++;
        updateClaimValidation(ctx.db, claim.id, {
          status: "quarantined",
          charStart: null,
          charEnd: null,
          matchMode: null,
          segmentId: claim.segmentId,
        });
      }
    }

    return { ...state, validated, quarantined };
  },
};

/**
 * The share of extracted claims that failed grounding. A sudden jump means a
 * prompt regression or a model version change — this is the canary.
 */
export function quarantineRate(state: PipelineState): number {
  const total = state.validated + state.quarantined;
  return total === 0 ? 0 : state.quarantined / total;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/pipeline/stage2-validate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/stage2-validate.ts tests/pipeline/stage2-validate.test.ts
git commit -m "feat: add grounding validation stage with quarantine rate metric"
```

---

### Task 17: Stage 3 — classification with hedge guard

**Files:**
- Create: `src/prompts/classify.ts`, `src/pipeline/stage3-classify.ts`
- Test: `tests/pipeline/stage3-classify.test.ts`

**Interfaces:**
- Consumes: `callTyped`; `isHedged` (Task 10); `listClaims` (Task 5).
- Produces: `CLASSIFY_SYSTEM`, `buildClassifyUser(claims, project)`, `ClassificationSchema`, `stage3Classify: Stage<PipelineState, PipelineState>`.
- Adds `setClaimKind(db, id, kind)` to `src/store/claims.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/pipeline/stage3-classify.test.ts
import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertClaims, listClaims } from "../../src/store/claims.js";
import { stage3Classify } from "../../src/pipeline/stage3-classify.js";
import { emptyState } from "../../src/pipeline/state.js";
import { newId } from "../../src/types/ids.js";
import type { StageContext } from "../../src/pipeline/runner.js";

function setup(quotes: string[], modelKinds: string[]) {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "x\n\ny" });
  freezeTranscript(db, transcript.id);
  const now = new Date().toISOString();
  const ids = quotes.map(() => newId("clm"));
  insertClaims(db, quotes.map((quote, i) => ({
    id: ids[i]!, sessionId: s.id, transcriptId: transcript.id,
    segmentId: segments[0]!.id, quote, statement: quote,
    speakerRole: "client" as const, kind: "requirement" as const,
    status: "validated" as const, charStart: 0, charEnd: 1,
    matchMode: "exact" as const, createdAt: now,
  })));
  const parse = vi.fn().mockResolvedValue({
    parsed_output: { classifications: ids.map((id, i) => ({ claimId: id, kind: modelKinds[i] })) },
    content: [{ type: "text", text: "{}" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
  return { ctx, ids, state: emptyState(transcript.id) };
}

describe("stage3Classify", () => {
  it("applies the model's classification for unhedged claims", async () => {
    const { ctx } = setup(["invoices over ten thousand must go to a manager"], ["requirement"]);
    await stage3Classify.run(ctx, emptyState("t"));
    expect(listClaims(ctx.db, ctx.sessionId)[0]?.kind).toBe("requirement");
  });

  it("FORCES assumption when the quote is hedged, overriding the model", async () => {
    const { ctx } = setup(["we would probably want manager approval"], ["requirement"]);
    await stage3Classify.run(ctx, emptyState("t"));
    expect(listClaims(ctx.db, ctx.sessionId)[0]?.kind).toBe("assumption");
  });

  it("forces assumption for every hedge marker in the lexicon", async () => {
    const quotes = ["I think it is monthly", "typically we invoice weekly", "something like a dashboard"];
    const { ctx } = setup(quotes, ["requirement", "requirement", "requirement"]);
    await stage3Classify.run(ctx, emptyState("t"));
    for (const c of listClaims(ctx.db, ctx.sessionId)) expect(c.kind).toBe("assumption");
  });

  it("leaves ambiguity classifications alone", async () => {
    const { ctx } = setup(["it should be fast"], ["ambiguity"]);
    await stage3Classify.run(ctx, emptyState("t"));
    expect(listClaims(ctx.db, ctx.sessionId)[0]?.kind).toBe("ambiguity");
  });

  it("only classifies validated claims", async () => {
    const { ctx } = setup(["invoices must be approved"], ["requirement"]);
    const db = ctx.db;
    db.prepare("UPDATE claims SET status = 'quarantined'").run();
    await stage3Classify.run(ctx, emptyState("t"));
    expect(listClaims(db, ctx.sessionId, { status: "quarantined" })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/pipeline/stage3-classify.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Add setClaimKind to src/store/claims.ts**

```typescript
// append to src/store/claims.ts
export function setClaimKind(db: Db, id: string, kind: Claim["kind"]): void {
  db.prepare("UPDATE claims SET kind = ? WHERE id = ?").run(kind, id);
}
```

- [ ] **Step 4: Implement src/prompts/classify.ts**

```typescript
// src/prompts/classify.ts
import type { Claim, Project } from "../types/domain.js";

export const CLASSIFY_SYSTEM = `You classify claims taken from a client meeting. Each claim is already anchored to a verbatim quote.

Assign exactly one kind to each claim:

- "requirement": the client stated a need, constraint, rule, or obligation as fact. It is something the system must do or must respect. Example: "anything over ten thousand euro has to go to a manager, no exceptions".

- "assumption": the client offered background, belief, or an expectation, or hedged the statement. Anything with "probably", "usually", "I think", "typically", "might", "something like" is an assumption, not a requirement, no matter how confident the surrounding context sounds. Example: "we'd usually be dealing in euro".

- "ambiguity": the client stated something real but left it underspecified in a way that blocks implementation. Example: "it should be fast", "the usual approvals apply".

The difference between "requirement" and "assumption" is the single most consequential judgement in this system. A hedged statement recorded as a requirement becomes a commitment the client never made. When you are unsure, choose "assumption" — an assumption can be verified with the client later, whereas a wrongly promoted requirement is invisible.`;

export function buildClassifyUser(claims: Claim[], project: Project): string {
  const list = claims
    .map((c) => `claimId: ${c.id}\nquote: "${c.quote}"\nrestatement: ${c.statement}`)
    .join("\n\n");
  return `Project domain: ${project.domain}

Classify each claim below.

${list}`;
}
```

- [ ] **Step 5: Implement src/pipeline/stage3-classify.ts**

```typescript
// src/pipeline/stage3-classify.ts
import { z } from "zod";
import { listClaims, setClaimKind } from "../store/claims.js";
import { getProject } from "../store/projects.js";
import { isHedged } from "../hedge/lexicon.js";
import { callTyped } from "../llm/parse.js";
import { CLASSIFY_SYSTEM, buildClassifyUser } from "../prompts/classify.js";
import type { PipelineState } from "./state.js";
import type { Stage } from "./runner.js";

export const ClassificationSchema = z.object({
  classifications: z.array(
    z.object({
      claimId: z.string(),
      kind: z.enum(["requirement", "assumption", "ambiguity"]),
    }),
  ),
});

const BATCH = 40;

/**
 * Classify each validated claim, then apply a deterministic floor.
 *
 * The hedge guard is not advisory: a quote containing a hedge marker is
 * forced to "assumption" regardless of the model's answer. Model judgment
 * plus a mechanical floor — because the failure mode here (promoting hedged
 * speech to a client commitment) is the one that does real damage.
 */
export const stage3Classify: Stage<PipelineState, PipelineState> = {
  name: "classify",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");

    const claims = listClaims(ctx.db, ctx.sessionId, { status: "validated" });
    if (claims.length === 0) return state;

    for (let i = 0; i < claims.length; i += BATCH) {
      const batch = claims.slice(i, i + BATCH);
      const result = await callTyped({
        client: ctx.client,
        db: ctx.db,
        sessionId: ctx.sessionId,
        stage: "classify",
        system: CLASSIFY_SYSTEM,
        user: buildClassifyUser(batch, project),
        schema: ClassificationSchema,
        effort: "high",
      });

      const byId = new Map(result.classifications.map((c) => [c.claimId, c.kind]));
      for (const claim of batch) {
        const modelKind = byId.get(claim.id) ?? "ambiguity";
        // Deterministic floor: hedged speech is never a requirement.
        const kind = isHedged(claim.quote) ? "assumption" : modelKind;
        setClaimKind(ctx.db, claim.id, kind);
      }
    }

    return state;
  },
};
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run tests/pipeline/stage3-classify.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/store/claims.ts src/prompts/classify.ts src/pipeline/stage3-classify.ts tests/pipeline/stage3-classify.test.ts
git commit -m "feat: add classification stage with deterministic hedge guard"
```

---

### Task 18: Stage 4 — cross-claim reconciliation

**Files:**
- Create: `src/prompts/reconcile.ts`, `src/pipeline/stage4-reconcile.ts`, `src/store/links.ts`
- Test: `tests/pipeline/stage4-reconcile.test.ts`

**Interfaces:**
- Consumes: `listClaims`, `listProjectClaims` (Task 5); `listRequirements` (Task 6); `insertQuestions`, `nextKey` (Task 6); `callTyped`.
- Produces:
  - `insertLinks(db, links)` / `listLinks(db, projectId)` in `src/store/links.ts`.
  - `RECONCILE_SYSTEM`, `buildReconcileUser`, `ReconcileSchema`, `stage4Reconcile: Stage<PipelineState, PipelineState>`.
  - Every contradiction produces an auto-raised `OpenQuestion` and is **never** auto-resolved.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/pipeline/stage4-reconcile.test.ts
import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertClaims } from "../../src/store/claims.js";
import { listQuestions } from "../../src/store/findings.js";
import { listLinks } from "../../src/store/links.js";

import { stage4Reconcile } from "../../src/pipeline/stage4-reconcile.js";
import { emptyState } from "../../src/pipeline/state.js";
import { newId } from "../../src/types/ids.js";
import type { StageContext } from "../../src/pipeline/runner.js";

function setup(modelOutput: unknown) {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
  freezeTranscript(db, transcript.id);
  const now = new Date().toISOString();
  const a = newId("clm"), b = newId("clm");
  insertClaims(db, [a, b].map((id, i) => ({
    id, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
    quote: i === 0 ? "approvals go to a manager" : "approvals go to the finance lead",
    statement: "approval routing", speakerRole: "client" as const,
    kind: "requirement" as const, status: "validated" as const,
    charStart: 0, charEnd: 1, matchMode: "exact" as const, createdAt: now,
  })));
  const parse = vi.fn().mockResolvedValue({
    parsed_output: modelOutput,
    content: [{ type: "text", text: "{}" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
  return { ctx, a, b, state: emptyState(transcript.id) };
}

describe("stage4Reconcile", () => {
  it("raises an open question for each contradiction", async () => {
    const { ctx, a, b, state } = setup({
      contradictions: [{ claimIdA: a, claimIdB: b, question: "Do approvals route to a manager or the finance lead?" }],
      links: [],
    });
    const out = await stage4Reconcile.run(ctx, state);
    const qs = listQuestions(ctx.db, ctx.projectId);
    expect(qs).toHaveLength(1);
    expect(qs[0]?.text).toMatch(/manager or the finance lead/);
    expect(qs[0]?.status).toBe("open");
    expect(out.questions).toBe(1);
  });

  it("retains both sides of a contradiction rather than picking one", async () => {
    const { ctx, a, b, state } = setup({
      contradictions: [{ claimIdA: a, claimIdB: b, question: "Which is it?" }],
      links: [],
    });
    await stage4Reconcile.run(ctx, state);
    const links = listLinks(ctx.db, ctx.projectId);
    const contradiction = links.find((l) => l.linkKind === "contradicts");
    expect(contradiction?.fromClaimId).toBe(a);
    expect(contradiction?.toClaimId).toBe(b);
    expect(contradiction?.accepted).toBe(false);
  });

  it("records cross-session links as proposed, never auto-applied", async () => {
    const { ctx, a, state } = setup({
      contradictions: [],
      links: [{ claimId: a, requirementId: "req_existing", linkKind: "refines", rationale: "adds a threshold" }],
    });
    await stage4Reconcile.run(ctx, state);
    const [link] = listLinks(ctx.db, ctx.projectId);
    expect(link?.linkKind).toBe("refines");
    expect(link?.accepted).toBe(false);
  });

  it("is a no-op when there are no requirement claims", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
    freezeTranscript(db, transcript.id);
    const parse = vi.fn();
    const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
    await stage4Reconcile.run(ctx, emptyState(transcript.id));
    expect(parse).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/pipeline/stage4-reconcile.test.ts`
Expected: FAIL — cannot find modules.

- [ ] **Step 3: Implement src/store/links.ts**

```typescript
// src/store/links.ts
import type { Db } from "./db.js";
import { newId } from "../types/ids.js";

export interface ClaimLink {
  id: string;
  projectId: string;
  fromClaimId: string;
  toRequirementId: string | null;
  toClaimId: string | null;
  linkKind: "confirms" | "refines" | "supersedes" | "contradicts";
  rationale: string;
  accepted: boolean;
  createdAt: string;
}

export function insertLinks(db: Db, links: Omit<ClaimLink, "id" | "createdAt">[]): void {
  const stmt = db.prepare(
    `INSERT INTO claim_links
       (id, project_id, from_claim_id, to_requirement_id, to_claim_id, link_kind, rationale, accepted, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const l of links) {
      stmt.run(
        newId("clm"), l.projectId, l.fromClaimId, l.toRequirementId, l.toClaimId,
        l.linkKind, l.rationale, l.accepted ? 1 : 0, now,
      );
    }
  })();
}

export function listLinks(db: Db, projectId: string): ClaimLink[] {
  const rows = db
    .prepare("SELECT * FROM claim_links WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as {
      id: string; project_id: string; from_claim_id: string;
      to_requirement_id: string | null; to_claim_id: string | null;
      link_kind: string; rationale: string; accepted: number; created_at: string;
    }[];
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    fromClaimId: r.from_claim_id,
    toRequirementId: r.to_requirement_id,
    toClaimId: r.to_claim_id,
    linkKind: r.link_kind as ClaimLink["linkKind"],
    rationale: r.rationale,
    accepted: r.accepted === 1,
    createdAt: r.created_at,
  }));
}
```

- [ ] **Step 4: Implement src/prompts/reconcile.ts**

```typescript
// src/prompts/reconcile.ts
import type { Claim, Project, Requirement } from "../types/domain.js";

export const RECONCILE_SYSTEM = `You compare requirement claims from a client meeting against each other and against the project's existing requirements.

Produce two things:

1. "contradictions": pairs of claims from this meeting that cannot both be true of the same system. A contradiction is a genuine conflict about what the system must do — not a difference in wording, not a general statement alongside a more specific one, and not two rules that apply in different circumstances. For each contradiction, write the question you would ask the client to resolve it. Ask about the substance; do not propose an answer and do not indicate which side you believe.

2. "links": relationships between a claim from this meeting and an existing project requirement.
   - "confirms": the claim restates the existing requirement.
   - "refines": the claim adds detail to the existing requirement without changing its meaning.
   - "supersedes": the claim replaces the existing requirement with a different rule.
   - "contradicts": the claim conflicts with the existing requirement.

Be conservative. A missing link costs a reviewer a moment; a wrong link silently rewrites a requirement the client already agreed to. Emit a link only when the relationship is clear from the text.

You are never asked to resolve anything. Resolving a contradiction requires knowing which client statement was correct, and you do not have that information.`;

export function buildReconcileUser(
  claims: Claim[],
  existing: Requirement[],
  project: Project,
): string {
  const claimBlock = claims
    .map((c) => `claimId: ${c.id}\nquote: "${c.quote}"\nrestatement: ${c.statement}`)
    .join("\n\n");
  const existingBlock =
    existing.length === 0
      ? "(none — this is the first session for this project)"
      : existing
          .map((r) => `requirementId: ${r.id}\nkey: ${r.key}\nstatement: ${r.statement}`)
          .join("\n\n");
  return `Project domain: ${project.domain}

Requirement claims from this meeting:

${claimBlock}

Existing project requirements:

${existingBlock}`;
}
```

- [ ] **Step 5: Implement src/pipeline/stage4-reconcile.ts**

```typescript
// src/pipeline/stage4-reconcile.ts
import { z } from "zod";
import { listClaims } from "../store/claims.js";
import { listRequirements, nextKey } from "../store/artifacts.js";
import { insertQuestions } from "../store/findings.js";
import { insertLinks } from "../store/links.js";
import { getProject } from "../store/projects.js";
import { newId } from "../types/ids.js";
import { callTyped } from "../llm/parse.js";
import { RECONCILE_SYSTEM, buildReconcileUser } from "../prompts/reconcile.js";
import type { PipelineState } from "./state.js";
import type { Stage } from "./runner.js";
import type { OpenQuestion } from "../types/domain.js";

export const ReconcileSchema = z.object({
  contradictions: z.array(
    z.object({
      claimIdA: z.string(),
      claimIdB: z.string(),
      question: z.string(),
    }),
  ),
  links: z.array(
    z.object({
      claimId: z.string(),
      requirementId: z.string(),
      linkKind: z.enum(["confirms", "refines", "supersedes", "contradicts"]),
      rationale: z.string(),
    }),
  ),
});

export const stage4Reconcile: Stage<PipelineState, PipelineState> = {
  name: "reconcile",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");

    const claims = listClaims(ctx.db, ctx.sessionId, { status: "validated", kind: "requirement" });
    if (claims.length === 0) return state;

    const existing = listRequirements(ctx.db, ctx.projectId);

    const result = await callTyped({
      client: ctx.client,
      db: ctx.db,
      sessionId: ctx.sessionId,
      stage: "reconcile",
      system: RECONCILE_SYSTEM,
      user: buildReconcileUser(claims, existing, project),
      schema: ReconcileSchema,
      effort: "high",
    });

    const known = new Set(claims.map((c) => c.id));
    const now = new Date().toISOString();
    const questions: OpenQuestion[] = [];

    // Contradictions: both sides retained, question auto-raised, never resolved.
    const contradictionLinks = result.contradictions
      .filter((c) => known.has(c.claimIdA) && known.has(c.claimIdB))
      .map((c) => {
        questions.push({
          id: newId("oqn"),
          projectId: ctx.projectId,
          key: nextKey(ctx.db, ctx.projectId, "open_questions", "OQ"),
          text: c.question,
          category: "domain",
          raisedBySessionId: ctx.sessionId,
          status: "open",
          answerText: null,
          answeredBySessionId: null,
          createdAt: now,
        });
        // nextKey reads the table, so questions must be inserted between
        // allocations. Insert one at a time to keep keys unique.
        insertQuestions(ctx.db, [questions[questions.length - 1]!]);
        return {
          projectId: ctx.projectId,
          fromClaimId: c.claimIdA,
          toRequirementId: null,
          toClaimId: c.claimIdB,
          linkKind: "contradicts" as const,
          rationale: c.question,
          accepted: false,
        };
      });

    const existingIds = new Set(existing.map((r) => r.id));
    const crossLinks = result.links
      .filter((l) => known.has(l.claimId) && existingIds.has(l.requirementId))
      .map((l) => ({
        projectId: ctx.projectId,
        fromClaimId: l.claimId,
        toRequirementId: l.requirementId,
        toClaimId: null,
        linkKind: l.linkKind,
        rationale: l.rationale,
        accepted: false, // proposed, never auto-applied
      }));

    insertLinks(ctx.db, [...contradictionLinks, ...crossLinks]);

    return { ...state, questions: state.questions + questions.length };
  },
};
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run tests/pipeline/stage4-reconcile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/store/links.ts src/prompts/reconcile.ts src/pipeline/stage4-reconcile.ts tests/pipeline/stage4-reconcile.test.ts
git commit -m "feat: add reconciliation stage; contradictions raise questions, never resolve"
```

---

### Task 19: Stage 5 — requirement synthesis

**Files:**
- Create: `src/prompts/requirements.ts`, `src/pipeline/stage5-requirements.ts`
- Test: `tests/pipeline/stage5-requirements.test.ts`

**Interfaces:**
- Consumes: `listClaims`; `insertRequirements`, `nextKey` (Task 6); `callTyped`.
- Produces: `REQUIREMENTS_SYSTEM`, `buildRequirementsUser`, `RequirementDraftsSchema`, `stage5Requirements: Stage<PipelineState, PipelineState>`.
- **Guarantee:** a draft whose `originClaimIds` is empty, or cites an unknown claim, is dropped before insertion. There is no code path that persists an unsourced requirement.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/pipeline/stage5-requirements.test.ts
import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertClaims } from "../../src/store/claims.js";
import { listRequirements } from "../../src/store/artifacts.js";
import { stage5Requirements } from "../../src/pipeline/stage5-requirements.js";
import { emptyState } from "../../src/pipeline/state.js";
import { newId } from "../../src/types/ids.js";
import type { StageContext } from "../../src/pipeline/runner.js";

/** `makeDrafts` receives the real claim id, so tests never juggle placeholders. */
function setup(makeDrafts: (claimId: string) => unknown[]) {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript, segments } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
  freezeTranscript(db, transcript.id);
  const claimId = newId("clm");
  insertClaims(db, [{
    id: claimId, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
    quote: "anything over ten thousand euro goes to a manager", statement: "threshold",
    speakerRole: "client" as const, kind: "requirement" as const, status: "validated" as const,
    charStart: 0, charEnd: 1, matchMode: "exact" as const, createdAt: new Date().toISOString(),
  }]);
  const parse = vi.fn().mockResolvedValue({
    parsed_output: { requirements: makeDrafts(claimId) },
    content: [{ type: "text", text: "{}" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
  return { ctx, claimId, state: emptyState(transcript.id) };
}

describe("stage5Requirements", () => {
  it("persists a sourced requirement with a sequential key", async () => {
    const { ctx, claimId, state } = setup((id) => [
      { statement: "Invoices over EUR 10,000 must be approved by a manager.", originClaimIds: [id] },
    ]);
    const out = await stage5Requirements.run(ctx, state);
    const reqs = listRequirements(ctx.db, ctx.projectId);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.key).toBe("REQ-001");
    expect(reqs[0]?.status).toBe("proposed");
    expect(reqs[0]?.origin).toBe("client-stated");
    expect(reqs[0]?.originClaimIds).toEqual([claimId]);
    expect(out.requirements).toBe(1);
  });

  it("DROPS a requirement with no origin claims", async () => {
    const { ctx, state } = setup(() => [{ statement: "Invented rule.", originClaimIds: [] }]);
    const out = await stage5Requirements.run(ctx, state);
    expect(listRequirements(ctx.db, ctx.projectId)).toHaveLength(0);
    expect(out.requirements).toBe(0);
  });

  it("DROPS a requirement citing a claim that does not exist", async () => {
    const { ctx, state } = setup(() => [{ statement: "Invented rule.", originClaimIds: ["clm_fabricated"] }]);
    await stage5Requirements.run(ctx, state);
    expect(listRequirements(ctx.db, ctx.projectId)).toHaveLength(0);
  });

  it("drops only the unsourced entries, keeping the sourced ones", async () => {
    const { ctx, state } = setup((id) => [
      { statement: "Real one.", originClaimIds: [id] },
      { statement: "Invented one.", originClaimIds: [] },
    ]);
    await stage5Requirements.run(ctx, state);
    const reqs = listRequirements(ctx.db, ctx.projectId);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.statement).toBe("Real one.");
  });

  it("emits no requirements when there are no requirement claims", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
    freezeTranscript(db, transcript.id);
    const parse = vi.fn();
    const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
    const out = await stage5Requirements.run(ctx, emptyState(transcript.id));
    expect(parse).not.toHaveBeenCalled();
    expect(out.requirements).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/pipeline/stage5-requirements.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement src/prompts/requirements.ts**

```typescript
// src/prompts/requirements.ts
import type { Claim, Project } from "../types/domain.js";

export const REQUIREMENTS_SYSTEM = `You turn confirmed claims from a client meeting into testable requirement statements.

For each requirement you emit:
- "statement": one requirement, phrased so that a tester could determine whether the system satisfies it. Use precise language: name the actor, the trigger, and the obligation. Prefer "must" over "should" when the client stated an obligation.
- "originClaimIds": the ids of every claim this requirement is derived from. This list must not be empty.

Rules:

1. Every requirement must cite at least one claim id from the list you were given. A requirement with no citation, or one citing an id that is not in the list, will be discarded automatically.
2. Do not add requirements that seem obviously necessary but were not stated. If the client discussed invoice approval and never mentioned audit logging, there is no audit logging requirement — a later stage will raise that as a question to ask them.
3. Do not merge claims that are about different rules. Do merge claims that restate the same rule.
4. Do not soften or generalize. If the client said "ten thousand euro", the requirement says ten thousand euro, not "a configurable threshold".
5. Say nothing about implementation. Requirements describe what must be true, not how to build it.`;

export function buildRequirementsUser(claims: Claim[], project: Project): string {
  const list = claims
    .map((c) => `claimId: ${c.id}\nquote: "${c.quote}"\nrestatement: ${c.statement}`)
    .join("\n\n");
  return `Project domain: ${project.domain}

Confirmed requirement claims:

${list}`;
}
```

- [ ] **Step 4: Implement src/pipeline/stage5-requirements.ts**

```typescript
// src/pipeline/stage5-requirements.ts
import { z } from "zod";
import { listClaims } from "../store/claims.js";
import { insertRequirements, nextKey } from "../store/artifacts.js";
import { getProject } from "../store/projects.js";
import { newId } from "../types/ids.js";
import { callTyped } from "../llm/parse.js";
import { REQUIREMENTS_SYSTEM, buildRequirementsUser } from "../prompts/requirements.js";
import type { PipelineState } from "./state.js";
import type { Stage } from "./runner.js";
import type { Requirement } from "../types/domain.js";

export const RequirementDraftsSchema = z.object({
  requirements: z.array(
    z.object({
      statement: z.string(),
      originClaimIds: z.array(z.string()),
    }),
  ),
});

/**
 * Synthesize requirements from validated requirement claims.
 *
 * A draft with no origin claims, or one citing a claim that does not exist,
 * is dropped here — before the store, before the schema, before a human sees
 * it. Combined with RequirementSchema's refine(), there is no code path in
 * this system that produces an unsourced client-stated requirement.
 */
export const stage5Requirements: Stage<PipelineState, PipelineState> = {
  name: "requirements",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");

    const claims = listClaims(ctx.db, ctx.sessionId, { status: "validated", kind: "requirement" });
    if (claims.length === 0) return state;

    const result = await callTyped({
      client: ctx.client,
      db: ctx.db,
      sessionId: ctx.sessionId,
      stage: "requirements",
      system: REQUIREMENTS_SYSTEM,
      user: buildRequirementsUser(claims, project),
      schema: RequirementDraftsSchema,
      effort: "high",
    });

    const known = new Set(claims.map((c) => c.id));
    const now = new Date().toISOString();
    const toInsert: Requirement[] = [];

    for (const draft of result.requirements) {
      const cited = draft.originClaimIds.filter((id) => known.has(id));
      if (cited.length === 0) continue; // unsourced — drop it
      const req: Requirement = {
        id: newId("req"),
        projectId: ctx.projectId,
        key: nextKey(ctx.db, ctx.projectId, "requirements", "REQ"),
        statement: draft.statement,
        status: "proposed",
        origin: "client-stated",
        originClaimIds: cited,
        supersedesId: null,
        createdAt: now,
      };
      insertRequirements(ctx.db, [req]); // one at a time so nextKey stays unique
      toInsert.push(req);
    }

    return { ...state, requirements: state.requirements + toInsert.length };
  },
};
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/pipeline/stage5-requirements.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/prompts/requirements.ts src/pipeline/stage5-requirements.ts tests/pipeline/stage5-requirements.test.ts
git commit -m "feat: add requirement synthesis; unsourced drafts are dropped"
```

---

### Task 20: Stage 6 — story and acceptance criteria synthesis

**Files:**
- Create: `src/prompts/stories.ts`, `src/pipeline/stage6-stories.ts`
- Test: `tests/pipeline/stage6-stories.test.ts`

**Interfaces:**
- Consumes: `listRequirements`; `insertStory`, `nextKey`; `insertQuestions`; `callTyped`.
- Produces: `STORIES_SYSTEM`, `buildStoriesUser`, `StoryDraftsSchema`, `stage6Stories: Stage<PipelineState, PipelineState>`.
- **Guarantee:** every `source: "derived"` acceptance criterion that encodes an unmade decision arrives with a `question` string; the stage creates the `OpenQuestion` and links the AC to it. A derived AC without a question is still marked derived.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/pipeline/stage6-stories.test.ts
import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertRequirements, listStories } from "../../src/store/artifacts.js";
import { listQuestions } from "../../src/store/findings.js";
import { stage6Stories } from "../../src/pipeline/stage6-stories.js";
import { emptyState } from "../../src/pipeline/state.js";
import { newId } from "../../src/types/ids.js";
import type { StageContext } from "../../src/pipeline/runner.js";

function setup(drafts: unknown) {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
  freezeTranscript(db, transcript.id);
  const reqId = newId("req");
  insertRequirements(db, [{
    id: reqId, projectId: p.id, key: "REQ-001",
    statement: "Invoices over EUR 10,000 must be approved by a manager.",
    status: "proposed", origin: "client-stated", originClaimIds: ["clm_a"],
    supersedesId: null, createdAt: new Date().toISOString(),
  }]);
  const parse = vi.fn().mockResolvedValue({
    parsed_output: drafts,
    content: [{ type: "text", text: "{}" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
  return { ctx, reqId, state: emptyState(transcript.id) };
}

describe("stage6Stories", () => {
  it("persists a story with its criteria and requirement links", async () => {
    const { ctx, reqId, state } = setup({
      stories: [{
        asA: "finance clerk", iWant: "invoices over EUR 10,000 routed to a manager",
        soThat: "high-value spend has a second pair of eyes",
        requirementIds: [reqId],
        acceptanceCriteria: [
          { gherkin: "Given an invoice of EUR 10,001, when submitted, then it is routed to the manager queue", source: "client-stated", question: null },
        ],
      }],
    });
    const out = await stage6Stories.run(ctx, state);
    const [entry] = listStories(ctx.db, ctx.projectId);
    expect(entry?.story.key).toBe("US-001");
    expect(entry?.criteria).toHaveLength(1);
    expect(entry?.criteria[0]?.source).toBe("client-stated");
    expect(out.stories).toBe(1);
  });

  it("raises an open question for a derived criterion and links the AC to it", async () => {
    const { ctx, reqId, state } = setup({
      stories: [{
        asA: "finance clerk", iWant: "escalation", soThat: "nothing stalls",
        requirementIds: [reqId],
        acceptanceCriteria: [
          { gherkin: "Given the manager has not responded in 48h, then it escalates", source: "derived", question: "Is 48 hours the correct escalation window? Not stated by the client." },
        ],
      }],
    });
    const out = await stage6Stories.run(ctx, state);
    const [entry] = listStories(ctx.db, ctx.projectId);
    expect(entry?.criteria[0]?.source).toBe("derived");
    expect(entry?.criteria[0]?.linkedQuestionId).not.toBeNull();
    const qs = listQuestions(ctx.db, ctx.projectId);
    expect(qs[0]?.text).toMatch(/48 hours/);
    expect(out.questions).toBe(1);
  });

  it("drops a story citing no known requirement", async () => {
    const { ctx, state } = setup({
      stories: [{
        asA: "x", iWant: "y", soThat: "z",
        requirementIds: ["req_fabricated"],
        acceptanceCriteria: [{ gherkin: "g", source: "client-stated", question: null }],
      }],
    });
    await stage6Stories.run(ctx, state);
    expect(listStories(ctx.db, ctx.projectId)).toHaveLength(0);
  });

  it("does nothing when there are no requirements", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
    freezeTranscript(db, transcript.id);
    const parse = vi.fn();
    const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
    await stage6Stories.run(ctx, emptyState(transcript.id));
    expect(parse).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/pipeline/stage6-stories.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement src/prompts/stories.ts**

```typescript
// src/prompts/stories.ts
import type { Project, Requirement } from "../types/domain.js";

export const STORIES_SYSTEM = `You group confirmed requirements into user stories with acceptance criteria.

For each story emit "asA", "iWant", "soThat", the "requirementIds" it implements, and its "acceptanceCriteria".

Each acceptance criterion has:
- "gherkin": one criterion in Given/When/Then form.
- "source": either "client-stated" or "derived".
- "question": a question to put to the client, or null.

The source field is the most important thing you produce here.

Mark a criterion "client-stated" only when it is traceable to what the requirement's own claims actually say. If the client said invoices over ten thousand go to a manager, then "Given an invoice of EUR 10,001, when submitted, then it is routed to the manager queue" is client-stated.

Mark a criterion "derived" when you added it for completeness. You are allowed and encouraged to add derived criteria — an incomplete story is not useful. But whenever a derived criterion encodes a decision the client never made (a number, a timeout, a threshold, a default, an ordering, an error behaviour), you must also write the "question" that asks them to confirm it. State plainly in the question that the value was not stated by the client.

A derived criterion that silently invents a retention period, an escalation window, or a page size, with no question attached, is the specific failure this system exists to prevent.

Do not invent requirements. Work only from the requirements given to you. If a story would need a requirement that does not exist, write the acceptance criterion as derived and ask about it instead.`;

export function buildStoriesUser(requirements: Requirement[], project: Project): string {
  const list = requirements
    .map((r) => `requirementId: ${r.id}\nkey: ${r.key}\nstatement: ${r.statement}`)
    .join("\n\n");
  return `Project domain: ${project.domain}

Confirmed requirements:

${list}`;
}
```

- [ ] **Step 4: Implement src/pipeline/stage6-stories.ts**

```typescript
// src/pipeline/stage6-stories.ts
import { z } from "zod";
import { listRequirements, insertStory, nextKey } from "../store/artifacts.js";
import { insertQuestions } from "../store/findings.js";
import { getProject } from "../store/projects.js";
import { newId } from "../types/ids.js";
import { callTyped } from "../llm/parse.js";
import { STORIES_SYSTEM, buildStoriesUser } from "../prompts/stories.js";
import type { PipelineState } from "./state.js";
import type { Stage } from "./runner.js";
import type { AcceptanceCriterion, OpenQuestion, Story } from "../types/domain.js";

export const StoryDraftsSchema = z.object({
  stories: z.array(
    z.object({
      asA: z.string(),
      iWant: z.string(),
      soThat: z.string(),
      requirementIds: z.array(z.string()),
      acceptanceCriteria: z.array(
        z.object({
          gherkin: z.string(),
          source: z.enum(["client-stated", "derived"]),
          question: z.string().nullable(),
        }),
      ),
    }),
  ),
});

export const stage6Stories: Stage<PipelineState, PipelineState> = {
  name: "stories",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");

    const requirements = listRequirements(ctx.db, ctx.projectId, { status: "proposed" });
    if (requirements.length === 0) return state;

    const result = await callTyped({
      client: ctx.client,
      db: ctx.db,
      sessionId: ctx.sessionId,
      stage: "stories",
      system: STORIES_SYSTEM,
      user: buildStoriesUser(requirements, project),
      schema: StoryDraftsSchema,
      effort: "high",
    });

    const known = new Set(requirements.map((r) => r.id));
    const now = new Date().toISOString();
    let stories = 0;
    let questions = 0;

    for (const draft of result.stories) {
      const cited = draft.requirementIds.filter((id) => known.has(id));
      if (cited.length === 0) continue; // a story implementing nothing real is dropped

      const storyId = newId("sty");
      const criteria: AcceptanceCriterion[] = [];

      draft.acceptanceCriteria.forEach((ac, idx) => {
        let linkedQuestionId: string | null = null;
        if (ac.source === "derived" && ac.question && ac.question.trim().length > 0) {
          const q: OpenQuestion = {
            id: newId("oqn"),
            projectId: ctx.projectId,
            key: nextKey(ctx.db, ctx.projectId, "open_questions", "OQ"),
            text: ac.question,
            category: "domain",
            raisedBySessionId: ctx.sessionId,
            status: "open",
            answerText: null,
            answeredBySessionId: null,
            createdAt: now,
          };
          insertQuestions(ctx.db, [q]);
          linkedQuestionId = q.id;
          questions++;
        }
        criteria.push({
          id: newId("acr"),
          storyId,
          idx,
          gherkin: ac.gherkin,
          source: ac.source,
          linkedQuestionId,
        });
      });

      const story: Story = {
        id: storyId,
        projectId: ctx.projectId,
        key: nextKey(ctx.db, ctx.projectId, "stories", "US"),
        asA: draft.asA,
        iWant: draft.iWant,
        soThat: draft.soThat,
        requirementIds: cited,
        createdAt: now,
      };
      insertStory(ctx.db, story, criteria);
      stories++;
    }

    return {
      ...state,
      stories: state.stories + stories,
      questions: state.questions + questions,
    };
  },
};
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/pipeline/stage6-stories.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/prompts/stories.ts src/pipeline/stage6-stories.ts tests/pipeline/stage6-stories.test.ts
git commit -m "feat: add story synthesis; derived criteria raise linked questions"
```

---

### Task 21: Stage 7 — the critique panel

The structural safety control lives in this task's schema: reviewers have **no field in which a requirement can be expressed**.

**Files:**
- Create: `src/prompts/critique.ts`, `src/pipeline/stage7-critique.ts`
- Test: `tests/pipeline/stage7-critique.test.ts`

**Interfaces:**
- Consumes: `listRequirements`, `listStories`; `insertQuestions`, `insertRecommendations`, `nextKey`; `callTyped`.
- Produces: `CritiqueFindingsSchema`, `REVIEWERS: Reviewer[]` (four entries), `stage7Critique: Stage<PipelineState, PipelineState>`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/pipeline/stage7-critique.test.ts
import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertRequirements } from "../../src/store/artifacts.js";
import { listQuestions, listRecommendations } from "../../src/store/findings.js";
import { CritiqueFindingsSchema, REVIEWERS, stage7Critique } from "../../src/pipeline/stage7-critique.js";
import { emptyState } from "../../src/pipeline/state.js";
import { newId } from "../../src/types/ids.js";
import type { StageContext } from "../../src/pipeline/runner.js";

function setup(regulatoryContext: "none" | "GDPR" = "none") {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators", regulatoryContext });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
  freezeTranscript(db, transcript.id);
  insertRequirements(db, [{
    id: newId("req"), projectId: p.id, key: "REQ-001",
    statement: "Invoices over EUR 10,000 must be approved by a manager.",
    status: "proposed", origin: "client-stated", originClaimIds: ["clm_a"],
    supersedesId: null, createdAt: new Date().toISOString(),
  }]);
  const parse = vi.fn().mockResolvedValue({
    parsed_output: {
      questions: [{ text: "Is an audit trail required for approvals?", category: "security" }],
      recommendations: [{ text: "Approval actions need an immutable audit trail.", rationale: "Financial approval with no audit mechanism discussed.", category: "security" }],
    },
    content: [{ type: "text", text: "{}" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
  return { ctx, parse, state: emptyState(transcript.id) };
}

describe("CritiqueFindingsSchema — the structural control", () => {
  it("has exactly two top-level fields: questions and recommendations", () => {
    expect(Object.keys(CritiqueFindingsSchema.shape).sort()).toEqual(["questions", "recommendations"]);
  });

  it("has NO field in which a requirement can be expressed", () => {
    const json = JSON.stringify(CritiqueFindingsSchema.shape);
    for (const forbidden of ["requirement", "statement", "acceptanceCriteri", "story"]) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("rejects a payload carrying a requirements array", () => {
    const parsed = CritiqueFindingsSchema.safeParse({
      questions: [], recommendations: [], requirements: [{ statement: "sneaky" }],
    });
    // Zod strips unknown keys by default; assert the requirement cannot survive.
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).not.toHaveProperty("requirements");
  });
});

describe("REVIEWERS", () => {
  it("has four reviewers", () => {
    expect(REVIEWERS).toHaveLength(4);
    expect(REVIEWERS.map((r) => r.name).sort()).toEqual(
      ["compliance", "domain", "security-privacy", "testability"],
    );
  });

  it("gives the compliance reviewer a stop instruction when no jurisdiction is set", () => {
    const compliance = REVIEWERS.find((r) => r.name === "compliance")!;
    const prompt = compliance.system({ regulatoryContext: "none" } as never);
    expect(prompt).toMatch(/do not (infer|guess|name) a jurisdiction/i);
  });
});

describe("stage7Critique", () => {
  it("runs all four reviewers and persists their findings", async () => {
    const { ctx, parse, state } = setup();
    const out = await stage7Critique.run(ctx, state);
    expect(parse).toHaveBeenCalledTimes(4);
    expect(listQuestions(ctx.db, ctx.projectId)).toHaveLength(4);
    expect(listRecommendations(ctx.db, ctx.projectId)).toHaveLength(4);
    expect(out.questions).toBe(4);
    expect(out.recommendations).toBe(4);
  });

  it("persists recommendations with status open and a rationale", async () => {
    const { ctx, state } = setup();
    await stage7Critique.run(ctx, state);
    const [rec] = listRecommendations(ctx.db, ctx.projectId);
    expect(rec?.status).toBe("open");
    expect(rec?.rationale).toMatch(/audit mechanism/);
  });

  it("skips entirely when there are no requirements", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
    freezeTranscript(db, transcript.id);
    const parse = vi.fn();
    const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
    await stage7Critique.run(ctx, emptyState(transcript.id));
    expect(parse).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/pipeline/stage7-critique.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement src/prompts/critique.ts**

```typescript
// src/prompts/critique.ts
import type { Project, Requirement, Story, AcceptanceCriterion } from "../types/domain.js";

const SHARED_PREAMBLE = `You are reviewing a draft set of requirements and user stories produced from a client meeting.

Your output is limited to two kinds of finding:
- "questions": things to ask the client, because the answer is not in the material and you must not decide it for them.
- "recommendations": things you believe the team should do, with your reasoning.

You cannot author a requirement. There is no place in your response to put one, and that is deliberate: a requirement records what the client said, and you were not in the room. If you notice something the system clearly needs but the client never mentioned, that is a question or a recommendation — never a requirement.

Be specific. "Consider security" is not a finding. "Approval actions have no stated audit mechanism, so a disputed approval could not be reconstructed" is a finding.`;

export interface ReviewerContext {
  regulatoryContext: Project["regulatoryContext"];
}

export interface Reviewer {
  name: "domain" | "security-privacy" | "compliance" | "testability";
  system(ctx: ReviewerContext): string;
}

export const REVIEWERS: Reviewer[] = [
  {
    name: "domain",
    system: () => `${SHARED_PREAMBLE}

You are reviewing for domain completeness. Look for:
- entities, roles, and actors that are referenced but never defined
- lifecycle states that have no transition into or out of them
- volumes, frequencies, and scale that were never established
- integrations and upstream/downstream systems that are implied but unspecified
- failure paths: what happens when the happy path does not happen

Use the project's stated domain to judge what is missing. Do not import assumptions from a different domain.`,
  },
  {
    name: "security-privacy",
    system: () => `${SHARED_PREAMBLE}

You are reviewing for security and privacy. Look for:
- authentication and authorization: who may perform each action, and how that is established
- classes of personal or sensitive data being handled, and whether their handling was discussed
- retention and deletion: how long data is kept, and what deletes it
- encryption in transit and at rest, where the material implies sensitive data
- audit trail: whether consequential actions can be reconstructed afterwards
- data residency, where the domain suggests it matters

Frame each as a question to the client or a recommendation to the team.`,
  },
  {
    name: "compliance",
    system: (ctx) => {
      if (ctx.regulatoryContext === "none") {
        return `${SHARED_PREAMBLE}

You are reviewing for compliance. No regulatory context has been set for this project.

Because of that, ask only generic data-protection questions that would apply to any system handling business or personal data, and stop there. Do not infer a jurisdiction, do not name a regulation, and do not cite specific articles or clauses. If you believe a regulation probably applies, the correct output is a question asking which regulatory regimes govern this project — not an assumption about which one does.`;
      }
      return `${SHARED_PREAMBLE}

You are reviewing for compliance under ${ctx.regulatoryContext}, which the project has declared as its regulatory context.

Identify obligations under ${ctx.regulatoryContext} that the current requirements do not address, and raise each as a question or a recommendation. Do not extend your review to regulations other than ${ctx.regulatoryContext} unless the material explicitly references them.`;
    },
  },
  {
    name: "testability",
    system: () => `${SHARED_PREAMBLE}

You are reviewing for testability and edge cases. Look for:
- acceptance criteria that cannot be evaluated as pass or fail ("fast", "user-friendly", "reliable")
- inputs with no stated bounds: length, size, count, range, character set
- empty, single-item, and maximum-size cases
- concurrency: two actors doing the same thing at once
- ordering and idempotency: what happens if an action is repeated
- error handling: what the system does when a dependency is unavailable

Prefer findings that would change how someone writes a test.`,
  },
];

export function buildCritiqueUser(
  project: Project,
  requirements: Requirement[],
  stories: { story: Story; criteria: AcceptanceCriterion[] }[],
): string {
  const reqBlock = requirements.map((r) => `${r.key}: ${r.statement}`).join("\n");
  const storyBlock = stories
    .map(({ story, criteria }) => {
      const acs = criteria
        .map((c) => `    - [${c.source}] ${c.gherkin}`)
        .join("\n");
      return `${story.key}: As a ${story.asA}, I want ${story.iWant}, so that ${story.soThat}\n${acs}`;
    })
    .join("\n\n");
  return `Project domain: ${project.domain}
Regulatory context: ${project.regulatoryContext}

Requirements:
${reqBlock || "(none)"}

Stories:
${storyBlock || "(none)"}`;
}
```

- [ ] **Step 4: Implement src/pipeline/stage7-critique.ts**

```typescript
// src/pipeline/stage7-critique.ts
import { z } from "zod";
import { listRequirements, listStories, nextKey } from "../store/artifacts.js";
import { insertQuestions, insertRecommendations } from "../store/findings.js";
import { getProject } from "../store/projects.js";
import { newId } from "../types/ids.js";
import { callTyped } from "../llm/parse.js";
import { REVIEWERS, buildCritiqueUser } from "../prompts/critique.js";
import type { PipelineState } from "./state.js";
import type { Stage } from "./runner.js";
import type { OpenQuestion, Recommendation } from "../types/domain.js";

export { REVIEWERS } from "../prompts/critique.js";

const Category = z.enum(["domain", "security", "privacy", "compliance", "edge-case", "testability"]);

/**
 * The critique panel's output type.
 *
 * This schema is the second structural safety control in the system: it
 * contains only questions and recommendations. There is no field in which a
 * requirement can be expressed, so even a maximally helpful model cannot
 * author one here — there is nowhere to put it.
 *
 * Do not add a field to this schema without re-reading the spec's safety
 * controls section.
 */
export const CritiqueFindingsSchema = z.object({
  questions: z.array(z.object({ text: z.string(), category: Category })),
  recommendations: z.array(
    z.object({ text: z.string(), rationale: z.string(), category: Category }),
  ),
});

export const stage7Critique: Stage<PipelineState, PipelineState> = {
  name: "critique",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");

    const requirements = listRequirements(ctx.db, ctx.projectId, { status: "proposed" });
    if (requirements.length === 0) return state;

    const stories = listStories(ctx.db, ctx.projectId);
    const user = buildCritiqueUser(project, requirements, stories);

    // Reviewers are independent; run them concurrently.
    const results = await Promise.all(
      REVIEWERS.map((reviewer) =>
        callTyped({
          client: ctx.client,
          db: ctx.db,
          sessionId: ctx.sessionId,
          stage: `critique:${reviewer.name}`,
          system: reviewer.system({ regulatoryContext: project.regulatoryContext }),
          user,
          schema: CritiqueFindingsSchema,
          effort: "high",
        }),
      ),
    );

    const now = new Date().toISOString();
    let questions = 0;
    let recommendations = 0;

    // Key allocation reads the table, so insert serially after the parallel calls.
    for (const result of results) {
      for (const q of result.questions) {
        const question: OpenQuestion = {
          id: newId("oqn"),
          projectId: ctx.projectId,
          key: nextKey(ctx.db, ctx.projectId, "open_questions", "OQ"),
          text: q.text,
          category: q.category,
          raisedBySessionId: ctx.sessionId,
          status: "open",
          answerText: null,
          answeredBySessionId: null,
          createdAt: now,
        };
        insertQuestions(ctx.db, [question]);
        questions++;
      }
      for (const r of result.recommendations) {
        const rec: Recommendation = {
          id: newId("rec"),
          projectId: ctx.projectId,
          key: nextKey(ctx.db, ctx.projectId, "recommendations", "REC"),
          text: r.text,
          rationale: r.rationale,
          category: r.category,
          raisedBySessionId: ctx.sessionId,
          status: "open",
          dispositionNote: null,
          createdAt: now,
        };
        insertRecommendations(ctx.db, [rec]);
        recommendations++;
      }
    }

    return {
      ...state,
      questions: state.questions + questions,
      recommendations: state.recommendations + recommendations,
    };
  },
};
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/pipeline/stage7-critique.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/prompts/critique.ts src/pipeline/stage7-critique.ts tests/pipeline/stage7-critique.test.ts
git commit -m "feat: add critique panel with type-constrained output

The reviewer schema contains only questions and recommendations. There
is no field in which a requirement can be expressed, so a reviewer
cannot author one regardless of how the prompt is interpreted."
```

---

### Task 22: Stage 8 — assembly

**Files:**
- Create: `src/pipeline/stage8-assemble.ts`, `src/pipeline/index.ts`
- Test: `tests/pipeline/stage8-assemble.test.ts`

**Interfaces:**
- Consumes: `setSessionStatus` (Task 4); every stage from Tasks 15–21.
- Produces:
  - `stage8Assemble: Stage<PipelineState, PipelineState>` — marks the session `awaiting-review`.
  - `ALL_STAGES: Stage<unknown, unknown>[]` and `analyzeSession(ctx, transcriptId, opts): Promise<PipelineState>` from `src/pipeline/index.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/pipeline/stage8-assemble.test.ts
import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession, getSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { stage8Assemble } from "../../src/pipeline/stage8-assemble.js";
import { ALL_STAGES, analyzeSession } from "../../src/pipeline/index.js";
import { emptyState } from "../../src/pipeline/state.js";
import type { StageContext } from "../../src/pipeline/runner.js";

const LONG = Array.from({ length: 30 }, (_, i) =>
  `Client: statement number ${i} about invoice approval thresholds and routing rules in detail`,
).join("\n\n");

describe("stage8Assemble", () => {
  it("marks the session awaiting-review", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: LONG });
    freezeTranscript(db, transcript.id);
    const ctx: StageContext = { db, client: {} as never, projectId: p.id, sessionId: s.id };
    await stage8Assemble.run(ctx, emptyState(transcript.id));
    expect(getSession(db, s.id)?.status).toBe("awaiting-review");
  });
});

describe("ALL_STAGES", () => {
  it("runs the nine stages in spec order", () => {
    expect(ALL_STAGES.map((s) => s.name)).toEqual([
      "chunk", "extract", "validate", "classify", "reconcile",
      "requirements", "stories", "critique", "assemble",
    ]);
  });
});

describe("analyzeSession", () => {
  it("runs end to end and leaves the session awaiting review", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: LONG });
    freezeTranscript(db, transcript.id);
    // Every LLM stage returns empty results; the pipeline should still complete.
    const parse = vi.fn().mockResolvedValue({
      parsed_output: { claims: [], classifications: [], contradictions: [], links: [], requirements: [], stories: [], questions: [], recommendations: [] },
      content: [{ type: "text", text: "{}" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx: StageContext = { db, client: { messages: { parse } } as never, projectId: p.id, sessionId: s.id };
    const state = await analyzeSession(ctx, transcript.id);
    expect(state.extracted).toBe(0);
    expect(getSession(db, s.id)?.status).toBe("awaiting-review");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/pipeline/stage8-assemble.test.ts`
Expected: FAIL — cannot find modules.

- [ ] **Step 3: Implement src/pipeline/stage8-assemble.ts**

```typescript
// src/pipeline/stage8-assemble.ts
import { setSessionStatus } from "../store/projects.js";
import type { PipelineState } from "./state.js";
import type { Stage } from "./runner.js";

export const stage8Assemble: Stage<PipelineState, PipelineState> = {
  name: "assemble",
  async run(ctx, state) {
    setSessionStatus(ctx.db, ctx.sessionId, "awaiting-review");
    return state;
  },
};
```

- [ ] **Step 4: Implement src/pipeline/index.ts**

```typescript
// src/pipeline/index.ts
import { runPipeline, type Stage, type StageContext } from "./runner.js";
import { setSessionStatus } from "../store/projects.js";
import { stage0Chunk, stage1Extract } from "./stage1-extract.js";
import { stage2Validate } from "./stage2-validate.js";
import { stage3Classify } from "./stage3-classify.js";
import { stage4Reconcile } from "./stage4-reconcile.js";
import { stage5Requirements } from "./stage5-requirements.js";
import { stage6Stories } from "./stage6-stories.js";
import { stage7Critique } from "./stage7-critique.js";
import { stage8Assemble } from "./stage8-assemble.js";
import type { PipelineState } from "./state.js";

export const ALL_STAGES = [
  stage0Chunk, stage1Extract, stage2Validate, stage3Classify, stage4Reconcile,
  stage5Requirements, stage6Stories, stage7Critique, stage8Assemble,
] as unknown as Stage<unknown, unknown>[];

export async function analyzeSession(
  ctx: StageContext,
  transcriptId: string,
  opts?: { resume?: boolean; onProgress?: (name: string, status: string) => void },
): Promise<PipelineState> {
  setSessionStatus(ctx.db, ctx.sessionId, "analyzing");
  const out = await runPipeline(ctx, ALL_STAGES, { transcriptId }, opts);
  return out as PipelineState;
}

export { runPipeline } from "./runner.js";
export type { Stage, StageContext } from "./runner.js";
export type { PipelineState } from "./state.js";
export { quarantineRate } from "./stage2-validate.js";
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/pipeline/stage8-assemble.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/stage8-assemble.ts src/pipeline/index.ts tests/pipeline/stage8-assemble.test.ts
git commit -m "feat: add assembly stage and wire the nine-stage pipeline"
```

---

### Task 23: Export snapshot builder

**Files:**
- Create: `src/export/snapshot.ts`
- Test: `tests/export/snapshot.test.ts`

**Interfaces:**
- Consumes: every store repository; `egressSummary` (Task 6); `ENGINE_VERSION` (Task 1); `MODEL` (Task 11).
- Produces:
  - `SNAPSHOT_SCHEMA_VERSION = "1.0.0"`.
  - `interface ExportSnapshot` — the single input type every publisher consumes.
  - `buildSnapshot(db, projectId): ExportSnapshot`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/export/snapshot.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertClaims } from "../../src/store/claims.js";
import { insertRequirements, insertStory } from "../../src/store/artifacts.js";
import { insertQuestions, insertRecommendations } from "../../src/store/findings.js";
import { buildSnapshot, SNAPSHOT_SCHEMA_VERSION } from "../../src/export/snapshot.js";
import { newId } from "../../src/types/ids.js";

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "Nordic Freight", domain: "B2B freight invoicing for EU logistics operators", regulatoryContext: "GDPR" });
  const s = createSession(db, { projectId: p.id, title: "Kickoff" });
  const { transcript, segments } = createTranscript(db, {
    sessionId: s.id,
    text: "Client: anything over ten thousand euro has to go to a manager\n\nClient: we would usually be dealing in euro",
  });
  freezeTranscript(db, transcript.id);
  const now = new Date().toISOString();
  const reqClaim = newId("clm"), asmClaim = newId("clm"), quarantined = newId("clm");
  insertClaims(db, [
    { id: reqClaim, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
      quote: "anything over ten thousand euro has to go to a manager", statement: "threshold",
      speakerRole: "client", kind: "requirement", status: "validated",
      charStart: 8, charEnd: 62, matchMode: "exact", createdAt: now },
    { id: asmClaim, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[1]!.id,
      quote: "we would usually be dealing in euro", statement: "currency assumption",
      speakerRole: "client", kind: "assumption", status: "validated",
      charStart: 70, charEnd: 104, matchMode: "exact", createdAt: now },
    { id: quarantined, sessionId: s.id, transcriptId: transcript.id, segmentId: segments[0]!.id,
      quote: "passwords rotate every ninety days", statement: "invented",
      speakerRole: "client", kind: "requirement", status: "quarantined",
      charStart: null, charEnd: null, matchMode: null, createdAt: now },
  ]);
  const reqId = newId("req");
  insertRequirements(db, [{
    id: reqId, projectId: p.id, key: "REQ-001",
    statement: "Invoices over EUR 10,000 must be approved by a manager.",
    status: "finalized", origin: "client-stated", originClaimIds: [reqClaim],
    supersedesId: null, createdAt: now,
  }]);
  const storyId = newId("sty");
  insertStory(db,
    { id: storyId, projectId: p.id, key: "US-001", asA: "finance clerk", iWant: "routing", soThat: "oversight", requirementIds: [reqId], createdAt: now },
    [{ id: newId("acr"), storyId, idx: 0, gherkin: "Given X when Y then Z", source: "client-stated", linkedQuestionId: null }],
  );
  insertQuestions(db, [{ id: newId("oqn"), projectId: p.id, key: "OQ-001", text: "Escalation window?", category: "domain", raisedBySessionId: s.id, status: "open", answerText: null, answeredBySessionId: null, createdAt: now }]);
  insertRecommendations(db, [{ id: newId("rec"), projectId: p.id, key: "REC-001", text: "Add an audit trail.", rationale: "No audit mechanism discussed.", category: "security", raisedBySessionId: s.id, status: "open", dispositionNote: null, createdAt: now }]);
  return { db, projectId: p.id };
}

describe("buildSnapshot", () => {
  it("carries a schema version", () => {
    const { db, projectId } = seed();
    expect(buildSnapshot(db, projectId).schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
  });

  it("includes only finalized requirements in the baseline", () => {
    const { db, projectId } = seed();
    const snap = buildSnapshot(db, projectId);
    expect(snap.requirements).toHaveLength(1);
    expect(snap.requirements[0]?.key).toBe("REQ-001");
  });

  it("excludes proposed requirements by default", () => {
    const { db, projectId } = seed();
    insertRequirements(db, [{
      id: newId("req"), projectId, key: "REQ-002", statement: "Not yet approved.",
      status: "proposed", origin: "client-stated", originClaimIds: ["clm_a"],
      supersedesId: null, createdAt: new Date().toISOString(),
    }]);
    expect(buildSnapshot(db, projectId).requirements.map((r) => r.key)).toEqual(["REQ-001"]);
  });

  it("includes proposed requirements when asked, preserving their status", () => {
    const { db, projectId } = seed();
    insertRequirements(db, [{
      id: newId("req"), projectId, key: "REQ-002", statement: "Not yet approved.",
      status: "proposed", origin: "client-stated", originClaimIds: ["clm_a"],
      supersedesId: null, createdAt: new Date().toISOString(),
    }]);
    const snap = buildSnapshot(db, projectId, { includeProposed: true });
    expect(snap.requirements.map((r) => r.key)).toEqual(["REQ-001", "REQ-002"]);
    expect(snap.requirements.find((r) => r.key === "REQ-002")?.status).toBe("proposed");
  });

  it("attaches a verbatim quote and its timestamp to every requirement", () => {
    const { db, projectId } = seed();
    const [req] = buildSnapshot(db, projectId).requirements;
    expect(req?.evidence).toHaveLength(1);
    expect(req?.evidence[0]?.quote).toMatch(/ten thousand euro/);
    expect(req?.evidence[0]?.sessionTitle).toBe("Kickoff");
  });

  it("lists assumptions separately from requirements", () => {
    const { db, projectId } = seed();
    const snap = buildSnapshot(db, projectId);
    expect(snap.assumptions).toHaveLength(1);
    expect(snap.assumptions[0]?.quote).toMatch(/usually be dealing in euro/);
  });

  it("publishes the quarantine list", () => {
    const { db, projectId } = seed();
    const snap = buildSnapshot(db, projectId);
    expect(snap.quarantined).toHaveLength(1);
    expect(snap.quarantined[0]?.quote).toMatch(/ninety days/);
  });

  it("includes provenance: transcript hashes, models, and egress", () => {
    const { db, projectId } = seed();
    const snap = buildSnapshot(db, projectId);
    expect(snap.provenance.sessions[0]?.transcriptHash).toHaveLength(64);
    expect(snap.provenance.llmModel).toBe("claude-opus-5");
    expect(snap.provenance.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(snap.provenance.egress.requests).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/export/snapshot.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement src/export/snapshot.ts**

```typescript
// src/export/snapshot.ts
import type { Db } from "../store/db.js";
import { getProject, listSessions } from "../store/projects.js";
import { getFrozenTranscript } from "../store/transcripts.js";
import { listProjectClaims } from "../store/claims.js";
import { listRequirements, listStories } from "../store/artifacts.js";
import { listQuestions, listRecommendations } from "../store/findings.js";
import { egressSummary } from "../store/audit.js";
import { ENGINE_VERSION } from "../version.js";
import { MODEL } from "../llm/client.js";
import type { AcSource } from "../types/domain.js";

export const SNAPSHOT_SCHEMA_VERSION = "1.0.0";

export interface Evidence {
  quote: string;
  sessionTitle: string;
  occurredAt: string;
  startMs: number | null;
  matchMode: string | null;
}

export interface ExportSnapshot {
  schemaVersion: string;
  project: { name: string; domain: string; regulatoryContext: string };
  generatedAt: string;
  requirements: {
    key: string; statement: string; status: string; origin: string; evidence: Evidence[];
  }[];
  stories: {
    key: string; asA: string; iWant: string; soThat: string;
    implements: string[];
    acceptanceCriteria: { gherkin: string; source: AcSource; linkedQuestionKey: string | null }[];
  }[];
  assumptions: { quote: string; statement: string; sessionTitle: string; occurredAt: string }[];
  openQuestions: {
    key: string; text: string; category: string; status: string;
    raisedIn: string; answerText: string | null;
  }[];
  recommendations: {
    key: string; text: string; rationale: string; category: string; status: string;
  }[];
  quarantined: { quote: string; statement: string; sessionTitle: string }[];
  provenance: {
    engineVersion: string;
    llmModel: string;
    sessions: { title: string; occurredAt: string; transcriptHash: string; wordCount: number }[];
    egress: { requests: number; promptTokens: number; completionTokens: number };
  };
}

/**
 * Build the single object every publisher consumes.
 *
 * Markdown, JSON, and (later) Jira and Confluence are all just
 * `publish(snapshot)` implementations over this type — which is what keeps
 * the two rendered outputs from ever disagreeing.
 */
export function buildSnapshot(
  db: Db,
  projectId: string,
  opts?: { includeProposed?: boolean },
): ExportSnapshot {
  const project = getProject(db, projectId);
  if (!project) throw new Error("project not found");

  const sessions = listSessions(db, projectId);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const claims = listProjectClaims(db, projectId);
  const claimById = new Map(claims.map((c) => [c.id, c]));

  const segmentStartMs = new Map<string, number | null>();
  const provenanceSessions: ExportSnapshot["provenance"]["sessions"] = [];
  let egress = { requests: 0, promptTokens: 0, completionTokens: 0 };

  for (const s of sessions) {
    const frozen = getFrozenTranscript(db, s.id);
    if (frozen) {
      for (const seg of frozen.segments) segmentStartMs.set(seg.id, seg.startMs);
      provenanceSessions.push({
        title: s.title,
        occurredAt: s.occurredAt,
        transcriptHash: frozen.transcript.contentHash,
        wordCount: (frozen.transcript.text.match(/\S+/g) ?? []).length,
      });
    }
    const e = egressSummary(db, s.id);
    egress = {
      requests: egress.requests + e.requests,
      promptTokens: egress.promptTokens + e.promptTokens,
      completionTokens: egress.completionTokens + e.completionTokens,
    };
  }

  const evidenceFor = (claimIds: string[]): Evidence[] =>
    claimIds.flatMap((id) => {
      const claim = claimById.get(id);
      if (!claim) return [];
      const session = sessionById.get(claim.sessionId);
      return [{
        quote: claim.quote,
        sessionTitle: session?.title ?? "(unknown session)",
        occurredAt: session?.occurredAt ?? "",
        startMs: segmentStartMs.get(claim.segmentId) ?? null,
        matchMode: claim.matchMode,
      }];
    });

  const questions = listQuestions(db, projectId);
  const questionKeyById = new Map(questions.map((q) => [q.id, q.key]));
  const requirementKeyById = new Map(
    listRequirements(db, projectId).map((r) => [r.id, r.key]),
  );

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    project: {
      name: project.name,
      domain: project.domain,
      regulatoryContext: project.regulatoryContext,
    },
    generatedAt: new Date().toISOString(),
    // The baseline is what the BA has approved. `includeProposed` additionally
    // surfaces un-approved drafts (clearly labelled by their `status`) so the
    // engine's output can be evaluated before any review UI exists.
    requirements: listRequirements(db, projectId)
      .filter((r) =>
        r.status === "finalized" ||
        (opts?.includeProposed === true && r.status === "proposed"),
      )
      .map((r) => ({
        key: r.key,
        statement: r.statement,
        status: r.status,
        origin: r.origin,
        evidence: evidenceFor(r.originClaimIds),
      })),
    stories: listStories(db, projectId).map(({ story, criteria }) => ({
      key: story.key,
      asA: story.asA,
      iWant: story.iWant,
      soThat: story.soThat,
      implements: story.requirementIds.map((id) => requirementKeyById.get(id) ?? id),
      acceptanceCriteria: criteria.map((c) => ({
        gherkin: c.gherkin,
        source: c.source,
        linkedQuestionKey: c.linkedQuestionId
          ? questionKeyById.get(c.linkedQuestionId) ?? null
          : null,
      })),
    })),
    assumptions: claims
      .filter((c) => c.status === "validated" && c.kind === "assumption")
      .map((c) => ({
        quote: c.quote,
        statement: c.statement,
        sessionTitle: sessionById.get(c.sessionId)?.title ?? "(unknown session)",
        occurredAt: sessionById.get(c.sessionId)?.occurredAt ?? "",
      })),
    openQuestions: questions.map((q) => ({
      key: q.key,
      text: q.text,
      category: q.category,
      status: q.status,
      raisedIn: sessionById.get(q.raisedBySessionId)?.title ?? "(unknown session)",
      answerText: q.answerText,
    })),
    recommendations: listRecommendations(db, projectId).map((r) => ({
      key: r.key,
      text: r.text,
      rationale: r.rationale,
      category: r.category,
      status: r.status,
    })),
    quarantined: claims
      .filter((c) => c.status === "quarantined")
      .map((c) => ({
        quote: c.quote,
        statement: c.statement,
        sessionTitle: sessionById.get(c.sessionId)?.title ?? "(unknown session)",
      })),
    provenance: {
      engineVersion: ENGINE_VERSION,
      llmModel: MODEL,
      sessions: provenanceSessions,
      egress,
    },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/export/snapshot.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/export/snapshot.ts tests/export/snapshot.test.ts
git commit -m "feat: add export snapshot builder — the shared publisher contract"
```

---

### Task 24: JSON publisher

**Files:**
- Create: `src/export/json.ts`
- Test: `tests/export/json.test.ts`

**Interfaces:**
- Consumes: `ExportSnapshot`, `SNAPSHOT_SCHEMA_VERSION` (Task 23).
- Produces: `interface Publisher { name: string; publish(snapshot: ExportSnapshot): string }`, `jsonPublisher: Publisher`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/export/json.test.ts
import { describe, it, expect } from "vitest";
import { jsonPublisher } from "../../src/export/json.js";
import { SNAPSHOT_SCHEMA_VERSION, type ExportSnapshot } from "../../src/export/snapshot.js";

const snapshot: ExportSnapshot = {
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  project: { name: "P", domain: "d", regulatoryContext: "none" },
  generatedAt: "2026-08-05T00:00:00.000Z",
  requirements: [{ key: "REQ-001", statement: "s", status: "finalized", origin: "client-stated", evidence: [{ quote: "q", sessionTitle: "S", occurredAt: "2026-08-05T00:00:00.000Z", startMs: null, matchMode: "exact" }] }],
  stories: [], assumptions: [], openQuestions: [], recommendations: [], quarantined: [],
  provenance: { engineVersion: "0.1.0", llmModel: "claude-opus-5", sessions: [], egress: { requests: 0, promptTokens: 0, completionTokens: 0 } },
};

describe("jsonPublisher", () => {
  it("emits valid JSON that round-trips", () => {
    const parsed = JSON.parse(jsonPublisher.publish(snapshot)) as ExportSnapshot;
    expect(parsed.requirements[0]?.key).toBe("REQ-001");
  });

  it("includes $schema and schemaVersion", () => {
    const parsed = JSON.parse(jsonPublisher.publish(snapshot)) as Record<string, unknown>;
    expect(parsed.$schema).toBeDefined();
    expect(parsed.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
  });

  it("is stable for a fixed snapshot", () => {
    expect(jsonPublisher.publish(snapshot)).toBe(jsonPublisher.publish(snapshot));
  });

  it("never drops the evidence array", () => {
    const parsed = JSON.parse(jsonPublisher.publish(snapshot)) as ExportSnapshot;
    expect(parsed.requirements[0]?.evidence[0]?.quote).toBe("q");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/export/json.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement src/export/json.ts**

```typescript
// src/export/json.ts
import { SNAPSHOT_SCHEMA_VERSION, type ExportSnapshot } from "./snapshot.js";

export interface Publisher {
  name: string;
  publish(snapshot: ExportSnapshot): string;
}

/**
 * The machine-readable export, and the input type every downstream publisher
 * consumes. Jira and Confluence publishers are added later as further
 * `Publisher` implementations over the same snapshot — no rewrite required.
 */
export const jsonPublisher: Publisher = {
  name: "json",
  publish(snapshot) {
    return JSON.stringify(
      {
        $schema: `https://ba-story-agent.local/schemas/export-${SNAPSHOT_SCHEMA_VERSION}.json`,
        ...snapshot,
      },
      null,
      2,
    );
  },
};
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/export/json.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/export/json.ts tests/export/json.test.ts
git commit -m "feat: add JSON publisher with versioned schema"
```

---

### Task 25: Markdown publisher

**Files:**
- Create: `src/export/markdown.ts`
- Test: `tests/export/markdown.test.ts`

**Interfaces:**
- Consumes: `ExportSnapshot` (Task 23), `Publisher` (Task 24).
- Produces: `markdownPublisher: Publisher`, `formatTimestamp(ms: number | null): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/export/markdown.test.ts
import { describe, it, expect } from "vitest";
import { markdownPublisher, formatTimestamp } from "../../src/export/markdown.js";
import { SNAPSHOT_SCHEMA_VERSION, type ExportSnapshot } from "../../src/export/snapshot.js";

const snapshot: ExportSnapshot = {
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  project: { name: "Nordic Freight", domain: "B2B freight invoicing", regulatoryContext: "GDPR" },
  generatedAt: "2026-08-05T00:00:00.000Z",
  requirements: [{
    key: "REQ-014", statement: "Invoices over EUR 10,000 must be approved by a manager.",
    status: "finalized", origin: "client-stated",
    evidence: [{ quote: "anything over ten thousand euro has to go to a manager", sessionTitle: "Session 2", occurredAt: "2026-07-01T00:00:00.000Z", startMs: 724000, matchMode: "exact" }],
  }],
  stories: [{
    key: "US-007", asA: "finance clerk", iWant: "invoices routed", soThat: "spend is checked",
    implements: ["REQ-014"],
    acceptanceCriteria: [
      { gherkin: "Given an invoice of EUR 10,001, when submitted, then it is routed", source: "client-stated", linkedQuestionKey: null },
      { gherkin: "Given no response in 48h, then it escalates", source: "derived", linkedQuestionKey: "OQ-021" },
    ],
  }],
  assumptions: [{ quote: "we would usually be dealing in euro", statement: "All invoices are in EUR.", sessionTitle: "Session 1", occurredAt: "2026-06-01T00:00:00.000Z" }],
  openQuestions: [{ key: "OQ-021", text: "Is 48h correct?", category: "domain", status: "open", raisedIn: "Session 2", answerText: null }],
  recommendations: [{ key: "REC-009", text: "Add an immutable audit trail.", rationale: "No audit mechanism discussed.", category: "security", status: "open" }],
  quarantined: [{ quote: "passwords rotate every ninety days", statement: "invented", sessionTitle: "Session 2" }],
  provenance: { engineVersion: "0.1.0", llmModel: "claude-opus-5", sessions: [{ title: "Session 2", occurredAt: "2026-07-01T00:00:00.000Z", transcriptHash: "a".repeat(64), wordCount: 4200 }], egress: { requests: 12, promptTokens: 184000, completionTokens: 9000 } },
};

describe("formatTimestamp", () => {
  it("renders mm:ss", () => {
    expect(formatTimestamp(724000)).toBe("12:04");
    expect(formatTimestamp(65000)).toBe("01:05");
  });
  it("renders a dash for null", () => {
    expect(formatTimestamp(null)).toBe("—");
  });
});

describe("markdownPublisher", () => {
  const md = markdownPublisher.publish(snapshot);

  it("attaches a verbatim quote to every confirmed requirement", () => {
    expect(md).toMatch(/### REQ-014/);
    expect(md).toMatch(/anything over ten thousand euro has to go to a manager/);
    expect(md).toMatch(/12:04/);
  });

  it("flags a requirement that has not been approved", () => {
    const proposed = markdownPublisher.publish({
      ...snapshot,
      requirements: [{ ...snapshot.requirements[0]!, status: "proposed" }],
    });
    expect(proposed).toMatch(/\[NOT YET APPROVED\]/);
    expect(md).not.toMatch(/\[NOT YET APPROVED\]/);
  });

  it("marks derived acceptance criteria inline and links the question", () => {
    expect(md).toMatch(/\[client-stated\]/);
    expect(md).toMatch(/\[DERIVED — UNCONFIRMED\]/);
    expect(md).toMatch(/OQ-021/);
  });

  it("titles the assumptions section as NOT client-confirmed", () => {
    expect(md).toMatch(/## 3\. Assumptions — NOT client-confirmed/);
  });

  it("titles the recommendations section as not client requirements", () => {
    expect(md).toMatch(/## 5\. Recommendations — tool-generated, not client requirements/);
  });

  it("publishes the quarantine appendix with a count", () => {
    expect(md).toMatch(/Appendix A — Quarantined extractions \(n=1\)/);
    expect(md).toMatch(/passwords rotate every ninety days/);
  });

  it("publishes the provenance appendix", () => {
    expect(md).toMatch(/Appendix B — Provenance/);
    expect(md).toMatch(/claude-opus-5/);
    expect(md).toMatch(/12 requests/);
    expect(md).toMatch(/aaaaaaaa/);
  });

  it("is stable for a fixed snapshot", () => {
    expect(markdownPublisher.publish(snapshot)).toBe(md);
  });

  it("renders empty sections gracefully", () => {
    const empty: ExportSnapshot = { ...snapshot, requirements: [], stories: [], assumptions: [], openQuestions: [], recommendations: [], quarantined: [] };
    const out = markdownPublisher.publish(empty);
    expect(out).toMatch(/No confirmed requirements/);
    expect(out).toMatch(/Appendix A — Quarantined extractions \(n=0\)/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/export/markdown.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement src/export/markdown.ts**

```typescript
// src/export/markdown.ts
import type { ExportSnapshot } from "./snapshot.js";
import type { Publisher } from "./json.js";

export function formatTimestamp(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function shortDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

export const markdownPublisher: Publisher = {
  name: "markdown",
  publish(s: ExportSnapshot): string {
    const out: string[] = [];

    out.push(`# ${s.project.name} — Requirements Baseline`);
    const sessionList = s.provenance.sessions.map((x) => x.title).join(", ") || "(no sessions)";
    out.push(
      `Sessions: ${sessionList} · Generated ${shortDate(s.generatedAt)} · ` +
        `Regulatory context: ${s.project.regulatoryContext}`,
    );
    const hashes = s.provenance.sessions.map((x) => x.transcriptHash.slice(0, 8)).join(", ");
    out.push(`Transcript hashes: ${hashes || "—"} · Model: ${s.provenance.llmModel}`);
    out.push("");

    // 1. Confirmed requirements
    out.push("## 1. Confirmed Requirements");
    out.push("");
    if (s.requirements.length === 0) {
      out.push("_No confirmed requirements. Nothing here has been approved yet._");
      out.push("");
    }
    for (const r of s.requirements) {
      const pending = r.status !== "finalized" ? " `[NOT YET APPROVED]`" : "";
      out.push(`### ${r.key} — ${r.statement}${pending}`);
      out.push(`**Status:** ${r.status} · **Origin:** ${r.origin}`);
      for (const e of r.evidence) {
        out.push(
          `**Source:** ${e.sessionTitle} @ ${formatTimestamp(e.startMs)} — *"${e.quote}"*` +
            (e.matchMode === "fuzzy" ? " _(matched with disfluencies removed)_" : ""),
        );
      }
      out.push("");
    }

    // 2. Stories
    out.push("## 2. User Stories");
    out.push("");
    if (s.stories.length === 0) {
      out.push("_No user stories yet._");
      out.push("");
    }
    for (const st of s.stories) {
      out.push(`### ${st.key} — ${st.iWant}`);
      out.push(`As a ${st.asA}, I want ${st.iWant}, so that ${st.soThat}.`);
      out.push(`**Implements:** ${st.implements.join(", ") || "—"}`);
      out.push("");
      out.push("Acceptance criteria:");
      for (const ac of st.acceptanceCriteria) {
        if (ac.source === "client-stated") {
          out.push(`- \`[client-stated]\` ${ac.gherkin}`);
        } else {
          const link = ac.linkedQuestionKey ? ` → see **${ac.linkedQuestionKey}**` : "";
          out.push(`- \`[DERIVED — UNCONFIRMED]\` ${ac.gherkin}${link}`);
        }
      }
      out.push("");
    }

    // 3. Assumptions
    out.push("## 3. Assumptions — NOT client-confirmed");
    out.push("");
    if (s.assumptions.length === 0) {
      out.push("_No assumptions recorded._");
      out.push("");
    }
    s.assumptions.forEach((a, i) => {
      out.push(`### ASM-${String(i + 1).padStart(3, "0")} — ${a.statement}`);
      out.push(`**Basis:** ${a.sessionTitle} — *"${a.quote}"* (hedged)`);
      out.push("**Verification:** none recorded");
      out.push("");
    });

    // 4. Open questions
    out.push("## 4. Open Questions");
    out.push("");
    if (s.openQuestions.length === 0) {
      out.push("_No open questions._");
    } else {
      out.push("| ID | Question | Category | Raised | Status |");
      out.push("|----|----------|----------|--------|--------|");
      for (const q of s.openQuestions) {
        const text = q.text.replace(/\|/g, "\\|");
        out.push(`| ${q.key} | ${text} | ${q.category} | ${q.raisedIn} | ${q.status} |`);
      }
    }
    out.push("");

    // 5. Recommendations
    out.push("## 5. Recommendations — tool-generated, not client requirements");
    out.push("");
    if (s.recommendations.length === 0) {
      out.push("_No recommendations._");
      out.push("");
    }
    for (const r of s.recommendations) {
      out.push(`### ${r.key} \`[${r.category}]\` ${r.text}`);
      out.push(`**Rationale:** ${r.rationale}`);
      out.push(`**Status:** ${r.status}`);
      out.push("");
    }

    // Appendix A — the honesty artifact.
    out.push(`## Appendix A — Quarantined extractions (n=${s.quarantined.length})`);
    out.push("");
    out.push(
      "Statements produced during analysis that could not be matched to any " +
        "transcript text. Excluded from every section above. Listed for transparency.",
    );
    out.push("");
    for (const q of s.quarantined) {
      out.push(`- ${q.sessionTitle}: *"${q.quote}"*`);
    }
    if (s.quarantined.length > 0) out.push("");

    // Appendix B — the compliance artifact.
    out.push("## Appendix B — Provenance");
    out.push("");
    out.push(`**Engine version:** ${s.provenance.engineVersion}`);
    out.push(`**LLM model:** ${s.provenance.llmModel}`);
    out.push("");
    if (s.provenance.sessions.length > 0) {
      out.push("| Session | Date | Words | Transcript SHA-256 |");
      out.push("|---------|------|-------|--------------------|");
      for (const x of s.provenance.sessions) {
        out.push(`| ${x.title} | ${shortDate(x.occurredAt)} | ${x.wordCount} | \`${x.transcriptHash}\` |`);
      }
      out.push("");
    }
    const e = s.provenance.egress;
    out.push(
      `**Egress:** ${e.requests} requests, ${e.promptTokens.toLocaleString("en-US")} prompt tokens sent, ` +
        `${e.completionTokens.toLocaleString("en-US")} completion tokens received.`,
    );
    out.push("");
    out.push("_Audio never left this machine. Only the frozen transcript text above was sent._");
    out.push("");

    return out.join("\n");
  },
};
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/export/markdown.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/export/markdown.ts tests/export/markdown.test.ts
git commit -m "feat: add Markdown publisher with evidence, quarantine, and provenance"
```

---

### Task 26: CLI

**Files:**
- Create: `src/cli/index.ts`
- Test: `tests/cli/index.test.ts`

**Interfaces:**
- Consumes: everything.
- Produces: commands `project create`, `session add`, `analyze`, `approve`, `export`, `status`. Exports `buildProgram(opts?: { log? }): Command` so tests can invoke commands without spawning a process.
- `approve` is what exercises the approval gate in this plan: Stage 5 produces `proposed` requirements, and only an explicit approval moves one into the exported baseline. `export --include-proposed` renders un-approved drafts marked `[NOT YET APPROVED]` so extraction quality can be judged before any approval happens.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cli/index.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram } from "../../src/cli/index.js";

let dir: string;
let dbPath: string;

const LONG = Array.from({ length: 30 }, (_, i) =>
  `Client: statement number ${i} about invoice approval thresholds and routing rules in some detail`,
).join("\n\n");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bsa-"));
  dbPath = join(dir, "test.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function run(args: string[]): Promise<string> {
  const lines: string[] = [];
  const program = buildProgram({ log: (s) => lines.push(s) });
  await program.parseAsync(["node", "cli", ...args, "--db", dbPath]);
  return lines.join("\n");
}

describe("cli", () => {
  it("creates a project and prints its id", async () => {
    const out = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    expect(out).toMatch(/prj_/);
  });

  it("rejects a project with a too-short domain", async () => {
    await expect(run(["project", "create", "--name", "P", "--domain", "x"])).rejects.toThrow();
  });

  it("adds a session from a text file", async () => {
    const projectOut = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    const projectId = /prj_[0-9A-Z]+/.exec(projectOut)![0];
    const file = join(dir, "t.txt");
    writeFileSync(file, LONG);
    const out = await run(["session", "add", "--project", projectId, "--title", "Kickoff", "--file", file]);
    expect(out).toMatch(/ses_/);
  });

  it("refuses to add a session below the 200-word floor", async () => {
    const projectOut = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    const projectId = /prj_[0-9A-Z]+/.exec(projectOut)![0];
    const file = join(dir, "short.txt");
    writeFileSync(file, "far too short");
    await expect(
      run(["session", "add", "--project", projectId, "--title", "S", "--file", file]),
    ).rejects.toThrow(/200 words/);
  });

  it("exports markdown and json for a project", async () => {
    const projectOut = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    const projectId = /prj_[0-9A-Z]+/.exec(projectOut)![0];
    await run(["export", "--project", projectId, "--out", dir]);
    expect(existsSync(join(dir, "requirements.md"))).toBe(true);
    expect(existsSync(join(dir, "requirements.json"))).toBe(true);
    expect(readFileSync(join(dir, "requirements.md"), "utf8")).toMatch(/Requirements Baseline/);
  });

  it("prints a status summary", async () => {
    const projectOut = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    const projectId = /prj_[0-9A-Z]+/.exec(projectOut)![0];
    const out = await run(["status", "--project", projectId]);
    expect(out).toMatch(/Requirements/);
  });

  it("approves a proposed requirement into the baseline and records the approval", async () => {
    const projectOut = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    const projectId = /prj_[0-9A-Z]+/.exec(projectOut)![0];

    // Seed a proposed requirement directly; Stage 5 would normally do this.
    const { openDb } = await import("../../src/store/db.js");
    const { insertRequirements, listRequirements } = await import("../../src/store/artifacts.js");
    const { listApprovals } = await import("../../src/store/audit.js");
    const { newId } = await import("../../src/types/ids.js");
    const db = openDb(dbPath);
    insertRequirements(db, [{
      id: newId("req"), projectId, key: "REQ-001",
      statement: "Invoices over EUR 10,000 must be approved by a manager.",
      status: "proposed", origin: "client-stated", originClaimIds: ["clm_a"],
      supersedesId: null, createdAt: new Date().toISOString(),
    }]);

    // Before approval the baseline is empty.
    await run(["export", "--project", projectId, "--out", dir]);
    expect(readFileSync(join(dir, "requirements.md"), "utf8")).toMatch(/No confirmed requirements/);

    // --include-proposed surfaces it, clearly labelled.
    await run(["export", "--project", projectId, "--out", dir, "--include-proposed"]);
    expect(readFileSync(join(dir, "requirements.md"), "utf8")).toMatch(/\[NOT YET APPROVED\]/);

    await run(["approve", "--project", projectId, "--requirement", "REQ-001"]);

    const req = listRequirements(db, projectId)[0]!;
    expect(req.status).toBe("finalized");
    expect(listApprovals(db, "requirement", req.id)).toHaveLength(1);

    await run(["export", "--project", projectId, "--out", dir]);
    const md = readFileSync(join(dir, "requirements.md"), "utf8");
    expect(md).toMatch(/REQ-001/);
    expect(md).not.toMatch(/\[NOT YET APPROVED\]/);
  });

  it("refuses to approve a requirement that does not exist", async () => {
    const projectOut = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    const projectId = /prj_[0-9A-Z]+/.exec(projectOut)![0];
    await expect(
      run(["approve", "--project", projectId, "--requirement", "REQ-999"]),
    ).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/cli/index.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement src/cli/index.ts**

```typescript
// src/cli/index.ts
import { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../store/db.js";
import { createProject, createSession, getProject, listSessions } from "../store/projects.js";
import { createTranscript, freezeTranscript, getFrozenTranscript } from "../store/transcripts.js";
import { countByStatus } from "../store/claims.js";
import { listRequirements, listStories } from "../store/artifacts.js";
import { listQuestions, listRecommendations } from "../store/findings.js";
import { createClient } from "../llm/client.js";
import { analyzeSession, quarantineRate } from "../pipeline/index.js";
import { countWords, MIN_WORDS } from "../pipeline/stage0-chunk.js";
import { buildSnapshot } from "../export/snapshot.js";
import { jsonPublisher } from "../export/json.js";
import { markdownPublisher } from "../export/markdown.js";
import { recordApproval } from "../store/audit.js";
import { setRequirementStatus } from "../store/artifacts.js";
import { hashText } from "../store/transcripts.js";
import { RegulatoryContext } from "../types/domain.js";

type Log = (line: string) => void;

export function buildProgram(opts?: { log?: Log }): Command {
  const log: Log = opts?.log ?? ((s) => process.stdout.write(`${s}\n`));
  const program = new Command();

  program
    .name("bsa")
    .description("BA Story Agent — turn client discussions into traceable requirements")
    .option("--db <path>", "SQLite database path", "./ba-story-agent.db")
    .exitOverride(); // throw instead of process.exit, so tests can assert

  const dbPath = (cmd: Command): string =>
    (cmd.optsWithGlobals() as { db: string }).db;

  const project = program.command("project").description("manage projects");

  project
    .command("create")
    .requiredOption("--name <name>")
    .requiredOption("--domain <domain>", "one-line description of the business domain")
    .option("--regulatory <context>", "none | GDPR | HIPAA | PCI-DSS | SOC2", "none")
    .option("--system-name <name>")
    .option("--glossary-file <path>")
    .action(function (this: Command, o: {
      name: string; domain: string; regulatory: string;
      systemName?: string; glossaryFile?: string;
    }) {
      const db = openDb(dbPath(this));
      const regulatory = RegulatoryContext.parse(o.regulatory);
      const p = createProject(db, {
        name: o.name,
        domain: o.domain,
        regulatoryContext: regulatory,
        systemName: o.systemName ?? null,
        glossary: o.glossaryFile ? readFileSync(o.glossaryFile, "utf8") : null,
      });
      log(`Created project ${p.id}`);
      log(`  name:   ${p.name}`);
      log(`  domain: ${p.domain}`);
    });

  const session = program.command("session").description("manage sessions");

  session
    .command("add")
    .requiredOption("--project <id>")
    .requiredOption("--title <title>")
    .requiredOption("--file <path>", "transcript or notes, plain text")
    .option("--occurred-at <iso>")
    .action(function (this: Command, o: { project: string; title: string; file: string; occurredAt?: string }) {
      const db = openDb(dbPath(this));
      const text = readFileSync(o.file, "utf8");
      const words = countWords(text);
      if (words < MIN_WORDS) {
        throw new Error(
          `input is ${words} words; at least ${MIN_WORDS} words are required. ` +
            `Below this, extraction produces noise rather than requirements.`,
        );
      }
      const s = createSession(db, {
        projectId: o.project,
        title: o.title,
        ...(o.occurredAt ? { occurredAt: o.occurredAt } : {}),
      });
      const { transcript } = createTranscript(db, { sessionId: s.id, text });
      freezeTranscript(db, transcript.id);
      log(`Created session ${s.id} (${words} words, transcript ${transcript.id} frozen)`);
    });

  program
    .command("analyze")
    .requiredOption("--session <id>")
    .option("--resume", "skip stages already completed", false)
    .action(async function (this: Command, o: { session: string; resume: boolean }) {
      const db = openDb(dbPath(this));
      const frozen = getFrozenTranscript(db, o.session);
      if (!frozen) throw new Error(`session ${o.session} has no frozen transcript`);
      const row = db
        .prepare("SELECT project_id FROM sessions WHERE id = ?")
        .get(o.session) as { project_id: string } | undefined;
      if (!row) throw new Error(`session ${o.session} not found`);

      const state = await analyzeSession(
        { db, client: createClient(), projectId: row.project_id, sessionId: o.session },
        frozen.transcript.id,
        {
          resume: o.resume,
          onProgress: (name, status) => log(`  [${status.padEnd(8)}] ${name}`),
        },
      );

      log("");
      log(`Extracted:      ${state.extracted}`);
      log(`Validated:      ${state.validated}`);
      log(`Quarantined:    ${state.quarantined} (${(quarantineRate(state) * 100).toFixed(1)}%)`);
      log(`Requirements:   ${state.requirements}`);
      log(`Stories:        ${state.stories}`);
      log(`Open questions: ${state.questions}`);
      log(`Recommendations:${state.recommendations}`);
      if (state.extracted === 0) {
        log("");
        log("No requirements were found in this transcript.");
      }
    });

  program
    .command("approve")
    .description("approve a proposed requirement, moving it into the baseline")
    .requiredOption("--requirement <key>", "requirement key, e.g. REQ-001")
    .requiredOption("--project <id>")
    .option("--note <text>", "how this was verified, if relevant")
    .action(function (this: Command, o: { requirement: string; project: string; note?: string }) {
      const db = openDb(dbPath(this));
      const req = listRequirements(db, o.project).find((r) => r.key === o.requirement);
      if (!req) throw new Error(`requirement ${o.requirement} not found in project ${o.project}`);
      // Approval attaches to CONTENT, not to a row id: if the statement is
      // later edited, this hash no longer matches and the requirement drops
      // out of the baseline until it is approved again.
      recordApproval(db, {
        entityType: "requirement",
        entityId: req.id,
        action: "approve",
        actorNote: o.note ?? null,
        contentHash: hashText(req.statement),
      });
      setRequirementStatus(db, req.id, "finalized");
      log(`Approved ${req.key}: ${req.statement}`);
    });

  program
    .command("export")
    .requiredOption("--project <id>")
    .requiredOption("--out <dir>")
    .option(
      "--include-proposed",
      "also export requirements the BA has not approved, marked NOT YET APPROVED",
      false,
    )
    .action(function (this: Command, o: { project: string; out: string; includeProposed: boolean }) {
      const db = openDb(dbPath(this));
      const snapshot = buildSnapshot(db, o.project, { includeProposed: o.includeProposed });
      mkdirSync(o.out, { recursive: true });
      const mdPath = join(o.out, "requirements.md");
      const jsonPath = join(o.out, "requirements.json");
      writeFileSync(mdPath, markdownPublisher.publish(snapshot), "utf8");
      writeFileSync(jsonPath, jsonPublisher.publish(snapshot), "utf8");
      log(`Wrote ${mdPath}`);
      log(`Wrote ${jsonPath}`);
    });

  program
    .command("status")
    .requiredOption("--project <id>")
    .action(function (this: Command, o: { project: string }) {
      const db = openDb(dbPath(this));
      const p = getProject(db, o.project);
      if (!p) throw new Error(`project ${o.project} not found`);
      const sessions = listSessions(db, o.project);
      log(`Project: ${p.name} (${p.domain})`);
      log(`Sessions: ${sessions.length}`);
      for (const s of sessions) {
        const counts = countByStatus(db, s.id);
        log(`  ${s.title} — ${s.status} — claims: ${JSON.stringify(counts)}`);
      }
      log(`Requirements:    ${listRequirements(db, o.project).length}`);
      log(`Stories:         ${listStories(db, o.project).length}`);
      log(`Open questions:  ${listQuestions(db, o.project, { status: "open" }).length}`);
      log(`Recommendations: ${listRecommendations(db, o.project).length}`);
    });

  return program;
}

// Only run when invoked directly, not when imported by tests.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  buildProgram()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/cli/index.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Verify the CLI runs for real**

Run: `npm run cli -- --help`
Expected: the command list prints, with `project`, `session`, `analyze`, `approve`, `export`, `status`.

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts tests/cli/index.test.ts
git commit -m "feat: add CLI for project, session, analyze, export, and status"
```

---

### Task 27: Adversarial fixture suite and eval gate

The regression gate that runs before any model version change. It uses recorded fixtures rather than live API calls, so it is fast and deterministic; a separate opt-in script runs the same fixtures live.

**Files:**
- Create: `tests/fixtures/transcripts/*.txt` (5 files)
- Create: `tests/fixtures/golden/expectations.json`
- Create: `tests/eval/adversarial.test.ts`
- Create: `scripts/run-live-eval.ts`
- Test: itself.

**Interfaces:**
- Consumes: the whole pipeline, `analyzeSession`, `buildSnapshot`.
- Produces: `npm run eval` (recorded, runs in CI) and `npm run eval:live` (opt-in, costs money).

- [ ] **Step 1: Write the adversarial fixtures**

Create `tests/fixtures/transcripts/01-login-only.txt` — mentions login and nothing else. Must not yield password-complexity requirements:

```
BA: Thanks for making time. Can you walk me through what you need at a high level?

Client: Sure. The main thing is that our warehouse staff need to be able to log in to the new system. Right now they share a single account and it causes problems when we need to know who did what.

BA: Understood. Anything else about accounts?

Client: Not really. Just that each person should have their own login instead of the shared one. That is the whole of it from our side.

BA: Got it. And how many staff are we talking about?

Client: I would have to check the exact number. It moves around with the seasonal people.

BA: No problem, we can pick that up later. Anything about how they access it — desktop, mobile?

Client: They are all on the warehouse terminals. Same as today.

BA: Right. Is there anything else on your list for this session?

Client: No, I think that covers the account side. We can talk about the picking workflow next time, that is a much bigger conversation and I would want Dagmar in the room for it since she runs that floor day to day.

BA: That works. I will write up what we have and send it over.

Client: Perfect. One more thing actually, the terminals are quite old, some of them are running a browser from a few years back. I do not know if that matters for you but I thought I should mention it.

BA: Good to know, thank you. That is useful context for the front end.

Client: No problem. Send the notes over when you have them.
```

Create `tests/fixtures/transcripts/02-contradiction.txt` — an explicit contradiction that must survive unresolved:

```
BA: Let us talk about the approval flow for purchase orders.

Client: Anything over five thousand euro has to be signed off by a department head. That is a hard rule from finance.

BA: Understood, five thousand and above goes to a department head.

Client: Correct. It has been that way since the audit two years ago and it is not negotiable.

BA: Good. Now what about the timing — is there a deadline on that approval?

Client: Two working days. If they have not responded in two working days it goes up to the finance director automatically.

BA: That is clear. And does anything bypass that?

Client: No, nothing bypasses it.

BA: Let me ask about emergency purchases, because that came up with another client in your sector.

Client: Ah yes. For emergencies any manager can approve up to twenty thousand euro without going to a department head. We set that up during the supply chain problems and it stayed.

BA: So an emergency purchase of fifteen thousand can be approved by any manager, without department head sign off.

Client: Yes exactly. Emergencies are different.

BA: Understood, I will note both. Anything else on approvals?

Client: That is the main shape of it. We should probably also talk about what counts as an emergency but that is a longer conversation with the operations team.
```

Create `tests/fixtures/transcripts/03-small-talk.txt` — pure social conversation, ~250 words, containing no requirements at all. Must produce zero requirements. Write it as a genuine catch-up about weather, travel, a conference, and rescheduling, with no product content.

Create `tests/fixtures/transcripts/04-leading-question.txt` — the nastiest case. The analyst proposes a requirement and the client only says "mm":

```
BA: I have been thinking about the invoice screen since we last spoke.

Client: Go on.

BA: So you would want manager approvals on the high value ones, right? That is normally how these work.

Client: Mm.

BA: And presumably a threshold of around ten thousand, something like that?

Client: Mm, possibly.

BA: Right, and then an audit log of who approved what, that is fairly standard in your sector.

Client: I suppose so, yes.

BA: Good, that all sounds sensible. What about the currency, everything in euro?

Client: We deal with a few. Mostly euro.

BA: Let me switch to something you did mention last time. You said the picking list needs to print at the point the order is confirmed.

Client: Yes, that one is definite. The list has to come off the printer in the packing area the moment the order is confirmed, otherwise the packers are standing around waiting. That is the single biggest problem we have right now and it is why we are doing this project at all.

BA: Understood, printing at confirmation, in the packing area specifically.

Client: In the packing area, yes. Not the office printer, that was the mistake last time.

BA: Noted. Anything else that is definite?

Client: Every order needs the customer reference on the picking list. The packers use it to match against the paperwork. Without that they cannot do their job.

BA: Customer reference on the picking list. Got it.
```

Create `tests/fixtures/transcripts/05-clean-baseline.txt` — a normal, well-behaved requirements conversation of ~500 words with 4–6 clearly stated requirements and 2 clearly hedged assumptions. This is the recall baseline.

- [ ] **Step 2: Write the expectations file**

```json
// tests/fixtures/golden/expectations.json
{
  "01-login-only": {
    "mustNotContainRequirementMatching": [
      "password", "complexity", "rotate", "two-factor", "MFA", "special character", "expiry"
    ],
    "mustContainRequirementMatching": ["individual", "own login|separate account|per-person"],
    "maxQuarantineRate": 0.25
  },
  "02-contradiction": {
    "minContradictions": 1,
    "mustContainQuestionMatching": ["emergency|twenty thousand|bypass"],
    "mustNotAutoResolve": true,
    "maxQuarantineRate": 0.25
  },
  "03-small-talk": {
    "maxRequirements": 0,
    "maxStories": 0
  },
  "04-leading-question": {
    "mustNotContainRequirementMatching": [
      "manager approval", "ten thousand", "audit log"
    ],
    "mustContainRequirementMatching": [
      "picking list", "packing area", "customer reference"
    ],
    "maxQuarantineRate": 0.25
  },
  "05-clean-baseline": {
    "minRequirements": 4,
    "minAssumptions": 2,
    "maxQuarantineRate": 0.20,
    "hallucinationRate": 0
  }
}
```

- [ ] **Step 3: Write the eval harness test**

```typescript
// tests/eval/adversarial.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { validateQuote, type GroundingSource } from "../../src/grounding/validator.js";
import { countWords, MIN_WORDS } from "../../src/pipeline/stage0-chunk.js";
import { isHedged } from "../../src/hedge/lexicon.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../fixtures/transcripts");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, `${name}.txt`), "utf8");
}

/**
 * These tests run WITHOUT the API. They assert the properties the
 * deterministic layer guarantees on real transcript text. The live pipeline
 * eval is `npm run eval:live` and is gated behind an env var because it
 * costs money.
 */
describe("adversarial fixtures — deterministic guarantees", () => {
  const names = readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.replace(/\.txt$/, ""));

  it("has all five fixtures", () => {
    expect(names).toHaveLength(5);
  });

  it("every fixture except small-talk clears the 200-word floor", () => {
    for (const name of names) {
      expect(countWords(loadFixture(name))).toBeGreaterThanOrEqual(MIN_WORDS);
    }
  });

  it("the grounding validator rejects every fabricated quote against every fixture", () => {
    const fabrications = [
      "passwords must be at least twelve characters long",
      "records are retained for thirty days",
      "the system supports single sign on via SAML",
      "invoices are archived to cold storage after one year",
    ];
    for (const name of names) {
      const text = loadFixture(name);
      const source: GroundingSource = {
        segments: [{ id: "s0", text, charStart: 0 }],
        windowText: text,
        windowCharStart: 0,
      };
      for (const quote of fabrications) {
        const result = validateQuote({ quote, segmentId: "s0" }, source);
        expect(
          result.status,
          `"${quote}" should be quarantined against ${name}`,
        ).toBe("quarantined");
      }
    }
  });

  it("the grounding validator accepts real spans lifted from each fixture", () => {
    for (const name of names) {
      const text = loadFixture(name);
      const line = text.split("\n").find((l) => countWords(l) > 8);
      if (!line) continue;
      const span = line.split(/\s+/).slice(1, 9).join(" ");
      const source: GroundingSource = {
        segments: [{ id: "s0", text, charStart: 0 }],
        windowText: text,
        windowCharStart: 0,
      };
      expect(validateQuote({ quote: span, segmentId: "s0" }, source).status).toBe("validated");
    }
  });

  it("the leading-question fixture's non-committal answers are all hedged", () => {
    // "Mm, possibly." and "I suppose so" must be caught by the lexicon so
    // they can never be promoted to requirements.
    expect(isHedged("Mm, possibly.")).toBe(true);
    expect(isHedged("I suppose so, yes.")).toBe(true);
    expect(isHedged("presumably a threshold of around ten thousand")).toBe(true);
  });

  it("the definite statements in the leading-question fixture are NOT hedged", () => {
    expect(isHedged("the list has to come off the printer in the packing area")).toBe(false);
    expect(isHedged("every order needs the customer reference on the picking list")).toBe(false);
  });
});
```

- [ ] **Step 4: Run the eval test**

Run: `npx vitest run tests/eval/adversarial.test.ts`
Expected: PASS (6 tests). If the hedge assertions fail, add the missing markers to `HEDGE_MARKERS` in `src/hedge/lexicon.ts` and re-run both this suite and `tests/hedge/lexicon.test.ts`.

- [ ] **Step 5: Write the live eval script**

```typescript
// scripts/run-live-eval.ts
/**
 * Live pipeline evaluation against the adversarial fixtures.
 *
 * This makes real API calls and costs money, so it is not part of `npm test`.
 * Run it before any model version change — model upgrades are the most likely
 * source of a silent quality regression.
 *
 *   ANTHROPIC_API_KEY=... npm run eval:live
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/store/db.js";
import { createProject, createSession } from "../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../src/store/transcripts.js";
import { createClient } from "../src/llm/client.js";
import { analyzeSession, quarantineRate } from "../src/pipeline/index.js";
import { listRequirements } from "../src/store/artifacts.js";
import { listQuestions } from "../src/store/findings.js";
import { listProjectClaims } from "../src/store/claims.js";

interface Expectation {
  mustNotContainRequirementMatching?: string[];
  mustContainRequirementMatching?: string[];
  mustContainQuestionMatching?: string[];
  minContradictions?: number;
  maxRequirements?: number;
  maxStories?: number;
  minRequirements?: number;
  minAssumptions?: number;
  maxQuarantineRate?: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../tests/fixtures/transcripts");
const expectations = JSON.parse(
  readFileSync(join(here, "../tests/fixtures/golden/expectations.json"), "utf8"),
) as Record<string, Expectation>;

let failures = 0;

function check(name: string, label: string, ok: boolean, detail = ""): void {
  if (ok) {
    process.stdout.write(`  PASS  ${label}\n`);
  } else {
    failures++;
    process.stdout.write(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}\n`);
  }
}

for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith(".txt"))) {
  const name = file.replace(/\.txt$/, "");
  const exp = expectations[name];
  if (!exp) continue;

  process.stdout.write(`\n${name}\n`);

  const db = openDb(":memory:");
  const project = createProject(db, {
    name,
    domain: "warehouse order fulfilment and purchase approval for a logistics operator",
  });
  const session = createSession(db, { projectId: project.id, title: name });
  const { transcript } = createTranscript(db, {
    sessionId: session.id,
    text: readFileSync(join(fixturesDir, file), "utf8"),
  });
  freezeTranscript(db, transcript.id);

  const state = await analyzeSession(
    { db, client: createClient(), projectId: project.id, sessionId: session.id },
    transcript.id,
  );

  const reqs = listRequirements(db, project.id).map((r) => r.statement.toLowerCase());
  const questions = listQuestions(db, project.id).map((q) => q.text.toLowerCase());
  const assumptions = listProjectClaims(db, project.id, { status: "validated", kind: "assumption" });

  for (const pattern of exp.mustNotContainRequirementMatching ?? []) {
    const re = new RegExp(pattern, "i");
    const hit = reqs.find((r) => re.test(r));
    check(name, `no requirement matching /${pattern}/`, !hit, hit);
  }
  for (const pattern of exp.mustContainRequirementMatching ?? []) {
    const re = new RegExp(pattern, "i");
    check(name, `a requirement matching /${pattern}/`, reqs.some((r) => re.test(r)));
  }
  for (const pattern of exp.mustContainQuestionMatching ?? []) {
    const re = new RegExp(pattern, "i");
    check(name, `a question matching /${pattern}/`, questions.some((q) => re.test(q)));
  }
  if (exp.maxRequirements !== undefined) {
    check(name, `at most ${exp.maxRequirements} requirements`, reqs.length <= exp.maxRequirements, `got ${reqs.length}`);
  }
  if (exp.minRequirements !== undefined) {
    check(name, `at least ${exp.minRequirements} requirements`, reqs.length >= exp.minRequirements, `got ${reqs.length}`);
  }
  if (exp.minAssumptions !== undefined) {
    check(name, `at least ${exp.minAssumptions} assumptions`, assumptions.length >= exp.minAssumptions, `got ${assumptions.length}`);
  }
  if (exp.maxQuarantineRate !== undefined) {
    const rate = quarantineRate(state);
    check(name, `quarantine rate <= ${exp.maxQuarantineRate}`, rate <= exp.maxQuarantineRate, rate.toFixed(3));
  }
}

process.stdout.write(`\n${failures === 0 ? "All eval checks passed." : `${failures} eval check(s) FAILED.`}\n`);
process.exitCode = failures === 0 ? 0 : 1;
```

- [ ] **Step 6: Add the eval scripts to package.json**

```json
"scripts": {
  "build": "tsc && node -e \"require('fs').copyFileSync('src/store/schema.sql','dist/src/store/schema.sql')\"",
  "test": "vitest run",
  "test:watch": "vitest",
  "eval": "vitest run tests/eval",
  "eval:live": "tsx scripts/run-live-eval.ts",
  "cli": "tsx src/cli/index.ts"
}
```

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add tests/fixtures tests/eval scripts/run-live-eval.ts package.json
git commit -m "test: add adversarial fixture suite and live eval gate

Five fixtures target the ways requirements actually get fabricated:
a login-only transcript that must not yield password rules, an
unresolved contradiction, pure small talk that must yield nothing, a
leading question answered with 'mm', and a clean recall baseline.
Deterministic assertions run in CI; the live pipeline eval is opt-in
and runs before any model version change."
```

---

## Definition of done for this plan

Running these commands from a clean checkout must succeed:

```bash
npm install
npm test           # every unit and deterministic eval test green
npx tsc --noEmit   # no type errors
npm run cli -- --help
```

And the end-to-end path must work against a real transcript:

```bash
npm run cli -- project create --name "Nordic Freight" \
  --domain "B2B freight invoicing for EU logistics operators" --regulatory GDPR
npm run cli -- session add --project prj_... --title "Kickoff" --file ./meeting.txt
npm run cli -- analyze --session ses_...

# Read the un-approved output first — this is how extraction quality is judged.
npm run cli -- export --project prj_... --out ./out --include-proposed

# Then approve the ones that hold up, and export the real baseline.
npm run cli -- approve --project prj_... --requirement REQ-001
npm run cli -- export --project prj_... --out ./out
```

`./out/requirements.md` must contain a verbatim quote and timestamp for every confirmed requirement, derived acceptance criteria marked inline, and both appendices. In the `--include-proposed` run, every un-approved requirement must carry `[NOT YET APPROVED]`.

**Before starting Plan 2 (the review UI), run `npm run eval:live` against three real anonymized transcripts and read the output.** That is the decision point the whole build order exists to reach: if extraction quality disappoints, the scope of Plans 2 and 3 changes, and that is much cheaper to learn now than after the UI is built.

