export type MatchStatus = 'PROGRAMADO' | 'PRIMER_TIEMPO' | 'DESCANSO' | 'SEGUNDO_TIEMPO' | 'PAUSADO' | 'TIEMPO_MUERTO' | 'FINALIZADO'
export type ClockState = {
  status: MatchStatus
  paused_from_status: MatchStatus | null
  phase_elapsed_seconds: number
  phase_started_at: string | null
  timeout_started_at?: string | null
  timeout_team_id?: string | null
}
export type ControlAction = 'START' | 'PAUSE' | 'RESUME' | 'BREAK' | 'SECOND_HALF' | 'FINISH' | 'END_TIMEOUT'

export function timeoutSeconds(match: ClockState, serverNow: number) {
  return match.timeout_started_at ? Math.min(60, Math.max(0, Math.floor((serverNow - Date.parse(match.timeout_started_at)) / 1000))) : 0
}

// El vencimiento persistido permite continuar aunque se suspenda la pestaña.
export function clockAt<T extends ClockState>(match: T, serverNow: number): T {
  if (match.status !== 'TIEMPO_MUERTO' || !match.timeout_started_at || timeoutSeconds(match, serverNow) < 60) return match
  if (match.paused_from_status !== 'PRIMER_TIEMPO' && match.paused_from_status !== 'SEGUNDO_TIEMPO') return match
  return { ...match, status: match.paused_from_status, paused_from_status: null,
    phase_started_at: new Date(Date.parse(match.timeout_started_at) + 60000).toISOString() }
}

export function phaseLimit(match: ClockState) {
  const phase = ['PAUSADO','TIEMPO_MUERTO'].includes(match.status) ? match.paused_from_status : match.status
  return phase === 'DESCANSO' ? 300 : 900
}

export function elapsedSeconds(match: ClockState, serverNow: number) {
  match = clockAt(match, serverNow)
  if (match.status === 'PROGRAMADO') return 0
  const running = ['PRIMER_TIEMPO', 'DESCANSO', 'SEGUNDO_TIEMPO'].includes(match.status)
  const delta = running && match.phase_started_at
    ? Math.max(0, Math.floor((serverNow - Date.parse(match.phase_started_at)) / 1000)) : 0
  return Math.min(phaseLimit(match), Math.max(0, match.phase_elapsed_seconds + delta))
}

export function formatClock(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

export function availableActions(match: ClockState): ControlAction[] {
  if (match.status === 'PROGRAMADO') return ['START']
  if (match.status === 'PAUSADO') return ['RESUME']
  if (match.status === 'TIEMPO_MUERTO') return ['END_TIMEOUT']
  if (match.status === 'FINALIZADO') return []
  return ['PAUSE', match.status === 'PRIMER_TIEMPO' ? 'BREAK' : match.status === 'DESCANSO' ? 'SECOND_HALF' : 'FINISH']
}

export function isPhaseEnding(match: ClockState, seconds: number): boolean {
  return ['PRIMER_TIEMPO', 'DESCANSO', 'SEGUNDO_TIEMPO'].includes(match.status)
    && seconds >= phaseLimit(match) - 30 && seconds < phaseLimit(match)
}
