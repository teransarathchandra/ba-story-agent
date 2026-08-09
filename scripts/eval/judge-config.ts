// Shared judge-configuration types/constants used by BOTH the single-call
// path (gold-match.ts) and the bounded local-batch path
// (gold-local-judge-batching.ts). Lives in its own module so those two
// files can import it without a circular runtime dependency (gold-match.ts
// calls into gold-local-judge-batching.ts for the local backend; the
// reverse would create a cycle if this lived in gold-match.ts itself).
export interface JudgeConfig {
  backendLabel: string;
  model: string;
  /** LOCAL judge only — passed through to loadLocalBackend()'s contextSize. Undefined lets node-llama-cpp use the model's own trained context. */
  contextSize?: number;
  /** LOCAL judge only — passed through to loadLocalBackend()'s maxTokens (the output-token ceiling for each judge generate() call). */
  maxOutputTokens?: number;
}

/**
 * Default output-token ceiling for a LOCAL judge call — deliberately
 * distinct from and much larger than LOCAL_MAX_TOKENS (2048, the
 * production per-stage default in src/llm/local-client.ts). Applies to
 * both the legacy single-call shape and each individual batch call in the
 * bounded-batching path; a single batch's response is far smaller than the
 * old monolithic response, but this ceiling is deliberately generous
 * rather than tuned down, since under-provisioning it would silently
 * truncate a judge response instead of failing loudly.
 */
export const DEFAULT_JUDGE_MAX_OUTPUT_TOKENS = 8192;
