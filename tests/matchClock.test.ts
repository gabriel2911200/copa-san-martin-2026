import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableActions, clockAt, elapsedSeconds, formatClock, isPhaseEnding, timeoutSeconds } from '../src/lib/matchClock.ts'
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
test('acciones permiten cortar cada fase y conservan restricciones de estado', () => {
  assert.deepEqual(availableActions(running), ['PAUSE', 'BREAK'])
  assert.deepEqual(availableActions({ ...running, status: 'DESCANSO' }), ['PAUSE', 'SECOND_HALF'])
  assert.deepEqual(availableActions({ ...running, status: 'SEGUNDO_TIEMPO' }), ['PAUSE', 'FINISH'])
  assert.deepEqual(availableActions({ ...running, status: 'PAUSADO' }), ['RESUME'])
  assert.deepEqual(availableActions({ ...running, status: 'FINALIZADO' }), [])
  assert.deepEqual(availableActions({ ...running, status: 'PROGRAMADO' }), ['START'])
})
test('inicio futuro no genera segundos negativos y finalizado queda congelado', () => {
  assert.equal(elapsedSeconds(running, start - 10000), 12)
  assert.equal(elapsedSeconds({ ...running, status: 'FINALIZADO', phase_elapsed_seconds: 900, phase_started_at: null }, start + 999999), 900)
})

test('aviso en los últimos 30 segundos de cada fase, nunca pausado ni finalizado', () => {
  for (const status of ['PRIMER_TIEMPO', 'DESCANSO', 'SEGUNDO_TIEMPO'] as const) {
    const match = { ...running, status }
    const limit = status === 'DESCANSO' ? 300 : 900
    assert.equal(isPhaseEnding(match, limit - 31), false)
    assert.equal(isPhaseEnding(match, limit - 30), true)
    assert.equal(isPhaseEnding(match, limit - 1), true)
    assert.equal(isPhaseEnding(match, limit), false)
    assert.equal(isPhaseEnding({ ...match, status: 'PAUSADO', paused_from_status: status }, limit - 20), false)
  }
  assert.equal(isPhaseEnding({ ...running, status: 'FINALIZADO' }, 880), false)
  assert.equal(isPhaseEnding({ ...running, status: 'PROGRAMADO' }, 880), false)
})

test('tiempo muerto congela el partido y vence exactamente a los 60 segundos en ambos tiempos', () => {
  for (const phase of ['PRIMER_TIEMPO', 'SEGUNDO_TIEMPO'] as const) {
    const match: ClockState = { status: 'TIEMPO_MUERTO', paused_from_status: phase,
      phase_elapsed_seconds: 515, phase_started_at: null, timeout_started_at: new Date(start).toISOString(), timeout_team_id: 'a' }
    assert.equal(elapsedSeconds(match, start + 25000), 515)
    assert.equal(elapsedSeconds(match, start + 59999), 515)
    assert.equal(timeoutSeconds(match, start + 25000), 25)
    assert.equal(timeoutSeconds(match, start + 999999), 60)
    assert.equal(clockAt(match, start + 59999).status, 'TIEMPO_MUERTO')
    assert.equal(clockAt(match, start + 60000).status, phase)
    assert.equal(elapsedSeconds(match, start + 60000), 515)
    assert.equal(elapsedSeconds(match, start + 61000), 516)
    assert.equal(elapsedSeconds(JSON.parse(JSON.stringify(match)), start + 90000), 545)
    assert.equal(elapsedSeconds(match, start + 999999), 900)
    assert.deepEqual(availableActions(match), ['END_TIMEOUT'])
    assert.equal(isPhaseEnding(match, 880), false)
  }
})

test('finalizar manualmente conserva el acumulado y reanuda desde la nueva marca de servidor', () => {
  const resumed: ClockState = { status: 'SEGUNDO_TIEMPO', paused_from_status: null,
    phase_elapsed_seconds: 515, phase_started_at: new Date(start + 25000).toISOString(), timeout_started_at: null }
  assert.equal(elapsedSeconds(resumed, start + 25000), 515)
  assert.equal(elapsedSeconds(resumed, start + 26000), 516)
})
