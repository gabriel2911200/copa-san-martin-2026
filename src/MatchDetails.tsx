import type { PublicMatch } from './lib/tournament'
import { doubleYellows, eventLabels, matchTimeline } from './lib/matchEvents'
import { formatClock } from './lib/matchClock'
import EventRevertMenu from './EventRevertMenu'
import { supabase } from './lib/supabase'
import type { MatchEvent } from './lib/matchEvents'

export function MatchTimeline({ item, onRevert, disabled = false }: {
  item: { home: string; away: string; match: { home_team_id: string }; goals: MatchEvent[]; events?: MatchEvent[] }
  onRevert?: (id: string) => Promise<void>; disabled?: boolean
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
          {onRevert && <EventRevertMenu label={`Opciones de ${eventLabels[event.type ?? 'GOAL']} ${event.player_name ?? ''}`} disabled={disabled} onRevert={()=>onRevert(event.id)}/>}
        </div>
      </li>)}
    </ol>
    {!timeline.length && <p>No hay eventos válidos registrados.</p>}
  </>
}

export default function MatchDetails({ item, refresh }: { item: PublicMatch; refresh?: () => Promise<void> }) {
  async function revert(id:string) {
    if(!supabase) throw Error('Sin conexión')
    const result=await supabase.rpc('void_match_event',{p_match_id:item.match.id,p_event_id:id})
    if(result.error) throw Error(result.error.code==='P0001' ? result.error.message : 'No se pudo confirmar la reversión. Reintenta la misma operación.')
    if(!result.data?.control) throw Error('Respuesta incompleta. Reintenta la misma operación.')
    await refresh?.()
  }
  return <details className="match-details"><summary>Estadísticas del partido <span aria-hidden="true">↗</span></summary>
    <MatchTimeline item={item} onRevert={refresh ? revert : undefined}/>
  </details>
}
