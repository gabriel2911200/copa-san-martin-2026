import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentPeriod, doubleYellows, playerUnavailable, eventMinute, lineupReady, matchTimeline, teamPeriodStats } from '../src/lib/matchEvents.ts'
import type { MatchEvent } from '../src/lib/matchEvents.ts'

test('faltas y tiempos muertos se separan por equipo y periodo, excluyendo anulados', () => {
  const events: MatchEvent[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: String(i), team_id: 'a', period_number: 1, type: 'FOUL' as const })),
    { id: 'b', team_id: 'b', period_number: 1, type: 'FOUL' },
    { id: 't', team_id: 'a', period_number: 1, type: 'TIMEOUT' },
    { id: 'g', team_id: 'a', period_number: 1, type: 'GOAL' },
    { id: 'c', team_id: 'a', period_number: 1, type: 'YELLOW_CARD' },
    { id: 'v', team_id: 'a', period_number: 1, type: 'FOUL', voided_at: '2026-09-08' },
  ]
  assert.deepEqual(teamPeriodStats(events, 'a', 1), { fouls: 6, timeoutUsed: true })
  assert.deepEqual(teamPeriodStats(events, 'b', 1), { fouls: 1, timeoutUsed: false })
  assert.deepEqual(teamPeriodStats(events, 'a', 2), { fouls: 0, timeoutUsed: false })
  events[0].voided_at = '2026-09-08'
  assert.equal(teamPeriodStats(events, 'a', 1).fouls, 5)
})
test('descanso conserva primer periodo; segundo tiempo y resultado muestran segundo', () => {
  const match = { status: 'DESCANSO' as const, paused_from_status: null, phase_elapsed_seconds: 0, phase_started_at: null }
  assert.equal(currentPeriod(match), 1)
  assert.equal(currentPeriod({ ...match, status: 'SEGUNDO_TIEMPO' }), 2)
  assert.equal(currentPeriod({ ...match, status: 'PAUSADO', paused_from_status: 'SEGUNDO_TIEMPO' }), 2)
  assert.equal(currentPeriod({ ...match, status: 'FINALIZADO' }), 2)
  assert.equal(eventMinute(0), 1)
  assert.equal(eventMinute(480), 8)
  assert.equal(eventMinute(900), 15)
})

test('la convocatoria exige jugadores activos de ambos equipos', () => {
  const home = { id: 'p', team_id: 'a', full_name: 'Juan', active: true, shirt_number: 5 }
  const away = { id: 'q', team_id: 'b', full_name: 'Pedro', active: true, shirt_number: 7 }
  assert.equal(lineupReady([], 'a', 'b'), false)
  assert.equal(lineupReady([home], 'a', 'b'), false)
  assert.equal(lineupReady([home, { ...away, active: false }], 'a', 'b'), false)
  assert.equal(lineupReady([home, away], 'a', 'b'), true)
})

test('doble amarilla cruza periodos, conserva dorsal y se revierte al anular; roja directa se distingue', () => {
  const first: MatchEvent = {id:'one',type:'YELLOW_CARD',player_id:'p',team_id:'a',player_name:'Juan',shirt_number:5,period_number:1}
  const second: MatchEvent = {...first,id:'two',period_number:2}
  const direct: MatchEvent = {...first,id:'red',type:'RED_CARD',player_id:'q',team_id:'b'}
  assert.deepEqual(doubleYellows([first,second,direct]),[second])
  assert.equal(playerUnavailable([first,second],'p'),true)
  assert.equal(playerUnavailable([direct],'q'),true)
  assert.deepEqual(doubleYellows([direct]),[])
  second.voided_at='2026-09-08'
  assert.equal(playerUnavailable([first,second],'p'),false)
  assert.equal(playerUnavailable([],'p'),false)
})

test('cronología unifica goles, ordena periodos y excluye faltas y reversiones sin duplicar',()=>{
  const goal:MatchEvent={id:'g',team_id:'a',clock_seconds:180,period_number:1}
  const red:MatchEvent={id:'r',team_id:'a',type:'RED_CARD',clock_seconds:20,period_number:2}
  const yellow:MatchEvent={id:'y',team_id:'b',type:'YELLOW_CARD',clock_seconds:300,period_number:1}
  assert.deepEqual(matchTimeline([goal],[red,yellow,{...goal,type:'GOAL'},{id:'f',team_id:'a',type:'FOUL'}]).map(e=>e.id),['g','y','r'])
  assert.deepEqual(matchTimeline([goal],[{...goal,type:'GOAL',voided_at:'2026-09-08'}]),[])
  assert.deepEqual(matchTimeline([goal],[{id:'t',team_id:'a',type:'TIMEOUT'}]).map(e=>e.id),['g'])
  assert.deepEqual(matchTimeline([goal],[{id:'t',team_id:'a',type:'TIMEOUT',period_number:2}],true).map(e=>e.id),['g','t'])
})
