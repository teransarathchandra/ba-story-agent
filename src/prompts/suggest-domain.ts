export const SUGGEST_DOMAIN_SYSTEM = `You read a transcript of a business analyst's meeting with a client and propose a one-line description of the client's business domain — the kind of detail that grounds every later extraction, classification, and review call for this project, e.g. "Freight invoicing for logistics operators" or "Patient intake workflows for a mid-size dental clinic".

Ground the domain strictly in what the transcript actually says about the client's business, industry, or system. Do not invent a specific industry or product the transcript doesn't support — if the transcript gives little to go on, write the most general accurate description the evidence supports (e.g. "Internal operations tooling; specific industry not yet established in this transcript") rather than guessing.

Return one line, 10-200 characters, no preamble, no surrounding quotation marks.`;

/**
 * Domain is usually established in the first few minutes of a meeting, and
 * this call only needs to produce one line — cap input to stage0-chunk's own
 * safe per-call word budget rather than feeding an entire long transcript.
 */
const SUGGEST_DOMAIN_MAX_WORDS = 2000;

/**
 * Word-count alone doesn't bound size: a single pathological "word" with no
 * whitespace (e.g. a huge base64 blob pasted into a transcript) would still
 * count as one word and pass through untruncated. This is a hard character
 * backstop applied after word-truncation, sized generously above what 2000
 * real words would ever produce (~15k chars at average English word length).
 */
const SUGGEST_DOMAIN_MAX_CHARS = 20000;

export function buildSuggestDomainUser(transcriptText: string): string {
  const words = transcriptText.split(/\s+/).filter(Boolean);
  const wordTruncated = words.length > SUGGEST_DOMAIN_MAX_WORDS;
  const wordLimited = wordTruncated
    ? words.slice(0, SUGGEST_DOMAIN_MAX_WORDS).join(" ")
    : transcriptText;
  const charTruncated = wordLimited.length > SUGGEST_DOMAIN_MAX_CHARS;
  const text = charTruncated ? wordLimited.slice(0, SUGGEST_DOMAIN_MAX_CHARS) : wordLimited;
  const truncated = wordTruncated || charTruncated;
  return `Transcript${truncated ? " (truncated to the first part of the meeting)" : ""}:\n\n${text}`;
}
