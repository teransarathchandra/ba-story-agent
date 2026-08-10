# 06-salon-booking — local semantic pre-fix baseline (2026-08-10)

**Status: promoted snapshot — INVALID coverage, and that invalidity IS the
finding.** A manually-promoted copy of an `.eval-runs/` artifact
(gitignored by design). Zero cloud/API calls, zero DB access (evaluated
against the frozen candidate snapshot, not the live Electron SQLite DB —
see "Input provenance" below). One genuinely independent local judge
(Llama 3.2 3B), never the same model as the local Qwen2.5-7B generator.

**This is not a quality score for the pipeline.** Only 8 of 12 planned
local-judge calls ever produced a usable result; the remaining evidence
batches were never attempted once the first one failed twice. Per the
explicit design rule this run was run under — *headline semantic metrics
are only computed if all 12 batches pass coverage* — none were computed.
`metrics: {"invalid": true, ...}`, exactly as designed, is the correct and
complete result of this run.

## Input provenance

- **Candidate snapshot:** `tests/fixtures/golden/06-salon-booking.candidates-snapshot.json`
  (snapshotId `9158e54c-dac5-4226-9efc-e59a92fabd4c`), extracted
  2026-08-10T06:13:56.910Z, self-verified on load (`candidateContentSha256`
  checked against a fresh hash of its own content).
- **Source:** project `prj_01KZK7G0RMBQZD0W6QEWCB80WB` / session
  `ses_01KZK7GDZNQ9FQ5ERAXN6M4MJT`, source DB hash at extraction
  `2fa39d635433f42e4ee433f1be3df31f96312542f0954b06a2760093521c4afc`.
  Generator: local Qwen2.5-7B-Instruct-Q4_K_M (read from the session's own
  `egress_log` at snapshot-creation time, never asserted).
- **31 candidates** — 5 requirements, 21 questions, 5 assumption claims.
  Mechanically verified byte-for-byte identical (by ID + bucket + text +
  quote, not counts) against both the earlier deterministic-only baseline
  and a fresh live-DB read taken the same day: there was no real candidate
  drift between those two prior artifacts to reconcile. (A prior status
  update in this thread said "30 candidates / 20 questions" — that was a
  miscount in a prose summary, not a real second data state; both prior
  artifacts already had all 21 questions.)
- **Zero DB access for this run.** `run-candidate-snapshot.ts` never opens
  the DB at all — the snapshot carries everything needed (candidates,
  generator identity, provenance). This is the reproducibility property
  the snapshot exists for: rerunning this exact benchmark later never
  depends on whatever the live Electron app happens to have persisted that
  day.

## What ran

- Judge: `hf:bartowski/Llama-3.2-3B-Instruct-GGUF/Llama-3.2-3B-Instruct-Q4_K_M.gguf`,
  `EVAL_JUDGE_CONTEXT_SIZE=8000` (measurement-justified — see the prior
  turn's prompt-size measurement: largest real prompt was 3,463 measured
  input tokens, comfortably inside 8000 with output headroom).
- 8 correspondence batches (5 gold items each, last one 3) × ALL 31
  candidates each. 4 evidence batches planned (10/10/10/1 candidates).
- Two independent runs of this exact benchmark were performed (the second
  after adding raw-response capture — a code change, not a config change,
  so per-batch cache keys were unaffected). The 8 correspondence batches
  and their one retry were served from cache on the second run — genuinely
  reused, not recomputed, confirmed by the console log showing 8/8 "cache
  hit, skipping call" lines.

## Per-batch diagnostics (real measured, not estimated)

**Correspondence (8 batches, all eventually valid):**

| batch | attempt | input tok | output tok | latency | coverage |
|---|---|---|---|---|---|
| 1/8 REQ-01..05 | 1 | 3364 | 46 | 8.7s | valid |
| 2/8 REQ-06..10 | 1 | 3301 | 331 | 16.6s | valid |
| 3/8 REQ-11..15 | 1 | 3300 | 32 | 7.9s | valid |
| 4/8 REQ-16..20 | 1 | 3310 | 696 | 27.7s | valid |
| 5/8 REQ-21,UNR-01..04 | 1 | 3463 | 520 | 23.1s | **invalid** (malformed reviewedGoldIds + 2 hallucinated generatedItemIds, one a near-miss truncation of a real id) |
| 5/8 (retry) | 2 | 3463 | 55 | 9.5s | valid |
| 6/8 UNR-05..09 | 1 | 3309 | 48 | 8.9s | valid |
| 7/8 UNR-10,ASM-01..03,RULE-01 | 1 | 3333 | 46 | 9.0s | valid |
| 8/8 RULE-02..04 | 1 | 3160 | 34 | 8.1s | valid |

Process RSS stayed flat at 3.16–3.28GB across every correspondence call —
no growth trend, no evidence of context/KV-cache accumulation across the
sequence of calls sharing one loaded model. 7/8 batches passed on the
first attempt; 1/8 needed and got its one allowed retry, which succeeded
cleanly.

**Evidence (1 of 4 batches attempted, twice, across two independent runs — never passed):**

| run | attempt | input tok | output tok | latency | result |
|---|---|---|---|---|---|
| 1st | 1 | 1496 | 61 | 5.2s | invalid — all 10 entries missing (near-empty response) |
| 1st | 2 (retry) | 1496 | 488 | 17.5s | invalid — 2 hallucinated fabricated IDs (e.g. `req_06YZZFRD3PG8D8BF85V4YBQZC`, not close to any real id), all 10 real ids still missing |
| 2nd | 1 | 1496 | 48 | 4.6s | invalid — raw response was a literal empty `generatedEvidence: []` |
| 2nd | 2 (retry) | 1496 | 1058 | 32.3s | invalid — this time substantive, well-reasoned content for every real id, but 2 of the 10 (`oqn_...YPH93`, `oqn_...YCKYDR` — the first two candidates in the batch) each appeared **twice**, for 12 total entries against 10 expected |

Evidence batches 2–4 were never attempted (correctly, by design — the run
is already invalid, so no further local compute was spent on it).

## Runtime finding, not a context-size problem

Nothing here looks like context accumulation: input tokens were flat
(1496, identical across all 4 evidence attempts, as expected since the
prompt content didn't change), RSS was flat, and latency didn't trend
upward across the sequence. What's visible instead is a **task-shape
capability limit**: this 3B model handled the correspondence task
(mostly terse "no relationship found" responses, judged against 5 gold
items) far more reliably than the evidence task (a flat 10-item
enumeration each requiring a longer natural-language `reason` string) —
7/8 correspondence batches succeeded immediately; the one evidence batch
attempted failed all 4 independent tries, in 3 different specific ways
(empty, hallucinated, duplicated), never once as a coverage-timeout or
truncation. The duplicate-heavy attempt (1058 output tokens, well under
the 8000 context ceiling) suggests the model loses track of which ids
it's already covered partway through a long individual-reasoning list,
not that it ran out of room.

Per instruction, this finding is reported, not acted on: no prompt,
schema, retry-count, or batch-size change has been made in response to
it. `EVAL_JUDGE_CONTEXT_SIZE` was not raised.

## Deterministic checks (unaffected by the above — judge-independent)

**Unsupported-detail violations (3):** `UDC-03` "drop-down" (`clm_...60M`),
`UDC-04` "data residency" (`oqn_...425CK`), `UDC-05` "change in ownership"
(`oqn_...425CP`) — identical to the earlier deterministic-only baseline,
as expected (same 31 candidates).

**Already-answered-question violations (1):** `AAQ-01` "How many
branches..." (`oqn_...VGTW`) — same as before.

## Raw responses preserved

Every attempt's raw pre-parse text, usage, latency, and coverage result is
preserved in the companion JSON's `rawBatchAttempts[]` (second run only —
the first run predates that capture being added, see the code history).
`judgeMatchTable` is `null` — by design, a terminally-failed batch never
produces partial match data that could be mistaken for a real result.

## Relationship to the existing deterministic-only baseline

`06-salon-booking-deterministic-baseline-2026-08-09.{json,md}` is
**preserved unchanged** — it was built from this exact same 31-candidate
set (mechanically confirmed, not assumed) and made zero judge calls by
design (`skipJudge: true`), so nothing about this run's judge outcome
affects its validity or scope. That file remains the reference for "what
the deterministic checks show," independent of judge availability. This
file adds "what the local semantic judge shows" — which, for this run, is
an honestly-reported INVALID, not a fabricated score.
