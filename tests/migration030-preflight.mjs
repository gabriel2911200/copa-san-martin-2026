// Synthetic inconsistent installation, in memory only. No production data.
import { PGlite } from '../.tmp-sql-check/node_modules/@electric-sql/pglite/dist/index.js'
import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const db=new PGlite()
try {
  await db.exec('create role anon;create role authenticated;')
  await db.exec(await readFile('supabase/schema.sql','utf8'))
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f.slice(0,3)<='029').sort())await db.exec(await readFile('supabase/migrations/'+file,'utf8'))
  // Deliberately simulate a damaged installation lacking its existing index.
  // All rows below are synthetic fixtures in this disposable engine.
  await db.exec(`do $$ declare c uuid; h uuid; a uuid; m uuid; p uuid; q uuid;
  begin
    insert into public.categories(name) values('__preflight') returning id into c;
    insert into public.teams(category_id,name) values(c,'H') returning id into h;
    insert into public.teams(category_id,name) values(c,'A') returning id into a;
    insert into public.matches(category_id,matchday_id,home_team_id,away_team_id) values(c,(select id from public.matchdays where number=1),h,a) returning id into m;
    insert into public.players(team_id,full_name) values(h,'P') returning id into p;
    insert into public.players(team_id,full_name) values(h,'Q') returning id into q;
    drop index public.match_players_number;
    insert into public.match_players(match_id,player_id,team_id,shirt_number) values(m,p,h,8),(m,q,h,8);
  end $$;`)
  const snapshot=async()=>(await db.query(`select jsonb_build_object('matches',(select jsonb_agg(to_jsonb(m) order by id) from public.matches m),'players',(select jsonb_agg(to_jsonb(p) order by id) from public.players p),'lineups',(select jsonb_agg(to_jsonb(p) order by match_id,player_id) from public.match_players p)) data`)).rows[0].data
  const before=await snapshot()
  await assert.rejects(db.exec(await readFile('supabase/migrations/030_flexible_matches.sql','utf8')),err=>err.code==='P0001'&&err.message.includes('Dorsales duplicados'))
  await db.exec('rollback')
  assert.deepEqual(await snapshot(),before)
  const {rows:[state]}=await db.query(`select to_regclass('public.duration_options') is null catalog_not_created,not exists(select 1 from pg_attribute where attrelid='public.matches'::regclass and attname='friendly_penalties' and not attisdropped) match_schema_unchanged`)
  assert.equal(state.catalog_not_created,true)
  assert.equal(state.match_schema_unchanged,true)
  console.log('OK 030 preflight: duplicados sintéticos reportados, migración abortada y filas/esquema anteriores intactos')
} finally {await db.close()}
