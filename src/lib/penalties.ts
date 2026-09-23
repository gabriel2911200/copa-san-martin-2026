export type PenaltyAttempt = {
  id: string; team_id: string; sequence: number; converted: boolean
  request_id: string; created_at: string; updated_at: string; voided_at: string | null
}
export type Shootout = {
  rule_set?: 'LEGACY_ADMIN' | 'FIVE_ALTERNATING'; initial_attempts?: number
  first_team_id: string | null; revision: number; completed_at: string | null
  next_team_id: string | null; winner_team_id: string | null
  score: { home: number; away: number }; attempts: PenaltyAttempt[]
}

// Matching slots for both teams; only the next extra round is exposed.
export function penaltySlots(shootout: Shootout, homeId: string, awayId: string) {
  const home = shootout.attempts.filter(k => k.team_id === homeId).length
  const away = shootout.attempts.filter(k => k.team_id === awayId).length
  return Math.max(5, home, away) + (!shootout.completed_at && home >= 5 && home === away ? 1 : 0)
}
