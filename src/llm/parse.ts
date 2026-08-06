import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { Db } from "../store/db.js";
import { MODEL, MAX_TOKENS, logEgress } from "./client.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class StageFailure extends Error {
  constructor(
    readonly stage: string,
    message: string,
    readonly rawResponse: string | null,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StageFailure";
  }
}

const MAX_SCHEMA_RETRIES = 2;

/**
 * One typed structured-output call.
 *
 * Deliberately absent: `temperature`, `top_p`, `top_k` (all return 400 on
 * claude-opus-5) and `thinking.budget_tokens` (also 400 — thinking is on by
 * default; depth is controlled with `output_config.effort`).
 *
 * On a malformed payload the validation error is appended to the next
 * attempt's user turn, so the model is told exactly what was wrong rather
 * than being asked to guess. After MAX_SCHEMA_RETRIES the raw response is
 * preserved on the thrown StageFailure for inspection instead of being
 * silently dropped.
 */
export async function callTyped<T>(args: {
  client: Anthropic;
  db: Db;
  sessionId: string;
  stage: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  effort?: Effort;
}): Promise<T> {
  const { client, db, sessionId, stage, system, schema } = args;
  let user = args.user;
  let lastRaw: string | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= MAX_SCHEMA_RETRIES; attempt++) {
    const request = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      output_config: {
        effort: args.effort ?? "high",
        format: zodOutputFormat(schema as never),
      },
      messages: [{ role: "user" as const, content: user }],
    };

    const response = await client.messages.parse(request);

    const usage = (response as { usage?: { input_tokens: number; output_tokens: number } }).usage;
    if (usage) logEgress(db, sessionId, stage, request, usage);

    const content = (response as { content?: { type: string; text?: string }[] }).content ?? [];
    lastRaw = content.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("");

    const parsedOutput = (response as { parsed_output?: unknown }).parsed_output;
    if (parsedOutput === null || parsedOutput === undefined) {
      lastError = new Error("parsed_output was null — the model returned no schema-conforming JSON");
    } else {
      const result = schema.safeParse(parsedOutput);
      if (result.success) return result.data;
      lastError = result.error;
    }

    if (attempt < MAX_SCHEMA_RETRIES) {
      user =
        `${args.user}\n\n` +
        `Your previous response did not conform to the required schema. ` +
        `The validation error was:\n${String(lastError)}\n` +
        `Return a response that satisfies the schema exactly.`;
    }
  }

  throw new StageFailure(
    stage,
    `stage "${stage}" produced no schema-conforming output after ${MAX_SCHEMA_RETRIES + 1} attempts`,
    lastRaw,
    lastError,
  );
}
