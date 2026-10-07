import type { ReviewRecord } from './records.ts'
import type { Options } from './options.ts'
export interface ModelChoice { id: string; label: string; selection: Pick<Options, 'backend' | 'provider' | 'model' | 'jevChannel'> | null }
export interface Catalog { choices: ModelChoice[]; incomplete: boolean; namespace: string | null }
export interface Status { enabled: boolean; selection: string; rows: ReviewRecord[]; total: number; error: string | null; rules: number; allowed: number; denied: number; failures: number }
