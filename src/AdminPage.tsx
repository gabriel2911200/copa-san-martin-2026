import { useEffect, useRef, useState } from 'react'

import { supabase } from './lib/supabase'

import { useLiveRefresh } from './lib/useLiveRefresh'

type Category = { id: string; name: string }
type Day = { id: string; number: number }
type Team = { id: string; category_id: string; name: string; active: boolean }
const fields = 'id, category_id, matchday_id, home_team_id, away_team_id, stage, status, created_at'
const control = 'min-h-12 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:opacity-50'
const labels: Record<string, string> = { REGULAR: 'Regular', SEMIFINAL: 'Semifinal', THIRD_PLACE: 'Tercer puesto', FINAL: 'Final' }

export default function AdminPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [days, setDays] = useState<Day[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [category, setCategory] = useState('')
  const [day, setDay] = useState('')
  const [home, setHome] = useState('')
  const [away, setAway] = useState('')
  const [date,setDate]=useState('')
  const [time,setTime]=useState('')
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [retry, setRetry] = useState(0)
  const lock = useRef(false)
  const number = days.find(d => d.id === day)?.number
  const stage = number && number <= 4 ? 'REGULAR' : ''
  const eligible = teams.filter(t => t.category_id === category && t.active)
  useLiveRefresh(() => { if (!lock.current) setRetry(n=>n+1) })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setReady(false); setError('')
      try {
        if (!supabase) throw Error('Sin conexión configurada.')
        const [c, d, t] = await Promise.all([
          supabase.from('categories').select('id,name').order('name'),
          supabase.from('matchdays').select('id,number').order('number'),
          supabase.from('teams').select('id,category_id,name,active').order('name'),
        ])
        for (const result of [c,d,t]) if (result.error) throw result.error
        if (!cancelled) { setCategories(c.data!); setDays(d.data!); setTeams(t.data!); setReady(true) }
      } catch { if (!cancelled) setError('No se pudieron cargar los datos. Se reintentará automáticamente.') }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [retry])

  async function create() {
    if (lock.current || !ready) return
    setError(''); setSuccess('')
    if (!categories.some(c => c.id === category) || !number || !stage || !home || !away) { setError('Selecciona categoría, jornada, ambos equipos y el tipo de partido si corresponde.'); return }
    if (home === away) { setError('Local y visitante deben ser diferentes.'); return }
    if (![home,away].every(id => eligible.some(t => t.id === id))) { setError('Ambos equipos deben estar activos y pertenecer a la categoría seleccionada.'); return }
    lock.current = true; setSaving(true)
    try {
      if (!supabase) throw Error('Sin configuración')
      const existing = await supabase.from('matches').select('id').eq('category_id', category).eq('matchday_id', day).eq('home_team_id', home).eq('away_team_id', away).eq('stage', stage).limit(1)
      if (existing.error) throw existing.error
      if (existing.data.length) { setError('Ya existe exactamente este partido en la jornada seleccionada.'); return }
      const result = await supabase.from('matches').insert({ category_id: category, matchday_id: day, home_team_id: home, away_team_id: away, stage, status: 'PROGRAMADO', scheduled_date: date||null, scheduled_time: time||null }).select(fields).single()
      if (result.error) throw result.error
      if (!result.data?.id) throw Error('No se recibió el ID del partido')
      setSuccess('Partido programado correctamente. Puedes crear otro partido.')
      setHome(''); setAway('')
    } catch (err) {
      const code = (err as { code?: string })?.code
      setError(code === '23505' ? 'Ya existe exactamente este partido en la jornada seleccionada.' : code === '42501' ? 'No se pudo crear: verifica que los equipos sigan activos y la etapa corresponda a la jornada. Actualiza los datos.' : 'No se pudo confirmar la creación. Actualiza la lista antes de volver a intentarlo.')
    } finally { lock.current = false; setSaving(false) }
  }

  const disabled = loading || saving || !ready
  return <div className="space-y-6">
    <p className="eyebrow">ORGANIZA LA JORNADA</p><h1>Crear partido</h1>
    {loading && <p role="status">Cargando datos…</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
    <p role="status" className="text-green-800">{success}</p>
    <form id="crear" onSubmit={event => { event.preventDefault(); void create() }} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xl font-semibold">Crear partido regular</h2>
      <fieldset disabled={disabled} className="space-y-4">
        <label htmlFor="create-category" className="block">Categoría<select id="create-category" required className={control} value={category} onChange={event => { setCategory(event.target.value); setHome(''); setAway(''); setSuccess('') }}><option value="">Seleccionar categoría</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label htmlFor="create-day" className="block">Jornada<select id="create-day" required className={control} value={day} onChange={event => setDay(event.target.value)}><option value="">Seleccionar jornada</option>{days.filter(d=>d.number<=4).map(d => <option key={d.id} value={d.id}>Fecha {d.number}</option>)}</select></label>
        <div className="form-grid"><label>Fecha del partido<input type="date" className={control} value={date} onChange={e=>{setDate(e.target.value);if(!e.target.value)setTime('' )}}/></label><label>Hora (Tarija)<input type="time" className={control} value={time} disabled={!date} onChange={e=>setTime(e.target.value)}/></label></div>
        {stage && <p>Etapa: {labels[stage]}</p>}
        <label htmlFor="create-home" className="block">Equipo local<select id="create-home" required className={control} value={home} onChange={event => setHome(event.target.value)}><option value="">Seleccionar local</option>{eligible.filter(t => t.id !== away).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label htmlFor="create-away" className="block">Equipo visitante<select id="create-away" required className={control} value={away} onChange={event => setAway(event.target.value)}><option value="">Seleccionar visitante</option>{eligible.filter(t => t.id !== home).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        {category && eligible.length < 2 && <p>Se necesitan al menos dos equipos activos en esta categoría.</p>}
        <button disabled={disabled || eligible.length < 2} className={`${control} bg-blue-700 font-medium text-white`}>{saving ? 'Creando…' : 'Crear partido'}</button>
      </fieldset>
    </form>

  </div>
}
