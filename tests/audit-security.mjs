// Diagnostic only: builds an ephemeral database; no remote credentials or IO.
import { PGlite } from '../.tmp-sql-check/node_modules/@electric-sql/pglite/dist/index.js'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const db=new PGlite()
try {
  await db.exec('create role anon;create role authenticated;')
  await db.exec(await readFile('supabase/schema.sql','utf8'))
  for(const name of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+name,'utf8'))
  const {rows:exposed}=await db.query(`select proname from pg_proc where pronamespace='public'::regnamespace and prosecdef and prorettype<>'trigger'::regtype and has_function_privilege('anon',oid,'EXECUTE') order by proname`)
  assert.ok(exposed.some(p=>p.proname==='reset_tournament'),'Diagnostic must detect the existing public reset permission')
  const {rows:[permissions]}=await db.query(`select
    has_function_privilege('anon','public.reopen_match(uuid,timestamptz)','EXECUTE') reopen_anon,
    has_function_privilege('authenticated','public.reopen_match(uuid,timestamptz)','EXECUTE') reopen_authenticated,
    has_schema_privilege('anon','private','USAGE') private_schema_anon,
    has_table_privilege('anon','public.match_events','INSERT') direct_event_insert_anon,
    (select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity) public_tables_without_rls,
    (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'manage_penalty_shootout_before_%' and has_function_privilege('anon',oid,'EXECUTE')) legacy_write_rpc_anon`)
  assert.equal(permissions.reopen_anon,false)
  assert.equal(permissions.reopen_authenticated,true)
  assert.equal(permissions.private_schema_anon,false)
  assert.equal(permissions.direct_event_insert_anon,false)
  assert.equal(Number(permissions.public_tables_without_rls),0)
  assert.equal(Number(permissions.legacy_write_rpc_anon),0)
  const report={environment:'PGlite isolated; no production access',blocker:'CRITICAL: anonymous administrative RPCs remain enabled by the documented pre-existing business decision',exposed:exposed.map(p=>p.proname),permissions}
  await mkdir('test-results',{recursive:true})
  await writeFile('test-results/audit-security.json',JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2))
} finally {await db.close()}
