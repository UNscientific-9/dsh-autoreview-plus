import { describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Menu: () => null }))
import { apply, inject } from '../src/client/index.ts'
import type { Context } from '@deepseek-ai/cordis'
describe('one sidebar entry', () => {
  it('registers one single tab and its keyed body without commands, header buttons or settings entries', () => {
    const registerTab = vi.fn(() => () => {})
    const seats: { name: string; options: object }[] = []
    const services = { sidebarRightTabs: { register: registerTab }, remote: { $mount: vi.fn(async () => async () => {}) }, slots: { inject: (name: string, callback: () => void) => { callback(); return () => {}; }, register: (options: { name: string }) => { seats.push({ name: options.name, options }); return () => {} } } }
    const disposers: (() => void)[] = []
    const ctx = { get: (name: string) => services[name as keyof typeof services], effect: (run: () => unknown) => { const result = run(); if (typeof result === 'function') disposers.push(result as () => void) } } as unknown as Context
    apply(ctx)
    expect(registerTab).toHaveBeenCalledTimes(1)
    expect(registerTab.mock.calls[0]?.[0]).toMatchObject({ kind: 'auto-review-plus', multiple: false })
    expect(seats.map(seat => seat.name)).toEqual(['sidebar.right.pane.tab'])
    expect(inject).not.toContain('commands')
    for (const dispose of disposers.reverse()) dispose()
    expect(document.querySelector('[data-arplus-style]')).toBeNull()
  })
})
