// tests/llm/local-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod/v4";

const mockGrammar = { parse: vi.fn() };
const mockSession = { prompt: vi.fn(), dispose: vi.fn() };
const mockLlama = { createGrammarForJsonSchema: vi.fn() };
const mockModel = { tokenize: vi.fn((t: string) => t.split(/\s+/)) };
const mockSequence = {};

vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(),
  resolveModelFile: vi.fn(),
  LlamaChatSession: vi.fn().mockImplementation(() => mockSession),
}));

import { LocalBackend } from "../../src/llm/local-client.js";

describe("LocalBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLlama.createGrammarForJsonSchema.mockResolvedValue(mockGrammar);
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

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockSequence as never, "test-model");
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

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockSequence as never, "test-model");
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

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockSequence as never, "test-model");
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
    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockSequence as never, "test-model");
    expect(backend.model).toBe("test-model");
  });

  it("retries at a bumped temperature when the first attempt is a degenerate-empty result, and returns the eventual non-empty output", async () => {
    // Attempt 0 collapses to the all-empty-arrays degeneracy the Task 2/3
    // spikes found at low temperature; attempt 1 produces real content.
    mockSession.prompt.mockResolvedValueOnce('{"items":[]}').mockResolvedValueOnce('{"items":["a"]}');
    mockGrammar.parse.mockImplementation((raw: string) => JSON.parse(raw) as unknown);

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockSequence as never, "test-model");
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

  it("accumulates usage across all attempts (discarded retries included), not just the final one", async () => {
    // Attempt 0 is a degenerate-empty result (discarded and retried);
    // attempt 1 succeeds. Raws are deliberately different token counts (via
    // internal whitespace, which does not affect JSON.parse) so a correct
    // sum-across-attempts is distinguishable from a buggy last-attempt-only
    // count.
    mockSession.prompt
      .mockResolvedValueOnce('{"items":[]}') // tokenizes (split on whitespace) to 1 token
      .mockResolvedValueOnce('{"items": ["a","b","c"]}'); // tokenizes to 2 tokens
    mockGrammar.parse.mockImplementation((raw: string) => JSON.parse(raw) as unknown);

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockSequence as never, "test-model");
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

  it("gives up cleanly after exhausting retries and returns the last (still degenerate) attempt instead of throwing", async () => {
    mockSession.prompt.mockResolvedValue('{"items":[]}');
    mockGrammar.parse.mockImplementation((raw: string) => JSON.parse(raw) as unknown);

    const backend = new LocalBackend(mockLlama as never, mockModel as never, mockSequence as never, "test-model");
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
});
