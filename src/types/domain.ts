// Use zod/v4 because zodOutputFormat requires it (zod@^3.25.76 resolves bare import to v3)
import { z } from "zod/v4";

const Iso = z.string().datetime();

export const ClaimKind = z.enum(["requirement", "assumption", "ambiguity"]);
export const ClaimStatus = z.enum(["candidate", "validated", "quarantined"]);
export const MatchMode = z.enum(["exact", "segment-corrected", "fuzzy"]);
export const SpeakerRole = z.enum(["client", "ba", "other", "unknown"]);
export const RequirementStatus = z.enum([
  "proposed", "confirmed", "finalized", "superseded", "rejected",
]);
export const RequirementOrigin = z.enum(["client-stated", "ba-authored"]);
export const AcSource = z.enum(["client-stated", "derived"]);
export const QuestionStatus = z.enum(["open", "asked", "answered", "closed"]);
export const RecommendationStatus = z.enum(["open", "accepted", "declined"]);
export const CritiqueCategory = z.enum([
  "domain", "security", "privacy", "compliance", "edge-case", "testability",
]);
export const RegulatoryContext = z.enum([
  "none", "GDPR", "HIPAA", "PCI-DSS", "SOC2",
]);
export const SessionStatus = z.enum([
  "draft", "analyzing", "awaiting-review", "finalized", "failed",
]);
export const LinkKind = z.enum(["confirms", "refines", "supersedes", "contradicts"]);

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  domain: z.string().min(10, "project domain must be a meaningful one-liner"),
  regulatoryContext: RegulatoryContext,
  systemName: z.string().nullable(),
  glossary: z.string().nullable(),
  createdAt: Iso,
});

export const SessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string().min(1),
  occurredAt: Iso,
  status: SessionStatus,
  createdAt: Iso,
});

export const TranscriptSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  version: z.number().int().positive(),
  text: z.string().min(1),
  contentHash: z.string().length(64),
  frozenAt: Iso.nullable(),
  createdAt: Iso,
});

export const SegmentSchema = z.object({
  id: z.string(),
  transcriptId: z.string(),
  idx: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().nonnegative().nullable(),
  speakerLabel: z.string().nullable(),
  text: z.string(),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
});

export const ClaimSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  transcriptId: z.string(),
  segmentId: z.string(),
  quote: z.string().min(1, "a claim must carry a non-empty quote"),
  statement: z.string().min(1),
  speakerRole: SpeakerRole,
  kind: ClaimKind,
  status: ClaimStatus,
  charStart: z.number().int().nonnegative().nullable(),
  charEnd: z.number().int().nonnegative().nullable(),
  matchMode: MatchMode.nullable(),
  createdAt: Iso,
});

export const RequirementSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string().regex(/^REQ-\d{3,}$/),
  statement: z.string().min(1),
  status: RequirementStatus,
  origin: RequirementOrigin,
  originClaimIds: z.array(z.string()),
  supersedesId: z.string().nullable(),
  createdAt: Iso,
}).refine(
  (r) => r.origin === "ba-authored" || r.originClaimIds.length > 0,
  { message: "a client-stated requirement must cite at least one origin claim", path: ["originClaimIds"] },
);

export const AcceptanceCriterionSchema = z.object({
  id: z.string(),
  storyId: z.string(),
  idx: z.number().int().nonnegative(),
  gherkin: z.string().min(1),
  source: AcSource,
  linkedQuestionId: z.string().nullable(),
});

export const StorySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string().regex(/^US-\d{3,}$/),
  asA: z.string().min(1),
  iWant: z.string().min(1),
  soThat: z.string().min(1),
  requirementIds: z.array(z.string()).min(1),
  createdAt: Iso,
});

export const OpenQuestionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string().regex(/^OQ-\d{3,}$/),
  text: z.string().min(1),
  category: CritiqueCategory,
  raisedBySessionId: z.string(),
  status: QuestionStatus,
  answerText: z.string().nullable(),
  answeredBySessionId: z.string().nullable(),
  createdAt: Iso,
});

export const RecommendationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string().regex(/^REC-\d{3,}$/),
  text: z.string().min(1),
  rationale: z.string().min(1),
  category: CritiqueCategory,
  raisedBySessionId: z.string(),
  status: RecommendationStatus,
  dispositionNote: z.string().nullable(),
  createdAt: Iso,
});

export const ApprovalEventSchema = z.object({
  id: z.string(),
  entityType: z.enum(["claim", "requirement", "story", "question", "recommendation", "session"]),
  entityId: z.string(),
  action: z.string().min(1),
  actorNote: z.string().nullable(),
  contentHash: z.string().length(64),
  at: Iso,
});

export const EgressLogSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  stage: z.string().min(1),
  requestHash: z.string().length(64),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  model: z.string().min(1),
  at: Iso,
});

export type Project = z.infer<typeof ProjectSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type Story = z.infer<typeof StorySchema>;
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type ApprovalEvent = z.infer<typeof ApprovalEventSchema>;
export type EgressLog = z.infer<typeof EgressLogSchema>;
