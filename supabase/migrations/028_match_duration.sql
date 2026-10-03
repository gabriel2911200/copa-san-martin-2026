-- Per-match duration. Apply after 027; existing rows retain 15-minute periods.
begin;
alter table public.matches add column period_duration_seconds integer not null default 900
 check (period_duration_seconds in (900,1200));

create function public.match_phase_limit(p_status text,p_paused_from text,p_duration integer)
returns integer language sql immutable set search_path='' as $$
 select case when p_status='PROGRAMADO' then 0
   when p_status='DESCANSO' or (p_status='PAUSADO' and p_paused_from='DESCANSO') then 300
   else p_duration end;
$$;
create function public.match_elapsed_seconds(m public.matches,at_time timestamptz)
returns integer language sql immutable set search_path='' as $$
 select least(public.match_phase_limit(m.status,m.paused_from_status,m.period_duration_seconds),
 m.phase_elapsed_seconds + case when m.phase_started_at is null then 0
 else greatest(0,floor(extract(epoch from at_time-m.phase_started_at)))::integer end);
$$;
revoke all on function public.match_phase_limit(text,text,integer),public.match_elapsed_seconds(public.matches,timestamptz) from public,anon,authenticated;
-- CHECK expressions execute with the caller's rights.
grant execute on function public.match_phase_limit(text,text,integer) to anon,authenticated;
alter table public.matches drop constraint matches_phase_time_limit;
alter table public.matches add constraint matches_phase_time_limit check
 (phase_elapsed_seconds <= public.match_phase_limit(status,paused_from_status,period_duration_seconds));
-- The row-specific bound is enforced by a trigger; PostgreSQL CHECK cannot read another table.
alter table public.match_events drop constraint match_events_clock_limit;
create function public.guard_match_duration() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.period_duration_seconds is distinct from old.period_duration_seconds and
   (old.status<>'PROGRAMADO' or old.phase_elapsed_seconds<>0 or old.phase_started_at is not null) then
   raise exception 'La duraci?n solo se cambia antes de iniciar el partido.';
 end if;
 return new;
end $$;
create trigger guard_match_duration before update on public.matches
 for each row execute function public.guard_match_duration();
create function public.guard_event_duration() returns trigger
language plpgsql security definer set search_path='' as $$
declare duration integer;
begin
 select period_duration_seconds into duration from public.matches where id=new.match_id for update;
 if duration is null or new.clock_seconds>duration then raise exception 'El tiempo del evento excede la duraci?n del partido.'; end if;
 return new;
end $$;
create trigger guard_event_duration before insert or update on public.match_events
 for each row execute function public.guard_event_duration();
revoke all on function public.guard_match_duration(),public.guard_event_duration() from public,anon,authenticated;

create or replace function public.guard_tournament_match() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.categories%rowtype; day_number integer; sf public.matches%rowtype;
  winners uuid[] := array[]::uuid[]; losers uuid[] := array[]::uuid[]; outcome jsonb;
  h bigint; a bigint;
begin
  if TG_OP='UPDATE' and old.status='PROGRAMADO' and
    (to_jsonb(new)-array['period_duration_seconds','updated_at']) =
    (to_jsonb(old)-array['period_duration_seconds','updated_at']) then return new; end if;
  if TG_OP='UPDATE' and old.walkover_loser_team_id is not null and
    (to_jsonb(new)-array['scheduled_date','scheduled_time','updated_at']) is distinct from
    (to_jsonb(old)-array['scheduled_date','scheduled_time','updated_at']) then
    raise exception 'El resultado W.O. ya está fijado. Requiere revisión administrativa.';
  end if;
  if new.walkover_loser_team_id is not null and (TG_OP='INSERT' or old.walkover_loser_team_id is null) then
    if exists(select 1 from public.match_events where match_id=new.id and voided_at is null)
      or exists(select 1 from public.match_foul_counters where match_id=new.id) then
      raise exception 'No se puede aplicar W.O. con eventos válidos o faltas acumuladas. Anula los eventos; los contadores de faltas requieren revisión administrativa.';
    end if;
    if new.stage='SEMIFINAL' and exists(select 1 from public.matches where category_id=new.category_id and stage in ('FINAL','THIRD_PLACE')) then
      raise exception 'No se puede aplicar W.O.: ya existen final o tercer puesto dependientes.';
    end if;
  end if;
  -- Permite exclusivamente cambios de agenda sin tocar el resultado ni su identidad.
  if TG_OP='UPDATE' and
    (to_jsonb(new)-array['scheduled_date','scheduled_time','updated_at']) =
    (to_jsonb(old)-array['scheduled_date','scheduled_time','updated_at']) then
    return new;
  end if;
  select * into c from public.categories where id=new.category_id for update;
  if new.stage='REGULAR' and c.regular_closed_at is not null then
    raise exception 'La fase regular está cerrada; no se pueden cambiar sus partidos.';
  end if;
  if TG_OP='UPDATE' then
    if (new.category_id,new.matchday_id,new.home_team_id,new.away_team_id,new.stage)
      is distinct from (old.category_id,old.matchday_id,old.home_team_id,old.away_team_id,old.stage) then
      raise exception 'No se permite cambiar la identidad de un partido.';
    end if;
    if old.status='FINALIZADO' and new is distinct from old and new.walkover_loser_team_id is null then
      raise exception 'El partido finalizado no se puede modificar.';
    end if;
  else
    select number into day_number from public.matchdays where id=new.matchday_id;
    if new.stage='REGULAR' and day_number not between 1 and 4 then raise exception 'Jornada regular inválida.'; end if;
    if new.stage<>'REGULAR' then
      if c.regular_closed_at is null then raise exception 'Cierra primero la fase regular.'; end if;
      if new.stage='SEMIFINAL' then
        if day_number<>5 or not(new.home_team_id=any(c.qualified_team_ids)) or not(new.away_team_id=any(c.qualified_team_ids)) then
          raise exception 'Las semifinales deben usar Top 4 y Fecha 5.';
        end if;
        if (select count(*) from public.matches where category_id=c.id and stage='SEMIFINAL')>=2
          or exists(select 1 from public.matches where category_id=c.id and stage='SEMIFINAL'
            and (home_team_id in (new.home_team_id,new.away_team_id) or away_team_id in (new.home_team_id,new.away_team_id))) then
          raise exception 'Equipo repetido o semifinales ya creadas.';
        end if;
      else
        if day_number<>6 then raise exception 'Final y tercer puesto corresponden a Fecha 6.'; end if;
        for sf in select * from public.matches where category_id=c.id and stage='SEMIFINAL' order by created_at,id loop
          outcome := public.match_outcome(sf.id);
          if not (outcome->>'resolved')::boolean then raise exception 'Ambas semifinales deben estar resueltas.'; end if;
          winners:=array_append(winners,(outcome->>'winner_team_id')::uuid);
          losers:=array_append(losers,(outcome->>'loser_team_id')::uuid);
        end loop;
        if cardinality(winners)<>2 then raise exception 'Faltan las dos semifinales.'; end if;
        if new.stage='FINAL' and (new.home_team_id<>winners[1] or new.away_team_id<>winners[2]) then raise exception 'Finalistas incorrectos.'; end if;
        if new.stage='THIRD_PLACE' and (new.home_team_id<>losers[1] or new.away_team_id<>losers[2]) then raise exception 'Participantes de tercer puesto incorrectos.'; end if;
      end if;
    end if;
  end if;
  if new.stage<>'REGULAR' then
    select count(*) filter(where team_id=new.home_team_id),count(*) filter(where team_id=new.away_team_id)
      into h,a from public.match_events where match_id=new.id and type='GOAL' and voided_at is null;
    if new.walkover_loser_team_id is not null then
      h:=case when new.walkover_loser_team_id=new.home_team_id then 0 else 3 end;
      a:=case when new.walkover_loser_team_id=new.away_team_id then 0 else 3 end;
    end if;
    if h<>a and new.tiebreak_winner_team_id is not null then raise exception 'Solo se usan penales con marcador empatado.'; end if;
    if new.status='FINALIZADO' and h=a and new.tiebreak_winner_team_id is null then
      raise exception 'Elige el ganador por penales antes de finalizar.';
    end if;
  end if;
  return new;
end $$;

create or replace function public.control_match(
  p_match_id uuid, p_action text, p_expected_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches%rowtype;
  server_time timestamptz;
  elapsed integer;
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
  elapsed := public.match_elapsed_seconds(m,server_time);
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
  seconds:=public.match_elapsed_seconds(m,server_time);
  insert into public.match_events(match_id,team_id,type,player_id,period,clock_seconds,created_at,request_id)
    values(m.id,p_team_id,p_type,p_player_id,m.status,seconds,server_time,p_request_id) returning * into e;
  if p_type='TIMEOUT' then
    update public.matches set status='TIEMPO_MUERTO',paused_from_status=m.status,
      phase_elapsed_seconds=seconds,phase_started_at=null,
      timeout_started_at=server_time,timeout_team_id=p_team_id where id=m.id;
  end if;
  return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
end $$;

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
  seconds:=public.match_elapsed_seconds(m,server_time);
  insert into public.match_events(match_id,team_id,type,period,clock_seconds,created_at,request_id)
    values(m.id,p_team_id,'GOAL',m.status,seconds,server_time,p_request_id) returning * into e;
  return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
end $$;

create or replace function public.record_own_goal(p_match_id uuid,p_team_id uuid,p_request_id uuid)
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
  seconds:=public.match_elapsed_seconds(m,server_time);
  insert into public.match_events(match_id,team_id,type,player_id,player_name,shirt_number,period,clock_seconds,created_at,request_id)
    values(m.id,p_team_id,'GOAL',null,'Autogol',null,m.status,seconds,server_time,p_request_id) returning * into e;
  return jsonb_build_object('event',to_jsonb(e),'control',public.get_match_control(m.id));
end $$;

create or replace function public.record_walkover(p_match_id uuid,p_loser_team_id uuid,p_request_id uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype;
begin
  if p_request_id is null then raise exception 'Falta el identificador de la solicitud.'; end if;
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  if p_loser_team_id is null or p_loser_team_id not in (m.home_team_id,m.away_team_id) then raise exception 'Selecciona uno de los dos equipos del partido.'; end if;
  if m.walkover_loser_team_id is not null then
    if m.walkover_loser_team_id=p_loser_team_id and m.walkover_request_id=p_request_id then return public.get_match_control(m.id); end if;
    raise exception 'El partido ya tiene un W.O. confirmado. Actualiza antes de continuar.';
  end if;
  if p_expected_updated_at is null or m.updated_at is distinct from p_expected_updated_at then raise exception 'El partido cambió. Actualiza antes de confirmar el W.O.'; end if;
  perform 1 from public.categories where id=m.category_id for update;
  if m.stage='REGULAR' and exists(select 1 from public.categories where id=m.category_id and regular_closed_at is not null) then
    raise exception 'La fase regular está cerrada. El W.O. requiere revisar clasificados y eliminatorias.';
  end if;
  update public.matches set walkover_loser_team_id=p_loser_team_id,walkover_request_id=p_request_id,
    walkover_recorded_at=clock_timestamp(),status='FINALIZADO',paused_from_status=null,phase_started_at=null,
    timeout_started_at=null,timeout_team_id=null,tiebreak_winner_team_id=null,
    phase_elapsed_seconds=public.match_elapsed_seconds(m,clock_timestamp())
    where id=m.id;
  return public.get_match_control(m.id);
end $$;

create or replace function public.start_penalty_shootout(p_match_id uuid,p_first_team_id uuid,p_request_id uuid,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; s public.penalty_shootouts%rowtype; j jsonb; seconds integer;
begin
 select * into m from public.matches where id=p_match_id for update;
 if not found then raise exception 'Partido inexistente.'; end if;
 select * into s from public.penalty_shootouts where match_id=m.id;
 if found then
   if s.request_id=p_request_id and s.first_team_id=p_first_team_id then return public.get_match_control(m.id); end if;
   raise exception 'La tanda ya fue iniciada. Actualiza el partido.';
 end if;
 if p_request_id is null or p_first_team_id is null or p_first_team_id not in(m.home_team_id,m.away_team_id) then raise exception 'Selecciona el primer equipo.'; end if;
 if p_expected_updated_at is distinct from m.updated_at then raise exception 'El partido cambió. Actualiza.'; end if;
 if m.stage='REGULAR' or m.walkover_loser_team_id is not null or m.tiebreak_winner_team_id is not null
   or not(m.status='SEGUNDO_TIEMPO' or (m.status='PAUSADO' and m.paused_from_status='SEGUNDO_TIEMPO')) then
   raise exception 'Solo se inicia una tanda eliminatoria sin ganador al terminar el segundo tiempo.';
 end if;
 seconds:=public.match_elapsed_seconds(m,clock_timestamp());
 if seconds<m.period_duration_seconds then raise exception 'El tiempo reglamentario todavía no terminó.'; end if;
 j:=public.get_match_control(m.id);
 if j->'score'->>'home'<>j->'score'->>'away' then raise exception 'El marcador reglamentario debe estar empatado.'; end if;
 if m.status='SEGUNDO_TIEMPO' then perform public.control_match(m.id,'PAUSE',m.updated_at); end if;
 insert into public.penalty_shootouts(match_id,first_team_id,request_id) values(m.id,p_first_team_id,p_request_id);
 return public.get_match_control(m.id);
end $$;

create or replace function public.open_penalty_shootout(p_match_id uuid,p_request_id uuid,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; j jsonb; seconds integer;
begin
 select * into m from public.matches where id=p_match_id for update;
 if not found then raise exception 'Partido inexistente.'; end if;
 -- Multiple controllers may open the same panel; never reset its order or history.
 if exists(select 1 from public.penalty_shootouts where match_id=m.id) then return public.get_match_control(m.id); end if;
 if p_request_id is null then raise exception 'Falta identificador de solicitud.'; end if;
 if p_expected_updated_at is distinct from m.updated_at then raise exception 'El partido cambió. Actualiza.'; end if;
 if m.stage not in('SEMIFINAL','FINAL','THIRD_PLACE') or m.walkover_loser_team_id is not null or m.tiebreak_winner_team_id is not null
   or not(m.status='SEGUNDO_TIEMPO' or (m.status='PAUSADO' and m.paused_from_status='SEGUNDO_TIEMPO')) then
   raise exception 'Solo se inicia una tanda eliminatoria sin ganador al terminar el segundo tiempo.';
 end if;
 seconds:=public.match_elapsed_seconds(m,clock_timestamp());
 if seconds<m.period_duration_seconds then raise exception 'El tiempo reglamentario todavía no terminó.'; end if;
 j:=public.get_match_control(m.id);
 if j->'score'->>'home'<>j->'score'->>'away' then raise exception 'El marcador reglamentario debe estar empatado.'; end if;
 if m.status='SEGUNDO_TIEMPO' then perform public.control_match(m.id,'PAUSE',m.updated_at); end if;
 insert into public.penalty_shootouts(match_id,request_id) values(m.id,p_request_id);
 return public.get_match_control(m.id);
end $$;

create function public.set_match_duration(p_match_id uuid,p_seconds integer,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype;
begin
 select * into m from public.matches where id=p_match_id for update;
 if not found then raise exception 'El partido no existe.'; end if;
 if p_seconds is null or p_seconds not in(900,1200) then raise exception 'Selecciona 15 o 20 minutos.'; end if;
 if m.status<>'PROGRAMADO' then raise exception 'La duraci?n solo se cambia antes de iniciar el partido.'; end if;
 if p_expected_updated_at is null or p_expected_updated_at is distinct from m.updated_at then raise exception 'El partido cambi?. Actualiza antes de guardar.'; end if;
 update public.matches set period_duration_seconds=p_seconds where id=m.id;
 return public.get_match_control(m.id);
end $$;
revoke all on function public.set_match_duration(uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.set_match_duration(uuid,integer,timestamptz) to anon;
-- Replacements retain existing grants, including the retired start_penalty_shootout restriction.
-- finish_match_timeout and match_clock_json already preserve elapsed seconds and use only the 60s timeout.
notify pgrst,'reload schema';
commit;
