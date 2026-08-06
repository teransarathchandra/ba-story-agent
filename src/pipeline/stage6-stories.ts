// Use zod/v4 because zodOutputFormat requires it (zod@^3.25.76 resolves bare import to v3)
import { z } from "zod/v4";
import { listRequirements, insertStory, nextKey } from "../store/artifacts.js";
import { insertQuestions } from "../store/findings.js";
import { getProject } from "../store/projects.js";
import { newId } from "../types/ids.js";
import { callTyped } from "../llm/parse.js";
import { STORIES_SYSTEM, buildStoriesUser } from "../prompts/stories.js";
import type { PipelineState } from "./state.js";
import type { Stage } from "./runner.js";
import type { AcceptanceCriterion, OpenQuestion, Story } from "../types/domain.js";

export const StoryDraftsSchema = z.object({
  stories: z.array(
    z.object({
      asA: z.string(),
      iWant: z.string(),
      soThat: z.string(),
      requirementIds: z.array(z.string()),
      acceptanceCriteria: z.array(
        z.object({
          gherkin: z.string(),
          source: z.enum(["client-stated", "derived"]),
          question: z.string().nullable(),
        }),
      ),
    }),
  ),
});

export const stage6Stories: Stage<PipelineState, PipelineState> = {
  name: "stories",
  async run(ctx, state) {
    const project = getProject(ctx.db, ctx.projectId);
    if (!project) throw new Error("project not found");

    const requirements = listRequirements(ctx.db, ctx.projectId, { status: "proposed" });
    if (requirements.length === 0) return state;

    const result = await callTyped({
      client: ctx.client,
      db: ctx.db,
      sessionId: ctx.sessionId,
      stage: "stories",
      system: STORIES_SYSTEM,
      user: buildStoriesUser(requirements, project),
      schema: StoryDraftsSchema,
      effort: "high",
    });

    const known = new Set(requirements.map((r) => r.id));
    const now = new Date().toISOString();
    let stories = 0;
    let questions = 0;

    for (const draft of result.stories) {
      const cited = draft.requirementIds.filter((id) => known.has(id));
      if (cited.length === 0) continue; // a story implementing nothing real is dropped

      const storyId = newId("sty");
      const criteria: AcceptanceCriterion[] = [];

      draft.acceptanceCriteria.forEach((ac, idx) => {
        let linkedQuestionId: string | null = null;
        if (ac.source === "derived" && ac.question && ac.question.trim().length > 0) {
          const q: OpenQuestion = {
            id: newId("oqn"),
            projectId: ctx.projectId,
            key: nextKey(ctx.db, ctx.projectId, "open_questions", "OQ"),
            text: ac.question,
            category: "domain",
            raisedBySessionId: ctx.sessionId,
            status: "open",
            answerText: null,
            answeredBySessionId: null,
            createdAt: now,
          };
          insertQuestions(ctx.db, [q]);
          linkedQuestionId = q.id;
          questions++;
        }
        criteria.push({
          id: newId("acr"),
          storyId,
          idx,
          gherkin: ac.gherkin,
          source: ac.source,
          linkedQuestionId,
        });
      });

      const story: Story = {
        id: storyId,
        projectId: ctx.projectId,
        key: nextKey(ctx.db, ctx.projectId, "stories", "US"),
        asA: draft.asA,
        iWant: draft.iWant,
        soThat: draft.soThat,
        requirementIds: cited,
        createdAt: now,
      };
      insertStory(ctx.db, story, criteria);
      stories++;
    }

    return {
      ...state,
      stories: state.stories + stories,
      questions: state.questions + questions,
    };
  },
};
