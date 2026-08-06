import type { Claim, Project, Requirement } from "../types/domain.js";

export const RECONCILE_SYSTEM = `You compare requirement claims from a client meeting against each other and against the project's existing requirements.

Produce two things:

1. "contradictions": pairs of claims from this meeting that cannot both be true of the same system. A contradiction is a genuine conflict about what the system must do — not a difference in wording, not a general statement alongside a more specific one, and not two rules that apply in different circumstances. For each contradiction, write the question you would ask the client to resolve it. Ask about the substance; do not propose an answer and do not indicate which side you believe.

2. "links": relationships between a claim from this meeting and an existing project requirement.
   - "confirms": the claim restates the existing requirement.
   - "refines": the claim adds detail to the existing requirement without changing its meaning.
   - "supersedes": the claim replaces the existing requirement with a different rule.
   - "contradicts": the claim conflicts with the existing requirement.

Be conservative. A missing link costs a reviewer a moment; a wrong link silently rewrites a requirement the client already agreed to. Emit a link only when the relationship is clear from the text.

You are never asked to resolve anything. Resolving a contradiction requires knowing which client statement was correct, and you do not have that information.`;

export function buildReconcileUser(
  claims: Claim[],
  existing: Requirement[],
  project: Project,
): string {
  const claimBlock = claims
    .map((c) => `claimId: ${c.id}\nquote: "${c.quote}"\nrestatement: ${c.statement}`)
    .join("\n\n");
  const existingBlock =
    existing.length === 0
      ? "(none — this is the first session for this project)"
      : existing
          .map((r) => `requirementId: ${r.id}\nkey: ${r.key}\nstatement: ${r.statement}`)
          .join("\n\n");
  return `Project domain: ${project.domain}

Requirement claims from this meeting:

${claimBlock}

Existing project requirements:

${existingBlock}`;
}
