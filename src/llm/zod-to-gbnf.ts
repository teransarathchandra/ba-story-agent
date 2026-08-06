import type { z } from "zod/v4";
import type { GbnfJsonSchema } from "node-llama-cpp";

interface ObjectDef {
  type: "object";
  shape: Record<string, z.ZodType>;
}
interface ArrayDef {
  type: "array";
  element: z.ZodType;
}
interface EnumDef {
  type: "enum";
  entries: Record<string, string | number>;
}
interface NullableDef {
  type: "nullable";
  innerType: z.ZodType;
}

/**
 * Walks a Zod schema's public `.def` shape directly (not via Zod's own
 * toJSONSchema) so the output is under full control and anything this
 * function doesn't recognize fails loudly instead of being silently
 * mis-converted. Only handles the five constructs the six production
 * schemas actually use (object, array, string, enum, nullable) — extend
 * deliberately if a schema changes, don't guess at broader JSON Schema
 * support node-llama-cpp's GbnfJsonSchema type doesn't have anyway
 * (no numeric bounds, no regex pattern — see Task 1 in the plan for why).
 */
export function zodToGbnfSchema(schema: z.ZodType): GbnfJsonSchema {
  const def = schema.def;

  switch (def.type) {
    case "object": {
      const { shape } = def as unknown as ObjectDef;
      const properties: Record<string, GbnfJsonSchema> = {};
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToGbnfSchema(value);
      }
      return { type: "object", properties, additionalProperties: false };
    }
    case "array": {
      const { element } = def as unknown as ArrayDef;
      return { type: "array", items: zodToGbnfSchema(element) };
    }
    case "string":
      return { type: "string" };
    case "enum": {
      const { entries } = def as unknown as EnumDef;
      return { enum: Object.values(entries) };
    }
    case "nullable": {
      const { innerType } = def as unknown as NullableDef;
      const inner = zodToGbnfSchema(innerType);
      if (!("type" in inner) || Array.isArray(inner.type)) {
        throw new Error(
          `zodToGbnfSchema: cannot make ${JSON.stringify(inner)} nullable — ` +
            `only a basic single-typed schema (string/number/integer/boolean) can be widened to include "null"`,
        );
      }
      return { type: [inner.type as string, "null"] } as GbnfJsonSchema;
    }
    default:
      throw new Error(
        `zodToGbnfSchema: unsupported zod type "${def.type}" — extend this translator ` +
          `before using it on a schema with this construct`,
      );
  }
}
