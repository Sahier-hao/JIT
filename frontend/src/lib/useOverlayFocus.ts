import { useRef } from 'react'

type FocusHandlers = {
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
}

/** 兼容从工具栏受控打开、没有内嵌 Trigger 的弹层。 */
export function useOverlayFocus(handlers: FocusHandlers) {
  const origin = useRef<HTMLElement | null>(null)
  return {
    onOpenAutoFocus(event: Event) {
      origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      handlers.onOpenAutoFocus?.(event)
    },
    onCloseAutoFocus(event: Event) {
      handlers.onCloseAutoFocus?.(event)
      if (!event.defaultPrevented && origin.current?.isConnected) {
        event.preventDefault()
        origin.current.focus()
      }
    },
  }
}
