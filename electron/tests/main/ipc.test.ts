// electron/tests/main/ipc.test.ts
//
// Exercises the REAL `session:analyze` handler registered by `setupIpc()` in
// electron/src/main/ipc.ts — not a test-local re-implementation of its
// dispatch logic. `ipcMain.handle` is mocked to capture each registered
// handler by channel name, so the test retrieves and invokes the actual
// handler function ipc.ts builds. A regression in ipc.ts's real dispatch
// (selectBackend call, release() contract, progress forwarding) will show up
// here.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAnthropicInstance = { model: 'claude-opus-5', generate: vi.fn() }
const mockLocalInstance = { model: 'local-test', generate: vi.fn() }
const mockRelease = vi.fn().mockResolvedValue(undefined)
const mockCreateClient = vi.fn(() => ({}))
const mockAnthropicBackend = vi.fn(() => mockAnthropicInstance)
const mockLoadLocalBackend = vi.fn(async (_opts: { log?: (line: string) => void }) => ({
  backend: mockLocalInstance,
  release: mockRelease,
}))
const mockAnalyzeSession = vi.fn(async () => ({
  extracted: 1, validated: 1, quarantined: 0, requirements: 1, stories: 0, questions: 0, recommendations: 0,
}))
const mockQuarantineRate = vi.fn(() => 0)

// Mock only the LLM-backend-construction boundary and the pipeline entry
// point — everything else ipc.ts imports (src/store/projects.js,
// src/store/transcripts.js, src/store/db.js's schema/queries, etc.) runs for
// real against a real in-memory SQLite database.
vi.mock('../../../src/llm/client.js', () => ({
  createClient: mockCreateClient,
  AnthropicBackend: mockAnthropicBackend,
}))
vi.mock('../../../src/llm/local-client.js', () => ({
  loadLocalBackend: mockLoadLocalBackend,
}))
vi.mock('../../../src/pipeline/index.js', () => ({
  analyzeSession: mockAnalyzeSession,
  quarantineRate: mockQuarantineRate,
}))
// Irrelevant to this test — avoid unrelated seeded demo data polluting the
// shared in-memory db.
vi.mock('../../src/main/demo-data.js', () => ({
  seedDemoWorkspace: vi.fn(),
}))
// ipc.ts's own internal getDb() opens a db keyed off app.getPath('userData');
// the test seeds data through its own openDb(':memory:') call. Mocking
// openDb to always return ONE shared real (unmocked-internals) database
// means both sides operate on the exact same instance regardless of what
// path argument either passes.
vi.mock('../../../src/store/db.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/store/db.js')>('../../../src/store/db.js')
  const sharedDb = actual.openDb(':memory:')
  return { ...actual, openDb: vi.fn(() => sharedDb) }
})

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((channel: string, fn: any) => handlers.set(channel, fn)) },
  app: { getPath: vi.fn(() => '/fake-userdata') },
}))

import { openDb } from '../../../src/store/db.js'
import { createProject, createSession } from '../../../src/store/projects.js'
import { createTranscript, freezeTranscript } from '../../../src/store/transcripts.js'

describe('session:analyze (real ipc.ts handler, via setupIpc)', () => {
  let db: ReturnType<typeof openDb>

  beforeEach(async () => {
    vi.clearAllMocks()
    handlers.clear()
    db = openDb(':memory:') // returns the shared mocked instance
    const { setupIpc } = await import('../../src/main/ipc.js')
    setupIpc()
  })

  async function seedSession(llmBackend: 'claude' | 'local') {
    const project = createProject(db, {
      name: 'Test', domain: 'invoice approval for logistics operators', llmBackend,
    })
    const session = createSession(db, { projectId: project.id, title: 'S' })
    const { transcript } = createTranscript(db, {
      sessionId: session.id,
      text: 'The client discussed invoice approval thresholds in detail. '.repeat(20),
    })
    freezeTranscript(db, transcript.id)
    return { project, session }
  }

  it('dispatches to AnthropicBackend for a "claude" project and does not touch the local backend', async () => {
    const { session } = await seedSession('claude')
    const handler = handlers.get('session:analyze')!
    const fakeEvent = { sender: { send: vi.fn() } }
    await handler(fakeEvent, { sessionId: session.id })
    expect(mockAnthropicBackend).toHaveBeenCalledTimes(1)
    expect(mockLoadLocalBackend).not.toHaveBeenCalled()
  })

  it('dispatches to loadLocalBackend for a "local" project and calls its real release', async () => {
    const { session } = await seedSession('local')
    const handler = handlers.get('session:analyze')!
    const fakeEvent = { sender: { send: vi.fn() } }
    await handler(fakeEvent, { sessionId: session.id })
    expect(mockLoadLocalBackend).toHaveBeenCalledTimes(1)
    expect(mockAnthropicBackend).not.toHaveBeenCalled()
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('still calls release() even when analyzeSession throws', async () => {
    mockAnalyzeSession.mockRejectedValueOnce(new Error('boom'))
    const { session } = await seedSession('local')
    const handler = handlers.get('session:analyze')!
    const fakeEvent = { sender: { send: vi.fn() } }
    await expect(handler(fakeEvent, { sessionId: session.id })).rejects.toThrow('boom')
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('forwards local model download progress on the analyze:progress channel', async () => {
    mockLoadLocalBackend.mockImplementationOnce(async ({ log }: { log?: (line: string) => void }) => {
      log?.('Downloading local model: 50.0%')
      return { backend: mockLocalInstance, release: mockRelease }
    })
    const { session } = await seedSession('local')
    const handler = handlers.get('session:analyze')!
    const fakeEvent = { sender: { send: vi.fn() } }
    await handler(fakeEvent, { sessionId: session.id })
    expect(fakeEvent.sender.send).toHaveBeenCalledWith('analyze:progress', {
      stage: 'local-model', status: 'Downloading local model: 50.0%',
    })
  })
})
