-- Aplicar una sola vez. Conserva eventos, constraints y tipos existentes.
begin;
-- NULL permite conservar eventos históricos sin inventar una intención original.
-- La RPC exige request_id en cada nuevo gol.
alter table public.match_events
  add column request_id uuid unique,
  add constraint match_events_clock_limit check (clock_seconds <= 900);

-- Una sola consulta: marcador e historial salen del mismo conjunto de eventos.
create or replace function public.get_match_control(p_match_id uuid) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select jsonb_build_object(
    'match', to_jsonb(m), 'server_now', clock_timestamp(),
    'category', (select name from public.categories where id = m.category_id),
    'matchday', (select number from public.matchdays where id = m.matchday_id),
    'home', (select name from public.teams where id = m.home_team_id),
    'away', (select name from public.teams where id = m.away_team_id),
    'score', jsonb_build_object('home', goals.home_count, 'away', goals.away_count),
    'goals', goals.events
  ) from public.matches m
  cross join lateral (
    select
      count(*) filter (where e.voided_at is null and e.team_id=m.home_team_id) as home_count,
      count(*) filter (where e.voided_at is null and e.team_id=m.away_team_id) as away_count,
      coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object(
        'period_number', case e.period when 'PRIMER_TIEMPO' then 1 else 2 end
      ) order by e.created_at, e.id) filter (where e.voided_at is null), '[]'::jsonb) as events
    from public.match_events e where e.match_id=m.id and e.type='GOAL'
  ) goals
  where m.id=p_match_id;
$$;

create function public.record_goal(p_match_id uuid, p_team_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.matches%rowtype;
  e public.match_events%rowtype;
  server_time timestamptz;
  seconds integer;
begin
  if p_request_id is null then raise exception 'Falta el identificador de la solicitud.'; end if;
  -- Misma fila que control_match y void_goal: serializa goles y cambios de fase.
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  select * into e from public.match_events where request_id=p_request_id;
  if found then
    if e.match_id<>p_match_id or e.team_id is distinct from p_team_id then
      raise exception 'La solicitud ya corresponde a otro gol.';
    end if;
    -- Un reintento devuelve el evento original, incluso anulado o con fase cambiada.
    return jsonb_build_object('event', to_jsonb(e), 'control', public.get_match_control(m.id));
  end if;
  if m.status not in ('PRIMER_TIEMPO','SEGUNDO_TIEMPO') then
    raise exception 'Solo se permiten goles durante el primer o segundo tiempo.';
  end if;
  if p_team_id is null or p_team_id not in (m.home_team_id,m.away_team_id) then
    raise exception 'El equipo no participa en este partido.';
  end if;
  server_time := clock_timestamp();
  seconds := least(900, m.phase_elapsed_seconds +
    greatest(0, floor(extract(epoch from server_time-m.phase_started_at)))::integer);
  -- period conserva su CHECK textual: PRIMER_TIEMPO = 1T, SEGUNDO_TIEMPO = 2T.
  insert into public.match_events(match_id,team_id,type,period,clock_seconds,created_at,request_id)
    values(m.id,p_team_id,'GOAL',m.status,seconds,server_time,p_request_id) returning * into e;
  return jsonb_build_object('event', to_jsonb(e), 'control', public.get_match_control(m.id));
end;
$$;

create function public.void_goal(p_match_id uuid, p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.matches%rowtype; e public.match_events%rowtype;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  select * into e from public.match_events where id=p_event_id and match_id=m.id for update;
  if not found or e.type<>'GOAL' then raise exception 'El gol no pertenece a este partido.'; end if;
  if e.voided_at is not null then
    return jsonb_build_object('event', to_jsonb(e), 'control', public.get_match_control(m.id));
  end if;
  if m.status not in ('PRIMER_TIEMPO','SEGUNDO_TIEMPO','DESCANSO','PAUSADO') then
    raise exception 'No se pueden anular goles en un partido programado o finalizado.';
  end if;
  update public.match_events set voided_at=clock_timestamp() where id=e.id returning * into e;
  return jsonb_build_object('event', to_jsonb(e), 'control', public.get_match_control(m.id));
end;
$$;

revoke all on function public.record_goal(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.void_goal(uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_goal(uuid,uuid,uuid) to anon;
grant execute on function public.void_goal(uuid,uuid) to anon;
-- RLS y SELECT existentes se conservan. Sin INSERT/UPDATE/DELETE directos.
commit;
