import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession, getSession } from "../../src/store/projects.js";
import { loadCheckpoint } from "../../src/store/audit.js";
import { runPipeline, type Stage, type StageContext } from "../../src/pipeline/runner.js";

function ctx() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  return {
    db, client: {} as never, projectId: p.id, sessionId: s.id,
  } satisfies StageContext;
}

const double: Stage<number, number> = {
  name: "double",
  run: async (_c, n) => n * 2,
};
const addTen: Stage<number, number> = {
  name: "addTen",
  run: async (_c, n) => n + 10,
};

describe("runPipeline", () => {
  it("threads output from one stage to the next", async () => {
    const c = ctx();
    const out = await runPipeline(c, [double, addTen] as never, 5);
    expect(out).toBe(20);
  });

  it("checkpoints each completed stage", async () => {
    const c = ctx();
    await runPipeline(c, [double, addTen] as never, 5);
    expect(loadCheckpoint<number>(c.db, c.sessionId, "double")?.status).toBe("complete");
    expect(loadCheckpoint<number>(c.db, c.sessionId, "addTen")?.payload).toBe(20);
  });

  it("skips completed stages on resume and reuses their output", async () => {
    const c = ctx();
    await runPipeline(c, [double, addTen] as never, 5);
    const spy = vi.fn(double.run);
    const spied: Stage<number, number> = { name: "double", run: spy as never };
    const out = await runPipeline(c, [spied, addTen] as never, 999, { resume: true });
    expect(spy).not.toHaveBeenCalled();
    expect(out).toBe(20);
  });

  it("marks the session failed and rethrows when a stage throws", async () => {
    const c = ctx();
    const boom: Stage<number, number> = {
      name: "boom",
      run: async () => { throw new Error("kaboom"); },
    };
    await expect(runPipeline(c, [double, boom] as never, 5)).rejects.toThrow(/kaboom/);
    expect(getSession(c.db, c.sessionId)?.status).toBe("failed");
    expect(loadCheckpoint(c.db, c.sessionId, "boom")?.status).toBe("failed");
  });

  it("resumes from the failed stage rather than the beginning", async () => {
    const c = ctx();
    let attempts = 0;
    const flaky: Stage<number, number> = {
      name: "flaky",
      run: async (_x, n) => {
        attempts++;
        if (attempts === 1) throw new Error("transient");
        return n + 1;
      },
    };
    const doubleSpy = vi.fn(double.run);
    const stages = [{ name: "double", run: doubleSpy as never }, flaky] as never;
    await expect(runPipeline(c, stages, 5)).rejects.toThrow(/transient/);
    expect(doubleSpy).toHaveBeenCalledTimes(1);
    const out = await runPipeline(c, stages, 5, { resume: true });
    expect(doubleSpy).toHaveBeenCalledTimes(1);
    expect(out).toBe(11);
  });

  it("reports progress for each stage", async () => {
    const c = ctx();
    const seen: string[] = [];
    await runPipeline(c, [double, addTen] as never, 1, {
      onProgress: (name, status) => seen.push(`${name}:${status}`),
    });
    expect(seen).toContain("double:running");
    expect(seen).toContain("addTen:complete");
  });
});
