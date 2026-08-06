import type { Db } from "../store/db.js";
import { getProject, listSessions } from "../store/projects.js";
import { getFrozenTranscript } from "../store/transcripts.js";
import { listProjectClaims } from "../store/claims.js";
import { listRequirements, listStories } from "../store/artifacts.js";
import { listQuestions, listRecommendations } from "../store/findings.js";
import { egressSummary } from "../store/audit.js";
import { ENGINE_VERSION } from "../version.js";
import { MODEL } from "../llm/client.js";
import type { AcceptanceCriterion } from "../types/domain.js";

export const SNAPSHOT_SCHEMA_VERSION = "1.0.0";

export interface Evidence {
  quote: string;
  sessionTitle: string;
  occurredAt: string;
  startMs: number | null;
  matchMode: string | null;
}

export interface ExportSnapshot {
  schemaVersion: string;
  project: { name: string; domain: string; regulatoryContext: string };
  generatedAt: string;
  requirements: {
    key: string; statement: string; status: string; origin: string; evidence: Evidence[];
  }[];
  stories: {
    key: string; asA: string; iWant: string; soThat: string;
    implements: string[];
    acceptanceCriteria: { gherkin: string; source: AcceptanceCriterion["source"]; linkedQuestionKey: string | null }[];
  }[];
  assumptions: { quote: string; statement: string; sessionTitle: string; occurredAt: string }[];
  openQuestions: {
    key: string; text: string; category: string; status: string;
    raisedIn: string; answerText: string | null;
  }[];
  recommendations: {
    key: string; text: string; rationale: string; category: string; status: string;
  }[];
  quarantined: { quote: string; statement: string; sessionTitle: string }[];
  provenance: {
    engineVersion: string;
    llmModel: string;
    sessions: { title: string; occurredAt: string; transcriptHash: string; wordCount: number }[];
    egress: { requests: number; promptTokens: number; completionTokens: number };
  };
}

/**
 * Build the single object every publisher consumes.
 *
 * Markdown, JSON, and (later) Jira and Confluence are all just
 * `publish(snapshot)` implementations over this type — which is what keeps
 * the two rendered outputs from ever disagreeing.
 */
export function buildSnapshot(
  db: Db,
  projectId: string,
  opts?: { includeProposed?: boolean },
): ExportSnapshot {
  const project = getProject(db, projectId);
  if (!project) throw new Error("project not found");

  const sessions = listSessions(db, projectId);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const claims = listProjectClaims(db, projectId);
  const claimById = new Map(claims.map((c) => [c.id, c]));

  const segmentStartMs = new Map<string, number | null>();
  const provenanceSessions: ExportSnapshot["provenance"]["sessions"] = [];
  let egress = { requests: 0, promptTokens: 0, completionTokens: 0 };

  for (const s of sessions) {
    const frozen = getFrozenTranscript(db, s.id);
    if (frozen) {
      for (const seg of frozen.segments) segmentStartMs.set(seg.id, seg.startMs);
      provenanceSessions.push({
        title: s.title,
        occurredAt: s.occurredAt,
        transcriptHash: frozen.transcript.contentHash,
        wordCount: (frozen.transcript.text.match(/\S+/g) ?? []).length,
      });
    }
    const e = egressSummary(db, s.id);
    egress = {
      requests: egress.requests + e.requests,
      promptTokens: egress.promptTokens + e.promptTokens,
      completionTokens: egress.completionTokens + e.completionTokens,
    };
  }

  const evidenceFor = (claimIds: string[]): Evidence[] =>
    claimIds.flatMap((id) => {
      const claim = claimById.get(id);
      if (!claim) return [];
      const session = sessionById.get(claim.sessionId);
      return [{
        quote: claim.quote,
        sessionTitle: session?.title ?? "(unknown session)",
        occurredAt: session?.occurredAt ?? "",
        startMs: segmentStartMs.get(claim.segmentId) ?? null,
        matchMode: claim.matchMode,
      }];
    });

  const questions = listQuestions(db, projectId);
  const questionKeyById = new Map(questions.map((q) => [q.id, q.key]));
  const requirementKeyById = new Map(
    listRequirements(db, projectId).map((r) => [r.id, r.key]),
  );

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    project: {
      name: project.name,
      domain: project.domain,
      regulatoryContext: project.regulatoryContext,
    },
    generatedAt: new Date().toISOString(),
    // The baseline is what the BA has approved. `includeProposed` additionally
    // surfaces un-approved drafts (clearly labelled by their `status`) so the
    // engine's output can be evaluated before any review UI exists.
    requirements: listRequirements(db, projectId)
      .filter((r) =>
        r.status === "finalized" ||
        (opts?.includeProposed === true && r.status === "proposed"),
      )
      .map((r) => ({
        key: r.key,
        statement: r.statement,
        status: r.status,
        origin: r.origin,
        evidence: evidenceFor(r.originClaimIds),
      })),
    stories: listStories(db, projectId).map(({ story, criteria }) => ({
      key: story.key,
      asA: story.asA,
      iWant: story.iWant,
      soThat: story.soThat,
      implements: story.requirementIds.map((id) => requirementKeyById.get(id) ?? id),
      acceptanceCriteria: criteria.map((c) => ({
        gherkin: c.gherkin,
        source: c.source,
        linkedQuestionKey: c.linkedQuestionId
          ? questionKeyById.get(c.linkedQuestionId) ?? null
          : null,
      })),
    })),
    assumptions: claims
      .filter((c) => c.status === "validated" && c.kind === "assumption")
      .map((c) => ({
        quote: c.quote,
        statement: c.statement,
        sessionTitle: sessionById.get(c.sessionId)?.title ?? "(unknown session)",
        occurredAt: sessionById.get(c.sessionId)?.occurredAt ?? "",
      })),
    openQuestions: questions.map((q) => ({
      key: q.key,
      text: q.text,
      category: q.category,
      status: q.status,
      raisedIn: sessionById.get(q.raisedBySessionId)?.title ?? "(unknown session)",
      answerText: q.answerText,
    })),
    recommendations: listRecommendations(db, projectId).map((r) => ({
      key: r.key,
      text: r.text,
      rationale: r.rationale,
      category: r.category,
      status: r.status,
    })),
    quarantined: claims
      .filter((c) => c.status === "quarantined")
      .map((c) => ({
        quote: c.quote,
        statement: c.statement,
        sessionTitle: sessionById.get(c.sessionId)?.title ?? "(unknown session)",
      })),
    provenance: {
      engineVersion: ENGINE_VERSION,
      llmModel: MODEL,
      sessions: provenanceSessions,
      egress,
    },
  };
}
