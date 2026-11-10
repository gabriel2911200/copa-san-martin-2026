-- Additive extension; existing results and events are preserved.
begin;
-- The existing partial UNIQUE index already protects active shirt numbers.
-- Report any inconsistent installation before changing definitions; never fix rows.
do $$ declare conflicts text;
begin
 select string_agg(match_id::text||' / '||team_id::text||' / #'||shirt_number::text,E'\n') into conflicts
 from (select match_id,team_id,shirt_number from public.match_players where active group by match_id,team_id,shirt_number having count(*)>1) duplicates;
 if conflicts is not null then raise exception E'Dorsales duplicados; revisar sin borrar datos:\n%',conflicts; end if;
end $$;
alter table public.matches drop constraint matches_stage_check;
alter table public.matches add constraint matches_stage_check check(stage in('REGULAR','SEMIFINAL','THIRD_PLACE','FINAL','FRIENDLY'));
alter table public.matches drop constraint matches_tiebreak_winner_check;
alter table public.matches add constraint matches_tiebreak_winner_check check(tiebreak_winner_team_id is null or (stage in('SEMIFINAL','THIRD_PLACE','FINAL','FRIENDLY') and tiebreak_winner_team_id in(home_team_id,away_team_id)));
alter table public.matches add column friendly_penalties boolean not null default false;
drop index public.matches_exact_fixture;
create unique index matches_exact_fixture on public.matches(category_id,matchday_id,home_team_id,away_team_id,stage) where stage<>'FRIENDLY';
alter table public.matches drop constraint matches_period_duration_seconds_check;
alter table public.matches add constraint matches_period_duration_seconds_check check(period_duration_seconds between 60 and 10800 and period_duration_seconds%60=0);
create table public.duration_options(seconds integer primary key check(seconds between 60 and 10800 and seconds%60=0), built_in boolean not null default false);
insert into public.duration_options values(900,true),(1200,true);
alter table public.duration_options enable row level security;
grant select on public.duration_options to anon;
create policy duration_read on public.duration_options for select to anon using(true);
create function public.manage_duration(p_seconds integer,p_remove boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_seconds is null or p_seconds not between 60 and 10800 or p_seconds%60<>0 or p_remove is null then raise exception 'Indica minutos enteros entre 1 y 180.'; end if;
 if p_remove then
   if exists(select 1 from public.duration_options where seconds=p_seconds and built_in) then raise exception 'Los tiempos predeterminados no se eliminan.'; end if;
   delete from public.duration_options where seconds=p_seconds and not built_in;
 else insert into public.duration_options(seconds) values(p_seconds) on conflict do nothing;
 end if;
end $$;
create or replace function public.set_match_duration(p_match_id uuid,p_seconds integer,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype;
begin
 select * into m from public.matches where id=p_match_id for update;
 if not found then raise exception 'El partido no existe.'; end if;
 if p_seconds is null or p_seconds not between 60 and 10800 or p_seconds%60<>0 then raise exception 'Indica minutos enteros entre 1 y 180.'; end if;
 if m.status<>'PROGRAMADO' then raise exception 'La duración solo se cambia antes de iniciar el partido; el reloj se conserva.'; end if;
 if p_expected_updated_at is null or p_expected_updated_at is distinct from m.updated_at then raise exception 'El partido cambió. Actualiza antes de guardar.'; end if;
 update public.matches set period_duration_seconds=p_seconds where id=m.id;
 return public.get_match_control(m.id);
end $$;

create table private.match_finish_snapshots(match_id uuid primary key references public.matches(id) on delete cascade, state jsonb not null);
create table private.match_reopen_audit(id uuid primary key default gen_random_uuid(),match_id uuid not null references public.matches(id) on delete cascade, actor uuid not null, created_at timestamptz not null default clock_timestamp(), final_updated_at timestamptz not null, transaction_id bigint not null default txid_current(), before_state jsonb not null, restored_state jsonb not null);
revoke all on private.match_finish_snapshots,private.match_reopen_audit from public,anon,authenticated;
alter table private.match_finish_snapshots enable row level security;
alter table private.match_reopen_audit enable row level security;
create function public.capture_match_finish() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status<>'FINALIZADO' and new.status='FINALIZADO' then
 insert into private.match_finish_snapshots(match_id,state) values(old.id,to_jsonb(old)||jsonb_build_object('phase_elapsed_seconds',public.match_elapsed_seconds(old,clock_timestamp()))) on conflict(match_id) do update set state=excluded.state;
 end if;
 return new;
end $$;
create trigger capture_match_finish before update on public.matches for each row execute function public.capture_match_finish();

create function public.create_friendly(p_category_id uuid,p_home uuid,p_away uuid,p_date date,p_time time,p_seconds integer,p_penalties boolean,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare mid uuid; day_id uuid; existing public.matches%rowtype;
begin
 if p_request_id is null or p_home is null or p_away is null or p_home=p_away or p_penalties is null then raise exception 'Selecciona dos equipos diferentes.'; end if;
 if p_seconds is null or p_seconds not between 60 and 10800 or p_seconds%60<>0 then raise exception 'Indica minutos enteros entre 1 y 180.'; end if;
 if p_time is not null and p_date is null then raise exception 'Selecciona una fecha para asignar la hora.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into existing from public.matches where id=p_request_id;
 if found then
   if (existing.stage,existing.category_id,existing.home_team_id,existing.away_team_id,existing.scheduled_date,existing.scheduled_time,existing.period_duration_seconds,existing.friendly_penalties) is distinct from ('FRIENDLY',p_category_id,p_home,p_away,p_date,p_time,p_seconds,p_penalties) then raise exception 'Solicitud reutilizada con datos diferentes.'; end if;
   return public.get_match_control(existing.id);
 end if;
 if (select count(*) from public.teams where id in(p_home,p_away) and category_id=p_category_id and active)<>2 then raise exception 'Selecciona equipos activos de la misma categoría.'; end if;
 select id into day_id from public.matchdays order by number limit 1;
 insert into public.matches(id,category_id,matchday_id,home_team_id,away_team_id,stage,scheduled_date,scheduled_time,period_duration_seconds,friendly_penalties)
 values(p_request_id,p_category_id,day_id,p_home,p_away,'FRIENDLY',p_date,p_time,p_seconds,p_penalties) returning id into mid;
 return public.get_match_control(mid);
end $$;
create function public.get_friendlies() returns jsonb language sql volatile security invoker set search_path='' as $$
 select coalesce(jsonb_agg(public.match_outcome(m.id) order by m.created_at desc),'[]'::jsonb) from public.matches m where m.stage='FRIENDLY';
$$;

-- Only Supabase Auth accounts with server-assigned app_metadata.role='admin'.
create function public.reopen_match(p_match_id uuid,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; previous jsonb; claims jsonb; restored jsonb;
begin
 claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 if claims->>'role' is distinct from 'authenticated' or claims->'app_metadata'->>'role' is distinct from 'admin' or claims->>'sub' is null then raise exception 'Inicia sesión con una cuenta administradora autorizada.' using errcode='42501'; end if;
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
 insert into private.match_reopen_audit(match_id,actor,final_updated_at,before_state,restored_state) values(m.id,(claims->>'sub')::uuid,m.updated_at,to_jsonb(m)||jsonb_build_object('shootout',public.penalty_shootout_snapshot(m.id)),restored);
 update public.penalty_shootouts set completed_at=null,revision=revision+1 where match_id=m.id;
 update public.matches set tiebreak_winner_team_id=null,status='PAUSADO',paused_from_status=restored->>'paused_from_status',phase_elapsed_seconds=(restored->>'phase_elapsed_seconds')::integer,phase_started_at=null where id=m.id;
 return public.get_match_control(m.id);
end $$;
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
    if old.status='FINALIZADO' and new is distinct from old and new.walkover_loser_team_id is null and not (new.status='PAUSADO' and exists(select 1 from private.match_reopen_audit r where r.match_id=old.id and r.final_updated_at=old.updated_at and r.transaction_id=txid_current())) then
      raise exception 'El partido finalizado no se puede modificar.';
    end if;
  else
    select number into day_number from public.matchdays where id=new.matchday_id;
    if new.stage='REGULAR' and day_number not between 1 and 4 then raise exception 'Jornada regular inválida.'; end if;
    if new.stage in ('SEMIFINAL','FINAL','THIRD_PLACE') then
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
  if new.stage in ('SEMIFINAL','FINAL','THIRD_PLACE') then
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

create or replace function public.get_top_scorers(p_category_id uuid default null)
returns table("position" bigint,player_id uuid,player_name text,team_id uuid,team_name text,category_id uuid,goals bigint)
language sql stable security invoker set search_path='' as $$
  with contributions as (
    select e.player_id,count(*)::bigint goals
    from public.match_events e join public.matches m on m.id=e.match_id
    where m.stage<>'FRIENDLY' and e.type='GOAL' and e.voided_at is null and e.player_id is not null and m.status<>'PROGRAMADO'
    group by e.player_id
    union all select i.player_id,i.goals::bigint from public.player_initial_goals i
  ), totals as (
    select p.id,p.full_name,p.team_id,t.name,t.category_id,sum(c.goals)::bigint goals
    from contributions c join public.players p on p.id=c.player_id join public.teams t on t.id=p.team_id
    where p_category_id is null or t.category_id=p_category_id
    group by p.id,p.full_name,p.team_id,t.name,t.category_id having sum(c.goals)>0
  ) select rank() over(order by totals.goals desc),id,full_name,totals.team_id,name,totals.category_id,totals.goals
    from totals order by totals.goals desc,full_name,name,id;
$$;
create or replace function public.get_tournament() returns jsonb
language sql volatile security invoker set search_path='' as $$
  select jsonb_build_object(
    'categories',coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('qualified',
      coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by q.ord)
        from unnest(c.qualified_team_ids) with ordinality q(id,ord) join public.teams t on t.id=q.id),'[]'::jsonb)
    ) order by c.name) from public.categories c),'[]'::jsonb),
    'matchdays',coalesce((select jsonb_agg(to_jsonb(d) order by d.number) from public.matchdays d),'[]'::jsonb),
    'matches',coalesce((select jsonb_agg(public.match_outcome(m.id) order by d.number,c.name,m.created_at,m.id)
      from public.matches m join public.matchdays d on d.id=m.matchday_id join public.categories c on c.id=m.category_id where m.stage<>'FRIENDLY'),'[]'::jsonb)
  );
$$;

alter table public.penalty_shootouts add column initial_attempts integer not null default 5 check(initial_attempts in(3,5));
create function public.penalty_decision(p_home uuid,p_away uuid,p_attempts jsonb,p_initial integer) returns jsonb
language plpgsql immutable set search_path='' as $$
declare k jsonb; nh integer:=0; na integer:=0; h integer:=0; a integer:=0; n integer:=0; winner uuid;
begin
 for k in select value from jsonb_array_elements(p_attempts) loop
   n:=n+1;
   if (k->>'team_id')::uuid=p_home then nh:=nh+1; h:=h+case when (k->>'converted')::boolean then 1 else 0 end;
   else na:=na+1; a:=a+case when (k->>'converted')::boolean then 1 else 0 end; end if;
   if nh<=p_initial and na<=p_initial then
     if h>a+(p_initial-na) then winner:=p_home;
     elsif a>h+(p_initial-nh) then winner:=p_away; end if;
   elsif nh=na and h<>a then winner:=case when h>a then p_home else p_away end;
   end if;
   if winner is not null then return jsonb_build_object('winner_team_id',winner,'decided_at',n); end if;
 end loop;
 return jsonb_build_object('winner_team_id',null,'decided_at',null);
end $$;


create or replace function public.penalty_shootout_snapshot(p_match_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.penalty_shootout_snapshot_before_026(p_match_id)||jsonb_build_object('rule_set',rule_set,'initial_attempts',initial_attempts)
 from public.penalty_shootouts where match_id=p_match_id;
$$;
revoke all on function public.penalty_decision(uuid,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.penalty_decision(uuid,uuid,jsonb,integer) to anon;

create or replace function public.manage_penalty_shootout(p_match_id uuid,p_action text,p_team_id uuid,p_attempt_id uuid,p_converted boolean,p_request_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; s public.penalty_shootouts%rowtype; k public.penalty_shootout_attempts%rowtype;
 payload jsonb; receipt public.penalty_shootout_operations%rowtype; before_j jsonb; after_j jsonb;
 n integer; h integer; a integer; nh integer; na integer; next_team uuid; winner uuid; decision jsonb;
begin
 select * into m from public.matches where id=p_match_id for update;
 select * into s from public.penalty_shootouts where match_id=p_match_id for update;
 if not found then raise exception 'Inicia primero la tanda.'; end if;
 if s.rule_set='LEGACY_ADMIN' and s.completed_at is not null then
   return public.manage_penalty_shootout_before_026(p_match_id,case when p_action='FINISH_MANUAL' then 'FINISH' else p_action end,p_team_id,p_attempt_id,p_converted,p_request_id,p_expected_revision);
 end if;
 if p_request_id is null then raise exception 'Falta identificador de solicitud.'; end if;
 payload:=jsonb_build_object('action',p_action,'team',p_team_id,'attempt',p_attempt_id,'converted',p_converted,'revision',p_expected_revision);
 select * into receipt from public.penalty_shootout_operations where request_id=p_request_id;
 if found then
   if receipt.match_id<>p_match_id or receipt.payload<>payload then raise exception 'Solicitud reutilizada con datos diferentes.'; end if;
   return public.get_match_control(m.id);
 end if;
 if p_expected_revision is distinct from s.revision then raise exception 'La tanda cambió. Actualiza antes de continuar.'; end if;
 if p_action='RECORD' and s.first_team_id is null then
 if p_team_id is null or p_team_id not in(m.home_team_id,m.away_team_id) then raise exception 'Equipo ajeno al partido.'; end if;
 update public.penalty_shootouts set first_team_id=p_team_id where match_id=m.id;
 end if;
 before_j:=public.penalty_shootout_snapshot(m.id);
 if p_action in('SET_THREE','SET_FIVE') then
   if s.completed_at is not null or jsonb_array_length(before_j->'attempts')<>0 then raise exception 'Configura la cantidad antes del primer lanzamiento.'; end if;
   update public.penalty_shootouts set initial_attempts=case when p_action='SET_THREE' then 3 else 5 end where match_id=m.id;
 elsif p_action='RECORD' then
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
 elsif p_action not in('FINISH','FINISH_MANUAL') or p_action is null then raise exception 'Operación desconocida.';
 end if;
 if p_action='FINISH_MANUAL' then
 if s.completed_at is not null then raise exception 'La tanda ya finalizó.'; end if;
 select count(*) filter(where team_id=m.home_team_id and converted),count(*) filter(where team_id=m.away_team_id and converted),count(*) filter(where team_id=m.home_team_id),count(*) filter(where team_id=m.away_team_id)
 into h,a,nh,na from public.penalty_shootout_attempts where match_id=m.id and voided_at is null;
 if nh=0 or na=0 or h=a then raise exception 'Ambos equipos deben lanzar y el marcador no puede estar empatado.'; end if;
 update public.penalty_shootouts set rule_set='LEGACY_ADMIN' where match_id=m.id;
 return public.manage_penalty_shootout_before_026(p_match_id,'FINISH',null,null,null,p_request_id,p_expected_revision);
 end if;
 decision:=public.penalty_decision(m.home_team_id,m.away_team_id,public.penalty_shootout_snapshot(m.id)->'attempts',s.initial_attempts);
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
end $$;create or replace function public.open_penalty_shootout(p_match_id uuid,p_request_id uuid,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; j jsonb; seconds integer;
begin
 select * into m from public.matches where id=p_match_id for update;
 if not found then raise exception 'Partido inexistente.'; end if;
 -- Multiple controllers may open the same panel; never reset its order or history.
 if exists(select 1 from public.penalty_shootouts where match_id=m.id) then return public.get_match_control(m.id); end if;
 if p_request_id is null then raise exception 'Falta identificador de solicitud.'; end if;
 if p_expected_updated_at is distinct from m.updated_at then raise exception 'El partido cambió. Actualiza.'; end if;
 if not(m.stage in('SEMIFINAL','FINAL','THIRD_PLACE') or (m.stage='FRIENDLY' and m.friendly_penalties)) or m.walkover_loser_team_id is not null or m.tiebreak_winner_team_id is not null
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


create or replace function public.set_match_player(p_match_id uuid,p_player_id uuid,p_shirt_number integer,p_active boolean,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare m public.matches%rowtype; p public.players%rowtype; previous public.match_players%rowtype;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'El partido no existe.'; end if;
  if p_expected_updated_at is null or m.updated_at is distinct from p_expected_updated_at then
    raise exception 'El partido cambió. Actualiza antes de guardar la convocatoria.';
  end if;
  if m.status='FINALIZADO' then raise exception 'La convocatoria de un partido finalizado no se puede modificar.'; end if;
  if m.stage='REGULAR' and exists(select 1 from public.categories where id=m.category_id and regular_closed_at is not null) then
    raise exception 'La fase regular está cerrada.';
  end if;
  if p_active is null or p_shirt_number is null or p_shirt_number not between 0 and 99 then
    raise exception 'Indica un dorsal entre 0 y 99.';
  end if;
  select * into p from public.players where id=p_player_id for share;
  if not found or p.team_id not in (m.home_team_id,m.away_team_id) then
    raise exception 'El jugador debe pertenecer a un equipo del partido.';
  end if;
  if p_active and not p.active then raise exception 'El jugador está inactivo.'; end if;
  select * into previous from public.match_players where match_id=m.id and player_id=p.id;
  if found and previous.active is distinct from p_active
    and exists(select 1 from public.match_events where match_id=m.id and player_id=p.id) then
    raise exception 'El jugador ya tiene eventos: conserva su convocatoria y dorsal en este partido.';
  end if;
  if p_active and exists(select 1 from public.match_players where match_id=m.id and team_id=p.team_id and active and shirt_number=p_shirt_number and player_id<>p.id) then
    raise exception 'DORSAL YA ASIGNADO: el dorsal % ya pertenece a % en este equipo.',p_shirt_number,(select pl.full_name from public.match_players mp join public.players pl on pl.id=mp.player_id where mp.match_id=m.id and mp.team_id=p.team_id and mp.active and mp.shirt_number=p_shirt_number and mp.player_id<>p.id limit 1);
  end if;
  if previous.shirt_number=p_shirt_number and previous.active=p_active then return public.get_match_control(m.id); end if;
  insert into public.match_players(match_id,player_id,team_id,shirt_number,active)
    values(m.id,p.id,p.team_id,p_shirt_number,p_active)
    on conflict(match_id,player_id) do update set shirt_number=excluded.shirt_number,active=excluded.active;
  -- Invalida controles y convocatorias desactualizados de otros dispositivos.
  update public.matches set updated_at=clock_timestamp() where id=m.id;
  return public.get_match_control(m.id);
exception when unique_violation then
  raise exception 'Ese dorsal ya está asignado a otro jugador del equipo en este partido.';
end $$;

revoke all on function public.manage_duration(integer,boolean),public.create_friendly(uuid,uuid,uuid,date,time,integer,boolean,uuid),public.get_friendlies(),public.reopen_match(uuid,timestamptz),public.capture_match_finish() from public,anon,authenticated;
grant execute on function public.manage_duration(integer,boolean),public.create_friendly(uuid,uuid,uuid,date,time,integer,boolean,uuid),public.get_friendlies() to anon;
grant execute on function public.reopen_match(uuid,timestamptz) to authenticated;
grant insert(period_duration_seconds) on public.matches to anon;
notify pgrst,'reload schema';
commit;
