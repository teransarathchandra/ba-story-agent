# 06-salon-booking — deterministic-only baseline (2026-08-09)

**Status: promoted snapshot.** A manually-promoted copy of an
`.eval-runs/` artifact (which is gitignored by design — see the gold-eval
harness design doc, §9/§8). This one is worth keeping under version
control because it's the first measurement taken against the exact
persisted output the original manual critique (the one that identified
the dropdown hallucination, the "authenticated vs. authorized" mixup, the
"mark no-show" → "audit no-shows" inflation, and the already-answered
branch-count question) was based on — a fixed point to compare later runs
against once the pipeline actually changes.

## What this is

- **Source run:** `docs/superpowers/benchmarks/06-salon-booking-deterministic-baseline-2026-08-09.json`
  — full artifact, unedited copy of `.eval-runs/06-salon-booking/900614e0-2d42-4cdd-ad62-45e0db662ab9.json`.
- **Generator:** the real Electron app's **local** backend
  (`hf:bartowski/Qwen2.5-7B-Instruct-GGUF/Qwen2.5-7B-Instruct-Q4_K_M.gguf`),
  **not Claude**.
- **Session:** `ses_01KZK7GDZNQ9FQ5ERAXN6M4MJT` / project
  `prj_01KZK7G0RMBQZD0W6QEWCB80WB` ("Teaching" / "Daily Scrum"), pipeline
  ran 2026-08-09T12:21:06Z–12:28:24Z. Its transcript was verified
  byte-for-byte identical to the frozen `06-salon-booking.txt` fixture
  modulo exactly one trailing newline (a file-save artifact, not a
  dialogue difference) — see the conversation history around this
  snapshot's creation for the exact verification method
  (`hashText()` comparison via the real `better-sqlite3` driver, not
  shell redirection).
- **Recovered, not regenerated.** Produced via
  `scripts/eval/run-existing-session.ts` against the real app's own
  SQLite database, opened strictly read-only — `analyzeSession()` was
  **not** re-run. Confirmed the source DB file's mtime/size were
  unchanged before and after.

## What ran, and what didn't

**Zero external model calls in this snapshot.** Only the two hard
deterministic invariants ran (`unsupportedDetailChecks`,
`answeredQuestionChecks` — regex-based, no LLM). The semantic judge was
never invoked; every judge-dependent metric (#1 recall, #2 taxonomy
accuracy, #3 requirement precision, #4 cross-category exclusivity, #5
duplicate rate, #6 evidence fidelity, #7 meeting-state resolution, #10
grounded-vs-novel questions, plus the `ungroundedEquivalent` diagnostic)
is `{"skipped": true, "reason": "judge not requested for this run
(deterministic-only invocation)"}` in the artifact — explicitly marked,
not silently absent.

## What this snapshot already shows

5 requirements, 21 questions, 5 assumption claims.

**Unsupported-detail violations (3):**
- `UDC-03` — "drop-down" (assumption claim `clm_...60M`)
- `UDC-04` — "data residency" (question `oqn_...425CK`)
- `UDC-05` — "change in ownership" (question `oqn_...425CP`)

**Already-answered-question violations (1):**
- `AAQ-01` — "How many branches..." (question `oqn_...VGTW`) — the exact
  branch-count re-ask flagged in the original manual critique.

**`UDC-01`/`UDC-02` did not fire** — not because the pipeline didn't
hallucinate a no-show grace period or a "sales representative" role in
this run, but because the "sales representative" hallucination the
original critique found lived in a **recommendation**, and
`unsupportedDetailChecks` deliberately never scans the recommendations
bucket by default (design decision: a hallucinated detail is a violation
when presented as client-stated fact; the identical detail in an
explicitly AI-suggested recommendation is a different, not-yet-designed
metric). Worth rechecking directly if recommendation-bucket hallucination
scoring is ever added.

Also visible directly in `normalizedPipelineOutputs` (not flagged by any
automated check, found by reading the artifact): the "auditing mechanism"
inflation on `req_...E2H`, the "Custom customers booking..." wording bug
on `req_...ETY90`, "authenticated" used where the transcript's actual
constraint is about authorization on `req_...ETY91` (plus a doubled
trailing `""` in that same requirement's quote field — a real formatting
artifact, not touched here), and two assumption-claim rows
(`clm_...60H`, `clm_...60J`) both stating "the amount of existing customer
data is unknown" from two different quotes — an unreconciled near-duplicate
at the claim level.

## How to compare against this later

Once a semantic-judge baseline exists for the same session (one paid
call, `--with-judge`), or once the pipeline itself changes and a fresh
run is taken, diff the new artifact's `deterministicInvariantResults`
and (once available) `metrics` against this file's. The gold labels this
is scored against are frozen
(`tests/fixtures/golden/06-salon-booking.goldlabels.md`) — this snapshot
predates the gold-eval harness's semantic layer ever running, so it is by
definition a **pre-judge-baseline** artifact, not a post-fix or
post-judge one.
