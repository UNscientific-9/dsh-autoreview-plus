import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, rm, symlink, realpath, stat as nodeStat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { RecordStore } from '../src/records.ts'
import { focusedHistory, redact, redactText } from '../src/evidence.ts'
import { safeRead, type SafeReadFileSystem } from '../src/safe-read.ts'
import { jevDecision, jevTransport } from '../src/jev.ts'
import { optionReader } from '../src/options.ts'
import { Context } from '@deepseek-ai/cordis'
import { PlusControl } from '../src/control.ts'
import type { ReviewRecord } from '../src/records.ts'

const root = path.resolve('.tmp', `plus-cases-${randomUUID()}`)
afterAll(async () => { if (!root.startsWith(path.resolve('.tmp') + path.sep)) throw new Error('Unsafe cleanup'); await rm(root, { recursive: true, force: true }) })

describe('confirmed decision evidence', () => {
  it('focuses two recent human prompts while keeping older restrictions and facts', () => {
    const history = [
      { kind: 'user-message', role: 'human-instruction', source: { rpcId: 'first' }, content: [{ text: '原始文件不能删' }] },
      { kind: 'tool-call', role: 'fact', name: 'write', arguments: 'temporary file' },
      { kind: 'user-message', role: 'human-instruction', source: { rpcId: 'second' }, content: [{ text: '整理临时文件' }] },
      { kind: 'user-message', role: 'human-instruction', source: { rpcId: 'third' }, content: [{ text: '继续' }] },
    ]
    const result = focusedHistory(history) as (typeof history[number] & { focus?: string })[]
    expect(result.filter(item => item.focus)).toHaveLength(2)
    expect(result[0]?.content?.[0]?.text).toBe('原始文件不能删')
    expect(result[1]).toEqual(history[1])
  })
  it('redacts credentials without rewriting an authorization replacement', () => {
    const fake = 'sk-' + 'Q'.repeat(24)
    expect(redact({ apiKey: fake, args: { target: 'keep-this', token: fake } })).toEqual({ apiKey: '[redacted]', args: { target: 'keep-this', token: '[redacted]' } })
    expect(redactText(`Authorization: Bearer ${fake}`)).not.toContain(fake)
    expect(redactText('Replace that authorization: delete target only.')).toBe('Replace that authorization: delete target only.')
  })
  it('redacts cookie headers and JSON-encoded historical arguments without losing targets', () => {
    const evidence = { action: { arguments: { path: 'keep-this', headers: { Cookie: 'sid=fixture-a; csrf=fixture-b' } } }, history: [{ arguments: JSON.stringify({ target: 'keep-that', cookie: 'sid=fixture-c; csrf=fixture-d', password: 'fixture password with spaces' }) }] }
    const result = redact(evidence) as typeof evidence
    expect(result.action.arguments).toEqual({ path: 'keep-this', headers: { Cookie: '[redacted]' } })
    expect(JSON.parse(result.history[0]!.arguments)).toEqual({ target: 'keep-that', cookie: '[redacted]', password: '[redacted]' })
    expect(redactText('Cookie: sid=fixture-a; csrf=fixture-b')).toBe('Cookie: [redacted]')
    expect(redactText('password="fixture password with spaces"')).not.toContain('fixture password')
  })
})
describe('durable records', () => {
  it('retains records and session model selection after reopening without pruning older pages', async () => {
    const store = new RecordStore(path.join(root, 'records'))
    for (let i = 0; i < 31; i++) {
      const id = await store.begin({ sessionId: 'session', callId: String(i), tool: 'read', startedAt: i, source: 'rule', status: 'allowed' })
      await store.update(id, { outcome: 'succeeded' })
    }
    await store.setPreference('session', { id: 'follow', selection: { backend: 'follow' } })
    await store.drain()
    const reopened = new RecordStore(store.directory)
    expect((await reopened.page('session')).rows).toHaveLength(30)
    expect((await reopened.page('session', 30)).rows).toHaveLength(1)
    expect(reopened.preferences.session?.id).toBe('follow')
    expect(reopened.rows.size).toBe(31)
  })
  it('marks a previously unsettled operation as interrupted instead of inventing success', async () => {
    const store = new RecordStore(path.join(root, 'interrupted'))
    await store.begin({ sessionId: 'session', callId: 'call', tool: 'bash', startedAt: 1, source: 'model', status: 'reviewing' })
    await store.drain()
    const reopened = new RecordStore(store.directory)
    expect((await reopened.page('session')).rows[0]?.outcome).toBe('interrupted')
  })
  it('rejects a failed audit update and recovers its write queue after storage recovers', async () => {
    const store = new RecordStore(path.join(root, 'audit-failure'))
    const id = await store.begin({ sessionId: 'session', callId: 'call', tool: 'probe', startedAt: 1, source: 'model', status: 'reviewing' })
    const io = vi.spyOn(store as unknown as { persist(row: ReviewRecord): Promise<void> }, 'persist').mockRejectedValueOnce(new Error('fixture ENOSPC'))
    try {
      await expect(store.update(id, { status: 'allowed' })).rejects.toThrow('fixture ENOSPC')
      expect(store.rows.get(id)?.status).toBe('reviewing')
      expect((await store.page('session')).error).toContain('fixture ENOSPC')
      await store.update(id, { status: 'denied', outcome: 'blocked' })
      expect(store.rows.get(id)).toMatchObject({ status: 'denied', outcome: 'blocked' })
      expect(store.error).toBeUndefined()
    } finally { io.mockRestore() }
  })
})
describe('conservative safe read', () => {
  const fs = {
    async resolve(requested: string, options?: { cwd?: string; signal?: AbortSignal }) {
      options?.signal?.throwIfAborted()
      const targetPath = await realpath(path.resolve(options?.cwd ?? process.cwd(), requested))
      return { targetKey: targetPath, displayPath: targetPath }
    },
    contains(parent: { targetKey: string }, child: { targetKey: string }) {
      const relative = path.relative(parent.targetKey, child.targetKey)
      return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    },
    async stat(target: { targetKey: string }, signal?: AbortSignal) {
      signal?.throwIfAborted()
      try {
        const info = await nodeStat(target.targetKey)
        return { type: info.isFile() ? 'file' as const : info.isDirectory() ? 'directory' as const : 'other' as const, size: info.size }
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
      }
    },
    processPath(target: { targetKey: string }) { return target.targetKey },
    async readBytes(target: { targetKey: string }, signal: AbortSignal | undefined, maxBytes: number) {
      signal?.throwIfAborted()
      const content = await readFile(target.targetKey)
      if (content.byteLength > maxBytes) throw new Error('fixture provider byte limit exceeded')
      return content
    },
  } as unknown as SafeReadFileSystem
  const signal = new AbortController().signal

  it('allows bounded ordinary local text only for the identified tool and without unresolved limits', async () => {
    const cwd = path.join(root, 'workspace'); await mkdir(cwd, { recursive: true }); await writeFile(path.join(cwd, 'note.txt'), 'ordinary project note')
    const snapshot = { cwd, projectInstructions: [], history: [], action: { name: 'read', arguments: { file_path: 'note.txt' } } }
    expect(await safeRead(snapshot, true, fs, signal)).toBe(true)
    // The official read tool names its argument file_path; any other shape stays out of the fast path.
    expect(await safeRead({ ...snapshot, action: { name: 'read', arguments: { path: 'note.txt' } } }, true, fs, signal)).toBe(false)
    expect(await safeRead({ ...snapshot, action: { name: 'read', arguments: { file_path: 'note.txt', offset: 0 } } }, true, fs, signal)).toBe(false)
    expect(await safeRead(snapshot, false, fs, signal)).toBe(false)
    expect(await safeRead({ ...snapshot, projectInstructions: ['Do not read files'] }, true, fs, signal)).toBe(false)
    expect(await safeRead({ ...snapshot, action: { name: 'bash', arguments: { command: 'cat note.txt' } } }, true, fs, signal)).toBe(false)
    expect(await safeRead({ ...snapshot, history: [{ role: 'human-instruction', content: [{ type: 'text', text: '生产环境' }] }] }, true, fs, signal)).toBe(false)
    for (const role of ['human-instruction', 'direct-parent-instruction', 'constraint', 'checkpoint']) {
      expect(await safeRead({ ...snapshot, history: [{ role, content: [{ type: 'text', text: '读取任何文件前先征得我同意' }] }] }, true, fs, signal)).toBe(false)
    }
    expect(await safeRead({ ...snapshot, history: [{ role: 'fact', content: [] }] }, true, fs, signal)).toBe(true)
  })
  it('rejects traversal, a sensitive file and a link escaping the workspace', async () => {
    const cwd = path.join(root, 'links'); await mkdir(cwd, { recursive: true }); await writeFile(path.join(root, 'outside.txt'), 'outside')
    await writeFile(path.join(cwd, 'secret.txt'), 'sensitive')
    const snapshot = { cwd, projectInstructions: [], history: [], action: { name: 'read', arguments: { file_path: '../outside.txt' } } }
    expect(await safeRead(snapshot, true, fs, signal)).toBe(false)
    expect(await safeRead({ ...snapshot, action: { name: 'read', arguments: { file_path: 'secret.txt' } } }, true, fs, signal)).toBe(false)
    await symlink(root, path.join(cwd, 'outside-link'), 'junction')
    expect(await safeRead({ ...snapshot, action: { name: 'read', arguments: { file_path: 'outside-link/outside.txt' } } }, true, fs, signal)).toBe(false)
  })
})

describe('model selection responsiveness', () => {
  async function fixture(listModels: (provider: string) => Promise<unknown[]>) {
    const ctx = new Context()
    ctx.provide('llm', { listProviders: () => [{ id: 'healthy' }, { id: 'slow' }], listModels })
    ctx.provide('sessions', { get: () => ({ id: 'session' }) })
    const store = new RecordStore(path.join(root, `catalog-${randomUUID()}`))
    await store.ready
    return { ctx, store, control: new PlusControl(ctx, store, optionReader()) }
  }
  it('retains healthy models when another provider times out', async () => {
    const { ctx, control } = await fixture(async provider => provider === 'healthy' ? [{ id: 'text', name: '可用模型', inputModalities: ['text'] }] : new Promise(() => {}))
    vi.useFakeTimers()
    try {
      const pending = control.catalog()
      await vi.advanceTimersByTimeAsync(10000)
      const catalog = await pending
      expect(catalog.incomplete).toBe(true)
      expect(catalog.choices.some(choice => choice.id === 'model/healthy/text')).toBe(true)
      expect(catalog.choices.some(choice => choice.id === 'jev/custom')).toBe(true)
    } finally { vi.useRealTimers(); await ctx.fiber.dispose() }
  })
  it('restores defaults and selects Jev without querying unavailable model catalogs', async () => {
    const listModels = vi.fn(() => new Promise<unknown[]>(() => {}))
    const { ctx, store, control } = await fixture(listModels)
    try {
      await control.select('session', 'jev/typesafe')
      expect(store.preferences.session?.selection).toEqual({ backend: 'jev', jevChannel: 'typesafe' })
      await control.select('session', 'default')
      expect(store.preferences.session?.selection).toBeNull()
      expect(listModels).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })
})
describe('Jev single request', () => {
  it('uses the chosen channel key and protects low confidence without retrying', async () => {
    const fetch = vi.spyOn(jevTransport, 'fetch').mockResolvedValue(Response.json({ answers: { decision: { choice: 'allow', confidence: 0.2 }, risk: { choice: 'low', confidence: 0.9 } } }) as never)
    try {
      const config = optionReader({ backend: 'jev', jevChannel: 'typesafe', typesafeKey: 'typesafe-fixture', commandcodeKey: 'different-channel', zdr: false })()
      await expect(jevDecision(config, 'policy', {}, new AbortController().signal, 'environment-fixture')).rejects.toThrow('置信度')
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(fetch.mock.calls[0]?.[1]?.headers).toEqual(expect.objectContaining({ authorization: 'Bearer typesafe-fixture' }))
    } finally { fetch.mockRestore() }
  })
  it('makes no request when the selected channel has no key or requires unsupported ZDR', async () => {
    const fetch = vi.spyOn(jevTransport, 'fetch')
    try {
      await expect(jevDecision(optionReader({ jevChannel: 'typesafe', commandcodeKey: 'other-only', zdr: false })(), 'policy', {}, new AbortController().signal)).rejects.toThrow('密钥')
      await expect(jevDecision(optionReader({ jevChannel: 'commandcode', commandcodeKey: 'fixture-key', zdr: true })(), 'policy', {}, new AbortController().signal)).rejects.toThrow('零数据留存')
      expect(fetch).not.toHaveBeenCalled()
    } finally { fetch.mockRestore() }
  })
})
