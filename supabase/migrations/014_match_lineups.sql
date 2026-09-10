-- El dorsal pertenece a la convocatoria, nunca al registro de jugadores.
-- Conserva jugadores y todos los snapshots históricos de match_events.
begin;
create table public.match_players (
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null,
  team_id uuid not null,
  shirt_number integer not null check(shirt_number between 0 and 99),
  active boolean not null default true,
  primary key(match_id,player_id),
  foreign key(player_id,team_id) references public.players(id,team_id)
);
create unique index match_players_number on public.match_players(match_id,team_id,shirt_number) where active;
alter table public.match_players enable row level security;
revoke all on public.match_players from anon,authenticated;
grant select on public.match_players to anon;
create policy match_players_read on public.match_players for select to anon using(true);

-- Sustituye la validación de 013: el dorsal sale de la convocatoria bloqueada
-- por la misma fila de partido que serializa eventos y control del reloj.
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
  if new.type in ('GOAL','YELLOW_CARD') and new.player_id is null then
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

create function public.set_match_player(p_match_id uuid,p_player_id uuid,p_shirt_number integer,p_active boolean,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; p public.players%rowtype; previous public.match_players%rowtype;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  if p_expected_updated_at is null or m.updated_at is distinct from p_expected_updated_at then
    raise exception 'El partido cambió. Actualiza antes de guardar la convocatoria.';
  end if;
  if m.status='FINALIZADO' then raise exception 'La convocatoria de un partido finalizado no se puede modificar.'; end if;
  if m.stage='REGULAR' and exists(select 1 from public.categories where id=m.category_id and regular_closed_at is not null) then
    raise exception 'La fase regular está cerrada.';
  end if;
  if p_active is null or p_shirt_number is null or p_shirt_number not between 0 and 99 then
    raise exception 'Indica un dorsal entre 0 y 99.';
  end if;
  select * into p from public.players where id=p_player_id for share;
  if not found or p.team_id not in (m.home_team_id,m.away_team_id) then
    raise exception 'El jugador debe pertenecer a un equipo del partido.';
  end if;
  if p_active and not p.active then raise exception 'El jugador está inactivo.'; end if;
  select * into previous from public.match_players where match_id=m.id and player_id=p.id;
  if found and (previous.shirt_number,previous.active) is distinct from (p_shirt_number,p_active)
    and exists(select 1 from public.match_events where match_id=m.id and player_id=p.id) then
    raise exception 'El jugador ya tiene eventos: conserva su convocatoria y dorsal en este partido.';
  end if;
  insert into public.match_players(match_id,player_id,team_id,shirt_number,active)
    values(m.id,p.id,p.team_id,p_shirt_number,p_active)
    on conflict(match_id,player_id) do update set shirt_number=excluded.shirt_number,active=excluded.active;
  -- Invalida controles y convocatorias desactualizados de otros dispositivos.
  update public.matches set updated_at=clock_timestamp() where id=m.id;
  return public.get_match_control(m.id);
exception when unique_violation then
  raise exception 'Ese dorsal ya está asignado a otro jugador del equipo en este partido.';
end $$;
revoke all on function public.set_match_player(uuid,uuid,integer,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.set_match_player(uuid,uuid,integer,boolean,timestamptz) to anon;

-- Se elimina solo el atributo global obsoleto, no jugadores ni dorsales históricos.
-- El índice y CHECK exclusivos de esta columna desaparecen con ella.
alter table public.players drop column shirt_number;
alter publication supabase_realtime add table public.match_players;
commit;
