// Types for the IPC bridge exposed via contextBridge → window.api

export interface Project {
  id: string
  name: string
  domain: string | null
  regulatoryContext: string
  systemName: string | null
  glossary: string | null
  llmBackend: 'claude' | 'local'
  createdAt: string
}

export interface Session {
  id: string
  projectId: string
  title: string
  occurredAt: string
  status: 'draft' | 'awaiting-review' | 'finalized' | 'failed'
  createdAt: string
}

export interface Transcript {
  id: string
  sessionId: string
  version: number
  text: string
  contentHash: string
  frozenAt: string | null
  createdAt: string
}

export interface TranscriptAmendmentResult {
  transcript: Transcript
  invalidated: {
    claims: number
    requirements: number
    stories: number
    questions: number
    recommendations: number
    checkpoints: number
  }
}

export interface DetectedSpeaker {
  label: string
  confirmedRole: string | null
}

export interface Requirement {
  id: string
  projectId: string
  key: string
  statement: string
  status: 'proposed' | 'finalized' | 'rejected'
  origin: 'client-stated' | 'ba-authored'
  originClaimIds: string[]
  supersedesId: string | null
  createdAt: string
}

export interface Claim {
  id: string
  sessionId: string
  transcriptId: string
  segmentId: string
  quote: string
  statement: string
  speakerRole: string
  kind: 'requirement' | 'assumption' | 'ambiguity'
  status: 'candidate' | 'validated' | 'validated (fuzzy)' | 'validated (segmentCorrected)' | 'quarantined'
  charStart: number | null
  charEnd: number | null
  matchMode: string | null
  createdAt: string
  // Extra fields fetched by claim:get for the evidence panel
  context?: string | null
}

export interface OpenQuestion {
  id: string
  projectId: string
  key: string
  text: string
  category: string
  raisedBySessionId: string
  status: 'open' | 'asked' | 'answered' | 'closed'
  answerText: string | null
  answeredBySessionId: string | null
  createdAt: string
}

export interface Recommendation {
  id: string
  projectId: string
  key: string
  text: string
  rationale: string
  category: string
  raisedBySessionId: string
  status: 'open' | 'accepted' | 'declined'
  dispositionNote: string | null
  createdAt: string
}

export interface Story {
  story: {
    id: string
    projectId: string
    key: string
    asA: string
    iWant: string
    soThat: string
    requirementIds: string[]
    createdAt: string
  }
  criteria: {
    id: string
    storyId: string
    idx: number
    gherkin: string
    source: 'client-stated' | 'derived'
    linkedQuestionId: string | null
  }[]
}

export interface AnalyzeResult {
  extracted: number
  validated: number
  quarantined: number
  requirements: number
  stories: number
  questions: number
  recommendations: number
  quarantineRate: number
}

export interface ProjectStatus {
  project: Project
  sessions: (Session & { claimCounts: Record<string, number> })[]
  requirementCount: number
  finalizedCount: number
  storyCount: number
  openQuestionCount: number
  recommendationCount: number
}

// Window augmentation — types for window.api
declare global {
  interface Window {
    api: {
      project: {
        list: () => Promise<Project[]>
        create: (data: {
          name: string; domain?: string; regulatory?: string; systemName?: string
        }) => Promise<Project>
        setDomain: (data: { projectId: string; domain: string }) => Promise<Project>
        suggestDomain: (data: { sessionId: string }) => Promise<{ domain: string }>
        get: (id: string) => Promise<Project | null>
        status: (id: string) => Promise<ProjectStatus>
        delete: (id: string) => Promise<{ deleted: boolean }>
      }
      session: {
        list: (projectId: string) => Promise<Session[]>
        add: (data: {
          projectId: string; title: string; transcriptText: string; occurredAt?: string
        }) => Promise<Session>
        analyze: (data: { sessionId: string; resume?: boolean }) => Promise<AnalyzeResult>
        transcript: (sessionId: string) => Promise<Transcript | null>
        amendTranscript: (data: {
          sessionId: string; transcriptText: string
        }) => Promise<TranscriptAmendmentResult>
        delete: (id: string) => Promise<{ deleted: boolean }>
      }
      speaker: {
        list: (sessionId: string) => Promise<DetectedSpeaker[]>
        setRoles: (data: { sessionId: string; roles: Record<string, string> }) => Promise<{ saved: boolean }>
      }
      requirement: {
        list: (projectId: string) => Promise<Requirement[]>
        approve: (data: { requirementId: string; projectId: string; note?: string }) => Promise<Requirement>
        reject: (data: { requirementId: string; projectId: string; reason: string }) => Promise<Requirement>
      }
      assumption: {
        list: (projectId: string) => Promise<Claim[]>
        promote: (data: { claimId: string; projectId: string; verificationNote: string }) => Promise<{ promoted: boolean }>
      }
      question: {
        list: (projectId: string) => Promise<OpenQuestion[]>
        updateStatus: (data: { questionId: string; status: string }) => Promise<{ updated: boolean }>
      }
      recommendation: {
        list: (projectId: string) => Promise<Recommendation[]>
        accept: (data: { recommendationId: string; asRequirement?: boolean; baStatement?: string }) => Promise<{ accepted: boolean }>
        decline: (data: { recommendationId: string; reason: string }) => Promise<{ declined: boolean }>
      }
      claim: {
        get: (id: string) => Promise<Claim | null>
      }
      story: {
        list: (projectId: string) => Promise<Story[]>
      }
      export: {
        project: (data: { projectId: string; outDir: string; includeProposed?: boolean }) => Promise<{ mdPath: string; jsonPath: string }>
      }
      onProgress: (callback: (progress: { stage: string; status: string }) => void) => () => void
    }
  }
}
