-- Local audit fixes. No row changes occur when this migration is applied.
begin;
-- Delete downstream fixtures only through an explicit operation before deleting
-- their sources. Closing a category freezes regular results, including deletion.
create or replace function public.delete_match(p_match_id uuid,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare m public.matches%rowtype; previous_context text;
begin
 select * into m from public.matches where id=p_match_id for update;
 if not found then return; end if;
 if p_expected_updated_at is null or m.updated_at is distinct from p_expected_updated_at then raise exception 'El partido cambió. Actualiza antes de eliminar.'; end if;
 perform 1 from public.categories where id=m.category_id for update;
 if m.stage='REGULAR' and exists(select 1 from public.categories where id=m.category_id and regular_closed_at is not null) then raise exception 'No se puede eliminar: la clasificación regular está cerrada.'; end if;
 if m.stage='SEMIFINAL' and exists(select 1 from public.matches where category_id=m.category_id and stage in('FINAL','THIRD_PLACE')) then raise exception 'No se puede eliminar: existen final o tercer puesto dependientes.'; end if;
 previous_context:=current_setting('copa.deleting_match',true);
 perform set_config('copa.deleting_match',m.id::text,true);
 delete from public.match_events where match_id=m.id;
 delete from public.matches where id=m.id;
 perform set_config('copa.deleting_match',coalesce(previous_context,''),true);
end $$;
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
      if m.status='FINALIZADO' and m.stage in('SEMIFINAL','FINAL','THIRD_PLACE') then
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

create or replace function public.reset_tournament(p_confirmation text,p_expected_generation uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare state private.tournament_reset_state%rowtype; mid uuid;
begin
  if p_confirmation is distinct from 'REINICIAR' or p_request_id is null then
    raise exception 'Escribe exactamente REINICIAR para confirmar.';
  end if;
  select * into state from private.tournament_reset_state where singleton for update;
  if state.last_request_id=p_request_id then
    return jsonb_build_object('reset',true,'replayed',true);
  end if;
  if p_expected_generation is null or p_expected_generation is distinct from state.generation then
    raise exception 'El campeonato ya fue reiniciado. Cierra este diálogo y revisa los datos actuales.';
  end if;
  -- Serialize ordinary mutations; a timeout/deadlock aborts the whole transaction.
  lock table public.matches,public.categories,public.teams,public.players,public.matchdays,
    public.match_events,public.match_players,public.match_prechecks,public.match_foul_counters,
    public.player_initial_goals,public.penalty_shootouts,public.penalty_shootout_attempts,
    public.penalty_shootout_operations in access exclusive mode;
  update public.categories set regular_closed_at=null,qualified_team_ids=null;
  -- Reuse trusted event deletion, never disable triggers. Child match data cascades.
  for mid in select id from public.matches order by case stage when 'FINAL' then 0 when 'THIRD_PLACE' then 0 when 'SEMIFINAL' then 1 else 2 end,id loop
    perform public.delete_match(mid,(select updated_at from public.matches where id=mid));
  end loop;
  delete from public.player_initial_goals;
  delete from public.players;
  delete from public.teams;
  update public.matchdays set date=null;
  update private.tournament_reset_state set generation=gen_random_uuid(),last_request_id=p_request_id
    where singleton;
  return jsonb_build_object('reset',true,'replayed',false);
end $$;

notify pgrst,'reload schema';
commit;
