// src/pipeline/stage7-critique.ts
import { z } from "zod/v4"; // zod v4 required by zodOutputFormat in callTyped
import { listRequirements, listStories, nextKey } from "../store/artifacts.js";
import { insertQuestions, insertRecommendations } from "../store/findings.js";
import { getProject } from "../store/projects.js";
import { newId } from "../types/ids.js";
import { callTyped } from "../llm/parse.js";
import { REVIEWERS, buildCritiqueUser } from "../prompts/critique.js";
import type { PipelineState } from "./state.js";
import type { Stage } from "./runner.js";
import type { OpenQuestion, Recommendation } from "../types/domain.js";

export { REVIEWERS } from "../prompts/critique.js";

const Category = z.enum(["domain", "security", "privacy", "compliance", "edge-case", "testability"]);

/**
 * The critique panel's output type.
 *
 * This schema is the second structural safety control in the system: it
 * contains only questions and recommendations. There is no field in which a
 * requirement can be expressed, so even a maximally helpful model cannot
 * author one here — there is nowhere to put it.
 *
 * Do not add a field to this schema without re-reading the spec's safety
 * controls section.
 */
export const CritiqueFindingsSchema = z.object({
  questions: z.array(z.object({ text: z.string(), category: Category })),
  recommendations: z.array(
    z.object({ text: z.string(), rationale: z.string(), category: Category }),
  ),
});

export const stage7Critique: Stage<PipelineState, PipelineState> = {
  name: "critique",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");

    const requirements = listRequirements(ctx.db, ctx.projectId, { status: "proposed" });
    if (requirements.length === 0) return state;

    const stories = listStories(ctx.db, ctx.projectId);
    const user = buildCritiqueUser(project, requirements, stories);

    // Reviewers are independent; run them concurrently.
    const results = await Promise.all(
      REVIEWERS.map((reviewer) =>
        callTyped({
          client: ctx.client,
          db: ctx.db,
          sessionId: ctx.sessionId,
          stage: `critique:${reviewer.name}`,
          system: reviewer.system({ regulatoryContext: project.regulatoryContext }),
          user,
          schema: CritiqueFindingsSchema,
          effort: "high",
        }),
      ),
    );

    const now = new Date().toISOString();
    let questions = 0;
    let recommendations = 0;

    // Key allocation reads the table, so insert serially after the parallel calls.
    for (const result of results) {
      for (const q of result.questions) {
        const question: OpenQuestion = {
          id: newId("oqn"),
          projectId: ctx.projectId,
          key: nextKey(ctx.db, ctx.projectId, "open_questions", "OQ"),
          text: q.text,
          category: q.category,
          raisedBySessionId: ctx.sessionId,
          status: "open",
          answerText: null,
          answeredBySessionId: null,
          createdAt: now,
        };
        insertQuestions(ctx.db, [question]);
        questions++;
      }
      for (const r of result.recommendations) {
        const rec: Recommendation = {
          id: newId("rec"),
          projectId: ctx.projectId,
          key: nextKey(ctx.db, ctx.projectId, "recommendations", "REC"),
          text: r.text,
          rationale: r.rationale,
          category: r.category,
          raisedBySessionId: ctx.sessionId,
          status: "open",
          dispositionNote: null,
          createdAt: now,
        };
        insertRecommendations(ctx.db, [rec]);
        recommendations++;
      }
    }

    return {
      ...state,
      questions: state.questions + questions,
      recommendations: state.recommendations + recommendations,
    };
  },
};
