begin;
do $$ begin
  if exists(select 1 from public.matches where status in ('PRIMER_TIEMPO','DESCANSO','SEGUNDO_TIEMPO','PAUSADO')) then
    raise exception 'Prueba cancelada: hay un partido activo real.';
  end if;
end $$;
create function pg_temp.act(mid uuid,action text) returns jsonb language plpgsql as $$
declare v timestamptz; result jsonb;
begin
  select updated_at into v from public.matches where id=mid;
  execute 'set local role anon';
  result:=public.control_match(mid,action,v);
  execute 'reset role'; return result;
end $$;
create function pg_temp.second_half(mid uuid) returns void language plpgsql as $$
begin
  update public.matches set phase_started_at=clock_timestamp()-interval '20 minutes' where id=mid;
  perform pg_temp.act(mid,'BREAK');
  update public.matches set phase_started_at=clock_timestamp()-interval '6 minutes' where id=mid;
  perform pg_temp.act(mid,'SECOND_HALF');
  update public.matches set phase_started_at=clock_timestamp()-interval '20 minutes' where id=mid;
end $$;
create function pg_temp.goal(mid uuid,tid uuid) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role anon'; result:=public.record_goal(mid,tid,gen_random_uuid()); execute 'reset role'; return result;
end $$;
do $$
declare c uuid; day4 uuid; ids uuid[] := array[]::uuid[]; tid uuid; opponent uuid; mid uuid;
  scores integer[] := array[3,2,3,1,1]; conceded integer[] := array[0,0,1,0,0];
  ranked uuid[]; i integer; j integer; before_count integer;
  prefix text := '__ranking_test_'||gen_random_uuid()::text;
begin
  assert (select count(*) from public.teams)=17;
  assert (select count(*) from public.matches)=0;
  select count(*) into before_count from public.teams;
  insert into public.teams(category_id,name,active)
    select category_id,name,true from public.teams
    on conflict(category_id,name) do update set active=true where not public.teams.active;
  assert (select count(*) from public.teams)=before_count,'Upsert no duplica';
  assert not exists(select 1 from public.categories c cross join lateral public.get_standings(c.id) s
    where s.pj<>0 or s.pg<>0 or s.pe<>0 or s.pp<>0 or s.gf<>0 or s.gc<>0 or s.dg<>0 or s.pts<>0);
  -- GC es redundante algebraicamente tras DG y GF; se verifica su inclusión explícita.
  assert pg_get_functiondef('public.get_standings(uuid,boolean)'::regprocedure)
    like '%c.pts desc,c.dg desc,c.gf desc,c.gc asc,c.team_name asc,c.team_id asc%';
  select id into strict c from public.categories where name='Varones';
  select id into strict day4 from public.matchdays where number=4;
  for i in 1..5 loop
    insert into public.teams(category_id,name) values(c,prefix||'_'||i) returning id into tid;
    ids:=array_append(ids,tid);
  end loop;
  insert into public.teams(category_id,name) values(c,prefix||'_opponent') returning id into opponent;
  for i in 1..5 loop
    insert into public.matches(category_id,matchday_id,home_team_id,away_team_id)
      values(c,day4,ids[i],opponent) returning id into mid;
    perform pg_temp.act(mid,'START');
    for j in 1..scores[i] loop perform pg_temp.goal(mid,ids[i]); end loop;
    for j in 1..conceded[i] loop perform pg_temp.goal(mid,opponent); end loop;
    perform pg_temp.second_half(mid); perform pg_temp.act(mid,'FINISH');
  end loop;
  select array_agg(team_id order by position) into ranked from
    (select * from public.get_standings(c,false) order by position limit 5) s;
  assert ranked=array[ids[1],ids[3],ids[2],ids[4],ids[5]],'PTS, DG, GF y estabilidad';
  assert not exists(select 1 from public.get_standings(c,false) where pts<>3*pg+pe or dg<>gf-gc);
  execute 'set local role anon'; perform public.close_regular(c); execute 'reset role';
  assert (select qualified_team_ids from public.categories where id=c)=ranked[1:4],'Top 4 usa mismo orden';
end $$;
rollback;
