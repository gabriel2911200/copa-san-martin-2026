import { useEffect, useRef, useState } from 'react'

export default function ControlEventMenu({ label, disabled, onEdit, onVoid }: { label: string; disabled: boolean; onEdit?: () => void; onVoid: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  return <div ref={root} className="event-revert-menu" onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); if (!busy) setConfirm(false) } }}>
    <button type="button" aria-label={label} aria-expanded={open} disabled={disabled || busy} onClick={() => setOpen(!open)}>⋮</button>
    {open && <div className="event-revert-options">
      {onEdit && <button onClick={() => { setOpen(false); onEdit() }}>EDITAR</button>}
      <button onClick={() => { setOpen(false); setConfirm(true) }}>ANULAR</button>
    </div>}
    {confirm && <div className="event-revert-options" role="dialog" aria-label="Anular evento">
      <p>¿Anular este evento?</p>
      <button disabled={busy} onClick={() => setConfirm(false)}>Cancelar</button>
      <button disabled={disabled || busy} onClick={async () => { if (busy) return; setBusy(true); setError(''); try { await onVoid(); setConfirm(false) } catch { setError('No se pudo confirmar la anulación. Reintenta.') } finally { setBusy(false) } }}>Anular</button>
      {error && <p role="alert">{error}</p>}
    </div>}
  </div>
}
