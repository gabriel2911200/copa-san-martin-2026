import { useEffect, useRef, useState } from 'react'
import EventDialog from './EventDialog'
import { supabase } from './lib/supabase'

function ResetDialog({ onClose, onReset }: { onClose: () => void; onReset: () => void }) {
  const lock = useRef(false)
  const requestId = useRef(crypto.randomUUID())
  const [generation, setGeneration] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    async function prepare() {
      try {
        if (!supabase) throw Error('Sin conexión configurada.')
        const result = await supabase.rpc('prepare_tournament_reset')
        if (result.error || typeof result.data !== 'string') throw Error('No se pudo preparar el reinicio. Cierra el diálogo e inténtalo nuevamente.')
        if (!disposed) setGeneration(result.data)
      } catch (err) { if (!disposed) setError((err as Error).message) }
    }
    void prepare()
    return () => { disposed = true }
  }, [])


  async function reset() {
    if (lock.current || confirmation !== 'REINICIAR' || !generation || !supabase) return
    lock.current = true; setBusy(true); setError('')
    try {
      const result = await supabase.rpc('reset_tournament', {
        p_confirmation: confirmation, p_expected_generation: generation, p_request_id: requestId.current,
      })
      if (result.error) throw Error(['P0001','42501'].includes(result.error.code) ? result.error.message : 'No se pudo confirmar el reinicio. Puedes reintentar esta misma operación.')
      if (result.data?.reset !== true) throw Error('Respuesta incompleta. No se pudo confirmar el reinicio.')
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i)
          if (key?.startsWith('pending-goal:') || key?.startsWith('pending-shootout:')) sessionStorage.removeItem(key)
        }
      } catch { /* Database success does not depend on browser storage. */ }
      onReset()
    } catch (err) { setError((err as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }

  return <EventDialog title="Reiniciar campeonato" busy={busy} onClose={onClose}>
    <p>Esta acción eliminará permanentemente todos los datos del campeonato actual.</p>
    <p>Se borrarán equipos, jugadores, partidos, resultados, estadísticas y penales. Las categorías y jornadas se conservarán vacías.</p>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void reset() }}>
      <label>Escribe exactamente REINICIAR<input value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" spellCheck={false} disabled={busy}/></label>
      <button className="danger-button" disabled={busy || !generation || confirmation !== 'REINICIAR'}>REINICIAR DEFINITIVAMENTE</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">Procesando…</p>}
  </EventDialog>
}

export default function ResetTournament({ onReset }: { onReset: () => void }) {
  const [open, setOpen] = useState(false)
  const [success, setSuccess] = useState('')
  return <section className="danger-zone" aria-label="Zona peligrosa">
    <h2>Zona peligrosa</h2>
    <p>Reinicio permanente para organizar un nuevo campeonato.</p>
    <button className="danger-button" onClick={() => { setSuccess(''); setOpen(true) }}>REINICIAR CAMPEONATO</button>
    {success && <p role="status">{success}</p>}
    {open && <ResetDialog onClose={() => setOpen(false)} onReset={() => {
      setOpen(false); setSuccess('Campeonato reiniciado correctamente. Ya puedes crear nuevos equipos y partidos.'); onReset()
      window.dispatchEvent(new Event('tournament-reset'))
    }}/>}
  </section>
}
