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

const IMMUTABLE_TYPES = ["string", "number", "integer", "boolean"] as const;
function isNullableImmutableType(
  t: unknown,
): t is (typeof IMMUTABLE_TYPES)[number] {
  return IMMUTABLE_TYPES.includes(t as never);
}

/**
 * Walks a Zod schema's public `.def` shape directly (not via Zod's own
 * toJSONSchema) so the output is under full control and anything this
 * function doesn't recognize fails loudly instead of being silently
 * mis-converted. Only handles the six constructs the six production
 * schemas actually use (object, array, string, number, enum, nullable) —
 * extend deliberately if a schema changes, don't guess at broader JSON
 * Schema support node-llama-cpp's GbnfJsonSchema type doesn't have anyway
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
    case "number": {
      // Zod v4 reports def.type as "number" for both z.number() and its
      // .int()/z.int() refinements — the public `.format` getter is how an
      // integer constraint actually surfaces ("safeint", "int32", etc, vs
      // null for a plain float). GBNF has a distinct "integer" type, so
      // translate accordingly instead of collapsing both to "number".
      const format = (schema as unknown as { format?: string | null }).format;
      return { type: typeof format === "string" && /int/i.test(format) ? "integer" : "number" };
    }
    case "enum": {
      const { entries } = def as unknown as EnumDef;
      return { enum: Object.values(entries) };
    }
    case "nullable": {
      const { innerType } = def as unknown as NullableDef;
      const inner = zodToGbnfSchema(innerType);
      if (!("type" in inner) || !isNullableImmutableType(inner.type)) {
        throw new Error(
          `zodToGbnfSchema: cannot make ${JSON.stringify(inner)} nullable — ` +
            `only a basic single-typed schema (string/number/integer/boolean) can be widened to include "null"`,
        );
      }
      return { type: [inner.type, "null"] };
    }
    default:
      throw new Error(
        `zodToGbnfSchema: unsupported zod type "${def.type}" — extend this translator ` +
          `before using it on a schema with this construct`,
      );
  }
}
