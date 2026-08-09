# Gold-fixture eval harness — design (v4, approved — implementation follows)

**Status: approved.** Revises v3: corrects the precision/non-precision
math into a proper mutually-exclusive precedence partition instead of a
mismatched complement, confirms evidence-fidelity decoupling, removes
AAQ-02 (staff hours has a legitimate follow-up, unlike branch count),
narrows unsupported-detail checks to the grounded buckets only (never
`recommendation`), and adds explicit judge-response coverage accounting so
"forgotten" and "no match found" are never conflated. Implementation
proceeds directly from this version per the approval — no further design
round unless implementation surfaces a genuine architectural conflict.

## 1. Gold file — updated shape

```ts
interface DeterministicCheck {
  id: string;                 // e.g. "UDC-01", "AAQ-01"
  pattern: string;            // regex source, assertion-specific (see §6)
  rationale: string;          // human-readable — why this exact check exists
  bucketScope?: Array<"requirement" | "question" | "assumptionClaim" | "recommendation">;
  // omitted = the three GROUNDED buckets only (requirement, question,
  // assumptionClaim) — never recommendation by default. See §6.
}

interface GoldItem {
  id: string;
  category: "requirement" | "rule" | "unresolved" | "assumption"
          | "state" | "objective" | "scope";
  proposition: string;
  quotes: string[];
  meetingStateSensitive?: { mustNotReflect: string; mustReflect: string };
}

interface GoldFixture {
  fixtureName: string;
  transcriptFile: string;
  frozenMarkdownContentHash: string;  // sha256 of the .goldlabels.md file —
                                       // see §8 for how this is enforced
  items: GoldItem[];
  unsupportedDetailChecks: DeterministicCheck[];
  answeredQuestionChecks: DeterministicCheck[];
}
```

`positiveFacts`/`forbiddenPatterns` (free text, v2) are gone — replaced by
hand-authored `DeterministicCheck[]` arrays. No regex is auto-derived from
prose anywhere in this design (§6 explains why that was the wrong call).

## 2. Gold-category → output-bucket mapping (three tiers, unchanged from v2)

| Gold category | Expected/primary bucket | Tier | Recall (capture) scored? | Taxonomy (placement) scored? |
|---|---|---|---|---|
| `requirement` (21) | `requirements` | **PRIMARY** | yes | yes |
| `assumption` (3) | assumption-kind claims | **PRIMARY** | yes | yes |
| `rule` (4) | `requirements` (only bucket available) | **PROXY** | yes | no — reported `structurally-proxy` |
| `unresolved` (10) | `questions` (mixed bucket, §3) | **PROXY** | yes | no — reported `structurally-proxy` |
| `state` / `objective` / `scope` (14) | none | **UNSUPPORTED** | no | no |

**Supported gold denominator = 38. Structurally unsupported = 14 of 52**
(unchanged from v2) — never counted as a miss, never fake-matched.

The "expected bucket" column now exists purely for **placement scoring**
(§5), not for restricting where the judge is allowed to search — see §5,
that restriction is removed in this revision.

## 3. Unresolved Decisions vs. the mixed Questions bucket (unchanged principle, now cross-bucket-aware)

`questions` still mixes transcript-grounded unresolved decisions with
BA-suggested novel questions. A generated question captured
(`equivalent`, evidence `pass`) against a gold `unresolved` item counts
toward UNR recall; an unmatched one is a different analytical class
(metric #10), never penalized. Because matching is now cross-bucket
(§5), a gold `unresolved` item captured somewhere OTHER than `questions`
(e.g. surfacing as an assumption-kind claim instead) is now visible too —
reported as captured-but-misplaced, informational only, since `unresolved`
is PROXY-tier and gets no placement verdict.

## 4. Judge policy

Unchanged from v2 except one addition:

- **Default judge model must differ from the default generator model.**
  Verified against this repo: `AnthropicBackend`'s generator model constant
  (`src/llm/client.ts`) is `claude-opus-5`. The default `EVAL_JUDGE_MODEL`
  is pinned to `claude-sonnet-5` — a different model, so an out-of-the-box
  `LLM_BACKENDS=claude` benchmark run gets real, independent semantic
  scoring instead of tripping the self-judge `SKIPPED` rule by default.
  `EVAL_JUDGE_BACKEND` / `EVAL_JUDGE_MODEL` stay overridable; the
  independence check (§ same as v2) still compares actual resolved model
  identifiers at run time and still skips if they ever do collide (e.g. if
  someone explicitly reconfigures the judge to `claude-opus-5` too).
- Everything else — prompt/schema versioning, judge-unavailable → SKIPPED,
  one call per fixture per independent generator run, local-self-judge as
  a future diagnostic only — unchanged from v2.

## 5. Semantic-judge schema — cross-bucket, evidence fidelity fully decoupled, explicit coverage accounting

**Confirming v3's decoupling (unchanged, restated for clarity):**
`matches[]` never had `evidenceFidelity`/`evidenceFidelityReason` — that
lived only in `generatedEvidence[]` since v3. This stays exactly as
designed: `matches[]` judges semantic correspondence only,
`generatedEvidence[]` is the single source of truth for every candidate's
evidence fidelity (matched or not), and metrics join the two by
`generatedItemId`.

**New this round — explicit coverage accounting**, so "the judge forgot
this item" and "the judge found no match for it" are no longer
indistinguishable:

```ts
const GoldMatchSchema = z.object({
  matches: z.array(z.object({
    goldId: z.string(),
    generatedItemId: z.string(),
    generatedBucket: z.enum(["requirement", "question", "assumptionClaim"]),
    correspondence: z.enum(["equivalent", "partial", "contradicts"]),
    meetingStateViolation: z.boolean().optional(),
  })),
  unmatchedGoldIds: z.array(z.string()),
  // every one of the 38 supported gold IDs the judge explicitly found NO
  // correspondence for, to ANY generated candidate
  unmatchedGeneratedItemIds: z.array(z.string()),
  // every generated candidate ID the judge explicitly found NO
  // correspondence for, to ANY gold item
  generatedEvidence: z.array(z.object({
    generatedItemId: z.string(),
    evidenceFidelity: z.enum(["pass", "fail"]),
    reason: z.string(),
  })),
});
```

**Coverage validation, run in TypeScript immediately after the call, before
any metric is computed:**

```
matchedGoldIds        = unique goldId values in matches[]
matchedGeneratedIds   = unique generatedItemId values in matches[]
evidenceGeneratedIds  = generatedItemId values in generatedEvidence[]

assert matchedGoldIds ⊔ unmatchedGoldIds == allSupportedGoldIds   (exact union, no gaps)
assert matchedGoldIds ∩ unmatchedGoldIds == ∅                     (no overlap/double-report)
assert matchedGeneratedIds ⊔ unmatchedGeneratedItemIds == allSentGeneratedIds
assert matchedGeneratedIds ∩ unmatchedGeneratedItemIds == ∅
assert evidenceGeneratedIds (as a set, no duplicates) == allSentGeneratedIds
```

If any assertion fails, the judge's response is **structurally invalid**
for this run — a distinct status from `SKIPPED` (the judge ran, but its
own response is internally inconsistent or incomplete: it forgot an item,
double-reported one, or invented an ID that was never sent to it). This is
recorded in the audit artifact (§9) as `judge.coverageValid: false` plus
the specific `coverageErrors`, and every downstream metric that depends on
the match table reports `INVALID (judge coverage incomplete)` rather than
silently computing against partial data. One judge call, still — this adds
verification of that one call's completeness, not a second call.

**`categoryCorrect` is gone from the judge schema entirely** — it's now a
*derived* value, not something asked of the model: once a match exists,
`placementCorrect = (match.generatedBucket === expectedBucket(goldItem.category))`
is pure lookup in TypeScript against the §2 table. There's no case where
the judge's own opinion on "is this the right category" could disagree
with which array the eval script actually found the item in — asking for
it separately was redundant complexity in v2, and dropping it also removes
a subtle bug risk (v2 could have logged conflicting `categoryCorrect`
verdicts for the same generated item across different candidate gold
matches; a derived, bucket-based value can't be internally inconsistent).

**`generatedEvidence[]` covers every candidate exactly once,** independent
of whether it matched anything. This is what closes the gap you flagged:
a fully novel, unmatched generated item (no gold correspondence at all)
still gets its own citation checked — a fabricated or misattributed quote
on a completely invented item is now caught, not silently skipped because
nothing existed to compare it against.

**Search scope is now genuinely cross-bucket AND cross-category:** the
judge receives all 38 supported gold items (every category, not filtered
to an "expected" one) and every generated candidate from the three
grounded buckets (`requirements`, `questions`, assumption-kind claims —
recommendations/stories are excluded, since those are the AI-generated
analysis layer, not grounded extraction, per this project's own earlier
taxonomy-split principle). The judge just reports whatever real
`equivalent`/`partial`/`contradicts` relationships it finds, full stop —
all bucket-expectation and taxonomy-rule logic is applied afterward, in
code, against that raw result. This produces two genuinely separate
computed layers instead of one conflated one:

- **Semantic capture** — did gold item G correspond to *anything*,
  *anywhere*? (→ recall, §7 #1)
- **Placement / taxonomy** — given capture, which bucket did it land in,
  and does that match the expected one? (→ taxonomy accuracy, §7 #2)

This is what makes "a requirement missing entirely" distinguishable from
"a requirement that was captured but emitted as an assumption or question
instead" — the first is a recall failure, the second is a placement
failure, and v2 could not tell them apart.

**A useful side effect for requirement precision (§7 #3):** because
matching also spans gold categories, a generated *requirement* that
actually corresponds to a gold `unresolved` or `assumption` item (not
`requirement`/`rule`) is now distinguishable from one with no gold
correspondence at all. The first means the pipeline over-confidently
promoted a tentative or still-open client statement into a firm
requirement — a real, different failure mode from fabricating one from
nothing. Reported as a supplementary diagnostic (§7), not folded into the
three headline precision numbers you specified.

## 6. Hard deterministic invariants — hand-authored, assertion-specific

No regex is auto-derived from free text. Every check is a
`DeterministicCheck` written by hand into the `.gold.json`, each with an ID
and a rationale explaining exactly what it guards against — so a check
failing (or a false positive) is debuggable from the fixture file alone.

**Assertion-specificity, illustrated by the case you flagged:** "30
minutes" is legitimately mentioned in the transcript (Kevin: "Men's
haircut is 30 [minutes]" — STATE-adjacent context, an illustrative
duration example). A blanket forbidden-string check on "30 minutes" would
false-positive against that real content. The actual regression to guard
against is a specific *invented policy* — an automated no-show grace
period — not the bare number. Proposed check:

```json
{
  "id": "UDC-01",
  "pattern": "no.?show[^.]{0,60}(30|thirty)\\s*minutes?|(30|thirty)\\s*minutes?[^.]{0,60}no.?show",
  "rationale": "No-show grace period was never discussed in the transcript. Do not confuse with the legitimate men's/women's haircut duration examples (30/45 min, STATE-context) — this check targets the co-occurrence of 'no-show' with a specific minute count, not the bare number."
}
```

(no `bucketScope` given — see the default below.)

**Default scope for ALL `unsupportedDetailChecks`, and why `recommendation`
is never included:** when `bucketScope` is omitted, it now means the three
*grounded* buckets — `requirement`, `question`, `assumptionClaim` — never
`recommendation`. A detail like "dropdown" or "sales representative" is a
hallucination when it's emitted as if the client said it; the identical
detail showing up in a `recommendation` is a legitimate, explicitly
AI-suggested idea (recommendations are the AI-generated-analysis layer by
design, not a grounded-extraction claim) — flagging it there would be
conflating a real hallucination with ordinary recommendation noise, which
is a different, not-yet-designed metric. None of `UDC-01`..`UDC-05` scope
`recommendation` — this applies uniformly, not just to `UDC-01`.

**Not every item from the frozen markdown's old "Negative" list reduces
cleanly to a safe regex — honest inventory (all scoped to the grounded-
buckets default above, none include `recommendation`):**

Safe as hand-authored regex (no legitimate transcript mention to
false-positive against):
- `UDC-01` — invented no-show grace period (above).
- `UDC-02` — "sales representative(s)" (only Admin/Manager/Receptionist/
  Stylist exist, REQ-19).
- `UDC-03` — "dropdown" as the stylist-selection UI mechanism.
- `UDC-04` — data residency / multi-region / multi-country handling.
- `UDC-05` — branch ownership/management-change scenarios.

**Deliberately NOT regex-ified — better served by the semantic judge,**
because a precise pattern risks real false positives/negatives:
- Invented working-hours state-machine vocabulary ("configuring"/"active"/
  "saved" as formal states) — too easy to either miss a paraphrase or
  false-positive on an unrelated use of those common words.
- Multiple staff alerts/reminders before a change or cancellation — same
  reason; "multiple," "alert," "remind" are all common words that show up
  legitimately elsewhere in this transcript (reminder-*count*, per UNR-04,
  is a real gold topic).
- "Required" asserted on name/phone (the REQ-08 note) — "required" is used
  correctly dozens of times elsewhere in this transcript; forbidding the
  word itself would be far too broad. This one is caught by evidence
  fidelity instead: if a generated item claims name/phone are mandatory,
  its cited evidence (Kevin: "Name, phone number." / Sarah: "Okay, email
  can be optional.") doesn't actually establish that, so
  `generatedEvidence[...].evidenceFidelity` should read `fail`.

`answeredQuestionChecks` — only the facts the frozen markdown's "Positive"
list treats as genuinely, unconditionally settled with no legitimate
follow-up remaining. **`AAQ-02` (staff working hours) is removed**: the
transcript establishes "usually 9-6" but immediately qualifies it —
"different for some people," "days off," "plus leave" — so a question
asking for more schedule detail is a legitimate follow-up, not an
already-answered violation. Branch count/names has no such qualifier
anywhere in the transcript (Sarah: "Three currently." Nina names all
three, nobody revisits or complicates it) — that's the bar for inclusion
here, and only `AAQ-01` currently clears it:

```json
[
  {
    "id": "AAQ-01",
    "pattern": "how many branch|number of branch",
    "rationale": "3 branches (Colombo 5, Rajagiriya, Nugegoda) explicitly stated, never qualified or revisited.",
    "bucketScope": ["question"]
  }
]
```

Runs unconditionally, always reports (never `SKIPPED`) — unchanged from
v2. A single-item array is fine; more checks can be added later, each
individually justified against this same "no legitimate follow-up
remains" bar, not derived automatically from the markdown's "Positive"
list.

## 7. Metrics — corrected formulas

**§7a — Requirement precision, corrected.** v2's "unsupported rate" was
wrong to call itself the complement of precision: a generated requirement
whose only real match is to a gold `unresolved`/`assumption` item fails
strict precision but is genuinely grounded — it's misclassified, not
unsupported. Fixed by defining precision, its true arithmetic complement,
and then a proper partition of *that complement* into mutually exclusive,
precedence-ordered buckets that account for every failing item:

| Metric | Formula |
|---|---|
| **Strict requirement precision** | generated `requirements` with ≥1 match where `correspondence: equivalent`, gold category ∈ {`requirement`,`rule`}, AND `generatedEvidence[item].evidenceFidelity: pass` — divided by total generated `requirements` |
| **Non-precision rate** | `1 − strict precision`, exactly — the true complement, correct by construction (not a second independently-computed set that might not actually add up) |

The **non-precision set** (every generated requirement not meeting the
precision bar) is then partitioned into exactly one of these buckets each,
checked in this precedence order — mutually exclusive and exhaustive, so
every failing item lands in exactly one:

1. **Contradiction** — has ≥1 match with `correspondence: contradicts`
   against any gold item (checked first: asserting something false is more
   severe than a plain miss or misclassification, regardless of what else
   is also true about the item).
2. **Promoted-from-unresolved/assumption** — has ≥1 match with
   `correspondence: equivalent` AND `evidenceFidelity: pass` to a gold item
   in category `unresolved` or `assumption` (not `requirement`/`rule`).
   Flags a client's tentative or explicitly-open statement emitted as if
   it were confirmed — genuinely grounded, just miscategorized.
3. **Partial-only** — has ≥1 match with `correspondence: partial` (to any
   gold category) and doesn't already qualify for bucket 1 or 2.
4. **Completely unsupported/unmatched** — appears in `matches[]` zero
   times at all (present in `unmatchedGeneratedItemIds` instead, §5's
   coverage accounting confirms this is a real "no correspondence found,"
   not a judge omission).

Each bucket's count and rate (of total generated requirements) is printed
individually. They sum to exactly the non-precision count — this is
enforced by construction (the precedence order guarantees no item is
skipped or double-counted), not asserted after the fact.

**§7b — Full metric table:**

| # | Metric | Definition | Denominator |
|---|---|---|---|
| 1 | Gold-item recall | gold items (any of the 38) captured (`equivalent` + evidence `pass`) by ≥1 generated item, in ANY of the 3 grounded buckets | 38 supported (52 and 14-unsupported shown alongside) |
| 2 | Taxonomy accuracy — supported categories | of recalled PRIMARY-tier items (`requirement`, `assumption` only), fraction where `placementCorrect` (derived, §5) is true | recalled PRIMARY-tier count; PROXY-tier reported as its own `structurally-proxy` line |
| 3 | Requirement precision | strict precision + non-precision rate + its 4-bucket partition, §7a | see §7a |
| 4 | Cross-category exclusivity | gold items captured by generated items spanning ≥2 distinct buckets | violation count, listed |
| 5 | Duplicate rate | gold items captured ≥2 times within the SAME bucket | violation count, listed |
| 6 | Evidence fidelity | fraction of `generatedEvidence[]` entries with `pass` | total generated candidates (every item, matched or not) |
| 7 | Meeting-state resolution | gold items with `meetingStateSensitive` set where any match reports `meetingStateViolation: true` | count of sensitive items (currently 1: UNR-03) |
| 8 | Unsupported-detail violations | `unsupportedDetailChecks` hits, hard/deterministic | count, listed by check ID |
| 9 | Already-answered-question violations | `answeredQuestionChecks` hits, hard/deterministic | count, listed by check ID |
| 10 | Grounded vs. AI-generated separation | generated `questions`: captured (grounded) vs. uncaptured (novel, different analytical class, never penalized) | two counts |

Metrics 1-7 and 10 report `SKIPPED` under judge unavailability/non-
independence, and `INVALID (judge coverage incomplete)` if §5's coverage
validation fails. Metrics 8-9 always run regardless.

## 8. Markdown ↔ JSON drift validation — strengthened

Two layers, both `npm test`-tier, deterministic, no LLM:

1. **Content-hash gate (primary, required).** `frozenMarkdownContentHash`
   in the `.gold.json` must equal `sha256()` of the current
   `06-salon-booking.goldlabels.md` file content. Any edit to the
   markdown — including a wording fix that doesn't touch IDs — fails this
   check until the JSON is deliberately re-synced. This is intentionally
   strict: a forced re-touch on every markdown change is the point, not
   friction to route around, per the file's own frozen-governance note
   (§ from the previous round — any post-freeze change is a reviewed
   correction, not a quiet edit).
2. **Itemized parse-diff (secondary, runs as a debugging aid when #1
   fails).** Parses the markdown's table rows into `{id, category,
   proposition}` triples (same grep-based technique used for the earlier
   structural validation) and diffs them against the JSON's `GoldItem[]`
   entry by entry, printing exactly which IDs/fields differ. This turns
   "something drifted" into "REQ-14's proposition text differs" — worth
   doing, moderate effort (a small table parser), not free, but valuable
   enough to include now rather than defer.

ID-set equality (v1/v2's only check) is retained as a subset of #2, not
replaced.

## 9. Persisted audit artifact — updated shape

```ts
interface EvalRunArtifact {
  runId: string;
  timestamp: string;
  fixtureName: string;
  goldFixtureContentHash: string;      // sha256 of the .gold.json (which
                                        // itself embeds frozenMarkdownContentHash)
  generator: { backendLabel: string; model: string };
  judge:
    | { backendLabel: string; model: string; promptVersion: string; schemaVersion: string; coverageValid: boolean; coverageErrors: string[] }
    | { skipped: true; reason: string };
  normalizedPipelineOutputs: {
    requirements: Array<{ id: string; text: string; quote: string }>;
    questions: Array<{ id: string; text: string; quote: string }>;
    assumptionClaims: Array<{ id: string; text: string; quote: string }>;
  };
  deterministicInvariantResults: {
    unsupportedDetailViolations: Array<{ checkId: string; foundInItemId: string }>;
    alreadyAnsweredQuestionViolations: Array<{ checkId: string; questionId: string }>;
  };
  judgeMatchTable: z.infer<typeof GoldMatchSchema> | null;
  // { matches, unmatchedGoldIds, unmatchedGeneratedItemIds, generatedEvidence },
  // null iff judge skipped. Present-but-`coverageValid: false` iff §5's
  // coverage validation failed — metrics still report INVALID, not computed
  // against a table known to be incomplete.
  derivedPlacement: Array<{ goldId: string; generatedItemId: string; generatedBucket: string; placementCorrect: boolean | null }>;
  // null placementCorrect = PROXY-tier gold item, informational only
  derivedPrecisionBuckets: Array<{ generatedItemId: string; bucket: "passing" | "contradiction" | "promoted" | "partial-only" | "unmatched" }>;
  // one entry per generated requirement, per §7a's precedence partition
  metrics: {
    // §7b's 10 metrics + §7a's precision numbers + the supplementary
    // diagnostics, each either a computed value+denominator,
    // { skipped: true; reason: string }, or { invalid: true; reason: string }
  };
}
```

Retention: gitignored `.eval-runs/<fixtureName>/<runId>.json` by default,
manual promotion for specific snapshots you want checked in — confirmed,
unchanged from your decision last round.

Caching: unchanged from v2 — key = `sha256(goldFixtureContentHash +
sha256(normalizedPipelineOutputs) + judge.model + judge.promptVersion +
judge.schemaVersion)`.

## 10. Integration point (unchanged from v1/v2)

One conditional branch in `run-live-eval.ts`'s per-fixture loop; new logic
lives in `scripts/eval/gold-match.ts`; the 5 existing fixtures and their
regex `Expectation` path are untouched.

## Status: implemented

- `src/eval/gold-schema.ts` — GoldItem/GoldFixture/DeterministicCheck types + loader
- `src/eval/gold-sync.ts` — markdown-hash gate + itemized parse-diff
- `src/eval/gold-match-schema.ts` — judge response schema (matches[]/unmatchedGoldIds[]/unmatchedGeneratedItemIds[]/generatedEvidence[])
- `src/eval/gold-coverage.ts` — coverage validation
- `src/eval/gold-metrics.ts` — all 10 metrics + supplementary diagnostics
- `src/eval/gold-deterministic-checks.ts` — hard invariants (#8/#9)
- `tests/fixtures/golden/06-salon-booking.gold.json` — hand-encoded, verified byte-for-byte in sync with the frozen markdown
- `tests/eval/*.test.ts` — 46 unit/integration tests, all deterministic, no network calls
- `scripts/eval/gold-match.ts` — orchestration (judge call, caching, artifact)
- `scripts/eval/gold-report.ts` — console report formatter
- `scripts/run-live-eval.ts` — wired in as an additive branch; the 5 original fixtures untouched
- `.gitignore` — `.eval-runs/` added

411/411 tests pass, both packages typecheck clean. Not yet exercised against
a real judge call (that costs money and requires `ANTHROPIC_API_KEY` — first
live run is the user's call, via `npm run eval:live`).
