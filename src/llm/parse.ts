import type { Db } from "../store/db.js";
import type { z } from "zod/v4";
import type { LlmBackend, Effort } from "./backend.js";
import { logEgress } from "./client.js";

export type { Effort } from "./backend.js";

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
 * One typed structured-output call, backend-agnostic. The retry loop, error
 * feedback, and StageFailure contract are unchanged from before this
 * refactor — only the request-building and response-parsing moved into
 * whichever LlmBackend is passed in.
 */
export async function callTyped<T>(args: {
  client: LlmBackend;
  db: Db;
  sessionId: string;
  stage: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  effort?: Effort;
}): Promise<T> {
  const { client: backend, db, sessionId, stage, schema } = args;
  let user = args.user;
  let lastRaw: string | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= MAX_SCHEMA_RETRIES; attempt++) {
    const result = await backend.generate({
      system: args.system,
      user,
      schema: schema as z.ZodType<unknown>,
      effort: args.effort,
    });
    lastRaw = result.raw;

    if (result.usage) {
      logEgress(db, sessionId, stage, result.requestPayload, result.usage, backend.model);
    }

    if (result.parsedOutput === null || result.parsedOutput === undefined) {
      lastError = new Error("parsed_output was null — the model returned no schema-conforming JSON");
    } else {
      const parsed = schema.safeParse(result.parsedOutput);
      if (parsed.success) return parsed.data;
      lastError = parsed.error;
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
