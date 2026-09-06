-- Pruebas sin residuos. Ninguna fila de prueba se confirma.
begin;
do $$ begin
  if exists(select 1 from public.matches where status in ('PRIMER_TIEMPO','SEGUNDO_TIEMPO','PAUSADO','DESCANSO')) then
    raise exception 'Prueba cancelada: hay un partido activo real.';
  end if;
end $$;

create function pg_temp.goal(mid uuid, tid uuid, rid uuid) returns jsonb
language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role anon';
  result := public.record_goal(mid,tid,rid);
  execute 'reset role';
  return result;
end $$;
create function pg_temp.void(mid uuid, eid uuid) returns jsonb
language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role anon';
  result := public.void_goal(mid,eid);
  execute 'reset role';
  return result;
end $$;
create function pg_temp.act(mid uuid, action text) returns jsonb
language plpgsql as $$
declare result jsonb; version timestamptz;
begin
  select updated_at into version from public.matches where id=mid;
  execute 'set local role anon';
  result := public.control_match(mid,action,version);
  execute 'reset role';
  return result;
end $$;
create function pg_temp.reject_goal(mid uuid, tid uuid, rid uuid, expected_text text) returns void
language plpgsql as $$
declare rejected boolean := false;
begin
  begin perform pg_temp.goal(mid,tid,rid);
  exception when raise_exception then
    if position(expected_text in sqlerrm)=0 then raise; end if;
    rejected := true;
  end;
  assert rejected, 'La solicitud debió ser rechazada';
end $$;

do $$
declare c uuid; d uuid; h uuid; a uuid; outsider uuid; mid uuid; other_match uuid;
  local_request uuid := gen_random_uuid(); visitor_request uuid := gen_random_uuid();
  second_request uuid := gen_random_uuid(); local_event uuid; visitor_event uuid; second_event uuid;
  result jsonb; repeated jsonb; clock_before jsonb; rejected boolean;
  tag text := '__goals_test_' || gen_random_uuid()::text;
begin
  select id into strict c from public.categories where name='Varones';
  select id into strict d from public.matchdays where number=1;
  execute 'set local role anon';
  insert into public.teams(category_id,name) values(c,tag||'_h') returning id into h;
  insert into public.teams(category_id,name) values(c,tag||'_a') returning id into a;
  insert into public.teams(category_id,name) values(c,tag||'_x') returning id into outsider;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id,stage,status)
    values(c,d,h,a,'REGULAR','PROGRAMADO') returning id into mid;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id,stage,status)
    values(c,d,a,h,'REGULAR','PROGRAMADO') returning id into other_match;
  execute 'reset role';
  perform pg_temp.reject_goal(mid,h,gen_random_uuid(),'primer o segundo tiempo');
  perform pg_temp.act(mid,'START');
  perform pg_temp.reject_goal(mid,outsider,gen_random_uuid(),'no participa');
  perform pg_temp.reject_goal(mid,h,null,'identificador');

  update public.matches set phase_elapsed_seconds=20, phase_started_at=clock_timestamp()-interval '12 seconds' where id=mid;
  select to_jsonb(m) into clock_before from public.matches m where id=mid;
  result := pg_temp.goal(mid,h,local_request);
  local_event := (result->'event'->>'id')::uuid;
  assert result->'event'->>'period'='PRIMER_TIEMPO';
  assert (result->'event'->>'clock_seconds')::integer between 32 and 33;
  assert result->'control'->'score'='{"home":1,"away":0}'::jsonb;
  assert result->'control'->'goals'->0->>'period_number'='1';
  assert result->'control'->'match'=clock_before, 'El gol alteró el reloj/partido';

  repeated := pg_temp.goal(mid,h,local_request);
  assert repeated->'event'->>'id'=local_event::text;
  assert repeated->'control'->'score'='{"home":1,"away":0}'::jsonb;
  assert (select count(*) from public.match_events where request_id=local_request)=1;
  perform pg_temp.reject_goal(mid,a,local_request,'otro gol');
  result := pg_temp.goal(mid,a,visitor_request);
  visitor_event := (result->'event'->>'id')::uuid;
  assert result->'control'->'score'='{"home":1,"away":1}'::jsonb;

  perform pg_temp.act(mid,'PAUSE');
  perform pg_temp.reject_goal(mid,h,gen_random_uuid(),'primer o segundo tiempo');
  -- Un reintento procesado antes de pausar no crea otro gol ni cambia su tiempo.
  result := pg_temp.goal(mid,h,local_request);
  assert result->'event'->>'id'=local_event::text;
  rejected := false;
  begin perform pg_temp.void(other_match,local_event);
  exception when raise_exception then
    if position('no pertenece' in sqlerrm)=0 then raise; end if;
    rejected := true;
  end;
  assert rejected;
  result := pg_temp.void(mid,local_event);
  assert result->'event'->>'voided_at' is not null;
  assert result->'control'->'score'='{"home":0,"away":1}'::jsonb;
  assert jsonb_array_length(result->'control'->'goals')=1;
  repeated := pg_temp.void(mid,local_event);
  assert repeated->'event'->>'voided_at'=result->'event'->>'voided_at';
  result := pg_temp.goal(mid,h,local_request);
  assert result->'event'->>'voided_at' is not null;
  assert result->'control'->'score'='{"home":0,"away":1}'::jsonb;
  assert (select count(*) from public.match_events where match_id=mid)=2;

  perform pg_temp.act(mid,'RESUME');
  update public.matches set phase_started_at=clock_timestamp()-interval '1 hour' where id=mid;
  perform pg_temp.act(mid,'BREAK');
  perform pg_temp.reject_goal(mid,h,gen_random_uuid(),'primer o segundo tiempo');
  result := pg_temp.void(mid,visitor_event);
  assert result->'control'->'score'='{"home":0,"away":0}'::jsonb;
  update public.matches set phase_started_at=clock_timestamp()-interval '1 hour' where id=mid;
  perform pg_temp.act(mid,'SECOND_HALF');
  update public.matches set phase_started_at=clock_timestamp()-interval '1 hour' where id=mid;
  result := pg_temp.goal(mid,h,second_request);
  second_event := (result->'event'->>'id')::uuid;
  assert result->'event'->>'period'='SEGUNDO_TIEMPO';
  assert (result->'event'->>'clock_seconds')::integer=900;
  assert result->'control'->'goals'->0->>'period_number'='2';
  assert result->'control'->'score'='{"home":1,"away":0}'::jsonb;
  perform pg_temp.act(mid,'FINISH');
  perform pg_temp.reject_goal(mid,h,gen_random_uuid(),'primer o segundo tiempo');
  rejected := false;
  begin perform pg_temp.void(mid,second_event);
  exception when raise_exception then
    if position('finalizado' in sqlerrm)=0 then raise; end if;
    rejected := true;
  end;
  assert rejected;
  result := pg_temp.goal(mid,h,second_request);
  assert result->'event'->>'id'=second_event::text;
  assert (select count(*) from public.match_events where match_id=mid)=3;
  assert (select count(*) from public.match_events where match_id=mid and voided_at is not null)=2;
  assert not has_table_privilege('anon','public.match_events','INSERT');
  assert not has_table_privilege('anon','public.match_events','UPDATE');
  assert not has_table_privilege('anon','public.match_events','DELETE');
  raise notice 'OK: goles, marcador, idempotencia, anulación, control y permisos.';
end $$;
rollback;
