// Only the disposable local cluster created for validation 033 is accepted.
// Usage: node tests/postgres-final-validation.mjs <path-to-psql.exe> <port>
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [binary, port] = process.argv.slice(2)
assert(binary && /^\d+$/.test(port), 'Provide psql binary and local port')
let database = 'postgres'
function sql(source, application = 'copa033') {
  return new Promise((done, fail) => {
    const child = execFile(resolve(binary), ['-X', '-w', '-h', '127.0.0.1', '-p', port,
      '-U', 'postgres', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
    { env: { ...process.env, PGAPPNAME: application }, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) fail(Object.assign(error, { detail: stderr }))
      else done(stdout.trim())
    })
    child.stdin.end(source)
  })
}
const dataDirectory = await sql('show data_directory;')
assert.equal(resolve(dataDirectory).toLowerCase(), resolve('.tools/pg033-cluster').toLowerCase())
if (process.argv.includes('--verify-persistence')) {
  const evidence = JSON.parse(await readFile('.tools/033-native-validation.json','utf8'))
  assert.match(evidence.database,/^copa033_\d+$/)
  database = evidence.database
  assert.equal(await sql(`select count(*) from public.match_events where match_id='${evidence.matchId}' and type='GOAL';`),'1')
  assert.equal(await sql(`select count(*) from public.match_players where match_id='${evidence.matchId}';`),'3')
  assert.equal(await sql(`select count(*) from public.penalty_shootout_attempts where match_id='${evidence.friendlyId}';`),'1')
  assert.equal(await sql(`select status from public.matches where id='${evidence.matchId}';`),'FINALIZADO')
  evidence.persistenceAfterRestart = true
  await writeFile('.tools/033-native-validation.json',JSON.stringify(evidence,null,2))
  console.log('PASS PostgreSQL persistence after server restart: goal, three jerseys, finalized match and unique penalty retained')
  process.exit(0)
}
const freshDatabase = `copa033_${Date.now()}`
await sql(`create database ${freshDatabase};`)
database = freshDatabase
await sql("do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;")
await sql(await readFile('supabase/schema.sql', 'utf8'))
const files = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
async function snapshot() {
  const result = {}
  for (const table of ['matches','match_events','players','match_players','penalty_shootouts','penalty_shootout_attempts','teams','categories','matchdays']) {
    result[table] = await sql(`select coalesce(jsonb_agg(j order by j::text),'[]') from
      (select to_jsonb(t)-array['friendly_penalties','initial_attempts'] j from public.${table} t) s;`)
  }
  return result
}
let history
for (const file of files) {
  if (file.startsWith('030_')) {
    await sql(`do $$ declare c uuid; h uuid; a uuid; m uuid; p uuid; q uuid;
    begin
      insert into public.categories(name) values('__033_history') returning id into c;
      insert into public.teams(category_id,name) values(c,'Home') returning id into h;
      insert into public.teams(category_id,name) values(c,'Away') returning id into a;
      insert into public.players(team_id,full_name) values(h,'Historical P') returning id into p;
      insert into public.players(team_id,full_name) values(a,'Historical Q') returning id into q;
      insert into public.matches(category_id,matchday_id,home_team_id,away_team_id)
        select c,id,h,a from public.matchdays where number=1 returning id into m;
      perform public.save_match_precheck(m,true,true,true,true,(select updated_at from public.matches where id=m));
      perform public.set_match_player(m,p,10,true,(select updated_at from public.matches where id=m));
      perform public.set_match_player(m,q,11,true,(select updated_at from public.matches where id=m));
      perform public.control_match(m,'START',(select updated_at from public.matches where id=m));
      perform public.record_match_event(m,h,'GOAL',p,gen_random_uuid());
      perform public.control_match(m,'BREAK',(select updated_at from public.matches where id=m));
      perform public.control_match(m,'SECOND_HALF',(select updated_at from public.matches where id=m));
      perform public.control_match(m,'FINISH',(select updated_at from public.matches where id=m));
    end $$;`)
    history = await snapshot()
  }
  await sql(await readFile(`supabase/migrations/${file}`, 'utf8'))
  if (/^03[01]_/.test(file)) assert.deepEqual(await snapshot(), history)
}
console.log('OK PostgreSQL: migrations 001-031, historical fixture unchanged through 030 and 031')
for (const file of ['030_flexible_matches.sql','030_three_penalties.sql','030_reopen_playoffs.sql','031_audit_integrity.sql']) {
  await sql(await readFile(`supabase/tests/${file}`, 'utf8'))
  console.log(`OK PostgreSQL: ${file}`)
}
const fixture = JSON.parse(await sql(`with c as (
  insert into public.categories(name) values('__033_race') returning id
), h as (insert into public.teams(category_id,name) select id,'H' from c returning id,category_id),
a as (insert into public.teams(category_id,name) select id,'A' from c returning id),
p as (insert into public.players(team_id,full_name) select id,'P' from h returning id),
q as (insert into public.players(team_id,full_name) select id,'Q' from h returning id),
m as (insert into public.matches(category_id,matchday_id,home_team_id,away_team_id)
select h.category_id,(select id from public.matchdays where number=1),h.id,a.id from h,a returning id,updated_at)
select jsonb_build_object('id',m.id,'version',m.updated_at,'p',p.id,'q',q.id,'h',h.id,'a',a.id) from m,p,q,h,a;`))
let race = 0
async function waitFor(condition) {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    if (await sql(condition) === 't') return
    await new Promise(done => setTimeout(done, 40))
  }
  throw Error('Expected independent backend state was not observed')
}
async function concurrent(first, second, rejection) {
  const name = `copa033_race${++race}`
  // Attach handlers immediately, keeping both requests in flight independently.
  const left = sql(`begin; ${first}; select pg_sleep(3); commit;`, `${name}_left`)
    .then(value => ({ok:true,value}), error => ({ok:false,error}))
  await waitFor(`select exists(select 1 from pg_stat_activity where application_name='${name}_left' and wait_event='PgSleep');`)
  const right = sql(second, `${name}_right`).then(value => ({ok:true,value}), error => ({ok:false,error}))
  await waitFor(`select exists(select 1 from pg_stat_activity where application_name='${name}_right' and wait_event_type='Lock');`)
  const results = await Promise.all([left,right])
  assert(results[0].ok, results[0].error?.detail)
  assert.equal(results[1].ok, !rejection, results[1].error?.detail)
  if (rejection) assert.match(results[1].error.detail, /P0001/)
  console.log(`OK PostgreSQL race ${race}: independent backends, lock wait, ${rejection ? 'controlled stale revision' : 'idempotent retry'}`)
}
const call = player => `set role anon; select public.set_match_player('${fixture.id}','${player}',8,true,'${fixture.version}')`
await concurrent(call(fixture.p),call(fixture.q),true)
assert.equal(await sql(`select count(*) from public.match_players where match_id='${fixture.id}' and shirt_number=8;`),'1')
await assert.rejects(sql(`insert into public.match_players(match_id,player_id,team_id,shirt_number) values('${fixture.id}','${fixture.q}','${fixture.h}',8);`), error => /23505/.test(error.detail))
await sql(`select public.set_match_player('${fixture.id}','${fixture.q}',9,true,(select updated_at from public.matches where id='${fixture.id}'));`)
await sql(`insert into public.players(team_id,full_name) values('${fixture.a}','Opponent');
select public.set_match_player('${fixture.id}',(select id from public.players where team_id='${fixture.a}'),1,true,(select updated_at from public.matches where id='${fixture.id}'));`)
await sql(`select public.save_match_precheck('${fixture.id}',true,true,true,true,(select updated_at from public.matches where id='${fixture.id}'));`)
const version = await sql(`select updated_at from public.matches where id='${fixture.id}';`)
const start = `set role anon; select public.control_match('${fixture.id}','START','${version}')`
await concurrent(start,start,true)
const request = '33000000-0000-4000-8000-000000000001'
const goal = `set role anon; select public.record_match_event('${fixture.id}','${fixture.h}','GOAL','${fixture.p}','${request}')`
await concurrent(goal,goal,false)
assert.equal(await sql(`select count(*) from public.match_events where match_id='${fixture.id}' and type='GOAL';`),'1')
assert.equal(await sql(`select public.get_match_control('${fixture.id}')->'score'->>'home';`),'1')
for (const action of ['BREAK','SECOND_HALF','FINISH']) {
  await sql(`select public.control_match('${fixture.id}','${action}',(select updated_at from public.matches where id='${fixture.id}'));`)
}
const friendly = JSON.parse(await sql(`select public.create_friendly((select category_id from public.matches where id='${fixture.id}'),'${fixture.h}','${fixture.a}',null,null,900,true,gen_random_uuid());`))
const mid = friendly.match.id
await sql(`update public.matches set status='PAUSADO',paused_from_status='SEGUNDO_TIEMPO',phase_elapsed_seconds=900 where id='${mid}';
select public.open_penalty_shootout('${mid}',gen_random_uuid(),(select updated_at from public.matches where id='${mid}'));`)
const penaltyRequest = '33000000-0000-4000-8000-000000000002'
const penalty = `set role anon; select public.manage_penalty_shootout('${mid}','RECORD','${fixture.h}',null,true,'${penaltyRequest}',0)`
await concurrent(penalty,penalty,false)
assert.equal(await sql(`select count(*) from public.penalty_shootout_attempts where match_id='${mid}';`),'1')
assert.equal(await sql(`select revision from public.penalty_shootouts where match_id='${mid}';`),'1')
await writeFile('.tools/033-native-validation.json', JSON.stringify({ postgres:await sql('select version();'), database, matchId:fixture.id, friendlyId:mid, migrations:files, nativeSqlSuites:4, concurrentScenarios:race, historicalFixturePreserved:true },null,2))
console.log('PASS PostgreSQL final validation; new psql sessions read persisted lineup, clock and unique goal')
