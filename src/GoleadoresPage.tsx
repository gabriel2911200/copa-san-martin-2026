import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { useLiveRefresh } from './lib/useLiveRefresh'

type Scorer = { position: number; player_id: string; player_name: string; team_name: string; goals: number; category_id: string }
export default function GoleadoresPage() {
  const [rows, setRows] = useState<Scorer[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const invalidate = useCallback(() => { sequence.current++ }, [])
  const refresh = useCallback(async () => {
    const seq = ++sequence.current
    try {
      if (!supabase) throw Error('Sin conexión')
      const [scores, cats] = await Promise.all([
        supabase.rpc('get_top_scorers', { p_category_id: category || null }),
        supabase.from('categories').select('id,name').order('name'),
      ])
      if (scores.error) throw scores.error
      if (cats.error) throw cats.error
      if (seq === sequence.current) {
        const filtered = (scores.data as Scorer[]).filter(row => !category || row.category_id === category)
        filtered.sort((a, b) => b.goals - a.goals || a.player_name.localeCompare(b.player_name, 'es') || a.player_id.localeCompare(b.player_id))
        setRows(filtered.slice(0, 5)); setCategories(cats.data); setError('')
      }
    } catch { if (seq === sequence.current) setError('No se pudieron actualizar los goleadores. Se reintentará automáticamente.') }
    finally { if (seq === sequence.current) setLoading(false) }
  }, [category])
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0)
    return () => { clearTimeout(timer); invalidate() }
  }, [refresh, invalidate])
  useLiveRefresh(refresh)
  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let disposed = false
    // Canal independiente: una base anterior a 019 conserva el Realtime del torneo.
    const channel = client.channel(`initial-scorers:${crypto.randomUUID()}`)
      .on('postgres_changes', {event:'*',schema:'public',table:'player_initial_goals'}, () => { if (!disposed) void refresh() })
      .subscribe(status => { if (!disposed && status === 'SUBSCRIBED') void refresh() })
    return () => { disposed = true; void client.removeChannel(channel) }
  }, [refresh])
  return <div className="space-y-5">
    <h1>TOP 5 GOLEADORES</h1>
    <div className="category-tabs" aria-label="Categoría">
      {[{id:'',name:'TODOS'},...categories].map(c => <button key={c.id} aria-pressed={category === c.id}
        onClick={() => { if(category===c.id)return; sequence.current++; setCategory(c.id); setRows([]); setLoading(true) }}>{c.name.toUpperCase()}</button>)}
    </div>
    {loading && <p role="status">Cargando goleadores…</p>}
    {error && <p role="alert">{error}</p>}
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white" tabIndex={0} role="region" aria-label="Clasificación de goleadores"><table className="w-full text-sm">
      <thead className="bg-slate-100"><tr>{['Posición','Jugador','Equipo','Goles'].map(label => <th scope="col" className="p-3 text-left" key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.player_id} className={`border-t border-slate-100 ${index === 0 ? 'qualification-zone scorer-leader' : ''}`}><td className="p-3 text-center font-bold">{index + 1}</td><th scope="row" className="p-3 text-left font-medium">{row.player_name}</th><td className="p-3 text-left">{row.team_name}</td><td className="p-3 text-center font-bold tabular-nums">{row.goals}</td></tr>)}</tbody>
    </table></div>
    {!loading && !error && !rows.length && <p>{category ? 'Aún no hay goleadores en esta categoría.' : 'Aún no hay goles asociados a jugadores.'}</p>}
  </div>
}
