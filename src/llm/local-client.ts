// src/llm/local-client.ts
import {
  getLlama, resolveModelFile, LlamaChatSession,
  type Llama, type LlamaModel, type LlamaContext, type LlamaContextSequence, type GbnfJsonObjectSchema,
} from "node-llama-cpp";
import type { z } from "zod/v4";
import type { LlmBackend, Effort } from "./backend.js";
import { zodToGbnfSchema } from "./zod-to-gbnf.js";

type Log = (line: string) => void;

/**
 * Starting candidate from the Task 1-3 compatibility spike — see
 * docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md for why,
 * and re-check that doc before changing this without re-running the spike.
 */
const CANDIDATE_MODEL_URI = "hf:bartowski/Qwen2.5-7B-Instruct-GGUF/Qwen2.5-7B-Instruct-Q4_K_M.gguf";

/**
 * Ceiling for a single local generation call. Grounded in Task 3's one real,
 * verified throughput measurement (ExtractedClaimsSchema, CPU-only,
 * temperature 1.1: 10.5 tok/s) and a target worst-case single-call wait of
 * ~3 minutes for a CLI tool a human is plausibly waiting on:
 *   3 min * 60s * 10.5 tok/s ~= 1890 tokens -> rounded up to 2048
 *   (2048 / 10.5 tok/s ~= 195s ~= 3.25 min worst case).
 * See docs/superpowers/plans/2026-08-07-local-llm-spike-findings.md,
 * "## Constants decided by the spike" for the full derivation and caveats
 * (this bounds worst-case wait time only — it does not address the
 * empty-output reliability problem the retry loop below handles).
 */
export const LOCAL_MAX_TOKENS = 2048;

/**
 * Starting temperature for generation. Task 2's spike found this value
 * produced real, non-empty output for ExtractedClaimsSchema; Task 3's sweep
 * found no single temperature reliably works across all six production
 * schemas, so this is a starting point for the retry ladder below, not a
 * solved constant.
 */
const BASE_TEMPERATURE = 1.1;
/** How much to raise temperature on each empty-result retry. */
const TEMPERATURE_STEP = 0.3;
/** Total attempts = MAX_EMPTY_RETRIES + 1 (one base attempt + this many retries). */
const MAX_EMPTY_RETRIES = 3;

/**
 * True when every array-valued property in a parsed grammar result is
 * empty — the degenerate completion node-llama-cpp's grammar-constrained
 * decoding collapses to at low temperature (see Tasks 2-3 spike findings).
 * All six production schemas are objects whose properties are arrays, so
 * this check is schema-shape-generic rather than needing per-schema logic.
 */
function isDegenerateEmpty(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  const values = Object.values(value as Record<string, unknown>);
  if (values.length === 0) return true;
  return values.every((v) => Array.isArray(v) && v.length === 0);
}

export class LocalBackend implements LlmBackend {
  constructor(
    private readonly llama: Llama,
    private readonly llamaModel: LlamaModel,
    private readonly sequence: LlamaContextSequence,
    readonly model: string,
  ) {}

  async generate(args: {
    system: string;
    user: string;
    schema: z.ZodType<unknown>;
    effort?: Effort;
  }) {
    // node-llama-cpp's createGrammarForJsonSchema<const T extends GbnfJsonSchema<Defs>>
    // needs a literal type to infer T from; zodToGbnfSchema's declared return
    // type is the widened GbnfJsonSchema union, which TS cannot distribute
    // that generic constraint over, so passing it directly does not
    // type-check. All six production schemas are z.object({...})-rooted, so
    // at runtime this value is always actually a GbnfJsonObjectSchema — this
    // cast narrows to that true runtime shape, it is not papering over a
    // real mismatch.
    const gbnfSchema = zodToGbnfSchema(args.schema) as GbnfJsonObjectSchema;
    const grammar = await this.llama.createGrammarForJsonSchema(gbnfSchema);

    let raw = "";
    let parsedOutput: unknown = null;
    // Every attempt — discarded retries included — is a real generation
    // that consumed real compute and belongs in egress_log's audit trail.
    // A fresh LlamaChatSession is constructed per attempt (see below), so
    // each attempt genuinely re-sends the full system+user prompt to the
    // model rather than continuing a shared history; totals here must sum
    // across all attempts, not just report the final one.
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    // Inner retry loop for the empty-output reliability problem (Tasks 2-3
    // spike findings): grammar-constrained decoding at low temperature
    // reliably collapses to a trivially-valid empty-array completion for
    // these object-of-arrays schemas. Both grammar.parse() and the caller's
    // later schema.safeParse() succeed on that result (it IS valid JSON
    // matching the schema), so callTyped's outer schema-validation retry
    // loop has no way to detect this failure mode — LocalBackend must catch
    // it here before returning. This is separate from and inner to that
    // outer loop.
    for (let attempt = 0; attempt <= MAX_EMPTY_RETRIES; attempt++) {
      // A fresh session per attempt rather than reusing one: reusing the
      // same session would carry the previous (degenerate) attempt's reply
      // into this attempt's chat history, which could bias the next draw.
      // Each retry should be an independent draw at a bumped temperature,
      // not a continuation of a conversation containing a bad answer.
      const session = new LlamaChatSession({ contextSequence: this.sequence, systemPrompt: args.system });
      const temperature = BASE_TEMPERATURE + attempt * TEMPERATURE_STEP;

      try {
        raw = await session.prompt(args.user, { grammar, temperature, maxTokens: LOCAL_MAX_TOKENS });
      } finally {
        // Each attempt's session holds chat history and engine resources
        // until disposed; across up to MAX_EMPTY_RETRIES+1 attempts per
        // generate() call these must not accumulate unfreed. Does not
        // dispose the shared contextSequence (default), since that is
        // owned and released by loadLocalBackend, not per-attempt.
        session.dispose();
      }

      totalPromptTokens += this.llamaModel.tokenize(`${args.system}\n\n${args.user}`).length;
      totalCompletionTokens += this.llamaModel.tokenize(raw).length;

      try {
        parsedOutput = grammar.parse(raw);
      } catch {
        parsedOutput = null;
      }

      if (parsedOutput !== null && parsedOutput !== undefined && !isDegenerateEmpty(parsedOutput)) {
        break;
      }
      // Otherwise fall through and retry at a bumped temperature, unless
      // this was the last attempt — in which case we exit the loop and
      // report this attempt's (null or degenerate-empty) result honestly.
      // LocalBackend does not throw here: callTyped's outer retry loop and
      // eventual StageFailure are what handle a truly unrecoverable case.
    }

    return {
      raw,
      parsedOutput,
      requestPayload: { system: args.system, user: args.user },
      usage: { input_tokens: totalPromptTokens, output_tokens: totalCompletionTokens },
    };
  }
}

/**
 * Resolves (downloading on first use), loads, and prepares a local model for
 * one analyzeSession run. Load once, reuse across every stage call in that
 * run, release after — reloading a multi-GB model per stage call would be
 * far too slow. Download progress reports through the same Log callback
 * pattern buildProgram already uses elsewhere in the CLI.
 */
export async function loadLocalBackend(opts?: { log?: Log }): Promise<{
  backend: LocalBackend;
  release: () => Promise<void>;
}> {
  const log = opts?.log ?? (() => {});

  const modelPath = await resolveModelFile(CANDIDATE_MODEL_URI, {
    cli: false,
    onProgress: (status) => {
      const pct = status.totalSize > 0 ? ((status.downloadedSize / status.totalSize) * 100).toFixed(1) : "?";
      log(`Downloading local model: ${pct}%`);
    },
  });

  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });

  // No `release` handle exists yet at this point in construction, so a
  // throw from either step below must dispose whatever was already
  // successfully allocated itself, or it leaks until process exit.
  let context: LlamaContext;
  try {
    context = await model.createContext();
  } catch (err) {
    await model.dispose();
    throw err;
  }

  let sequence: LlamaContextSequence;
  try {
    sequence = context.getSequence();
  } catch (err) {
    try {
      await context.dispose();
    } finally {
      await model.dispose();
    }
    throw err;
  }

  const backend = new LocalBackend(llama, model, sequence, CANDIDATE_MODEL_URI);
  const release = async () => {
    // If context.dispose() throws, model.dispose() must still run —
    // otherwise the model leaks for the rest of the process's life.
    try {
      await context.dispose();
    } finally {
      await model.dispose();
    }
  };

  return { backend, release };
}
