import { EnvHttpProxyAgent, fetch } from 'undici'
import type { ResolvedOptions } from './options.ts'
export const jevTransport = { fetch }
export async function jevDecision(options: ResolvedOptions, policy: string, evidence: unknown, signal: AbortSignal, credential?: string): Promise<string> {
  if (options.jevChannel === 'commandcode' && options.zdr) throw new Error('Command Code Jev 不支持要求零数据留存；请确认隐私设置后再使用。')
  if (options.zdr && options.jevChannel !== 'commandcode') throw new Error('当前适配器未验证此 Jev 通道的零留存协议；要求零留存时不发送审查材料。')
  const preset = options.jevChannel
  const key = options[preset === 'commandcode' ? 'commandcodeKey' : preset === 'typesafe' ? 'typesafeKey' : 'customKey'] || credential
  if (!key) throw new Error('当前 Jev 通道未配置密钥。')
  const base = preset === 'commandcode' ? 'https://api.commandcode.ai/provider/v1' : preset === 'typesafe' ? 'https://api.typesafe.ai/v1' : options.jevBaseUrl
  const url = new URL(base)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Jev 自定义服务必须使用不含凭据和查询参数的 HTTPS 地址。')
  const model = preset === 'commandcode' ? 'typesafe/jev' : preset === 'typesafe' ? 'jev-latest' : options.jevModel
  if (!model) throw new Error('请配置自定义 Jev 模型名称。')
  const dispatcher = new EnvHttpProxyAgent()
  const start = policy.indexOf('First classify')
  const end = policy.indexOf('\n\nFor any allow')
  const rulingPolicy = start >= 0 && end > start ? policy.slice(start, end) : policy
  try {
    const response = await jevTransport.fetch(`${url.href.replace(/\/$/u, '')}/systemone`, {
      method: 'POST', dispatcher,
      signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, state: evidence, questions: {
        decision: { type: 'choice', instructions: rulingPolicy, criteria: { allow: 'The exact action is allowed by the fixed policy and real authorization.', deny: 'The action is forbidden, insufficiently authorized or ambiguous.' } },
        risk: { type: 'choice', instructions: rulingPolicy, criteria: { low: 'Ordinary project-local action with no medium/high effect.', medium: 'Destructive, production, external write or security change requiring explicit authorization.', high: 'Sensitive exfiltration or equivalent hard-deny effect.' } },
      } }),
    })
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Jev 服务返回 HTTP ${response.status}，当前操作未获放行。`) }
    const result = await response.json() as { answers?: Record<string, { choice?: unknown; confidence?: unknown }> }
    const decision = result.answers?.decision
    const risk = result.answers?.risk
    if (typeof decision?.confidence !== 'number' || !Number.isFinite(decision.confidence) || decision.confidence < options.minConfidence || decision.confidence > 1) throw new Error('Jev 决策置信度不足或响应无效。')
    if (typeof risk?.confidence !== 'number' || !Number.isFinite(risk.confidence) || risk.confidence < options.minConfidence || risk.confidence > 1) throw new Error('Jev 风险置信度不足或响应无效。')
    return JSON.stringify({ risk: risk.choice, decision: decision.choice, ...decision.choice === 'deny' ? { reason: 'Jev 根据实际动作与授权材料拒绝此操作。' } : {} })
  } finally { await dispatcher.destroy().catch(() => {}) }
}
