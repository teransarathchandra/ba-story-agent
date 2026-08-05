import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "../src/version.js";

describe("ENGINE_VERSION", () => {
  it("is a semver string", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
