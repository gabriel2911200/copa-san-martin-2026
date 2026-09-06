begin;
-- No rellena ni modifica fechas existentes: NULL significa agenda individual pendiente.
alter table public.matches add column scheduled_date date, add column scheduled_time time;
alter table public.matches add constraint matches_schedule_time check(scheduled_time is null or scheduled_date is not null);
alter table public.teams add column deleted_at timestamptz;
alter table public.teams add constraint teams_archived_inactive check(deleted_at is null or not active);
grant insert(scheduled_date,scheduled_time) on public.matches to anon;
create or replace function public.guard_tournament_match() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.categories%rowtype; day_number integer; sf public.matches%rowtype;
  winners uuid[] := array[]::uuid[]; losers uuid[] := array[]::uuid[]; outcome jsonb;
  h bigint; a bigint;
begin
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
    if old.status='FINALIZADO' and new is distinct from old then
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
    if h<>a and new.tiebreak_winner_team_id is not null then raise exception 'Solo se usan penales con marcador empatado.'; end if;
    if new.status='FINALIZADO' and h=a and new.tiebreak_winner_team_id is null then
      raise exception 'Elige el ganador por penales antes de finalizar.';
    end if;
  end if;
  return new;
end $$;
create function public.reschedule_match(p_match_id uuid,p_date date,p_time time,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  if m.updated_at is distinct from p_expected_updated_at then raise exception 'El partido cambió. Actualiza antes de guardar.'; end if;
  if p_time is not null and p_date is null then raise exception 'Selecciona una fecha para asignar la hora.'; end if;
  update public.matches set scheduled_date=p_date,scheduled_time=p_time where id=m.id;
  return public.get_match_control(m.id);
end $$;
-- Baja lógica: conserva IDs, goles, rivales, clasificados y todas sus relaciones.
create function public.archive_team(p_team_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.teams set deleted_at=clock_timestamp(),active=false where id=p_team_id and deleted_at is null;
  if not found and not exists(select 1 from public.teams where id=p_team_id) then raise exception 'El equipo no existe.'; end if;
end $$;
revoke all on function public.reschedule_match(uuid,date,time,timestamptz),public.archive_team(uuid) from public,anon,authenticated;
grant execute on function public.reschedule_match(uuid,date,time,timestamptz),public.archive_team(uuid) to anon;
commit;