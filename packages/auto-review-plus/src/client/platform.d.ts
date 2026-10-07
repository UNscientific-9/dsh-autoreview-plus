declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactNode } from 'react'
  export function Menu(props: { open: boolean; portal?: boolean; autoFocus?: boolean; selectedId?: string; items: readonly { id: string; label: ReactNode }[]; listClassName?: string; getAnchorRect?: () => DOMRect | null; onClose(): void; onSelect(id: string): void; anchor: ReactNode }): ReactNode
}
