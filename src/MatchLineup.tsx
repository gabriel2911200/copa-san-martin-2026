import { useRef, useState } from 'react'
import EventDialog from './EventDialog'
import type { MatchPlayer, Player } from './lib/matchEvents'

type SaveLineup = (playerId: string, number: number, active: boolean) => Promise<boolean>
const control = 'min-h-12 w-full rounded-lg border bg-white p-3 disabled:opacity-50'
function TeamLineup({ teamId, name, players, lineup, disabled, onSave, saveError }: {
  teamId: string; name: string; players: Player[]; lineup: MatchPlayer[]; disabled: boolean; onSave: SaveLineup; saveError?:string
}) {
  const [mode,setMode]=useState<'add'|'edit'>('add')
  const [playerId,setPlayerId]=useState('')
  const [number,setNumber]=useState('')
  const [open,setOpen]=useState(false)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [success,setSuccess]=useState('')
  const lock=useRef(false)
  const assigned=lineup.filter(p=>p.team_id===teamId)
  const available=players.filter(p=>p.team_id===teamId && p.active && (mode==='edit'?assigned.some(a=>a.id===p.id):!assigned.some(a=>a.id===p.id)))
  const selected=available.find(p=>p.id===playerId)
  const previous=assigned.find(p=>p.id===playerId)
  async function save() {
    if(disabled||lock.current||!selected) return
    if(number.trim()===''||!Number.isInteger(Number(number))||Number(number)<0||Number(number)>99){setError('Indica un dorsal entero entre 0 y 99.');return}
    const duplicate=assigned.find(p=>p.id!==playerId && p.shirt_number===Number(number))
    if(duplicate){setError('DORSAL YA ASIGNADO: el dorsal '+number+' ya pertenece a '+duplicate.full_name+' en este equipo. Selecciona otro número.');return}
    if(previous?.shirt_number===Number(number)){setOpen(false);return}
    lock.current=true;setBusy(true);setError('')
    try {
      if(await onSave(playerId,Number(number),true)){setSuccess('Dorsal guardado correctamente.');setOpen(false);setPlayerId('');setNumber('')}
      else setError('No se guardó el dorsal. Revisa el aviso del partido; puedes corregir el número sin perder el anterior.')
    } catch {setError('No se pudo guardar el dorsal. El número anterior se conserva.')}
    finally {lock.current=false;setBusy(false)}
  }
  return <section className="space-y-3 rounded-lg border p-3" aria-label={'Convocatoria de '+name}>
    <h3>{name}</h3>
    <div className="flex gap-2" role="group" aria-label={'Gestión de dorsales '+name}>
      <button className={control} aria-pressed={mode==='add'} disabled={disabled||busy} onClick={()=>{setMode('add');setPlayerId('')}}>AÑADIR DORSAL</button>
      <button className={control} aria-pressed={mode==='edit'} disabled={disabled||busy} onClick={()=>{setMode('edit');setPlayerId('')}}>EDITAR DORSAL</button>
    </div>
    <label>Jugador<select aria-label="Jugador" className={control} value={selected?playerId:''} disabled={disabled||busy} onChange={e=>setPlayerId(e.target.value)}>
      <option value="">Seleccionar jugador</option>{available.map(p=><option key={p.id} value={p.id}>{p.full_name}{mode==='edit'?' — dorsal '+assigned.find(a=>a.id===p.id)?.shirt_number:''}</option>)}
    </select></label>
    {!available.length&&<p>{mode==='add'?'Sin jugadores pendientes de dorsal.':'Sin jugadores con dorsal asignado.'}</p>}
    {previous&&<p>Dorsal actual: {previous.shirt_number}</p>}
    <button className={control} disabled={disabled||busy||!selected} onClick={()=>{setNumber(previous?String(previous.shirt_number):'');setError('');setOpen(true)}}>{mode==='add'?'AÑADIR DORSAL':'EDITAR DORSAL'}</button>
    <p role="status">{success}</p>
    {open&&selected&&<EventDialog title={mode==='add'?'AÑADIR DORSAL':'EDITAR DORSAL'} busy={busy} onClose={()=>setOpen(false)}>
      <p>{selected.full_name}</p>{previous&&<p>Dorsal actual: {previous.shirt_number}</p>}
      <form onSubmit={e=>{e.preventDefault();void save()}}>
        <label>{mode==='edit'?'Nuevo dorsal':'Número de dorsal'}<input autoFocus type="number" min="0" max="99" step="1" required value={number} disabled={busy} onChange={e=>setNumber(e.target.value)}/></label>
        {error&&<p role="alert">{error}</p>}
        {error&&saveError&&<p role="alert">{saveError}</p>}
        <button disabled={busy||disabled}>GUARDAR</button>
      </form>
    </EventDialog>}
    <ul className="space-y-2">{assigned.map(p=><li key={p.id}><p>#{p.shirt_number} {p.full_name}</p>{!p.used&&<button className={control} disabled={disabled||busy} onClick={()=>void onSave(p.id,p.shirt_number,false)}>Retirar de convocatoria</button>}</li>)}</ul>
  </section>
}

export default function MatchLineup({ homeId, awayId, home, away, players, lineup, disabled, onSave, onOwnGoal, ownGoalDisabled, onWalkover, walkoverDisabled, saveError }: {
  homeId: string; awayId: string; home: string; away: string; players: Player[]; lineup: MatchPlayer[]; disabled: boolean; onSave: SaveLineup
  onOwnGoal?: () => void; ownGoalDisabled?: boolean; onWalkover?: () => void; walkoverDisabled?: boolean
  saveError?: string
}) {
  return <div className="match-options"><details className="match-lineup space-y-3">
    <summary className="lineup-toggle">JUGADORES</summary>
    <p>Asigna jugadores y dorsales a ambos equipos antes de registrar eventos. El dorsal puede ser distinto en otro encuentro.</p>
    <TeamLineup teamId={homeId} name={home} players={players} lineup={lineup} disabled={disabled} onSave={onSave} saveError={saveError}/>
    <TeamLineup teamId={awayId} name={away} players={players} lineup={lineup} disabled={disabled} onSave={onSave} saveError={saveError}/>
  </details>{onOwnGoal && <button type="button" className="lineup-toggle own-goal-toggle disabled:opacity-50" disabled={ownGoalDisabled} onClick={onOwnGoal}>AUTOGOL</button>}{onWalkover && <button type="button" className="lineup-toggle walkover-toggle" disabled={walkoverDisabled} onClick={onWalkover}>Walkover (W.O.)</button>}</div>
}
