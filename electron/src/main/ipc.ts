import { ipcMain, app } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'node:fs'

// ─── Core engine imports (worktree root = ba-story-agent repo) ───────────────
// File: electron/src/main/ipc.ts (3 levels deep)
// ../../.. from ipc.ts = ba-story-electron/ (worktree root) = ba-story-agent repo
// so ../../../src/ resolves correctly to the core engine's src/ directory.
import { openDb } from '../../../src/store/db.js'
import {
  createProject,
  getProject,
  createSession,
  listProjects,
  listSessions,
  setProjectDomain,
  deleteProject,
  deleteSession,
} from '../../../src/store/projects.js'
import { amendTranscript, createTranscript, freezeTranscript, getFrozenTranscript, hashText } from '../../../src/store/transcripts.js'
import { listRequirements, setRequirementStatus, listStories } from '../../../src/store/artifacts.js'
import { listQuestions, listRecommendations } from '../../../src/store/findings.js'
import { listClaims, countByStatus } from '../../../src/store/claims.js'
import { recordApproval } from '../../../src/store/audit.js'
import { analyzeSession, quarantineRate } from '../../../src/pipeline/index.js'
import { buildSnapshot } from '../../../src/export/snapshot.js'
import { markdownPublisher } from '../../../src/export/markdown.js'
import { jsonPublisher } from '../../../src/export/json.js'
import { createClient, AnthropicBackend } from '../../../src/llm/client.js'
import { loadLocalBackend } from '../../../src/llm/local-client.js'
import type { LlmBackend } from '../../../src/llm/backend.js'
import { countWords, MIN_WORDS } from '../../../src/pipeline/stage0-chunk.js'
import { RegulatoryContext } from '../../../src/types/domain.js'
import { seedDemoWorkspace } from './demo-data.js'

let _db: ReturnType<typeof openDb> | null = null

function getDb(): ReturnType<typeof openDb> {
  if (!_db) {
    const userData = app.getPath('userData')
    _db = openDb(join(userData, 'ba-story-agent.db'))
    seedDemoWorkspace(_db)
  }
  return _db
}

type Log = (line: string) => void

/**
 * Mirrors src/cli/index.ts's selectBackend() exactly — same dispatch logic,
 * same release contract. Do not let this drift into a second, divergent
 * implementation of the same idea.
 */
async function selectBackend(
  llmBackend: 'claude' | 'local',
  log: Log,
): Promise<{ client: LlmBackend; release: () => Promise<void> }> {
  if (llmBackend === 'local') {
    const { backend, release } = await loadLocalBackend({ log })
    return { client: backend, release }
  }
  return { client: new AnthropicBackend(createClient()), release: async () => {} }
}

export function setupIpc(): void {
  // ─── Projects ─────────────────────────────────────────────────────────────

  ipcMain.handle('project:list', async () => {
    return listProjects(getDb())
  })

  ipcMain.handle('project:create', async (_event, data: {
    name: string; domain?: string; regulatory?: string; systemName?: string
  }) => {
    const db = getDb()
    return createProject(db, {
      name: data.name,
      // domain is optional at creation — analyzeSession() itself refuses to
      // run for a project with no domain set, so this is safe to leave
      // unset here. Use project:set-domain to fill it in later.
      domain: data.domain ?? null,
      regulatoryContext: data.regulatory
        ? RegulatoryContext.parse(data.regulatory)
        : 'none',
      systemName: data.systemName ?? null,
      // No user-facing choice: this app is fully local-only. llmBackend is
      // never accepted from the renderer — always 'local', unconditionally.
      llmBackend: 'local',
    })
  })

  ipcMain.handle('project:set-domain', async (_event, data: { projectId: string; domain: string }) => {
    const db = getDb()
    return setProjectDomain(db, data.projectId, data.domain)
  })

  ipcMain.handle('project:get', async (_event, id: string) => {
    const db = getDb()
    return getProject(db, id)
  })

  ipcMain.handle('project:delete', async (_event, id: string) => {
    return { deleted: deleteProject(getDb(), id) }
  })

  // ─── Sessions ─────────────────────────────────────────────────────────────

  ipcMain.handle('session:list', async (_event, projectId: string) => {
    const db = getDb()
    return listSessions(db, projectId)
  })

  ipcMain.handle('session:add', async (_event, data: {
    projectId: string; title: string; transcriptText: string; occurredAt?: string
  }) => {
    const db = getDb()
    const words = countWords(data.transcriptText)
    if (words < MIN_WORDS) {
      throw new Error(
        `Transcript is ${words} words; at least ${MIN_WORDS} required.`
      )
    }
    const session = createSession(db, {
      projectId: data.projectId,
      title: data.title,
      ...(data.occurredAt ? { occurredAt: data.occurredAt } : {}),
    })
    const { transcript } = createTranscript(db, {
      sessionId: session.id,
      text: data.transcriptText,
    })
    freezeTranscript(db, transcript.id)
    return session
  })

  ipcMain.handle('session:transcript', async (_event, sessionId: string) => {
    return getFrozenTranscript(getDb(), sessionId)?.transcript ?? null
  })

  ipcMain.handle('session:amend-transcript', async (_event, data: {
    sessionId: string; transcriptText: string
  }) => {
    const words = countWords(data.transcriptText)
    if (words < MIN_WORDS) {
      throw new Error(
        `Transcript is ${words} words; at least ${MIN_WORDS} required.`
      )
    }
    return amendTranscript(getDb(), {
      sessionId: data.sessionId,
      text: data.transcriptText,
    })
  })

  ipcMain.handle('session:delete', async (_event, id: string) => {
    return { deleted: deleteSession(getDb(), id) }
  })

  // ─── Analysis ─────────────────────────────────────────────────────────────

  ipcMain.handle('session:analyze', async (event, data: {
    sessionId: string; resume?: boolean
  }) => {
    const db = getDb()
    const frozen = getFrozenTranscript(db, data.sessionId)
    if (!frozen) throw new Error(`Session ${data.sessionId} has no frozen transcript`)
    const row = db
      .prepare('SELECT project_id FROM sessions WHERE id = ?')
      .get(data.sessionId) as { project_id: string } | undefined
    if (!row) throw new Error(`Session ${data.sessionId} not found`)
    const project = getProject(db, row.project_id)
    if (!project) throw new Error(`Project ${row.project_id} not found`)

    const { client, release } = await selectBackend(
      project.llmBackend,
      (line: string) => event.sender.send('analyze:progress', { stage: 'local-model', status: line }),
    )
    try {
      const state = await analyzeSession(
        {
          db,
          client,
          projectId: row.project_id,
          sessionId: data.sessionId,
        },
        frozen.transcript.id,
        {
          resume: data.resume ?? false,
          onProgress: (name: string, status: string) => {
            event.sender.send('analyze:progress', { stage: name, status })
          },
        }
      )

      return {
        ...state,
        quarantineRate: quarantineRate(state),
      }
    } finally {
      await release()
    }
  })

  // ─── Requirements ─────────────────────────────────────────────────────────

  ipcMain.handle('requirement:list', async (_event, projectId: string) => {
    const db = getDb()
    return listRequirements(db, projectId)
  })

  ipcMain.handle('requirement:approve', async (_event, data: {
    requirementId: string; projectId: string; note?: string
  }) => {
    const db = getDb()
    const reqs = listRequirements(db, data.projectId)
    const req = reqs.find(r => r.id === data.requirementId)
    if (!req) throw new Error(`Requirement ${data.requirementId} not found`)
    recordApproval(db, {
      entityType: 'requirement',
      entityId: req.id,
      action: 'approve',
      actorNote: data.note ?? null,
      contentHash: hashText(req.statement),
    })
    setRequirementStatus(db, req.id, 'finalized')
    return req
  })

  ipcMain.handle('requirement:reject', async (_event, data: {
    requirementId: string; projectId: string; reason: string
  }) => {
    const db = getDb()
    const reqs = listRequirements(db, data.projectId)
    const req = reqs.find(r => r.id === data.requirementId)
    if (!req) throw new Error(`Requirement ${data.requirementId} not found`)
    recordApproval(db, {
      entityType: 'requirement',
      entityId: req.id,
      action: 'reject',
      actorNote: data.reason,
      contentHash: hashText(req.statement),
    })
    setRequirementStatus(db, req.id, 'rejected')
    return req
  })

  // ─── Assumptions (Claims with kind=assumption) ────────────────────────────
  // The core engine stores assumptions as claims with kind='assumption'

  ipcMain.handle('assumption:list', async (_event, projectId: string) => {
    const db = getDb()
    const sessions = listSessions(db, projectId)
    const allAssumptions = sessions.flatMap(s =>
      listClaims(db, s.id).filter(c => c.kind === 'assumption')
    )
    return allAssumptions
  })

  ipcMain.handle('assumption:promote', async (_event, data: {
    claimId: string; projectId: string; verificationNote: string
  }) => {
    // Promoting an assumption to a requirement: record an approval event noting
    // the verification and let the next analysis run pick it up, or the BA can
    // manually create a requirement referencing this claim.
    const db = getDb()
    recordApproval(db, {
      entityType: 'claim',
      entityId: data.claimId,
      action: 'promote-assumption',
      actorNote: data.verificationNote,
      contentHash: hashText(data.verificationNote),
    })
    return { promoted: true }
  })

  // ─── Open Questions ────────────────────────────────────────────────────────

  ipcMain.handle('question:list', async (_event, projectId: string) => {
    const db = getDb()
    return listQuestions(db, projectId)
  })

  ipcMain.handle('question:update-status', async (_event, data: {
    questionId: string; status: string
  }) => {
    const db = getDb()
    db.prepare('UPDATE open_questions SET status = ? WHERE id = ?')
      .run(data.status, data.questionId)
    return { updated: true }
  })

  // ─── Recommendations ──────────────────────────────────────────────────────

  ipcMain.handle('recommendation:list', async (_event, projectId: string) => {
    const db = getDb()
    return listRecommendations(db, projectId)
  })

  ipcMain.handle('recommendation:accept', async (_event, data: {
    recommendationId: string; asRequirement?: boolean; baStatement?: string
  }) => {
    const db = getDb()
    db.prepare('UPDATE recommendations SET status = ?, disposition_note = ? WHERE id = ?')
      .run('accepted', data.baStatement ?? null, data.recommendationId)
    return { accepted: true }
  })

  ipcMain.handle('recommendation:decline', async (_event, data: {
    recommendationId: string; reason: string
  }) => {
    const db = getDb()
    db.prepare('UPDATE recommendations SET status = ?, disposition_note = ? WHERE id = ?')
      .run('declined', data.reason, data.recommendationId)
    return { declined: true }
  })

  // ─── Claims (for evidence panel) ──────────────────────────────────────────

  ipcMain.handle('claim:get', async (_event, claimId: string) => {
    const db = getDb()
    const row = db
      .prepare('SELECT * FROM claims WHERE id = ?')
      .get(claimId) as Record<string, unknown> | undefined
    if (!row) return null
    // Also fetch surrounding transcript text for context
    const transcript = row.transcript_id
      ? (db.prepare('SELECT text, content_hash FROM transcripts WHERE id = ?').get(row.transcript_id) as any)
      : null
    return {
      id: row.id,
      quote: row.quote,
      statement: row.statement,
      kind: row.kind,
      status: row.status,
      speakerRole: row.speaker_role,
      charStart: row.char_start,
      charEnd: row.char_end,
      // Extract surrounding context (200 chars around the quote)
      context: transcript && typeof row.char_start === 'number'
        ? transcript.text.slice(
            Math.max(0, (row.char_start as number) - 150),
            Math.min(transcript.text.length, (row.char_end as number) + 150)
          )
        : null,
    }
  })

  // ─── Stories ──────────────────────────────────────────────────────────────

  ipcMain.handle('story:list', async (_event, projectId: string) => {
    const db = getDb()
    return listStories(db, projectId)
  })

  // ─── Export ───────────────────────────────────────────────────────────────

  ipcMain.handle('export:project', async (_event, data: {
    projectId: string; outDir: string; includeProposed?: boolean
  }) => {
    const db = getDb()
    const snapshot = buildSnapshot(db, data.projectId, {
      includeProposed: data.includeProposed ?? false,
    })
    mkdirSync(data.outDir, { recursive: true })
    const mdPath = join(data.outDir, 'requirements.md')
    const jsonPath = join(data.outDir, 'requirements.json')
    writeFileSync(mdPath, markdownPublisher.publish(snapshot), 'utf8')
    writeFileSync(jsonPath, jsonPublisher.publish(snapshot), 'utf8')
    return { mdPath, jsonPath }
  })

  // ─── Status ───────────────────────────────────────────────────────────────

  ipcMain.handle('project:status', async (_event, projectId: string) => {
    const db = getDb()
    const project = getProject(db, projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)
    const sessions = listSessions(db, projectId)
    const requirements = listRequirements(db, projectId)
    const stories = listStories(db, projectId)
    const questions = listQuestions(db, projectId)
    const recommendations = listRecommendations(db, projectId)

    const sessionDetails = sessions.map(s => ({
      ...s,
      claimCounts: countByStatus(db, s.id),
    }))

    return {
      project,
      sessions: sessionDetails,
      requirementCount: requirements.length,
      finalizedCount: requirements.filter(r => r.status === 'finalized').length,
      storyCount: stories.length,
      openQuestionCount: questions.filter(q => q.status === 'open').length,
      recommendationCount: recommendations.length,
    }
  })
}
