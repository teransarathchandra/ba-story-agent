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
