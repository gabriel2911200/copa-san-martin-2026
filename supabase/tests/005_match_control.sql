-- Prueba transaccional: todos los equipos/partidos y cambios se revierten.
begin;
-- Evita ejecutar las pruebas si ya hay actividad real en curso.
do $$ begin
  if exists(select 1 from public.matches where status in ('PRIMER_TIEMPO','DESCANSO','SEGUNDO_TIEMPO','PAUSADO')) then
    raise exception 'Prueba cancelada: existe un partido activo real.';
  end if;
end $$;

create function pg_temp.act(mid uuid, action text) returns jsonb
language plpgsql as $$
declare version timestamptz; result jsonb;
begin
  select updated_at into version from public.matches where id=mid;
  execute 'set local role anon';
  result := public.control_match(mid, action, version);
  execute 'reset role';
  return result;
end $$;

create function pg_temp.reject_action(mid uuid, action text, expected_text text) returns void
language plpgsql as $$
declare rejected boolean := false;
begin
  begin
    perform pg_temp.act(mid,action);
  exception when raise_exception then
    if position(expected_text in sqlerrm) = 0 then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Debió rechazarse %', action; end if;
end $$;

do $$
declare c uuid; d uuid; h uuid; a uuid; mid uuid; second_id uuid; result jsonb;
  previous jsonb; paused_seconds integer; rejected boolean := false;
  tag text := '__clock_test_' || gen_random_uuid()::text;
begin
  select id into strict c from public.categories where name='Varones';
  select id into strict d from public.matchdays where number=1;
  insert into public.teams(category_id,name) values(c,tag||'_h') returning id into h;
  insert into public.teams(category_id,name) values(c,tag||'_a') returning id into a;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id) values(c,d,h,a) returning id into mid;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id) values(c,d,a,h) returning id into second_id;
  select to_jsonb(m) - array['status','paused_from_status','phase_elapsed_seconds','phase_started_at','updated_at'] into previous from public.matches m where id=mid;

  perform pg_temp.reject_action(mid,'FINISH','segundo tiempo');
  result := pg_temp.act(mid,'START');
  assert result->'match'->>'status' = 'PRIMER_TIEMPO';
  assert (result->'match'->>'phase_elapsed_seconds')::integer=0;
  perform pg_temp.reject_action(mid,'START','PROGRAMADO');
  perform pg_temp.reject_action(second_id,'START','Ya existe un partido activo');
  perform pg_temp.reject_action(mid,'SECOND_HALF','descanso');

  -- Simula 12 segundos reales sin esperar ni persistir cambios de prueba.
  update public.matches set phase_started_at=clock_timestamp()-interval '12 seconds' where id=mid;
  result := pg_temp.act(mid,'PAUSE');
  assert result->'match'->>'status'='PAUSADO';
  paused_seconds := (result->'match'->>'phase_elapsed_seconds')::integer;
  assert paused_seconds between 12 and 13;
  assert result->'match'->>'phase_started_at' is null;
  assert result->'match'->>'paused_from_status'='PRIMER_TIEMPO';
  execute 'set local role anon';
  result := public.get_match_control(mid);
  execute 'reset role';
  assert (result->'match'->>'phase_elapsed_seconds')::integer=paused_seconds;
  perform pg_temp.reject_action(second_id,'START','Ya existe un partido activo');
  result := pg_temp.act(mid,'RESUME');
  assert result->'match'->>'status'='PRIMER_TIEMPO';
  assert (result->'match'->>'phase_elapsed_seconds')::integer=paused_seconds;
  assert result->'match'->>'paused_from_status' is null;

  update public.matches set phase_started_at=clock_timestamp()-interval '1 hour' where id=mid;
  result := pg_temp.act(mid,'PAUSE');
  assert (result->'match'->>'phase_elapsed_seconds')::integer=900;
  perform pg_temp.act(mid,'RESUME');
  result := pg_temp.act(mid,'BREAK');
  assert result->'match'->>'status'='DESCANSO';
  assert (result->'match'->>'phase_elapsed_seconds')::integer=0;
  perform pg_temp.reject_action(mid,'BREAK','primer tiempo');
  perform pg_temp.reject_action(mid,'FINISH','segundo tiempo');
  perform pg_temp.reject_action(second_id,'START','Ya existe un partido activo');
  update public.matches set phase_started_at=clock_timestamp()-interval '1 hour' where id=mid;
  result := pg_temp.act(mid,'PAUSE');
  assert result->'match'->>'paused_from_status'='DESCANSO';
  assert (result->'match'->>'phase_elapsed_seconds')::integer=300;
  result := pg_temp.act(mid,'RESUME');
  assert result->'match'->>'status'='DESCANSO';
  result := pg_temp.act(mid,'SECOND_HALF');
  assert result->'match'->>'status'='SEGUNDO_TIEMPO';
  assert (result->'match'->>'phase_elapsed_seconds')::integer=0;
  perform pg_temp.reject_action(mid,'BREAK','primer tiempo');
  perform pg_temp.reject_action(second_id,'START','Ya existe un partido activo');
  update public.matches set phase_started_at=clock_timestamp()-interval '1 hour' where id=mid;
  result := pg_temp.act(mid,'PAUSE');
  assert result->'match'->>'paused_from_status'='SEGUNDO_TIEMPO';
  assert (result->'match'->>'phase_elapsed_seconds')::integer=900;
  result := pg_temp.act(mid,'RESUME');
  assert result->'match'->>'status'='SEGUNDO_TIEMPO';
  result := pg_temp.act(mid,'FINISH');
  assert result->'match'->>'status'='FINALIZADO';
  assert result->'match'->>'phase_started_at' is null;
  assert (result->'match'->>'phase_elapsed_seconds')::integer=900;
  assert ((result->'match') - array['status','paused_from_status','phase_elapsed_seconds','phase_started_at','updated_at'])=previous;
  perform pg_temp.reject_action(mid,'START','PROGRAMADO');
  perform pg_temp.reject_action(mid,'RESUME','no está pausado');
  perform pg_temp.reject_action(mid,'UNKNOWN','inválida');
  begin
    perform public.control_match(mid,'START','2000-01-01'::timestamptz);
  exception when raise_exception then
    if position('otro dispositivo' in sqlerrm)=0 then raise; end if;
    rejected := true;
  end;
  assert rejected;
  result := pg_temp.act(second_id,'START');
  assert result->'match'->>'status'='PRIMER_TIEMPO';
  -- Límites también exigidos por constraint, aun fuera de RPC.
  rejected := false;
  begin update public.matches set phase_elapsed_seconds=901 where id=second_id;
  exception when check_violation then rejected := true; end;
  assert rejected;
  assert not has_table_privilege('anon','public.matches','UPDATE');
  assert not has_table_privilege('anon','public.matches','DELETE');
  raise notice 'OK: flujo completo, pausas, límites, concurrencia de estado, permisos y persistencia.';
end $$;
rollback;
