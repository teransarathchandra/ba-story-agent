import { getLlama } from "node-llama-cpp";
import { zodToGbnfSchema } from "../../src/llm/zod-to-gbnf.js";
import { ExtractedClaimsSchema } from "../../src/pipeline/stage1-extract.js";
import { ClassificationSchema } from "../../src/pipeline/stage3-classify.js";
import { ReconcileSchema } from "../../src/pipeline/stage4-reconcile.js";
import { RequirementDraftsSchema } from "../../src/pipeline/stage5-requirements.js";
import { StoryDraftsSchema } from "../../src/pipeline/stage6-stories.js";
import { CritiqueFindingsSchema } from "../../src/pipeline/stage7-critique.js";

const schemas = {
  ExtractedClaimsSchema, ClassificationSchema, ReconcileSchema,
  RequirementDraftsSchema, StoryDraftsSchema, CritiqueFindingsSchema,
};

async function main() {
  const llama = await getLlama();
  for (const [name, schema] of Object.entries(schemas)) {
    try {
      const gbnf = zodToGbnfSchema(schema);
      await llama.createGrammarForJsonSchema(gbnf);
      console.log(`PASS  ${name}`);
    } catch (err) {
      console.log(`FAIL  ${name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main();
