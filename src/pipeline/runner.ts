import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../store/db.js";
import { saveCheckpoint, loadCheckpoint } from "../store/audit.js";
import { setSessionStatus } from "../store/projects.js";
import { StageFailure } from "../llm/parse.js";

export interface StageContext {
  db: Db;
  client: Anthropic;
  projectId: string;
  sessionId: string;
}

export interface Stage<In, Out> {
  name: string;
  run(ctx: StageContext, input: In): Promise<Out>;
}

/**
 * Run stages in order, checkpointing each one's output.
 *
 * Stages checkpoint independently so a failure resumes from the last good
 * stage rather than re-running the whole pipeline — which matters because a
 * full re-run costs real money.
 */
export async function runPipeline(
  ctx: StageContext,
  stages: Stage<unknown, unknown>[],
  initial: unknown,
  opts?: { resume?: boolean; onProgress?: (name: string, status: string) => void },
): Promise<unknown> {
  const progress = opts?.onProgress ?? (() => {});
  let value = initial;

  for (const stage of stages) {
    if (opts?.resume) {
      const cp = loadCheckpoint<unknown>(ctx.db, ctx.sessionId, stage.name);
      if (cp?.status === "complete") {
        progress(stage.name, "skipped");
        value = cp.payload;
        continue;
      }
    }

    progress(stage.name, "running");
    saveCheckpoint(ctx.db, ctx.sessionId, stage.name, "running", null);

    try {
      value = await stage.run(ctx, value);
    } catch (err) {
      const raw = err instanceof StageFailure ? err.rawResponse : null;
      saveCheckpoint(
        ctx.db, ctx.sessionId, stage.name, "failed", null,
        err instanceof Error ? err.message : String(err),
        raw,
      );
      setSessionStatus(ctx.db, ctx.sessionId, "failed");
      progress(stage.name, "failed");
      throw err;
    }

    saveCheckpoint(ctx.db, ctx.sessionId, stage.name, "complete", value);
    progress(stage.name, "complete");
  }

  return value;
}
