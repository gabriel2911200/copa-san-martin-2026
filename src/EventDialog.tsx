import { useLayoutEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

export default function EventDialog({ title, busy = false, onClose, children }: {
  title: string; busy?: boolean; onClose: () => void; children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useLayoutEffect(() => {
    const element = dialog.current
    const previous = document.activeElement as HTMLElement | null
    const scroll = { left: window.scrollX, top: window.scrollY }
    const overflow = document.documentElement.style.overflow
    const anchor = document.documentElement.style.overflowAnchor
    document.documentElement.style.overflow = 'hidden'
    document.documentElement.style.overflowAnchor = 'none'
    element?.showModal()
    window.scrollTo({ ...scroll, behavior: 'instant' })
    return () => {
      element?.close()
      document.documentElement.style.overflow = overflow
      document.documentElement.style.overflowAnchor = anchor
      window.scrollTo({ ...scroll, behavior: 'instant' })
      // React termina de reactivar el botón y retirar el diálogo antes de devolver el foco.
      queueMicrotask(() => {
        if (previous?.isConnected && !document.querySelector('dialog[open]')) previous.focus({ preventScroll: true })
      })
    }
  }, [])
  return <dialog ref={dialog} className="match-check-dialog event-dialog" aria-labelledby={titleId}
    onCancel={e => { e.preventDefault(); if (!busy) onClose() }}>
    <h2 id={titleId}>{title}</h2>
    <div className="event-dialog-content">{children}</div>
    <button type="button" disabled={busy} onClick={onClose}>Cancelar</button>
  </dialog>
}
