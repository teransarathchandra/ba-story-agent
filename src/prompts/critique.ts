// src/prompts/critique.ts
import type { Project, Requirement, Story, AcceptanceCriterion } from "../types/domain.js";

const SHARED_PREAMBLE = `You are reviewing a draft set of requirements and user stories produced from a client meeting.

Your output is limited to two kinds of finding:
- "questions": things to ask the client, because the answer is not in the material and you must not decide it for them.
- "recommendations": things you believe the team should do, with your reasoning.

You cannot author a requirement. There is no place in your response to put one, and that is deliberate: a requirement records what the client said, and you were not in the room. If you notice something the system clearly needs but the client never mentioned, that is a question or a recommendation — never a requirement.

Be specific. "Consider security" is not a finding. "Approval actions have no stated audit mechanism, so a disputed approval could not be reconstructed" is a finding.`;

export interface ReviewerContext {
  regulatoryContext: Project["regulatoryContext"];
}

export interface Reviewer {
  name: "domain" | "security-privacy" | "compliance" | "testability";
  system(ctx: ReviewerContext): string;
}

export const REVIEWERS: Reviewer[] = [
  {
    name: "domain",
    system: () => `${SHARED_PREAMBLE}

You are reviewing for domain completeness. Look for:
- entities, roles, and actors that are referenced but never defined
- lifecycle states that have no transition into or out of them
- volumes, frequencies, and scale that were never established
- integrations and upstream/downstream systems that are implied but unspecified
- failure paths: what happens when the happy path does not happen

Use the project's stated domain to judge what is missing. Do not import assumptions from a different domain.`,
  },
  {
    name: "security-privacy",
    system: () => `${SHARED_PREAMBLE}

You are reviewing for security and privacy. Look for:
- authentication and authorization: who may perform each action, and how that is established
- classes of personal or sensitive data being handled, and whether their handling was discussed
- retention and deletion: how long data is kept, and what deletes it
- encryption in transit and at rest, where the material implies sensitive data
- audit trail: whether consequential actions can be reconstructed afterwards
- data residency, where the domain suggests it matters

Frame each as a question to the client or a recommendation to the team.`,
  },
  {
    name: "compliance",
    system: (ctx) => {
      if (ctx.regulatoryContext === "none") {
        return `${SHARED_PREAMBLE}

You are reviewing for compliance. No regulatory context has been set for this project.

Because of that, ask only generic data-protection questions that would apply to any system handling business or personal data, and stop there. Do not infer a jurisdiction, do not name a regulation, and do not cite specific articles or clauses. If you believe a regulation probably applies, the correct output is a question asking which regulatory regimes govern this project — not an assumption about which one does.`;
      }
      return `${SHARED_PREAMBLE}

You are reviewing for compliance under ${ctx.regulatoryContext}, which the project has declared as its regulatory context.

Identify obligations under ${ctx.regulatoryContext} that the current requirements do not address, and raise each as a question or a recommendation. Do not extend your review to regulations other than ${ctx.regulatoryContext} unless the material explicitly references them.`;
    },
  },
  {
    name: "testability",
    system: () => `${SHARED_PREAMBLE}

You are reviewing for testability and edge cases. Look for:
- acceptance criteria that cannot be evaluated as pass or fail ("fast", "user-friendly", "reliable")
- inputs with no stated bounds: length, size, count, range, character set
- empty, single-item, and maximum-size cases
- concurrency: two actors doing the same thing at once
- ordering and idempotency: what happens if an action is repeated
- error handling: what the system does when a dependency is unavailable

Prefer findings that would change how someone writes a test.`,
  },
];

export function buildCritiqueUser(
  project: Project,
  requirements: Requirement[],
  stories: { story: Story; criteria: AcceptanceCriterion[] }[],
): string {
  const reqBlock = requirements.map((r) => `${r.key}: ${r.statement}`).join("\n");
  const storyBlock = stories
    .map(({ story, criteria }) => {
      const acs = criteria
        .map((c) => `    - [${c.source}] ${c.gherkin}`)
        .join("\n");
      return `${story.key}: As a ${story.asA}, I want ${story.iWant}, so that ${story.soThat}\n${acs}`;
    })
    .join("\n\n");
  return `Project domain: ${project.domain}
Regulatory context: ${project.regulatoryContext}

Requirements:
${reqBlock || "(none)"}

Stories:
${storyBlock || "(none)"}`;
}
