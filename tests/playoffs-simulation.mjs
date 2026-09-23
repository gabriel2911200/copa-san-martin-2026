// Solo PostgreSQL embebido en memoria. Sin URL, Supabase SDK ni lectura de .env.
// Ejecutar desde la raíz: node tests/playoffs-simulation.mjs
import { PGlite } from '../.tmp-sql-check/node_modules/@electric-sql/pglite/dist/index.js'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { podium } from '../src/lib/tournament.ts'

const db = new PGlite()
const evidence = { environment: 'PGlite in-memory; no remote connection', rejections: [], results: [] }
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
const rpc = async (name, params = []) => (await rows(`select public.${name}(${params.map((_, i) => '$' + (i + 1)).join(',')}) as data`, params))[0].data
const version = async id => (await rows('select updated_at::text as v from matches where id=$1', [id]))[0].v
const action = async (id, name) => rpc('control_match', [id, name, await version(id)])
async function rejects(label, fn) {
  let error
  try { await fn() } catch (e) { error = e }
  assert.ok(error, label)
  assert.equal(error.code, 'P0001', `${label}: expected business-rule rejection`)
  evidence.rejections.push({ label, message: error.message })
}
const players = new Map()
async function createMatch(category, home, away, day = 4) {
  return (await rows(`insert into matches(category_id,home_team_id,away_team_id,matchday_id)
    values($1,$2,$3,(select id from matchdays where number=$4)) returning id`, [category, home, away, day]))[0].id
}
async function play(id, homeGoals, awayGoals, penaltyWinner = null) {
  const m = (await rows('select * from matches where id=$1', [id]))[0]
  await rpc('save_match_precheck', [id, true, true, true, true, await version(id)])
  for (const team of [m.home_team_id, m.away_team_id]) {
    await rpc('set_match_player', [id, players.get(team), 10, true, await version(id)])
  }
  await action(id, 'START')
  for (const [team, count] of [[m.home_team_id, homeGoals], [m.away_team_id, awayGoals]]) {
    for (let i = 0; i < count; i++) await rpc('record_match_event', [id, team, 'GOAL', players.get(team), randomUUID()])
  }
  await action(id, 'BREAK')
  await action(id, 'SECOND_HALF')
  // Avance del reloj exclusivamente en el fixture efímero; no esperar 15 minutos reales.
  await db.exec('reset role')
  await db.query("update matches set phase_started_at=clock_timestamp()-interval '901 seconds' where id=$1", [id])
  await db.exec('set role anon')
  if (penaltyWinner) {
    await rejects('Empate eliminatorio no finaliza sin ganador', () => action(id, 'FINISH'))
    const eventsBefore = await rows('select * from match_events where match_id=$1 order by id', [id])
    const scorersBefore = await rows('select * from get_top_scorers($1)', [m.category_id])
    const standingsBefore = await rows('select * from get_standings($1,false)', [m.category_id])
    const startRequest = randomUUID()
    await rpc('open_penalty_shootout', [id, startRequest, await version(id)])
    await rpc('open_penalty_shootout', [id, startRequest, '2000-01-01'])
    let current = await rpc('get_match_control', [id])
    assert.equal(current.match.status, 'PAUSADO')
    assert.equal(current.shootout.first_team_id, null)
    assert.equal(current.shootout.next_team_id, null)
    await rejects('No reanuda reloj durante tanda', () => action(id, 'RESUME'))
    await rejects('No permite ganador manual con tanda', () => rpc('set_penalty_winner', [id, penaltyWinner]))
    await rejects('No W.O. con tanda', async () => rpc('record_walkover', [id, m.home_team_id, randomUUID(), await version(id)]))
    async function operation(kind, converted = null, attempt = null, team = null, request = randomUUID(), revision = current.shootout.revision) {
      current = await rpc('manage_penalty_shootout', [id, kind, team, attempt, converted, request, revision])
      return current
    }
    await rejects('No cierra tanda vacía', () => operation('FINISH'))
    await rejects('No registra equipo ajeno', () => operation('RECORD', true, null, randomUUID()))
    await rejects('Primer tiro inválido no fija equipo inicial', () => operation('RECORD', null, null, m.home_team_id))
    assert.equal((await rpc('get_match_control', [id])).shootout.first_team_id, null)
    const rounds = m.stage === 'FINAL' ? 8 : 3
    for (let round = 0; round < rounds; round++) {
      for (const team of (m.stage === 'FINAL' ? [m.away_team_id, m.home_team_id] : [m.home_team_id, m.away_team_id])) {
        const converted = m.stage === 'FINAL' ? (round < 5 || round === 6 || (round === 7 && team === penaltyWinner)) : team === penaltyWinner
        const request = randomUUID(), revision = current.shootout.revision
        await operation('RECORD', converted, null, team, request, revision)
        const count = current.shootout.attempts.length
        assert.equal(current.shootout.first_team_id, m.stage === 'FINAL' ? m.away_team_id : m.home_team_id)
        if (!current.shootout.completed_at) await rejects('No permite dos tiros seguidos del mismo equipo', () => operation('RECORD', true, null, team))
        await operation('RECORD', converted, null, team, request, revision)
        assert.equal(current.shootout.attempts.length, count)
        await rejects('Request no admite payload diferente', () => operation('RECORD', !converted, null, team, request, revision))
        await rejects('Revisión obsoleta no registra doble toque', () => operation('RECORD', true, null, current.shootout.next_team_id, randomUUID(), revision))
        if (m.stage === 'FINAL' && count === 15) assert.equal(current.shootout.completed_at, null, 'Aún falta el otro tiro de la ronda adicional')
      }
      if (round === 0) {
        const first = current.shootout.attempts[0]
        await rejects('No anula lanzamiento antiguo', () => operation('VOID', null, first.id))
        await operation('CORRECT', !first.converted, first.id)
        await operation('CORRECT', first.converted, first.id)
        const last = current.shootout.attempts.at(-1)
        await operation('VOID', null, last.id)
        assert.equal(current.shootout.next_team_id, last.team_id)
        await operation('RECORD', last.converted, null, last.team_id)
      }
      if (round < rounds - 1) await rejects('No permite finalizar antes de definición matemática', () => operation('FINISH'))
    }
    assert.equal((await rows('select count(*) n from penalty_shootout_attempts where match_id=$1 and voided_at is not null', [id]))[0].n, 1)
    assert.deepEqual(await rows('select * from match_events where match_id=$1 order by id', [id]), eventsBefore)
    assert.deepEqual(await rows('select * from get_top_scorers($1)', [m.category_id]), scorersBefore)
    assert.deepEqual(await rows('select * from get_standings($1,false)', [m.category_id]), standingsBefore)
    assert.equal(current.match.status, 'FINALIZADO', 'Cierre automático en el tiro decisivo')
    assert.equal(current.match.tiebreak_winner_team_id, penaltyWinner)
    assert.deepEqual(current.shootout.score, m.stage === 'FINAL' ? {home: 7, away: 6} : {home: 0, away: 3})
    await rejects('No permite tiros innecesarios', () => operation('RECORD', true, null, m.home_team_id))
    const winnerKick = current.shootout.attempts.find(k => k.team_id === penaltyWinner && k.converted)
    await rejects('Corrección finalizada no reabre ni cambia ganador', () => operation('CORRECT', false, winnerKick.id))
    await operation('CORRECT', true, winnerKick.id)
  } else await action(id, 'FINISH')
  const result = await rpc('match_outcome', [id])
  assert.equal(result.match.status, 'FINALIZADO')
  assert.deepEqual(result.score, { home: homeGoals, away: awayGoals })
  if (m.stage !== 'REGULAR') {
    const winner = penaltyWinner ?? (homeGoals > awayGoals ? m.home_team_id : m.away_team_id)
    assert.equal(result.winner_team_id, winner)
    assert.equal(result.loser_team_id, winner === m.home_team_id ? m.away_team_id : m.home_team_id)
    assert.equal(result.resolved, true)
    evidence.results.push({ phase: 'finished', snapshot: result })
  }
  return result
}
try {
  await db.exec('create role anon; create role authenticated;')
  await db.exec(await readFile('supabase/schema.sql', 'utf8'))
  evidence.migrations = (await readdir('supabase/migrations')).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()
  assert.ok(evidence.migrations.at(-1).startsWith('027_'), 'Review this simulation before loading future migrations')
  for (const file of evidence.migrations) await db.exec(await readFile('supabase/migrations/' + file, 'utf8'))
  const women = (await rows("insert into categories(name) values('MUJERES') returning id"))[0].id
  const men = (await rows("insert into categories(name) values('VARONES') returning id"))[0].id
  const teams = []
  for (const [index, letter] of [...'ABCDE'].entries()) {
    const id = `10000000-0000-4000-8000-00000000000${index + 1}`
    await db.query('insert into teams(id,category_id,name) values($1,$2,$3)', [id, women, 'Equipo ' + letter])
    teams.push(id)
  }
  const maleTeams = []
  for (const name of ['Varón X', 'Varón Y']) maleTeams.push((await rows('insert into teams(category_id,name) values($1,$2) returning id', [men, name]))[0].id)
  for (const team of [...teams, ...maleTeams]) players.set(team, (await rows("insert into players(team_id,full_name) values($1,'Persona ficticia') returning id", [team]))[0].id)
  await db.exec('set role anon')
  const pendingMen = await createMatch(men, ...maleTeams)
  const menFixtures = [pendingMen]
  for (const day of [1,2]) for (const pair of [maleTeams, [...maleTeams].reverse()]) menFixtures.push(await createMatch(men, pair[0], pair[1], day))
  assert.equal(menFixtures.length, 5)
  for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) {
    await play(await createMatch(women, teams[i], teams[j], 1 + ((i + j) % 3)), 1, 0)
  }
  const standings = await rows('select * from get_standings($1,false)', [women])
  assert.deepEqual(standings.map(t => t.team_id), teams)
  assert.deepEqual(standings.map(t => t.pts), [12, 9, 6, 3, 0])
  evidence.regularStandings = standings
  const menBefore = await rows('select * from categories where id=$1', [men])
  const menMatchesBefore = await rows('select * from matches where category_id=$1 order by id', [men])
  await rpc('close_regular', [women])
  const closed = (await rows('select * from categories where id=$1', [women]))[0]
  assert.ok(closed.regular_closed_at)
  assert.deepEqual(closed.qualified_team_ids, teams.slice(0, 4))
  evidence.qualified_team_ids = closed.qualified_team_ids
  await rpc('close_regular', [women])
  assert.deepEqual((await rows('select * from categories where id=$1', [women]))[0], closed)
  assert.deepEqual(await rows('select * from categories where id=$1', [men]), menBefore)
  assert.deepEqual(await rows('select * from matches where category_id=$1 order by id', [men]), menMatchesBefore)
  assert.equal(menBefore[0].regular_closed_at, null)
  assert.equal(menBefore[0].qualified_team_ids, null)
  await rejects('Varones pendiente no puede cerrar', () => rpc('close_regular', [men]))
  await play(menFixtures[1], 1, 1)
  assert.equal((await rows('select count(*) n from matches where category_id=$1 and status=$2', [men, 'PROGRAMADO']))[0].n, 4)
  const maleTable = await rows('select * from get_standings($1,false)', [men])
  assert.ok(maleTable.every(t => t.pts === 1 && t.gf === 1 && t.gc === 1))
  assert.equal((await rows('select status from matches where id=$1', [pendingMen]))[0].status, 'PROGRAMADO')
  await rejects('Varones abierto no puede crear semifinales', () => rpc('create_semifinals', [men, ...teams.slice(0, 4)]))
  await rejects('No admite equipo no clasificado', () => rpc('create_semifinals', [women, teams[0], teams[4], teams[1], teams[2]]))
  const [a, b, c, d] = teams
  await rpc('create_semifinals', [women, a, d, b, c])
  await rpc('create_semifinals', [women, a, d, b, c])
  const semis = await rows("select * from matches where category_id=$1 and stage='SEMIFINAL' order by created_at,id", [women])
  assert.equal(semis.length, 2)
  assert.deepEqual(semis.map(m => [m.home_team_id, m.away_team_id]), [[a, d], [b, c]])
  await rejects('Jornada final exige semifinales resueltas', () => rpc('generate_day6', [women]))
  await play(semis[0].id, 2, 1)
  await play(semis[1].id, 1, 1, c)
  assert.equal((await rows("select count(*) n from matches where category_id=$1 and stage in ('FINAL','THIRD_PLACE')", [women]))[0].n, 2, 'Final y tercer puesto ya existen sin llamar generate_day6')
  await rpc('generate_day6', [women])
  await rpc('generate_day6', [women])
  let tournament = await rpc('get_tournament')
  const finals = tournament.matches.filter(m => m.match.category_id === women && ['FINAL', 'THIRD_PLACE'].includes(m.match.stage))
  assert.equal(finals.length, 2)
  const final = finals.find(m => m.match.stage === 'FINAL')
  const third = finals.find(m => m.match.stage === 'THIRD_PLACE')
  assert.deepEqual([final.match.home_team_id, final.match.away_team_id], [a, c])
  assert.deepEqual([third.match.home_team_id, third.match.away_team_id], [d, b])
  assert.ok(finals.every(m => m.matchday === 6))
  assert.ok(tournament.matches.filter(m => semis.some(s => s.id === m.match.id)).every(m => m.matchday === 5))
  assert.equal(podium(tournament.matches, women), null)
  for (const m of finals) {
    await rpc('reschedule_match', [m.match.id, '2026-09-27', '15:00', await version(m.match.id)])
  }
  await play(final.match.id, 2, 2, a)
  await play(third.match.id, 3, 1)
  tournament = await rpc('get_tournament')
  assert.deepEqual(podium(tournament.matches, women), ['Equipo A', 'Equipo C', 'Equipo D', 'Equipo B'])
  assert.deepEqual(await rows('select * from get_standings($1,false)', [women]), standings)
  assert.deepEqual((await rows('select qualified_team_ids from categories where id=$1', [women]))[0].qualified_team_ids, teams.slice(0, 4))
  assert.deepEqual(await rows('select * from categories where id=$1', [men]), menBefore)
  const scorers = await rows('select * from get_top_scorers($1)', [women])
  assert.equal(scorers.reduce((total, p) => total + Number(p.goals), 0), 23)
  for (const [team, goals] of [[a, 8], [b, 5], [c, 5], [d, 5]]) assert.equal(Number(scorers.find(p => p.player_id === players.get(team)).goals), goals)
  for (const result of evidence.results.filter(r => r.phase === 'finished')) {
    const publicResult = tournament.matches.find(m => m.match.id === result.snapshot.match.id)
    for (const key of ['score', 'winner_team_id', 'loser_team_id', 'resolved']) assert.deepEqual(publicResult[key], result.snapshot[key])
    assert.equal(publicResult.match.walkover_loser_team_id, null)
  }
  evidence.podium = podium(tournament.matches, women)
  evidence.scorers = scorers
  evidence.menAfter = menBefore[0]
  evidence.tournament = tournament
  await mkdir('test-results', { recursive: true })
  await writeFile('test-results/playoffs-simulation.json', JSON.stringify(evidence, null, 2) + '\n')
  console.log('PASS: regular, category isolation, frozen qualifiers, manual semifinals, tied finish rejection, penalty winners, final, third place, podium, scorers, unchanged standings; migrations 001–027.')
  console.log(JSON.stringify({ qualified: evidence.qualified_team_ids, podium: evidence.podium, rejectedInvalidActions: evidence.rejections.length }, null, 2))
} catch (error) {
  console.error('FAIL', error.message, error.code ?? '', error.query ?? '')
  process.exitCode = 1
} finally {
  await db.close()
}
