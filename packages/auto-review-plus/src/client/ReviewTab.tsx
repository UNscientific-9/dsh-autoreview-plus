import { useEffect, useRef, useState } from 'react'
import type { Options } from '../options.ts'
import type { Catalog, Status } from '../control-types.ts'
import { Select } from './Select.tsx'
import type { SettingsOp, SettingsView, TabFace } from './api.ts'

const labels = { reviewing: '审查中', allowed: '审查通过', denied: '审查拒绝', awaiting_user: '等待人工确认', error: '审查失败', cancelled: '已取消' }
const outcomes = { succeeded: '工具执行成功', tool_error: '工具执行失败', blocked: '操作被阻止', cancelled: '操作已取消', interrupted: '上次运行中断，结果待核实' }
export function ReviewTab(props: TabFace) {
  const [catalog, setCatalog] = useState<Catalog>()
  const [status, setStatus] = useState<Status>()
  const [view, setView] = useState<SettingsView>()
  const [draft, setDraft] = useState<Options>()
  const [key, setKey] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [statusError, setStatusError] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState({ reader: props.status, offset: 0 })
  const offset = page.reader === props.status ? page.offset : 0
  const mounted = useRef(false)
  const reader = useRef(props.status)
  reader.current = props.status
  const isCurrent = () => mounted.current && reader.current === props.status
  const statusGeneration = useRef(0)
  const settingsGeneration = useRef(0)
  const pendingAction = useRef<TabFace['status'] | undefined>(undefined)
  useEffect(() => {
    mounted.current = true
    setStatus(undefined); setCatalog(undefined); setView(undefined); setDraft(undefined)
    setKey(''); setNotice(''); setError(''); setStatusError(''); setSettingsError(''); setBusy(false)
    return () => { mounted.current = false }
  }, [props.status])
  useEffect(() => {
    let disposed = false
    let pending = false
    const refresh = async () => {
      if (pending || disposed) return
      pending = true
      const generation = statusGeneration.current
      try { const current = await props.status(offset); if (!disposed && isCurrent() && generation === statusGeneration.current) { setStatus(current); setStatusError('') } }
      catch (failure) { if (!disposed && isCurrent() && generation === statusGeneration.current) setStatusError(failure instanceof Error ? failure.message : '审查记录读取失败。') }
      finally { pending = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1500)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [props.status, offset])
  const reload = async () => {
    const generation = ++settingsGeneration.current
    const current = () => isCurrent() && generation === settingsGeneration.current
    setSettingsLoading(true); setSettingsError(''); setCatalog(undefined)
    try {
      const models = await props.catalog()
      if (!current()) return
      setCatalog(models)
      if (models.namespace === null) throw new Error('设置条目尚未就绪，请重新加载。')
      const next = await props.settings(models.namespace)
      if (current()) { setView(next); setDraft({ ...next.value }); setKey('') }
    } catch (failure) {
      if (current()) { setView(undefined); setDraft(undefined); setKey(''); setSettingsError(failure instanceof Error ? failure.message : '设置读取失败。') }
    } finally { if (current()) setSettingsLoading(false) }
  }
  useEffect(() => { void reload() }, [props.status, props.catalog, props.settings])
  const change = <K extends keyof Options>(name: K, value: Options[K]) => setDraft(previous => ({ ...previous, [name]: value }))
  const run = async (action: () => Promise<unknown>) => {
    if (pendingAction.current === props.status) return
    pendingAction.current = props.status
    setBusy(true); setNotice(''); setError('')
    try { await action() } catch (failure) { if (isCurrent()) setError(failure instanceof Error ? failure.message : '操作失败。') }
    finally { if (pendingAction.current === props.status) pendingAction.current = undefined; if (isCurrent()) setBusy(false) }
  }
  const selectSession = async (id: string) => {
    statusGeneration.current++
    try {
      await props.select(id)
      if (!isCurrent()) return
      const generation = ++statusGeneration.current
      const next = await props.status(offset)
      if (isCurrent() && generation === statusGeneration.current) { setStatus(next); setStatusError(''); setNotice('本会话审查模型已更新。') }
    } finally { if (isCurrent()) statusGeneration.current++ }
  }
  const save = async () => {
    if (draft === undefined || view === undefined || settingsLoading) return
    if (draft.backend === 'model' && (!draft.provider || !draft.model)) throw new Error('请先选择独立审查模型。')
    if (draft.backend === 'jev' && draft.jevChannel === 'custom') {
      let url: URL
      try { url = new URL(draft.jevBaseUrl ?? '') } catch { throw new Error('请填写有效的 HTTPS 服务地址，例如 https://…/v1。') }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !draft.jevModel?.trim()) throw new Error('自定义 Jev 需要有效的 HTTPS 服务地址和模型名称。')
    }
    if (draft.backend === 'jev' && (!Number.isSafeInteger(draft.timeoutMs ?? 15000) || (draft.timeoutMs ?? 15000) < 1000 || (draft.timeoutMs ?? 15000) > 120000)) throw new Error('审查超时请填写 1–120 秒。')
    if (draft.backend === 'jev' && (!Number.isFinite(draft.minConfidence ?? 0.6) || (draft.minConfidence ?? 0.6) < 0 || (draft.minConfidence ?? 0.6) > 1)) throw new Error('最低置信度请填写 0–1 之间的数值。')
    const names: (keyof Options)[] = ['backend', 'provider', 'model', 'safeReads', 'jevChannel', 'jevBaseUrl', 'jevModel', 'timeoutMs', 'minConfidence', 'zdr']
    const ops: SettingsOp[] = names.filter(name => draft[name] !== undefined && draft[name] !== view.value[name]).map(name => ({ op: 'set', path: [name], value: draft[name] }))
    if (key.trim()) ops.push({ op: 'set', path: [draft.jevChannel === 'typesafe' ? 'typesafeKey' : draft.jevChannel === 'custom' ? 'customKey' : 'commandcodeKey'], value: key.trim() })
    const next = await props.save(view, ops)
    if (isCurrent()) { setView(next); setDraft({ ...next.value }); setKey(''); setNotice('默认设置已保存并生效。') }
  }
  const globalModels = catalog?.choices.filter(choice => choice.selection?.backend === 'model') ?? []
  const globalModel = globalModels.find(choice => choice.selection?.provider === draft?.provider && choice.selection?.model === draft?.model)?.id ?? ''
  const currentKey = draft?.jevChannel === 'typesafe' ? 'typesafeKey' : draft?.jevChannel === 'custom' ? 'customKey' : 'commandcodeKey'
  const keySet = view?.secrets?.some(secret => secret.set && secret.path.join('.') === currentKey) === true
  const choices = catalog?.choices ?? []
  const sessionChoices = status && !choices.some(choice => choice.id === status.selection) ? [...choices, { id: status.selection, label: '已保存的会话选择（列表暂未加载）', selection: null }] : choices
  return <div data-arplus>
    <h2>自动审查 Plus</h2><p className="arplus-muted">{status === undefined ? '正在读取当前会话状态…' : status.enabled ? '当前会话已启用 Auto 审查' : '请在输入框原有权限选择器中选择 Auto。'}</p>
    <label>本会话审查模型<Select label="本会话审查模型" value={status?.selection ?? 'default'} options={sessionChoices} disabled={busy || !catalog || !status} onChange={id => void run(() => selectSession(id))} /></label>
    {status && <small>{status.selection === 'default' ? '本会话跟随默认设置。' : '本会话覆盖默认设置；选择“跟随默认配置”可恢复。'}</small>}
    {catalog?.incomplete && <small>部分服务的模型列表读取失败，可重新加载。</small>}
    {status && <div className="arplus-counts"><span>规则放行 <strong>{status.rules}</strong></span><span>审查通过 <strong>{status.allowed}</strong></span><span>拒绝 / 待确认 <strong>{status.denied}</strong></span><span>审查失败 <strong>{status.failures}</strong></span></div>}
    {error && <p role="alert">{error}</p>}{statusError && <p role="alert">{statusError}</p>}{status?.error && <p role="alert">记录写入异常：{status.error}</p>}{notice && <p role="status">{notice}</p>}
    <section><h3>默认设置</h3>
      {settingsError && <p role="alert">{settingsError}</p>}
      {settingsLoading && <p role="status">正在读取模型和默认设置…</p>}
      {draft !== undefined && !settingsLoading && <fieldset disabled={busy}>
        <label>审查方式<Select label="审查方式" value={draft.backend ?? 'follow'} options={[{ id: 'follow', label: '跟随当前会话模型' }, { id: 'model', label: '独立审查模型' }, { id: 'jev', label: 'Jev 直接决策' }]} onChange={value => { change('backend', value as Options['backend']); setKey('') }} disabled={busy} /></label>
        {draft.backend === 'model' && <label>独立模型<Select label="独立模型" value={globalModel} options={globalModels} disabled={busy} onChange={id => { const selected = globalModels.find(choice => choice.id === id)?.selection; change('provider', selected?.provider); change('model', selected?.model) }} /></label>}
        {draft.backend === 'model' && draft.provider && draft.model && !globalModel && <small>已配置的模型暂未出现在列表中，请重新加载或选择另一个模型。</small>}
        {draft.backend === 'jev' && <>
          <label>Jev 通道<Select label="Jev 通道" value={draft.jevChannel ?? 'commandcode'} options={[{ id: 'commandcode', label: 'Command Code' }, { id: 'typesafe', label: 'TypeSafe 官方' }, { id: 'custom', label: '自定义 HTTPS 服务' }]} disabled={busy} onChange={value => { change('jevChannel', value as Options['jevChannel']); setKey('') }} /></label>
          {draft.jevChannel === 'custom' && <><label>HTTPS 服务地址<input value={draft.jevBaseUrl ?? ''} placeholder="https://…/v1" onChange={event => change('jevBaseUrl', event.target.value)} /></label><label>模型名称<input value={draft.jevModel ?? ''} onChange={event => change('jevModel', event.target.value)} /></label></>}
          <label>API 密钥<input type="password" autoComplete="new-password" value={key} placeholder={keySet ? '已配置；留空保留' : '填写当前通道的密钥'} onChange={event => setKey(event.target.value)} /></label>
          <label>超时（秒）<input type="number" min={1} max={120} value={Number.isFinite(draft.timeoutMs ?? 15000) ? (draft.timeoutMs ?? 15000) / 1000 : ''} onChange={event => change('timeoutMs', Math.round(event.currentTarget.valueAsNumber * 1000))} /></label>
          <label>最低置信度<input type="number" min={0} max={1} step={0.05} value={Number.isFinite(draft.minConfidence ?? 0.6) ? draft.minConfidence ?? 0.6 : ''} onChange={event => change('minConfidence', event.currentTarget.valueAsNumber)} /></label>
          <label data-check><input type="checkbox" checked={draft.zdr ?? true} onChange={event => change('zdr', event.target.checked)} />要求零数据留存</label>
          {draft.jevChannel === 'commandcode' && <small>Command Code Jev 暂不支持零留存保护；要求零留存时会停止请求。审查材料会经过该服务。</small>}
          {draft.jevChannel !== 'commandcode' && <small>当前适配器尚未验证此通道的零留存协议；开启零留存要求时会停止请求。</small>}
        </>}
        <label data-check><input type="checkbox" checked={draft.safeReads ?? true} onChange={event => change('safeReads', event.target.checked)} />启用已验证的安全读取快通道</label>
        <small>首版仅覆盖可确定的官方工作区普通文本读取；存在自由文本指令、约束、敏感路径或未知行为时仍交给模型。</small>
      </fieldset>}
      <div className="arplus-actions">{draft !== undefined && !settingsLoading && <button className="arplus-primary" type="button" disabled={busy} onClick={() => void run(save)}>保存默认设置</button>}<button type="button" disabled={busy || settingsLoading} onClick={() => void run(reload)}>重新加载</button></div>
    </section>
    <section><h3>审查记录 · {status?.total ?? 0} 条</h3><small>保存规则放行、模型裁决和最终结果，跨回合与重启保留。</small>
      {status?.rows.length === 0 && <p className="arplus-muted">当前会话暂无审查记录。</p>}
      {status?.rows.map(row => <article key={row.id}><header><strong>{row.tool}</strong><span>{row.source === 'rule' && row.status === 'allowed' ? '规则放行' : labels[row.status]}</span></header><small>{new Date(row.startedAt).toLocaleString()} · {row.durationMs ?? 0} ms{row.risk ? ` · ${row.risk}` : ''}</small><small>{row.source === 'rule' ? '本地安全规则' : `${row.provider ?? '正在获取服务'} · ${row.model ?? '正在获取模型'}`}</small>{row.reason && <p>{row.reason}</p>}{row.status === 'denied' && (row.outcome === 'succeeded' || row.outcome === 'tool_error') && <small>本次调用经人工批准。</small>}{row.outcome && <small>{outcomes[row.outcome]}</small>}</article>)}
      {status && status.total > 30 && <div className="arplus-actions"><button type="button" disabled={busy || offset === 0} onClick={() => setPage({ reader: props.status, offset: Math.max(0, offset - 30) })}>上一页</button><button type="button" disabled={busy || offset + 30 >= status.total} onClick={() => setPage({ reader: props.status, offset: offset + 30 })}>下一页</button></div>}
    </section>
  </div>
}
