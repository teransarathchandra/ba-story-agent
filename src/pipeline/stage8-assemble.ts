// src/pipeline/stage8-assemble.ts
import { setSessionStatus } from "../store/projects.js";
import type { PipelineState } from "./state.js";
import type { Stage } from "./runner.js";

export const stage8Assemble: Stage<PipelineState, PipelineState> = {
  name: "assemble",
  async run(ctx, state) {
    setSessionStatus(ctx.db, ctx.sessionId, "awaiting-review");
    return state;
  },
};
