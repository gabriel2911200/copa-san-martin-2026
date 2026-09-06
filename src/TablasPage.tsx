import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { useLiveRefresh } from './lib/useLiveRefresh'
import { useTournament } from './lib/useTournament'
import { Podium } from './PublicPages'

type Category = { id: string; name: string }
type Standing = { team_id: string; team_name: string; position: number; pj: number; pg: number; pe: number; pp: number; gf: number; gc: number; dg: number; pts: number; is_live: boolean }
const statistics = ['pj','pg','pe','pp','gf','gc','dg','pts'] as const

export default function TablasPage() {
  const tournament = useTournament()
  const [categories, setCategories] = useState<Category[]>([])
  const [category, setCategory] = useState('')
  const [rows, setRows] = useState<Standing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const sequence = useRef(0)
  const invalidate = useCallback(() => { sequence.current++ }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')
      try {
        if (!supabase) throw Error('Sin configuración')
        const result = await supabase.from('categories').select('id,name').in('name',['Varones','Mujeres'])
        if (result.error || !result.data?.length) throw result.error ?? Error('Sin categorías')
        if (!cancelled) {
          const ordered = result.data.sort((a,b) => (a.name === 'Varones' ? -1 : b.name === 'Varones' ? 1 : 0))
          setCategories(ordered); setCategory(current => current || ordered[0].id)
        }
      } catch { if (!cancelled) { setError('No se pudieron cargar las categorías. Se reintentará automáticamente.'); setLoading(false) } }
    }
    void load()
    return () => { cancelled = true }
  }, [retry])

  const refresh = useCallback(async () => {
    if (!category) return
    const current = ++sequence.current
    setLoading(true); setError('')
    try {
      if (!supabase) throw Error('Sin configuración')
      const result = await supabase.rpc('get_standings', { p_category_id: category })
      if (result.error) throw result.error
      if (current === sequence.current) setRows(result.data as Standing[])
    } catch { if (current === sequence.current) setError('No se pudo actualizar la tabla. Se reintentará automáticamente al recuperar la conexión.') }
    finally { if (current === sequence.current) setLoading(false) }
  }, [category])
  const autoRefresh = useCallback(() => {
    if (category) void refresh()
    else setRetry(n => n + 1)
  }, [category, refresh])
  useLiveRefresh(autoRefresh)

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0)
    const onReturn = () => { if (!document.hidden) void refresh() }
    window.addEventListener('focus', onReturn)
    window.addEventListener('online', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      invalidate()
      window.clearTimeout(initial)
      window.removeEventListener('focus', onReturn)
      window.removeEventListener('online', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [refresh, retry, invalidate])

  return <div className="space-y-5">
    <h1>Tabla de posiciones</h1>
    {tournament.error && <p role="alert">{tournament.error}</p>}
    {tournament.data && <Podium data={tournament.data} categoryId={category}/>}
    <div className="standings-tabs" aria-label="Categoría">
      {categories.map(c => <button key={c.id} aria-pressed={category === c.id} onClick={() => { if (category === c.id) return; sequence.current++; setCategory(c.id); setRows([]); setLoading(true) }}>{c.name}</button>)}
    </div>
    {loading && <p role="status">Cargando clasificación…</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
    {!loading && !error && <>
      <p className="font-semibold text-blue-800">TABLA CLASIFICATORIA</p>
      {!rows.length ? <p>No hay equipos para mostrar en esta categoría.</p> : <>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white" tabIndex={0} role="region" aria-label="Clasificación de equipos">
          <table className="w-full min-w-[660px] text-sm">
            <caption className="sr-only">Clasificación regular de {categories.find(c => c.id === category)?.name}</caption>
            <thead className="bg-slate-100"><tr><th scope="col" className="p-3">Pos</th><th scope="col" className="p-3 text-left">Equipo</th>{statistics.map(key => <th key={key} scope="col" className="p-3">{key.toUpperCase()}</th>)}</tr></thead>
            <tbody>{rows.map(row => <tr key={row.team_id} className={`border-t border-slate-100 ${row.position >= 1 && row.position <= 4 ? 'qualification-zone' : ''}`}>
              <td className="p-3 text-center font-bold text-blue-800">{row.position}</td><th scope="row" className="min-w-40 max-w-64 break-words p-3 text-left font-medium">{row.team_name}</th>
              {statistics.map(key => <td key={key} className={`p-3 text-center tabular-nums ${key === 'pts' ? 'bg-blue-50 font-bold text-blue-900' : ''}`}>{row[key]}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
      </>}
    </>}
  </div>
}
