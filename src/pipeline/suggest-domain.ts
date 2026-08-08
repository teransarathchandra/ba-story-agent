import { z } from "zod/v4";
import type { Db } from "../store/db.js";
import type { LlmBackend } from "../llm/backend.js";
import { callTyped } from "../llm/parse.js";
import { getFrozenTranscript } from "../store/transcripts.js";
import { countWords, MIN_WORDS } from "./stage0-chunk.js";
import { SUGGEST_DOMAIN_SYSTEM, buildSuggestDomainUser } from "../prompts/suggest-domain.js";

const SuggestedDomainSchema = z.object({
  domain: z.string().min(10).max(200),
});

/**
 * A one-off LLM call, not a pipeline Stage — it runs standalone, before a
 * project necessarily has a domain, so it cannot go through analyzeSession()
 * or its domain gate. Callers still own saving the result: this only
 * proposes text for review, via the same setProjectDomain() path a
 * hand-typed domain would use.
 */
export async function suggestProjectDomain(ctx: {
  db: Db;
  client: LlmBackend;
  sessionId: string;
}): Promise<string> {
  const frozen = getFrozenTranscript(ctx.db, ctx.sessionId);
  if (!frozen) {
    throw new Error(`session ${ctx.sessionId} has no frozen transcript to suggest a domain from`);
  }

  // session:add/amend-transcript already enforce MIN_WORDS, but this is a
  // separate entry point that doesn't go through analyzeSession()'s gates —
  // re-check here rather than trust that every caller upstream did, same
  // defense-in-depth stage0Chunk applies to its own already-gated input.
  const words = countWords(frozen.transcript.text);
  if (words < MIN_WORDS) {
    throw new Error(
      `session ${ctx.sessionId}'s transcript is ${words} words; at least ${MIN_WORDS} are required ` +
        `to suggest a domain from it.`,
    );
  }

  const result = await callTyped({
    client: ctx.client,
    db: ctx.db,
    sessionId: ctx.sessionId,
    stage: "suggest-domain",
    system: SUGGEST_DOMAIN_SYSTEM,
    user: buildSuggestDomainUser(frozen.transcript.text),
    schema: SuggestedDomainSchema,
    effort: "low",
  });

  return result.domain;
}
