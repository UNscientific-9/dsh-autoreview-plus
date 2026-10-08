import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { RecordStore } from './records.ts'
import type { Catalog, Status } from './control-types.ts'
import type { ResolvedOptions, optionReader } from './options.ts'

const commonChoices: Catalog['choices'] = [
  { id: 'default', label: '跟随默认配置', selection: null },
  { id: 'follow', label: '跟随当前会话模型', selection: { backend: 'follow' } },
  ...(['commandcode', 'typesafe', 'custom'] as const).map(channel => ({ id: `jev/${channel}`, label: `Jev · ${channel === 'commandcode' ? 'Command Code' : channel === 'typesafe' ? 'TypeSafe 官方' : '自定义服务'}`, selection: { backend: 'jev' as const, jevChannel: channel } })),
]

export class PlusControl extends TypertRemoteService {
  auditError: string | undefined
  constructor(private readonly owner: Context, private readonly store: RecordStore, private readonly readOptions: ReturnType<typeof optionReader>) {
    super(owner, 'autoReviewPlusControl', { namespace: 'autoReviewPlus' })
    for (const method of ['catalog', 'status', 'select'] as const) Remote(this[method] as (...args: unknown[]) => unknown, {
      kind: 'method', name: method, static: false, private: false, metadata: Object.create(null),
      access: { has: object => method in object, get: object => Reflect.get(object, method) },
      addInitializer: initializer => { initializer.call(this) },
    })
  }
  private session(id: string) {
    const session = this.owner.sessions.get(id as SessionId)
    if (session === undefined) throw new Error('请先打开一个有效会话。')
    return session
  }
  optionsFor(sessionId: string): ResolvedOptions { return { ...this.readOptions(), ...this.store.preferences[sessionId]?.selection } }
  async catalog(): Promise<Catalog> {
    const choices = commonChoices.slice(0, 2)
    const providers = this.owner.llm.listProviders()
    let incomplete = false
    const catalogs = await Promise.allSettled(providers.map(async provider => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try { return await Promise.race([this.owner.llm.listModels(provider.id), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('模型列表读取超时。')), 10000) })]) }
      finally { clearTimeout(timer) }
    }))
    for (const [index, catalog] of catalogs.entries()) {
      if (catalog.status === 'rejected') { incomplete = true; continue }
      const provider = providers[index]!.id
      for (const model of catalog.value) if (model.inputModalities === undefined || model.inputModalities.includes('text')) choices.push({ id: `model/${provider}/${model.id}`, label: `${provider} · ${model.name}`, selection: { backend: 'model', provider, model: model.id } })
    }
    choices.push(...commonChoices.slice(2))
    // The loader exposes `entries` as a generator method, not an array property.
    const loader = this.owner.get('loader') as unknown as { entries?: () => Iterable<{ fiber?: unknown; options?: { id?: string } }> } | undefined
    const read = loader?.entries
    const entry = (typeof read === 'function' ? [...read.call(loader)] : []).find(item => item.fiber === this.owner.fiber)
    return { choices, incomplete, namespace: entry?.options?.id ?? null }
  }
  async status(sessionId: string, offset = 0): Promise<Status> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('记录页码无效。')
    const session = this.session(sessionId)
    const page = await this.store.page(sessionId, offset)
    const permissions = this.owner.get('permissionPresets') as unknown as { current(value: typeof session): string }
    const errors = [...new Set([page.error, this.auditError].filter((error): error is string => error !== null && error !== undefined))]
    return { ...page, error: errors.join('；') || null, enabled: permissions.current(session) === 'auto', selection: this.store.preferences[sessionId]?.id ?? 'default' }
  }
  async select(sessionId: string, choiceId: string): Promise<boolean> {
    this.session(sessionId)
    // Restoring defaults or choosing Jev must not wait for unrelated model providers.
    const choice = commonChoices.find(choice => choice.id === choiceId) ?? (await this.catalog()).choices.find(choice => choice.id === choiceId)
    if (choice === undefined) throw new Error('所选审查模型已不可用，请刷新列表。')
    await this.store.setPreference(sessionId, { id: choice.id, selection: choice.selection })
    return true
  }
}
