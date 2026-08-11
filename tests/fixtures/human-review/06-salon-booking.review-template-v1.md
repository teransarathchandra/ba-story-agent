# 06-salon-booking — human semantic review template (v1)

**Not yet reviewed.** Every verdict field below is blank. Fill in a correspondence/evidence decision for each item, then this file (or its JSON twin) becomes the input to freezing the authoritative human match map. Do not treat anything here as a decision until a human has actually filled it in.

**Provenance:** gold fixture hash `88e39d0628f8dde4...`, candidate snapshot `9158e54c-dac5-4226-9efc-e59a92fabd4c` (content hash `be453afebbf74c82...`), source session `ses_01KZK7GDZNQ9FQ5ERAXN6M4MJT`.

---

## Part 1 — Gold items (38): for each, which candidate(s) below correspond to it, if any?

For every item: pick **equivalent**, **partial**, **contradicts** (name the candidate ID), or **no match**.

### REQ-01 — Requirement

**Proposition:** Customers view slots + book online without contacting reception

**Quotes:**
- "So customers should be able to see available slots and book without contacting reception?"
- "Yes."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-02 — Requirement

**Proposition:** Staff can also create/book appointments

**Quotes:**
- "Right. So both customers and staff need to be able to create appointments."
- "Correct."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-03 — Requirement

**Proposition:** Booking selects: service, staff, branch, date, time

**Quotes:**
- "Service, staff member, date, time... that's probably it."
- "Branch as well."
- "Oh yes, branch."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-04 — Requirement

**Proposition:** Staff availability tied to branch schedule

**Quotes:**
- "So staff availability needs to depend on their branch schedule?"
- "Exactly."
- "But not usually on the same day."
- "Usually, yes. But sometimes they move if someone's absent."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-05 — Requirement

**Proposition:** Only qualified staff selectable per service; confirmed for launch, not deferred

**Quotes:**
- "So when someone chooses a service, should the system only show staff members qualified to provide that service?"
- "Yes, that would be good."
- "Just to clarify, is that mandatory for launch, or something we could add later?"
- "No, it should be there from the beginning. Otherwise customers might book the wrong person."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-06 — Requirement

**Proposition:** Customer picks a specific stylist OR "any available stylist"

**Quotes:**
- "Should customers choose a specific employee or just choose anyone available?"
- "Both."
- "They can select a stylist if they have a preference. Otherwise choose something like "any available stylist.""

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-07 — Requirement

**Proposition:** Staff can override duration when booking; customers cannot

**Quotes:**
- "Would staff need to manually adjust the duration when creating a booking?"
- "That would help."
- "Yes, for staff. Customers shouldn't change it themselves."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-08 — Requirement

**Proposition:** Collect name + phone; email optional

**Quotes:**
- "Name, phone number."
- "Email."
- "Most customers don't give email."
- "Okay, email can be optional."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-09 — Requirement

**Proposition:** Birthday optional

**Quotes:**
- "Is birthday required for booking?"
- "No, optional."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-10 — Requirement

**Proposition:** Appointment reminders required

**Quotes:**
- "Do you need reminders?"
- "Yes."
- "Definitely."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-11 — Requirement

**Proposition:** Reception calendar by staff (columns per stylist); daily view is the priority

**Quotes:**
- "Calendar by staff member would be useful."
- "Yeah. Like columns for each stylist."
- "Daily view only?"
- "Daily is most important, but weekly would be useful too."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-12 — Requirement

**Proposition:** Drag-and-drop reschedule with confirm-before-save

**Quotes:**
- "So drag-and-drop might be useful, but we'd need some kind of confirmation before saving the change?"
- "Exactly."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-13 — Requirement

**Proposition:** Customer appointment history required

**Quotes:**
- "Do you want customer history?"
- "Yes."
- "Appointment history would help."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-14 — Requirement

**Proposition:** Customer notes required (formula, allergies, preferences)

**Quotes:**
- "And notes."
- "Things like colour formula, allergies, preferences."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-15 — Requirement

**Proposition:** Managers configure staff working hours + unavailable periods

**Quotes:**
- "So managers need to configure working hours and unavailable periods?"
- "Yes."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-16 — Requirement

**Proposition:** Staff breaks automatically block booking

**Quotes:**
- "Should the system automatically prevent bookings during breaks?"
- "Yes."
- "Definitely."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-17 — Requirement

**Proposition:** System may suggest alternatives; never auto-apply

**Quotes:**
- "Could the system show alternative staff and time slots?"
- "That would be useful."
- "Yes, suggestions are fine. Just don't automatically change customer appointments."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-18 — Requirement

**Proposition:** Individual staff accounts; no shared admin login

**Quotes:**
- "Are all staff using the same admin account?"
- "Currently, basically yes."
- "We shouldn't do that in the new system."
- "Agreed."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-19 — Requirement

**Proposition:** 4 roles (Admin/Manager/Receptionist/Stylist), distinct permissions

**Quotes:**
- "What roles do you expect?"
- "Admin, manager, receptionist and stylist."
- "Different permissions for each?"
- "Yes."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-20 — Requirement

**Proposition:** Revenue reporting is required

**Quotes:**
- "Any reporting requirements?"
- "Definitely revenue reports."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### REQ-21 — Requirement

**Proposition:** Staff can mark an appointment as a no-show

**Quotes:**
- "So staff should be able to mark an appointment as no-show?"
- "Yes."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### UNR-01 — Unresolved Decision

**Proposition:** Online payment/deposits required for V1? (incl. deposit-for-expensive-services detail)

**Quotes:**
- "Are we saying online payment is required for the first release?"
- "I'm not sure yet."
- "We should probably check the payment provider fees first."
- "I'll leave online deposits as an unresolved item rather than treating it as a confirmed requirement."
- "Yes."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### UNR-02 — Unresolved Decision

**Proposition:** Mobile number + OTP vs. password — pending SMS cost check

**Quotes:**
- "So technically preferred, but SMS cost needs checking?"
- "Correct."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### UNR-03 — Unresolved Decision

**Proposition:** Cancellation AND rescheduling policy — final rule not locked

**Quotes:**
- "So before 24 hours, customers can cancel themselves. Within 24 hours, they need to contact the salon?"
- "Yes."
- "That works."
- "So cancellation and rescheduling policy still needs confirmation?"
- "Yes. Don't lock that one yet."

**Meeting-state sensitive** — must NOT reflect: _The earlier provisional 24h/contact-salon framing ('That works') treated as a final, confirmed cancellation/rescheduling policy_; must reflect (final): _Cancellation and rescheduling policy is explicitly still open — Maya's later framing and Sarah's 'Don't lock that one yet' override the earlier provisional agreement_

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### UNR-04 — Unresolved Decision

**Proposition:** Reminder channel + frequency — SMS-first is the current leaning, cost check pending

**Quotes:**
- "So reminder channel and frequency need a cost check."
- "Yes."
- "Then maybe SMS first."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### UNR-05 — Unresolved Decision

**Proposition:** Which notes reception can see (vs. stylists/managers)

**Quotes:**
- "Sounds like we need to define note categories or permissions later."
- "Yes."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### UNR-06 — Unresolved Decision

**Proposition:** Exact scope of audit logging (which actions require it)

**Quotes:**
- "Audit requirements need to be defined in more detail."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### UNR-07 — Unresolved Decision

**Proposition:** Can a stylist see other stylists' schedules vs. customer details?

**Quotes:**
- "That needs a permission decision."
- "Yes."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### UNR-08 — Unresolved Decision

**Proposition:** Definition of "customer retention" / whether a retention report is in scope

**Quotes:**
- "Do you have a definition for retention?"
- "Not really."
- "Okay, let's not invent one. We can define that later."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### UNR-09 — Unresolved Decision

**Proposition:** Automated no-show penalty policy (e.g. deposit after repeats)

**Quotes:**
- "I'll record the ability to mark no-show as confirmed, but automated penalties as unresolved."
- "Correct."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### UNR-10 — Unresolved Decision

**Proposition:** Data migration scope/feasibility — pending inspection of existing data

**Quotes:**
- "So data migration is not confirmed until we assess the existing data."
- "Correct."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### ASM-01 — Assumption

**Proposition:** A standard/default duration should be configurable per service

**Quotes:**
- "I think we should configure a standard duration for each service."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### ASM-02 — Assumption

**Proposition:** Variable-price services should show "starting from" instead of a fixed price

**Quotes:**
- "For those, it should probably say "starting from.""

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### ASM-03 — Assumption

**Proposition:** An appointment-activity report set (bookings, cancellations, no-shows, busiest services/staff) was proposed as possible V1 scope

**Quotes:**
- "For the first version, maybe appointment reports: number of bookings, cancellations, no-shows, busiest services."
- "And busiest staff."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### RULE-01 — Business Rule

**Proposition:** Never auto-cancel/move an appointment without staff confirmation

**Quotes:**
- "Don't automatically cancel or move appointments without staff confirmation."
- "Should the system automatically move their appointments to another stylist?"
- "No."
- "Definitely not automatically."
- "Reception should decide."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### RULE-02 — Business Rule

**Proposition:** Never let a customer book a stylist who isn't working

**Quotes:**
- "And don't let customers book a stylist who's not working."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### RULE-03 — Business Rule

**Proposition:** Customer information access must be restricted according to user roles/permissions

**Quotes:**
- "Customer information shouldn't be visible to everyone."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

### RULE-04 — Business Rule

**Proposition:** Notifications only on confirmed changes, never accidental edits

**Quotes:**
- "So when an appointment change is saved, send the customer a notification."
- "Correct."
- "I really don't want the system sending customers random messages because somebody accidentally edited something."
- "So notifications should only be triggered by confirmed appointment changes."
- "Yes."

**Verdict:** ☐ equivalent ☐ partial ☐ contradicts ☐ no match
**Matched candidate ID(s):** _________________
**meetingStateViolation (if applicable):** ☐ true ☐ false
**Reviewer note:** _________________

---

## Part 2 — Generated candidates (31): evidence fidelity

For every candidate: does its own cited quote actually support its own text? **pass** or **fail**.

### req_01KZK7RMDPSMCK42F3S5G6TE2H (requirement)

**Text:** Managers must be able to configure working hours and unavailable periods for each salon branch.

**Quote:** "Sarah: Yes."

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### req_01KZK7RMDSAEJHSKMG2Y3QX6R8 (requirement)

**Text:** An auditing mechanism must be implemented to record no-shows within the appointment booking system.

**Quote:** "Sarah: We should."

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### req_01KZK7RMDTFKD9B5RFAN6ETY8Z (requirement)

**Text:** Appointments must not be automatically canceled or altered without staff confirmation.

**Quote:** ""Don't automatically cancel or move appointments without staff confirmation.""

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### req_01KZK7RMDTFKD9B5RFAN6ETY90 (requirement)

**Text:** Custom customers booking must be blocked when trying to book a stylist who is unavailable.

**Quote:** ""And don't let customers book a stylist who's not working.""

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### req_01KZK7RMDTFKD9B5RFAN6ETY91 (requirement)

**Text:** Customer data must only be accessible to appropriately authenticated users.

**Quote:** ""Customer information shouldn't be visible to everyone."""

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7T6DJJZ798TPHJX4YPH93 (question)

**Text:** What are the standard business hours for each day, and should these be customizable per branch?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7T6DMD1QP1ES9RCQCKYDR (question)

**Text:** Are there instances of specific dates or periods when the branches are not available to provide services, and should these be defined independently for each branch?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT432KP7DGZW5J94JMJF (question)

**Text:** What are the operational hours and unavailable periods that will be set for each branch?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT45S4A7KYQVD1BWVGTW (question)

**Text:** How many branches are there, and are there specific examples or names for each one?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT45S4A7KYQVD1BWVGTX (question)

**Text:** Could you clarify the exact definition of a 'no-show' in your context? Are there any gray areas or specific cases (e.g., early cancellations) that should be handled differently?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT45S4A7KYQVD1BWVGTY (question)

**Text:** What are the implications of not showing up within 30 minutes of the scheduled time? Are there any procedures or notifications involved?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT45S4A7KYQVD1BWVGTZ (question)

**Text:** Is there a specific process or system in place to handle cancellations that are marked as no-shows?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT45S4A7KYQVD1BWVGV0 (question)

**Text:** How are the alerts for unconfirmed cancellations or changes handled (e.g., who receives them and what actions does it trigger)?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT45S4A7KYQVD1BWVGV1 (question)

**Text:** Are there specific scenarios or edge cases related to appointment changes that need to be addressed (e.g., last-minute rescheduling)?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT4611KZREY11M0ZKK0P (question)

**Text:** How do you define 'appropriately authenticated users' in the context of customer data access? Are there different roles or levels of access?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT4611KZREY11M0ZKK0Q (question)

**Text:** Are there any regulatory requirements or internal policies concerning the handling of no-shows, appointment cancellations, or customer data?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT4611KZREY11M0ZKK0R (question)

**Text:** Are there any downstream systems or integrations that this appointment booking system needs to interact with (e.g., payment systems, marketing automation)?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT4ADD6BTW067KK425CG (question)

**Text:** How will you establish the authentication and authorization of staff members, managers, and admins to ensure they have the appropriate permissions to access and modify customer data and system configurations?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT4ADD6BTW067KK425CH (question)

**Text:** What are the data retention policies for customer records, and how will expired or unused records be automatically deleted or archived?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT4ADD6BTW067KK425CJ (question)

**Text:** How will you ensure the privacy and security of customer data in transit and at rest, especially since reservation details and customer preferences might be considered sensitive?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT4ADD6BTW067KK425CK (question)

**Text:** How will the system handle data residency, particularly if the hair salon operates in multiple regions or countries? Are there any specific data storage and processing requirements we should be aware of?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT4ADD6BTW067KK425CM (question)

**Text:** How will the audit mechanism for no-shows be designed to ensure it is tamper-proof and can support retrospective analysis and audits of booking patterns?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT4ADD6BTW067KK425CN (question)

**Text:** Can you specify how long appointments and related data will be retained in the system, and what criteria will trigger their deletion?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT4ADD6BTW067KK425CP (question)

**Text:** How will you manage customer data when a branch undergoes a change in ownership or management, especially in terms of transferring or deleting data under the new management’s control?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT4BETSY1P5B94M0N9W7 (question)

**Text:** How should the system handle data for each customer, including any personally identifiable information (PII), to ensure compliance with data protection best practices and legal requirements?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### oqn_01KZK7XT4BETSY1P5B94M0N9W8 (question)

**Text:** What are the criteria for 'appropriately authenticated users' as defined in Requirement REQ-005, and are any specific roles or permissions associated with different levels of access?

**Quote:** _(none — question-bucket items are not required to carry a verbatim citation)_

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### clm_01KZK7N2AA0G84SY55420PB60H (assumptionClaim)

**Text:** The amount of existing customer data is unknown.

**Quote:** "Maya: Do we know how much data?"

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### clm_01KZK7N2AA0G84SY55420PB60J (assumptionClaim)

**Text:** The amount of existing customer data is unknown.

**Quote:** "Sarah: No."

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### clm_01KZK7N2AA0G84SY55420PB60K (assumptionClaim)

**Text:** Customers should be able to select a specific staff member or any available stylist.

**Quote:** "They can select a stylist if they have a preference. Otherwise choose something like "

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### clm_01KZK7N2AA0G84SY55420PB60M (assumptionClaim)

**Text:** A drop-down to selecting a known stylist or choosing any available stylist should be available during booking for some services.

**Quote:** "Sarah: Yes, that would be good."

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

### clm_01KZK7P5FQ0QMPTPP8MJASJNAM (assumptionClaim)

**Text:** We need to ensure we are no longer double-Booking customer appointments.

**Quote:** "If customers can book online and we're no longer double-booking people"

**Evidence fidelity:** ☐ pass ☐ fail
**Reviewer note:** _________________

---

