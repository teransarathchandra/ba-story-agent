// src/pipeline/index.ts
import { runPipeline, type Stage, type StageContext } from "./runner.js";
import { getProject, setSessionStatus } from "../store/projects.js";
import { stage0Chunk, stage1Extract } from "./stage1-extract.js";
import { stage2Validate } from "./stage2-validate.js";
import { stage2bRequote } from "./stage2b-requote.js";
import { stage3Classify } from "./stage3-classify.js";
import { stage4Reconcile } from "./stage4-reconcile.js";
import { stage5Requirements } from "./stage5-requirements.js";
import { stage6Stories } from "./stage6-stories.js";
import { stage7Critique } from "./stage7-critique.js";
import { stage8Assemble } from "./stage8-assemble.js";
import type { PipelineState } from "./state.js";

export const ALL_STAGES: Stage<unknown, unknown>[] = [
  stage0Chunk, stage1Extract, stage2Validate, stage2bRequote, stage3Classify, stage4Reconcile,
  stage5Requirements, stage6Stories, stage7Critique, stage8Assemble,
];

export async function analyzeSession(
  ctx: StageContext,
  transcriptId: string,
  opts?: { resume?: boolean; onProgress?: (name: string, status: string) => void },
): Promise<PipelineState> {
  // domain is optional at project-creation time, but every LLM-calling
  // stage interpolates it directly into the prompt sent to the model — a
  // missing domain there means the model either produces generic filler or
  // infers/invents a domain from fragments, which is exactly what this
  // product's core "never invent client details" promise exists to
  // prevent. Refuse outright, before touching session status or running
  // any stage, rather than letting a stage discover this partway through.
  const project = getProject(ctx.db, ctx.projectId);
  if (!project) throw new Error(`project ${ctx.projectId} not found`);
  if (!project.domain) {
    throw new Error(
      `project ${ctx.projectId} has no domain set — a domain is required before analysis can run, ` +
        `since every extraction, classification, and review call is grounded by it. Set one before analyzing.`,
    );
  }

  setSessionStatus(ctx.db, ctx.sessionId, "analyzing");
  const out = await runPipeline(ctx, ALL_STAGES, { transcriptId }, opts);
  return out as PipelineState;
}

export type { Stage, StageContext } from "./runner.js";
export type { PipelineState } from "./state.js";
export { quarantineRate } from "./stage2-validate.js";
