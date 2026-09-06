export type MatchStatus = 'PROGRAMADO' | 'PRIMER_TIEMPO' | 'DESCANSO' | 'SEGUNDO_TIEMPO' | 'PAUSADO' | 'FINALIZADO'
export type ClockState = {
  status: MatchStatus
  paused_from_status: MatchStatus | null
  phase_elapsed_seconds: number
  phase_started_at: string | null
}
export type ControlAction = 'START' | 'PAUSE' | 'RESUME' | 'BREAK' | 'SECOND_HALF' | 'FINISH'

export function phaseLimit(match: ClockState) {
  const phase = match.status === 'PAUSADO' ? match.paused_from_status : match.status
  return phase === 'DESCANSO' ? 300 : 900
}

export function elapsedSeconds(match: ClockState, serverNow: number) {
  if (match.status === 'PROGRAMADO') return 0
  const running = ['PRIMER_TIEMPO', 'DESCANSO', 'SEGUNDO_TIEMPO'].includes(match.status)
  const delta = running && match.phase_started_at
    ? Math.max(0, Math.floor((serverNow - Date.parse(match.phase_started_at)) / 1000)) : 0
  return Math.min(phaseLimit(match), Math.max(0, match.phase_elapsed_seconds + delta))
}

export function formatClock(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

export function availableActions(match: ClockState, seconds: number): ControlAction[] {
  if (match.status === 'PROGRAMADO') return ['START']
  if (match.status === 'PAUSADO') return ['RESUME']
  if (match.status === 'FINALIZADO') return []
  const actions: ControlAction[] = ['PAUSE']
  if (seconds >= phaseLimit(match)) {
    actions.push(match.status === 'PRIMER_TIEMPO' ? 'BREAK' : match.status === 'DESCANSO' ? 'SECOND_HALF' : 'FINISH')
  }
  return actions
}
