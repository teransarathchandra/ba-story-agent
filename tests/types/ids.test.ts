import { describe, it, expect } from "vitest";
import { newId } from "../../src/types/ids.js";

describe("newId", () => {
  it("prefixes the ULID with the entity prefix", () => {
    expect(newId("clm")).toMatch(/^clm_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId("req")));
    expect(ids.size).toBe(500);
  });

  it("produces lexicographically sortable ids within a prefix", () => {
    const a = newId("seg");
    const b = newId("seg");
    expect(a < b || a === b).toBe(true);
  });
});
