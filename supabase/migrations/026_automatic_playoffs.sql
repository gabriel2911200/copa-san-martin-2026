begin;
-- Historical administrative results remain versioned, never reconstructed.
alter table public.penalty_shootouts add column rule_set text not null default 'LEGACY_ADMIN'
 check(rule_set in('LEGACY_ADMIN','FIVE_ALTERNATING'));
alter table public.penalty_shootouts alter column rule_set set default 'FIVE_ALTERNATING';
update public.penalty_shootouts set rule_set='FIVE_ALTERNATING' where completed_at is null;

create function public.penalty_decision(p_home uuid,p_away uuid,p_attempts jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare k jsonb; nh integer:=0; na integer:=0; h integer:=0; a integer:=0; n integer:=0; winner uuid;
begin
 for k in select value from jsonb_array_elements(p_attempts) loop
   n:=n+1;
   if (k->>'team_id')::uuid=p_home then nh:=nh+1; h:=h+case when (k->>'converted')::boolean then 1 else 0 end;
   else na:=na+1; a:=a+case when (k->>'converted')::boolean then 1 else 0 end; end if;
   if nh<=5 and na<=5 then
     if h>a+(5-na) then winner:=p_home;
     elsif a>h+(5-nh) then winner:=p_away; end if;
   elsif nh=na and h<>a then winner:=case when h>a then p_home else p_away end;
   end if;
   if winner is not null then return jsonb_build_object('winner_team_id',winner,'decided_at',n); end if;
 end loop;
 return jsonb_build_object('winner_team_id',null,'decided_at',null);
end $$;

alter function public.penalty_shootout_snapshot(uuid) rename to penalty_shootout_snapshot_before_026;
create function public.penalty_shootout_snapshot(p_match_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.penalty_shootout_snapshot_before_026(p_match_id) || jsonb_build_object('rule_set',rule_set,'initial_attempts',5)
 from public.penalty_shootouts where match_id=p_match_id;
$$;

create or replace function public.close_regular(p_category_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.categories%rowtype; top_ids uuid[]; smallest integer; largest integer; counts text;
begin
 select * into c from public.categories where id=p_category_id for update;
 if not found then raise exception 'Categoría inexistente.'; end if;
 if c.regular_closed_at is not null then return public.get_tournament(); end if;
 perform 1 from public.teams where category_id=c.id for share;
 if exists(select 1 from public.matches where category_id=c.id and stage='REGULAR' and status<>'FINALIZADO') then
   raise exception 'No se puede cerrar la fase regular: existen partidos regulares pendientes o en curso en esta categoría.';
 end if;
 select min(pj),max(pj),string_agg(name||': '||pj||' PJ',E'\n' order by name,id) into smallest,largest,counts
 from (select t.id,t.name,count(m.id)::integer pj from public.teams t left join public.matches m
   on m.category_id=t.category_id and m.stage='REGULAR' and m.status='FINALIZADO' and t.id in(m.home_team_id,m.away_team_id)
   where t.category_id=c.id and t.active group by t.id,t.name) played;
 if smallest is distinct from largest then
   raise exception E'No se puede cerrar la fase regular. Todos los equipos activos deben tener la misma cantidad de partidos jugados.\n%',counts;
 end if;
 select array_agg(team_id order by position) into top_ids from (
   select s.team_id,s.position from public.get_standings(c.id,false) s join public.teams t on t.id=s.team_id
   where t.active order by s.position limit 4) top_four;
 if coalesce(cardinality(top_ids),0)<>4 then raise exception 'Se necesitan al menos cuatro equipos activos clasificados.'; end if;
 update public.categories set regular_closed_at=clock_timestamp(),qualified_team_ids=top_ids where id=c.id;
 return public.get_tournament();
end $$;

-- Observe the result just written, including when called inside an AFTER trigger.
alter function public.match_outcome(uuid) volatile;
alter function public.get_tournament() volatile;
create unique index matches_one_final_stage on public.matches(category_id,stage) where stage in('FINAL','THIRD_PLACE');
create function public.auto_generate_day6() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.stage='SEMIFINAL' and new.status='FINALIZADO' then
   perform 1 from public.categories where id=new.category_id for update;
   if (select count(*) from public.matches where category_id=new.category_id and stage='SEMIFINAL')=2
     and not exists(select 1 from public.matches m where m.category_id=new.category_id and m.stage='SEMIFINAL'
       and not(public.match_outcome(m.id)->>'resolved')::boolean) then
     perform public.generate_day6(new.category_id);
   end if;
 end if;
 return new;
end $$;
create trigger auto_generate_day6 after insert or update of status,tiebreak_winner_team_id,walkover_loser_team_id on public.matches
 for each row execute function public.auto_generate_day6();

revoke all on function public.penalty_decision(uuid,uuid,jsonb),public.penalty_shootout_snapshot(uuid),public.auto_generate_day6() from public,anon,authenticated;
grant execute on function public.penalty_decision(uuid,uuid,jsonb),public.penalty_shootout_snapshot(uuid) to anon;
-- The automatic operation function is appended below in this same transaction.

alter function public.manage_penalty_shootout(uuid,text,uuid,uuid,boolean,uuid,integer) rename to manage_penalty_shootout_before_026;
revoke all on function public.manage_penalty_shootout_before_026(uuid,text,uuid,uuid,boolean,uuid,integer) from public,anon,authenticated;
create function public.manage_penalty_shootout(p_match_id uuid,p_action text,p_team_id uuid,p_attempt_id uuid,p_converted boolean,p_request_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; s public.penalty_shootouts%rowtype; k public.penalty_shootout_attempts%rowtype;
 payload jsonb; receipt public.penalty_shootout_operations%rowtype; before_j jsonb; after_j jsonb;
 n integer; h integer; a integer; nh integer; na integer; next_team uuid; winner uuid; decision jsonb;
begin
 select * into m from public.matches where id=p_match_id for update;
 select * into s from public.penalty_shootouts where match_id=p_match_id for update;
 if not found then raise exception 'Inicia primero la tanda.'; end if;
 if s.rule_set='LEGACY_ADMIN' and s.completed_at is not null then
   return public.manage_penalty_shootout_before_026(p_match_id,p_action,p_team_id,p_attempt_id,p_converted,p_request_id,p_expected_revision);
 end if;
 if p_request_id is null then raise exception 'Falta identificador de solicitud.'; end if;
 payload:=jsonb_build_object('action',p_action,'team',p_team_id,'attempt',p_attempt_id,'converted',p_converted,'revision',p_expected_revision);
 select * into receipt from public.penalty_shootout_operations where request_id=p_request_id;
 if found then
   if receipt.match_id<>p_match_id or receipt.payload<>payload then raise exception 'Solicitud reutilizada con datos diferentes.'; end if;
   return public.get_match_control(m.id);
 end if;
 if p_expected_revision is distinct from s.revision then raise exception 'La tanda cambió. Actualiza antes de continuar.'; end if;
 before_j:=public.penalty_shootout_snapshot(m.id);
 if p_action='RECORD' then
   if s.completed_at is not null then raise exception 'La tanda ya finalizó.'; end if;
   next_team:=(before_j->>'next_team_id')::uuid;
   if p_team_id is distinct from next_team or p_converted is null then raise exception 'Respeta el turno del siguiente equipo.'; end if;
   n:=jsonb_array_length(before_j->'attempts')+1;
   insert into public.penalty_shootout_attempts(match_id,team_id,sequence,converted,request_id)
     values(m.id,p_team_id,n,p_converted,p_request_id);
 elsif p_action in('CORRECT','VOID') then
   select * into k from public.penalty_shootout_attempts where id=p_attempt_id and match_id=m.id and voided_at is null;
   if not found then raise exception 'Lanzamiento no vigente.'; end if;
   if p_action='VOID' then
     if k.sequence<>jsonb_array_length(before_j->'attempts') then raise exception 'Solo puedes anular el último lanzamiento.'; end if;
     update public.penalty_shootout_attempts set voided_at=clock_timestamp(),updated_at=clock_timestamp() where id=k.id;
   else
     if p_converted is null then raise exception 'Indica convertido o fallado.'; end if;
     update public.penalty_shootout_attempts set converted=p_converted,updated_at=clock_timestamp() where id=k.id;
   end if;
 elsif p_action<>'FINISH' or p_action is null then raise exception 'Operación desconocida.';
 end if;
 decision:=public.penalty_decision(m.home_team_id,m.away_team_id,public.penalty_shootout_snapshot(m.id)->'attempts');
 winner:=(decision->>'winner_team_id')::uuid;
 n:=jsonb_array_length(public.penalty_shootout_snapshot(m.id)->'attempts');
 if winner is not null and (decision->>'decided_at')::integer<n then
   raise exception 'La corrección definiría la tanda antes de tiros ya registrados. Revisa los últimos lanzamientos.';
 end if;
 if s.completed_at is not null and winner is distinct from m.tiebreak_winner_team_id then
   raise exception 'La corrección reabriría la tanda o cambiaría el ganador confirmado. Requiere revisión de los cruces dependientes.';
 end if;
 if p_action='FINISH' and winner is null then raise exception 'La tanda todavía no está matemáticamente definida.'; end if;
 if winner is not null and s.completed_at is null then
   update public.penalty_shootouts set completed_at=clock_timestamp() where match_id=m.id;
   update public.matches set tiebreak_winner_team_id=winner where id=m.id;
   perform public.control_match(m.id,'RESUME',(select updated_at from public.matches where id=m.id));
   perform public.control_match(m.id,'FINISH',(select updated_at from public.matches where id=m.id));
 end if;
 update public.penalty_shootouts set revision=revision+1 where match_id=m.id;
 after_j:=public.penalty_shootout_snapshot(m.id);
 insert into public.penalty_shootout_operations(request_id,match_id,payload,before_state,after_state) values(p_request_id,m.id,payload,before_j,after_j);
 return public.get_match_control(m.id);
end $$;


revoke all on function public.manage_penalty_shootout(uuid,text,uuid,uuid,boolean,uuid,integer) from public,anon,authenticated;
grant execute on function public.manage_penalty_shootout(uuid,text,uuid,uuid,boolean,uuid,integer) to anon;

-- Old manual results remain readable and identical retries remain harmless.
-- New winners must come from a tracked, mathematically decided shootout.
create or replace function public.set_penalty_winner(p_match_id uuid,p_team_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype;
begin
 select * into m from public.matches where id=p_match_id for update;
 if m.tiebreak_winner_team_id is not null and m.tiebreak_winner_team_id=p_team_id then return public.get_match_control(m.id); end if;
 raise exception 'El ganador se calcula automáticamente a partir de los lanzamientos de la tanda.';
end $$;

-- Reconcile already resolved semifinals without rewriting any existing result.
do $$ declare c record; s record; decision jsonb;
begin
 -- Upgrade unfinished 025 shootouts. A mathematically decisive existing last
 -- attempt closes now; inconsistent excess attempts abort for explicit review.
 for s in select sh.*,m.home_team_id,m.away_team_id from public.penalty_shootouts sh
   join public.matches m on m.id=sh.match_id where sh.completed_at is null loop
   decision:=public.penalty_decision(s.home_team_id,s.away_team_id,public.penalty_shootout_snapshot(s.match_id)->'attempts');
   if decision->>'winner_team_id' is not null then
     perform public.manage_penalty_shootout(s.match_id,'FINISH',null,null,null,gen_random_uuid(),s.revision);
   end if;
 end loop;
 for c in select category_id from public.matches where stage='SEMIFINAL' group by category_id
   having count(*)=2 and bool_and(status='FINALIZADO') loop
   if not exists(select 1 from public.matches m where m.category_id=c.category_id and m.stage='SEMIFINAL'
      and not(public.match_outcome(m.id)->>'resolved')::boolean) then
     perform public.generate_day6(c.category_id);
   end if;
 end loop;
end $$;
commit;
