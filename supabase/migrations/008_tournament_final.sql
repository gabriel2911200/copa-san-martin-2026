begin;
alter table public.categories
  add column regular_closed_at timestamptz,
  add column qualified_team_ids uuid[],
  add constraint categories_closed_top4 check (
    (regular_closed_at is null and qualified_team_ids is null)
    or (regular_closed_at is not null and qualified_team_ids is not null and cardinality(qualified_team_ids)=4)
  );

create function public.match_outcome(p_match_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  with snapshot as (select public.get_match_control(p_match_id) as j),
  result as (
    select j,case when j->'match'->>'status'='FINALIZADO' then
      case when (j->'score'->>'home')::int>(j->'score'->>'away')::int then j->'match'->>'home_team_id'
        when (j->'score'->>'away')::int>(j->'score'->>'home')::int then j->'match'->>'away_team_id'
        else j->'match'->>'tiebreak_winner_team_id' end end as winner from snapshot
  ) select case when j is null then null else j || jsonb_build_object(
    'winner_team_id',winner,'resolved',winner is not null,
    'loser_team_id',case when winner is not null then
      case when winner=j->'match'->>'home_team_id' then j->'match'->>'away_team_id' else j->'match'->>'home_team_id' end end
  ) end from result;
$$;

create function public.get_tournament() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'categories',coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('qualified',
      coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by q.ord)
        from unnest(c.qualified_team_ids) with ordinality q(id,ord) join public.teams t on t.id=q.id),'[]'::jsonb)
    ) order by c.name) from public.categories c),'[]'::jsonb),
    'matchdays',coalesce((select jsonb_agg(to_jsonb(d) order by d.number) from public.matchdays d),'[]'::jsonb),
    'matches',coalesce((select jsonb_agg(public.match_outcome(m.id) order by d.number,c.name,m.created_at,m.id)
      from public.matches m join public.matchdays d on d.id=m.matchday_id join public.categories c on c.id=m.category_id),'[]'::jsonb)
  );
$$;

create function public.close_regular(p_category_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.categories%rowtype; top_ids uuid[];
begin
  select * into c from public.categories where id=p_category_id for update;
  if not found then raise exception 'Categoría inexistente.'; end if;
  if c.regular_closed_at is not null then return public.get_tournament(); end if;
  if exists(select 1 from public.matches where category_id=c.id and stage='REGULAR' and status<>'FINALIZADO') then
    raise exception 'Hay partidos regulares pendientes. Finalízalos antes de cerrar.';
  end if;
  if not exists(select 1 from public.matches m join public.matchdays d on d.id=m.matchday_id
    where m.category_id=c.id and m.stage='REGULAR' and m.status='FINALIZADO' and d.number=4) then
    raise exception 'Debe completarse la Fecha 4 de esta categoría.';
  end if;
  select array_agg(team_id order by position) into top_ids
    from (select team_id,position from public.get_standings(c.id,false) order by position limit 4) t;
  if coalesce(cardinality(top_ids),0)<>4 then raise exception 'Se necesitan al menos cuatro equipos clasificados.'; end if;
  update public.categories set regular_closed_at=clock_timestamp(),qualified_team_ids=top_ids where id=c.id;
  return public.get_tournament();
end $$;

-- Bloqueo por categoría serializa cierre y creación de cruces.
create function public.guard_tournament_match() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.categories%rowtype; day_number integer; sf public.matches%rowtype;
  winners uuid[] := array[]::uuid[]; losers uuid[] := array[]::uuid[]; outcome jsonb;
  h bigint; a bigint;
begin
  select * into c from public.categories where id=new.category_id for update;
  if new.stage='REGULAR' and c.regular_closed_at is not null then
    raise exception 'La fase regular está cerrada; no se pueden cambiar sus partidos.';
  end if;
  if TG_OP='UPDATE' then
    if (new.category_id,new.matchday_id,new.home_team_id,new.away_team_id,new.stage)
      is distinct from (old.category_id,old.matchday_id,old.home_team_id,old.away_team_id,old.stage) then
      raise exception 'No se permite cambiar la identidad de un partido.';
    end if;
    if old.status='FINALIZADO' and new is distinct from old then
      raise exception 'El partido finalizado no se puede modificar.';
    end if;
  else
    select number into day_number from public.matchdays where id=new.matchday_id;
    if new.stage='REGULAR' and day_number not between 1 and 4 then raise exception 'Jornada regular inválida.'; end if;
    if new.stage<>'REGULAR' then
      if c.regular_closed_at is null then raise exception 'Cierra primero la fase regular.'; end if;
      if new.stage='SEMIFINAL' then
        if day_number<>5 or not(new.home_team_id=any(c.qualified_team_ids)) or not(new.away_team_id=any(c.qualified_team_ids)) then
          raise exception 'Las semifinales deben usar Top 4 y Fecha 5.';
        end if;
        if (select count(*) from public.matches where category_id=c.id and stage='SEMIFINAL')>=2
          or exists(select 1 from public.matches where category_id=c.id and stage='SEMIFINAL'
            and (home_team_id in (new.home_team_id,new.away_team_id) or away_team_id in (new.home_team_id,new.away_team_id))) then
          raise exception 'Equipo repetido o semifinales ya creadas.';
        end if;
      else
        if day_number<>6 then raise exception 'Final y tercer puesto corresponden a Fecha 6.'; end if;
        for sf in select * from public.matches where category_id=c.id and stage='SEMIFINAL' order by created_at,id loop
          outcome := public.match_outcome(sf.id);
          if not (outcome->>'resolved')::boolean then raise exception 'Ambas semifinales deben estar resueltas.'; end if;
          winners:=array_append(winners,(outcome->>'winner_team_id')::uuid);
          losers:=array_append(losers,(outcome->>'loser_team_id')::uuid);
        end loop;
        if cardinality(winners)<>2 then raise exception 'Faltan las dos semifinales.'; end if;
        if new.stage='FINAL' and (new.home_team_id<>winners[1] or new.away_team_id<>winners[2]) then raise exception 'Finalistas incorrectos.'; end if;
        if new.stage='THIRD_PLACE' and (new.home_team_id<>losers[1] or new.away_team_id<>losers[2]) then raise exception 'Participantes de tercer puesto incorrectos.'; end if;
      end if;
    end if;
  end if;
  if new.stage<>'REGULAR' then
    select count(*) filter(where team_id=new.home_team_id),count(*) filter(where team_id=new.away_team_id)
      into h,a from public.match_events where match_id=new.id and type='GOAL' and voided_at is null;
    if h<>a and new.tiebreak_winner_team_id is not null then raise exception 'Solo se usan penales con marcador empatado.'; end if;
    if new.status='FINALIZADO' and h=a and new.tiebreak_winner_team_id is null then
      raise exception 'Elige el ganador por penales antes de finalizar.';
    end if;
  end if;
  return new;
end $$;
create trigger guard_tournament_match before insert or update on public.matches
  for each row execute function public.guard_tournament_match();

-- Una fila única para cada partido de la jornada 6.
create unique index matches_final_stage_once on public.matches(category_id,stage)
  where stage in ('FINAL','THIRD_PLACE');

create function public.guard_tournament_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; closed_at timestamptz;
begin
  select * into m from public.matches where id=new.match_id for update;
  select regular_closed_at into closed_at from public.categories where id=m.category_id for update;
  if m.stage='REGULAR' and closed_at is not null then raise exception 'La fase regular está cerrada.'; end if;
  if m.status='FINALIZADO' then raise exception 'No se pueden modificar eventos de un partido finalizado.'; end if;
  if TG_OP='UPDATE' and (new.match_id,new.team_id,new.type,new.period,new.clock_seconds,new.request_id)
    is distinct from (old.match_id,old.team_id,old.type,old.period,old.clock_seconds,old.request_id) then
    raise exception 'Solo se permite anular el evento, no editarlo.';
  end if;
  return new;
end $$;
create trigger guard_tournament_event before insert or update on public.match_events
  for each row execute function public.guard_tournament_event();

create function public.clear_penalties_after_goal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Cualquier cambio del marcador exige confirmar nuevamente el desempate.
  if TG_OP='INSERT' or new.voided_at is distinct from old.voided_at then
    update public.matches set tiebreak_winner_team_id=null
      where id=new.match_id and tiebreak_winner_team_id is not null;
  end if;
  return new;
end $$;
create trigger clear_penalties_after_goal after insert or update on public.match_events
  for each row execute function public.clear_penalties_after_goal();

create function public.set_penalty_winner(p_match_id uuid,p_team_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; h bigint; a bigint;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'Partido inexistente.'; end if;
  if m.stage='REGULAR' or m.status<>'SEGUNDO_TIEMPO' then raise exception 'Penales solo al completar el segundo tiempo de una eliminatoria.'; end if;
  if m.phase_elapsed_seconds+greatest(0,extract(epoch from clock_timestamp()-m.phase_started_at))<900 then
    raise exception 'Completa el segundo tiempo antes de elegir ganador por penales.';
  end if;
  if p_team_id is null or p_team_id not in (m.home_team_id,m.away_team_id) then raise exception 'El ganador debe participar en el partido.'; end if;
  select count(*) filter(where team_id=m.home_team_id),count(*) filter(where team_id=m.away_team_id)
    into h,a from public.match_events where match_id=m.id and type='GOAL' and voided_at is null;
  if h<>a then raise exception 'El marcador no está empatado.'; end if;
  update public.matches set tiebreak_winner_team_id=p_team_id where id=m.id;
  return public.get_match_control(m.id);
end $$;

create function public.create_semifinals(p_category_id uuid,p_home1 uuid,p_away1 uuid,p_home2 uuid,p_away2 uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.categories%rowtype; selected_ids uuid[] := array[p_home1,p_away1,p_home2,p_away2]; d uuid; first_time timestamptz;
begin
  select * into c from public.categories where id=p_category_id for update;
  if not found or c.regular_closed_at is null then raise exception 'Cierra primero la fase regular.'; end if;
  if exists(select 1 from public.matches where category_id=c.id and stage='SEMIFINAL') then return public.get_tournament(); end if;
  if (select count(distinct x) from unnest(selected_ids) x)<>4 or not(selected_ids @> c.qualified_team_ids and selected_ids <@ c.qualified_team_ids) then
    raise exception 'Usa exactamente una vez cada uno de los cuatro clasificados.';
  end if;
  select id into strict d from public.matchdays where number=5;
  first_time:=clock_timestamp();
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id,stage,created_at)
    values(c.id,d,p_home1,p_away1,'SEMIFINAL',first_time);
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id,stage,created_at)
    values(c.id,d,p_home2,p_away2,'SEMIFINAL',greatest(clock_timestamp(),first_time+interval '1 microsecond'));
  return public.get_tournament();
end $$;

create function public.generate_day6(p_category_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.categories%rowtype; sf public.matches%rowtype; result jsonb; d uuid;
  winners uuid[] := array[]::uuid[]; losers uuid[] := array[]::uuid[];
begin
  select * into c from public.categories where id=p_category_id for update;
  if not found then raise exception 'Categoría inexistente.'; end if;
  for sf in select * from public.matches where category_id=c.id and stage='SEMIFINAL' order by created_at,id loop
    result:=public.match_outcome(sf.id);
    if not(result->>'resolved')::boolean then raise exception 'Ambas semifinales deben estar finalizadas y resueltas.'; end if;
    winners:=array_append(winners,(result->>'winner_team_id')::uuid);
    losers:=array_append(losers,(result->>'loser_team_id')::uuid);
  end loop;
  if cardinality(winners)<>2 then raise exception 'Faltan las dos semifinales resueltas.'; end if;
  if exists(select 1 from public.matches where category_id=c.id and stage in ('FINAL','THIRD_PLACE')) then
    if (select count(*) from public.matches where category_id=c.id and stage in ('FINAL','THIRD_PLACE'))<>2 then
      raise exception 'La jornada 6 está incompleta; requiere revisión.';
    end if;
    return public.get_tournament();
  end if;
  select id into strict d from public.matchdays where number=6;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id,stage)
    values(c.id,d,winners[1],winners[2],'FINAL'),(c.id,d,losers[1],losers[2],'THIRD_PLACE');
  return public.get_tournament();
end $$;

-- El formulario normal crea solo regulares abiertos; eliminatorias vía RPC.
alter policy matches_anon_insert on public.matches with check (
  status='PROGRAMADO' and stage='REGULAR' and home_team_id<>away_team_id
  and exists(select 1 from public.categories c where c.id=category_id and c.regular_closed_at is null)
  and exists(select 1 from public.matchdays d where d.id=matchday_id and d.number between 1 and 4)
  and exists(select 1 from public.teams t where t.id=home_team_id and t.category_id=matches.category_id and t.active)
  and exists(select 1 from public.teams t where t.id=away_team_id and t.category_id=matches.category_id and t.active)
);

revoke all on function public.match_outcome(uuid),public.get_tournament(),public.close_regular(uuid),
  public.set_penalty_winner(uuid,uuid),public.create_semifinals(uuid,uuid,uuid,uuid,uuid),public.generate_day6(uuid)
  from public,anon,authenticated;
grant execute on function public.match_outcome(uuid),public.get_tournament(),public.close_regular(uuid),
  public.set_penalty_winner(uuid,uuid),public.create_semifinals(uuid,uuid,uuid,uuid,uuid),public.generate_day6(uuid) to anon;
revoke all on function public.guard_tournament_match(),public.guard_tournament_event(),public.clear_penalties_after_goal() from public,anon,authenticated;

-- Publicación limitada a las tablas que muestran las vistas del campeonato.
do $$
declare table_name text;
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach table_name in array array['matches','match_events','categories','teams','matchdays'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=table_name) then
      execute format('alter publication supabase_realtime add table public.%I',table_name);
    end if;
  end loop;
end $$;
commit;
