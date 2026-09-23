-- Change only activation and first-attempt selection. Keep the 026 rules intact.
begin;
alter table public.penalty_shootouts alter column first_team_id drop not null;
-- Retire the old public preselection entry point; existing shootouts are untouched.
revoke all on function public.start_penalty_shootout(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;

create function public.open_penalty_shootout(p_match_id uuid,p_request_id uuid,p_expected_updated_at timestamptz) returns jsonb
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
 seconds:=m.phase_elapsed_seconds+case when m.phase_started_at is null then 0 else greatest(0,floor(extract(epoch from clock_timestamp()-m.phase_started_at)))::integer end;
 if seconds<900 then raise exception 'El tiempo reglamentario todavía no terminó.'; end if;
 j:=public.get_match_control(m.id);
 if j->'score'->>'home'<>j->'score'->>'away' then raise exception 'El marcador reglamentario debe estar empatado.'; end if;
 if m.status='SEGUNDO_TIEMPO' then perform public.control_match(m.id,'PAUSE',m.updated_at); end if;
 insert into public.penalty_shootouts(match_id,request_id) values(m.id,p_request_id);
 return public.get_match_control(m.id);
end $$;

alter function public.manage_penalty_shootout(uuid,text,uuid,uuid,boolean,uuid,integer) rename to manage_penalty_shootout_before_027;
revoke all on function public.manage_penalty_shootout_before_027(uuid,text,uuid,uuid,boolean,uuid,integer) from public,anon,authenticated;
create function public.manage_penalty_shootout(p_match_id uuid,p_action text,p_team_id uuid,p_attempt_id uuid,p_converted boolean,p_request_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; s public.penalty_shootouts%rowtype;
begin
 select * into m from public.matches where id=p_match_id for update;
 select * into s from public.penalty_shootouts where match_id=p_match_id for update;
 if not found then raise exception 'Inicia primero la tanda.'; end if;
 if p_action='RECORD' and s.first_team_id is null then
   if p_team_id is null or p_team_id not in(m.home_team_id,m.away_team_id) then raise exception 'Equipo ajeno al partido.'; end if;
   if p_expected_revision is distinct from s.revision then raise exception 'La tanda cambió. Actualiza antes de continuar.'; end if;
   -- Same transaction as the first kick: any validation failure rolls this back.
   update public.penalty_shootouts set first_team_id=p_team_id where match_id=m.id;
 end if;
 return public.manage_penalty_shootout_before_027(p_match_id,p_action,p_team_id,p_attempt_id,p_converted,p_request_id,p_expected_revision);
end $$;
revoke all on function public.open_penalty_shootout(uuid,uuid,timestamptz),public.manage_penalty_shootout(uuid,text,uuid,uuid,boolean,uuid,integer) from public,anon,authenticated;
grant execute on function public.open_penalty_shootout(uuid,uuid,timestamptz),public.manage_penalty_shootout(uuid,text,uuid,uuid,boolean,uuid,integer) to anon;
commit;
