import { SNAPSHOT_SCHEMA_VERSION, type ExportSnapshot } from "./snapshot.js";

export interface Publisher {
  name: string;
  publish(snapshot: ExportSnapshot): string;
}

/**
 * The machine-readable export, and the input type every downstream publisher
 * consumes. Jira and Confluence publishers are added later as further
 * `Publisher` implementations over the same snapshot — no rewrite required.
 */
export const jsonPublisher: Publisher = {
  name: "json",
  publish(snapshot) {
    return JSON.stringify(
      {
        $schema: `https://ba-story-agent.local/schemas/export-${SNAPSHOT_SCHEMA_VERSION}.json`,
        ...snapshot,
      },
      null,
      2,
    );
  },
};
