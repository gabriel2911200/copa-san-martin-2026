-- 024: resultado administrativo W.O. y correcciones históricas.
-- Requiere 001–023 reconciliadas, especialmente 018, 021, 022 y 023.
-- No modifica registros existentes. Ejecutar únicamente tras revisión administrativa.
begin;
alter table public.matches
  add column walkover_loser_team_id uuid references public.teams(id),
  add column walkover_request_id uuid unique,
  add column walkover_recorded_at timestamptz,
  add constraint matches_walkover_state check (
    (walkover_loser_team_id is null and walkover_request_id is null and walkover_recorded_at is null)
    or (walkover_loser_team_id is not null and walkover_loser_team_id in (home_team_id,away_team_id)
      and walkover_request_id is not null and walkover_recorded_at is not null
      and status='FINALIZADO' and tiebreak_winner_team_id is null)
  );

create or replace function public.guard_tournament_match() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.categories%rowtype; day_number integer; sf public.matches%rowtype;
  winners uuid[] := array[]::uuid[]; losers uuid[] := array[]::uuid[]; outcome jsonb;
  h bigint; a bigint;
begin
  if TG_OP='UPDATE' and old.walkover_loser_team_id is not null and
    (to_jsonb(new)-array['scheduled_date','scheduled_time','updated_at']) is distinct from
    (to_jsonb(old)-array['scheduled_date','scheduled_time','updated_at']) then
    raise exception 'El resultado W.O. ya está fijado. Requiere revisión administrativa.';
  end if;
  if new.walkover_loser_team_id is not null and (TG_OP='INSERT' or old.walkover_loser_team_id is null) then
    if exists(select 1 from public.match_events where match_id=new.id and voided_at is null)
      or exists(select 1 from public.match_foul_counters where match_id=new.id) then
      raise exception 'No se puede aplicar W.O. con eventos válidos o faltas acumuladas. Anula los eventos; los contadores de faltas requieren revisión administrativa.';
    end if;
    if new.stage='SEMIFINAL' and exists(select 1 from public.matches where category_id=new.category_id and stage in ('FINAL','THIRD_PLACE')) then
      raise exception 'No se puede aplicar W.O.: ya existen final o tercer puesto dependientes.';
    end if;
  end if;
  -- Permite exclusivamente cambios de agenda sin tocar el resultado ni su identidad.
  if TG_OP='UPDATE' and
    (to_jsonb(new)-array['scheduled_date','scheduled_time','updated_at']) =
    (to_jsonb(old)-array['scheduled_date','scheduled_time','updated_at']) then
    return new;
  end if;
  select * into c from public.categories where id=new.category_id for update;
  if new.stage='REGULAR' and c.regular_closed_at is not null then
    raise exception 'La fase regular está cerrada; no se pueden cambiar sus partidos.';
  end if;
  if TG_OP='UPDATE' then
    if (new.category_id,new.matchday_id,new.home_team_id,new.away_team_id,new.stage)
      is distinct from (old.category_id,old.matchday_id,old.home_team_id,old.away_team_id,old.stage) then
      raise exception 'No se permite cambiar la identidad de un partido.';
    end if;
    if old.status='FINALIZADO' and new is distinct from old and new.walkover_loser_team_id is null then
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
    if new.walkover_loser_team_id is not null then
      h:=case when new.walkover_loser_team_id=new.home_team_id then 0 else 3 end;
      a:=case when new.walkover_loser_team_id=new.away_team_id then 0 else 3 end;
    end if;
    if h<>a and new.tiebreak_winner_team_id is not null then raise exception 'Solo se usan penales con marcador empatado.'; end if;
    if new.status='FINALIZADO' and h=a and new.tiebreak_winner_team_id is null then
      raise exception 'Elige el ganador por penales antes de finalizar.';
    end if;
  end if;
  return new;
end $$;

create or replace function public.get_match_control(p_match_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select jsonb_build_object(
    'match',public.match_clock_json(m,clock_timestamp()),'server_now',clock_timestamp(),
    'category',(select name from public.categories where id=m.category_id),
    'matchday',(select number from public.matchdays where id=m.matchday_id),
    'home',(select name from public.teams where id=m.home_team_id),
    'away',(select name from public.teams where id=m.away_team_id),
    'score',jsonb_build_object('home',case when m.walkover_loser_team_id is null then events.home_count when m.walkover_loser_team_id=m.home_team_id then 0 else 3 end,
      'away',case when m.walkover_loser_team_id is null then events.away_count when m.walkover_loser_team_id=m.away_team_id then 0 else 3 end),
    'goals',events.goals,'events',events.all_events,
    'precheck',(select to_jsonb(c) from public.match_prechecks c where c.match_id=m.id),
    'fouls',coalesce((select jsonb_agg(jsonb_build_object('team_id',f.team_id,'period_number',case f.period when 'PRIMER_TIEMPO' then 1 else 2 end,'count',f.count))
      from (select team_id,period,sum(n)::int count from (
        select team_id,period,count n from public.match_foul_counters where match_id=m.id
        union all select team_id,period,count(*)::int n from public.match_events where match_id=m.id and type='FOUL' and voided_at is null group by team_id,period
      ) combined group by team_id,period) f),'[]'::jsonb),
    'players',coalesce((select jsonb_agg(to_jsonb(p) order by p.full_name,p.id)
      from public.players p where p.team_id in (m.home_team_id,m.away_team_id) and p.active),'[]'::jsonb),
    'lineup',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'team_id',mp.team_id,'full_name',p.full_name,'active',p.active,
      'shirt_number',mp.shirt_number,'used',exists(select 1 from public.match_events e where e.match_id=m.id and e.player_id=p.id)
    ) order by mp.shirt_number,p.id) from public.match_players mp join public.players p on p.id=mp.player_id
      where mp.match_id=m.id and mp.active),'[]'::jsonb)
  ) from public.matches m cross join lateral (
    select count(*) filter(where e.type='GOAL' and e.team_id=m.home_team_id) home_count,
      count(*) filter(where e.type='GOAL' and e.team_id=m.away_team_id) away_count,
      coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('period_number',case e.period when 'PRIMER_TIEMPO' then 1 else 2 end)
        order by e.created_at,e.id) filter(where e.type='GOAL'),'[]'::jsonb) goals,
      coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('period_number',case e.period when 'PRIMER_TIEMPO' then 1 else 2 end)
        order by e.created_at,e.id),'[]'::jsonb) all_events
    from public.match_events e where e.match_id=m.id and e.voided_at is null
  ) events where m.id=p_match_id;
$$;

create or replace function public.get_standings(p_category_id uuid, p_include_live boolean default true)
returns table (
  team_id uuid, team_name text, pj bigint, pg bigint, pe bigint, pp bigint,
  gf bigint, gc bigint, dg bigint, pts bigint, "position" bigint, is_live boolean
)
language sql stable security invoker set search_path = '' as $$
  with eligible_matches as (
    select m.* from public.matches m
    where m.category_id=p_category_id and m.stage='REGULAR'
      and (m.status='FINALIZADO' or (p_include_live and m.status in
        ('PRIMER_TIEMPO','DESCANSO','SEGUNDO_TIEMPO','PAUSADO','TIEMPO_MUERTO')))
  ), scores as (
    select m.id, m.home_team_id, m.away_team_id,
      case when m.walkover_loser_team_id is null then count(e.id) filter (where e.team_id=m.home_team_id) when m.walkover_loser_team_id=m.home_team_id then 0::bigint else 3::bigint end as home_goals,
      case when m.walkover_loser_team_id is null then count(e.id) filter (where e.team_id=m.away_team_id) when m.walkover_loser_team_id=m.away_team_id then 0::bigint else 3::bigint end as away_goals
    from eligible_matches m left join public.match_events e
      on e.match_id=m.id and e.type='GOAL' and e.voided_at is null
    group by m.id,m.home_team_id,m.away_team_id,m.walkover_loser_team_id
  ), results as (
    select home_team_id as team_id,home_goals as gf,away_goals as gc from scores
    union all
    select away_team_id,away_goals,home_goals from scores
  ), totals as (
    select t.id as team_id,t.name as team_name,count(r.team_id) as pj,
      count(r.team_id) filter(where r.gf>r.gc) as pg,
      count(r.team_id) filter(where r.gf=r.gc) as pe,
      count(r.team_id) filter(where r.gf<r.gc) as pp,
      coalesce(sum(r.gf),0)::bigint as gf,coalesce(sum(r.gc),0)::bigint as gc
    from public.teams t left join results r on r.team_id=t.id
    where t.category_id=p_category_id and (t.active or exists
      (select 1 from results played where played.team_id=t.id))
    group by t.id,t.name
  ), calculated as (
    select t.*,t.gf-t.gc as dg,t.pg*3+t.pe as pts from totals t
  )
  select c.team_id,c.team_name,c.pj,c.pg,c.pe,c.pp,c.gf,c.gc,c.dg,c.pts,
    row_number() over(order by c.pts desc,c.dg desc,c.gf desc,c.gc asc,c.team_name asc,c.team_id asc),
    exists(select 1 from eligible_matches where status<>'FINALIZADO')
  from calculated c
  order by c.pts desc,c.dg desc,c.gf desc,c.gc asc,c.team_name asc,c.team_id asc;
$$;

create or replace function public.guard_tournament_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; closed_at timestamptz; p public.players%rowtype; jersey integer; h bigint; a bigint; before_h bigint; before_a bigint;
begin
  select * into m from public.matches where id=new.match_id for update;
  select regular_closed_at into closed_at from public.categories where id=m.category_id for update;
  if TG_OP='UPDATE' and new.player_id is distinct from old.player_id then
    if old.voided_at is not null or old.player_id is null or old.type not in ('GOAL','YELLOW_CARD','RED_CARD')
      or (to_jsonb(new)-array['player_id','player_name','shirt_number']) is distinct from (to_jsonb(old)-array['player_id','player_name','shirt_number']) then
      raise exception 'Solo se puede corregir el jugador de un evento válido.';
    end if;
    select * into p from public.players where id=new.player_id for share;
    if not found or (not p.active and m.status<>'FINALIZADO') or p.team_id<>old.team_id then raise exception 'Selecciona un jugador activo del mismo equipo.'; end if;
    select shirt_number into jersey from public.match_players where match_id=old.match_id and player_id=p.id and team_id=old.team_id and active;
    if not found then raise exception 'El jugador no está convocado para este partido.'; end if;
    if exists(select 1 from public.match_events e where e.match_id=old.match_id and e.id<>old.id and e.player_id=p.id and e.voided_at is null
      group by e.player_id having count(*) filter(where type='YELLOW_CARD')>=2 or count(*) filter(where type='RED_CARD')>0) then
      raise exception 'El jugador seleccionado ya está expulsado.';
    end if;
    new.player_name:=p.full_name; new.shirt_number:=jersey;
    return new;
  end if;
  if TG_OP='UPDATE' then
    if (to_jsonb(new)-'voided_at') is distinct from (to_jsonb(old)-'voided_at') then
      raise exception 'Solo se permite anular el evento, no editarlo.';
    end if;
    if old.voided_at is not null and new.voided_at is distinct from old.voided_at then
      raise exception 'Un evento revertido conserva su marca histórica.';
    end if;
    if old.voided_at is null and new.voided_at is not null and old.type='GOAL' then
      if m.stage='REGULAR' and closed_at is not null then
        raise exception 'No se puede revertir el gol: la clasificación regular ya está cerrada.';
      end if;
      if m.status='FINALIZADO' and m.stage<>'REGULAR' then
        select count(*) filter(where team_id=m.home_team_id),count(*) filter(where team_id=m.away_team_id)
          into before_h,before_a from public.match_events where match_id=m.id and type='GOAL' and voided_at is null;
        h:=before_h-case when old.team_id=m.home_team_id then 1 else 0 end;
        a:=before_a-case when old.team_id=m.away_team_id then 1 else 0 end;
        if h=a or m.tiebreak_winner_team_id is not null then
          raise exception 'No se puede revertir el gol sin revisar la resolución por penales del partido finalizado.';
        end if;
        if m.stage='SEMIFINAL' and sign(h-a)<>sign(before_h-before_a) and exists(
          select 1 from public.matches where category_id=m.category_id and stage in ('FINAL','THIRD_PLACE')) then
          raise exception 'No se puede cambiar el ganador: ya existen cruces dependientes.';
        end if;
      end if;
    end if;
    return new; -- Reversión histórica sin alterar plantilla ni convocatoria.
  end if;
  if m.stage='REGULAR' and closed_at is not null then raise exception 'La fase regular está cerrada.'; end if;
  if m.status='FINALIZADO' then raise exception 'No se pueden modificar eventos de un partido finalizado.'; end if;
  if exists(select 1 from unnest(array[m.home_team_id,m.away_team_id]) t(id)
    where not exists(select 1 from public.match_players mp join public.players roster_player on roster_player.id=mp.player_id
      where mp.match_id=m.id and mp.team_id=t.id and mp.active and roster_player.active)) then
    raise exception 'Completa la convocatoria de ambos equipos antes de registrar eventos.';
  end if;
  if new.type in ('GOAL','YELLOW_CARD','RED_CARD') and new.player_id is null
    and not (new.type='GOAL' and coalesce(new.player_name,'')='Autogol' and new.shirt_number is null) then
    raise exception 'Selecciona un jugador convocado para este partido.';
  end if;
  if new.type='FOUL' then raise exception 'Las faltas nuevas se registran en el contador.'; end if;
  if new.player_id is not null and exists(select 1 from public.match_events e
    where e.match_id=new.match_id and e.player_id=new.player_id and e.voided_at is null
    group by e.player_id having count(*) filter(where e.type='YELLOW_CARD')>=2
      or count(*) filter(where e.type='RED_CARD')>0) then
    raise exception 'El jugador no puede registrar nuevas acciones en este partido por sus tarjetas.';
  end if;
  if new.player_id is not null then
    select * into p from public.players where id=new.player_id for share;
    if not found or p.team_id<>new.team_id or not p.active then
      raise exception 'Selecciona un jugador activo del equipo correspondiente.';
    end if;
    select shirt_number into jersey from public.match_players
      where match_id=m.id and player_id=p.id and team_id=new.team_id and active;
    if not found then raise exception 'El jugador no está convocado para este partido.'; end if;
    new.player_name:=p.full_name;
    new.shirt_number:=jersey;
  end if;
  return new;
end $$;

create or replace function public.edit_match_event_player(p_match_id uuid,p_event_id uuid,p_player_id uuid,p_expected_player_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; e public.match_events%rowtype;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  select * into e from public.match_events where id=p_event_id and match_id=m.id for update;
  if not found then raise exception 'El evento no pertenece a este partido.'; end if;
  if m.status='PROGRAMADO' or m.walkover_loser_team_id is not null then raise exception 'No se pueden editar eventos de un partido programado o resuelto por W.O.'; end if;
  if e.voided_at is not null or e.player_id is null or e.type not in ('GOAL','YELLOW_CARD','RED_CARD') then raise exception 'Este evento no permite editar jugador.'; end if;
  if e.player_id=p_player_id then return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id)); end if;
  if e.player_id is distinct from p_expected_player_id then raise exception 'El evento cambió. Actualiza antes de editar.'; end if;
  update public.match_events set player_id=p_player_id where id=e.id returning * into e;
  return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
end $$;

create or replace function public.void_match_event(p_match_id uuid,p_event_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; e public.match_events%rowtype;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  select * into e from public.match_events where id=p_event_id and match_id=m.id for update;
  if not found then raise exception 'El evento no pertenece a este partido.'; end if;
  if e.voided_at is not null then return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id)); end if;
  if m.status='PROGRAMADO' then raise exception 'El partido aún no comenzó.'; end if;
  -- Revertir la solicitud activa termina solo esa pausa y conserva los segundos.
  if e.type='TIMEOUT' and m.status='TIEMPO_MUERTO'
    and e.created_at=m.timeout_started_at and e.team_id=m.timeout_team_id then
    perform public.finish_match_timeout(m.id,m.timeout_started_at,false);
  end if;
  update public.match_events set voided_at=clock_timestamp() where id=e.id returning * into e;
  return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
end $$;

create function public.record_walkover(p_match_id uuid,p_loser_team_id uuid,p_request_id uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype;
begin
  if p_request_id is null then raise exception 'Falta el identificador de la solicitud.'; end if;
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  if p_loser_team_id is null or p_loser_team_id not in (m.home_team_id,m.away_team_id) then raise exception 'Selecciona uno de los dos equipos del partido.'; end if;
  if m.walkover_loser_team_id is not null then
    if m.walkover_loser_team_id=p_loser_team_id and m.walkover_request_id=p_request_id then return public.get_match_control(m.id); end if;
    raise exception 'El partido ya tiene un W.O. confirmado. Actualiza antes de continuar.';
  end if;
  if p_expected_updated_at is null or m.updated_at is distinct from p_expected_updated_at then raise exception 'El partido cambió. Actualiza antes de confirmar el W.O.'; end if;
  perform 1 from public.categories where id=m.category_id for update;
  if m.stage='REGULAR' and exists(select 1 from public.categories where id=m.category_id and regular_closed_at is not null) then
    raise exception 'La fase regular está cerrada. El W.O. requiere revisar clasificados y eliminatorias.';
  end if;
  update public.matches set walkover_loser_team_id=p_loser_team_id,walkover_request_id=p_request_id,
    walkover_recorded_at=clock_timestamp(),status='FINALIZADO',paused_from_status=null,phase_started_at=null,
    timeout_started_at=null,timeout_team_id=null,tiebreak_winner_team_id=null,
    phase_elapsed_seconds=least(900,phase_elapsed_seconds+case when phase_started_at is null then 0 else greatest(0,floor(extract(epoch from clock_timestamp()-phase_started_at)))::integer end)
    where id=m.id;
  return public.get_match_control(m.id);
end $$;
revoke all on function public.record_walkover(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.record_walkover(uuid,uuid,uuid,timestamptz) to anon;
-- Se conservan permisos/RLS y Realtime existentes. W.O. modifica matches, nunca crea GOAL.
-- match_outcome y get_tournament consumen el score del snapshot; get_top_scorers no cambia.
notify pgrst, 'reload schema';
commit;
