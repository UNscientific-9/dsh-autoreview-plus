import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ReviewRecord {
  id: string; sessionId: string; callId: string; tool: string; startedAt: number
  source: 'rule' | 'model' | 'jev'; status: 'reviewing' | 'allowed' | 'denied' | 'awaiting_user' | 'error' | 'cancelled'
  provider?: string; model?: string; risk?: 'low' | 'medium' | 'high'; reason?: string; durationMs?: number
  outcome?: 'succeeded' | 'tool_error' | 'blocked' | 'cancelled' | 'interrupted'; finishedAt?: number
}
/** One file per record; no automatic pruning and no custom Session event types. */
export class RecordStore {
  readonly directory: string
  readonly ready: Promise<void>
  readonly rows = new Map<string, ReviewRecord>()
  preferences: Record<string, { id: string; selection: import('./control-types.ts').ModelChoice['selection'] }> = {}
  error: string | undefined
  private chain: Promise<unknown> = Promise.resolve()
  constructor(directory = '') {
    this.directory = directory || fileURLToPath(new URL('../.local-state/records/', import.meta.url))
    this.ready = this.load()
  }
  private async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    try {
      const preferences = JSON.parse(await readFile(path.join(this.directory, '.preferences.json'), 'utf8')) as unknown
      if (preferences === null || typeof preferences !== 'object' || Array.isArray(preferences)) throw new Error('会话审查设置格式损坏。')
      for (const item of Object.values(preferences) as { id?: unknown; selection?: unknown }[]) {
        if (!item || typeof item.id !== 'string') throw new Error('会话审查设置格式损坏。')
        if (item.selection !== null) {
          if (typeof item.selection !== 'object' || Array.isArray(item.selection)) throw new Error('会话审查设置格式损坏。')
          if (Object.keys(item.selection ?? {}).some(key => !['backend', 'provider', 'model', 'jevChannel'].includes(key))) throw new Error('会话设置包含不允许的覆盖字段。')
          const selected = item.selection as Record<string, unknown>
          if (!['follow', 'model', 'jev'].includes(String(selected.backend))) throw new Error('会话审查方式无效。')
          if (selected.backend === 'model' && (typeof selected.provider !== 'string' || !selected.provider || typeof selected.model !== 'string' || !selected.model)) throw new Error('会话审查模型无效。')
          if (selected.backend === 'jev' && !['commandcode', 'typesafe', 'custom'].includes(String(selected.jevChannel))) throw new Error('会话 Jev 通道无效。')
        }
      }
      this.preferences = preferences as typeof this.preferences
    } catch (error) {
      // A damaged preference file must not stop the gate: fall back to defaults and report it.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.error = error instanceof Error ? error.message : '会话审查设置读取失败，已使用默认设置。'
    }
    for (const name of await readdir(this.directory)) {
      if (!/^[0-9a-f-]{36}\.json$/u.test(name)) continue
      try {
        const record = JSON.parse(await readFile(path.join(this.directory, name), 'utf8')) as ReviewRecord
        if (record.id + '.json' !== name || typeof record.sessionId !== 'string' || !Number.isFinite(record.startedAt)) throw new Error('审查记录格式损坏。')
        if (record.outcome === undefined) record.outcome = 'interrupted'
        this.rows.set(record.id, record)
      } catch (error) {
        // One damaged row is skipped; the store stays usable for every other call.
        this.error = `已跳过损坏的审查记录 ${name}：${error instanceof Error ? error.message : '格式无法解析'}`
      }
    }
  }
  async begin(row: Omit<ReviewRecord, 'id'>): Promise<string> {
    await this.ready
    const id = randomUUID()
    await this.write({ ...row, id })
    return id
  }
  async update(id: string, patch: Partial<ReviewRecord>): Promise<void> {
    await this.ready
    const next = this.chain.then(async () => {
      const previous = this.rows.get(id)
      if (previous === undefined) throw new Error('审查记录不存在。')
      await this.persist({ ...previous, ...patch, id })
    })
    // Keep the queue usable, but reject this caller so a missing audit blocks dispatch.
    this.chain = next.catch(error => { this.error = error instanceof Error ? error.message : '审查记录写入失败。' })
    await next
  }
  private async write(row: ReviewRecord): Promise<void> {
    const next = this.chain.then(() => this.persist(row))
    this.chain = next.catch(error => { this.error = error instanceof Error ? error.message : '审查记录写入失败。' })
    await next
  }
  private async persist(row: ReviewRecord): Promise<void> {
    const temporary = path.join(this.directory, `${row.id}-${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(row), { flag: 'wx', mode: 0o600 })
    await rename(temporary, path.join(this.directory, row.id + '.json'))
    this.rows.set(row.id, row)
    this.error = undefined
  }
  async page(sessionId: string, offset = 0): Promise<{ rows: ReviewRecord[]; total: number; error: string | null }> {
    await this.ready
    const rows = [...this.rows.values()].filter(row => row.sessionId === sessionId).sort((a, b) => b.startedAt - a.startedAt)
    return { rows: rows.slice(offset, offset + 30), total: rows.length, error: this.error ?? null }
  }
  async drain(): Promise<void> { await this.ready.catch(() => undefined); await this.chain }
  async setPreference(sessionId: string, preference: typeof this.preferences[string]): Promise<void> {
    await this.ready
    const next = this.chain.then(async () => {
      const preferences = { ...this.preferences, [sessionId]: preference }
      const temporary = path.join(this.directory, `preferences-${randomUUID()}.tmp`)
      await writeFile(temporary, JSON.stringify(preferences), { flag: 'wx', mode: 0o600 })
      await rename(temporary, path.join(this.directory, '.preferences.json'))
      this.preferences = preferences
    })
    this.chain = next.catch(() => {})
    await next
  }
}
