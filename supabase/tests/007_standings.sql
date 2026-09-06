-- Fixtures de ambas categorías, siempre revertidos.
begin;
do $$ begin
  if exists(select 1 from public.matches where status in ('PRIMER_TIEMPO','DESCANSO','SEGUNDO_TIEMPO','PAUSADO')) then
    raise exception 'Prueba cancelada: existe un partido activo real.';
  end if;
end $$;
create function pg_temp.fixture(c uuid,h uuid,a uuid,hg integer,ag integer,s text default 'REGULAR',st text default 'FINALIZADO') returns uuid
language plpgsql as $$
declare mid uuid; d uuid;
begin
  select id into d from public.matchdays where number=case s when 'REGULAR' then 1 when 'SEMIFINAL' then 5 else 6 end;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id,stage,status,phase_started_at)
    values(c,d,h,a,s,st,case when st in ('PRIMER_TIEMPO','DESCANSO','SEGUNDO_TIEMPO') then clock_timestamp() else null end) returning id into mid;
  insert into public.match_events(match_id,team_id,period,clock_seconds)
    select mid,h,'PRIMER_TIEMPO',10 from generate_series(1,hg);
  insert into public.match_events(match_id,team_id,period,clock_seconds)
    select mid,a,'PRIMER_TIEMPO',20 from generate_series(1,ag);
  return mid;
end $$;
create function pg_temp.standings(c uuid, live boolean default true) returns jsonb
language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role anon';
  select coalesce(jsonb_agg(to_jsonb(s) order by s.position),'[]'::jsonb) into result from public.get_standings(c,live) s;
  execute 'reset role';
  return result;
end $$;
create function pg_temp.row_for(rows jsonb,tid uuid) returns jsonb
language sql as $$ select value from jsonb_array_elements(rows) where value->>'team_id'=tid::text $$;
do $$
declare c uuid; ids uuid[]; tid uuid; i integer; rows jsonb; baseline jsonb; r jsonb; mid uuid; goal_id uuid;
  tag text := '__standings_'||gen_random_uuid()::text;
begin
  for c in select id from public.categories where name in ('Varones','Mujeres') loop
    ids := array[]::uuid[];
    for i in 1..12 loop
      insert into public.teams(category_id,name) values(c,tag||'_'||lpad(i::text,2,'0')) returning id into tid;
      ids := array_append(ids,tid);
    end loop;
    rows := pg_temp.standings(c);
    r := pg_temp.row_for(rows,ids[1]);
    assert r->>'pj'='0' and r->>'pg'='0' and r->>'pe'='0' and r->>'pp'='0' and r->>'gf'='0' and r->>'gc'='0' and r->>'dg'='0' and r->>'pts'='0';
    mid := pg_temp.fixture(c,ids[1],ids[2],2,0);
    rows := pg_temp.standings(c);
    r := pg_temp.row_for(rows,ids[1]);
    assert r->>'pj'='1' and r->>'pg'='1' and r->>'pts'='3' and r->>'gf'='2' and r->>'gc'='0';
    r := pg_temp.row_for(rows,ids[2]);
    assert r->>'pp'='1' and r->>'gc'='2' and r->>'pts'='0';
    insert into public.match_events(match_id,team_id,period,clock_seconds,voided_at) values(mid,ids[2],'PRIMER_TIEMPO',25,clock_timestamp());
    assert pg_temp.standings(c)=rows, 'Un gol anulado cambió la tabla';
    perform pg_temp.fixture(c,ids[1],ids[3],1,1);
    r := pg_temp.row_for(pg_temp.standings(c),ids[1]);
    assert r->>'pj'='2' and r->>'pg'='1' and r->>'pe'='1' and r->>'gf'='3' and r->>'gc'='1' and r->>'dg'='2' and r->>'pts'='4';
    perform pg_temp.fixture(c,ids[4],ids[5],3,1);
    perform pg_temp.fixture(c,ids[6],ids[7],2,0);
    perform pg_temp.fixture(c,ids[8],ids[9],1,0);
    rows := pg_temp.standings(c);
    assert (pg_temp.row_for(rows,ids[1])->>'position')::int < (pg_temp.row_for(rows,ids[4])->>'position')::int, 'Orden PTS';
    assert (pg_temp.row_for(rows,ids[4])->>'position')::int < (pg_temp.row_for(rows,ids[6])->>'position')::int, 'Orden GF';
    assert (pg_temp.row_for(rows,ids[6])->>'position')::int < (pg_temp.row_for(rows,ids[8])->>'position')::int, 'Orden DG';
    assert (pg_temp.row_for(rows,ids[10])->>'position')::int < (pg_temp.row_for(rows,ids[11])->>'position')::int, 'Orden nombre';
    perform pg_temp.fixture(c,ids[10],ids[11],9,0,'REGULAR','PROGRAMADO');
    perform pg_temp.fixture(c,ids[10],ids[11],9,0,'SEMIFINAL');
    perform pg_temp.fixture(c,ids[10],ids[11],9,0,'THIRD_PLACE');
    perform pg_temp.fixture(c,ids[10],ids[11],9,0,'FINAL');
    assert pg_temp.standings(c)=rows, 'Se contaron programados o playoffs';
    update public.teams set active=false where id in (ids[1],ids[12]);
    rows := pg_temp.standings(c);
    assert pg_temp.row_for(rows,ids[1])->>'pts'='4', 'Se perdió historia inactiva';
    assert pg_temp.row_for(rows,ids[12]) is null, 'Inactivo sin historia';
    baseline := rows;
    mid := pg_temp.fixture(c,ids[2],ids[3],1,0,'REGULAR','PRIMER_TIEMPO');
    rows := pg_temp.standings(c);
    assert pg_temp.standings(c,false)=baseline, 'La definitiva incluyó un activo';
    r := pg_temp.row_for(rows,ids[2]);
    assert r->>'pj'='2' and r->>'pg'='1' and r->>'pts'='3' and (r->>'is_live')::boolean;
    insert into public.match_events(match_id,team_id,period,clock_seconds) values(mid,ids[3],'PRIMER_TIEMPO',30) returning id into goal_id;
    rows := pg_temp.standings(c);
    assert pg_temp.row_for(rows,ids[2])->>'pts'='1';
    assert pg_temp.row_for(rows,ids[3])->>'pts'='2';
    update public.matches set status='PAUSADO',paused_from_status='PRIMER_TIEMPO',phase_started_at=null where id=mid;
    assert pg_temp.standings(c)=rows, 'PAUSADO no cuenta';
    update public.matches set status='DESCANSO',paused_from_status=null,phase_started_at=clock_timestamp() where id=mid;
    assert pg_temp.standings(c)=rows, 'DESCANSO no cuenta';
    update public.matches set status='SEGUNDO_TIEMPO' where id=mid;
    assert pg_temp.standings(c)=rows, 'SEGUNDO_TIEMPO no cuenta';
    update public.matches set status='FINALIZADO',phase_started_at=null where id=mid;
    rows := pg_temp.standings(c);
    r := pg_temp.row_for(rows,ids[2]);
    assert r->>'pj'='2' and r->>'pts'='1' and not (r->>'is_live')::boolean, 'Doble conteo al finalizar';
    assert pg_temp.standings(c,false)=rows;
    assert not exists(select 1 from jsonb_array_elements(rows) x join public.teams t on t.id=(x->>'team_id')::uuid where t.category_id<>c), 'Categorías mezcladas';
  end loop;
  raise notice 'OK: ambas categorías, resultados, histórico, playoffs excluidos, estados activos y orden.';
end $$;
rollback;
