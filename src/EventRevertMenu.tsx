import { useRef, useState } from 'react'

export default function EventRevertMenu({ label, description, disabled = false, onRevert }: {
  label: string; description?: string; disabled?: boolean; onRevert: () => Promise<void>
}) {
  const [open,setOpen] = useState(false)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const lock = useRef(false)
  async function revert() {
    if(lock.current || disabled) return
    lock.current=true;setBusy(true);setError('')
    try { await onRevert();setOpen(false) }
    catch(err) { setError((err as {message?:string}).message ?? 'No se pudo confirmar la reversión. Puedes reintentar sin duplicarla.') }
    finally {lock.current=false;setBusy(false)}
  }
  return <div className="event-revert-menu">
    <button type="button" aria-label={label} aria-expanded={open} disabled={disabled || busy} onClick={()=>setOpen(!open)}>⋮</button>
    {open && <div className="event-revert-options">
      {description && <small>{description}</small>}
      <button type="button" disabled={disabled || busy} onClick={()=>void revert()}>Revertir evento</button>
      {error && <p role="alert">{error}</p>}
    </div>}
  </div>
}
