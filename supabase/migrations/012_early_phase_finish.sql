-- Corte manual anticipado. No modifica filas, tablas, eventos ni permisos existentes.
begin;

create or replace function public.control_match(
  p_match_id uuid, p_action text, p_expected_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches%rowtype;
  server_time timestamptz;
  elapsed integer;
  phase_limit integer;
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
  server_time := clock_timestamp();
  phase_limit := case when m.status = 'DESCANSO' or
    (m.status = 'PAUSADO' and m.paused_from_status = 'DESCANSO') then 300 else 900 end;
  elapsed := least(phase_limit, m.phase_elapsed_seconds +
    case when m.phase_started_at is null then 0
    else greatest(0, floor(extract(epoch from server_time - m.phase_started_at)))::integer end);
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

-- Permite resolver también una eliminatoria empatada antes de 15:00.
create or replace function public.set_penalty_winner(p_match_id uuid,p_team_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; h bigint; a bigint;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'Partido inexistente.'; end if;
  if m.stage='REGULAR' or m.status<>'SEGUNDO_TIEMPO' then raise exception 'Penales solo en el segundo tiempo de una eliminatoria.'; end if;
  if p_team_id is null or p_team_id not in (m.home_team_id,m.away_team_id) then raise exception 'El ganador debe participar en el partido.'; end if;
  select count(*) filter(where team_id=m.home_team_id),count(*) filter(where team_id=m.away_team_id)
    into h,a from public.match_events where match_id=m.id and type='GOAL' and voided_at is null;
  if h<>a then raise exception 'El marcador no está empatado.'; end if;
  update public.matches set tiebreak_winner_team_id=p_team_id where id=m.id;
  return public.get_match_control(m.id);
end $$;

commit;
