-- Ejecutar después de 015. Amplía eventos sin reescribir filas históricas.
begin;
alter table public.match_events drop constraint match_events_type_check;
alter table public.match_events add constraint match_events_type_check
  check(type in ('GOAL','FOUL','YELLOW_CARD','RED_CARD','TIMEOUT'));
alter table public.match_events drop constraint match_events_card_player;
alter table public.match_events add constraint match_events_card_player
  check(type not in ('YELLOW_CARD','RED_CARD') or player_id is not null);

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
declare m public.matches%rowtype; e public.match_events%rowtype; server_time timestamptz; seconds integer;
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

commit;
