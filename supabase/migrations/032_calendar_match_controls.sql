-- Requested calendar reopening uses the existing administration client.
-- Applying this migration does not update or delete historical rows.
begin;
alter table private.match_reopen_audit alter column actor drop not null;
create or replace function public.reopen_match(p_match_id uuid,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; previous jsonb; claims jsonb; restored jsonb;
begin
 claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 select * into m from public.matches where id=p_match_id for update;
 if not found then raise exception 'El partido no existe.'; end if;
 perform 1 from public.categories where id=m.category_id for update;
 if m.status<>'FINALIZADO' or p_expected_updated_at is distinct from m.updated_at then raise exception 'El partido cambió. Actualiza antes de reabrir.'; end if;
 if m.walkover_loser_team_id is not null then raise exception 'Un resultado W.O. requiere revisión administrativa.'; end if;
 if m.tiebreak_winner_team_id is not null and not exists(select 1 from public.penalty_shootouts where match_id=m.id) then raise exception 'El ganador por penales es histórico y no tiene lanzamientos registrados. Requiere revisión antes de reabrir.'; end if;
 if m.stage='REGULAR' and exists(select 1 from public.categories where id=m.category_id and regular_closed_at is not null) then raise exception 'La clasificación ya está cerrada. Revisa los cruces antes de reabrir.'; end if;
 if m.stage='SEMIFINAL' and exists(select 1 from public.matches where category_id=m.category_id and stage in('FINAL','THIRD_PLACE')) then raise exception 'Existen cruces dependientes. Requieren revisión antes de reabrir.'; end if;
 select state into previous from private.match_finish_snapshots where match_id=m.id;
 -- Legacy matches retain their stored second-half time without reconstructing events.
 restored:=jsonb_build_object('status','PAUSADO','paused_from_status',coalesce(previous->>'paused_from_status',nullif(previous->>'status','FINALIZADO'),'SEGUNDO_TIEMPO'),'phase_elapsed_seconds',coalesce((previous->>'phase_elapsed_seconds')::integer,m.phase_elapsed_seconds));
 insert into private.match_reopen_audit(match_id,actor,final_updated_at,before_state,restored_state) values(m.id,nullif(claims->>'sub','')::uuid,m.updated_at,to_jsonb(m)||jsonb_build_object('shootout',public.penalty_shootout_snapshot(m.id)),restored);
 update public.penalty_shootouts set completed_at=null,revision=revision+1 where match_id=m.id;
 update public.matches set tiebreak_winner_team_id=null,status='PAUSADO',paused_from_status=restored->>'paused_from_status',phase_elapsed_seconds=(restored->>'phase_elapsed_seconds')::integer,phase_started_at=null where id=m.id;
 return public.get_match_control(m.id);
end $$;

revoke all on function public.reopen_match(uuid,timestamptz) from public;
grant execute on function public.reopen_match(uuid,timestamptz) to anon,authenticated;
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
 if not(m.stage in('SEMIFINAL','FINAL','THIRD_PLACE','FRIENDLY')) or m.walkover_loser_team_id is not null or m.tiebreak_winner_team_id is not null
   or not(m.status='SEGUNDO_TIEMPO' or (m.status='PAUSADO' and m.paused_from_status='SEGUNDO_TIEMPO')) then
   raise exception 'Solo se inicia una tanda eliminatoria sin ganador al terminar el segundo tiempo.';
 end if;
 seconds:=public.match_elapsed_seconds(m,clock_timestamp());
 if seconds<m.period_duration_seconds then raise exception 'El tiempo reglamentario todavía no terminó.'; end if;
 j:=public.get_match_control(m.id);
 if j->'score'->>'home'<>j->'score'->>'away' then raise exception 'El marcador reglamentario debe estar empatado.'; end if;
 if m.status='SEGUNDO_TIEMPO' then perform public.control_match(m.id,'PAUSE',m.updated_at); end if;
 if m.stage='FRIENDLY' then update public.matches set friendly_penalties=true where id=m.id; end if;
 insert into public.penalty_shootouts(match_id,request_id) values(m.id,p_request_id);
 return public.get_match_control(m.id);
end $$;



create or replace function public.get_tournament() returns jsonb
language sql volatile security invoker set search_path='' as $$
  select jsonb_build_object(
    'categories',coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('qualified',
      coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by q.ord)
        from unnest(c.qualified_team_ids) with ordinality q(id,ord) join public.teams t on t.id=q.id),'[]'::jsonb)
    ) order by c.name) from public.categories c),'[]'::jsonb),
    'matchdays',coalesce((select jsonb_agg(to_jsonb(d) order by d.number) from public.matchdays d),'[]'::jsonb),
    'matches',coalesce((select jsonb_agg(public.match_outcome(m.id) order by d.number,c.name,m.created_at,m.id)
      from public.matches m join public.matchdays d on d.id=m.matchday_id join public.categories c on c.id=m.category_id),'[]'::jsonb)
  );
$$;


notify pgrst,'reload schema';
commit;
