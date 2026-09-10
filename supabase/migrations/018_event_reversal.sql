-- Aplicar después de 017. Solo funciones; no modifica registros al aplicarse.
begin;
create or replace function public.guard_tournament_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; closed_at timestamptz; p public.players%rowtype; jersey integer; h bigint; a bigint; before_h bigint; before_a bigint;
begin
  select * into m from public.matches where id=new.match_id for update;
  select regular_closed_at into closed_at from public.categories where id=m.category_id for update;
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
commit;
