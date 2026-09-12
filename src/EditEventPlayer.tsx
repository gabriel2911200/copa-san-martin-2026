import { useEffect, useRef, useState } from 'react'
import type { MatchEvent, MatchPlayer } from './lib/matchEvents'

export default function EditEventPlayer({ event, players, busy, onSave, onClose }: {
  event: MatchEvent; players: MatchPlayer[]; busy: boolean; onSave: (playerId: string) => Promise<void>; onClose: () => void
}) {
  const dialog=useRef<HTMLDialogElement>(null)
  const [player,setPlayer]=useState(event.player_id ?? '')
  const [error,setError]=useState('')
  useEffect(()=>{dialog.current?.showModal()},[])
  return <dialog ref={dialog} className="match-check-dialog" aria-label="Editar jugador del evento" onCancel={e=>{e.preventDefault();if(!busy)onClose()}}>
    <h2>Editar jugador del evento</h2>
    <form onSubmit={async e=>{e.preventDefault();setError('');try{await onSave(player)}catch(err){setError((err as Error).message)}}}>
      <label>Jugador del mismo equipo<select value={player} disabled={busy} onChange={e=>setPlayer(e.target.value)}>
        <option value="">Seleccionar jugador</option>
        {players.map(p=><option key={p.id} value={p.id}>#{p.shirt_number} {p.full_name}</option>)}
      </select></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || !player || player===event.player_id}>Guardar</button>
      <button type="button" disabled={busy} onClick={onClose}>Cancelar</button>
    </form>
  </dialog>
}
