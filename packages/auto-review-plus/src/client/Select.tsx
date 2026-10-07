import { useRef, useState } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
export function Select({ label, value, options, onChange, disabled = false }: {
  label: string; value: string; options: readonly { id: string; label: string }[]; onChange(value: string): void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(260)
  const anchor = useRef<HTMLButtonElement>(null)
  return <Menu open={open && !disabled} portal autoFocus selectedId={value} items={options.map(option => ({ ...option, label: <span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{option.label}</span> }))} listClassName="arplus-menu" getAnchorRect={() => anchor.current?.getBoundingClientRect() ?? null} onClose={() => setOpen(false)} onSelect={id => { setOpen(false); onChange(id) }}
    anchor={<button ref={anchor} type="button" className="arplus-select" aria-label={label} aria-haspopup="menu" aria-expanded={open && !disabled} disabled={disabled || options.length === 0} title={options.find(option => option.id === value)?.label} onClick={() => { setWidth(anchor.current?.getBoundingClientRect().width ?? 260); setOpen(!open) }}>
      <span>{options.find(option => option.id === value)?.label ?? '请选择'}</span><span aria-hidden="true">⌄</span>
      {open && <style>{`.arplus-menu{width:${width}px!important;min-width:0!important;max-width:calc(100vw - 24px)!important}`}</style>}
    </button>} />
}
