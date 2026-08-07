import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import { insertRequirements, listStories } from "../../src/store/artifacts.js";
import { listQuestions } from "../../src/store/findings.js";
import { stage6Stories } from "../../src/pipeline/stage6-stories.js";
import { emptyState } from "../../src/pipeline/state.js";
import { newId } from "../../src/types/ids.js";
import type { StageContext } from "../../src/pipeline/runner.js";

/** `makeDrafts` receives the real requirement id, so tests never juggle placeholders. */
function setup(makeDrafts: (reqId: string) => unknown) {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
  freezeTranscript(db, transcript.id);
  const reqId = newId("req");
  insertRequirements(db, [{
    id: reqId, projectId: p.id, key: "REQ-001",
    statement: "Invoices over EUR 10,000 must be approved by a manager.",
    status: "proposed", origin: "client-stated", originClaimIds: ["clm_a"],
    supersedesId: null, createdAt: new Date().toISOString(),
  }]);
  const drafts = makeDrafts(reqId);
  const parse = vi.fn().mockResolvedValue({
    raw: "{}",
    parsedOutput: drafts,
    requestPayload: {},
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
  return { ctx, reqId, state: emptyState(transcript.id) };
}

describe("stage6Stories", () => {
  it("persists a story with its criteria and requirement links", async () => {
    const { ctx, reqId, state } = setup((reqId) => ({
      stories: [{
        asA: "finance clerk", iWant: "invoices over EUR 10,000 routed to a manager",
        soThat: "high-value spend has a second pair of eyes",
        requirementIds: [reqId],
        acceptanceCriteria: [
          { gherkin: "Given an invoice of EUR 10,001, when submitted, then it is routed to the manager queue", source: "client-stated", question: null },
        ],
      }],
    }));
    const out = await stage6Stories.run(ctx, state);
    const [entry] = listStories(ctx.db, ctx.projectId);
    expect(entry?.story.key).toBe("US-001");
    expect(entry?.criteria).toHaveLength(1);
    expect(entry?.criteria[0]?.source).toBe("client-stated");
    expect(out.stories).toBe(1);
  });

  it("raises an open question for a derived criterion and links the AC to it", async () => {
    const { ctx, reqId, state } = setup((reqId) => ({
      stories: [{
        asA: "finance clerk", iWant: "escalation", soThat: "nothing stalls",
        requirementIds: [reqId],
        acceptanceCriteria: [
          { gherkin: "Given the manager has not responded in 48h, then it escalates", source: "derived", question: "Is 48 hours the correct escalation window? Not stated by the client." },
        ],
      }],
    }));
    const out = await stage6Stories.run(ctx, state);
    const [entry] = listStories(ctx.db, ctx.projectId);
    expect(entry?.criteria[0]?.source).toBe("derived");
    expect(entry?.criteria[0]?.linkedQuestionId).not.toBeNull();
    const qs = listQuestions(ctx.db, ctx.projectId);
    expect(qs[0]?.text).toMatch(/48 hours/);
    expect(out.questions).toBe(1);
  });

  it("drops a story citing no known requirement", async () => {
    const { ctx, state } = setup(() => ({
      stories: [{
        asA: "x", iWant: "y", soThat: "z",
        requirementIds: ["req_fabricated"],
        acceptanceCriteria: [{ gherkin: "g", source: "client-stated", question: null }],
      }],
    }));
    await stage6Stories.run(ctx, state);
    expect(listStories(ctx.db, ctx.projectId)).toHaveLength(0);
  });

  it("does nothing when there are no requirements", async () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const { transcript } = createTranscript(db, { sessionId: s.id, text: "a\n\nb" });
    freezeTranscript(db, transcript.id);
    const parse = vi.fn();
    const ctx: StageContext = { db, client: { model: "test", generate: parse } as never, projectId: p.id, sessionId: s.id };
    await stage6Stories.run(ctx, emptyState(transcript.id));
    expect(parse).not.toHaveBeenCalled();
  });
});
