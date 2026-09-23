import { useState } from 'react'
import EventDialog from './EventDialog'

export default function TeamResultDialog({ mode, homeId, awayId, home, away, busy, disabled, error, onConfirm, onClose, onRetry }: {
  mode: 'own-goal' | 'walkover'; homeId: string; awayId: string; home: string; away: string
  busy: boolean; disabled: boolean; error: string; onConfirm: (loserId: string) => void; onClose: () => void; onRetry?: () => void
}) {
  const [team, setTeam] = useState('')
  const selected = team === homeId ? home : away
  const opponent = team === homeId ? away : home
  return <EventDialog title={mode === 'own-goal' ? '¿Qué equipo cometió el autogol?' : '¿Qué equipo pierde por W.O.?'} busy={busy} onClose={onClose}>
    <div className="event-player-list">{[[homeId, home], [awayId, away]].map(([id, name]) => <button key={id}
      type="button" aria-pressed={team === id} disabled={busy || !!onRetry} onClick={() => setTeam(id)}>{name}</button>)}</div>
    {team && <p>{mode === 'own-goal' ? `Se registrará 1 gol para ${opponent} por autogol de ${selected}.`
      : `${selected} perderá por W.O. El resultado oficial será ${home} ${team === homeId ? '0 - 3' : '3 - 0'} ${away}.`}</p>}
    {error && <p role="alert">{error}</p>}
    {onRetry && <button disabled={busy} onClick={onRetry}>Reintentar evento pendiente</button>}
    <button type="button" disabled={!team || busy || disabled || !!onRetry} onClick={() => onConfirm(team)}>
      {busy ? 'Guardando…' : mode === 'own-goal' ? 'CONFIRMAR AUTOGOL' : 'CONFIRMAR W.O.'}
    </button>
  </EventDialog>
}
