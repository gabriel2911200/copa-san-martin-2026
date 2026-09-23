import { useState } from 'react'
import type { MatchPlayer, Player } from './lib/matchEvents'

type SaveLineup = (playerId: string, number: number, active: boolean) => Promise<boolean>
const control = 'min-h-12 w-full rounded-lg border bg-white p-3 disabled:opacity-50'
function TeamLineup({ teamId, name, players, lineup, disabled, onSave }: {
  teamId: string; name: string; players: Player[]; lineup: MatchPlayer[]; disabled: boolean; onSave: SaveLineup
}) {
  const [playerId, setPlayerId] = useState('')
  const [number, setNumber] = useState('')
  const assigned = lineup.filter(p => p.team_id === teamId)
  const available = players.filter(p => p.team_id === teamId && p.active && !assigned.some(a => a.id === p.id && a.used))
  async function save() {
    if (disabled || !playerId || number === '' || !Number.isInteger(Number(number)) || Number(number) < 0 || Number(number) > 99) return
    if (await onSave(playerId, Number(number), true)) { setPlayerId(''); setNumber('') }
  }
  return <section className="space-y-3 rounded-lg border p-3" aria-label={`Convocatoria de ${name}`}>
    <h3>{name}</h3>
    {!assigned.length && <p>Sin jugadores convocados.</p>}
    <ul className="space-y-2">{assigned.map(p => <li key={p.id}>
      <p>#{p.shirt_number} {p.full_name}{!p.active && ' · Inactivo'}</p>
      {p.used ? <small>Dorsal fijado por eventos del partido.</small> : <div className="flex gap-2">
        <button type="button" className={control} disabled={disabled || !p.active} onClick={() => { setPlayerId(p.id); setNumber(String(p.shirt_number)) }}>Cambiar dorsal</button>
        <button type="button" className={control} disabled={disabled} onClick={() => void onSave(p.id, p.shirt_number, false)}>Retirar de convocatoria</button>
      </div>}
    </li>)}</ul>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save() }}>
      <label>Jugador<select className={control} value={playerId} disabled={disabled} required onChange={e => { setPlayerId(e.target.value); setNumber(String(assigned.find(p => p.id === e.target.value)?.shirt_number ?? '')) }}>
        <option value="">Seleccionar jugador</option>{available.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select></label>
      <label>Número en este partido<input className={control} type="number" min="0" max="99" step="1" value={number} disabled={disabled} onChange={e => setNumber(e.target.value)} required/></label>
      <button className={control} disabled={disabled || !available.length}>Guardar convocatoria</button>
    </form>
  </section>
}

export default function MatchLineup({ homeId, awayId, home, away, players, lineup, disabled, onSave, onOwnGoal, ownGoalDisabled, onWalkover, walkoverDisabled }: {
  homeId: string; awayId: string; home: string; away: string; players: Player[]; lineup: MatchPlayer[]; disabled: boolean; onSave: SaveLineup
  onOwnGoal?: () => void; ownGoalDisabled?: boolean; onWalkover?: () => void; walkoverDisabled?: boolean
}) {
  return <div className="match-options"><details className="match-lineup space-y-3">
    <summary className="lineup-toggle">JUGADORES</summary>
    <p>Asigna jugadores y dorsales a ambos equipos antes de registrar eventos. El dorsal puede ser distinto en otro encuentro.</p>
    <TeamLineup teamId={homeId} name={home} players={players} lineup={lineup} disabled={disabled} onSave={onSave}/>
    <TeamLineup teamId={awayId} name={away} players={players} lineup={lineup} disabled={disabled} onSave={onSave}/>
  </details>{onOwnGoal && <button type="button" className="lineup-toggle own-goal-toggle disabled:opacity-50" disabled={ownGoalDisabled} onClick={onOwnGoal}>AUTOGOL</button>}{onWalkover && <button type="button" className="lineup-toggle walkover-toggle" disabled={walkoverDisabled} onClick={onWalkover}>Walkover (W.O.)</button>}</div>
}
