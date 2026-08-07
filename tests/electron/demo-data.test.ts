import { describe, expect, it } from 'vitest'
import { openDb } from '../../src/store/db.js'
import { deleteProject, getProject, listProjects, listSessions } from '../../src/store/projects.js'
import { getFrozenTranscript } from '../../src/store/transcripts.js'
import { listClaims } from '../../src/store/claims.js'
import { listRequirements } from '../../src/store/artifacts.js'
import { listQuestions, listRecommendations } from '../../src/store/findings.js'
import { DEMO_MARKER_KEY, seedDemoWorkspace } from '../../electron/src/main/demo-data.js'

describe('demo workspace', () => {
  it('seeds a complete demo exactly once', () => {
    const db = openDb(':memory:')
    const projectId = seedDemoWorkspace(db)

    expect(projectId).toBeTruthy()
    expect(seedDemoWorkspace(db)).toBeNull()
    expect(listProjects(db)).toHaveLength(1)
    expect(getProject(db, projectId!)?.name).toContain('Demo')

    const sessions = listSessions(db, projectId!)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.status).toBe('awaiting-review')
    expect(getFrozenTranscript(db, sessions[0]!.id)?.transcript.text.length).toBeGreaterThan(1_000)

    const claims = listClaims(db, sessions[0]!.id)
    expect(claims.filter(claim => claim.kind === 'assumption')).toHaveLength(2)
    expect(listRequirements(db, projectId!)).toHaveLength(4)
    expect(listQuestions(db, projectId!)).toHaveLength(3)
    expect(listRecommendations(db, projectId!)).toHaveLength(3)
  })

  it('does not recreate the demo after the user deletes it', () => {
    const db = openDb(':memory:')
    const projectId = seedDemoWorkspace(db)!

    expect(deleteProject(db, projectId)).toBe(true)
    expect(seedDemoWorkspace(db)).toBeNull()
    expect(listProjects(db)).toHaveLength(0)
    expect((db.prepare('SELECT value FROM app_metadata WHERE key = ?').get(DEMO_MARKER_KEY) as { value: string }).value)
      .toBe(projectId)
  })
})
