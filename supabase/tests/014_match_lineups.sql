begin;
do $$ begin
  if exists(select 1 from public.matches where status in ('PRIMER_TIEMPO','SEGUNDO_TIEMPO','DESCANSO','PAUSADO')) then
    raise exception 'Prueba cancelada: existe un partido activo real.';
  end if;
end $$;
create function pg_temp.act(mid uuid,action text) returns jsonb language plpgsql as $$
declare j jsonb; v timestamptz;
begin
  select updated_at into v from public.matches where id=mid;
  execute 'set local role anon'; j:=public.control_match(mid,action,v); execute 'reset role'; return j;
end $$;
create function pg_temp.callup(mid uuid,pid uuid,jersey integer,enabled boolean default true) returns jsonb language plpgsql as $$
declare j jsonb; v timestamptz;
begin
  select updated_at into v from public.matches where id=mid;
  execute 'set local role anon'; j:=public.set_match_player(mid,pid,jersey,enabled,v); execute 'reset role'; return j;
end $$;
create function pg_temp.event(mid uuid,tid uuid,kind text,pid uuid,rid uuid default gen_random_uuid()) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  execute 'set local role anon'; j:=public.record_match_event(mid,tid,kind,pid,rid); execute 'reset role'; return j;
end $$;
do $$
declare c uuid; h uuid; a uuid; x uuid; d uuid; first_match uuid; next_match uuid;
  p uuid; opponent uuid; reserve uuid; unlisted uuid; outsider uuid; j jsonb; goal uuid;
  rid uuid:=gen_random_uuid(); rejected boolean; kind text;
  tag text:='__lineup_'||gen_random_uuid()::text;
begin
  assert not exists(select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='shirt_number');
  insert into public.categories(name) values(tag) returning id into c;
  insert into public.teams(category_id,name) values(c,tag||'h') returning id into h;
  insert into public.teams(category_id,name) values(c,tag||'a') returning id into a;
  insert into public.teams(category_id,name) values(c,tag||'x') returning id into x;
  execute 'set local role anon';
  insert into public.players(team_id,full_name) values(h,'Juan Pérez') returning id into p;
  insert into public.players(team_id,full_name) values(a,'Pedro Gómez') returning id into opponent;
  insert into public.players(team_id,full_name) values(h,'Carlos López') returning id into reserve;
  insert into public.players(team_id,full_name) values(h,'No convocado') returning id into unlisted;
  insert into public.players(team_id,full_name) values(x,'Otro equipo') returning id into outsider;
  execute 'reset role';
  select id into strict d from public.matchdays where number=1;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id) values(c,d,h,a) returning id into first_match;
  select id into strict d from public.matchdays where number=2;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id) values(c,d,h,a) returning id into next_match;
  perform pg_temp.act(first_match,'START');
  foreach kind in array array['GOAL','YELLOW_CARD','FOUL','TIMEOUT'] loop
    rejected:=false;
    begin perform pg_temp.event(first_match,h,kind,case when kind in ('GOAL','YELLOW_CARD') then p else null end);
    exception when raise_exception then rejected:=true; end;
    assert rejected,'No hay eventos sin convocatoria';
  end loop;
  perform pg_temp.callup(first_match,p,5);
  rejected:=false;
  begin perform pg_temp.event(first_match,h,'GOAL',p); exception when raise_exception then rejected:=true; end;
  assert rejected,'Falta convocatoria visitante';
  rejected:=false;
  begin perform pg_temp.callup(first_match,outsider,7); exception when raise_exception then rejected:=true; end;
  assert rejected,'No convocar jugadores de otro equipo';
  perform pg_temp.callup(first_match,opponent,5); -- mismo dorsal en equipos distintos permitido
  rejected:=false;
  begin perform pg_temp.callup(first_match,reserve,5); exception when raise_exception then rejected:=true; end;
  assert rejected,'Dorsal único dentro del equipo y encuentro';
  perform pg_temp.callup(first_match,reserve,10);
  rejected:=false;
  begin perform public.set_match_player(first_match,reserve,11,true,'2000-01-01'); exception when raise_exception then rejected:=true; end;
  assert rejected,'Versión desactualizada rechazada';
  rejected:=false;
  begin perform pg_temp.event(first_match,h,'GOAL',unlisted); exception when raise_exception then rejected:=true; end;
  assert rejected,'Jugador activo pero no convocado rechazado';
  rejected:=false;
  begin perform public.record_goal(first_match,h,gen_random_uuid()); exception when raise_exception then rejected:=true; end;
  assert rejected,'API antigua no evade selección de convocado';
  j:=pg_temp.event(first_match,h,'GOAL',p);
  assert j->'event'->>'shirt_number'='5';
  assert j->'event'->>'player_id'=p::text;
  j:=pg_temp.event(first_match,h,'YELLOW_CARD',p);
  assert j->'event'->>'shirt_number'='5';
  rejected:=false;
  begin perform pg_temp.callup(first_match,p,7); exception when raise_exception then rejected:=true; end;
  assert rejected,'No cambiar dorsal con eventos';
  rejected:=false;
  begin perform pg_temp.callup(first_match,p,5,false); exception when raise_exception then rejected:=true; end;
  assert rejected,'No retirar jugador con eventos';
  perform pg_temp.act(first_match,'BREAK'); perform pg_temp.act(first_match,'SECOND_HALF'); perform pg_temp.act(first_match,'FINISH');
  rejected:=false;
  begin perform pg_temp.callup(first_match,reserve,11); exception when raise_exception then rejected:=true; end;
  assert rejected,'Convocatoria finalizada protegida';
  assert (select goals from public.get_top_scorers(c) where player_id=p)=1;

  perform pg_temp.callup(next_match,p,10); -- mismo jugador, otro dorsal
  perform pg_temp.callup(next_match,opponent,7);
  perform pg_temp.callup(next_match,reserve,5);
  perform pg_temp.callup(next_match,reserve,5,false);
  perform pg_temp.callup(next_match,reserve,9);
  perform pg_temp.act(next_match,'START');
  j:=pg_temp.event(next_match,h,'GOAL',p,rid); goal:=(j->'event'->>'id')::uuid;
  assert j->'event'->>'shirt_number'='10';
  assert pg_temp.event(next_match,h,'GOAL',p,rid)->'event'->>'id'=goal::text;
  j:=pg_temp.event(next_match,h,'YELLOW_CARD',p);
  assert j->'event'->>'shirt_number'='10';
  assert (select goals from public.get_top_scorers(c) where player_id=p)=2,'Goleador acumulado por ID, no dorsal';
  assert (select count(*) from public.get_top_scorers(c) where player_id=p)=1;
  assert (select shirt_number from public.match_events where match_id=first_match and type='GOAL')=5;
  perform pg_temp.event(next_match,h,'FOUL',null);
  perform pg_temp.event(next_match,h,'TIMEOUT',null);
  assert public.get_match_control(next_match)->'score'='{"home":1,"away":0}'::jsonb;
  execute 'set local role anon'; perform public.void_match_event(next_match,goal); execute 'reset role';
  assert (select goals from public.get_top_scorers(c) where player_id=p)=1;
  assert pg_temp.event(next_match,h,'GOAL',p,rid)->'event'->>'shirt_number'='10';
  assert (select count(*) from public.players where team_id in (h,a,x))=5;
  assert not has_table_privilege('anon','public.match_players','UPDATE');
  assert not has_table_privilege('anon','public.players','DELETE');
  assert exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='match_players');
  perform pg_temp.act(next_match,'BREAK'); perform pg_temp.act(next_match,'SECOND_HALF'); perform pg_temp.act(next_match,'FINISH');
  assert (select gf from public.get_standings(c,false) where team_id=h)=1;
  raise notice 'OK: convocatorias, dorsales por encuentro, eventos protegidos y goleadores por jugador.';
end $$;
rollback;
