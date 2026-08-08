import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import { zodToGbnfSchema } from "../../src/llm/zod-to-gbnf.js";
import { ExtractedClaimsSchema } from "../../src/pipeline/stage1-extract.js";
import { ClassificationSchema } from "../../src/pipeline/stage3-classify.js";
import { ReconcileSchema } from "../../src/pipeline/stage4-reconcile.js";
import { RequirementDraftsSchema } from "../../src/pipeline/stage5-requirements.js";
import { StoryDraftsSchema } from "../../src/pipeline/stage6-stories.js";
import { CritiqueFindingsSchema } from "../../src/pipeline/stage7-critique.js";

describe("zodToGbnfSchema", () => {
  it("converts a flat object of strings", () => {
    expect(zodToGbnfSchema(z.object({ a: z.string() }))).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    });
  });

  it("converts arrays of objects with an enum field", () => {
    const schema = z.object({ items: z.array(z.object({ kind: z.enum(["a", "b"]) })) });
    expect(zodToGbnfSchema(schema)).toEqual({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { kind: { enum: ["a", "b"] } },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    });
  });

  it("converts a nullable string to a two-member type array, not anyOf", () => {
    const schema = z.object({ q: z.string().nullable() });
    expect(zodToGbnfSchema(schema)).toEqual({
      type: "object",
      properties: { q: { type: ["string", "null"] } },
      additionalProperties: false,
    });
  });

  it("throws on an unsupported zod construct instead of silently mis-converting", () => {
    expect(() => zodToGbnfSchema(z.object({ n: z.bigint() }))).toThrow(/unsupported zod type/);
  });

  it("converts a positive integer to the GBNF integer type, not number", () => {
    expect(zodToGbnfSchema(z.object({ n: z.number().int().positive() }))).toEqual({
      type: "object",
      properties: { n: { type: "integer" } },
      additionalProperties: false,
    });
  });

  it("converts a plain float number to the GBNF number type", () => {
    expect(zodToGbnfSchema(z.object({ n: z.number() }))).toEqual({
      type: "object",
      properties: { n: { type: "number" } },
      additionalProperties: false,
    });
  });

  it("throws when nullable wraps an object or array instead of silently producing an invalid schema", () => {
    expect(() => zodToGbnfSchema(z.object({ a: z.string() }).nullable())).toThrow(/cannot make/);
    expect(() => zodToGbnfSchema(z.array(z.string()).nullable())).toThrow(/cannot make/);
  });

  const productionSchemas = {
    ExtractedClaimsSchema, ClassificationSchema, ReconcileSchema,
    RequirementDraftsSchema, StoryDraftsSchema, CritiqueFindingsSchema,
  };
  for (const [name, schema] of Object.entries(productionSchemas)) {
    it(`converts the real production schema ${name} without throwing`, () => {
      expect(() => zodToGbnfSchema(schema)).not.toThrow();
    });
  }
});
