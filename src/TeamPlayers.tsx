import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { useLiveRefresh } from './lib/useLiveRefresh'
import type { Player } from './lib/matchEvents'

const control = 'min-h-12 w-full rounded-lg border bg-white px-3 py-2 disabled:opacity-50'
export default function TeamPlayers({ teamId, teamName }: { teamId: string; teamName: string }) {
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const lock = useRef(false)
  const sequence = useRef(0)
  const mounted = useRef(true)
  const invalidate = useCallback(() => { sequence.current++ }, [])
  const refresh = useCallback(async () => {
    if (lock.current) return
    const seq = ++sequence.current
    try {
      if (!supabase) throw Error('Sin conexión')
      const result = await supabase.from('players').select('*').eq('team_id', teamId).order('full_name')
      if (result.error) throw result.error
      if (mounted.current && seq === sequence.current) { setPlayers(result.data); setError('') }
    } catch { if (mounted.current && seq === sequence.current) setError('No se pudo cargar la plantilla. Se reintentará automáticamente.') }
    finally { if (mounted.current && seq === sequence.current) setLoading(false) }
  }, [teamId])
  useEffect(() => {
    mounted.current = true
    const timer = setTimeout(() => void refresh(), 0)
    return () => { mounted.current = false; clearTimeout(timer); invalidate() }
  }, [refresh, invalidate])
  useLiveRefresh(refresh)

  async function save(player?: Player, remove = false) {
    if (lock.current || loading) return
    if (remove && player && !window.confirm(`¿Eliminar a ${player.full_name} de la plantilla activa? Se conservará su historial y podrás activarlo de nuevo.`)) return
    if (!player && !name.trim()) {
      setError('Escribe el nombre completo.'); return
    }
    lock.current = true; sequence.current++; setBusy(true); setError('')
    try {
      if (!supabase) throw Error('Sin conexión')
      const values = { full_name: name.trim() }
      const result = player
        ? await supabase.from('players').update({ active: remove ? false : !player.active }).eq('id', player.id).eq('team_id', teamId).select('*').single()
        : editing
          ? await supabase.from('players').update(values).eq('id', editing).eq('team_id', teamId).select('*').single()
          : await supabase.from('players').insert({ ...values, team_id: teamId, active: true }).select('*').single()
      if (result.error) throw result.error
      if (mounted.current) {
        setPlayers(current => [...current.filter(p => p.id !== result.data.id), result.data].sort((a, b) => a.full_name.localeCompare(b.full_name)))
        if (!player) { setName(''); setEditing(null) }
      }
    } catch {
      if (mounted.current) setError('No se pudo confirmar el cambio. Espera la actualización automática antes de reintentar.')
    } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }

  return <section className="space-y-3 border-t pt-4" aria-label={`Plantilla de ${teamName}`}>
    <h3>Jugadores · {teamName}</h3>
    {loading && <p role="status">Cargando plantilla…</p>}
    {error && <p role="alert">{error}</p>}
    <p className="text-sm">Eliminar da de baja al jugador y conserva su historial.</p>
    <ul className="space-y-3">{players.map(player => <li key={player.id} className="rounded-lg border p-3">
      <p>{player.full_name} · {player.active ? 'Activo' : 'Inactivo'}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <button type="button" className={control} disabled={busy} onClick={() => { setEditing(player.id); setName(player.full_name) }}>Editar jugador</button>
        <button type="button" className={control} disabled={busy} onClick={() => void save(player)}>{player.active ? 'Desactivar' : 'Activar'}</button>
        {player.active && <button type="button" className={control} disabled={busy} onClick={() => void save(player, true)}>Eliminar jugador</button>}
      </div>
    </li>)}</ul>
    {!loading && !players.length && <p>Aún no hay jugadores registrados.</p>}
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save() }}>
      <label className="block">Nombre completo<input className={control} value={name} onChange={e => setName(e.target.value)} required disabled={busy}/></label>
      <button className={control} disabled={busy || loading}>{editing ? 'Guardar jugador' : 'Agregar jugador'}</button>
      {editing && <button type="button" className={control} disabled={busy} onClick={() => { setEditing(null); setName('') }}>Cancelar edición</button>}
    </form>
  </section>
}
