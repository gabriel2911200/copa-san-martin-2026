import { useRef, useState } from 'react'
import EditEventPlayer from './EditEventPlayer'
import type { MatchPlayer } from './lib/matchEvents'
import type { PublicMatch } from './lib/tournament'
import { doubleYellows, eventLabels, matchTimeline, playerUnavailable } from './lib/matchEvents'
import { formatClock } from './lib/matchClock'
import ControlEventMenu from './ControlEventMenu'
import { supabase } from './lib/supabase'
import type { MatchEvent } from './lib/matchEvents'

export function MatchTimeline({ item, onRevert, onEdit, disabled = false }: {
  item: { home: string; away: string; match: { home_team_id: string }; goals: MatchEvent[]; events?: MatchEvent[] }
  onRevert?: (id: string) => Promise<void>; disabled?: boolean
  onEdit?: (event: MatchEvent) => void
}) {
  const timeline = matchTimeline(item.goals,item.events,!!onRevert)
  const expulsions = new Set(doubleYellows(timeline).map(e=>e.id))
  return <>
    <ol className="match-timeline" aria-label="Cronología del partido">
      {timeline.map(event => <li key={event.id} className={event.team_id===item.match.home_team_id?'timeline-home':'timeline-away'}>
        <time>{event.period_number ?? 1}T {formatClock(event.clock_seconds ?? 0)}</time>
        <div className="timeline-event">
          <div><p>{event.type==='TIMEOUT' ? '⏸ Minuto' : event.type==='GOAL' ? '⚽' : event.type==='YELLOW_CARD' ? '🟨' : '🟥'} {event.player_name ? `${event.shirt_number != null ? `#${event.shirt_number} ` : ''}${event.player_name}` : event.type==='GOAL' ? 'Gol sin jugador registrado' : ''}</p>
            {expulsions.has(event.id) && <p className="fouls-red">🟨 + 🟨 = 🟥 Expulsado por doble amarilla</p>}
          </div>
          {onRevert && <ControlEventMenu label={`Opciones de ${eventLabels[event.type ?? 'GOAL']} ${event.player_name ?? ''}`} disabled={disabled}
            onEdit={onEdit && event.player_id && ['GOAL','YELLOW_CARD','RED_CARD'].includes(event.type ?? 'GOAL') ? () => onEdit(event) : undefined}
            onVoid={() => onRevert(event.id)}/>}
        </div>
      </li>)}
    </ol>
    {!timeline.length && <p>No hay eventos válidos registrados.</p>}
  </>
}

export default function MatchDetails({ item, refresh }: { item: PublicMatch; refresh?: () => Promise<void> }) {
  const [editing, setEditing] = useState<MatchEvent | null>(null)
  const [players, setPlayers] = useState<MatchPlayer[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  async function edit(event: MatchEvent) {
    if (!supabase || lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const result = await supabase.rpc('get_match_control', {p_match_id: item.match.id})
      if (result.error || !result.data) throw Error('No se pudo cargar la convocatoria. Reintenta.')
      const current = (result.data.events as MatchEvent[]).find(e => e.id === event.id)
      if (!current || current.voided_at) throw Error('El evento cambió. Actualiza las estadísticas.')
      setPlayers((result.data.lineup as MatchPlayer[]).filter(p => p.team_id === event.team_id
        && (result.data.match.status === 'FINALIZADO' || p.active)
        && !playerUnavailable((result.data.events as MatchEvent[]).filter(e => e.id !== event.id), p.id)))
      setEditing(current)
    } catch (err) { setError((err as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  async function save(playerId: string) {
    if (!editing || !supabase || lock.current) throw Error('Espera antes de guardar.')
    lock.current = true; setBusy(true)
    try {
      const result = await supabase.rpc('edit_match_event_player', {p_match_id: item.match.id, p_event_id: editing.id,
        p_player_id: playerId, p_expected_player_id: editing.player_id})
      if (result.error) throw Error(result.error.code === 'P0001' ? result.error.message : 'No se pudo confirmar. Puedes reintentar.')
      if (!result.data?.control) throw Error('Respuesta incompleta. Puedes reintentar.')
      await refresh?.(); setEditing(null)
    } finally { lock.current = false; setBusy(false) }
  }
  async function revert(id:string) {
    if(!supabase) throw Error('Sin conexión')
    const result=await supabase.rpc('void_match_event',{p_match_id:item.match.id,p_event_id:id})
    if(result.error) throw Error(result.error.code==='P0001' ? result.error.message : 'No se pudo confirmar la reversión. Reintenta la misma operación.')
    if(!result.data?.control) throw Error('Respuesta incompleta. Reintenta la misma operación.')
    await refresh?.()
  }
  return <details className="match-details"><summary>Estadísticas del partido <span aria-hidden="true">↗</span></summary>
    {error && <p role="alert">{error}</p>}
    {editing && <EditEventPlayer key={editing.id} event={editing} team={editing.team_id === item.match.home_team_id ? item.home : item.away} players={players} busy={busy} onSave={save} onClose={() => setEditing(null)}/>}
    <MatchTimeline item={item} disabled={busy} onEdit={refresh ? event => void edit(event) : undefined} onRevert={refresh ? revert : undefined}/>
  </details>
}
