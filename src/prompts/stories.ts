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
