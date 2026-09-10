begin;
do $$ begin
  if exists(select 1 from public.matches where status in ('PRIMER_TIEMPO','SEGUNDO_TIEMPO','DESCANSO','PAUSADO','TIEMPO_MUERTO')) then
    raise exception 'Prueba cancelada: existe un partido activo real.';
  end if;
end $$;
create function pg_temp.act(mid uuid,action text) returns jsonb language plpgsql as $$
declare j jsonb; v timestamptz;
begin
  select updated_at into v from public.matches where id=mid;
  execute 'set local role anon'; j:=public.control_match(mid,action,v); execute 'reset role'; return j;
end $$;
create function pg_temp.event(mid uuid,tid uuid,kind text,pid uuid,rid uuid default gen_random_uuid()) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  execute 'set local role anon'; j:=public.record_match_event(mid,tid,kind,pid,rid); execute 'reset role'; return j;
end $$;
create function pg_temp.finish_timeout(mid uuid,started timestamptz,automatic boolean) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  execute 'set local role anon'; j:=public.finish_match_timeout(mid,started,automatic); execute 'reset role'; return j;
end $$;
do $$
declare c uuid; h uuid; a uuid; d uuid; mid uuid; other_mid uuid; hp uuid; ap uuid;
  phase text; j jsonb; saved integer; started timestamptz; rid uuid; events_before jsonb; rejected boolean;
  tag text:='__timeout_'||gen_random_uuid()::text;
begin
  insert into public.categories(name) values(tag) returning id into c;
  insert into public.teams(category_id,name) values(c,tag||'h') returning id into h;
  insert into public.teams(category_id,name) values(c,tag||'a') returning id into a;
  insert into public.players(team_id,full_name) values(h,'Local') returning id into hp;
  insert into public.players(team_id,full_name) values(a,'Visitante') returning id into ap;
  select id into strict d from public.matchdays where number=1;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id) values(c,d,a,h) returning id into other_mid;
  foreach phase in array array['PRIMER_TIEMPO','SEGUNDO_TIEMPO'] loop
    select id into strict d from public.matchdays where number=case when phase='PRIMER_TIEMPO' then 1 else 2 end;
    insert into public.matches(category_id,matchday_id,home_team_id,away_team_id) values(c,d,h,a) returning id into mid;
    perform public.set_match_player(mid,hp,5,true,(select updated_at from public.matches where id=mid));
    perform public.set_match_player(mid,ap,7,true,(select updated_at from public.matches where id=mid));
    perform pg_temp.act(mid,'START');
    if phase='SEGUNDO_TIEMPO' then perform pg_temp.act(mid,'BREAK'); perform pg_temp.act(mid,'SECOND_HALF'); end if;
    perform pg_temp.event(mid,h,'GOAL',hp);
    perform pg_temp.event(mid,a,'YELLOW_CARD',ap);
    perform pg_temp.event(mid,h,'FOUL',null);
    select jsonb_agg(to_jsonb(e) order by id) into events_before from public.match_events e where match_id=mid;
    update public.matches set phase_elapsed_seconds=515,phase_started_at=clock_timestamp() where id=mid;
    rid:=gen_random_uuid();
    j:=pg_temp.event(mid,h,'TIMEOUT',null,rid);
    saved:=(j->'control'->'match'->>'phase_elapsed_seconds')::int;
    started:=(j->'control'->'match'->>'timeout_started_at')::timestamptz;
    assert saved between 515 and 516;
    assert j->'control'->'match'->>'status'='TIEMPO_MUERTO';
    assert j->'control'->'match'->>'paused_from_status'=phase;
    assert j->'control'->'match'->>'phase_started_at' is null;
    assert j->'control'->'match'->>'timeout_team_id'=h::text;
    assert j->'control'->'score'='{"home":1,"away":0}'::jsonb;
    assert (select gf from public.get_standings(c,true) where team_id=h)>=1,'Tabla incluye el partido en tiempo muerto';
    assert (select jsonb_agg(to_jsonb(e) order by id) from public.match_events e where match_id=mid and type<>'TIMEOUT')=events_before;
    perform pg_temp.event(mid,h,'TIMEOUT',null,rid); -- Reintento no reinicia el minuto.
    assert (select timeout_started_at from public.matches where id=mid)=started;
    assert (select count(*) from public.match_events where request_id=rid)=1;
    rejected:=false;
    begin perform pg_temp.act(other_mid,'START'); exception when raise_exception then rejected:=true; end;
    assert rejected,'Un solo partido activo también en tiempo muerto';
    rejected:=false;
    begin perform pg_temp.event(mid,h,'GOAL',hp); exception when raise_exception then rejected:=true; end;
    assert rejected,'Sin eventos de juego durante la pausa';
    perform pg_temp.finish_timeout(mid,started,true);
    assert (select status from public.matches where id=mid)='TIEMPO_MUERTO','No finalizar automáticamente antes del minuto';
    perform pg_temp.finish_timeout(mid,started-interval '1 second',false);
    assert (select status from public.matches where id=mid)='TIEMPO_MUERTO','Una petición antigua no termina esta pausa';
    update public.matches set timeout_started_at=clock_timestamp()-interval '25 seconds' where id=mid;
    assert (public.get_match_control(mid)->'match'->>'phase_elapsed_seconds')::int=saved;
    j:=pg_temp.act(mid,'END_TIMEOUT');
    assert j->'match'->>'status'=phase;
    assert (j->'match'->>'phase_elapsed_seconds')::int=saved;
    assert abs(extract(epoch from clock_timestamp()-(j->'match'->>'phase_started_at')::timestamptz))<2;
    assert j->'match'->>'timeout_started_at' is null;
    perform pg_temp.event(mid,h,'TIMEOUT',null,rid);
    assert (select status from public.matches where id=mid)=phase,'Reintento finalizado no vuelve a pausar';
    rejected:=false;
    begin perform pg_temp.event(mid,h,'TIMEOUT',null); exception when raise_exception then rejected:=true; end;
    assert rejected,'Se conserva la disponibilidad por equipo/periodo';

    j:=pg_temp.event(mid,a,'TIMEOUT',null);
    saved:=(j->'control'->'match'->>'phase_elapsed_seconds')::int;
    update public.matches set timeout_started_at=clock_timestamp()-interval '70 seconds' where id=mid returning timeout_started_at into started;
    -- La lectura pública continúa desde el vencimiento sin depender de un navegador.
    j:=public.get_match_control(mid);
    assert j->'match'->>'status'=phase;
    assert (j->'match'->>'phase_started_at')::timestamptz=started+interval '60 seconds';
    assert (j->'match'->>'phase_elapsed_seconds')::int=saved;
    assert (public.get_tournament()->'matches') is not null;
    if phase='PRIMER_TIEMPO' then
      j:=pg_temp.finish_timeout(mid,started,true);
      assert j->'match'->>'status'=phase;
      assert (j->'match'->>'phase_started_at')::timestamptz=started+interval '60 seconds';
      perform pg_temp.finish_timeout(mid,started,false); -- idempotente
    else
      -- El siguiente evento normaliza una pausa vencida aun sin administrador conectado.
      j:=pg_temp.event(mid,h,'GOAL',hp);
      assert (j->'event'->>'clock_seconds')::int between saved+10 and saved+12;
      assert (select status from public.matches where id=mid)=phase;
    end if;
    if phase='PRIMER_TIEMPO' then perform pg_temp.act(mid,'BREAK'); perform pg_temp.act(mid,'SECOND_HALF'); end if;
    perform pg_temp.act(mid,'FINISH');
  end loop;
  assert not has_table_privilege('anon','public.matches','UPDATE');
  assert not has_table_privilege('anon','public.match_events','INSERT');
  raise notice 'OK: pausas en ambos tiempos, fin manual/automático, relojes, reintentos y datos intactos.';
end $$;
rollback;
