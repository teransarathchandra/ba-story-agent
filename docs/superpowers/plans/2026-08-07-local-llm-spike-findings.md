# Local LLM Backend — Spike Findings

## Schema→grammar construction (Task 1)

```
> ba-story-agent@0.1.0 spike:schema
> tsx scripts/spike/schema-grammar-check.ts

PASS  ExtractedClaimsSchema
PASS  ClassificationSchema
PASS  ReconcileSchema
PASS  RequirementDraftsSchema
PASS  StoryDraftsSchema
PASS  CritiqueFindingsSchema
```

### Summary

All six production schemas successfully convert to GBNF via the `zodToGbnfSchema` translator and are accepted by `node-llama-cpp`'s `createGrammarForJsonSchema`. No failures.

The translator's direct Zod `.def` introspection approach correctly handles:
- Flat and nested objects with `additionalProperties: false`
- Arrays with typed items
- String fields
- Enum fields (`.enum()`)
- Nullable fields (`.nullable()`) — converted to `type: ["string", "null"]` instead of `anyOf`

None of the six schemas use unsupported constructs (numeric bounds, regex patterns, union types, or shared `$ref` subschemas), so the translator's fail-loud approach on unknown types confirms the schemas are within the safe subset for GBNF generation.
