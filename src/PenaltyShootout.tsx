import { useCallback, useRef, useState } from 'react'
import EventDialog from './EventDialog'
import { supabase } from './lib/supabase'
import { penaltySlots } from './lib/penalties'
import type { Shootout, PenaltyAttempt } from './lib/penalties'
import { loadShootoutRequest } from './lib/shootoutRequest'
import type { ShootoutOperation as Operation } from './lib/shootoutRequest'
import { isConfirmedRejection } from './lib/rpcErrors'

type Item = {
  home: string; away: string; shootout?: Shootout | null
  match: { id: string; home_team_id: string; away_team_id: string; updated_at: string }
}
export default function PenaltyShootout({ item, editable = false, canStart = false, showControl = false, disabled = false, onChange }: {
  item: Item; editable?: boolean; canStart?: boolean; showControl?: boolean; disabled?: boolean; onChange?: (snapshot: unknown) => void | Promise<void>
}) {
  const { match, shootout: s } = item
  const storageKey = `pending-shootout:${match.id}`
  const [pending, setPending] = useState<Operation | null>(() => {
    if (!editable) return null
    try { return loadShootoutRequest(sessionStorage, match.id) } catch { return null }
  })
  const [finishConfirm,setFinishConfirm]=useState<number|null>(null)
  const [dialog, setDialog] = useState<PenaltyAttempt | null>(null)
  const activeDialog = dialog
  const [expanded,setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const name = (id: string | null) => id === match.home_team_id ? item.home : item.away
  const blocked = busy || disabled || !!pending
  const send = useCallback(async (operation: Operation) => {
    if (!supabase || lock.current || disabled) return
    lock.current = true; setBusy(true); setError('')
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(operation))
    } catch {
      // Nothing was sent. Do not freeze the controls behind an unsendable retry.
      setError('No se pudo guardar la solicitud en este navegador. Habilita el almacenamiento y vuelve a intentar.')
      lock.current = false; setBusy(false)
      return
    }
    setPending(operation)
    try {
      const response = await supabase.rpc(operation.rpc, operation.args)
      if (response.error) {
        if (isConfirmedRejection(response.error.code)) {
          try { sessionStorage.removeItem(storageKey) } catch { /* A confirmed rejection remains rejected. */ }
          setPending(null)
          const fresh = await supabase.rpc('get_match_control', { p_match_id: match.id })
          if (fresh.data) await onChange?.(fresh.data)
          throw Error(response.error.message)
        }
        throw Error('No se pudo confirmar. Reintenta la misma operación.')
      }
      if (!response.data?.shootout) throw Error('Respuesta incompleta. Reintenta la misma operación.')
      try { sessionStorage.removeItem(storageKey) } catch { /* A later replay uses the same idempotent receipt. */ }
      setPending(null)
      await onChange?.(response.data)
      setDialog(null)
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo confirmar. Reintenta.') }
    finally { lock.current = false; setBusy(false) }
  }, [disabled, storageKey, match.id, onChange])
  function manage(action: string, converted: boolean | null = null, attemptId: string | null = null, teamId: string | null = null) {
    if (!s || blocked) return
    void send({ rpc: 'manage_penalty_shootout', args: { p_match_id: match.id, p_action: action,
      p_team_id: action === 'RECORD' ? teamId : null, p_attempt_id: attemptId,
      p_converted: converted, p_request_id: crypto.randomUUID(), p_expected_revision: s.revision } })
  }
  const display = s ?? {first_team_id:null,revision:0,completed_at:null,next_team_id:null,winner_team_id:null,score:{home:0,away:0},attempts:[]}
  if (!s && !canStart && !pending && !showControl) return null
  if (!s && !pending && !expanded) return <button type="button" className="penalty-toggle" aria-expanded={false} onClick={()=>setExpanded(true)}>Penales</button>
  return <section className="penalty-shootout" aria-label="Tanda de penales">
    <h2>TANDA DE PENALES</h2>
    {editable&&!s&&!pending&&<><p>La tanda puede iniciarse al terminar el segundo tiempo con el marcador empatado.</p><button type="button" disabled={blocked||!canStart} onClick={()=>void send({rpc:'open_penalty_shootout',args:{p_match_id:match.id,p_request_id:crypto.randomUUID(),p_expected_updated_at:match.updated_at}})}>INICIAR TANDA DE PENALES</button><button type="button" onClick={()=>setExpanded(false)}>Cerrar penales</button></>}
    {editable&&s&&!s.attempts.length&&!s.completed_at&&<label>Lanzamientos iniciales por equipo<select aria-label="Lanzamientos iniciales por equipo" value={s.initial_attempts??5} disabled={blocked} onChange={e=>manage(e.target.value==='3'?'SET_THREE':'SET_FIVE')}><option value="3">3 penales</option><option value="5">5 penales</option></select></label>}
    {<>
      <div className="penalty-teams">{[match.home_team_id, match.away_team_id].map(team => {
        const kicks = display.attempts.filter(k => k.team_id === team)
        return <div key={team} className="penalty-team">
          <h3>{name(team)}</h3>
          <div className="penalty-attempts">{Array.from({length: penaltySlots(display, match.home_team_id, match.away_team_id)}, (_, index) => {
            const k = kicks[index]
            if (!k) return <span key={index} className="kick-pending" aria-label={'Penal ' + (index + 1) + ' ' + name(team) + ' pendiente'}>○</span>
            const label = 'Lanzamiento ' + k.sequence + ' ' + name(team) + ': ' + (k.converted ? 'convertido' : 'fallado')
            return editable ? <button key={index} className={k.converted ? 'kick-scored' : 'kick-missed'} aria-label={label} disabled={blocked} onClick={() => { setError(''); setDialog(k) }}>{k.converted ? '✓' : '✕'}</button>
              : <span key={index} className={k.converted ? 'kick-scored' : 'kick-missed'} aria-label={label}>{k.converted ? '✓' : '✕'}</span>
          })}</div>
          {editable && !display.completed_at && <div className="penalty-actions" aria-label={'Controles de penales ' + name(team)}>
            <button aria-label={'GOL ' + name(team)} disabled={blocked || !s || (!!s.first_team_id && s.next_team_id !== team)} onClick={() => manage('RECORD', true, null, team)}>✓ GOL</button>
            <button aria-label={'ERRÓ ' + name(team)} disabled={blocked || !s || (!!s.first_team_id && s.next_team_id !== team)} onClick={() => manage('RECORD', false, null, team)}>✕ ERRÓ</button>
          </div>}
        </div>
      })}</div>
      {!display.completed_at&&<p className="penalty-score" aria-label="Marcador actual de penales">{display.score.home} - {display.score.away}</p>}
      {s?.completed_at ? <div className="penalty-result">
        <p>{name(s.winner_team_id).toUpperCase()} GANA EN PENALES</p>
        <p className="penalty-score" aria-label="Marcador de penales">{s.score.home} - {s.score.away}</p>
      </div> : editable && <>
        {s?.first_team_id ? <p>SIGUIENTE LANZAMIENTO: <strong>{name(s.next_team_id)}</strong></p> : <p>{s ? 'El primer penal registrado determina quién comienza.' : pending ? 'Abriendo tanda…' : 'Todavía no se ha iniciado una tanda.'}</p>}
      </>}
    </>}
    {editable && s && !s.completed_at && <button disabled={blocked || s.score.home===s.score.away || ![match.home_team_id,match.away_team_id].every(id=>s.attempts.some(k=>k.team_id===id))} onClick={()=>{setError('');setFinishConfirm(s.revision)}}>FINALIZAR TANDA DE PENALES</button>}
    {finishConfirm!==null&&s&&<EventDialog title="FINALIZAR TANDA DE PENALES" busy={busy} onClose={()=>setFinishConfirm(null)}>
      <p>{item.home} {s.score.home} - {s.score.away} {item.away}</p>
      <p>Cierre administrativo anticipado: pueden quedar lanzamientos reglamentarios pendientes. Se registrarán únicamente los tiros ejecutados y ganará {name(s.score.home>s.score.away?match.home_team_id:match.away_team_id)}.</p>
      <p>Estado: tanda de penales · partido en pausa.</p>
      <button disabled={blocked||s.revision!==finishConfirm} onClick={()=>{setFinishConfirm(null);manage('FINISH_MANUAL')}}>CONFIRMAR FINALIZACIÓN ADMINISTRATIVA</button>
      {s.revision!==finishConfirm&&<p role="alert">La tanda cambió. Cancela y revisa el resultado.</p>}
    </EventDialog>}
    {error && !activeDialog && <p role="alert">{error}</p>}
    {editable&&!s&&canStart&&error&&!pending&&<button disabled={busy||disabled} onClick={()=>void send({rpc:'open_penalty_shootout',args:{p_match_id:match.id,p_request_id:crypto.randomUUID(),p_expected_updated_at:match.updated_at}})}>Reintentar apertura de penales</button>}
    {pending && !activeDialog && <button disabled={busy || disabled} onClick={() => void send(pending)}>Reintentar operación pendiente</button>}
    {activeDialog && <EventDialog title="CORREGIR LANZAMIENTO" busy={busy} onClose={() => setDialog(null)}>
      {error && <p role="alert">{error}</p>}
      {pending && <button disabled={busy || disabled} onClick={() => void send(pending)}>Reintentar operación pendiente</button>}
      {<>
        <p>Lanzamiento {activeDialog.sequence} · {name(activeDialog.team_id)}</p>
        {s?.completed_at && <p>La corrección debe conservar el ganador confirmado.</p>}
        <button disabled={blocked} onClick={() => manage('CORRECT', true, activeDialog.id)}>Cambiar a CONVERTIDO</button>
        <button disabled={blocked} onClick={() => manage('CORRECT', false, activeDialog.id)}>Cambiar a FALLADO</button>
        <button disabled={blocked || activeDialog.id !== s?.attempts.at(-1)?.id} onClick={() => manage('VOID', null, activeDialog.id)}>ANULAR último lanzamiento</button>
      </>}
    </EventDialog>}
  </section>
}
