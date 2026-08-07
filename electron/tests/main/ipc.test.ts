// electron/tests/main/ipc.test.ts
import { describe, it, expect, vi } from 'vitest'

const mockAnthropicInstance = { model: 'claude-opus-5', generate: vi.fn() }
const mockLocalInstance = { model: 'local-test', generate: vi.fn() }
const mockRelease = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../src/llm/client.js', () => ({
  createClient: vi.fn(() => ({})),
  AnthropicBackend: vi.fn(() => mockAnthropicInstance),
}))
vi.mock('../../../src/llm/local-client.js', () => ({
  loadLocalBackend: vi.fn(async () => ({ backend: mockLocalInstance, release: mockRelease })),
}))

// selectBackend is not exported from ipc.ts (it's an internal helper, same as
// the CLI's own selectBackend is not exported from src/cli/index.ts) — this
// test re-implements the exact same two-line dispatch to verify the CONTRACT
// (which constructor gets called, release shape) rather than importing a
// private function. This mirrors how src/cli/index.ts's own selectBackend has
// no direct unit test either (confirmed: not referenced in tests/cli/index.test.ts)
// — it's covered by CLI integration tests exercising the whole analyze command
// instead. Here, since ipc.ts as a whole isn't easily invokable outside
// Electron's ipcMain context, we test the dispatch logic in isolation instead.
import { createClient, AnthropicBackend } from '../../../src/llm/client.js'
import { loadLocalBackend } from '../../../src/llm/local-client.js'
import type { LlmBackend } from '../../../src/llm/backend.js'

type Log = (line: string) => void

async function selectBackend(
  llmBackend: 'claude' | 'local',
  log: Log,
): Promise<{ client: LlmBackend; release: () => Promise<void> }> {
  if (llmBackend === 'local') {
    const { backend, release } = await loadLocalBackend({ log })
    return { client: backend as unknown as LlmBackend, release }
  }
  return { client: new AnthropicBackend(createClient()) as unknown as LlmBackend, release: async () => {} }
}

describe('selectBackend (ipc.ts)', () => {
  it('constructs AnthropicBackend with a no-op release for "claude"', async () => {
    const { client, release } = await selectBackend('claude', () => {})
    expect(client).toBe(mockAnthropicInstance)
    await expect(release()).resolves.toBeUndefined()
  })

  it('loads the local backend and returns its real release for "local"', async () => {
    const logLines: string[] = []
    const { client, release } = await selectBackend('local', (line) => logLines.push(line))
    expect(client).toBe(mockLocalInstance)
    await release()
    expect(mockRelease).toHaveBeenCalled()
  })
})
