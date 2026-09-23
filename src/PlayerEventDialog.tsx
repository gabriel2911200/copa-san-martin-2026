import EventDialog from './EventDialog'
import type { MatchPlayer } from './lib/matchEvents'

export default function PlayerEventDialog({ title, team, players, busy, disabled = false, error, onSelect, onClose, onRetry }: {
  title: string; team: string; players: MatchPlayer[]; busy: boolean; disabled?: boolean; error: string
  onSelect: (id: string) => void; onClose: () => void; onRetry?: () => void
}) {
  return <EventDialog title={title} busy={busy} onClose={onClose}>
    <p>{team}</p>
    {error && <p role="alert">{error}</p>}
    {onRetry && <button disabled={busy} onClick={onRetry}>Reintentar evento pendiente</button>}
    <div className="event-player-list">{players.map(p => <button key={p.id} type="button" disabled={busy || disabled || !!onRetry}
      onClick={() => onSelect(p.id)}>{p.shirt_number != null ? `#${p.shirt_number} ` : ''}{p.full_name}</button>)}</div>
    {!players.length && <p>No hay jugadores disponibles para esta acción.</p>}
    {busy && <p role="status">Guardando…</p>}
  </EventDialog>
}
