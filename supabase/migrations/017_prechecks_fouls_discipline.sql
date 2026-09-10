-- Después de 016. Sin reescribir partidos, jugadores ni eventos existentes.
begin;
create table public.match_prechecks (
  match_id uuid primary key references public.matches(id) on delete cascade,
  home_team_id uuid not null references public.teams(id),
  away_team_id uuid not null references public.teams(id),
  home_ball boolean not null, home_band boolean not null,
  away_ball boolean not null, away_band boolean not null,
  created_at timestamptz not null default clock_timestamp()
);
create table public.match_foul_counters (
  match_id uuid not null references public.matches(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  period text not null check(period in ('PRIMER_TIEMPO','SEGUNDO_TIEMPO')),
  count integer not null check(count>0),
  -- Claves de deduplicación, no eventos de falta ni datos de minuto/jugador.
  request_ids uuid[] not null,
  primary key(match_id,team_id,period),
  check(cardinality(request_ids)=count)
);
alter table public.match_prechecks enable row level security;
alter table public.match_foul_counters enable row level security;
revoke all on public.match_prechecks,public.match_foul_counters from anon,authenticated;
grant select on public.match_prechecks,public.match_foul_counters to anon;
create policy match_prechecks_read on public.match_prechecks for select to anon using(true);
create policy match_foul_counters_read on public.match_foul_counters for select to anon using(true);
alter publication supabase_realtime add table public.match_prechecks,public.match_foul_counters;

create function public.require_match_precheck() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status='PROGRAMADO' and new.status='PRIMER_TIEMPO' and not exists(
    select 1 from public.match_prechecks where match_id=new.id
      and home_team_id=new.home_team_id and away_team_id=new.away_team_id) then
    raise exception 'Completa el control previo de balón y cintillo antes de iniciar.';
  end if;
  return new;
end $$;
create trigger match_precheck_start before update of status on public.matches
  for each row execute function public.require_match_precheck();

create or replace function public.get_match_control(p_match_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select jsonb_build_object(
    'match',public.match_clock_json(m,clock_timestamp()),'server_now',clock_timestamp(),
    'category',(select name from public.categories where id=m.category_id),
    'matchday',(select number from public.matchdays where id=m.matchday_id),
    'home',(select name from public.teams where id=m.home_team_id),
    'away',(select name from public.teams where id=m.away_team_id),
    'score',jsonb_build_object('home',events.home_count,'away',events.away_count),
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

create or replace function public.guard_tournament_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; closed_at timestamptz; p public.players%rowtype; jersey integer;
begin
  select * into m from public.matches where id=new.match_id for update;
  select regular_closed_at into closed_at from public.categories where id=m.category_id for update;
  if m.stage='REGULAR' and closed_at is not null then raise exception 'La fase regular está cerrada.'; end if;
  if m.status='FINALIZADO' then raise exception 'No se pueden modificar eventos de un partido finalizado.'; end if;
  if TG_OP='UPDATE' then
    if (to_jsonb(new)-'voided_at') is distinct from (to_jsonb(old)-'voided_at') then
      raise exception 'Solo se permite anular el evento, no editarlo.';
    end if;
    return new; -- Las anulaciones históricas no requieren una convocatoria nueva.
  end if;
  if exists(select 1 from unnest(array[m.home_team_id,m.away_team_id]) t(id)
    where not exists(select 1 from public.match_players mp join public.players roster_player on roster_player.id=mp.player_id
      where mp.match_id=m.id and mp.team_id=t.id and mp.active and roster_player.active)) then
    raise exception 'Completa la convocatoria de ambos equipos antes de registrar eventos.';
  end if;
  if new.type in ('GOAL','YELLOW_CARD','RED_CARD') and new.player_id is null then
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

create or replace function public.record_match_event(p_match_id uuid,p_team_id uuid,p_type text,p_player_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; e public.match_events%rowtype; server_time timestamptz; seconds integer; counter public.match_foul_counters%rowtype;
begin
  if p_request_id is null then raise exception 'Falta el identificador de la solicitud.'; end if;
  if p_type is null or p_type not in ('GOAL','FOUL','YELLOW_CARD','RED_CARD','TIMEOUT') then raise exception 'Tipo de evento inválido.'; end if;
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  select * into e from public.match_events where request_id=p_request_id;
  if found then
    if (e.match_id,e.team_id,e.type,e.player_id) is distinct from (p_match_id,p_team_id,p_type,p_player_id) then
      raise exception 'La solicitud ya corresponde a otro evento.';
    end if;
    return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
  end if;
  select * into counter from public.match_foul_counters where p_request_id=any(request_ids);
  if found then
    if (counter.match_id,counter.team_id,p_type,p_player_id is null) is distinct from (p_match_id,p_team_id,'FOUL',true) then
      raise exception 'La solicitud ya corresponde a otra operación.';
    end if;
    return jsonb_build_object('event',jsonb_build_object('id',p_request_id,'type','FOUL'),'control',public.get_match_control(m.id));
  end if;
  if m.status='TIEMPO_MUERTO' and clock_timestamp()>=m.timeout_started_at+interval '60 seconds' then
    perform public.finish_match_timeout(m.id,m.timeout_started_at,true);
    select * into m from public.matches where id=p_match_id;
  end if;
  if m.status not in ('PRIMER_TIEMPO','SEGUNDO_TIEMPO') then raise exception 'Solo se registran eventos durante los tiempos de juego.'; end if;
  if p_team_id is null or p_team_id not in (m.home_team_id,m.away_team_id) then raise exception 'El equipo no participa en este partido.'; end if;
  if p_type in ('GOAL','YELLOW_CARD','RED_CARD') and p_player_id is null then raise exception 'Selecciona un jugador.'; end if;
  if p_type in ('FOUL','TIMEOUT') and p_player_id is not null then raise exception 'Este evento corresponde al equipo.'; end if;
  if p_type='TIMEOUT' and exists(select 1 from public.match_events where match_id=m.id and team_id=p_team_id
    and period=m.status and type='TIMEOUT' and voided_at is null) then
    raise exception 'El equipo ya utilizó su minuto en este periodo.';
  end if;
  if p_type='FOUL' then
    if m.stage='REGULAR' and exists(select 1 from public.categories where id=m.category_id and regular_closed_at is not null) then
      raise exception 'La fase regular está cerrada.';
    end if;
    if exists(select 1 from unnest(array[m.home_team_id,m.away_team_id]) t(id)
      where not exists(select 1 from public.match_players mp join public.players p on p.id=mp.player_id
        where mp.match_id=m.id and mp.team_id=t.id and mp.active and p.active)) then
      raise exception 'Completa la convocatoria de ambos equipos antes de registrar faltas.';
    end if;
    insert into public.match_foul_counters(match_id,team_id,period,count,request_ids)
      values(m.id,p_team_id,m.status,1,array[p_request_id])
      on conflict(match_id,team_id,period) do update
        set count=public.match_foul_counters.count+1,
            request_ids=array_append(public.match_foul_counters.request_ids,p_request_id);
    return jsonb_build_object('event',jsonb_build_object('id',p_request_id,'type','FOUL'),'control',public.get_match_control(m.id));
  end if;
  server_time:=clock_timestamp();
  seconds:=least(900,m.phase_elapsed_seconds+greatest(0,floor(extract(epoch from server_time-m.phase_started_at)))::integer);
  insert into public.match_events(match_id,team_id,type,player_id,period,clock_seconds,created_at,request_id)
    values(m.id,p_team_id,p_type,p_player_id,m.status,seconds,server_time,p_request_id) returning * into e;
  if p_type='TIMEOUT' then
    update public.matches set status='TIEMPO_MUERTO',paused_from_status=m.status,
      phase_elapsed_seconds=seconds,phase_started_at=null,
      timeout_started_at=server_time,timeout_team_id=p_team_id where id=m.id;
  end if;
  return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
end $$;


create function public.save_match_precheck(p_match_id uuid,p_home_ball boolean,p_home_band boolean,p_away_ball boolean,p_away_band boolean,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; previous public.match_prechecks%rowtype;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  if p_home_ball is null or p_home_band is null or p_away_ball is null or p_away_band is null then raise exception 'Responde las cuatro preguntas.'; end if;
  select * into previous from public.match_prechecks where match_id=m.id;
  if found and (previous.home_ball,previous.home_band,previous.away_ball,previous.away_band,previous.home_team_id,previous.away_team_id)
    is not distinct from (p_home_ball,p_home_band,p_away_ball,p_away_band,m.home_team_id,m.away_team_id) then
    return public.get_match_control(m.id);
  end if;
  if m.status<>'PROGRAMADO' then raise exception 'El control previo solo se modifica antes del inicio.'; end if;
  if p_expected_updated_at is null or m.updated_at is distinct from p_expected_updated_at then raise exception 'El partido cambió. Actualiza antes de guardar.'; end if;
  insert into public.match_prechecks(match_id,home_team_id,away_team_id,home_ball,home_band,away_ball,away_band)
    values(m.id,m.home_team_id,m.away_team_id,p_home_ball,p_home_band,p_away_ball,p_away_band)
    on conflict(match_id) do update set home_team_id=excluded.home_team_id,away_team_id=excluded.away_team_id,
      home_ball=excluded.home_ball,home_band=excluded.home_band,away_ball=excluded.away_ball,away_band=excluded.away_band;
  update public.matches set updated_at=clock_timestamp() where id=m.id;
  return public.get_match_control(m.id);
end $$;
revoke all on function public.save_match_precheck(uuid,boolean,boolean,boolean,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.save_match_precheck(uuid,boolean,boolean,boolean,boolean,timestamptz) to anon;
revoke all on function public.require_match_precheck() from public,anon,authenticated;
create or replace function public.control_match(
  p_match_id uuid, p_action text, p_expected_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches%rowtype;
  server_time timestamptz;
  elapsed integer;
  phase_limit integer;
  next_status text;
  next_paused text;
  next_started timestamptz;
  violated_constraint text;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  if p_expected_updated_at is null or m.updated_at is distinct from p_expected_updated_at then
    raise exception 'El partido cambió en otro dispositivo. Actualiza antes de continuar.';
  end if;
  if p_action='END_TIMEOUT' then
    if m.status<>'TIEMPO_MUERTO' then raise exception 'No hay minuto activo.'; end if;
    return public.finish_match_timeout(m.id,m.timeout_started_at,false);
  end if;
  if m.status='TIEMPO_MUERTO' and clock_timestamp()>=m.timeout_started_at+interval '60 seconds' then
    perform public.finish_match_timeout(m.id,m.timeout_started_at,true);
    select * into m from public.matches where id=p_match_id;
  end if;
  server_time := clock_timestamp();
  phase_limit := case when m.status = 'DESCANSO' or
    (m.status = 'PAUSADO' and m.paused_from_status = 'DESCANSO') then 300 else 900 end;
  elapsed := least(phase_limit, m.phase_elapsed_seconds +
    case when m.phase_started_at is null then 0
    else greatest(0, floor(extract(epoch from server_time - m.phase_started_at)))::integer end);
  next_status := m.status;
  next_paused := null;
  next_started := null;

  case p_action
    when 'START' then
      if m.status <> 'PROGRAMADO' then raise exception 'Solo puedes iniciar un partido PROGRAMADO.'; end if;
      next_status := 'PRIMER_TIEMPO'; elapsed := 0; next_started := server_time;
    when 'PAUSE' then
      if m.status not in ('PRIMER_TIEMPO', 'DESCANSO', 'SEGUNDO_TIEMPO') then
        raise exception 'Solo puedes pausar una fase en curso.';
      end if;
      next_status := 'PAUSADO'; next_paused := m.status;
    when 'RESUME' then
      if m.status <> 'PAUSADO' then raise exception 'El partido no está pausado.'; end if;
      next_status := m.paused_from_status; next_started := server_time;
    when 'BREAK' then
      if m.status <> 'PRIMER_TIEMPO' then
        raise exception 'Solo puedes terminar el primer tiempo cuando está en curso.';
      end if;
      next_status := 'DESCANSO'; elapsed := 0; next_started := server_time;
    when 'SECOND_HALF' then
      if m.status <> 'DESCANSO' then
        raise exception 'Solo puedes finalizar el descanso cuando está en curso.';
      end if;
      next_status := 'SEGUNDO_TIEMPO'; elapsed := 0; next_started := server_time;
    when 'FINISH' then
      if m.status <> 'SEGUNDO_TIEMPO' then
        raise exception 'Solo puedes finalizar durante el segundo tiempo.';
      end if;
      next_status := 'FINALIZADO';
    else raise exception 'Acción de control inválida.';
  end case;

  -- Columnas exclusivamente temporales. El trigger existente actualiza updated_at.
  update public.matches set status = next_status, paused_from_status = next_paused,
    phase_elapsed_seconds = elapsed, phase_started_at = next_started
    where id = p_match_id;
  return public.get_match_control(p_match_id);
exception when unique_violation then
  get stacked diagnostics violated_constraint = CONSTRAINT_NAME;
  if violated_constraint = 'matches_one_active' then
    raise exception 'Ya existe un partido activo. Finalízalo antes de iniciar otro.';
  end if;
  raise;
end;
$$;

commit;
