// PostgreSQL embebido y efímero: nunca se conecta al proyecto Supabase.
// node tests/run-sql.mjs <ruta al dist/index.js de @electric-sql/pglite>
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

if (!process.argv[2]) throw Error('Indica la ruta al módulo de PGlite instalado para pruebas.')
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href)
const db = new PGlite()
const sql = path => readFile(path, 'utf8')
async function run(path) {
  await db.exec(await sql(path))
  console.log('OK', path)
}
try {
  await db.exec('create role anon; create role authenticated;')
  await run('supabase/schema.sql')
  for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    let before
    let beforeLineups
    let beforeTimeouts
    let beforeCards
    let beforeManagement
    let beforeReversal
    let beforeInitial
    const timeoutSnapshot = async () => (await db.query(`select jsonb_build_object(
      'matches',(select jsonb_agg(to_jsonb(m)-array['timeout_started_at','timeout_team_id'] order by id) from public.matches m),
      'events',(select jsonb_agg(to_jsonb(e) order by id) from public.match_events e),
      'players',(select jsonb_agg(to_jsonb(p) order by id) from public.players p),
      'lineups',(select jsonb_agg(to_jsonb(p) order by match_id,player_id) from public.match_players p)
    ) data`)).rows[0].data
    const lineupSnapshot = async () => (await db.query(`select jsonb_build_object(
      'players',(select jsonb_agg(to_jsonb(p)-'shirt_number' order by id) from public.players p),
      'events',(select jsonb_agg(to_jsonb(e) order by id) from public.match_events e),
      'matches',(select jsonb_agg(to_jsonb(m) order by id) from public.matches m)
    ) data`)).rows[0].data
    const snapshot = async () => (await db.query(`select jsonb_build_object(
      'matches',(select jsonb_agg(to_jsonb(m) order by id) from public.matches m),
      'events',(select jsonb_agg(to_jsonb(e)-array['player_id','player_name','shirt_number'] order by id) from public.match_events e),
      'teams',(select jsonb_agg(to_jsonb(t) order by id) from public.teams t),
      'categories',(select jsonb_agg(to_jsonb(c) order by id) from public.categories c),
      'matchdays',(select jsonb_agg(to_jsonb(d) order by id) from public.matchdays d)
    ) data`)).rows[0].data
    if (file.startsWith('013_')) {
      // Partido y goles anteriores a la ampliación, incluido un gol anulado.
      await db.exec(`do $$ declare c uuid; h uuid; a uuid; d uuid; mid uuid; j jsonb;
      begin
        insert into public.categories(name) values('__migration_preservation') returning id into c;
        insert into public.teams(category_id,name) values(c,'Legacy home') returning id into h;
        insert into public.teams(category_id,name) values(c,'Legacy away') returning id into a;
        select id into d from public.matchdays where number=1;
        insert into public.matches(category_id,matchday_id,home_team_id,away_team_id) values(c,d,h,a) returning id into mid;
        perform public.control_match(mid,'START',(select updated_at from public.matches where id=mid));
        perform public.record_goal(mid,h,gen_random_uuid());
        j:=public.record_goal(mid,a,gen_random_uuid());
        perform public.void_goal(mid,(j->'event'->>'id')::uuid);
        perform public.control_match(mid,'BREAK',(select updated_at from public.matches where id=mid));
        perform public.control_match(mid,'SECOND_HALF',(select updated_at from public.matches where id=mid));
        perform public.control_match(mid,'FINISH',(select updated_at from public.matches where id=mid));
        insert into public.matches(category_id,matchday_id,home_team_id,away_team_id) values(c,d,a,h) returning id into mid;
        perform public.control_match(mid,'START',(select updated_at from public.matches where id=mid));
        perform public.record_goal(mid,a,gen_random_uuid());
      end $$;`)
      before = await snapshot()
    }
    if (file.startsWith('014_')) {
      await db.exec(`do $$ declare c uuid; h uuid; a uuid; d uuid; mid uuid; p uuid; q uuid;
      begin
        insert into public.categories(name) values('__lineup_preservation') returning id into c;
        insert into public.teams(category_id,name) values(c,'Before lineup home') returning id into h;
        insert into public.teams(category_id,name) values(c,'Before lineup away') returning id into a;
        insert into public.players(team_id,full_name,shirt_number) values(h,'Existing player',5) returning id into p;
        insert into public.players(team_id,full_name,shirt_number) values(a,'Existing opponent',7) returning id into q;
        select id into d from public.matchdays where number=1;
        insert into public.matches(category_id,matchday_id,home_team_id,away_team_id) values(c,d,h,a) returning id into mid;
        perform public.control_match(mid,'START',(select updated_at from public.matches where id=mid));
        perform public.record_match_event(mid,h,'GOAL',p,gen_random_uuid());
        perform public.record_match_event(mid,h,'YELLOW_CARD',p,gen_random_uuid());
        update public.players set shirt_number=10 where id=p;
      end $$;`)
      beforeLineups = await lineupSnapshot()
    }
    if (file.startsWith('015_')) {
      await db.exec(`do $$ declare c uuid; h uuid; a uuid; d uuid; mid uuid; p uuid; q uuid;
      begin
        select id into strict c from public.categories where name='__lineup_preservation';
        select id into strict h from public.teams where category_id=c and name='Before lineup home';
        select id into strict a from public.teams where category_id=c and name='Before lineup away';
        select id into strict p from public.players where team_id=h;
        select id into strict q from public.players where team_id=a;
        select id into strict d from public.matchdays where number=2;
        insert into public.matches(category_id,matchday_id,home_team_id,away_team_id) values(c,d,h,a) returning id into mid;
        perform public.set_match_player(mid,p,10,true,(select updated_at from public.matches where id=mid));
        perform public.set_match_player(mid,q,7,true,(select updated_at from public.matches where id=mid));
        perform public.control_match(mid,'START',(select updated_at from public.matches where id=mid));
        perform public.record_match_event(mid,h,'TIMEOUT',null,gen_random_uuid());
      end $$;`)
      beforeTimeouts = await timeoutSnapshot()
    }
    if (file.startsWith('016_')) beforeCards = [await snapshot(), await timeoutSnapshot()]
    if (file.startsWith('017_')) {
      await run('supabase/tests/015_live_timeouts.sql')
      await run('supabase/tests/016_red_cards.sql')
      // Simula un encuentro ya en curso con faltas históricas antes de 017.
      await db.exec(`do $$ declare c uuid; h uuid; a uuid; d uuid; mid uuid; p uuid; q uuid;
      begin
        insert into public.categories(name) values('__foul_preservation') returning id into c;
        insert into public.teams(category_id,name) values(c,'Foul legacy home') returning id into h;
        insert into public.teams(category_id,name) values(c,'Foul legacy away') returning id into a;
        insert into public.players(team_id,full_name) values(h,'Legacy local') returning id into p;
        insert into public.players(team_id,full_name) values(a,'Legacy visitante') returning id into q;
        select id into strict d from public.matchdays where number=1;
        insert into public.matches(category_id,matchday_id,home_team_id,away_team_id) values(c,d,h,a) returning id into mid;
        perform public.set_match_player(mid,p,5,true,(select updated_at from public.matches where id=mid));
        perform public.set_match_player(mid,q,10,true,(select updated_at from public.matches where id=mid));
        perform public.control_match(mid,'START',(select updated_at from public.matches where id=mid));
        perform public.record_match_event(mid,h,'FOUL',null,gen_random_uuid());
      end $$;`)
      beforeManagement = [await snapshot(), await timeoutSnapshot()]
    }
    if (file.startsWith('018_')) beforeReversal = [await snapshot(), await timeoutSnapshot()]
    if (file.startsWith('019_')) beforeInitial = [await snapshot(), await timeoutSnapshot()]
    await run(`supabase/migrations/${file}`)
    if (beforeInitial) {
      assert.deepEqual([await snapshot(), await timeoutSnapshot()], beforeInitial, '019 no modifica datos existentes')
      console.log('OK 019: datos existentes intactos')
    }
    if (beforeReversal) {
      assert.deepEqual([await snapshot(), await timeoutSnapshot()], beforeReversal, '018 no modifica datos existentes')
      console.log('OK 018: datos existentes intactos')
    }
    if (beforeCards) {
      assert.deepEqual([await snapshot(), await timeoutSnapshot()], beforeCards, '016 conserva todas las filas históricas')
      console.log('OK 016: datos existentes intactos')
    }
    if (beforeManagement) {
      assert.deepEqual([await snapshot(), await timeoutSnapshot()], beforeManagement, '017 conserva partidos y eventos históricos íntegros')
      console.log('OK 017: datos existentes intactos')
      await db.exec(`do $$ declare mid uuid; h uuid; previous jsonb; rid uuid;
      begin
        select m.id,m.home_team_id into strict mid,h from public.matches m join public.categories c on c.id=m.category_id where c.name='__foul_preservation';
        select to_jsonb(e),request_id into strict previous,rid from public.match_events e where match_id=mid;
        perform public.record_match_event(mid,h,'FOUL',null,rid);
        assert not exists(select 1 from public.match_foul_counters where match_id=mid),'Reintento histórico no crea falta adicional';
        perform public.record_match_event(mid,h,'FOUL',null,gen_random_uuid());
        assert public.get_match_control(mid)->'fouls' @> jsonb_build_array(jsonb_build_object('team_id',h,'period_number',1,'count',2));
        assert (select to_jsonb(e) from public.match_events e where match_id=mid)=previous,'No modifica la falta histórica';
        assert public.get_match_control(mid)->'precheck'='null'::jsonb,'No inventa respuestas para partidos en curso';
        perform public.control_match(mid,'BREAK',(select updated_at from public.matches where id=mid));
        perform public.control_match(mid,'SECOND_HALF',(select updated_at from public.matches where id=mid));
        perform public.control_match(mid,'FINISH',(select updated_at from public.matches where id=mid));
      end $$;`)
      console.log('OK 017: faltas históricas más contadores nuevos; partido en curso continúa sin control previo retroactivo')
    }
    if (beforeTimeouts) {
      assert.deepEqual(await timeoutSnapshot(), beforeTimeouts, '015 conserva partidos, eventos, jugadores y convocatorias')
      await db.exec(`do $$ declare mid uuid;
      begin
        select m.id into strict mid from public.matches m join public.categories c on c.id=m.category_id
          where c.name='__lineup_preservation' and m.status='PRIMER_TIEMPO';
        assert (select timeout_started_at is null from public.matches where id=mid);
        perform public.control_match(mid,'BREAK',(select updated_at from public.matches where id=mid));
        perform public.control_match(mid,'SECOND_HALF',(select updated_at from public.matches where id=mid));
        perform public.control_match(mid,'FINISH',(select updated_at from public.matches where id=mid));
      end $$;`)
      console.log('OK 015: filas intactas; los tiempos muertos anteriores no activan pausas retroactivas')
    }
    if (beforeLineups) {
      assert.deepEqual(await lineupSnapshot(), beforeLineups, '014 conserva jugadores, partidos y snapshots históricos completos')
      await db.exec(`do $$ declare mid uuid;
      begin
        select m.id into strict mid from public.matches m join public.categories c on c.id=m.category_id where c.name='__lineup_preservation';
        assert public.get_match_control(mid)->'score'='{"home":1,"away":0}'::jsonb;
        assert not exists(select 1 from public.match_players where match_id=mid);
        assert (select shirt_number from public.match_events where match_id=mid and type='GOAL')=5;
        perform public.control_match(mid,'BREAK',(select updated_at from public.matches where id=mid));
        perform public.control_match(mid,'SECOND_HALF',(select updated_at from public.matches where id=mid));
        perform public.control_match(mid,'FINISH',(select updated_at from public.matches where id=mid));
      end $$;`)
      console.log('OK 014: jugadores conservados, dorsal global retirado y eventos históricos intactos')
    }
    if (before) {
      assert.deepEqual(await snapshot(), before, 'La migración debe conservar íntegros los datos existentes')
      console.log('OK preservación exacta de datos anteriores a 013')
      // Termina únicamente el fixture local activo para ejecutar las regresiones.
      await db.exec(`do $$ declare mid uuid;
      begin
        select m.id into strict mid from public.matches m join public.categories c on c.id=m.category_id
          where c.name='__migration_preservation' and m.status='PRIMER_TIEMPO';
        perform public.control_match(mid,'BREAK',(select updated_at from public.matches where id=mid));
        perform public.control_match(mid,'SECOND_HALF',(select updated_at from public.matches where id=mid));
        perform public.control_match(mid,'FINISH',(select updated_at from public.matches where id=mid));
      end $$;`)
    }
    // Fixtures históricos: se verifican en la versión para la que fueron creados.
    if (file.startsWith('007_')) await run('supabase/tests/007_standings.sql')
    if (file.startsWith('009_')) await run('supabase/tests/009_real_teams_and_tiebreakers.sql')
    if (file.startsWith('013_')) {
      for (const testFile of ['005_match_control.sql','006_match_goals.sql','008_tournament_final.sql',
        '010_schedule_and_team_archive.sql','010_playoffs_regression.sql','011_delete_match.sql',
        '012_early_phase_finish.sql','013_players_and_match_events.sql']) await run(`supabase/tests/${testFile}`)
    }
    if (file.startsWith('014_')) await run('supabase/tests/014_match_lineups.sql')
  }
  await run('supabase/tests/017_prechecks_fouls_discipline.sql')
  await run('supabase/tests/018_event_reversal.sql')
  await run('supabase/tests/019_initial_players_and_scorers.sql')
} catch (error) {
  console.error(error.message, error.detail ?? '', error.where ?? '', 'position:', error.position ?? '')
  process.exitCode = 1
} finally { await db.close() }
