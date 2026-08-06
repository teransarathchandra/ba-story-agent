import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import type { Db } from "../store/db.js";
import { recordEgress } from "../store/audit.js";

/** The only model this engine targets. Never append a date suffix. */
export const MODEL = "claude-opus-5";

/** Non-streaming ceiling for every pipeline call. */
export const MAX_TOKENS = 16000;

export function createClient(opts?: {
  apiKey?: string;
  maxRetries?: number;
  timeoutMs?: number;
}): Anthropic {
  return new Anthropic({
    ...(opts?.apiKey ? { apiKey: opts.apiKey } : {}),
    // The SDK already retries 408/409/429/5xx with exponential backoff.
    maxRetries: opts?.maxRetries ?? 3,
    // NOTE: the TypeScript SDK takes milliseconds, unlike the Python SDK.
    timeout: opts?.timeoutMs ?? 10 * 60 * 1000,
  });
}

/** Canonical JSON stringify with sorted keys, so hashes are order-independent. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function hashRequest(payload: unknown): string {
  return createHash("sha256").update(canonical(payload), "utf8").digest("hex");
}

/**
 * Record what left the machine. This is the compliance artifact: when a client
 * asks what was sent to an AI service, the answer is this table.
 */
export function logEgress(
  db: Db,
  sessionId: string,
  stage: string,
  payload: unknown,
  usage: { input_tokens: number; output_tokens: number },
): void {
  recordEgress(db, {
    sessionId,
    stage,
    requestHash: hashRequest(payload),
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    model: MODEL,
  });
}

/**
 * Count input tokens using the API. Never approximate from character counts
 * and never use tiktoken — both are wrong for Claude.
 */
export async function estimateInputTokens(
  client: Anthropic,
  system: string,
  userText: string,
): Promise<number> {
  const res = await client.messages.countTokens({
    model: MODEL,
    system,
    messages: [{ role: "user", content: userText }],
  });
  return res.input_tokens;
}
