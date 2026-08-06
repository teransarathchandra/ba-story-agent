import type { Db } from "./db.js";
import { newId } from "../types/ids.js";

export interface ClaimLink {
  id: string;
  projectId: string;
  fromClaimId: string;
  toRequirementId: string | null;
  toClaimId: string | null;
  linkKind: "confirms" | "refines" | "supersedes" | "contradicts";
  rationale: string;
  accepted: boolean;
  createdAt: string;
}

export function insertLinks(db: Db, links: Omit<ClaimLink, "id" | "createdAt">[]): void {
  const stmt = db.prepare(
    `INSERT INTO claim_links
       (id, project_id, from_claim_id, to_requirement_id, to_claim_id, link_kind, rationale, accepted, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const l of links) {
      stmt.run(
        newId("lnk"), l.projectId, l.fromClaimId, l.toRequirementId, l.toClaimId,
        l.linkKind, l.rationale, l.accepted ? 1 : 0, now,
      );
    }
  })();
}

export function listLinks(db: Db, projectId: string): ClaimLink[] {
  const rows = db
    .prepare("SELECT * FROM claim_links WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as {
      id: string; project_id: string; from_claim_id: string;
      to_requirement_id: string | null; to_claim_id: string | null;
      link_kind: string; rationale: string; accepted: number; created_at: string;
    }[];
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    fromClaimId: r.from_claim_id,
    toRequirementId: r.to_requirement_id,
    toClaimId: r.to_claim_id,
    linkKind: r.link_kind as ClaimLink["linkKind"],
    rationale: r.rationale,
    accepted: r.accepted === 1,
    createdAt: r.created_at,
  }));
}
