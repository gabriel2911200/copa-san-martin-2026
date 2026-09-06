import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableActions, elapsedSeconds, formatClock } from '../src/lib/matchClock.ts'
import type { ClockState } from '../src/lib/matchClock.ts'

const start = Date.parse('2026-09-05T12:00:00Z')
const running: ClockState = { status: 'PRIMER_TIEMPO', paused_from_status: null, phase_elapsed_seconds: 12, phase_started_at: new Date(start).toISOString() }

test('reconstruye el reloj desde datos persistidos después de recarga', () => {
  const reloaded = JSON.parse(JSON.stringify(running))
  assert.equal(elapsedSeconds(reloaded, start + 8300), 20)
  assert.equal(elapsedSeconds(reloaded, start + 50000), 62)
})
test('pausa no avanza aunque transcurran horas; reanudar conserva acumulado', () => {
  const paused: ClockState = { ...running, status: 'PAUSADO', paused_from_status: 'PRIMER_TIEMPO', phase_started_at: null, phase_elapsed_seconds: 20 }
  assert.equal(elapsedSeconds(paused, start + 86400000), 20)
  const resumed: ClockState = { ...paused, status: 'PRIMER_TIEMPO', paused_from_status: null, phase_started_at: new Date(start + 86400000).toISOString() }
  assert.equal(elapsedSeconds(resumed, start + 86407000), 27)
})
test('limita primer tiempo, descanso y segundo tiempo tras cerrar la pestaña', () => {
  for (const [status, limit] of [['PRIMER_TIEMPO', 900], ['DESCANSO', 300], ['SEGUNDO_TIEMPO', 900]] as const) {
    const phase = { ...running, status }
    assert.equal(elapsedSeconds(phase, start + 99999999), limit)
  }
  assert.equal(formatClock(900), '15:00')
  assert.equal(formatClock(300), '05:00')
})
test('acciones de avance solo aparecen al completar cada fase', () => {
  assert.deepEqual(availableActions(running, 899), ['PAUSE'])
  assert.deepEqual(availableActions(running, 900), ['PAUSE', 'BREAK'])
  assert.deepEqual(availableActions({ ...running, status: 'DESCANSO' }, 300), ['PAUSE', 'SECOND_HALF'])
  assert.deepEqual(availableActions({ ...running, status: 'SEGUNDO_TIEMPO' }, 900), ['PAUSE', 'FINISH'])
  assert.deepEqual(availableActions({ ...running, status: 'PAUSADO' }, 20), ['RESUME'])
  assert.deepEqual(availableActions({ ...running, status: 'FINALIZADO' }, 900), [])
  assert.deepEqual(availableActions({ ...running, status: 'PROGRAMADO' }, 0), ['START'])
})
test('inicio futuro no genera segundos negativos y finalizado queda congelado', () => {
  assert.equal(elapsedSeconds(running, start - 10000), 12)
  assert.equal(elapsedSeconds({ ...running, status: 'FINALIZADO', phase_elapsed_seconds: 900, phase_started_at: null }, start + 999999), 900)
})
