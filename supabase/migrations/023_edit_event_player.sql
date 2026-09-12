begin;
-- Amplía únicamente la asociación de jugador; conserva las reglas instaladas de anulación.
do $$ declare definition text; marker text := 'if TG_OP=''UPDATE'' then';
begin
  select pg_get_functiondef('public.guard_tournament_event()'::regprocedure) into definition;
  if position(marker in definition)=0 then raise exception 'Guard de eventos inesperado'; end if;
  execute replace(definition,marker,$guard$
  if TG_OP='UPDATE' and new.player_id is distinct from old.player_id then
    if old.voided_at is not null or old.player_id is null or old.type not in ('GOAL','YELLOW_CARD','RED_CARD')
      or (to_jsonb(new)-array['player_id','player_name','shirt_number']) is distinct from (to_jsonb(old)-array['player_id','player_name','shirt_number']) then
      raise exception 'Solo se puede corregir el jugador de un evento válido.';
    end if;
    select * into p from public.players where id=new.player_id for share;
    if not found or not p.active or p.team_id<>old.team_id then raise exception 'Selecciona un jugador activo del mismo equipo.'; end if;
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
  $guard$);
end $$;

create function public.edit_match_event_player(p_match_id uuid,p_event_id uuid,p_player_id uuid,p_expected_player_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; e public.match_events%rowtype;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  select * into e from public.match_events where id=p_event_id and match_id=m.id for update;
  if not found then raise exception 'El evento no pertenece a este partido.'; end if;
  if m.status in ('PROGRAMADO','FINALIZADO') then raise exception 'Solo se corrigen eventos durante el control de un partido en curso.'; end if;
  if e.voided_at is not null or e.player_id is null or e.type not in ('GOAL','YELLOW_CARD','RED_CARD') then raise exception 'Este evento no permite editar jugador.'; end if;
  if e.player_id=p_player_id then return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id)); end if;
  if e.player_id is distinct from p_expected_player_id then raise exception 'El evento cambió. Actualiza antes de editar.'; end if;
  update public.match_events set player_id=p_player_id where id=e.id returning * into e;
  return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
end $$;
revoke all on function public.edit_match_event_player(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.edit_match_event_player(uuid,uuid,uuid,uuid) to anon;
notify pgrst, 'reload schema';
commit;
