# User Story Review Agent with Voice-to-Text — Design

**Date:** 2026-08-05
**Status:** Approved for planning

## Problem

Business Analysts capture client requirements in meetings, then reconstruct them
from memory and rough notes. Detail is lost, unstated assumptions get written down
as client requirements, and contradictions surface late — during development, when
they are expensive.

This tool records or ingests client discussions, transcribes them, and converts the
transcript into structured requirements and user stories. Its central constraint is
negative: **it must never invent client details.** Every confirmed requirement traces
to something the client actually said, and nothing is finalized without explicit
Business Analyst approval.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Data posture | Local capture, cloud LLM | Audio never leaves the machine. Only BA-reviewed, redacted transcript text is sent for analysis. |
| Product shape | Local desktop app, single BA | No auth, no server, no multi-tenancy. Local SQLite. |
| Work unit | Project accumulates sessions | Open questions raised in one meeting can be answered and closed in a later one. |
| Platform | Windows-primary, macOS supported | Most users are on Windows. |
| Stack | Electron + TypeScript + React | Best ecosystem for the transcript-editing and review UI, which is most of the app's surface. |
| Architecture | Staged pipeline with enforced evidence anchoring | Makes "never invent" a mechanical guarantee rather than a prompt instruction. |
| MVP export | Markdown + JSON | Jira and Confluence become publisher plugins behind a stable interface. |

### Why not a single-pass LLM extraction

A single prompt (transcript in, requirements out) is far cheaper to build, but the
"never invent" rule would exist only as prompt text. There would be no mechanical way
to distinguish a requirement the client stated from one the model supplied because it
knows what a login flow usually needs. One fabricated requirement discovered by a BA
destroys trust in all of them. This approach fails the core requirement and was
rejected.

### Why not a conversational co-pilot

Flexible and pleasant to use, but produces no structured artifact, no approval gate,
and no audit trail. Wrong shape for a compliance-sensitive deliverable.

## Architecture

```
┌─ LOCAL ONLY ──────────────────────────────────────────────┐
│  1. Capture      file import | mic | (P2: WASAPI loopback) │
│                  → normalized 16kHz mono WAV + consent rec │
│  2. ASR          whisper.cpp sidecar → timestamped segments│
│  3. Editor       correct · label speakers · REDACT · FREEZE│
└──────────────────────── ▼ BA approves transcript ─────────┘
                          │   (nothing crosses before this)
┌─ CLOUD-TOUCHING ────────▼─────────────────────────────────┐
│  4. Pipeline     staged runner, resumable, per-stage typed │
│  5. Grounding    deterministic quote validator (NO LLM)    │
│  9. LLM Client   Claude API + egress log                   │
└───────────────────────────────────────────────────────────┘
┌─ LOCAL ONLY ──────────────────────────────────────────────┐
│  6. Store        SQLite: identity, status, audit           │
│  7. Review UI    4-bucket workspace + approval gate        │
│  8. Export       Publisher interface → Markdown, JSON      │
└───────────────────────────────────────────────────────────┘
```

Three boundaries carry the safety properties:

**Module 3 is the egress boundary.** Redaction lives here. "Freeze" hashes the
transcript (SHA-256), and every downstream claim offset refers to that frozen text.
Editing a frozen transcript bumps its version and mechanically marks dependent
artifacts `stale`, so what was approved and what was analyzed cannot silently diverge.

**Module 5 contains no LLM call.** It is ordinary string matching. The
anti-hallucination guarantee must not itself depend on a model behaving well.

**Module 9 writes an egress log** — every payload sent to Claude is recorded locally,
so "what did you send to an AI service?" is answered with a file.

### Modules

1. **Capture** — file import (m4a/wav/mp3/mp4), mic recording, typed/pasted notes.
   Normalizes to 16 kHz mono WAV via ffmpeg. Records a consent acknowledgement with
   timestamp and note before any recording starts.
2. **ASR** — whisper.cpp as a per-platform sidecar binary. Emits segments with
   `{id, startMs, endMs, text, confidence}`. Progress events to the UI.
3. **Transcript Editor** — segment-level text correction, manual speaker labelling,
   PII redaction (marked spans replaced before any egress), and freeze.
4. **Analysis Pipeline** — stage runner with typed inputs/outputs, per-stage
   persistence and resumability.
5. **Grounding Validator** — deterministic quote-to-transcript matching.
6. **Project Store** — SQLite. Identity, status lifecycle, cross-session linking, audit.
7. **Review & Approval UI** — four-bucket workspace with a permanent evidence panel.
8. **Export** — `publish(snapshot: ApprovedSnapshot): Promise<PublishResult>`.
   MVP publishers: Markdown, JSON.
9. **LLM Client** — Claude API with structured outputs, retries, token accounting,
   cost display, egress log.

## Data model

```
Project ──< Session ──< AudioSource
                   └──< Transcript(version, contentHash, frozenAt) ──< Segment

Session ──< Claim { quote, segmentId, charStart, charEnd,
                    kind: requirement|assumption|ambiguity,
                    status: candidate|validated|quarantined }

Project ──< Requirement { statement, status, originClaimIds[], supersedesId }
        ──< Story { asA, iWant, soThat, requirementIds[] } ──< AcceptanceCriterion
        ──< OpenQuestion { category, status: open|asked|answered|closed }
        ──< Recommendation { category, rationale, status }
        ──< ApprovalEvent { entityType, entityId, action, contentHash, at }
        ──< EgressLog { sessionId, stage, requestHash, tokens, at }
```

Entity fields of note:

- `Project.domain` (required, one line) and `Project.regulatoryContext`
  (`GDPR | HIPAA | PCI-DSS | SOC2 | none`).
- `AudioSource.consentAcknowledgedAt`, `consentNote`.
- `Requirement.origin` — `client-stated | ba-authored`.
- `AcceptanceCriterion.source` — `client-stated | derived`.

Three details doing real work:

- **`Claim.status = quarantined`** — claims whose quotes fail validation are not
  deleted; they are quarantined and visible to the BA. Hallucination becomes an
  inspectable list rather than a silent event, and the quarantine rate is the primary
  signal for prompt or model regressions.
- **`AcceptanceCriterion.source`** — an AC the client stated is a different object
  from one the tool inferred, and no export may blur them.
- **`ApprovalEvent.contentHash`** — approval attaches to *content*, not to a row ID.
  Editing an approved requirement breaks its hash and drops it out of `finalized`.

## Pipeline stages

### Stage 0 — Chunk & window (deterministic)

Windows of ~2,000 words with ~200 words of overlap, split only on segment boundaries.
Each window carries its segment IDs so anchoring survives chunking. A 90-minute
meeting is ~12k words; that fits in context, but single-shot extraction over it
degrades quietly — thorough early, skimming later.

### Stage 1 — Claim extraction (LLM, structured output)

Per window, emit atomic claims:

```json
{ "quote": "verbatim span", "segmentId": "s_142",
  "statement": "normalized restatement", "speakerRole": "client" }
```

**The model does not emit character offsets.** Models count characters badly, and
asking for offsets invites plausible fabricated numbers that would pass a naive
validator. The model emits only the quote text and a segment ID; the validator
computes offsets itself by searching. Never ask the model for the thing you intend
to verify with.

### Stage 2 — Grounding validation (no LLM — this is the guarantee)

For each claim, in order:

1. Normalize whitespace and case on both sides.
2. Exact substring search within the named segment → hit: record offsets, `validated`.
3. Miss → widen to the full window → hit: correct the segment ID,
   `validated (segmentCorrected)`.
4. Still miss → **token-level Levenshtein ratio** (word tokens, not characters, so
   dropped filler words cost one edit each rather than several) against every
   candidate span of the window.
   **≥ 0.90 → `validated (fuzzy)`. Below → `quarantined`.**

Fuzzy matching is permitted deliberately. Models silently strip disfluencies —
"um, we'd, uh, want approvals" returns as "we'd want approvals." Exact-match-only
quarantines legitimate claims at a rate high enough that BAs stop reading the
quarantine list, and a safety control nobody reads is not a safety control. The 0.90
threshold absorbs disfluency-stripping while rejecting invention, which does not
score near 0.90 against real text.

Quarantine rate is a tracked metric.

### Stage 3 — Classification (LLM + deterministic guard)

Each validated claim becomes exactly one of `requirement` / `assumption` / `ambiguity`.

The failure mode is treating hedged speech as commitment. "We'd probably want manager
approval" is an assumption, and models are eager to promote it. A deterministic
hedge-lexicon pre-pass (*probably, I think, usually, might, typically, I assume,
something like*) **forces** `assumption` when hedge markers appear in the quote,
overriding the model's classification.

### Stage 4 — Cross-claim reconciliation (project-wide)

- **Contradictions** — an LLM pass over the project's validated requirement claims,
  pairwise within topic clusters rather than full cross-product. Both sides are
  retained with both quotes, a `contradiction` record is created, and an OpenQuestion
  is auto-raised. Never auto-resolved; the tool has no basis for choosing which
  client statement was correct.
- **Cross-session linking** — new claims matched against existing project
  requirements as `confirms` / `refines` / `supersedes` / `contradicts`. Proposed,
  never auto-applied.

### Stage 5 — Requirement synthesis

Validated `requirement` claims become `Requirement(status=proposed)`, restated in
testable form. `originClaimIds` is non-empty as a schema constraint — a requirement
with no origin claim fails the stage rather than logging a warning. There is no code
path that produces an unsourced requirement.

### Stage 6 — Story synthesis

Requirements become stories with acceptance criteria. This is where invention creeps
in: the model knows what a login story's ACs usually look like.

ACs traceable to the requirement's own claims are `source=client-stated`. Anything
added for completeness is `source=derived` **and must simultaneously emit an
OpenQuestion** whenever it encodes an unmade decision — a derived AC stating
"records retained 30 days" forces *"Is 30 days the correct retention period? Not
stated by client."* Derived ACs are visually distinct in the UI and labelled in
every export.

### Stage 7 — Critique panel (4 reviewers, parallel)

Each reviewer's output schema contains only `OpenQuestion` and `Recommendation`
types. **There is no field in which a requirement can be expressed** — even a
maximally helpful model cannot author one here, because there is nowhere to put it.

| Reviewer | Looks for |
|---|---|
| Domain completeness | Missing entities, lifecycle states, roles, volumes, integrations, failure paths |
| Security & privacy | AuthN/AuthZ, PII classes, retention, encryption, audit trail, data residency |
| Compliance | Driven by `Project.regulatoryContext` |
| Testability & edge cases | Vague ACs, unbounded inputs, concurrency, empty/max states, error paths |

Compliance is config-driven. With `regulatoryContext = none`, it asks generic
data-protection questions and stops — it does not infer a jurisdiction.

### Stage 8 — Assembly

Merge into the four buckets, attach evidence, persist, mark session `awaiting-review`.

## Minimum required inputs

**Hard requirements** — the pipeline refuses to run without them:

- A frozen transcript or pasted notes of **at least 200 words** (below that,
  extraction is noise); the pipeline hard-blocks rather than warning
- Project name
- **Project domain, one line** — e.g. *"B2B freight invoicing for EU logistics operators"*

The domain line is non-negotiable. Without domain context the completeness reviewer
either emits generic filler or infers a domain from fragments — precisely the
invention the tool exists to prevent. It is the highest-leverage input in the system.

**Warned if missing:** regulatory context, system/product name, stakeholder roles present.

**Optional:** domain glossary (materially improves extraction on jargon), prior
sessions (automatic).

## Review and approval flow

Three panes: bucket nav with counts, item list, and a permanently visible **evidence
panel** showing the verbatim quote in context with click-to-play audio jump. A BA
should never have to take the tool's word for anything.

Each bucket gets different affordances because the risk profile differs.

**Confirmed requirements** — Approve / Edit & approve / Split / Reject with reason.
Approval writes an `ApprovalEvent` with the content hash.

**Assumptions** — an assumption cannot become a requirement in one click. Promotion
requires a *verification note* recording how it was confirmed and with whom (client
email, follow-up call, SME sign-off). The default action is "convert to open question."

This friction is intentional. Grounding stops outright invention, but the remaining
laundering path is: model hedges something into an assumption → BA clicks through in
a hurry → it becomes a client requirement. Requiring the BA to type how they verified
it makes that a conscious act.

**Open questions** — `open → asked → answered → closed`, with one-click export of the
question list for a client email. **Recorded answers are fed back as a typed-note
session on the next pipeline run**, attributed to the client, so client answers become
quotable, anchored claims exactly like meeting speech. This is how the loop closes.

**Recommendations** — Accept → becomes an open question to the client (default). Or
*Accept as requirement*, which requires the BA to write the statement themselves;
recorded as `origin=ba-authored` and labelled in every export. Decline requires a
reason and is retained.

**Finalization gate.** Finalization happens at two levels, and they mean different
things:

- **Session finalization** is the review checkpoint. A session reaches `finalized`
  only when every item *that session raised* is dispositioned, every contradiction it
  surfaced is resolved, every derived AC it produced is reviewed, and its quarantine
  list is acknowledged. The UI shows *"4 items blocking finalization"* with jump links
  rather than a disabled button.
- **`Requirement.status = finalized`** is per-requirement and project-scoped. It is
  set by BA approval and survives across sessions until superseded. The exported
  requirements baseline is the set of project requirements currently in `finalized`,
  which is why it spans sessions rather than belonging to one.

A later session can move an already-finalized requirement back to `proposed` by
superseding it. That is a normal event, not an error, and the export shows both the
superseding requirement and the one it replaced.

## Output format

Markdown for humans, JSON for machines, generated from one snapshot so they cannot
diverge.

```markdown
# Nordic Freight — Requirements Baseline
Sessions 1–4 · Approved by T. Sarathchandra · 2026-08-05
Transcript hashes: a3f19c…, 7b2e04… · Model: claude-opus-5

## 1. Confirmed Requirements

### REQ-014 — Manager approval for invoices over €10,000
**Status:** Finalized · approved 2026-08-05
**Source:** Session 2 @ 12:04 — *"anything over ten thousand euro has to go
to a manager, no exceptions"*

## 2. User Stories

### US-007 — Invoice approval routing
As a finance clerk, I want invoices over €10,000 routed to a manager,
so that high-value spend has a second pair of eyes.
**Implements:** REQ-014, REQ-015

Acceptance criteria:
- `[client-stated]` Given an invoice of €10,001, when submitted,
  then it is routed to the manager approval queue
- `[DERIVED — UNCONFIRMED]` Given the manager has not responded in 48h,
  then the invoice escalates to the finance lead → see **OQ-021**

## 3. Assumptions — NOT client-confirmed

### ASM-003 — All invoices are denominated in EUR
**Basis:** Session 1 @ 08:31 — *"we'd usually be dealing in euro"* (hedged)
**Verification:** none recorded
**Risk if wrong:** multi-currency changes the data model and rounding rules

## 4. Open Questions

| ID | Question | Category | Raised | Status |
|----|----------|----------|--------|--------|
| OQ-021 | What happens if the approving manager doesn't respond within 48h? | domain | S2 | Open |
| OQ-024 | Is an immutable audit trail required for approval actions? | security | S3 | Asked |

## 5. Recommendations — tool-generated, not client requirements

### REC-009 `[security]` Approval actions need an immutable audit trail
**Rationale:** financial approval workflow with no audit mechanism discussed
**Status:** Accepted → raised as OQ-024

## Appendix A — Quarantined extractions (n=3)
Statements produced during analysis that could not be matched to any
transcript text. Excluded from all output above. Listed for transparency.

## Appendix B — Provenance
Session durations · transcript hashes · ASR model · LLM model versions ·
egress log summary (12 requests, 184k tokens sent)
```

The format does five things deliberately:

1. **Every confirmed requirement carries a verbatim quote and timestamp**, including
   requirements the BA edited — the edit is shown against the original quote.
2. **Derived ACs are marked inline and linked to the question they raise**, so a
   developer knows exactly which criteria the client stated.
3. **Section 5 is titled "not client requirements"** — the document must survive being
   forwarded to someone who was not in the room and skims headings.
4. **Appendix A publishes the tool's own failures.** A document showing what it
   rejected is more credible than one that quietly succeeded, and it gives the BA a
   standing reason to check the quarantine list.
5. **Appendix B is the compliance artifact** — what was processed, by which models,
   and what left the machine.

The JSON export mirrors this exactly, versioned with `$schema`, and **is the input
type every publisher consumes.** Markdown, Jira, and Confluence are all
`publish(snapshot)` implementations, which is what makes Jira and Confluence a
Phase 2 costing days rather than a rewrite.

## MVP scope

| Module | MVP | Deferred |
|---|---|---|
| Capture | File upload + mic recording + typed/pasted notes | System audio loopback |
| ASR | whisper.cpp sidecar, `small`/`medium`, English | Diarization, multi-language |
| Editor | Segment edit, manual speaker labels, redaction, freeze | — |
| Pipeline | All 9 stages | — |
| Grounding | Full validator | — |
| Store | SQLite, projects, cross-session linking | — |
| Review UI | 4 buckets, evidence panel, approval gate | — |
| Export | Markdown + JSON | Jira, Confluence, DOCX |

**System audio loopback is Phase 2.** Mic recording is cheap in Electron
(`MediaRecorder`, roughly a day). Loopback is a native addon written twice — WASAPI
on Windows, ScreenCaptureKit on macOS — with its own permission and OS-version
matrix. Teams and Zoom already produce recordings BAs can upload today. Real value
at a bad exchange rate for a first release.

**Diarization is Phase 2.** whisper.cpp's speaker separation is weak, and doing it
properly means pyannote — a Python runtime, a second model, a heavier install.
Manually labelling speaker blocks takes a BA a couple of minutes per meeting and is
more accurate.

**Phase 2:** system audio loopback, Jira publisher, Confluence publisher,
diarization, glossary management.

**Phase 3:** DOCX export, multi-language ASR, fully-offline mode via a local LLM.

**Explicitly not building:** live transcription during the call (streaming ASR is a
different engineering problem and competes with the meeting for the BA's attention),
meeting-platform bots, story point estimation.

### Build order — front-load the risk

```
1. Store + data model
2. Pipeline + grounding validator   ← driven by PASTED TEXT ONLY, no audio,
                                       CLI-invoked, run against real transcripts
3. Review UI + approval gate
4. Export (Markdown + JSON)
5. ASR + transcript editor
6. Capture (upload → mic)
```

**Audio comes last.** The riskiest unknown is not "can we record a meeting" — that is
solved technology. It is "does staged extraction with enforced anchoring produce
requirements a BA trusts more than their own notes?" That is answerable at step 2
using existing transcripts, for a small fraction of the budget. Building capture
first would teach nothing about it.

## Error handling

**ASR** — ffmpeg probes and rejects corrupt or silent files before spending 25
minutes on them. The `medium` model runs ~0.3–0.5× realtime on CPU, so a 60-minute
meeting is a 20–30 minute background job with an ETA, persisted state, and survival
across app restart. Sidecar crash retries once, then offers a smaller model.

**LLM** — 429s get exponential backoff. Malformed structured output is
schema-validated and retried with the validation error appended (max 2 attempts),
then the stage is marked `failed` with the raw response preserved for inspection.
Stages checkpoint independently, so failure resumes from the last good stage rather
than re-running the whole pipeline, which costs real money. Token spend is estimated
before the run and shown; above a configurable threshold it requires confirmation.

**Data integrity** — editing a frozen transcript bumps the version and marks
dependents `stale` with a banner. Editing an approved item breaks its content hash,
dropping it out of `finalized` and requiring re-approval. Single-instance lock, since
two windows over one SQLite file is an avoidable class of bug.

**The empty case** — a status call or small-talk transcript must produce *"no
requirements found"*, not three invented ones. This is an explicit test case; it is
the most likely place for a model to be helpfully wrong.

## Testing

The grounding validator is deterministic, so the component carrying the central
safety property is fully unit-testable. That shapes the strategy: TDD for the
deterministic components, fixture-based regression evaluation for the LLM stages.

1. **Validator unit tests (TDD)** — exact match, whitespace and case variance,
   disfluency stripping, similarity at 0.89 vs 0.91, fabricated quote, quote spanning
   segments, smart quotes and unicode, empty quote. This suite is the safety net for
   the entire product.

2. **Golden transcript fixtures** — 5–8 anonymized real transcripts with hand-labelled
   expected output. Assertions: recall of known requirements, **hallucination rate
   (target: zero)**, hedge-classification accuracy, quarantine rate within a normal band.

3. **Adversarial fixtures**, built to induce invention:
   - Transcript mentions "login" and nothing else → must not emit password-complexity
     requirements
   - Explicit contradiction → both sides survive, unresolved
   - Pure small talk → emits nothing
   - **BA asks a leading question — *"so you'd want manager approvals, right?"* — and
     the client answers "mm"** → must not become a requirement

   The last is the nastiest real-world case in the set. It is how requirements get
   fabricated in practice, by humans as much as by models.

4. **Schema conformance** — assert that critique reviewer output schemas contain no
   field capable of expressing a requirement. The structural control gets its own test.

5. **Export snapshot tests** — stable Markdown/JSON for a fixed input snapshot.

6. **Fixtures run as a regression gate before any model version change.** You cannot
   TDD a model, but you can regression-test one, and model upgrades are the most
   likely source of a silent quality regression.

## Summary of safety controls

Four independent mechanisms enforce "never invent client details," none of which
relies on a model following instructions:

1. **Deterministic grounding validation** — a claim whose quote does not appear in the
   frozen transcript is dropped before a human sees it.
2. **Type-constrained critique stages** — reviewers have no schema field in which a
   requirement can be expressed.
3. **Non-empty `originClaimIds` as a schema constraint** — no code path produces an
   unsourced requirement.
4. **Verification-note friction on assumption promotion** — the human laundering path
   requires a conscious, recorded act.

Plus one transparency mechanism: **the quarantine list is published**, making
model invention visible and measurable rather than silent.
