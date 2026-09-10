import type { EventType } from './matchEvents'
// Conserva la clave y formato antiguos; los campos nuevos distinguen eventos y jugador.
export type PendingGoal = { teamId: string; requestId: string; playerId?: string; eventType?: EventType; ownGoal?: boolean }
export function loadGoalRequest(storage: Pick<Storage, 'getItem'>, matchId: string): PendingGoal | null {
  const raw = storage.getItem(`pending-goal:${matchId}`)
  if (!raw) return null
  const value = JSON.parse(raw) as PendingGoal
  if (typeof value.teamId !== 'string' || typeof value.requestId !== 'string') throw Error('Solicitud de gol inválida')
  if (value.playerId !== undefined && typeof value.playerId !== 'string') throw Error('Jugador inválido')
  if (value.ownGoal !== undefined && typeof value.ownGoal !== 'boolean') throw Error('Autogol inválido')
  if (value.ownGoal && (value.playerId !== undefined || value.eventType !== 'GOAL')) throw Error('Autogol inválido')
  if (value.eventType !== undefined && !['GOAL','FOUL','YELLOW_CARD','RED_CARD','TIMEOUT'].includes(value.eventType)) throw Error('Evento inválido')
  return value
}
export function saveGoalRequest(storage: Pick<Storage, 'setItem' | 'removeItem'>, matchId: string, goal: PendingGoal | null) {
  const key = `pending-goal:${matchId}`
  if (goal) storage.setItem(key, JSON.stringify(goal))
  else storage.removeItem(key)
}
