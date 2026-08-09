# Gold labels — 06-salon-booking

**Status: FROZEN — canonical gold truth set for this fixture (2026-08-09).**
Passed structural validation (unique IDs, no duplicate headings, no stale
IDs, no dangling references, counts table matches actual unique counts) —
see the Dangling-reference check section below for the verification run.

**Governance rule, effective from freeze:** do not alter these labels to
make future pipeline scores look better. Any change to this file after this
point is an explicit, reviewed correction to the benchmark — it needs the
same reasoning and evidence discipline this document was built with, not a
quiet edit to close a gap the pipeline failed to meet.

No eval schema and no pipeline/prompt files have been changed as part of
building this fixture.

Fixture: `tests/fixtures/transcripts/06-salon-booking.txt` (2030 words, 5
named speakers: Maya=BA, Sarah=owner, Kevin=receptionist, Nina=ops manager,
Daniel=developer, plus one `Everyone:` line).

Taxonomy: Confirmed Requirement / Unresolved Decision / Assumption-Tentative
Statement / Business Rule-Constraint / Current State-Problem / Business
Objective-Success Criterion / Out of Scope.

## Final counts

| Category | Count |
|---|---|
| Confirmed Requirements | 21 |
| Unresolved Decisions | 10 |
| Assumptions / Tentative Statements | 3 |
| Business Rules / Constraints | 4 |
| Current State / Problem | 10 |
| Business Objectives / Success Criteria | 3 |
| Out of Scope | 1 |
| **Total gold items** | **52** |

## Review matrix

Evidence-type key: **DS** = directly stated, unhedged · **MT** = multi-turn
confirmed (proposal/restatement + explicit unhedged client "Yes/Correct/
Exactly/Agreed", or an explicit unhedged follow-up commitment) · **MSR** =
derived from meeting-state resolution (Maya explicitly declares tracking
status rather than asking a content question).

### Confirmed Requirements

| ID | Proposition | Quote | Type | Facets |
|---|---|---|---|---|
| REQ-01 | Customers view slots + book online without contacting reception | Maya: "...book without contacting reception?" → Sarah: "Yes." | MT | related_objective: OBJ-01 |
| REQ-02 | Staff can also create/book appointments | Maya: "...both customers and staff need to be able to create appointments." → Sarah: "Correct." | MT | — |
| REQ-03 | Booking selects: service, staff, branch, date, time | Sarah: "Service, staff member, date, time..." Nina: "Branch as well." Sarah: "Oh yes, branch." | MT (built up) | — |
| REQ-04 | Staff availability tied to branch schedule | Maya: "...depend on their branch schedule?" → Sarah: "Exactly." | MT | related_rule: RULE-02 |
| REQ-05 | Only qualified staff selectable per service; confirmed for launch, not deferred | Sarah: "Yes, that would be good." Daniel: "...mandatory for launch, or...later?" Sarah: "No, it should be there from the beginning." | MT | **Regression marker** — do not conflate with REQ-06 |
| REQ-06 | Customer picks a specific stylist OR "any available stylist" | Sarah: "Both." ... "any available stylist." | DS | **Regression marker** — "dropdown" never said |
| REQ-07 | Staff can override duration when booking; customers cannot | Kevin: "That would help." Sarah: "Yes, for staff. Customers shouldn't change it themselves." | MT | related: ASM-01 (presupposes a default duration concept, itself unconfirmed) |
| REQ-08 | Collect name + phone; email optional | Kevin: "Name, phone number." Sarah: "Email." Kevin: "Most customers don't give email." Sarah: "Okay, email can be optional." | MT (built up) | no transcript evidence makes name/phone explicitly mandatory — do not assert "required" |
| REQ-09 | Birthday optional | Maya: "Is birthday required?" → Sarah: "No, optional." | MT | — |
| REQ-10 | Appointment reminders required | Maya: "Do you need reminders?" → Everyone: "Yes." | MT | channel/frequency = UNR-04 |
| REQ-11 | Reception calendar by staff (columns per stylist); daily view is the priority | Sarah: "Calendar by staff member would be useful." Kevin: "Yeah. Like columns for each stylist." Daniel: "Daily view only?" Kevin: "Daily is most important..." | MT (built up) | weekly view is a secondary mention only, not independently confirmed to the same degree |
| REQ-12 | Drag-and-drop reschedule with confirm-before-save | Maya: "...might be useful, but we'd need some kind of confirmation..." → Sarah: "Exactly." | MT | Maya's framing was hedged; Sarah's "Exactly" is the unhedged confirmation that satisfies the bar |
| REQ-13 | Customer appointment history required | Sarah: "Yes." Kevin: "Appointment history would help." | MT | — |
| REQ-14 | Customer notes required (formula, allergies, preferences) | Sarah: "And notes." Kevin: "...colour formula, allergies, preferences." | DS | visibility = UNR-05 |
| REQ-15 | Managers configure staff working hours + unavailable periods | Maya: "...configure working hours and unavailable periods?" → Sarah: "Yes." | MT | related_objective: OBJ-03 |
| REQ-16 | Staff breaks automatically block booking | Maya: "...prevent bookings during breaks?" → Kevin: "Yes." Sarah: "Definitely." | MT | — |
| REQ-17 | System may suggest alternatives; never auto-apply | Sarah: "Yes, suggestions are fine. Just don't automatically change customer appointments." | MT | constrained_by: RULE-01 (preserve "suggest" vs. "auto-reassign" distinction) |
| REQ-18 | Individual staff accounts; no shared admin login | Daniel: "We shouldn't do that in the new system." → Sarah: "Agreed." | MT | supersedes STATE-09 |
| REQ-19 | 4 roles (Admin/Manager/Receptionist/Stylist), distinct permissions | Sarah: "Admin, manager, receptionist and stylist." → "Different permissions for each?" "Yes." | MT | enforces_rule: RULE-03; stylist-to-stylist visibility = UNR-07 |
| REQ-20 | Revenue reporting is required | Maya: "Any reporting requirements?" → Sarah: "Definitely revenue reports." | MT (unhedged, direct answer to a direct question) | dependency_note: revenue reporting requires payment information; the source/availability of that payment information is not established in this meeting. related (soft, not a hard dependency): UNR-01 — online payment/deposits is one possible source of that payment information, but the transcript does not establish it as the only one, so this is not a `depends_on` relationship |
| REQ-21 | Staff can mark an appointment as a no-show | Maya: "...mark an appointment as no-show?" → Sarah: "Yes." | MT | **Regression marker** — "no-show" ≠ "audit no-shows"; penalty policy = UNR-09 |

### Unresolved Decisions

| ID | Proposition | Quote | Type | Facets |
|---|---|---|---|---|
| UNR-01 | Online payment/deposits required for V1? (incl. deposit-for-expensive-services detail) | Maya: "I'll leave online deposits as an unresolved item..." → Sarah: "Yes." | MSR | related (soft): REQ-20 — revenue reporting needs payment information generally, not necessarily sourced from online payment/deposits specifically |
| UNR-02 | Mobile number + OTP vs. password — pending SMS cost check | Maya: "So technically preferred, but SMS cost needs checking?" → Sarah: "Correct." | MT | — |
| UNR-03 | Cancellation AND rescheduling policy — final rule not locked | Maya: "So cancellation and rescheduling policy still needs confirmation?" → Sarah: "Yes. Don't lock that one yet." | MSR | overrides the earlier "That works" 24h/contact-salon framing (provisional leaning only) |
| UNR-04 | Reminder channel + frequency — SMS-first is the current leaning, cost check pending | Maya: "So reminder channel and frequency need a cost check." → Sarah: "Yes." | MSR | — |
| UNR-05 | Which notes reception can see (vs. stylists/managers) | Maya: "...need to define note categories or permissions later." → Sarah: "Yes." | MT | — |
| UNR-06 | Exact scope of audit logging (which actions require it) | Maya: "Audit requirements need to be defined in more detail." | MSR (no explicit client line follows) | — |
| UNR-07 | Can a stylist see other stylists' schedules vs. customer details? | Maya: "That needs a permission decision." → Sarah: "Yes." | MT | related_requirement: REQ-19 |
| UNR-08 | Definition of "customer retention" / whether a retention report is in scope | Maya: "Let's not invent one. We can define that later." | MSR (no explicit client line follows) | — |
| UNR-09 | Automated no-show penalty policy (e.g. deposit after repeats) | Maya: "...automated penalties as unresolved." → Sarah: "Correct." | MSR | related_requirement: REQ-21 |
| UNR-10 | Data migration scope/feasibility — pending inspection of existing data | Maya: "...data migration is not confirmed until we assess the existing data." → Sarah: "Correct." | MSR | — |

### Assumptions / Tentative Statements

Every item here failed the "sufficiently confirmed" bar — tentative wording
proposed by a client-side speaker, never subsequently confirmed, rejected, or
explicitly declared unresolved by name.

| ID | Proposition | Quote | Why it doesn't clear the bar |
|---|---|---|---|
| ASM-01 | A standard/default duration should be configurable per service | Sarah: "I think we should configure a standard duration for each service." | No line afterward re-confirms this specifically — the staff-override discussion (REQ-07) presupposes a default exists but never explicitly confirms configuring one. |
| ASM-02 | Variable-price services should show "starting from" instead of a fixed price | Sarah: "For those, it should probably say 'starting from.'" | Conversation moves directly to a different sub-topic without ever confirming this specific display choice. |
| ASM-03 | An appointment-activity report set (bookings, cancellations, no-shows, busiest services/staff) was proposed as possible V1 scope | Nina: "For the first version, maybe appointment reports: number of bookings, cancellations, no-shows, busiest services." Sarah: "And busiest staff." | "Maybe" framing; Sarah's "And busiest staff" is an addition to the tentative list, not an unhedged confirmation of the list as final V1 scope. |

### Business Rules / Constraints

| ID | Proposition | Quote | Type | Facets |
|---|---|---|---|---|
| RULE-01 | Never auto-cancel/move an appointment without staff confirmation | Sarah: "Don't automatically cancel or move appointments without staff confirmation." **+** Maya: "Should the system automatically move their appointments to another stylist?" → Sarah: "No." Kevin: "Definitely not automatically." Sarah: "Reception should decide." | DS + MT | related_requirement: REQ-17 (suggest-alternatives capability) |
| RULE-02 | Never let a customer book a stylist who isn't working | Kevin: "...don't let customers book a stylist who's not working." | DS | related_requirement: REQ-04 |
| RULE-03 | Customer information access must be restricted according to user roles/permissions | Nina: "Customer information shouldn't be visible to everyone." | DS | related_requirement: REQ-19 (distinct content: specific role names). **Implementation metadata (non-gold):** Daniel: "So we'll need role-based access control." — RBAC is Daniel's proposed mechanism, not itself client-confirmed; the gold proposition is the access-restriction constraint only, not the RBAC implementation choice |
| RULE-04 | Notifications only on confirmed changes, never accidental edits | Sarah: "So when an appointment change is saved, send the customer a notification." → Sarah: "Correct." **+** Sarah: "I really don't want the system sending customers random messages because somebody accidentally edited something." → Maya: "...only be triggered by confirmed appointment changes." → Sarah: "Yes." | MT + DS | — |

### Current State / Problem

| ID | Proposition | Quote | Type |
|---|---|---|---|
| STATE-01 | Customers book today via phone, WhatsApp, or Instagram (WhatsApp most common) | Sarah: "...call us, WhatsApp us, or message Instagram." Kevin: "Mostly WhatsApp." | DS |
| STATE-02 | Reception book + Google Calendar both used today, inconsistently, book is source of truth | Kevin: "The appointment book, normally." Sarah: "...they don't always [match]." | DS |
| STATE-03 | Double-booking happens today from uncoordinated channels | Kevin: "Someone replies on WhatsApp, another person answers the phone, and both give the same 3 PM slot." | DS |
| STATE-04 | Not all staff can perform all services today | Sarah: "...some junior stylists don't do colouring." | DS |
| STATE-05 | Deposits today: sometimes bank transfer + WhatsApp screenshot | Sarah: "Sometimes through a bank transfer." Kevin: "...payment screenshot on WhatsApp." | DS |
| STATE-06 | No system enforcement of the 24h cancellation notice today | Sarah: "That's because there's no system enforcing it." | DS |
| STATE-07 | Pricing mostly service-based; coloring varies by hair length/product; final price set at checkout | Sarah: "Colouring depends on hair length and product usage." Sarah: "Usually at checkout." | DS — describes existing practice, never confirmed as future-system behavior, not promoted |
| STATE-08 | No-shows not currently recorded systematically | Kevin: "We don't really record them properly." | DS |
| STATE-09 | All staff currently share one admin account | Kevin: "Currently, basically yes." | DS — superseded going forward by REQ-18 |
| STATE-10 | Existing customer data scattered (Excel, old POS), volume/format unknown | Sarah: "Some in Excel." "Some in the old POS." Sarah: "No [we don't know how much]." | DS |

### Business Objectives / Success Criteria

Exactly 3, exhaustive for this transcript (all three came from one direct
"what would make this successful?" question):

| ID | Proposition | Quote | Requirement twin? |
|---|---|---|---|
| OBJ-01 | Customers book online; double-booking eliminated | Sarah: "If customers can book online and we're no longer double-booking people." | Yes — REQ-01 |
| OBJ-02 | Reception has one reliable schedule (replaces book/WhatsApp/Calendar) | Kevin: "...one reliable schedule instead of checking the book, WhatsApp and Google Calendar." | No independent twin — downstream effect of REQ-01/02/03 |
| OBJ-03 | Managers can control staff availability | Nina: "...if managers can control staff availability." | Yes — REQ-15 |

### Out of Scope

| ID | Proposition | Quote |
|---|---|---|
| SCOPE-01 | Full POS / in-store checkout and payment handling excluded from initial scope | Maya: "So POS functionality is outside the initial scope?" → Sarah: "Yes. Definitely." |

---

## Supporting eval invariants (NOT gold-taxonomy facts)

### Positive: facts a question-generation stage must treat as already answered

- Exactly 3 branches: Colombo 5, Rajagiriya, Nugegoda.
- Example durations given (illustrative only, not a spec): men's haircut
  ~30 min, women's haircut ~45 min, coloring 2-3 hrs.
- Staff typically work 9 to 6, with variation, days off, and leave.

### Negative: constants/actors/mechanisms that must NEVER appear in generated output

- Any specific no-show grace period in minutes (e.g. "30 minutes").
- "Sales representatives" (role never mentioned — only Admin, Manager,
  Receptionist, Stylist).
- Any invented state-machine vocabulary for working-hours config (e.g.
  "configuring"/"active"/"saved" states).
- Multiple staff alerts/reminders before a change or cancellation
  (contradicts RULE-04 directly).
- "Dropdown" as the UI mechanism for stylist selection (never specified).
- Data residency / multi-region / multi-country handling.
- Branch ownership/management-change scenarios.
- "Required" applied to name/phone collection (REQ-08) — not established by
  the transcript, only email's optionality is explicit.

---

## Final list of annotation rules

1. **Confirmed Requirement** = capability/behavior the system must provide
   (positive framing).
2. **Business Rule/Constraint** = policy/invariant restricting permitted
   behavior (negative/restrictive framing).
3. One primary gold proposition per distinct client decision — never
   double-count the same decision as both Requirement and Rule merely
   because it's evaluable from both angles.
4. A proposition that is fundamentally negative/policy-based ("must not X
   without Y") gets Business Rule as its primary category, even when a
   positive restatement of the *same* decision appears elsewhere in the
   transcript — attach the restatement as additional evidence on the Rule,
   not a second gold item.
5. When a Requirement and a Rule are *related* but contain genuinely
   distinct content (different gating criteria, different named entities,
   etc.), keep both as separate primary items and cross-reference via a
   facet (`related_requirement`, `enforces_rule`, `constrained_by`,
   `related_rule`) instead of merging — merging would lose real
   information.
6. Multiple evidence quotes attach to ONE gold item when the transcript
   restates the same underlying decision more than once (same scene or a
   later one), rather than creating a second gold item for the restatement.
7. Current-state facts remain their own category regardless of whether a
   later requirement supersedes them — "is" and "should-be" are different
   temporal claims, not duplicates.
8. Business Objectives/Success Criteria may reference the same underlying
   capability as a Requirement without being a duplicate — objective =
   outcome framing, requirement = functional framing, and both can stand
   independently.
9. Later explicit clarification/retraction/deferral overrides earlier
   tentative or provisional agreement, unless subsequently reconfirmed —
   governs the Unresolved-Decision-vs-Requirement boundary specifically.
10. Tentative wording ("maybe," "probably," "I think," "would be useful/
    nice," etc.) is evidence of tentativeness, not neutral filler. A
    tentative proposition becomes a Confirmed Requirement only if later
    conversation *sufficiently* confirms it — an explicit unhedged "Yes/
    Correct/Exactly/Agreed," an explicit unhedged follow-up commitment, or
    a direct unhedged answer to a direct clarifying question that addresses
    the same proposition. Consistency-with or plausible inference from
    later conversation is NOT sufficient. If a tentative proposition is
    never confirmed, rejected, or explicitly tracked as unresolved, it
    belongs in Assumption/Tentative Statement.
11. Do not manufacture gold items in an empty category just to exercise
    eval coverage — an empty category is a legitimate finding about the
    transcript, not a labeling gap.
12. A direct, unhedged answer to a direct question establishes the
    underlying *capability* as confirmed, even if a separate, explicitly
    unresolved matter means the capability's *timing or feasibility* is
    still open. Do not let an unresolved matter retroactively demote the
    capability itself to Assumption, and do not infer inclusion or
    exclusion for whichever scope that matter touches.
13. Do not attribute a developer/analyst-proposed implementation mechanism
    to the client as gold truth. When a client states a constraint in
    outcome terms and a developer names a specific mechanism to satisfy it,
    the gold proposition is the client's constraint; the mechanism is
    retained as non-gold implementation metadata on that item, not folded
    into the proposition itself.
14. **(new)** Only assert a hard `depends_on` / `depended_on_by` relationship
    between two gold items when the transcript explicitly ties them
    together as the same specific matter. A general prerequisite ("X
    requires payment information") is not the same claim as "X depends on
    Y's specific unresolved decision" unless the transcript says so — Y may
    be only one of several possible ways to satisfy the general
    prerequisite. Default to a free-text `dependency_note` describing the
    general prerequisite, plus (if useful) a soft, non-directional `related`
    cross-reference — not a hard dependency link that implies resolving Y
    is necessary or sufficient for X.

---

## Dangling-reference check

Every ID that appears anywhere in this document: `REQ-01`..`REQ-21`,
`UNR-01`..`UNR-10`, `ASM-01`..`ASM-03`, `RULE-01`..`RULE-04`,
`STATE-01`..`STATE-10`, `OBJ-01`..`OBJ-03`, `SCOPE-01` — 52 IDs total,
matching the 52-item count above.

| Reference | Found in | Points to | Resolves? |
|---|---|---|---|
| `related_objective: OBJ-01` | REQ-01 | OBJ-01 | ✓ |
| `related_rule: RULE-02` | REQ-04 | RULE-02 | ✓ |
| `related: ASM-01` | REQ-07 | ASM-01 | ✓ |
| `channel/frequency = UNR-04` | REQ-10 | UNR-04 | ✓ |
| `visibility = UNR-05` | REQ-14 | UNR-05 | ✓ |
| `related_objective: OBJ-03` | REQ-15 | OBJ-03 | ✓ |
| `constrained_by: RULE-01` | REQ-17 | RULE-01 | ✓ |
| `supersedes STATE-09` | REQ-18 | STATE-09 | ✓ |
| `enforces_rule: RULE-03` | REQ-19 | RULE-03 | ✓ |
| `visibility = UNR-07` | REQ-19 | UNR-07 | ✓ |
| `related (soft): UNR-01` | REQ-20 | UNR-01 | ✓ |
| `penalty policy = UNR-09` | REQ-21 | UNR-09 | ✓ |
| `related (soft): REQ-20` | UNR-01 | REQ-20 | ✓ |
| `related_requirement: REQ-19` | UNR-07 | REQ-19 | ✓ |
| `related_requirement: REQ-21` | UNR-09 | REQ-21 | ✓ |
| `related_requirement: REQ-17` | RULE-01 | REQ-17 | ✓ |
| `related_requirement: REQ-04` | RULE-02 | REQ-04 | ✓ |
| `related_requirement: REQ-19` | RULE-03 | REQ-19 | ✓ |
| `superseded going forward by REQ-18` | STATE-09 | REQ-18 | ✓ |
| `Yes — REQ-01` | OBJ-01 | REQ-01 | ✓ |
| `Yes — REQ-15` | OBJ-03 | REQ-15 | ✓ |

**21 cross-references checked, 0 dangling.** No reference points to a
removed or previously-renumbered ID.

Re-verified programmatically against this file's actual content (not the
edit diff): 21/10/3/4/10/3/1 unique row-defining IDs = 52 total, zero
duplicate IDs, zero duplicate `##`/`###` headings, zero stale/old IDs, zero
ID mentioned anywhere in the document that isn't a real row.

---

**FROZEN.** No eval schema or pipeline/prompt changes have been made in the
course of building this fixture.
