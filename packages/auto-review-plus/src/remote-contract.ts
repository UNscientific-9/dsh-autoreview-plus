import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
const selection = z.object({ backend: z.enum(['follow', 'model', 'jev']).optional(), provider: z.string().optional(), model: z.string().optional(), jevChannel: z.enum(['commandcode', 'typesafe', 'custom']).optional() }).nullable()
const record = z.object({ id: z.string(), sessionId: z.string(), callId: z.string(), tool: z.string(), startedAt: z.number(), source: z.enum(['rule', 'model', 'jev']), status: z.enum(['reviewing', 'allowed', 'denied', 'awaiting_user', 'error', 'cancelled']), provider: z.string().optional(), model: z.string().optional(), risk: z.enum(['low', 'medium', 'high']).optional(), reason: z.string().optional(), durationMs: z.number().optional(), outcome: z.enum(['succeeded', 'tool_error', 'blocked', 'cancelled', 'interrupted']).optional(), finishedAt: z.number().optional() })
const catalog = z.object({ choices: z.array(z.object({ id: z.string(), label: z.string(), selection })), incomplete: z.boolean(), namespace: z.string().nullable() })
const status = z.object({ enabled: z.boolean(), selection: z.string(), rows: z.array(record), total: z.number(), error: z.string().nullable(), rules: z.number(), allowed: z.number(), denied: z.number(), failures: z.number() })
const argument = (name: string, schema: z.ZodType) => ({ name, wire: name, source: 'json' as const, codec: { mode: 'strict' as const, typeSymbol: `auto-review-plus#${name}`, create: () => schema } })
export const typertRemote: TypertRemoteContribution = {
  package: 'dsh-experimental-auto-review-plus',
  descriptors: [
    { id: 'auto-review-plus#catalog', service: 'autoReviewPlusControl', namespace: 'autoReviewPlus', method: 'catalog', implementation: 'catalog', invocation: { kind: 'direct' }, parameters: [], result: { mode: 'strict', typeSymbol: 'auto-review-plus#catalog', create: () => catalog } },
    { id: 'auto-review-plus#status', service: 'autoReviewPlusControl', namespace: 'autoReviewPlus', method: 'status', implementation: 'status', invocation: { kind: 'direct' }, parameters: [argument('sessionId', z.string().min(1)), argument('offset', z.number().int().min(0))], result: { mode: 'strict', typeSymbol: 'auto-review-plus#status', create: () => status } },
    { id: 'auto-review-plus#select', service: 'autoReviewPlusControl', namespace: 'autoReviewPlus', method: 'select', implementation: 'select', invocation: { kind: 'direct' }, parameters: [argument('sessionId', z.string().min(1)), argument('choiceId', z.string().min(1))], result: { mode: 'strict', typeSymbol: 'auto-review-plus#saved', create: () => z.boolean() } },
  ],
}
