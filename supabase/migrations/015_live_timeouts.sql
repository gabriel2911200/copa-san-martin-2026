-- Pausa real de 60 segundos. No modifica filas ni eventos existentes.
begin;
alter table public.matches
  add column timeout_started_at timestamptz,
  add column timeout_team_id uuid references public.teams(id);
alter table public.matches drop constraint matches_status_check;
alter table public.matches add constraint matches_status_check check(status in
  ('PROGRAMADO','PRIMER_TIEMPO','DESCANSO','SEGUNDO_TIEMPO','PAUSADO','TIEMPO_MUERTO','FINALIZADO'));
alter table public.matches drop constraint valid_pause;
alter table public.matches add constraint valid_pause check (
  (status='PAUSADO' and paused_from_status is not null and paused_from_status in ('PRIMER_TIEMPO','DESCANSO','SEGUNDO_TIEMPO'))
  or (status='TIEMPO_MUERTO' and paused_from_status is not null and paused_from_status in ('PRIMER_TIEMPO','SEGUNDO_TIEMPO'))
  or (status not in ('PAUSADO','TIEMPO_MUERTO') and paused_from_status is null)
);
alter table public.matches drop constraint valid_clock;
alter table public.matches add constraint valid_clock check (
  (status in ('PRIMER_TIEMPO','DESCANSO','SEGUNDO_TIEMPO') and phase_started_at is not null)
  or (status in ('PROGRAMADO','PAUSADO','TIEMPO_MUERTO','FINALIZADO') and phase_started_at is null)
);
alter table public.matches add constraint matches_timeout_state check (
  (status='TIEMPO_MUERTO' and timeout_started_at is not null and timeout_team_id is not null
    and timeout_team_id in (home_team_id,away_team_id))
  or (status<>'TIEMPO_MUERTO' and timeout_started_at is null and timeout_team_id is null)
);
drop index public.matches_one_active;
create unique index matches_one_active on public.matches((true))
  where status in ('PRIMER_TIEMPO','DESCANSO','SEGUNDO_TIEMPO','PAUSADO','TIEMPO_MUERTO');

-- Lectura efectiva: al vencer el minuto el reloj corre desde el vencimiento,
-- incluso si no hay administrador conectado para materializar la reanudación.
create function public.match_clock_json(m public.matches, at_time timestamptz) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select case when m.status='TIEMPO_MUERTO' and at_time>=m.timeout_started_at+interval '60 seconds'
    then to_jsonb(m)||jsonb_build_object('status',m.paused_from_status,'paused_from_status',null,
      'phase_started_at',m.timeout_started_at+interval '60 seconds')
    else to_jsonb(m) end;
$$;
revoke all on function public.match_clock_json(public.matches,timestamptz) from public,anon,authenticated;
grant execute on function public.match_clock_json(public.matches,timestamptz) to anon;

-- El instante de inicio identifica esta pausa: una petición tardía nunca termina otra.
create function public.finish_match_timeout(p_match_id uuid,p_timeout_started_at timestamptz,p_automatic boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; server_time timestamptz;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  server_time:=clock_timestamp();
  if m.status<>'TIEMPO_MUERTO' or p_timeout_started_at is null or m.timeout_started_at is distinct from p_timeout_started_at then
    return public.get_match_control(m.id);
  end if;
  if p_automatic is null then raise exception 'Indica el modo de finalización.'; end if;
  if p_automatic and server_time<m.timeout_started_at+interval '60 seconds' then
    return public.get_match_control(m.id);
  end if;
  update public.matches set status=m.paused_from_status,paused_from_status=null,
    phase_started_at=least(server_time,m.timeout_started_at+interval '60 seconds'),
    timeout_started_at=null,timeout_team_id=null where id=m.id;
  return public.get_match_control(m.id);
end $$;
revoke all on function public.finish_match_timeout(uuid,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.finish_match_timeout(uuid,timestamptz,boolean) to anon;

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
    if m.status<>'TIEMPO_MUERTO' then raise exception 'No hay tiempo muerto activo.'; end if;
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

create or replace function public.record_match_event(p_match_id uuid,p_team_id uuid,p_type text,p_player_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; e public.match_events%rowtype; server_time timestamptz; seconds integer;
begin
  if p_request_id is null then raise exception 'Falta el identificador de la solicitud.'; end if;
  if p_type is null or p_type not in ('GOAL','FOUL','YELLOW_CARD','TIMEOUT') then raise exception 'Tipo de evento inválido.'; end if;
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  select * into e from public.match_events where request_id=p_request_id;
  if found then
    if (e.match_id,e.team_id,e.type,e.player_id) is distinct from (p_match_id,p_team_id,p_type,p_player_id) then
      raise exception 'La solicitud ya corresponde a otro evento.';
    end if;
    return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
  end if;
  if m.status='TIEMPO_MUERTO' and clock_timestamp()>=m.timeout_started_at+interval '60 seconds' then
    perform public.finish_match_timeout(m.id,m.timeout_started_at,true);
    select * into m from public.matches where id=p_match_id;
  end if;
  if m.status not in ('PRIMER_TIEMPO','SEGUNDO_TIEMPO') then raise exception 'Solo se registran eventos durante los tiempos de juego.'; end if;
  if p_team_id is null or p_team_id not in (m.home_team_id,m.away_team_id) then raise exception 'El equipo no participa en este partido.'; end if;
  if p_type in ('GOAL','YELLOW_CARD') and p_player_id is null then raise exception 'Selecciona un jugador.'; end if;
  if p_type in ('FOUL','TIMEOUT') and p_player_id is not null then raise exception 'Este evento corresponde al equipo.'; end if;
  if p_type='TIMEOUT' and exists(select 1 from public.match_events where match_id=m.id and team_id=p_team_id
    and period=m.status and type='TIMEOUT' and voided_at is null) then
    raise exception 'El equipo ya utilizó su tiempo muerto en este periodo.';
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
      count(e.id) filter (where e.team_id=m.home_team_id) as home_goals,
      count(e.id) filter (where e.team_id=m.away_team_id) as away_goals
    from eligible_matches m left join public.match_events e
      on e.match_id=m.id and e.type='GOAL' and e.voided_at is null
    group by m.id,m.home_team_id,m.away_team_id
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

commit;
