import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadGoalRequest, saveGoalRequest } from '../src/lib/goalRequest.ts'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}
test('recarga y reintento recuperan exactamente el mismo request_id', () => {
  const session = storage()
  const intention = { teamId: crypto.randomUUID(), requestId: crypto.randomUUID() }
  saveGoalRequest(session, 'match-a', intention)
  assert.deepEqual(loadGoalRequest(session, 'match-a'), intention)
  assert.deepEqual(loadGoalRequest(session, 'match-a'), intention)
  assert.equal(loadGoalRequest(session, 'match-b'), null)
})
test('confirmación limpia la intención; goles legítimos usan UUID distintos', () => {
  const session = storage()
  const first = { teamId: crypto.randomUUID(), requestId: crypto.randomUUID() }
  saveGoalRequest(session, 'match', first)
  saveGoalRequest(session, 'match', null)
  assert.equal(loadGoalRequest(session, 'match'), null)
  const second = { ...first, requestId: crypto.randomUUID() }
  saveGoalRequest(session, 'match', second)
  assert.notEqual(loadGoalRequest(session, 'match')?.requestId, first.requestId)
})
test('un fallo de persistencia se propaga antes de enviar la solicitud', () => {
  const broken = { setItem: () => { throw Error('Storage unavailable') }, removeItem: () => {} }
  assert.throws(() => saveGoalRequest(broken, 'match', { teamId: 'team', requestId: 'request' }))
})

test('reintento conserva jugador y tipo de evento después de recargar', () => {
  const session = storage()
  for (const eventType of ['GOAL','YELLOW_CARD','RED_CARD','FOUL','TIMEOUT'] as const) {
    const event = { teamId: 'a', playerId: ['GOAL','YELLOW_CARD','RED_CARD'].includes(eventType) ? 'p' : undefined, requestId: crypto.randomUUID(), eventType }
    saveGoalRequest(session, 'm', event)
    assert.deepEqual(loadGoalRequest(session, 'm'), JSON.parse(JSON.stringify(event)))
  }
})
