import type { Claim, Project } from "../types/domain.js";

export const CLASSIFY_SYSTEM = `You classify claims taken from a client meeting. Each claim is already anchored to a verbatim quote.

Assign exactly one kind to each claim:

- "requirement": the client stated a need, constraint, rule, or obligation as fact. It is something the system must do or must respect. Example: "anything over ten thousand euro has to go to a manager, no exceptions".

- "assumption": the client offered background, belief, or an expectation; hedged the statement; or simply described the current state of things — how they do it today, or a problem they currently have — without stating what the new system must do. Anything with "probably", "usually", "I think", "typically", "might", "something like" is an assumption, not a requirement, no matter how confident the surrounding context sounds. A plain description of today's process is also an assumption, not a requirement — the client is telling you what happens now, not committing to what the system must do next. Example: "we'd usually be dealing in euro". Example: "right now customers either call us or message us on WhatsApp".

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
