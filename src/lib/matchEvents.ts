import type { ClockState } from './matchClock'

export type EventType = 'GOAL' | 'FOUL' | 'YELLOW_CARD' | 'RED_CARD' | 'TIMEOUT'
export type Player = { id: string; team_id: string; full_name: string; active: boolean }
export type MatchPlayer = Player & { shirt_number: number; used?: boolean }
export function lineupReady(lineup: MatchPlayer[], homeId: string, awayId: string) {
  return [homeId, awayId].every(id => lineup.some(p => p.team_id === id && p.active))
}
export type MatchEvent = {
  id: string; team_id: string; type?: EventType; period_number?: number; clock_seconds?: number; created_at?: string
  player_id?: string | null; player_name?: string | null; shirt_number?: number | null; voided_at?: string | null
}
export const eventLabels: Record<EventType, string> = { GOAL: '⚽ Gol', FOUL: 'Falta', YELLOW_CARD: '🟨 Amarilla', RED_CARD: '🟥 Roja', TIMEOUT: '⏸ Minuto' }
export type FoulCount = { team_id: string; period_number: number; count: number }
export type Precheck = { home_ball: boolean; home_band: boolean; away_ball: boolean; away_band: boolean }
// La segunda amarilla válida representa la expulsión. Anular una tarjeta la revierte.
export function doubleYellows(events: MatchEvent[]) {
  const counts = new Map<string, number>()
  return events.filter(e => {
    if (e.voided_at || e.type !== 'YELLOW_CARD' || !e.player_id) return false
    const count = (counts.get(e.player_id) ?? 0) + 1
    counts.set(e.player_id, count)
    return count === 2
  })
}
export function playerUnavailable(events: MatchEvent[], playerId: string) {
  return events.some(e => !e.voided_at && e.type === 'RED_CARD' && e.player_id === playerId)
    || doubleYellows(events).some(e => e.player_id === playerId)
}
export function currentPeriod(match: ClockState): 1 | 2 {
  const phase = ['PAUSADO','TIEMPO_MUERTO'].includes(match.status) ? match.paused_from_status : match.status
  return phase === 'SEGUNDO_TIEMPO' || phase === 'FINALIZADO' ? 2 : 1
}
export function teamPeriodStats(events: MatchEvent[], teamId: string, period: number) {
  const valid = events.filter(e => !e.voided_at && e.team_id === teamId && e.period_number === period)
  return { fouls: valid.filter(e => e.type === 'FOUL').length, timeoutUsed: valid.some(e => e.type === 'TIMEOUT') }
}
export const eventMinute = (seconds = 0) => Math.max(1, Math.ceil(seconds / 60))

export function matchTimeline(goals: MatchEvent[], events: MatchEvent[] = [], includeTimeouts = false) {
  const unique = new Map(goals.map(e => [e.id, {...e,type:'GOAL' as const} as MatchEvent]))
  for(const event of events) unique.set(event.id,event)
  return [...unique.values()].filter(e => !e.voided_at && (['GOAL','YELLOW_CARD','RED_CARD'].includes(e.type ?? '') || (includeTimeouts && e.type === 'TIMEOUT'))).sort((a,b) => {
    if(a.created_at && b.created_at) {
      const time = Date.parse(a.created_at) - Date.parse(b.created_at)
      if(Number.isFinite(time) && time !== 0) return time
    }
    return (a.period_number ?? 1)-(b.period_number ?? 1) || (a.clock_seconds ?? 0)-(b.clock_seconds ?? 0)
  })
}
