-- Aplicar una sola vez. No modifica partidos existentes ni match_events.
begin;

alter table public.matches add constraint matches_phase_time_limit check (
  phase_elapsed_seconds <= case
    when status = 'PROGRAMADO' then 0
    when status = 'DESCANSO' or (status = 'PAUSADO' and paused_from_status = 'DESCANSO') then 300
    else 900 end
);

-- Lectura con hora de servidor para no depender del reloj del teléfono.
create function public.get_match_control(p_match_id uuid) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select jsonb_build_object(
    'match', to_jsonb(m), 'server_now', clock_timestamp(),
    'category', (select name from public.categories where id = m.category_id),
    'matchday', (select number from public.matchdays where id = m.matchday_id),
    'home', (select name from public.teams where id = m.home_team_id),
    'away', (select name from public.teams where id = m.away_team_id)
  ) from public.matches m where m.id = p_match_id;
$$;

create function public.control_match(
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
      if m.status <> 'PRIMER_TIEMPO' or elapsed < 900 then
        raise exception 'Debes completar el primer tiempo antes del descanso.';
      end if;
      next_status := 'DESCANSO'; elapsed := 0; next_started := server_time;
    when 'SECOND_HALF' then
      if m.status <> 'DESCANSO' or elapsed < 300 then
        raise exception 'Debes completar los cinco minutos de descanso.';
      end if;
      next_status := 'SEGUNDO_TIEMPO'; elapsed := 0; next_started := server_time;
    when 'FINISH' then
      if m.status <> 'SEGUNDO_TIEMPO' or elapsed < 900 then
        raise exception 'Solo puedes finalizar después de completar el segundo tiempo.';
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

revoke all on function public.get_match_control(uuid) from public, anon, authenticated;
revoke all on function public.control_match(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.get_match_control(uuid) to anon;
grant execute on function public.control_match(uuid, text, timestamptz) to anon;
-- Sin nuevos grants UPDATE/DELETE ni cambios en las políticas RLS existentes.
commit;
