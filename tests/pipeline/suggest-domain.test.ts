import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { suggestProjectDomain } from "../../src/pipeline/suggest-domain.js";
import { SUGGEST_DOMAIN_SYSTEM, buildSuggestDomainUser } from "../../src/prompts/suggest-domain.js";
import type { LlmBackend } from "../../src/llm/backend.js";

const LONG = Array.from({ length: 40 }, (_, i) =>
  `Client: point number ${i} about freight invoicing for logistics operators across the EU, covering approval thresholds and routing rules in some detail. We need to support multiple carriers and currencies with audit trails for every adjustment.`,
).join("\n\n");

function mockBackend(domain: string): { client: LlmBackend; generate: ReturnType<typeof vi.fn> } {
  const generate = vi.fn().mockResolvedValue({
    raw: JSON.stringify({ domain }),
    parsedOutput: { domain },
    requestPayload: {},
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  return { client: { model: "test", generate }, generate };
}

describe("SUGGEST_DOMAIN_SYSTEM", () => {
  it("instructs the model not to invent an industry the transcript doesn't support", () => {
    expect(SUGGEST_DOMAIN_SYSTEM).toMatch(/do not invent/i);
  });
});

describe("buildSuggestDomainUser", () => {
  it("includes the full transcript text when short", () => {
    const user = buildSuggestDomainUser("Client: we need invoice approval workflows.");
    expect(user).toContain("Client: we need invoice approval workflows.");
    expect(user).not.toMatch(/truncated/i);
  });

  it("truncates transcripts longer than the per-call word budget", () => {
    const words = Array.from({ length: 2500 }, (_, i) => `word${i}`).join(" ");
    const user = buildSuggestDomainUser(words);
    expect(user).toMatch(/truncated/i);
    expect(user).toContain("word0");
    expect(user).not.toContain("word2499");
  });

  it("bounds a pathological single unbroken 'word' with a character backstop", () => {
    // 200 words satisfying MIN_WORDS by count, but one is enormous — the
    // word-count truncation alone wouldn't catch this.
    const hugeToken = "x".repeat(500_000);
    const text = `${hugeToken} ${Array.from({ length: 199 }, (_, i) => `word${i}`).join(" ")}`;
    const user = buildSuggestDomainUser(text);
    expect(user).toMatch(/truncated/i);
    expect(user.length).toBeLessThan(25_000);
  });

  it("does not crash on empty or whitespace-only text", () => {
    expect(() => buildSuggestDomainUser("")).not.toThrow();
    expect(() => buildSuggestDomainUser("   \n\t  ")).not.toThrow();
  });
});

describe("suggestProjectDomain", () => {
  it("throws when the session has no frozen transcript", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { client } = mockBackend("irrelevant");
    await expect(
      suggestProjectDomain({ db, client, sessionId: s.id }),
    ).rejects.toThrow(/no frozen transcript/);
  });

  it("throws when the transcript is below the minimum word count, without calling the model", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: "too short" });
    freezeTranscript(db, transcript.id);

    const { client, generate } = mockBackend("irrelevant");
    await expect(
      suggestProjectDomain({ db, client, sessionId: s.id }),
    ).rejects.toThrow(/200/);
    expect(generate).not.toHaveBeenCalled();
  });

  it("returns the model's suggested domain, grounded in the session's transcript", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: LONG });
    freezeTranscript(db, transcript.id);

    const { client, generate } = mockBackend("Freight invoicing for EU logistics operators");
    const domain = await suggestProjectDomain({ db, client, sessionId: s.id });

    expect(domain).toBe("Freight invoicing for EU logistics operators");
    expect(generate).toHaveBeenCalledTimes(1);
    const call = generate.mock.calls[0]![0];
    expect(call.system).toBe(SUGGEST_DOMAIN_SYSTEM);
    expect(call.user).toContain("freight invoicing for logistics operators");
  });
});
