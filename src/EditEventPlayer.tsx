import { useState } from 'react'
import PlayerEventDialog from './PlayerEventDialog'
import type { MatchEvent, MatchPlayer } from './lib/matchEvents'

export default function EditEventPlayer({ event, players, team, busy, onSave, onClose }: {
  event: MatchEvent; players: MatchPlayer[]; team: string; busy: boolean; onSave: (playerId: string) => Promise<void>; onClose: () => void
}) {
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  return <PlayerEventDialog title="Editar jugador del evento" team={team}
    players={players.filter(p => p.id !== event.player_id)} busy={busy || saving} error={error} onClose={onClose}
    onSelect={async id => { if (saving || busy) return; setSaving(true); setError(''); try { await onSave(id) } catch (err) { setError((err as Error).message) } finally { setSaving(false) } }}/>
}
