import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { useLiveRefresh } from './lib/useLiveRefresh'

type Matchday = { id: string; number: number; date: string | null }
const control = 'min-h-12 rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-50'

function message(error: unknown) {
  return (error as { code?: string })?.code === '42501'
    ? 'No hay permisos para guardar la fecha.'
    : 'No se pudo completar la operación. Comprueba tu conexión e inténtalo de nuevo.'
}

function CalendarEditor({ matchday }: { matchday: Matchday }) {
  const [saved, setSaved] = useState(matchday.date ?? '')
  const [draft, setDraft] = useState(matchday.date ?? '')
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const phase = matchday.number <= 4 ? 'Regular' : matchday.number === 5 ? 'Semifinales' : 'Final / Tercer puesto'

  async function save() {
    if (inFlight.current || draft === saved) return
    inFlight.current = true
    setSaving(true); setError(''); setSuccess('')
    try {
      if (!supabase) throw new Error('Sin configuración')
      const result = await supabase.from('matchdays').update({ date: draft || null })
        .eq('id', matchday.id).select('id, number, date').single()
      if (result.error) throw result.error
      setSaved(result.data.date ?? '')
      setDraft(result.data.date ?? '')
      setSuccess(result.data.date ? 'Fecha guardada.' : 'Jornada guardada sin fecha asignada.')
    } catch (err) { setError(message(err)) }
    finally { inFlight.current = false; setSaving(false) }
  }

  return (
    <li className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Fecha {matchday.number}</h2>
      <p className="text-slate-600">{phase}</p>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save() }} aria-busy={saving}>
        <label htmlFor={`date-${matchday.id}`} className="block font-medium">Fecha calendario</label>
        <input id={`date-${matchday.id}`} type="date" className={`${control} w-full min-w-0 bg-white`} value={draft} disabled={saving}
          onChange={event => { setDraft(event.target.value); setSuccess(''); setError('') }} />
        {!saved && <p className="text-sm text-slate-600">Sin fecha asignada.</p>}
        <div className="flex flex-wrap gap-2">
          <button className={`${control} bg-blue-700 font-medium text-white`} disabled={saving || draft === saved}>{saving ? 'Guardando…' : 'Guardar'}</button>
          <button type="button" className={control} disabled={saving || !draft} onClick={() => { setDraft(''); setSuccess(''); setError('') }}>Quitar fecha</button>
        </div>
        {draft !== saved && <p className="text-sm text-slate-600">Cambios pendientes de guardar.</p>}
        {error && <p role="alert" className="text-red-800">{error}</p>}
        <p role="status" className="text-green-800">{success}</p>
      </form>
    </li>
  )
}

export default function FechasPage() {
  const [matchdays, setMatchdays] = useState<Matchday[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useLiveRefresh(() => setRetry(value => value + 1))
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')
      try {
        if (!supabase) throw new Error('Sin configuración')
        const result = await supabase.from('matchdays').select('id, number, date').order('number')
        if (result.error) throw result.error
        if (JSON.stringify(result.data.map(row => row.number)) !== '[1,2,3,4,5,6]') {
          if (!cancelled) setError('No se encontraron exactamente las seis jornadas esperadas. Vuelve a cargar la lista.')
          return
        }
        if (!cancelled) setMatchdays(result.data)
      } catch (err) { if (!cancelled) setError(message(err)) }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [retry])
  return (
    <div className="space-y-6">
      <h1>Fechas / Jornadas</h1>
      <p className="text-slate-600">Asigna una fecha calendario o déjala pendiente. Para quitarla, pulsa «Quitar fecha» y después «Guardar».</p>
      {loading && <p role="status">Cargando jornadas…</p>}
      {error && <div role="alert" className="space-y-3 rounded-lg bg-red-50 p-4 text-red-800"><p>{error}</p></div>}
      {!loading && !error && <ul className="space-y-4" aria-label="Jornadas del campeonato">{matchdays.map(day => <CalendarEditor key={day.id} matchday={day} />)}</ul>}
    </div>
  )
}
