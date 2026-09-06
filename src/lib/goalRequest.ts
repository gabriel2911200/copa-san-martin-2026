export type PendingGoal = { teamId: string; requestId: string }
export function loadGoalRequest(storage: Pick<Storage, 'getItem'>, matchId: string): PendingGoal | null {
  const raw = storage.getItem(`pending-goal:${matchId}`)
  if (!raw) return null
  const value = JSON.parse(raw) as PendingGoal
  if (typeof value.teamId !== 'string' || typeof value.requestId !== 'string') throw Error('Solicitud de gol inválida')
  return value
}
export function saveGoalRequest(storage: Pick<Storage, 'setItem' | 'removeItem'>, matchId: string, goal: PendingGoal | null) {
  const key = `pending-goal:${matchId}`
  if (goal) storage.setItem(key, JSON.stringify(goal))
  else storage.removeItem(key)
}
