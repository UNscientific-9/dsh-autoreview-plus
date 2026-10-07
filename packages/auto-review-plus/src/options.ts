import Schema from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'

export interface Options {
  backend?: 'follow' | 'model' | 'jev'
  provider?: string
  model?: string
  safeReads?: boolean
  jevChannel?: 'commandcode' | 'typesafe' | 'custom'
  jevBaseUrl?: string
  jevModel?: string
  commandcodeKey?: string
  typesafeKey?: string
  customKey?: string
  timeoutMs?: number
  minConfidence?: number
  zdr?: boolean
  dataDirectory?: string
}
export const Config = Schema.object({
  backend: Schema.union(['follow', 'model', 'jev']).default('follow'),
  provider: Schema.string().default(''), model: Schema.string().default(''),
  safeReads: Schema.boolean().default(true),
  jevChannel: Schema.union(['commandcode', 'typesafe', 'custom']).default('commandcode'),
  jevBaseUrl: Schema.string().default(''), jevModel: Schema.string().default(''),
  commandcodeKey: Schema.string().role('secret').default(''),
  typesafeKey: Schema.string().role('secret').default(''),
  customKey: Schema.string().role('secret').default(''),
  timeoutMs: Schema.number().min(1000).max(120000).default(15000),
  minConfidence: Schema.number().min(0).max(1).default(0.6),
  zdr: Schema.boolean().default(true),
  dataDirectory: Schema.string().default(''),
}).volatile()
export type ResolvedOptions = Required<Options>
export type OptionsSource = Options | Volatile<Options | undefined>
export function optionReader(source: OptionsSource = {}): () => ResolvedOptions {
  return () => {
    const value = typeof (source as Volatile<Options>).get === 'function' ? (source as Volatile<Options | undefined>).get() ?? {} : source as Options
    return { backend: 'follow', provider: '', model: '', safeReads: true, jevChannel: 'commandcode', jevBaseUrl: '', jevModel: '', commandcodeKey: '', typesafeKey: '', customKey: '', timeoutMs: 15000, minConfidence: 0.6, zdr: true, dataDirectory: '', ...value }
  }
}
