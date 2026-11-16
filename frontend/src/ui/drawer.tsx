import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/** 右侧抽屉：固定定位面板，内容只在打开时挂载。 */
export function Drawer({ open, onOpenChange, onClose, title, children, width = 600 }: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
  title: ReactNode
  children: ReactNode
  width?: number
}) {
  if (!open) return null
  const close = () => { onOpenChange?.(false); onClose?.() }
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : '抽屉'}
      style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={close} aria-hidden="true"
        style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.4)' }}/>
      <aside style={{
        position: 'relative', height: '100%', width, maxWidth: '100%', overflow: 'auto',
        background: 'var(--mantine-color-body, #fff)', color: 'var(--mantine-color-text, inherit)',
        boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.18)', padding: 20,
      }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button type="button" aria-label="关闭" onClick={close}
            style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </header>
        {children}
      </aside>
    </div>,
    document.body,
  )
}
