-- Aplicar después de 012. Conserva todos los partidos y goles históricos.
begin;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  full_name text not null check(full_name=btrim(full_name) and full_name<>''),
  shirt_number integer not null check(shirt_number between 0 and 99),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(id,team_id)
);
create unique index players_active_number on public.players(team_id,shirt_number) where active;
alter table public.players enable row level security;
revoke all on public.players from anon,authenticated;
grant select on public.players to anon;
grant insert(team_id,full_name,shirt_number,active),update(full_name,shirt_number,active) on public.players to anon;
create policy players_read on public.players for select to anon using(true);
create policy players_insert on public.players for insert to anon with check (
  exists(select 1 from public.teams t where t.id=team_id and t.active and t.deleted_at is null)
);
create policy players_update on public.players for update to anon using (
  exists(select 1 from public.teams t where t.id=team_id and t.deleted_at is null)
) with check (
  exists(select 1 from public.teams t where t.id=team_id and t.deleted_at is null)
);

alter table public.match_events
  add column player_id uuid,
  add column player_name text,
  add column shirt_number integer,
  add constraint match_events_player_team foreign key(player_id,team_id) references public.players(id,team_id),
  add constraint match_events_player_snapshot check (
    (player_id is null and player_name is null and shirt_number is null)
    or (player_id is not null and player_name is not null and shirt_number is not null)
  );
-- Sustituye solo la lista de tipos permitidos; no elimina ni reescribe eventos.
alter table public.match_events drop constraint match_events_type_check;
alter table public.match_events add constraint match_events_type_check check(type in ('GOAL','FOUL','YELLOW_CARD','TIMEOUT'));
alter table public.match_events add constraint match_events_card_player check(type<>'YELLOW_CARD' or player_id is not null);
create index match_events_player on public.match_events(player_id) where player_id is not null;
create unique index match_events_timeout_once on public.match_events(match_id,team_id,period)
  where type='TIMEOUT' and voided_at is null;

create or replace function public.guard_tournament_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; closed_at timestamptz; p public.players%rowtype;
begin
  select * into m from public.matches where id=new.match_id for update;
  select regular_closed_at into closed_at from public.categories where id=m.category_id for update;
  if m.stage='REGULAR' and closed_at is not null then raise exception 'La fase regular está cerrada.'; end if;
  if m.status='FINALIZADO' then raise exception 'No se pueden modificar eventos de un partido finalizado.'; end if;
  if TG_OP='UPDATE' and (to_jsonb(new)-'voided_at') is distinct from (to_jsonb(old)-'voided_at') then
    raise exception 'Solo se permite anular el evento, no editarlo.';
  end if;
  if TG_OP='INSERT' and new.player_id is not null then
    select * into p from public.players where id=new.player_id for share;
    if not found or p.team_id<>new.team_id or not p.active then
      raise exception 'Selecciona un jugador activo del equipo correspondiente.';
    end if;
    new.player_name:=p.full_name;
    new.shirt_number:=p.shirt_number;
  end if;
  return new;
end $$;

create or replace function public.clear_penalties_after_goal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.type='GOAL' and (TG_OP='INSERT' or new.voided_at is distinct from old.voided_at) then
    update public.matches set tiebreak_winner_team_id=null
      where id=new.match_id and tiebreak_winner_team_id is not null;
  end if;
  return new;
end $$;

-- Extiende el mismo snapshot consumido por control, match_outcome y get_tournament.
create or replace function public.get_match_control(p_match_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select jsonb_build_object(
    'match',to_jsonb(m),'server_now',clock_timestamp(),
    'category',(select name from public.categories where id=m.category_id),
    'matchday',(select number from public.matchdays where id=m.matchday_id),
    'home',(select name from public.teams where id=m.home_team_id),
    'away',(select name from public.teams where id=m.away_team_id),
    'score',jsonb_build_object('home',events.home_count,'away',events.away_count),
    'goals',events.goals,'events',events.all_events,
    'players',coalesce((select jsonb_agg(to_jsonb(p) order by p.shirt_number,p.id)
      from public.players p where p.team_id in (m.home_team_id,m.away_team_id) and p.active),'[]'::jsonb)
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

create function public.record_match_event(p_match_id uuid,p_team_id uuid,p_type text,p_player_id uuid,p_request_id uuid)
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
  return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
end $$;

-- Se mantiene record_goal(uuid,uuid,uuid) para clientes e intenciones antiguas.
-- Sus reintentos no pueden confundirse con faltas, tarjetas ni tiempos muertos.
create or replace function public.record_goal(p_match_id uuid,p_team_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; e public.match_events%rowtype; server_time timestamptz; seconds integer;
begin
  if p_request_id is null then raise exception 'Falta el identificador de la solicitud.'; end if;
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  select * into e from public.match_events where request_id=p_request_id;
  if found then
    if e.match_id<>p_match_id or e.team_id is distinct from p_team_id or e.type<>'GOAL' or e.player_id is not null then
      raise exception 'La solicitud ya corresponde a otro gol.';
    end if;
    return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
  end if;
  if m.status not in ('PRIMER_TIEMPO','SEGUNDO_TIEMPO') then raise exception 'Solo se permiten goles durante el primer o segundo tiempo.'; end if;
  if p_team_id is null or p_team_id not in (m.home_team_id,m.away_team_id) then raise exception 'El equipo no participa en este partido.'; end if;
  server_time:=clock_timestamp();
  seconds:=least(900,m.phase_elapsed_seconds+greatest(0,floor(extract(epoch from server_time-m.phase_started_at)))::integer);
  insert into public.match_events(match_id,team_id,type,period,clock_seconds,created_at,request_id)
    values(m.id,p_team_id,'GOAL',m.status,seconds,server_time,p_request_id) returning * into e;
  return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
end $$;

create function public.void_match_event(p_match_id uuid,p_event_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; e public.match_events%rowtype;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  select * into e from public.match_events where id=p_event_id and match_id=m.id for update;
  if not found then raise exception 'El evento no pertenece a este partido.'; end if;
  if e.voided_at is not null then return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id)); end if;
  if m.status not in ('PRIMER_TIEMPO','SEGUNDO_TIEMPO','DESCANSO','PAUSADO') then raise exception 'No se pueden anular eventos en un partido programado o finalizado.'; end if;
  update public.match_events set voided_at=clock_timestamp() where id=e.id returning * into e;
  return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
end $$;

create function public.get_top_scorers(p_category_id uuid default null)
returns table("position" bigint,player_id uuid,player_name text,team_id uuid,team_name text,category_id uuid,goals bigint)
language sql stable security invoker set search_path='' as $$
  with totals as (
    select p.id,p.full_name,p.team_id,t.name,t.category_id,count(*) goals
    from public.match_events e join public.players p on p.id=e.player_id
    join public.teams t on t.id=e.team_id join public.matches m on m.id=e.match_id
    where e.type='GOAL' and e.voided_at is null and m.status<>'PROGRAMADO'
      and (p_category_id is null or m.category_id=p_category_id)
    group by p.id,p.full_name,p.team_id,t.name,t.category_id
  ) select rank() over(order by totals.goals desc),id,full_name,totals.team_id,name,totals.category_id,totals.goals
    from totals order by totals.goals desc,full_name,name,id;
$$;

revoke all on function public.record_match_event(uuid,uuid,text,uuid,uuid),public.void_match_event(uuid,uuid),public.get_top_scorers(uuid) from public,anon,authenticated;
grant execute on function public.record_match_event(uuid,uuid,text,uuid,uuid),public.void_match_event(uuid,uuid),public.get_top_scorers(uuid) to anon;
alter publication supabase_realtime add table public.players;
commit;
