import type { ClockState } from './matchClock'
export type PublicMatch = {
  match: ClockState & { id: string; category_id: string; home_team_id: string; away_team_id: string; stage: string; created_at: string; updated_at: string; scheduled_date?: string | null; scheduled_time?: string | null; tiebreak_winner_team_id: string | null }
  category: string; matchday: number; home: string; away: string; server_now: string
  score: { home: number; away: number }; goals: { id: string; team_id: string; period_number?: number; clock_seconds?: number; voided_at?: string | null }[]
  winner_team_id: string | null; loser_team_id: string | null; resolved: boolean
}
export type TournamentCategory = { id: string; name: string; regular_closed_at: string | null; qualified: { id: string; name: string }[] }
export type Tournament = { categories: TournamentCategory[]; matchdays: { id: string; number: number; date: string | null }[]; matches: PublicMatch[] }
export const stageLabels: Record<string,string> = { REGULAR: 'Regular', SEMIFINAL: 'Semifinal', THIRD_PLACE: 'Tercer puesto', FINAL: 'Final' }
export const isActive = (m: PublicMatch) => ['PRIMER_TIEMPO','DESCANSO','SEGUNDO_TIEMPO','PAUSADO'].includes(m.match.status)
export const teamName = (m: PublicMatch, id: string | null) => id === m.match.home_team_id ? m.home : id === m.match.away_team_id ? m.away : ''
export function featuredMatch(matches: PublicMatch[]) {
  return matches.find(isActive) ?? matches.find(m => m.match.status === 'PROGRAMADO')
}
export function podium(matches: PublicMatch[], categoryId: string) {
  const final = matches.find(m => m.match.category_id === categoryId && m.match.stage === 'FINAL' && m.resolved)
  const third = matches.find(m => m.match.category_id === categoryId && m.match.stage === 'THIRD_PLACE' && m.resolved)
  if (!final || !third) return null
  return [teamName(final, final.winner_team_id),teamName(final, final.loser_team_id),teamName(third, third.winner_team_id),teamName(third, third.loser_team_id)]
}
