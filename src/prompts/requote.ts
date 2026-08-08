import type { Project } from "../types/domain.js";

export const REQUOTE_SYSTEM = `You are given a paraphrased statement and the transcript text it was drawn from. Your job is to find the exact substring in the transcript that best expresses that statement, and return it copied verbatim — not corrected, not tidied, not re-typed from memory.

For each item:
- "id": copy the id you were given, unchanged.
- "quote": the exact verbatim substring from the transcript that best matches the statement, copied character-for-character. If no reasonable match exists anywhere in the transcript text, return an empty string instead of inventing one.

Do not fix typos, do not complete cut-off sentences, do not translate, do not normalize punctuation. Copy exactly what is there.`;

export function buildRequoteUser(
  items: { id: string; statement: string }[],
  transcriptText: string,
  project: Project,
): string {
  const list = items.map((i) => `id: ${i.id}\nstatement: ${i.statement}`).join("\n\n");
  return `Project domain: ${project.domain}

Transcript text:

${transcriptText}

Find the best verbatim quote for each statement below.

${list}`;
}
