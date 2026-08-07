// src/llm/backend.ts
import type { z } from "zod/v4";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * One provider-specific generation attempt. Implementations do not retry —
 * callTyped owns the shared retry loop across every backend, so a backend
 * only needs to make one honest attempt and report what happened.
 */
export interface LlmBackend {
  /** Recorded in egress_log.model for every call this backend makes. */
  readonly model: string;
  generate(args: {
    system: string;
    user: string;
    schema: z.ZodType<unknown>;
    effort?: Effort;
  }): Promise<{
    /** Raw text response, preserved on StageFailure for inspection. */
    raw: string;
    /** Parsed-but-not-yet-Zod-validated output. null/undefined means the model produced no schema-shaped output at all. */
    parsedOutput: unknown;
    /** Hashed into egress_log.request_hash — "what was sent," in whatever shape this backend actually sends. */
    requestPayload: unknown;
    /** Omitted when the provider reports no usage for this call — callTyped then skips logging egress for that attempt, matching current behavior. */
    usage?: { input_tokens: number; output_tokens: number };
  }>;
}
