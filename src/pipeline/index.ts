// src/pipeline/index.ts
import { runPipeline, type Stage, type StageContext } from "./runner.js";
import { setSessionStatus } from "../store/projects.js";
import { stage0Chunk, stage1Extract } from "./stage1-extract.js";
import { stage2Validate } from "./stage2-validate.js";
import { stage3Classify } from "./stage3-classify.js";
import { stage4Reconcile } from "./stage4-reconcile.js";
import { stage5Requirements } from "./stage5-requirements.js";
import { stage6Stories } from "./stage6-stories.js";
import { stage7Critique } from "./stage7-critique.js";
import { stage8Assemble } from "./stage8-assemble.js";
import type { PipelineState } from "./state.js";

export const ALL_STAGES: Stage<unknown, unknown>[] = [
  stage0Chunk, stage1Extract, stage2Validate, stage3Classify, stage4Reconcile,
  stage5Requirements, stage6Stories, stage7Critique, stage8Assemble,
];

export async function analyzeSession(
  ctx: StageContext,
  transcriptId: string,
  opts?: { resume?: boolean; onProgress?: (name: string, status: string) => void },
): Promise<PipelineState> {
  setSessionStatus(ctx.db, ctx.sessionId, "analyzing");
  const out = await runPipeline(ctx, ALL_STAGES, { transcriptId }, opts);
  return out as PipelineState;
}

export { runPipeline } from "./runner.js";
export type { Stage, StageContext } from "./runner.js";
export type { PipelineState } from "./state.js";
export { quarantineRate } from "./stage2-validate.js";
