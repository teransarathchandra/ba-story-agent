// tests/pipeline/stage7-critique.test.ts
import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertRequirements } from "../../src/store/artifacts.js";
import { listQuestions, listRecommendations } from "../../src/store/findings.js";
import { CritiqueFindingsSchema, REVIEWERS, stage7Critique } from "../../src/pipeline/stage7-critique.js";
import { emptyState } from "../../src/pipeline/state.js";
import { newId } from "../../src/types/ids.js";
import type { StageContext } from "../../src/pipeline/runner.js";

function setup(regulatoryContext: "none" | "GDPR" = "none") {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators", regulatoryContext });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
  freezeTranscript(db, transcript.id);
  insertRequirements(db, [{
    id: newId("req"), projectId: p.id, key: "REQ-001",
    statement: "Invoices over EUR 10,000 must be approved by a manager.",
    status: "proposed", origin: "client-stated", originClaimIds: ["clm_a"],
    supersedesId: null, createdAt: new Date().toISOString(),
  }]);
  const parse = vi.fn().mockResolvedValue({
    raw: "{}",
    parsedOutput: {
      questions: [{ text: "Is an audit trail required for approvals?", category: "security" }],
      recommendations: [{ text: "Approval actions need an immutable audit trail.", rationale: "Financial approval with no audit mechanism discussed.", category: "security" }],
    },
    requestPayload: {},
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
  return { ctx, parse, state: emptyState(transcript.id) };
}

describe("CritiqueFindingsSchema — the structural control", () => {
  it("has exactly two top-level fields: questions and recommendations", () => {
    expect(Object.keys(CritiqueFindingsSchema.shape).sort()).toEqual(["questions", "recommendations"]);
  });

  it("has NO field in which a requirement can be expressed", () => {
    const json = JSON.stringify(CritiqueFindingsSchema.shape);
    for (const forbidden of ["requirement", "statement", "acceptanceCriteri", "story"]) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("strips a smuggled requirements array so it cannot reach the store", () => {
    const parsed = CritiqueFindingsSchema.safeParse({
      questions: [], recommendations: [], requirements: [{ statement: "sneaky" }],
    });
    // Zod strips unknown keys rather than erroring, so the parse succeeds —
    // what matters is that the requirement is gone from the parsed output.
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("requirements");
    expect(JSON.stringify(parsed.data)).not.toContain("sneaky");
  });
});

describe("REVIEWERS", () => {
  it("has four reviewers", () => {
    expect(REVIEWERS).toHaveLength(4);
    expect(REVIEWERS.map((r) => r.name).sort()).toEqual(
      ["compliance", "domain", "security-privacy", "testability"],
    );
  });

  it("gives the compliance reviewer a stop instruction when no jurisdiction is set", () => {
    const compliance = REVIEWERS.find((r) => r.name === "compliance")!;
    const prompt = compliance.system({ regulatoryContext: "none" } as never);
    expect(prompt).toMatch(/do not (infer|guess|name) a jurisdiction/i);
  });
});

describe("stage7Critique", () => {
  it("runs all four reviewers and persists their findings", async () => {
    const { ctx, parse, state } = setup();
    const out = await stage7Critique.run(ctx, state);
    expect(parse).toHaveBeenCalledTimes(4);
    expect(listQuestions(ctx.db, ctx.projectId)).toHaveLength(4);
    expect(listRecommendations(ctx.db, ctx.projectId)).toHaveLength(4);
    expect(out.questions).toBe(4);
    expect(out.recommendations).toBe(4);
  });

  it("persists recommendations with status open and a rationale", async () => {
    const { ctx, state } = setup();
    await stage7Critique.run(ctx, state);
    const [rec] = listRecommendations(ctx.db, ctx.projectId);
    expect(rec?.status).toBe("open");
    expect(rec?.rationale).toMatch(/audit mechanism/);
  });

  it("skips entirely when there are no requirements", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
    freezeTranscript(db, transcript.id);
    const parse = vi.fn();
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    await stage7Critique.run(ctx, emptyState(transcript.id));
    expect(parse).not.toHaveBeenCalled();
  });
});
