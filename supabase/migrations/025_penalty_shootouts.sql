-- Local only until reviewed. Preserves all 001–024 definitions and historical data.
begin;
create table public.penalty_shootouts (
  match_id uuid primary key references public.matches(id) on delete cascade,
  first_team_id uuid not null references public.teams(id),
  revision integer not null default 0 check(revision>=0),
  request_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);
create table public.penalty_shootout_attempts (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.penalty_shootouts(match_id) on delete cascade,
  team_id uuid not null references public.teams(id),
  sequence integer not null check(sequence>0),
  converted boolean not null,
  request_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  voided_at timestamptz
);
create unique index penalty_attempt_sequence on public.penalty_shootout_attempts(match_id,sequence) where voided_at is null;
create table public.penalty_shootout_operations (
  request_id uuid primary key,
  match_id uuid not null references public.penalty_shootouts(match_id) on delete cascade,
  payload jsonb not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index penalty_operations_match on public.penalty_shootout_operations(match_id);
alter table public.penalty_shootouts enable row level security;
alter table public.penalty_shootout_attempts enable row level security;
alter table public.penalty_shootout_operations enable row level security;
create policy penalty_read on public.penalty_shootouts for select to anon using(true);
create policy penalty_attempt_read on public.penalty_shootout_attempts for select to anon using(true);
-- Audit is server-only. All mutations go through RPCs.
revoke all on public.penalty_shootouts,public.penalty_shootout_attempts,public.penalty_shootout_operations from public,anon,authenticated;
grant select on public.penalty_shootouts,public.penalty_shootout_attempts to anon;

create function public.penalty_shootout_snapshot(p_match_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('first_team_id',s.first_team_id,'revision',s.revision,'completed_at',s.completed_at,
   'winner_team_id',case when s.completed_at is not null then m.tiebreak_winner_team_id end,
   'next_team_id',case when s.completed_at is null then case when a.n%2=0 then s.first_team_id
     when s.first_team_id=m.home_team_id then m.away_team_id else m.home_team_id end end,
   'score',jsonb_build_object('home',a.h,'away',a.a), 'attempts',a.items)
 from public.penalty_shootouts s join public.matches m on m.id=s.match_id cross join lateral (
   select count(*) n,count(*) filter(where team_id=m.home_team_id and converted) h,
     count(*) filter(where team_id=m.away_team_id and converted) a,
     coalesce(jsonb_agg(to_jsonb(k) order by sequence),'[]'::jsonb) items
   from public.penalty_shootout_attempts k where k.match_id=s.match_id and voided_at is null
 ) a where s.match_id=p_match_id;
$$;
-- Keep the complete accumulated snapshot, including W.O., fouls and lineups.
alter function public.get_match_control(uuid) rename to get_match_control_before_025;
create function public.get_match_control(p_match_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
 select public.get_match_control_before_025(p_match_id) || jsonb_build_object('shootout',public.penalty_shootout_snapshot(p_match_id));
$$;

create function public.start_penalty_shootout(p_match_id uuid,p_first_team_id uuid,p_request_id uuid,p_expected_updated_at timestamptz) returns jsonb
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
 seconds:=m.phase_elapsed_seconds+case when m.phase_started_at is null then 0 else greatest(0,floor(extract(epoch from clock_timestamp()-m.phase_started_at)))::integer end;
 if seconds<900 then raise exception 'El tiempo reglamentario todavía no terminó.'; end if;
 j:=public.get_match_control(m.id);
 if j->'score'->>'home'<>j->'score'->>'away' then raise exception 'El marcador reglamentario debe estar empatado.'; end if;
 if m.status='SEGUNDO_TIEMPO' then perform public.control_match(m.id,'PAUSE',m.updated_at); end if;
 insert into public.penalty_shootouts(match_id,first_team_id,request_id) values(m.id,p_first_team_id,p_request_id);
 return public.get_match_control(m.id);
end $$;

-- A single locked operation path provides revision checks and an immutable audit receipt.
create function public.manage_penalty_shootout(p_match_id uuid,p_action text,p_team_id uuid,p_attempt_id uuid,p_converted boolean,p_request_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; s public.penalty_shootouts%rowtype; k public.penalty_shootout_attempts%rowtype;
 payload jsonb; receipt public.penalty_shootout_operations%rowtype; before_j jsonb; after_j jsonb;
 n integer; h integer; a integer; nh integer; na integer; next_team uuid; winner uuid;
begin
 select * into m from public.matches where id=p_match_id for update;
 select * into s from public.penalty_shootouts where match_id=p_match_id for update;
 if not found then raise exception 'Inicia primero la tanda.'; end if;
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
 select count(*) filter(where team_id=m.home_team_id and converted),count(*) filter(where team_id=m.away_team_id and converted),
   count(*) filter(where team_id=m.home_team_id),count(*) filter(where team_id=m.away_team_id)
 into h,a,nh,na from public.penalty_shootout_attempts where match_id=m.id and voided_at is null;
 if p_action='FINISH' or s.completed_at is not null then
   if nh=0 or na=0 then raise exception 'Ambos equipos deben ejecutar al menos un lanzamiento.'; end if;
   if h=a then raise exception 'La tanda continúa porque el marcador de penales está empatado.'; end if;
   winner:=case when h>a then m.home_team_id else m.away_team_id end;
   if s.completed_at is not null and winner is distinct from m.tiebreak_winner_team_id then
     raise exception 'No se puede cambiar el ganador confirmado; requiere revisión de los cruces dependientes.';
   end if;
 end if;
 if p_action='FINISH' then
   if s.completed_at is not null then raise exception 'La tanda ya finalizó.'; end if;
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

-- Additive guards: do not replace the accumulated 022–024 tournament guards.
create function public.guard_penalty_match() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.penalty_shootouts%rowtype;
begin
 select * into s from public.penalty_shootouts where match_id=old.id;
 if found then
   if new.walkover_loser_team_id is not null then raise exception 'W.O. incompatible con una tanda.'; end if;
   if s.completed_at is null and (new.status<>'PAUSADO' or new.tiebreak_winner_team_id is not null) then raise exception 'Finaliza la tanda antes de cambiar el estado del partido.'; end if;
 end if;
 return new;
end $$;
create trigger guard_penalty_match before update on public.matches for each row execute function public.guard_penalty_match();
create function public.guard_penalty_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.matches where id=new.match_id for update;
 if exists(select 1 from public.penalty_shootouts where match_id=new.match_id) and
   (TG_OP='INSERT' or (new.type='GOAL' and new.voided_at is distinct from old.voided_at)) then
   raise exception 'El marcador reglamentario está cerrado por la tanda.';
 end if;
 return new;
end $$;
create trigger guard_penalty_event before insert or update on public.match_events for each row execute function public.guard_penalty_event();
-- Legacy winner selection remains available only for matches without tracked attempts.
alter function public.set_penalty_winner(uuid,uuid) rename to set_penalty_winner_before_025;
revoke all on function public.set_penalty_winner_before_025(uuid,uuid) from public,anon,authenticated;
create function public.set_penalty_winner(p_match_id uuid,p_team_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.matches where id=p_match_id for update;
 if exists(select 1 from public.penalty_shootouts where match_id=p_match_id) then raise exception 'El ganador debe derivarse del marcador de la tanda.'; end if;
 return public.set_penalty_winner_before_025(p_match_id,p_team_id);
end $$;
revoke all on function public.penalty_shootout_snapshot(uuid),public.get_match_control(uuid),public.start_penalty_shootout(uuid,uuid,uuid,timestamptz),
 public.manage_penalty_shootout(uuid,text,uuid,uuid,boolean,uuid,integer),public.set_penalty_winner(uuid,uuid),public.guard_penalty_match(),public.guard_penalty_event() from public,anon,authenticated;
grant execute on function public.penalty_shootout_snapshot(uuid),public.get_match_control(uuid),public.start_penalty_shootout(uuid,uuid,uuid,timestamptz),
 public.manage_penalty_shootout(uuid,text,uuid,uuid,boolean,uuid,integer),public.set_penalty_winner(uuid,uuid) to anon;
alter publication supabase_realtime add table public.penalty_shootouts,public.penalty_shootout_attempts;
commit;
