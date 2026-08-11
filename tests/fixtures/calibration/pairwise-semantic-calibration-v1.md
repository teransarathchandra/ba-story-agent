# Pairwise semantic calibration set v1

**Purpose:** an independent, hand-labeled acceptance test for a pairwise
semantic judge's *relation policy* (`equivalent | partial | contradicts |
none`) — deliberately unrelated to the `06-salon-booking` benchmark, its
transcript, its gold labels, or its candidate snapshot. Exists so a judge
prompt is calibrated against known-correct answers in a domain it cannot
have seen, never tuned directly against the benchmark it will later be
asked to judge.

**Frozen.** 24 pairs across e-commerce, HR, banking, logistics, and
project management (`pairwise-semantic-calibration-v1.json`). Do not add,
remove, or reword pairs to make a particular judge prompt pass — if the
set itself turns out to be wrong (a mislabeled pair, an ambiguous case),
fix it as an explicit, reviewed correction and bump to `v2`, the same
discipline the salon gold fixture uses.

## Why these 24

Directly targets the two failure modes observed in the salon-benchmark
pairwise probe (Llama 3.1 8B, single-gold-vs-single-candidate):

1. **Topical adjacency mistaken for partial overlap.** `partial` does NOT
   mean "these two statements are about the same subject." It means both
   statements express materially overlapping parts of the SAME underlying
   proposition, with one narrower, broader, or missing a load-bearing
   qualifier the other specifies. Two statements that merely share a
   business area or topic but assert different capabilities/rules must be
   `none`.
2. **A load-bearing qualifier silently dropped and called `equivalent`.**
   `equivalent` requires the important components of a proposition — actor,
   action, object, modality (must/can/should/may), constraint, and outcome
   — to be materially the same. A single missing or changed load-bearing
   qualifier (who may act, required vs. merely permitted, scope, automatic
   vs. manual, authentication vs. authorization) rules out `equivalent`.

10 pairs are marked `critical: true` — one for each of the difficult
qualifier dimensions named in the calibration request, in 1:1
correspondence: `CAL-09` (same-broad-topic-different-proposition),
`CAL-12` (authenticated-vs-authorized), `CAL-13` (can-vs-must), `CAL-14`
(customer-vs-staff), `CAL-15` (optional-vs-required), `CAL-16`
(manual-vs-automatic), `CAL-17` (one-branch-vs-all-branches), `CAL-18`
(view-vs-edit), `CAL-19` (suggestion-vs-automatic-action), `CAL-20`
(capability-vs-policy). The acceptance bar requires **zero** errors on
these specifically, distinct from the overall 22/24 bar.

## Acceptance criteria (for whichever judge model/prompt is being calibrated)

- At least 22/24 correct overall.
- Zero errors on the 10 `critical: true` pairs.
- Zero malformed structured-output responses.
- One call per pair, no retries — a retry-on-wrong-answer policy would
  hide a systematic semantic failure behind a lucky second draw.
- Confusion matrix reported, with particular attention to `none → partial`
  and `partial → equivalent` misclassifications (the two error directions
  actually observed against the salon benchmark).

## Relationship to the salon benchmark

This set exists purely to calibrate/freeze a judge *prompt contract*
before that same, unmodified contract is re-run against the salon
benchmark's own 8 known pairwise cases. Passing here is necessary but not
sufficient — the salon rerun (using the exact salon propositions, unlike
anything in this file) is the actual gate for whether Llama 3.1 8B is fit
to be the benchmark's authoritative semantic judge.
