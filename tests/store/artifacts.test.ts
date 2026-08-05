import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject } from "../../src/store/projects.js";
import { nextKey, insertRequirements, listRequirements, insertStory, listStories } from "../../src/store/artifacts.js";
import { newId } from "../../src/types/ids.js";

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  return { db, projectId: p.id };
}

describe("artifacts", () => {
  it("allocates sequential keys per project", () => {
    const { db, projectId } = seed();
    expect(nextKey(db, projectId, "requirements", "REQ")).toBe("REQ-001");
    insertRequirements(db, [{
      id: newId("req"), projectId, key: "REQ-001",
      statement: "Manager approval required.", status: "proposed",
      origin: "client-stated", originClaimIds: ["clm_x"], supersedesId: null,
      createdAt: new Date().toISOString(),
    }]);
    expect(nextKey(db, projectId, "requirements", "REQ")).toBe("REQ-002");
  });

  it("round-trips a requirement including its origin claim ids", () => {
    const { db, projectId } = seed();
    insertRequirements(db, [{
      id: newId("req"), projectId, key: "REQ-001",
      statement: "Manager approval required.", status: "proposed",
      origin: "client-stated", originClaimIds: ["clm_a", "clm_b"], supersedesId: null,
      createdAt: new Date().toISOString(),
    }]);
    const [r] = listRequirements(db, projectId);
    expect(r?.originClaimIds).toEqual(["clm_a", "clm_b"]);
  });

  it("rejects a client-stated requirement with no origin claims", () => {
    const { db, projectId } = seed();
    expect(() => insertRequirements(db, [{
      id: newId("req"), projectId, key: "REQ-001",
      statement: "Invented.", status: "proposed",
      origin: "client-stated", originClaimIds: [], supersedesId: null,
      createdAt: new Date().toISOString(),
    }])).toThrow(/origin claim/);
  });

  it("stores a story with its acceptance criteria in order", () => {
    const { db, projectId } = seed();
    const storyId = newId("sty");
    insertStory(db,
      {
        id: storyId, projectId, key: "US-001",
        asA: "finance clerk", iWant: "invoices routed", soThat: "spend is checked",
        requirementIds: ["req_a"], createdAt: new Date().toISOString(),
      },
      [
        { id: newId("acr"), storyId, idx: 0, gherkin: "Given A when B then C", source: "client-stated", linkedQuestionId: null },
        { id: newId("acr"), storyId, idx: 1, gherkin: "Given D when E then F", source: "derived", linkedQuestionId: "oqn_x" },
      ],
    );
    const [entry] = listStories(db, projectId);
    expect(entry?.criteria.map((c) => c.source)).toEqual(["client-stated", "derived"]);
  });
});
