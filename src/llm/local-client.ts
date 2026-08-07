// src/llm/local-client.ts
import {
  getLlama, resolveModelFile, LlamaChatSession,
  type Llama, type LlamaModel, type LlamaContext, type LlamaContextSequence, type GbnfJsonObjectSchema,
  type TokenMeterState,
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
 * Number of LlamaContextSequences the shared LlamaContext is created with
 * (see loadLocalBackend). node-llama-cpp defaults a context to a single
 * sequence slot (`getDefaultContextSequences()` / `LlamaContextOptions.
 * sequences` both default to 1) — since LocalBackend.generate() now claims
 * one sequence per call via `context.getSequence()` (see Finding 1 below)
 * and releases it when that call finishes, the context needs enough slots
 * for the highest number of generate() calls this codebase issues
 * concurrently against one LocalBackend/client, or getSequence() throws
 * ("no sequences left") instead of running. stage7-critique.ts runs all 4
 * REVIEWERS concurrently via Promise.all against a single shared client,
 * which is the highest concurrency in this codebase today — bump this if a
 * future caller needs more.
 */
export const MAX_CONCURRENT_SEQUENCES = 4;

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
    private readonly context: LlamaContext,
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
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    // One LlamaContextSequence per generate() CALL, not shared across calls
    // and not shared across concurrent callers: a sequence is a single
    // linear generation stream (KV-cache state), and stage7-critique.ts
    // runs 4 reviewers concurrently via Promise.all, all sharing this same
    // LocalBackend instance -> concurrent generate() calls. Handing every
    // concurrent LlamaChatSession the same shared sequence would let them
    // corrupt each other's KV-cache state. Retry attempts WITHIN this one
    // call intentionally keep sharing this sequence (only the
    // LlamaChatSession is recreated per attempt, see below) since those
    // attempts are sequential, not concurrent. See MAX_CONCURRENT_SEQUENCES
    // for the context capacity this depends on.
    const sequence: LlamaContextSequence = this.context.getSequence();

    try {
      // A freshly-obtained sequence's tokenMeter always starts at
      // {usedInputTokens: 0, usedOutputTokens: 0} (a new TokenMeter is
      // constructed for it unless the caller passes an internal-only
      // override this codebase never uses) — but snapshotting it explicitly
      // rather than assuming that keeps this correct even if that internal
      // default ever changes.
      const tokenMeterStart: TokenMeterState = sequence.tokenMeter.getState();

      // Inner retry loop for the empty-output reliability problem (Tasks 2-3
      // spike findings): grammar-constrained decoding at low temperature
      // reliably collapses to a trivially-valid empty-array completion for
      // these object-of-arrays schemas. Both grammar.parse() and the
      // caller's later schema.safeParse() succeed on that result (it IS
      // valid JSON matching the schema), so callTyped's outer
      // schema-validation retry loop has no way to detect this failure mode
      // — LocalBackend must catch it here before returning. This is
      // separate from and inner to that outer loop.
      for (let attempt = 0; attempt <= MAX_EMPTY_RETRIES; attempt++) {
        // A fresh session per attempt rather than reusing one: reusing the
        // same session would carry the previous (degenerate) attempt's
        // reply into this attempt's chat history, which could bias the next
        // draw. Each retry should be an independent draw at a bumped
        // temperature, not a continuation of a conversation containing a
        // bad answer. All attempts in this call still share `sequence`
        // above (sequential, not concurrent, so this is safe).
        const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: args.system });
        const temperature = BASE_TEMPERATURE + attempt * TEMPERATURE_STEP;

        try {
          raw = await session.prompt(args.user, { grammar, temperature, maxTokens: LOCAL_MAX_TOKENS });
        } finally {
          // Each attempt's session holds chat history and engine resources
          // until disposed; across up to MAX_EMPTY_RETRIES+1 attempts per
          // generate() call these must not accumulate unfreed. Does not
          // dispose `sequence` (default), since that is this generate()
          // call's responsibility (see outer finally below), not each
          // attempt's.
          session.dispose();
        }

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

      // tokenMeter tracks the ACTUAL tokens node-llama-cpp processed for
      // every session.prompt() call issued against `sequence` above,
      // including chat-template/role-formatting overhead that re-tokenizing
      // the raw system+user/output text ourselves would not capture. Every
      // attempt above (discarded retries included) ran against this same
      // shared-within-this-call sequence, so tokenMeter's running total
      // already reflects the sum across all of them by the time the loop
      // exits — one before/after diff here is equivalent to summing a
      // separate diff per attempt, without needing to snapshot after each
      // one individually.
      const tokenMeterDiff = sequence.tokenMeter.diff(tokenMeterStart);
      totalPromptTokens = tokenMeterDiff.usedInputTokens;
      totalCompletionTokens = tokenMeterDiff.usedOutputTokens;
    } finally {
      // Released at the end of this generate() call (not held for
      // LocalBackend's lifetime), so the next generate() call — including a
      // concurrent one already blocked on context.getSequence() — can claim
      // it. Runs even if the retry loop above throws or the last attempt
      // still failed.
      sequence.dispose();
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
  // throw from this step must dispose whatever was already successfully
  // allocated itself, or it leaks until process exit.
  let context: LlamaContext;
  try {
    // `sequences` must cover the highest number of concurrent generate()
    // calls this codebase issues against one LocalBackend (see
    // MAX_CONCURRENT_SEQUENCES) — LocalBackend.generate() now claims and
    // releases its own LlamaContextSequence per call (Finding 1) rather
    // than sharing one for this backend's lifetime, so the context needs
    // enough sequence slots for all of those calls to run at once, or
    // context.getSequence() throws for the callers beyond the first.
    context = await model.createContext({ sequences: MAX_CONCURRENT_SEQUENCES });
  } catch (err) {
    await model.dispose();
    throw err;
  }

  const backend = new LocalBackend(llama, model, context, CANDIDATE_MODEL_URI);
  const release = async () => {
    // Staged cleanup of three separate native/OS resources (the context's
    // KV cache, the loaded model weights, and the llama.cpp runtime itself)
    // — a throw from an earlier disposal step must not skip a later one, or
    // that resource leaks for the rest of the process's life. Nested so
    // context/model failures still let llama.dispose() run, and vice versa.
    try {
      try {
        await context.dispose();
      } finally {
        await model.dispose();
      }
    } finally {
      await llama.dispose();
    }
  };

  return { backend, release };
}
