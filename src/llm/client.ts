import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createHash } from "node:crypto";
import type { z } from "zod/v4";
import type { Db } from "../store/db.js";
import { recordEgress } from "../store/audit.js";
import type { LlmBackend, Effort } from "./backend.js";

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
  // Distinct sentinels: these are all materially different states that
  // JSON.stringify collapses to `undefined` or `null`. A compliance hash
  // must not treat them as equal.
  if (value === undefined) return '"__undefined__"';
  if (typeof value === "function") return '"__function__"';
  if (typeof value === "symbol") return '"__symbol__"';
  if (value === null) return "null";
  if (typeof value === "number" && !Number.isFinite(value)) {
    return `"__nonfinite:${String(value)}__"`;
  }
  // Dates have no own enumerable properties, so the object branch below
  // would render every Date as "{}".
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
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
 * Record what left the machine (or, for the local backend, what would have
 * — the row still records the request/response shape and token counts for
 * audit purposes, since the compliance promise is "we always log," not
 * "we only log when something actually left the machine").
 */
export function logEgress(
  db: Db,
  sessionId: string,
  stage: string,
  payload: unknown,
  usage: { input_tokens: number; output_tokens: number },
  model: string,
): void {
  recordEgress(db, {
    sessionId,
    stage,
    requestHash: hashRequest(payload),
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    model,
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

/**
 * Wraps the Anthropic SDK client to satisfy LlmBackend. The request shape
 * built here (model/max_tokens/output_config/messages, no temperature/top_p/
 * top_k/budget_tokens) is unchanged from callTyped's pre-refactor behavior —
 * only its location moved.
 */
export class AnthropicBackend implements LlmBackend {
  readonly model = MODEL;
  constructor(private readonly client: Anthropic) {}

  async generate(args: {
    system: string;
    user: string;
    schema: z.ZodType<unknown>;
    effort?: Effort;
  }) {
    const request = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: args.system,
      output_config: {
        effort: args.effort ?? "high",
        format: zodOutputFormat(args.schema),
      },
      messages: [{ role: "user" as const, content: args.user }],
    };

    const response = await this.client.messages.parse(request);
    const content = response.content ?? [];
    const raw = content.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("");

    return {
      raw,
      parsedOutput: response.parsed_output,
      requestPayload: request,
      usage: response.usage
        ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
        : undefined,
    };
  }
}
