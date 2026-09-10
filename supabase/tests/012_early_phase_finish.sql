-- Ejecutar después de 012. Fixtures transaccionales; no deja cambios.
begin;
do $$ begin
  if exists(select 1 from public.matches where status in ('PRIMER_TIEMPO','DESCANSO','SEGUNDO_TIEMPO','PAUSADO')) then
    raise exception 'Prueba cancelada: existe un partido activo real.';
  end if;
end $$;

create function pg_temp.act(mid uuid, action text) returns jsonb language plpgsql as $$
declare version timestamptz; result jsonb;
begin
  select updated_at into version from public.matches where id=mid;
  execute 'set local role anon';
  result:=public.control_match(mid,action,version);
  execute 'reset role';
  return result;
end $$;

do $$
declare c uuid; h uuid; a uuid; x uuid; y uuid; d uuid; mid uuid; sf uuid;
  result jsonb; events_before jsonb; version timestamptz; rejected boolean;
  tag text := '__early_'||gen_random_uuid()::text;
begin
  insert into public.categories(name) values(tag) returning id into c;
  insert into public.teams(category_id,name) values(c,tag||'h') returning id into h;
  insert into public.teams(category_id,name) values(c,tag||'a') returning id into a;
  insert into public.teams(category_id,name) values(c,tag||'x') returning id into x;
  insert into public.teams(category_id,name) values(c,tag||'y') returning id into y;
  select id into strict d from public.matchdays where number=1;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id) values(c,d,h,a) returning id into mid;
  perform pg_temp.act(mid,'START');
  update public.matches set phase_started_at=clock_timestamp()-interval '12 seconds' where id=mid;
  execute 'set local role anon';
  perform public.record_goal(mid,h,gen_random_uuid());
  execute 'reset role';
  select jsonb_agg(to_jsonb(e) order by id) into events_before from public.match_events e where match_id=mid;
  result:=pg_temp.act(mid,'BREAK');
  assert result->'match'->>'status'='DESCANSO';
  assert (result->'match'->>'phase_elapsed_seconds')::integer=0;
  assert result->'score'='{"home":1,"away":0}'::jsonb;
  result:=pg_temp.act(mid,'SECOND_HALF');
  assert result->'match'->>'status'='SEGUNDO_TIEMPO';
  assert (result->'match'->>'phase_elapsed_seconds')::integer=0;
  update public.matches set phase_started_at=clock_timestamp()-interval '42 seconds' where id=mid;
  result:=pg_temp.act(mid,'PAUSE');
  rejected:=false;
  begin perform pg_temp.act(mid,'FINISH'); exception when raise_exception then rejected:=true; end;
  assert rejected,'Reanudar antes de terminar una fase pausada';
  perform pg_temp.act(mid,'RESUME');
  rejected:=false;
  begin perform public.control_match(mid,'FINISH','2000-01-01'::timestamptz);
  exception when raise_exception then rejected:=true; end;
  assert rejected,'Version antigua rechazada';
  result:=pg_temp.act(mid,'FINISH');
  assert result->'match'->>'status'='FINALIZADO';
  assert result->'match'->>'phase_started_at' is null;
  assert (result->'match'->>'phase_elapsed_seconds')::integer between 42 and 60;
  assert result->'score'='{"home":1,"away":0}'::jsonb;
  assert (select jsonb_agg(to_jsonb(e) order by id) from public.match_events e where match_id=mid)=events_before;

  -- Fixture de clasificados, aislado de las categorías reales.
  update public.categories set regular_closed_at=clock_timestamp(),qualified_team_ids=array[h,a,x,y] where id=c;
  perform public.create_semifinals(c,h,a,x,y);
  select id into strict sf from public.matches where category_id=c and stage='SEMIFINAL' and home_team_id=h;
  perform pg_temp.act(sf,'START');
  perform pg_temp.act(sf,'BREAK');
  perform pg_temp.act(sf,'SECOND_HALF');
  rejected:=false;
  begin perform pg_temp.act(sf,'FINISH'); exception when raise_exception then rejected:=true; end;
  assert rejected,'Empate anticipado exige penales';
  rejected:=false;
  begin perform public.set_penalty_winner(sf,x); exception when raise_exception then rejected:=true; end;
  assert rejected,'Ganador debe participar';
  execute 'set local role anon';
  perform public.set_penalty_winner(sf,h);
  execute 'reset role';
  result:=pg_temp.act(sf,'FINISH');
  assert result->'match'->>'status'='FINALIZADO';
  assert (result->'match'->>'phase_elapsed_seconds')::integer<900;
  assert result->'score'='{"home":0,"away":0}'::jsonb;
  assert public.match_outcome(sf)->>'winner_team_id'=h::text;
  assert not exists(select 1 from public.match_events where match_id=sf),'Penales no agregan goles';
  assert not has_table_privilege('anon','public.matches','UPDATE');
  assert not has_table_privilege('anon','public.match_events','INSERT');
  raise notice 'OK: cortes anticipados, reloj real, eventos intactos, pausas, versión y penales.';
end $$;
rollback;
