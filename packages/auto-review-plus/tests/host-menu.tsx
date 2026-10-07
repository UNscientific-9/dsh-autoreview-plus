import type { ReactNode } from 'react'
/** Unit-test stand-in; browser verification uses the actual host Menu source. */
export function Menu({ open, anchor, items, onSelect }: { open: boolean; anchor: ReactNode; items: readonly { id: string; label: ReactNode }[]; onSelect(id: string): void }) {
  return <>{anchor}{open && <div role="menu">{items.map(item => <button type="button" role="menuitem" key={item.id} onClick={() => onSelect(item.id)}>{item.label}</button>)}</div>}</>
}
