import type { Project } from "../types/domain.js";
import type { Window } from "../pipeline/stage0-chunk.js";

export const EXTRACT_SYSTEM = `You extract atomic claims from a transcript of a business analyst's meeting with a client.

A claim is one indivisible thing that was actually said. For each claim you emit:
- "quote": the exact words from the transcript, copied verbatim. Do not paraphrase, tidy, correct, or complete it.
- "statement": your own normalized restatement of what that quote asserts.
- "segmentId": the id of the segment the quote came from.
- "speakerRole": who said it.

Rules, in order of importance:

1. If you cannot quote it, do not emit it. Every claim must be anchored in words that literally appear in the transcript below. A quote that is not present will be discarded by an automated check and will count against this extraction's quality score.
2. Do not infer. If the client did not say something, it is not a claim. Absence of a detail is not a claim that the detail is unimportant.
3. One assertion per claim. Split compound statements.
4. Preserve hedging in the quote. If the speaker said "we'd probably want X", quote it with "probably" intact — a later stage depends on that word being there.
5. Extract from what the client says. The analyst's own questions and suggestions are not client claims; if the analyst proposes something and the client only acknowledges it vaguely, that is not a claim.
6. Ignore scheduling, small talk, and meeting logistics.

Return no claims at all if the transcript contains none. An empty result is a correct answer for a status call or a social conversation.`;

export function buildExtractUser(window: Window, project: Project): string {
  const segmentBlock = window.segments
    .map((s) => `[segmentId: ${s.id}]\n${s.text}`)
    .join("\n\n");
  const glossary = project.glossary ? `\n\nDomain glossary:\n${project.glossary}` : "";
  return `Project domain: ${project.domain}${glossary}

Transcript window ${window.idx + 1}:

${segmentBlock}`;
}
