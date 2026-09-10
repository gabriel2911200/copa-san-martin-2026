begin;
-- Conserva la versión instalada del guard y sus reglas de anulación.
do $$ declare definition text; original text := 'if new.type in (''GOAL'',''YELLOW_CARD'',''RED_CARD'') and new.player_id is null then';
begin
  select pg_get_functiondef('public.guard_tournament_event()'::regprocedure) into definition;
  if position(original in definition)=0 then raise exception 'Versión inesperada de guard_tournament_event'; end if;
  execute replace(definition,original,
    'if new.type in (''GOAL'',''YELLOW_CARD'',''RED_CARD'') and new.player_id is null and not (new.type=''GOAL'' and coalesce(new.player_name,'''')=''Autogol'' and new.shirt_number is null) then');
end $$;

create function public.record_own_goal(p_match_id uuid,p_team_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; e public.match_events%rowtype; server_time timestamptz; seconds integer;
begin
  if p_request_id is null then raise exception 'Falta el identificador de la solicitud.'; end if;
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  select * into e from public.match_events where request_id=p_request_id;
  if found then
    if (e.match_id,e.team_id,e.type,e.player_id,e.player_name,e.shirt_number)
      is distinct from (p_match_id,p_team_id,'GOAL'::text,null::uuid,'Autogol'::text,null::integer) then
      raise exception 'La solicitud ya corresponde a otro evento.';
    end if;
    return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
  end if;
  if exists(select 1 from public.match_foul_counters where p_request_id=any(request_ids)) then
    raise exception 'La solicitud ya corresponde a otra operación.';
  end if;
  if m.status='TIEMPO_MUERTO' and clock_timestamp()>=m.timeout_started_at+interval '60 seconds' then
    perform public.finish_match_timeout(m.id,m.timeout_started_at,true);
    select * into m from public.matches where id=p_match_id;
  end if;
  if m.status not in ('PRIMER_TIEMPO','SEGUNDO_TIEMPO') then raise exception 'Solo se registran autogoles durante los tiempos de juego.'; end if;
  if p_team_id is null or p_team_id not in (m.home_team_id,m.away_team_id) then raise exception 'El equipo no participa en este partido.'; end if;
  server_time:=clock_timestamp();
  seconds:=least(900,m.phase_elapsed_seconds+greatest(0,floor(extract(epoch from server_time-m.phase_started_at)))::integer);
  insert into public.match_events(match_id,team_id,type,player_id,player_name,shirt_number,period,clock_seconds,created_at,request_id)
    values(m.id,p_team_id,'GOAL',null,'Autogol',null,m.status,seconds,server_time,p_request_id) returning * into e;
  return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
end $$;
revoke all on function public.record_own_goal(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_own_goal(uuid,uuid,uuid) to anon;
notify pgrst, 'reload schema';
commit;
