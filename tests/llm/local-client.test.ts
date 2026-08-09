// tests/llm/local-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod/v4";

const mockGrammar = { parse: vi.fn() };
const mockSession = { prompt: vi.fn(), dispose: vi.fn() };
const mockLlama = { createGrammarForJsonSchema: vi.fn() };
const mockModel = { tokenize: vi.fn((t: string) => t.split(/\s+/)) };

// A TokenMeter-shaped mock: usedInputTokens/usedOutputTokens accumulate via
// useTokens() (mirroring the real node-llama-cpp TokenMeter, which tracks
// actual engine-processed tokens on a running total owned by the sequence),
// getState() snapshots them, and diff() computes the delta against a prior
// snapshot — exactly the shape LocalBackend.generate() now relies on for
// usage accounting instead of re-tokenizing raw text (Finding 3).
function makeMockTokenMeter() {
  let usedInputTokens = 0;
  let usedOutputTokens = 0;
  return {
    useTokens(tokens: number, type: "input" | "output") {
      if (type === "input") usedInputTokens += tokens;
      else usedOutputTokens += tokens;
    },
    getState: vi.fn(() => ({ usedInputTokens, usedOutputTokens })),
    diff: vi.fn((start: { usedInputTokens: number; usedOutputTokens: number }) => ({
      usedInputTokens: usedInputTokens - start.usedInputTokens,
      usedOutputTokens: usedOutputTokens - start.usedOutputTokens,
    })),
  };
}

// Each mockContext.getSequence() call returns a fresh sequence object (own
// tokenMeter, own dispose spy) — mirroring the real LlamaContext handing out
// independent LlamaContextSequences per call. This is exactly the behavior
// Finding 1 requires LocalBackend.generate() to rely on instead of sharing
// one sequence across the backend's whole lifetime.
function makeMockSequence() {
  return { dispose: vi.fn(), tokenMeter: makeMockTokenMeter() };
}
const mockContext = { getSequence: vi.fn(() => makeMockSequence()) };

vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(),
  resolveModelFile: vi.fn(),
  LlamaChatSession: vi.fn().mockImplementation(
    (opts: { contextSequence: ReturnType<typeof makeMockSequence>; systemPrompt: string }) => ({
      // Routes through the shared mockSession.prompt mock so existing tests
      // keep controlling return values via mockResolvedValue(Once), while
      // also simulating node-llama-cpp's real behavior: every prompt() call
      // advances the underlying sequence's tokenMeter by the tokens it
      // actually processed. Uses the same whitespace-split heuristic the
      // old tokenize()-based accounting used, so numeric token-count
      // assertions carry over unchanged while now exercising the
      // tokenMeter-diff code path (Finding 3) instead of re-tokenization.
      prompt: async (user: string, options: unknown) => {
        const raw: unknown = await mockSession.prompt(user, options);
        opts.contextSequence.tokenMeter.useTokens(`${opts.systemPrompt}\n\n${user}`.split(/\s+/).length, "input");
        opts.contextSequence.tokenMeter.useTokens(String(raw).split(/\s+/).length, "output");
        return raw;
      },
      dispose: mockSession.dispose,
    }),
  ),
}));

import { getLlama, resolveModelFile } from "node-llama-cpp";
import { LocalBackend, loadLocalBackend, MAX_CONCURRENT_SEQUENCES, LOCAL_MAX_TOKENS } from "../../src/llm/local-client.js";

describe("LocalBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLlama.createGrammarForJsonSchema.mockResolvedValue(mockGrammar);
    mockContext.getSequence.mockImplementation(() => makeMockSequence());
  });

  it("builds a grammar from the schema and returns the parsed output on valid generation", async () => {
    // Note: uses z.object({ ok: z.string() }), not the brief's literal
    // z.boolean() — zod-to-gbnf.ts (Task 1, out of scope here) only
    // supports "boolean" as the inner type of a nullable wrapper, not as a
    // bare top-level field; none of the six production schemas use a bare
    // boolean/number field either (only `.nullable()`-wrapped ones), so
    // this is a schema-shape fixture fix, not a behavior change.
    mockSession.prompt.mockResolvedValue('{"ok":"yes"}');
    mockGrammar.parse.mockReturnValue({ ok: "yes" });

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model");
    const result = await backend.generate({ system: "sys", user: "usr", schema: z.object({ ok: z.string() }) });

    expect(result.parsedOutput).toEqual({ ok: "yes" });
    expect(result.usage).toBeDefined();
    expect(result.usage?.input_tokens).toBeGreaterThan(0);
    expect(mockSession.prompt).toHaveBeenCalledWith("usr", expect.objectContaining({ grammar: mockGrammar }));
    // A single successful attempt should not trigger any retry.
    expect(mockSession.prompt).toHaveBeenCalledTimes(1);
  });

  it("returns parsedOutput null instead of throwing when grammar.parse fails", async () => {
    mockSession.prompt.mockResolvedValue("not valid json even under grammar");
    mockGrammar.parse.mockImplementation(() => {
      throw new Error("parse failed");
    });

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model");
    const result = await backend.generate({ system: "sys", user: "usr", schema: z.object({ ok: z.string() }) });

    expect(result.parsedOutput).toBeNull();
    expect(result.raw).toBe("not valid json even under grammar");
  });

  it("treats a grammar.parse throw the same as a degenerate-empty result, retrying at bumped temperature until a later attempt parses", async () => {
    // Attempt 0's raw fails grammar.parse (throws); attempt 1 produces real,
    // successfully-parsed content. This exercises the parse-throws path
    // through the retry loop specifically, distinct from the empty-array
    // path the other retry tests cover.
    mockSession.prompt
      .mockResolvedValueOnce("not valid json even under grammar")
      .mockResolvedValueOnce('{"ok":"yes"}');
    mockGrammar.parse
      .mockImplementationOnce(() => {
        throw new Error("parse failed");
      })
      .mockImplementationOnce((raw: string) => JSON.parse(raw) as unknown);

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model");
    const result = await backend.generate({ system: "sys", user: "usr", schema: z.object({ ok: z.string() }) });

    expect(result.parsedOutput).toEqual({ ok: "yes" });
    expect(mockSession.prompt).toHaveBeenCalledTimes(2);

    const calls = (mockSession.prompt as ReturnType<typeof vi.fn>).mock.calls;
    const firstOptions = calls[0]![1] as Record<string, unknown>;
    const secondOptions = calls[1]![1] as Record<string, unknown>;
    expect(firstOptions.temperature).toBeCloseTo(1.1, 5);
    expect(secondOptions.temperature).toBeCloseTo(1.4, 5);
    expect(secondOptions.temperature as number).toBeGreaterThan(firstOptions.temperature as number);
  });

  it("reports the configured model identifier", () => {
    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model");
    expect(backend.model).toBe("test-model");
  });

  it("uses LOCAL_MAX_TOKENS by default when no maxTokens override is given", async () => {
    mockSession.prompt.mockResolvedValue('{"ok":"yes"}');
    mockGrammar.parse.mockReturnValue({ ok: "yes" });

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model");
    await backend.generate({ system: "sys", user: "usr", schema: z.object({ ok: z.string() }) });

    const call = (mockSession.prompt as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((call[1] as Record<string, unknown>).maxTokens).toBe(LOCAL_MAX_TOKENS);
  });

  it("uses a caller-supplied maxTokens override instead of LOCAL_MAX_TOKENS — e.g. for a judge whose output legitimately exceeds any single pipeline stage's ceiling", async () => {
    mockSession.prompt.mockResolvedValue('{"ok":"yes"}');
    mockGrammar.parse.mockReturnValue({ ok: "yes" });

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model", 16000);
    await backend.generate({ system: "sys", user: "usr", schema: z.object({ ok: z.string() }) });

    const call = (mockSession.prompt as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((call[1] as Record<string, unknown>).maxTokens).toBe(16000);
  });

  it("retries at a bumped temperature when the first attempt is a degenerate-empty result, and returns the eventual non-empty output", async () => {
    // Attempt 0 collapses to the all-empty-arrays degeneracy the Task 2/3
    // spikes found at low temperature; attempt 1 produces real content.
    mockSession.prompt.mockResolvedValueOnce('{"items":[]}').mockResolvedValueOnce('{"items":["a"]}');
    mockGrammar.parse.mockImplementation((raw: string) => JSON.parse(raw) as unknown);

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model");
    const result = await backend.generate({
      system: "sys",
      user: "usr",
      schema: z.object({ items: z.array(z.string()) }),
    });

    expect(result.parsedOutput).toEqual({ items: ["a"] });
    expect(mockSession.prompt).toHaveBeenCalledTimes(2);

    const calls = (mockSession.prompt as ReturnType<typeof vi.fn>).mock.calls;
    const firstOptions = calls[0]![1] as Record<string, unknown>;
    const secondOptions = calls[1]![1] as Record<string, unknown>;
    // Must actually increase — not resend the same temperature and get lucky.
    expect(firstOptions.temperature).toBeCloseTo(1.1, 5);
    expect(secondOptions.temperature).toBeCloseTo(1.4, 5);
    expect(secondOptions.temperature as number).toBeGreaterThan(firstOptions.temperature as number);
  });

  it("accumulates usage across all attempts (discarded retries included), not just the final one, via the sequence's tokenMeter", async () => {
    // Attempt 0 is a degenerate-empty result (discarded and retried);
    // attempt 1 succeeds. Raws are deliberately different token counts (via
    // internal whitespace, which does not affect JSON.parse) so a correct
    // sum-across-attempts is distinguishable from a buggy last-attempt-only
    // count. Both attempts run against the SAME sequence (one sequence per
    // generate() call, shared across its sequential retry attempts — see
    // Finding 1), so its tokenMeter accumulates both attempts automatically;
    // this test is really asserting that the before/after tokenMeter diff at
    // the end of generate() correctly captures that running total.
    mockSession.prompt
      .mockResolvedValueOnce('{"items":[]}') // tokenizes (split on whitespace) to 1 token
      .mockResolvedValueOnce('{"items": ["a","b","c"]}'); // tokenizes to 2 tokens
    mockGrammar.parse.mockImplementation((raw: string) => JSON.parse(raw) as unknown);

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model");
    const result = await backend.generate({
      system: "sys",
      user: "usr",
      schema: z.object({ items: z.array(z.string()) }),
    });

    expect(mockSession.prompt).toHaveBeenCalledTimes(2);
    expect(result.parsedOutput).toEqual({ items: ["a", "b", "c"] });

    // Completion tokens: attempt 0 = 1, attempt 1 = 2 -> summed = 3.
    // A last-attempt-only bug would report 2.
    expect(result.usage?.output_tokens).toBe(3);

    // Prompt tokens: "sys\n\nusr" tokenizes to 2 per attempt; each attempt
    // constructs a fresh session and genuinely re-sends the full prompt, so
    // this should also be summed across both attempts (4), not just the
    // final one (2).
    expect(result.usage?.input_tokens).toBe(4);
  });

  it("does not re-tokenize raw text for usage accounting (Finding 3: uses the sequence's tokenMeter instead)", async () => {
    mockSession.prompt.mockResolvedValue('{"ok":"yes"}');
    mockGrammar.parse.mockReturnValue({ ok: "yes" });

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model");
    await backend.generate({ system: "sys", user: "usr", schema: z.object({ ok: z.string() }) });

    expect(mockModel.tokenize).not.toHaveBeenCalled();
  });

  it("gives up cleanly after exhausting retries and returns the last (still degenerate) attempt instead of throwing", async () => {
    mockSession.prompt.mockResolvedValue('{"items":[]}');
    mockGrammar.parse.mockImplementation((raw: string) => JSON.parse(raw) as unknown);

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model");
    const result = await backend.generate({
      system: "sys",
      user: "usr",
      schema: z.object({ items: z.array(z.string()) }),
    });

    // MAX_EMPTY_RETRIES=3 -> 4 total attempts (0..3 inclusive), all empty.
    expect(mockSession.prompt).toHaveBeenCalledTimes(4);
    expect(result.parsedOutput).toEqual({ items: [] });
    expect(result.raw).toBe('{"items":[]}');

    const calls = (mockSession.prompt as ReturnType<typeof vi.fn>).mock.calls;
    const temperatures = calls.map((c) => (c[1] as Record<string, unknown>).temperature as number);
    expect(temperatures).toHaveLength(4);
    [1.1, 1.4, 1.7, 2.0].forEach((expected, i) => {
      expect(temperatures[i]).toBeCloseTo(expected, 5);
    });
    // Strictly increasing, not the same value repeated.
    for (let i = 1; i < temperatures.length; i++) {
      expect(temperatures[i]!).toBeGreaterThan(temperatures[i - 1]!);
    }
  });

  it("Finding 1: allocates a fresh sequence per generate() call, not one shared for the backend's lifetime", async () => {
    mockSession.prompt.mockResolvedValue('{"ok":"yes"}');
    mockGrammar.parse.mockReturnValue({ ok: "yes" });

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model");
    await backend.generate({ system: "sys", user: "usr", schema: z.object({ ok: z.string() }) });
    await backend.generate({ system: "sys", user: "usr", schema: z.object({ ok: z.string() }) });

    // The core behavioral change: context.getSequence() must be called once
    // per generate() invocation (two calls here), not once total and reused
    // — a shared LlamaContextSequence across generate() calls is exactly the
    // corruption bug this finding fixes.
    expect(mockContext.getSequence).toHaveBeenCalledTimes(2);
  });

  it("Finding 1: gives each concurrent generate() call its own sequence (mirrors stage7-critique.ts's Promise.all over 4 reviewers)", async () => {
    mockSession.prompt.mockResolvedValue('{"ok":"yes"}');
    mockGrammar.parse.mockReturnValue({ ok: "yes" });

    const sequences: ReturnType<typeof makeMockSequence>[] = [];
    mockContext.getSequence.mockImplementation(() => {
      const seq = makeMockSequence();
      sequences.push(seq);
      return seq;
    });

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model");
    await Promise.all(
      Array.from({ length: 4 }, () =>
        backend.generate({ system: "sys", user: "usr", schema: z.object({ ok: z.string() }) }),
      ),
    );

    expect(mockContext.getSequence).toHaveBeenCalledTimes(4);
    expect(sequences).toHaveLength(4);
    // Every concurrently-claimed sequence is disposed exactly once, on its
    // own generate() call's completion.
    sequences.forEach((seq) => expect(seq.dispose).toHaveBeenCalledTimes(1));
  });

  it("Finding 1: disposes the (single, shared-across-retries) sequence once generate() completes", async () => {
    // Attempt 0 is degenerate-empty (discarded, retried); attempt 1
    // succeeds. Both attempts must share one sequence (see the
    // accumulates-usage test above), so exactly one sequence should be
    // claimed and disposed for this whole generate() call, not one per
    // attempt.
    mockSession.prompt.mockResolvedValueOnce('{"items":[]}').mockResolvedValueOnce('{"items":["a"]}');
    mockGrammar.parse.mockImplementation((raw: string) => JSON.parse(raw) as unknown);

    const sequences: ReturnType<typeof makeMockSequence>[] = [];
    mockContext.getSequence.mockImplementation(() => {
      const seq = makeMockSequence();
      sequences.push(seq);
      return seq;
    });

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model");
    await backend.generate({ system: "sys", user: "usr", schema: z.object({ items: z.array(z.string()) }) });

    expect(sequences).toHaveLength(1);
    expect(sequences[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it("Finding 1: disposes the sequence even when session.prompt() throws", async () => {
    mockSession.prompt.mockRejectedValue(new Error("engine crashed"));

    const sequences: ReturnType<typeof makeMockSequence>[] = [];
    mockContext.getSequence.mockImplementation(() => {
      const seq = makeMockSequence();
      sequences.push(seq);
      return seq;
    });

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockContext as never, "test-model");
    await expect(
      backend.generate({ system: "sys", user: "usr", schema: z.object({ ok: z.string() }) }),
    ).rejects.toThrow("engine crashed");

    expect(sequences).toHaveLength(1);
    expect(sequences[0]!.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("loadLocalBackend", () => {
  const mockLlamaInstance = { loadModel: vi.fn(), dispose: vi.fn() };
  const mockLoadedModel = { createContext: vi.fn(), dispose: vi.fn() };
  const mockLoadedContext = { getSequence: vi.fn(() => makeMockSequence()), dispose: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveModelFile).mockResolvedValue("/fake/model/path.gguf" as never);
    vi.mocked(getLlama).mockResolvedValue(mockLlamaInstance as never);
    mockLlamaInstance.loadModel.mockResolvedValue(mockLoadedModel as never);
    mockLlamaInstance.dispose.mockResolvedValue(undefined);
    mockLoadedModel.createContext.mockResolvedValue(mockLoadedContext as never);
    mockLoadedModel.dispose.mockResolvedValue(undefined);
    mockLoadedContext.dispose.mockResolvedValue(undefined);
  });

  it("returns a working backend wired to the created context", async () => {
    const { backend, release } = await loadLocalBackend();
    expect(backend).toBeInstanceOf(LocalBackend);
    await release();
  });

  it("Finding 1 (companion fix): creates the context with enough sequence slots for this codebase's known concurrent generate() callers", async () => {
    const { release } = await loadLocalBackend();
    // Each generate() call now claims its own LlamaContextSequence (Finding
    // 1); node-llama-cpp defaults a context to a single sequence slot, which
    // would make context.getSequence() throw for every concurrent caller
    // past the first. stage7-critique.ts runs 4 reviewers concurrently
    // against one shared client, so the context must be created with
    // capacity for at least that many.
    expect(mockLoadedModel.createContext).toHaveBeenCalledWith(
      expect.objectContaining({ sequences: MAX_CONCURRENT_SEQUENCES }),
    );
    await release();
  });

  it("Finding 2: release() disposes the context, the model, and the llama runtime itself", async () => {
    const { release } = await loadLocalBackend();
    await release();

    expect(mockLoadedContext.dispose).toHaveBeenCalledTimes(1);
    expect(mockLoadedModel.dispose).toHaveBeenCalledTimes(1);
    expect(mockLlamaInstance.dispose).toHaveBeenCalledTimes(1);
  });

  it("Finding 2: release() still disposes the model and the llama runtime if context.dispose() throws", async () => {
    mockLoadedContext.dispose.mockRejectedValueOnce(new Error("context dispose failed"));

    const { release } = await loadLocalBackend();
    await expect(release()).rejects.toThrow("context dispose failed");

    expect(mockLoadedModel.dispose).toHaveBeenCalledTimes(1);
    expect(mockLlamaInstance.dispose).toHaveBeenCalledTimes(1);
  });

  it("Finding 2: release() still disposes the llama runtime if model.dispose() throws", async () => {
    mockLoadedModel.dispose.mockRejectedValueOnce(new Error("model dispose failed"));

    const { release } = await loadLocalBackend();
    await expect(release()).rejects.toThrow("model dispose failed");

    expect(mockLoadedContext.dispose).toHaveBeenCalledTimes(1);
    expect(mockLlamaInstance.dispose).toHaveBeenCalledTimes(1);
  });

  it("resolves the default production model URI when no modelUri override is given", async () => {
    const { release } = await loadLocalBackend();
    expect(vi.mocked(resolveModelFile)).toHaveBeenCalledWith(
      "hf:bartowski/Qwen2.5-7B-Instruct-GGUF/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
      expect.anything(),
    );
    await release();
  });

  it("resolves a caller-supplied modelUri instead of the production model — e.g. for loading a genuinely different eval-judge model", async () => {
    const judgeUri = "hf:some-org/Llama-3.2-3B-Instruct-GGUF:Q4_K_M";
    const { backend, release } = await loadLocalBackend({ modelUri: judgeUri });
    expect(vi.mocked(resolveModelFile)).toHaveBeenCalledWith(judgeUri, expect.anything());
    // The returned backend's own .model identifier reflects the requested
    // judge model, not the production one — this is what
    // checkJudgeIndependence() compares against the generator's model.
    expect(backend.model).toBe(judgeUri);
    await release();
  });

  it("passes a caller-supplied contextSize through to createContext, and omits it entirely when not given (so node-llama-cpp's own default applies)", async () => {
    const { release: release1 } = await loadLocalBackend();
    expect(mockLoadedModel.createContext).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ contextSize: expect.anything() }),
    );
    await release1();

    vi.clearAllMocks();
    mockLoadedModel.createContext.mockResolvedValue(mockLoadedContext as never);
    const { release: release2 } = await loadLocalBackend({ contextSize: 16000 });
    expect(mockLoadedModel.createContext).toHaveBeenCalledWith(expect.objectContaining({ contextSize: 16000 }));
    await release2();
  });

  it("passes a caller-supplied sequences count through to createContext instead of the production MAX_CONCURRENT_SEQUENCES default — e.g. 1 for a single sequential judge call, avoiding unused KV-cache sequence-slot allocation", async () => {
    const { release } = await loadLocalBackend({ sequences: 1 });
    expect(mockLoadedModel.createContext).toHaveBeenCalledWith(expect.objectContaining({ sequences: 1 }));
    await release();
  });

  it("threads a caller-supplied maxTokens through to the returned backend's generate() calls", async () => {
    mockSession.prompt.mockResolvedValue('{"ok":"yes"}');
    mockGrammar.parse.mockReturnValue({ ok: "yes" });
    mockLoadedContext.getSequence.mockImplementation(() => makeMockSequence());
    // This is the only test in this describe block that actually exercises
    // backend.generate() (the others only assert on loadLocalBackend()'s
    // own resolve/createContext/release plumbing), so it's the only one
    // that needs the loaded llama instance's createGrammarForJsonSchema
    // mocked — the module-level `mockLlama` used by the LocalBackend
    // describe block above is a separate object from this describe
    // block's `mockLlamaInstance` (the getLlama() return value).
    (mockLlamaInstance as unknown as { createGrammarForJsonSchema: ReturnType<typeof vi.fn> }).createGrammarForJsonSchema =
      vi.fn().mockResolvedValue(mockGrammar);

    const { backend, release } = await loadLocalBackend({ maxTokens: 16000 });
    await backend.generate({ system: "sys", user: "usr", schema: z.object({ ok: z.string() }) });

    const call = (mockSession.prompt as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((call[1] as Record<string, unknown>).maxTokens).toBe(16000);
    await release();
  });
});
