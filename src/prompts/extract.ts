import type { Project } from "../types/domain.js";
import type { Window } from "../pipeline/stage0-chunk.js";

export const EXTRACT_SYSTEM = `You extract atomic claims from a transcript of a business analyst's meeting with a client.

A claim is one indivisible thing that was actually said. For each claim you emit:
- "quote": the exact words from the transcript, copied verbatim. Do not paraphrase, tidy, correct, or complete it.
- "statement": your own normalized restatement of what that quote asserts.
- "segmentId": the id of the segment the quote came from.
- "speakerRole": who said it.

Each transcript segment below is labeled with its speaker, e.g. "[speaker: Maya]". Use that label to set speakerRole — do not guess it from the prose. If a segment carries "[speaker: unknown]", use your best judgment from context rather than defaulting to "client".

Rules, in order of importance:

1. If you cannot quote it, do not emit it. Every claim must be anchored in words that literally appear in the transcript below. A quote that is not present will be discarded by an automated check and will count against this extraction's quality score.
2. Do not infer. If the client did not say something, it is not a claim. Absence of a detail is not a claim that the detail is unimportant.
3. One assertion per claim. Split compound statements.
4. Preserve hedging in the quote. If the speaker said "we'd probably want X", quote it with "probably" intact — a later stage depends on that word being there.
5. The analyst's own questions and proposals are never claims by themselves. But when the analyst proposes a specific, concrete rule and the client replies with a short, unhedged confirmation — "yes", "correct", "exactly", "that's right", "definitely", "agreed", "that works" — emit ONE claim for that exchange: "quote" is the client's own confirming words (verbatim, from the client's segment), "speakerRole" is the client's, and "statement" restates the specific thing that was just confirmed, using the analyst's preceding proposal for content. Example: the analyst says "So managers need to configure working hours and unavailable periods?" and the client replies "Yes." — emit a claim with quote "Yes.", speakerRole "client", and statement "Managers can configure staff working hours and unavailable periods." Do NOT do this when the analyst's preceding turn was open-ended (a "what/how/tell me about" question rather than a specific proposal) — a short reply to an open question does not confirm anything specific.
6. If a reply to an open-ended question, or to a proposal, is itself vague ("maybe", "I guess", "sure, I suppose") rather than a clear yes/no, that is not a confirmed claim under rule 5.
7. Ignore scheduling, small talk, and meeting logistics.

Return no claims at all if the transcript contains none. An empty result is a correct answer for a status call or a social conversation.`;

export function buildExtractUser(window: Window, project: Project): string {
  const segmentBlock = window.segments
    .map((s) => `[segmentId: ${s.id}] [speaker: ${s.speakerLabel ?? "unknown"}]\n${s.text}`)
    .join("\n\n");
  const glossary = project.glossary ? `\n\nDomain glossary:\n${project.glossary}` : "";
  return `Project domain: ${project.domain}${glossary}

Transcript window ${window.idx + 1}:

${segmentBlock}`;
}
