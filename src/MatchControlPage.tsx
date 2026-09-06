import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { availableActions, elapsedSeconds, formatClock, phaseLimit } from './lib/matchClock'
import type { ClockState, ControlAction } from './lib/matchClock'
import { loadGoalRequest, saveGoalRequest } from './lib/goalRequest'
import type { PendingGoal } from './lib/goalRequest'
import { useLiveRefresh } from './lib/useLiveRefresh'

type Goal = { id: string; team_id: string; period_number: 1 | 2; clock_seconds: number }

type Snapshot = {
  match: ClockState & { id: string; stage: string; updated_at: string; home_team_id: string; away_team_id: string; tiebreak_winner_team_id: string | null }
  server_now: string
  category: string
  matchday: number
  home: string
  away: string
  score: { home: number; away: number }
  goals: Goal[]
}
const actionLabels: Record<ControlAction, string> = {
  START: 'INICIAR PARTIDO', PAUSE: 'PAUSAR', RESUME: 'REANUDAR',
  BREAK: 'INICIAR DESCANSO', SECOND_HALF: 'INICIAR SEGUNDO TIEMPO', FINISH: 'FINALIZAR PARTIDO',
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
  const [synced, setSynced] = useState(false)
  const lock = useRef(false)
  const request = useRef(0)
  const mounted = useRef(true)
  const [pendingGoal, setPendingGoal] = useState<PendingGoal | null>(() => {
    try { return loadGoalRequest(sessionStorage, id) } catch { return null }
  })
  const lastGoalPress = useRef({ teamId: '', time: -Infinity })

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
    if (!snapshot || !synced || lock.current || pendingGoal) return
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
      if (mounted.current) { accept(result.data as Snapshot, start); setSuccess('Estado guardado.') }
    } catch (err) {
      if (mounted.current) {
        setSynced(false)
        const rpcError = err as { code?: string; message?: string }
        setError(rpcError.code === 'P0001' ? rpcError.message ?? 'Acción rechazada.' : 'No se pudo confirmar el cambio. Actualiza el partido antes de volver a intentarlo.')
      }
    } finally { lock.current = false; if (mounted.current) setSaving(false) }
  }, [snapshot, synced, id, accept, pendingGoal])

  const goalOperation = useCallback(async (teamId?: string, eventId?: string) => {
    if (!snapshot || lock.current || (!synced && !pendingGoal)) return
    if (pendingGoal && (eventId || (teamId && teamId !== pendingGoal.teamId))) return
    const start = performance.now()
    // Un segundo toque inmediato sobre el mismo botón no es una intención nueva.
    if (teamId && !pendingGoal && lastGoalPress.current.teamId === teamId && start - lastGoalPress.current.time < 700) return
    if (teamId) lastGoalPress.current = { teamId, time: start }
    lock.current = true; request.current++
    setSaving(true); setError(''); setSuccess('')
    try {
      if (!supabase) throw Error('Sin configuración')
      let intention = pendingGoal
      if (!eventId && !intention) {
        if (!teamId) throw Error('Falta equipo')
        intention = { teamId, requestId: crypto.randomUUID() }
        // Guardar ANTES de enviar: un fallo de red o recarga conserva el mismo UUID.
        saveGoalRequest(sessionStorage, id, intention)
        setPendingGoal(intention)
      }
      const result = eventId
        ? await supabase.rpc('void_goal', { p_match_id: id, p_event_id: eventId })
        : await supabase.rpc('record_goal', { p_match_id: id, p_team_id: intention!.teamId, p_request_id: intention!.requestId })
      if (result.error) throw result.error
      if (!result.data?.control) throw Error('Respuesta incompleta')
      if (!eventId) {
        saveGoalRequest(sessionStorage, id, null)
        if (mounted.current) setPendingGoal(null)
      }
      if (mounted.current) {
        accept(result.data.control as Snapshot, start)
        setSuccess(eventId ? 'Gol anulado.' : result.data.event.voided_at ? 'La solicitud corresponde a un gol ya anulado.' : 'Gol registrado.')
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
        setSynced(false)
        setError(rpcError.code === 'P0001' ? rpcError.message ?? 'Operación rechazada.' : 'No se pudo confirmar la operación. Si hay un gol pendiente, usa «Reintentar gol pendiente»; para una anulación, actualiza el partido.')
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

  const match = snapshot?.match
  const elapsed = match ? elapsedSeconds(match, now) : 0
  const fulfilled = match && elapsed >= phaseLimit(match) && !['PROGRAMADO', 'FINALIZADO'].includes(match.status)
  const phase = match?.status === 'PAUSADO' ? match.paused_from_status : match?.status
  return <div className="space-y-6">
    <Link to="/admin/calendario" className="inline-block py-3 text-blue-700 underline">Volver al calendario</Link>
    <h1>Control del partido</h1>
    {loading && <p role="status">Cargando partido…</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
    {snapshot && match && <>
      <p>{snapshot.category} · Fecha {snapshot.matchday} · {stageLabels[match.stage] ?? match.stage}</p>
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 text-center">
        <p className="break-words text-xl font-semibold">{snapshot.home}</p>
        <p className="text-5xl font-bold tabular-nums" aria-label="Marcador">{snapshot.score.home} - {snapshot.score.away}</p>
        <p className="break-words text-xl font-semibold">{snapshot.away}</p>
        {match.tiebreak_winner_team_id && <p className="font-semibold text-blue-800">{match.tiebreak_winner_team_id===match.home_team_id?snapshot.home:snapshot.away} gana por penales</p>}
        <p className="font-semibold">{match.status.replaceAll('_', ' ')}</p>
        {match.status === 'PAUSADO' && <p>{match.paused_from_status?.replaceAll('_', ' ')} · Reloj detenido</p>}
        <p role="timer" aria-label="Tiempo de la fase" className="text-6xl font-bold tabular-nums">{formatClock(elapsed)}</p>
        {fulfilled && <p role="status" className="font-semibold text-blue-800">{phase === 'DESCANSO' ? 'Descanso cumplido' : 'Tiempo cumplido'}</p>}
      </section>
      {pendingGoal && <div className="space-y-3 rounded-lg bg-amber-50 p-4">
        <p>Hay un gol pendiente de confirmar. Reintentar no lo registrará dos veces.</p>
        <button className="min-h-12 rounded-lg border px-4 disabled:opacity-50" disabled={saving} onClick={() => void goalOperation()}>Reintentar gol pendiente</button>
      </div>}
      <div className="grid gap-4 sm:grid-cols-2">
        {(['home', 'away'] as const).map(side => <button key={side}
          disabled={saving || !synced || !!pendingGoal || !['PRIMER_TIEMPO','SEGUNDO_TIEMPO'].includes(match.status)}
          onClick={() => void goalOperation(side === 'home' ? match.home_team_id : match.away_team_id)}
          className="min-h-24 rounded-xl bg-green-800 p-4 font-bold text-white disabled:opacity-50">
          <span className="block">GOOOL {side === 'home' ? 'LOCAL' : 'VISITANTE'}</span>
          <span className="block break-words font-normal">{snapshot[side]}</span>
        </button>)}
      </div>
      {match.stage!=='REGULAR' && match.status==='SEGUNDO_TIEMPO' && elapsed>=900 && snapshot.score.home===snapshot.score.away && <section className="space-y-3 rounded-xl bg-amber-50 p-4">
        <h2 className="text-xl font-semibold">Ganador por penales</h2>
        <p>El marcador reglamentario permanece empatado. Selecciona quién ganó la tanda.</p>
        {[['home',match.home_team_id],['away',match.away_team_id]].map(([side,teamId])=><button key={teamId} disabled={saving||!synced||!!pendingGoal} className="min-h-12 w-full rounded-lg border bg-white p-3 disabled:opacity-50" onClick={()=>void choosePenalty(teamId)}>{side==='home'?snapshot.home:snapshot.away}</button>)}
      </section>}
      <div className="space-y-3" aria-busy={saving}>
        {availableActions(match, elapsed).map(action => <button key={action} disabled={saving || !synced || !!pendingGoal || (action==='FINISH' && match.stage!=='REGULAR' && snapshot.score.home===snapshot.score.away && !match.tiebreak_winner_team_id)} onClick={() => void act(action)} className="min-h-14 w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{actionLabels[action]}</button>)}
      </div>
      <p role="status" className="text-green-800">{saving ? 'Guardando…' : success}</p>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Goles válidos</h2>
        {!snapshot.goals.length && <p>No hay goles válidos registrados.</p>}
        <ul className="space-y-3">{snapshot.goals.map(goal => <li key={goal.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-4">
          <p className="break-words">{goal.period_number}T {formatClock(goal.clock_seconds)} — Gol {goal.team_id === match.home_team_id ? snapshot.home : snapshot.away}</p>
          {['PRIMER_TIEMPO','SEGUNDO_TIEMPO','DESCANSO','PAUSADO'].includes(match.status) && <button
            className="min-h-12 rounded-lg border border-red-300 px-4 text-red-800 disabled:opacity-50"
            disabled={saving || !synced || !!pendingGoal} onClick={() => void goalOperation(undefined, goal.id)}>ANULAR</button>}
        </li>)}</ul>
        <p className="text-sm text-slate-600">Los goles anulados se conservan en el registro y no aparecen en esta lista.</p>
      </section>
    </>}
  </div>
}
