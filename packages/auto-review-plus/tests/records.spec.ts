import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PlusControl } from '../src/control.ts'
import { optionReader } from '../src/options.ts'
import { RecordStore, RecordWriteError, type ReviewRecord } from '../src/records.ts'

const originalFs = vi.hoisted(() => ({ readFile: undefined as unknown, writeFile: undefined as unknown }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal()
  originalFs.readFile = actual.readFile
  originalFs.writeFile = actual.writeFile
  return { ...actual, readFile: vi.fn(actual.readFile), writeFile: vi.fn(actual.writeFile) }
})

const root = path.resolve('.tmp', `records-cases-${randomUUID()}`)
afterAll(async () => {
  if (!root.startsWith(path.resolve('.tmp') + path.sep)) throw new Error('Unsafe cleanup')
  await fs.rm(root, { recursive: true, force: true })
})

async function directory(name: string): Promise<string> {
  const result = path.join(root, name)
  await fs.mkdir(result, { recursive: true })
  return result
}

function newRow(overrides: Partial<Omit<ReviewRecord, 'id'>> = {}): Omit<ReviewRecord, 'id'> {
  return { sessionId: 'session-a', callId: randomUUID(), tool: 'read', startedAt: Date.now(), source: 'model', status: 'reviewing', ...overrides }
}

describe('record loading and writes', () => {
  it('keeps load warnings after successful writes and reports/recover write failures', async () => {
    const dir = await directory('persistent-warning')
    const brokenId = randomUUID()
    await fs.writeFile(path.join(dir, `${brokenId}.json`), '{broken')
    const store = new RecordStore(dir)
    await store.ready
    const loadWarning = store.error
    expect(loadWarning).toContain(brokenId)

    const id = await store.begin(newRow())
    expect(store.error).toBe(loadWarning)

    const recordWrite = vi.mocked(fs.writeFile)
    recordWrite.mockRejectedValueOnce(new Error('fixture record ENOSPC'))
    try {
      await expect(store.update(id, { status: 'allowed' })).rejects.toBeInstanceOf(RecordWriteError)
      expect(store.error).toContain('fixture record ENOSPC')
      expect(store.error).toContain(brokenId)
      expect(store.rows.get(id)?.status).toBe('reviewing')
    } finally { recordWrite.mockClear() }
    await store.update(id, { status: 'allowed' })
    expect(store.rows.get(id)?.status).toBe('allowed')
    expect(store.error).toBe(loadWarning)

    const preferenceWrite = vi.mocked(fs.writeFile)
    preferenceWrite.mockRejectedValueOnce(new Error('fixture preference ENOSPC'))
    try {
      await expect(store.setPreference('session-a', { id: 'follow', selection: { backend: 'follow' } })).rejects.toBeInstanceOf(RecordWriteError)
      expect(store.error).toContain('fixture preference ENOSPC')
      expect(store.preferences['session-a']).toBeUndefined()
    } finally { preferenceWrite.mockClear() }
    await store.setPreference('session-a', { id: 'follow', selection: { backend: 'follow' } })
    expect(store.preferences['session-a']?.id).toBe('follow')
    expect(store.error).toBe(loadWarning)
  })

  it('loads UUID records with at most 16 concurrent reads and isolates malformed rows', async () => {
    const dir = await directory('bounded-load')
    const interruptedId = randomUUID()
    for (let index = 0; index < 33; index++) {
      const id = index === 0 ? interruptedId : randomUUID()
      const record = { ...newRow({ callId: String(index), startedAt: index, status: 'allowed' }), id }
      await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(record))
    }
    const brokenId = randomUUID()
    await fs.writeFile(path.join(dir, `${brokenId}.json`), '{broken')

    const readFileMock = vi.mocked(fs.readFile)
    const originalReadFile = originalFs.readFile as typeof fs.readFile
    let active = 0
    let maximum = 0
    readFileMock.mockImplementation(async (file, options) => {
      const name = path.basename(String(file))
      if (/^[0-9a-f-]{36}\.json$/u.test(name)) {
        active++
        maximum = Math.max(maximum, active)
        try {
          await new Promise(resolve => setTimeout(resolve, 3))
          return await originalReadFile(file, options)
        } finally { active-- }
      }
      return originalReadFile(file, options)
    })
    try {
      const store = new RecordStore(dir)
      await store.ready
      expect(maximum).toBeGreaterThan(1)
      expect(maximum).toBeLessThanOrEqual(16)
      expect(store.rows.size).toBe(33)
      expect(store.rows.get(interruptedId)?.outcome).toBe('interrupted')
      expect(store.error).toContain(brokenId)
    } finally { readFileMock.mockImplementation(originalReadFile) }
  })
})

describe('paged session statistics', () => {
  it('counts the full session in one scan, reflects updates, and keeps other sessions separate', async () => {
    const dir = await directory('page-statistics')
    const brokenId = randomUUID()
    await fs.writeFile(path.join(dir, `${brokenId}.json`), '{broken')
    const store = new RecordStore(dir)
    await store.ready

    for (let index = 0; index < 30; index++) await store.begin(newRow({ callId: `allowed-${index}`, startedAt: index, status: 'allowed' }))
    await store.begin(newRow({ callId: 'rule-allowed', source: 'rule', startedAt: 40, status: 'allowed' }))
    const updated = await store.begin(newRow({ callId: 'rule-reviewing', source: 'rule', startedAt: 41, status: 'reviewing' }))
    await store.update(updated, { status: 'allowed' })
    await store.begin(newRow({ callId: 'model-denied', startedAt: 42, status: 'denied' }))
    await store.begin(newRow({ callId: 'model-awaiting', startedAt: 43, status: 'awaiting_user' }))
    await store.begin(newRow({ callId: 'model-error', startedAt: 44, status: 'error' }))
    await store.begin(newRow({ sessionId: 'session-b', callId: 'other-allowed', source: 'rule', status: 'allowed' }))
    await store.begin(newRow({ sessionId: 'session-b', callId: 'other-error', status: 'error' }))

    const ctx = new Context()
    ctx.provide('sessions', { get: (id: string) => ({ id }) })
    ctx.provide('permissionPresets', { current: () => 'auto' })
    const control = new PlusControl(ctx, store, optionReader())
    control.auditError = '最终执行结果尚未记录。'
    const values = vi.spyOn(store.rows, 'values')
    try {
      const status = await control.status('session-a', 30)
      expect(status.total).toBe(35)
      expect(status.rows).toHaveLength(5)
      expect(status.rules).toBe(2)
      expect(status.allowed).toBe(30)
      expect(status.denied).toBe(2)
      expect(status.failures).toBe(1)
      expect(status.error).toContain(brokenId)
      expect(status.error).toContain('最终执行结果尚未记录。')
      expect(values).toHaveBeenCalledTimes(1)

      const other = await store.page('session-b')
      expect(other.total).toBe(2)
      expect(other.rules).toBe(1)
      expect(other.failures).toBe(1)
    } finally { await ctx.fiber.dispose() }
  })
})
