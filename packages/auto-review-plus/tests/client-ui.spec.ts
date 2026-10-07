import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewTab } from '../src/client/ReviewTab.tsx'
import type { TabFace } from '../src/client/api.ts'
let root: Root | undefined
let host: HTMLDivElement
afterEach(async () => { if (root) await act(async () => root?.unmount()); host?.remove(); root = undefined; vi.useRealTimers(); vi.restoreAllMocks() })
async function click(text: string) { await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === text)!.click()) }
async function enter(input: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function render(overrides: Partial<TabFace> = {}) {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const save = vi.fn(async view => ({ ...view, revision: 2 }))
  const props: TabFace = {
    catalog: async () => ({ choices: [{ id: 'default', label: '跟随默认配置', selection: null }], incomplete: false, namespace: 'custom-install-id' }),
    status: async () => ({ enabled: true, selection: 'default', rows: [], total: 0, error: null, rules: 2, allowed: 3, denied: 1, failures: 0 }),
    select: async () => true,
    settings: async () => ({ ns: 'custom-install-id', revision: 1, value: { backend: 'jev', jevChannel: 'commandcode', zdr: false }, secrets: [{ path: ['commandcodeKey'], set: true }] }),
    save, ...overrides,
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(createElement(ReviewTab, props)))
  return { save: props.save, props }
}
describe('sidebar settings and records', () => {
  it('masks a saved key and preserves it when saving a blank password input', async () => {
    const { save } = await render()
    expect((host.querySelector('input[type=password]') as HTMLInputElement).value).toBe('')
    expect(host.querySelector('input[type=password]')?.getAttribute('placeholder')).toContain('已配置')
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === '保存默认设置')!.click())
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ ns: 'custom-install-id', revision: 1 }), [])
    expect(host.textContent).toContain('默认设置已保存并生效')
  })
  it('does not offer an empty save form if native settings cannot be loaded', async () => {
    await render({ settings: async () => { throw new Error('配置读取失败') } })
    expect(host.textContent).toContain('配置读取失败')
    expect(host.querySelector('fieldset')).toBeNull()
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent === '保存默认设置')).toBe(false)
  })
  it('renders real backend rows and distinguishes rule decisions from model results', async () => {
    await render({ status: async () => ({ enabled: true, selection: 'default', total: 2, error: null, rules: 1, allowed: 1, denied: 0, failures: 0, rows: [
      { id: 'rule', sessionId: 'session', callId: 'one', tool: 'read', startedAt: 1, source: 'rule', status: 'allowed', outcome: 'succeeded' },
      { id: 'model', sessionId: 'session', callId: 'two', tool: 'write', startedAt: 2, source: 'jev', status: 'allowed', provider: 'jev/commandcode', model: 'typesafe/jev', outcome: 'tool_error' },
    ] }) })
    expect(host.querySelectorAll('article')).toHaveLength(2)
    expect(host.textContent).toContain('规则放行')
    expect(host.textContent).toContain('typesafe/jev')
    expect(host.textContent).toContain('工具执行失败')
  })
  it('keeps save failures visible when the record poll succeeds', async () => {
    vi.useFakeTimers()
    await render({ save: vi.fn(async () => { throw new Error('保存失败，请重新加载') }) })
    await click('保存默认设置')
    expect(host.textContent).toContain('保存失败，请重新加载')
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(host.textContent).toContain('保存失败，请重新加载')
  })
  it('removes a stale save form when reloading settings fails', async () => {
    const settings = vi.fn().mockResolvedValueOnce({ ns: 'custom-install-id', revision: 1, value: { backend: 'follow' } }).mockRejectedValueOnce(new Error('配置读取失败'))
    await render({ settings })
    await click('重新加载')
    expect(host.textContent).toContain('配置读取失败')
    expect(host.querySelector('fieldset')).toBeNull()
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent === '保存默认设置')).toBe(false)
    expect(Array.from(host.querySelectorAll('button')).find(button => button.textContent === '重新加载')?.disabled).toBe(false)
  })
  it('discards a hidden key when switching away from Jev', async () => {
    const { save } = await render()
    await enter(host.querySelector('input[type=password]') as HTMLInputElement, 'fixture-channel-key')
    await act(async () => (host.querySelector('button[aria-label="审查方式"]') as HTMLButtonElement).click())
    await click('跟随当前会话模型')
    await click('保存默认设置')
    expect(save).toHaveBeenCalledWith(expect.anything(), [{ op: 'set', path: ['backend'], value: 'follow' }])
  })
  it('rejects an empty timeout with a clear message before saving', async () => {
    const { save } = await render()
    await enter(host.querySelector('input[type=number]') as HTMLInputElement, '')
    await click('保存默认设置')
    expect(save).not.toHaveBeenCalled()
    expect(host.textContent).toContain('审查超时请填写 1–120 秒')
  })
  it('does not let an old settings response replace a new session', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<TabFace['settings']>>>()
    const { props } = await render({ settings: () => pending.promise })
    const next: TabFace = { ...props, status: async () => ({ enabled: false, selection: 'default', rows: [], total: 0, error: null, rules: 0, allowed: 0, denied: 0, failures: 0 }), settings: async () => ({ ns: 'new-install', revision: 2, value: { backend: 'follow' } }) }
    await act(async () => root!.render(createElement(ReviewTab, next)))
    await act(async () => pending.resolve({ ns: 'old-install', revision: 1, value: { backend: 'jev', jevChannel: 'commandcode' } }))
    expect(host.querySelector('input[type=password]')).toBeNull()
    expect(host.textContent).toContain('请在输入框原有权限选择器中选择 Auto')
    expect(host.textContent).not.toContain('当前会话已启用 Auto 审查')
  })
  it('resets pagination when switching sessions and suppresses old save completion', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<TabFace['save']>>>()
    const { props } = await render({ status: async () => ({ enabled: true, selection: 'follow', rows: [], total: 31, error: null, rules: 0, allowed: 0, denied: 0, failures: 0 }), save: () => pending.promise })
    await click('下一页')
    await click('保存默认设置')
    const status = vi.fn(async () => ({ enabled: true, selection: 'default', rows: [], total: 0, error: null, rules: 0, allowed: 0, denied: 0, failures: 0 }))
    const next: TabFace = { ...props, status, settings: async () => ({ ns: 'new-install', revision: 2, value: { backend: 'follow' } }) }
    await act(async () => root!.render(createElement(ReviewTab, next)))
    expect(status).toHaveBeenCalledWith(0)
    await act(async () => pending.resolve({ ns: 'old-install', revision: 3, value: { backend: 'jev', jevChannel: 'typesafe' } }))
    expect(host.querySelector('input[type=password]')).toBeNull()
    expect(host.textContent).not.toContain('默认设置已保存并生效')
    expect(Array.from(host.querySelectorAll('button')).find(button => button.textContent === '保存默认设置')?.disabled).toBe(false)
  })
  it('does not keep showing human confirmation as pending after execution', async () => {
    await render({ status: async () => ({ enabled: true, selection: 'default', total: 1, error: null, rules: 0, allowed: 0, denied: 1, failures: 0, rows: [{ id: 'approved', sessionId: 'session', callId: 'call', tool: 'probe', startedAt: 1, source: 'model', status: 'denied', outcome: 'succeeded' }] }) })
    expect(host.textContent).toContain('本次调用经人工批准')
    expect(host.textContent).toContain('工具执行成功')
    expect(host.textContent).not.toContain('等待人工确认')
  })
})
