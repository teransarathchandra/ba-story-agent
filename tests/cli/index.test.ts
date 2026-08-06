import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram } from "../../src/cli/index.js";

let dir: string;
let dbPath: string;

const LONG = Array.from({ length: 30 }, (_, i) =>
  `Client: statement number ${i} about invoice approval thresholds and routing rules in some detail`,
).join("\n\n");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bsa-"));
  dbPath = join(dir, "test.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function run(args: string[]): Promise<string> {
  const lines: string[] = [];
  const program = buildProgram({ log: (s) => lines.push(s) });
  await program.parseAsync(["node", "cli", ...args, "--db", dbPath]);
  return lines.join("\n");
}

describe("cli", () => {
  it("creates a project and prints its id", async () => {
    const out = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    expect(out).toMatch(/prj_/);
  });

  it("rejects a project with a too-short domain", async () => {
    await expect(run(["project", "create", "--name", "P", "--domain", "x"])).rejects.toThrow();
  });

  it("adds a session from a text file", async () => {
    const projectOut = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    const projectId = /prj_[0-9A-Z]+/.exec(projectOut)![0];
    const file = join(dir, "t.txt");
    writeFileSync(file, LONG);
    const out = await run(["session", "add", "--project", projectId, "--title", "Kickoff", "--file", file]);
    expect(out).toMatch(/ses_/);
  });

  it("refuses to add a session below the 200-word floor", async () => {
    const projectOut = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    const projectId = /prj_[0-9A-Z]+/.exec(projectOut)![0];
    const file = join(dir, "short.txt");
    writeFileSync(file, "far too short");
    await expect(
      run(["session", "add", "--project", projectId, "--title", "S", "--file", file]),
    ).rejects.toThrow(/200 words/);
  });

  it("exports markdown and json for a project", async () => {
    const projectOut = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    const projectId = /prj_[0-9A-Z]+/.exec(projectOut)![0];
    await run(["export", "--project", projectId, "--out", dir]);
    expect(existsSync(join(dir, "requirements.md"))).toBe(true);
    expect(existsSync(join(dir, "requirements.json"))).toBe(true);
    expect(readFileSync(join(dir, "requirements.md"), "utf8")).toMatch(/Requirements Baseline/);
  });

  it("prints a status summary", async () => {
    const projectOut = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    const projectId = /prj_[0-9A-Z]+/.exec(projectOut)![0];
    const out = await run(["status", "--project", projectId]);
    expect(out).toMatch(/Requirements/);
  });

  it("approves a proposed requirement into the baseline and records the approval", async () => {
    const projectOut = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    const projectId = /prj_[0-9A-Z]+/.exec(projectOut)![0];

    // Seed a proposed requirement directly; Stage 5 would normally do this.
    const { openDb } = await import("../../src/store/db.js");
    const { insertRequirements, listRequirements } = await import("../../src/store/artifacts.js");
    const { listApprovals } = await import("../../src/store/audit.js");
    const { newId } = await import("../../src/types/ids.js");
    const db = openDb(dbPath);
    insertRequirements(db, [{
      id: newId("req"), projectId, key: "REQ-001",
      statement: "Invoices over EUR 10,000 must be approved by a manager.",
      status: "proposed", origin: "client-stated", originClaimIds: ["clm_a"],
      supersedesId: null, createdAt: new Date().toISOString(),
    }]);

    // Before approval the baseline is empty.
    await run(["export", "--project", projectId, "--out", dir]);
    expect(readFileSync(join(dir, "requirements.md"), "utf8")).toMatch(/No confirmed requirements/);

    // --include-proposed surfaces it, clearly labelled.
    await run(["export", "--project", projectId, "--out", dir, "--include-proposed"]);
    expect(readFileSync(join(dir, "requirements.md"), "utf8")).toMatch(/\[NOT YET APPROVED\]/);

    await run(["approve", "--project", projectId, "--requirement", "REQ-001"]);

    const req = listRequirements(db, projectId)[0]!;
    expect(req.status).toBe("finalized");
    expect(listApprovals(db, "requirement", req.id)).toHaveLength(1);

    await run(["export", "--project", projectId, "--out", dir]);
    const md = readFileSync(join(dir, "requirements.md"), "utf8");
    expect(md).toMatch(/REQ-001/);
    expect(md).not.toMatch(/\[NOT YET APPROVED\]/);
  });

  it("refuses to approve a requirement that does not exist", async () => {
    const projectOut = await run(["project", "create", "--name", "P", "--domain", "invoice approval for logistics operators"]);
    const projectId = /prj_[0-9A-Z]+/.exec(projectOut)![0];
    await expect(
      run(["approve", "--project", projectId, "--requirement", "REQ-999"]),
    ).rejects.toThrow(/not found/);
  });
});
