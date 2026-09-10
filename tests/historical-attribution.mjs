// PostgreSQL efímero. No utiliza red ni credenciales de Supabase.
import {PGlite} from '../.tmp-sql-check/node_modules/@electric-sql/pglite/dist/index.js'
import {readFile,readdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
const db=new PGlite()
const read=path=>readFile(path,'utf8')
const mid='bd6cf1c6-ba27-4590-89fb-24f4e9a9b757',h='727c85fc-42ef-49d6-b9e8-d27d4065ec91',a='4202eac2-a347-419a-bb9f-6ebcf3612a97'
const file=await read('supabase/imports/san-martin-san-judas-2026-09-06.sql')
try {
 await db.exec('create role anon;create role authenticated;')
 await db.exec(await read('supabase/schema.sql'))
 for(const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')&&n.slice(0,3)<='017').sort()) {
   await db.exec(await read(`supabase/migrations/${name}`))
   if(name.startsWith('012_')) {
     await db.exec(`do $$ declare c uuid; d uuid; begin
       insert into public.categories(name) values('__historical_test') returning id into c;
       insert into public.teams(id,category_id,name) values('${h}',c,'San Martin'),('${a}',c,'San Judas');
       select id into d from public.matchdays where number=1;
       insert into public.matches(id,category_id,matchday_id,home_team_id,away_team_id) values('${mid}',c,d,'${h}','${a}');
       perform public.control_match('${mid}','START',(select updated_at from public.matches where id='${mid}'));
     end $$;`)
     const rows=[...file.matchAll(/\('([0-9a-f-]{36})','([0-9a-f-]{36})','([^']+)'\)/g)]
     assert.equal(rows.length,5)
     for(const [i,row] of rows.entries()) await db.query(`insert into public.match_events(id,match_id,team_id,type,period,clock_seconds,request_id) values($1,$2,$3,'GOAL','PRIMER_TIEMPO',$4,gen_random_uuid())`,[row[1],mid,row[2],i*60])
     for(const action of ['BREAK','SECOND_HALF','FINISH']) await db.query(`select public.control_match($1,$2,(select updated_at from public.matches where id=$1))`,[mid,action])
   }
 }
 await db.exec(await read('supabase/migrations/020_historical_goal_attribution.sql'))
 await db.exec(file)
 await db.exec(file)
 const totals=(await db.query('select player_name,goals from public.get_top_scorers()')).rows
 assert.equal(totals.length,4)
 assert.equal(Number(totals.find(p=>p.player_name==='Leyson Nain Camacho').goals),2)
 assert.equal(totals.reduce((n,p)=>n+Number(p.goals),0),5)
 assert.equal((await db.query('select count(*)::int n from public.players')).rows[0].n,4)
 assert.equal((await db.query('select count(*)::int n from public.match_events where shirt_number is not null')).rows[0].n,0)
 const snapshot=(await db.query('select public.get_match_control($1) data',[mid])).rows[0].data
 assert.deepEqual(snapshot.score,{home:4,away:1})
 assert.equal(snapshot.events.filter(e=>e.player_name).length,5)
 await assert.rejects(db.query("update public.match_events set player_name='No autorizado' where match_id=$1",[mid]))
 console.log('OK: 5 eventos asociados, marcador 4–1 intacto, 4 jugadores sin dorsal, reintento sin duplicados y protección restaurada.')
} finally {await db.close()}
