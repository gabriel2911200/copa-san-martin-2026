import assert from 'node:assert/strict'

// PGlite queues requests in one engine. This verifies two overlapping clients'
// stale-revision behavior plus the database uniqueness backstop, without remote IO.
export async function verifyLineupConcurrency(db) {
  const {rows:[fixture]}=await db.query(`with c as (
    insert into public.categories(name) values('__030_concurrent') returning id
  ), h as (insert into public.teams(category_id,name) select id,'H' from c returning id,category_id),
  a as (insert into public.teams(category_id,name) select id,'A' from c returning id),
  p as (insert into public.players(team_id,full_name) select id,'P' from h returning id),
  q as (insert into public.players(team_id,full_name) select id,'Q' from h returning id),
  m as (insert into public.matches(category_id,matchday_id,home_team_id,away_team_id)
    select h.category_id,(select id from public.matchdays where number=1),h.id,a.id from h,a returning id,updated_at)
  select m.id,m.updated_at::text,p.id p,q.id q,h.id team from m,p,q,h`)
  await db.exec('set role anon')
  const results=await Promise.allSettled([fixture.p,fixture.q].map(player=>db.query(
    'select public.set_match_player($1,$2,8,true,$3)',[fixture.id,player,fixture.updated_at])))
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  const rejection=results.find(r=>r.status==='rejected')
  assert.equal(rejection.reason.code,'P0001')
  const {rows}=await db.query('select player_id,shirt_number from public.match_players where match_id=$1',[fixture.id])
  assert.equal(rows.length,1)
  assert.equal(rows[0].shirt_number,8)
  await db.exec('reset role')
  const loser=rows[0].player_id===fixture.p?fixture.q:fixture.p
  await assert.rejects(db.query('insert into public.match_players(match_id,player_id,team_id,shirt_number) values($1,$2,$3,8)',[fixture.id,loser,fixture.team]),err=>err.code==='23505')
  console.log('OK 030: dos solicitudes solapadas, una asignación y protección UNIQUE en persistencia')
}
