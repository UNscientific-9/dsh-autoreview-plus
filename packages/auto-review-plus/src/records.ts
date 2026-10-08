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
export class RecordWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordWriteError'
  }
}
export interface RecordPage {
  rows: ReviewRecord[]; total: number; error: string | null
  rules: number; allowed: number; denied: number; failures: number
}
/** One file per record; no automatic pruning and no custom Session event types. */
export class RecordStore {
  readonly directory: string
  readonly ready: Promise<void>
  readonly rows = new Map<string, ReviewRecord>()
  preferences: Record<string, { id: string; selection: import('./control-types.ts').ModelChoice['selection'] }> = {}
  private loadError: string | undefined
  private writeError: string | undefined
  private chain: Promise<unknown> = Promise.resolve()
  get error(): string | undefined { return [this.loadError, this.writeError].filter(Boolean).join('；') || undefined }
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
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.loadError = error instanceof Error ? error.message : '会话审查设置读取失败，已使用默认设置。'
    }
    const names = (await readdir(this.directory)).filter(name => /^[0-9a-f-]{36}\.json$/u.test(name))
    for (let start = 0; start < names.length; start += 16) {
      const batch = await Promise.all(names.slice(start, start + 16).map(async name => {
        try {
          const record = JSON.parse(await readFile(path.join(this.directory, name), 'utf8')) as ReviewRecord
          if (record.id + '.json' !== name || typeof record.sessionId !== 'string' || !Number.isFinite(record.startedAt)) throw new Error('审查记录格式损坏。')
          if (record.outcome === undefined) record.outcome = 'interrupted'
          return { name, record } as const
        } catch (error) {
          return { name, error } as const
        }
      }))
      // Apply results in readdir order so warning selection remains deterministic.
      for (const result of batch) {
        if ('error' in result) {
          // One damaged row is skipped; the store stays usable for every other call.
          this.loadError = `已跳过损坏的审查记录 ${result.name}：${result.error instanceof Error ? result.error.message : '格式无法解析'}`
        } else {
          this.rows.set(result.record.id, result.record)
        }
      }
    }
  }
  async begin(row: Omit<ReviewRecord, 'id'>): Promise<string> {
    await this.ready
    const id = randomUUID()
    await this.enqueue(() => this.saveRecord({ ...row, id }))
    return id
  }
  async update(id: string, patch: Partial<ReviewRecord>): Promise<void> {
    await this.ready
    await this.enqueue(async () => {
      const previous = this.rows.get(id)
      if (previous === undefined) throw new Error('审查记录不存在。')
      await this.saveRecord({ ...previous, ...patch, id })
    })
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.chain.then(operation)
    // A failed operation rejects its caller while leaving later writes runnable.
    this.chain = next.catch(() => undefined)
    return next
  }
  private async persist(row: ReviewRecord): Promise<void> {
    const temporary = path.join(this.directory, `${row.id}-${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(row), { flag: 'wx', mode: 0o600 })
    await rename(temporary, path.join(this.directory, row.id + '.json'))
    this.rows.set(row.id, row)
  }
  private async saveRecord(row: ReviewRecord): Promise<void> {
    try {
      await this.persist(row)
    } catch (error) {
      throw this.noteWriteFailure(error)
    }
    this.writeError = undefined
  }
  private async savePreferences(preferences: typeof this.preferences): Promise<void> {
    const temporary = path.join(this.directory, `preferences-${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify(preferences), { flag: 'wx', mode: 0o600 })
      await rename(temporary, path.join(this.directory, '.preferences.json'))
    } catch (error) {
      throw this.noteWriteFailure(error)
    }
    this.preferences = preferences
    this.writeError = undefined
  }
  private noteWriteFailure(error: unknown): RecordWriteError {
    const failure = error instanceof RecordWriteError
      ? error
      : new RecordWriteError(error instanceof Error ? error.message : '审查记录写入失败。')
    this.writeError = failure.message
    return failure
  }
  async page(sessionId: string, offset = 0): Promise<RecordPage> {
    await this.ready
    const rows: ReviewRecord[] = []
    let rules = 0
    let allowed = 0
    let denied = 0
    let failures = 0
    for (const row of this.rows.values()) {
      if (row.sessionId !== sessionId) continue
      rows.push(row)
      if (row.source === 'rule' && row.status === 'allowed') rules++
      if (row.source !== 'rule' && row.status === 'allowed') allowed++
      if (row.status === 'denied' || row.status === 'awaiting_user') denied++
      if (row.status === 'error') failures++
    }
    rows.sort((a, b) => b.startedAt - a.startedAt)
    return { rows: rows.slice(offset, offset + 30), total: rows.length, error: this.error ?? null, rules, allowed, denied, failures }
  }
  async drain(): Promise<void> { await this.ready.catch(() => undefined); await this.chain }
  async setPreference(sessionId: string, preference: typeof this.preferences[string]): Promise<void> {
    await this.ready
    await this.enqueue(async () => {
      const preferences = { ...this.preferences, [sessionId]: preference }
      await this.savePreferences(preferences)
    })
  }
}
