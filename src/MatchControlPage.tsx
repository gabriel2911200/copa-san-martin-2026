import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { availableActions, clockAt, elapsedSeconds, formatClock, isPhaseEnding, phaseLimit, timeoutSeconds } from './lib/matchClock'
import type { ClockState, ControlAction } from './lib/matchClock'
import { loadGoalRequest, saveGoalRequest } from './lib/goalRequest'
import type { PendingGoal } from './lib/goalRequest'
import { useLiveRefresh } from './lib/useLiveRefresh'
import MatchLineup from './MatchLineup'
import MatchStats from './MatchStats'
import { MatchTimeline } from './MatchDetails'
import { PreMatchCheck, CollectionReminder } from './MatchChecks'
import { currentPeriod, playerUnavailable, eventLabels, lineupReady, teamPeriodStats } from './lib/matchEvents'
import type { EventType, MatchEvent, MatchPlayer, Player, Precheck, FoulCount } from './lib/matchEvents'

type Snapshot = {
  match: ClockState & { id: string; stage: string; updated_at: string; home_team_id: string; away_team_id: string; tiebreak_winner_team_id: string | null }
  server_now: string
  category: string
  matchday: number
  home: string
  away: string
  score: { home: number; away: number }
  goals: MatchEvent[]
  precheck?: Precheck | null
  events?: MatchEvent[]
  fouls?: FoulCount[]
  players?: Player[]
  lineup?: MatchPlayer[]
}
const actionLabels: Record<ControlAction, string> = {
  START: 'INICIAR PARTIDO', PAUSE: 'PAUSAR', RESUME: 'REANUDAR',
  BREAK: 'Terminar primer tiempo', SECOND_HALF: 'Finalizar descanso e iniciar segundo tiempo', FINISH: 'FINALIZAR PARTIDO',
  END_TIMEOUT: 'FINALIZAR MINUTO',
}
const stageLabels: Record<string, string> = { REGULAR: 'Regular', SEMIFINAL: 'Semifinal', THIRD_PLACE: 'Tercer puesto', FINAL: 'Final' }

export default function MatchControlPage() {
  const { id } = useParams()
  // Remonta el control al cambiar de partido para descartar peticiones anteriores.
  return <MatchController key={id} id={id ?? ''} />
}

function MatchController({ id }: { id: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [now, setNow] = useState(0)
  const anchor = useRef({ server: 0, local: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [precheckError, setPrecheckError] = useState('')
  const [synced, setSynced] = useState(false)
  const lock = useRef(false)
  const request = useRef(0)
  const mounted = useRef(true)
  const [pendingGoal, setPendingGoal] = useState<PendingGoal | null>(() => {
    try { return loadGoalRequest(sessionStorage, id) } catch { return null }
  })
  const [ownGoalSelection, setOwnGoalSelection] = useState(false)
  const lastGoalPress = useRef({ teamId: '', time: -Infinity })
  const [selection, setSelection] = useState<{ teamId: string; type: 'GOAL' | 'YELLOW_CARD' | 'RED_CARD' } | null>(null)

  const accept = useCallback((data: Snapshot, start: number) => {
    // Hora del servidor más media latencia; no usa la hora configurada en el móvil.
    const end = performance.now()
    anchor.current = { server: Date.parse(data.server_now) + (end - start) / 2, local: end }
    setNow(anchor.current.server)
    setSnapshot(data)
    setSynced(true)
  }, [])

  const refresh = useCallback(async () => {
    if (lock.current) return
    const sequence = ++request.current
    const start = performance.now()
    try {
      if (!supabase) throw Error('Sin configuración')
      const result = await supabase.rpc('get_match_control', { p_match_id: id })
      if (result.error) throw result.error
      if (!mounted.current || sequence !== request.current) return
      if (!result.data) { setSnapshot(null); throw Error('NOT_FOUND') }
      accept(result.data as Snapshot, start)
      setError('')
    } catch (err) {
      if (mounted.current && sequence === request.current) {
        setSynced(false)
        setError(err instanceof Error && err.message === 'NOT_FOUND' ? 'El partido no existe.' : 'No se pudo actualizar el partido. Comprueba la conexión y vuelve a intentar.')
      }
    } finally { if (mounted.current && sequence === request.current) setLoading(false) }
  }, [id, accept])
  useLiveRefresh(refresh)

  useEffect(() => {
    mounted.current = true
    const initial = window.setTimeout(() => void refresh(), 0)
    const tick = window.setInterval(() => setNow(anchor.current.server + performance.now() - anchor.current.local), 1000)
    const onReturn = () => { if (!document.hidden) void refresh() }
    window.addEventListener('focus', onReturn)
    window.addEventListener('online', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      mounted.current = false
      window.clearTimeout(initial)
      window.clearInterval(tick)
      window.removeEventListener('focus', onReturn)
      window.removeEventListener('online', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [refresh])

  const act = useCallback(async (action: ControlAction) => {
    if (!snapshot || !synced || lock.current || pendingGoal || (action === 'START' && !snapshot.precheck)) return
    lock.current = true; request.current++
    setSaving(true); setError(''); setSuccess('')
    const start = performance.now()
    try {
      if (!supabase) throw Error('Sin configuración')
      const result = await supabase.rpc('control_match', {
        p_match_id: id, p_action: action, p_expected_updated_at: snapshot.match.updated_at,
      })
      if (result.error) throw result.error
      if (!result.data) throw Error('Respuesta vacía')
      if (mounted.current) { accept(result.data as Snapshot, start); setSelection(null); setOwnGoalSelection(false); setSuccess('Estado guardado.') }
    } catch (err) {
      if (mounted.current) {
        setSynced(false)
        const rpcError = err as { code?: string; message?: string }
        setError(rpcError.code === 'P0001' ? rpcError.message ?? 'Acción rechazada.' : 'No se pudo confirmar el cambio. Actualiza el partido antes de volver a intentarlo.')
      }
    } finally { lock.current = false; if (mounted.current) setSaving(false) }
  }, [snapshot, synced, id, accept, pendingGoal])

  const goalOperation = useCallback(async (teamId?: string, eventId?: string, playerId?: string, eventType: EventType = 'GOAL', ownGoal = false) => {
    if (!snapshot || lock.current || (!synced && !pendingGoal)) return
    if (pendingGoal && (eventId || (teamId && teamId !== pendingGoal.teamId))) return
    const start = performance.now()
    // Un segundo toque inmediato sobre el mismo botón no es una intención nueva.
    const pressKey = `${teamId}:${eventType}:${playerId ?? ''}:${ownGoal}`
    if (teamId && !pendingGoal && lastGoalPress.current.teamId === pressKey && start - lastGoalPress.current.time < 700) return
    if (teamId) lastGoalPress.current = { teamId: pressKey, time: start }
    lock.current = true; request.current++
    setSaving(true); setError(''); setSuccess('')
    try {
      if (!supabase) throw Error('Sin configuración')
      let intention = pendingGoal
      if (!eventId && !intention) {
        if (!teamId) throw Error('Falta equipo')
        intention = { teamId, requestId: crypto.randomUUID(), playerId, eventType, ...(ownGoal ? { ownGoal: true } : {}) }
        // Guardar ANTES de enviar: un fallo de red o recarga conserva el mismo UUID.
        saveGoalRequest(sessionStorage, id, intention)
        setPendingGoal(intention)
      }
      const result = eventId
        ? await supabase.rpc(snapshot.events ? 'void_match_event' : 'void_goal', { p_match_id: id, p_event_id: eventId })
        : intention!.ownGoal
          ? await supabase.rpc('record_own_goal', { p_match_id: id, p_team_id: intention!.teamId, p_request_id: intention!.requestId })
        : intention!.eventType
          ? await supabase.rpc('record_match_event', { p_match_id: id, p_team_id: intention!.teamId, p_type: intention!.eventType, p_player_id: intention!.playerId ?? null, p_request_id: intention!.requestId })
          : await supabase.rpc('record_goal', { p_match_id: id, p_team_id: intention!.teamId, p_request_id: intention!.requestId })
      if (result.error) throw result.error
      if (!result.data?.control) throw Error('Respuesta incompleta')
      if (!eventId) {
        saveGoalRequest(sessionStorage, id, null)
        if (mounted.current) setPendingGoal(null)
      }
      if (mounted.current) {
        accept(result.data.control as Snapshot, start)
        setSelection(null); setOwnGoalSelection(false)
        const event = result.data.event as MatchEvent
        setSuccess(eventId ? 'Evento revertido.' : event.voided_at ? 'La solicitud corresponde a un evento ya revertido.' : `${eventLabels[event.type ?? eventType]} registrado.${event.player_name ? ` ${event.shirt_number != null ? `#${event.shirt_number} ` : ''}${event.player_name}` : ''}`)
      }
    } catch (err) {
      const rpcError = err as { code?: string; message?: string }
      // P0001 y constraints son rechazos confirmados; errores de red quedan pendientes.
      if (rpcError.code === 'P0001' || rpcError.code?.startsWith('23') || rpcError.code === '42501') {
        if (!eventId) {
          try { saveGoalRequest(sessionStorage, id, null); setPendingGoal(null) } catch { /* conservar pendiente */ }
        }
      }
      if (mounted.current) {
        if (!(rpcError.code === 'P0001' || rpcError.code?.startsWith('23') || rpcError.code === '42501')) setSynced(false)
        setError(rpcError.code === 'P0001' ? rpcError.message ?? 'Operación rechazada.' : 'No se pudo confirmar la operación. Reintenta el evento pendiente o actualiza el partido si fue una anulación.')
      }
    } finally { lock.current = false; if (mounted.current) setSaving(false) }
  }, [snapshot, synced, pendingGoal, id, accept])

  const choosePenalty = useCallback(async (teamId: string) => {
    if(lock.current || !synced || pendingGoal) return
    lock.current=true; request.current++; setSaving(true); setError(''); setSuccess('')
    const start=performance.now()
    try {
      if(!supabase) throw Error('Sin conexión')
      const result=await supabase.rpc('set_penalty_winner',{p_match_id:id,p_team_id:teamId})
      if(result.error) throw result.error
      if(mounted.current) { accept(result.data as Snapshot,start); setSuccess('Ganador por penales guardado. Ya puedes finalizar.') }
    } catch(err) {
      if(mounted.current) { setSynced(false); setError((err as {code?:string}).code==='P0001'?(err as {message:string}).message:'No se pudo confirmar el ganador. Actualiza el partido.') }
    } finally {lock.current=false; if(mounted.current) setSaving(false)}
  },[synced,pendingGoal,id,accept])

  const saveLineup = useCallback(async (playerId: string, number: number, active: boolean) => {
    if (!snapshot || lock.current || !synced || pendingGoal) return false
    lock.current = true; request.current++; setSaving(true); setError('')
    const start = performance.now()
    try {
      if (!supabase) throw Error('Sin conexión')
      const result = await supabase.rpc('set_match_player', { p_match_id: id, p_player_id: playerId, p_shirt_number: number, p_active: active, p_expected_updated_at: snapshot.match.updated_at })
      if (result.error) throw result.error
      if (!result.data) throw Error('Respuesta vacía')
      if (mounted.current) { accept(result.data as Snapshot, start); setSelection(null); setOwnGoalSelection(false); setSuccess('Convocatoria guardada.') }
      return true
    } catch (err) {
      if (mounted.current) { setSynced(false); setError((err as { code?: string }).code === 'P0001' ? (err as { message: string }).message : 'No se pudo confirmar la convocatoria. Actualiza antes de reintentar.') }
      return false
    } finally { lock.current = false; if (mounted.current) setSaving(false) }
  }, [snapshot, synced, pendingGoal, id, accept])

  const savePrecheck = async (values: Precheck) => {
    if (!snapshot || lock.current) return
    lock.current = true; request.current++; setSaving(true); setPrecheckError(''); setError('')
    const start = performance.now()
    try {
      if (!supabase) throw Error('Sin conexión')
      const send = (version: string) => supabase!.rpc('save_match_precheck', {
        p_match_id: id, p_home_ball: values.home_ball, p_home_band: values.home_band,
        p_away_ball: values.away_ball, p_away_band: values.away_band,
        p_expected_updated_at: version,
      })
      let result = await send(snapshot.match.updated_at)
      if (result.error && result.error.code !== 'PGRST202') {
        const fresh = await supabase.rpc('get_match_control', { p_match_id: id })
        if (fresh.error) throw fresh.error
        const latest = fresh.data as Snapshot | null
        if (!latest) throw Error('Respuesta vacía')
        if (latest.match.home_team_id !== snapshot.match.home_team_id || latest.match.away_team_id !== snapshot.match.away_team_id) {
          if (mounted.current) accept(latest, performance.now())
          throw Error('Los equipos del partido cambiaron. Revisa las respuestas antes de guardar.')
        }
        result = await send(latest.match.updated_at)
      }
      if (result.error) throw result.error
      if (!result.data) throw Error('Respuesta vacía')
      if (mounted.current) { accept(result.data as Snapshot, start); setSuccess('Control previo guardado correctamente') }
    } catch (err) {
      if (mounted.current) {
        const failure = err as { code?: string; message?: string }
        setPrecheckError(failure.code === 'P0001' && !failure.message?.includes('Actualiza') ? failure.message ?? 'No se pudo guardar.' : 'No se pudo guardar el control previo. Vuelve a guardar; tus respuestas se conservan.')
      }
    } finally { lock.current = false; if (mounted.current) setSaving(false) }
  }

  const settleTimeout = useCallback(async () => {
    if (!snapshot?.match.timeout_started_at || !synced || lock.current || pendingGoal) return
    lock.current = true; request.current++; setSaving(true)
    const start = performance.now()
    try {
      if (!supabase) throw Error('Sin conexión')
      const result = await supabase.rpc('finish_match_timeout', { p_match_id: id, p_timeout_started_at: snapshot.match.timeout_started_at, p_automatic: true })
      if (result.error) throw result.error
      if (!result.data) throw Error('Respuesta vacía')
      if (mounted.current) { accept(result.data as Snapshot, start); setError('') }
    } catch {
      if (mounted.current) { setSynced(false); setError('No se pudo sincronizar el final del minuto. Actualiza el partido; el reloj se recupera desde el vencimiento guardado.') }
    } finally { lock.current = false; if (mounted.current) setSaving(false) }
  }, [snapshot, synced, pendingGoal, id, accept])
  const timeoutExpired = !!snapshot?.match.timeout_started_at && timeoutSeconds(snapshot.match, now) >= 60
  useEffect(() => {
    if (!timeoutExpired) return
    const timer = setTimeout(() => void settleTimeout(), 0)
    return () => clearTimeout(timer)
  }, [timeoutExpired, settleTimeout, now])

  const match = snapshot ? clockAt(snapshot.match, now) : undefined
  const rosterReady = !!match && lineupReady(snapshot?.lineup ?? [], match.home_team_id, match.away_team_id)
  const elapsed = match ? elapsedSeconds(match, now) : 0
  const fulfilled = match && elapsed >= phaseLimit(match) && !['PROGRAMADO', 'FINALIZADO'].includes(match.status)
  const phase = match && ['PAUSADO','TIEMPO_MUERTO'].includes(match.status) ? match.paused_from_status : match?.status
  const ending = !!match && synced && isPhaseEnding(match, elapsed)
  const warnedPhases = useRef(new Set<string>())
  useEffect(() => {
    if (!ending || !phase || document.hidden || warnedPhases.current.has(phase)) return
    warnedPhases.current.add(phase)
    try { navigator.vibrate?.([200, 100, 200]) } catch { /* El aviso visual no depende de vibración. */ }
  }, [ending, phase, now])
  return <div className="space-y-6">
    <Link to="/admin/controlar" className="inline-block py-3 text-blue-700 underline">Volver a Controlar</Link>
    <h1>Control del partido</h1>
    {loading && <p role="status">Cargando partido…</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
    {!synced && !loading && !(snapshot?.match.status === 'PROGRAMADO' && !snapshot.precheck) && <button className="min-h-12 rounded-lg border p-3" disabled={saving} onClick={() => void refresh()}>Actualizar partido</button>}
    {snapshot && match && <>
      {match.status === 'PROGRAMADO' && !snapshot.precheck && <PreMatchCheck key={`${match.home_team_id}:${match.away_team_id}`} home={snapshot.home} away={snapshot.away} busy={saving} error={precheckError} onSave={values => void savePrecheck(values)}/>}
      <CollectionReminder status={match.status} home={snapshot.home} away={snapshot.away} homeId={match.home_team_id} awayId={match.away_team_id} precheck={snapshot.precheck} events={snapshot.events ?? []}/>
      <p>{snapshot.category} · Fecha {snapshot.matchday} · {stageLabels[match.stage] ?? match.stage}</p>
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 text-center">
        {!['PROGRAMADO','FINALIZADO'].includes(match.status) && <MatchStats match={match} events={snapshot.events} fouls={snapshot.fouls} home={snapshot.home} away={snapshot.away}/>}
        <div className="control-scoreboard">
        <p className="break-words font-semibold">{snapshot.home}</p>
        <p className="score-result font-bold tabular-nums" aria-label="Marcador">{snapshot.score.home} - {snapshot.score.away}</p>
        <p className="break-words font-semibold">{snapshot.away}</p>
        </div>
        {match.tiebreak_winner_team_id && <p className="font-semibold text-blue-800">{match.tiebreak_winner_team_id===match.home_team_id?snapshot.home:snapshot.away} gana por penales</p>}
        <p className="font-semibold">{match.status === 'TIEMPO_MUERTO' ? '⏸️ MINUTO' : match.status.replaceAll('_', ' ')}</p>
        {match.status === 'PAUSADO' && <p>{match.paused_from_status?.replaceAll('_', ' ')} · Reloj detenido</p>}
        <p role="timer" aria-label="Tiempo de la fase" className="text-6xl font-bold tabular-nums">{formatClock(elapsed)}</p>
        {match.status === 'TIEMPO_MUERTO' && <div className="public-timeout">
          <p>{currentPeriod(match)}T · Reloj del partido detenido</p>
          <p>{match.timeout_team_id === match.home_team_id ? snapshot.home : snapshot.away}</p>
          <p role="timer" aria-label="Contador de minuto" className="text-4xl font-bold tabular-nums">{formatClock(60 - timeoutSeconds(match, now))}</p>
          <p>Duración: 01:00 · Reanudación automática</p>
        </div>}
        {ending && <p role="alert" className="rounded-lg bg-amber-100 p-4 font-semibold text-amber-900">Quedan 30 segundos o menos para {phase === 'DESCANSO' ? 'finalizar el descanso' : 'terminar el tiempo'}.</p>}
        {fulfilled && <p role="status" className="font-semibold text-blue-800">{phase === 'DESCANSO' ? 'Descanso cumplido' : 'Tiempo cumplido'}</p>}
      </section>
      <MatchLineup homeId={match.home_team_id} awayId={match.away_team_id} home={snapshot.home} away={snapshot.away} players={(snapshot.players ?? []).filter(p => !playerUnavailable(snapshot.events ?? [], p.id))} lineup={(snapshot.lineup ?? []).filter(p => !playerUnavailable(snapshot.events ?? [], p.id))} disabled={saving || !synced || !!pendingGoal || match.status === 'FINALIZADO'} onSave={saveLineup} onOwnGoal={() => { setSelection(null); setOwnGoalSelection(value => !value) }} ownGoalDisabled={saving || !synced || !!pendingGoal || !rosterReady || !['PRIMER_TIEMPO','SEGUNDO_TIEMPO'].includes(match.status)}/>
      {!rosterReady && match.status !== 'FINALIZADO' && <p>Completa la convocatoria de ambos equipos para habilitar goles, tarjetas y eventos.</p>}
      {pendingGoal && <div className="space-y-3 rounded-lg bg-amber-50 p-4">
        <p>Hay un evento pendiente de confirmar. Reintentar no lo registrará dos veces.</p>
        <button className="min-h-12 rounded-lg border px-4 disabled:opacity-50" disabled={saving} onClick={() => void goalOperation()}>Reintentar evento pendiente</button>
      </div>}
      <div className="grid grid-cols-2 gap-3">{(['home','away'] as const).map(side => {
        const teamId = side === 'home' ? match.home_team_id : match.away_team_id
        const disabled = saving || !synced || !!pendingGoal || !rosterReady || !['PRIMER_TIEMPO','SEGUNDO_TIEMPO'].includes(match.status)
        const stats = teamPeriodStats(snapshot.events ?? [], teamId, currentPeriod(match))
        return <section key={side} className="space-y-2" aria-label={`Acciones de ${snapshot[side]}`}>
          <h3>{snapshot[side]}</h3>
          {(['GOAL', 'FOUL', 'YELLOW_CARD', 'RED_CARD'] as const).map(type => <button key={type}
            className={'team-event-action event-' + type} disabled={disabled}
            aria-label={{ GOAL: 'GOL', FOUL: 'FALTA', YELLOW_CARD: 'AMARILLA', RED_CARD: 'ROJA' }[type] + ' ' + snapshot[side]}
            onClick={() => type === 'FOUL' ? void goalOperation(teamId, undefined, undefined, type) : (setOwnGoalSelection(false), setSelection({ teamId, type }))}>
            {{ GOAL: '⚽ GOL', FOUL: 'FALTA', YELLOW_CARD: '🟨 AMARILLA', RED_CARD: '🟥 ROJA' }[type]}
          </button>)}
          <button className="min-h-12 w-full rounded-lg border p-3 disabled:opacity-50" disabled={disabled || stats.timeoutUsed} onClick={() => void goalOperation(teamId, undefined, undefined, 'TIMEOUT')}>MINUTO {side === 'home' ? 'LOCAL' : 'VISITANTE'}</button>
        </section>
      })}</div>
      {ownGoalSelection && <section className="space-y-3 rounded-xl border-2 border-blue-700 bg-white p-4" aria-label="Seleccionar equipo para autogol">
        <h2>¿Quién recibió el autogol?</h2>
        <p>El gol contará para el equipo seleccionado.</p>
        {[[match.home_team_id, snapshot.home], [match.away_team_id, snapshot.away]].map(([teamId, name]) => <button key={teamId} className="min-h-12 w-full rounded-lg border p-3 disabled:opacity-50"
          disabled={saving || !synced || !!pendingGoal || !rosterReady || !['PRIMER_TIEMPO','SEGUNDO_TIEMPO'].includes(match.status)}
          onClick={() => void goalOperation(teamId, undefined, undefined, 'GOAL', true)}>{name}</button>)}
        <button className="min-h-12 rounded-lg border p-3" disabled={saving} onClick={() => setOwnGoalSelection(false)}>Cancelar selección</button>
      </section>}
      {selection && <section className="space-y-3 rounded-xl border-2 border-blue-700 bg-white p-4" aria-label="Seleccionar jugador">
        <h2>{eventLabels[selection.type]} · {selection.teamId === match.home_team_id ? snapshot.home : snapshot.away}</h2>
        <p>Seleccionar jugador</p>
        {(snapshot.lineup ?? []).filter(p => p.active && p.team_id === selection.teamId && !playerUnavailable(snapshot.events ?? [], p.id)).map(player => <button key={player.id}
          className="min-h-12 w-full rounded-lg border p-3 disabled:opacity-50"
          disabled={saving || !synced || !!pendingGoal || !rosterReady || !['PRIMER_TIEMPO','SEGUNDO_TIEMPO'].includes(match.status)}
          onClick={() => void goalOperation(selection.teamId, undefined, player.id, selection.type)}>#{player.shirt_number} {player.full_name}</button>)}
        {!(snapshot.lineup ?? []).some(p => p.active && p.team_id === selection.teamId && !playerUnavailable(snapshot.events ?? [], p.id)) && <p>No hay jugadores disponibles para esta acción. Revisa la convocatoria y las tarjetas del partido.</p>}
        <button className="min-h-12 rounded-lg border p-3" disabled={saving} onClick={() => setSelection(null)}>Cancelar selección</button>
      </section>}
      {match.stage!=='REGULAR' && match.status==='SEGUNDO_TIEMPO' && snapshot.score.home===snapshot.score.away && <section className="space-y-3 rounded-xl bg-amber-50 p-4">
        <h2 className="text-xl font-semibold">Ganador por penales</h2>
        <p>El marcador reglamentario permanece empatado. Selecciona quién ganó la tanda.</p>
        {[['home',match.home_team_id],['away',match.away_team_id]].map(([side,teamId])=><button key={teamId} disabled={saving||!synced||!!pendingGoal} className="min-h-12 w-full rounded-lg border bg-white p-3 disabled:opacity-50" onClick={()=>void choosePenalty(teamId)}>{side==='home'?snapshot.home:snapshot.away}</button>)}
      </section>}
      <div className="space-y-3" aria-busy={saving}>
        {availableActions(match).map(action => <button key={action} disabled={saving || !synced || !!pendingGoal || (action==='START' && !snapshot.precheck) || (action==='FINISH' && match.stage!=='REGULAR' && snapshot.score.home===snapshot.score.away && !match.tiebreak_winner_team_id)} onClick={() => void act(action)} className="min-h-14 w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{actionLabels[action]}</button>)}
      </div>
      <p role="status" className="text-green-800">{saving ? 'Guardando…' : success}</p>
      {match.status !== 'PROGRAMADO' && <section className="live-match-stats" aria-label="Estadísticas del partido en vivo">
        <h2>ESTADÍSTICAS EN VIVO</h2>
        <MatchTimeline item={snapshot} disabled={saving || !synced || !!pendingGoal} onRevert={eventId => goalOperation(undefined, eventId)}/>
      </section>}
    </>}
  </div>
}
