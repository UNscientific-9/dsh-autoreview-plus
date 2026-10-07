import type { Options } from '../options.ts'
import type { Catalog, Status } from '../control-types.ts'
export interface SettingsView { ns: string; revision: number; value: Options; secrets?: readonly { path: readonly string[]; set: boolean }[] }
export interface SettingsOp { op: 'set'; path: string[]; value: unknown }
export interface TabFace {
  catalog(): Promise<Catalog>
  status(offset: number): Promise<Status>
  select(id: string): Promise<unknown>
  settings(namespace: string): Promise<SettingsView>
  save(view: SettingsView, ops: SettingsOp[]): Promise<SettingsView>
}
export function unwrap<T>(reply: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.value
}
