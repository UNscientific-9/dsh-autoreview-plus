import type { Context } from '@deepseek-ai/cordis'
import { ReviewTab } from './ReviewTab.tsx'
import { installStyles } from './styles.ts'
import { typertRemote } from '../remote-contract.ts'
import { unwrap, type SettingsView, type SettingsOp, type TabFace } from './api.ts'
import type { Catalog, Status } from '../control-types.ts'

export const name = 'dsh-experimental-auto-review-plus'
export const inject = ['slots', 'remote', 'sidebarRightTabs']
type Reply<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
interface ReviewApi { catalog(): Promise<Reply<Catalog>>; status(sessionId: string, offset: number): Promise<Reply<Status>>; select(sessionId: string, choiceId: string): Promise<Reply<boolean>> }
interface SettingsApi { describe(): Promise<Reply<{ writable: boolean; namespaces: SettingsView[] }>>; mutate(ns: string, ops: SettingsOp[], revision: number): Promise<Reply<SettingsView>> }
export function apply(ctx: Context): void {
  const tabs = ctx.get('sidebarRightTabs') as unknown as { register(options: object): () => void }
  const slots = ctx.get('slots') as unknown as { inject(name: string, callback: () => unknown): () => void; register(options: object, component: unknown): unknown }
  const remote = ctx.get('remote') as unknown as { $mount(spec: typeof typertRemote): Promise<() => Promise<void>> }
  ctx.effect(() => remote.$mount(typertRemote))
  ctx.effect(installStyles)
  ctx.effect(() => tabs.register({ id: name, kind: 'auto-review-plus', multiple: false, priority: 'extension', title: () => '自动审查 Plus', guide: [{ id: 'main', order: 35, title: () => '自动审查 Plus', description: () => '模型设置与真实审查记录' }] }))
  const faces = new Map<string, TabFace>()
  ctx.effect(() => () => faces.clear())
  ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({
    name: 'sidebar.right.pane.tab', key: name,
    inject: (sessionId: string): TabFace => {
      const cached = faces.get(sessionId)
      if (cached) return cached
      const api = () => { const api = ctx.get('remote.autoReviewPlus') as unknown as ReviewApi | undefined; if (!api) throw new Error('自动审查服务尚未就绪。'); return api }
      const settings = () => { const api = ctx.get('remote.settings') as unknown as SettingsApi | undefined; if (!api) throw new Error('宿主设置服务尚未就绪。'); return api }
      const face: TabFace = {
        catalog: async () => unwrap(await api().catalog()), status: async offset => unwrap(await api().status(sessionId, offset)), select: async id => unwrap(await api().select(sessionId, id)),
        settings: async namespace => { const result = unwrap(await settings().describe()); if (!result.writable) throw new Error('当前连接没有配置写入权限。'); const view = result.namespaces.find(view => view.ns === namespace); if (!view) throw new Error('未找到当前插件设置，请重新加载。'); return view },
        save: async (view, ops) => unwrap(await settings().mutate(view.ns, ops, view.revision)),
      }
      faces.set(sessionId, face); return face
    },
  }, ReviewTab)))
}
