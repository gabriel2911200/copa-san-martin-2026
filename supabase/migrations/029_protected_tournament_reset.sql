-- Does NOT reset data when applied. Uses the existing anonymous administration.
-- Confirmation prevents accidents, not unauthorized access to this public RPC.
begin;
create schema if not exists private;
create table private.tournament_reset_state (
  singleton boolean primary key default true check(singleton),
  generation uuid not null default gen_random_uuid(),
  last_request_id uuid
);
insert into private.tournament_reset_state(singleton) values(true);
alter table private.tournament_reset_state enable row level security;
revoke all on private.tournament_reset_state from public,anon,authenticated;

create function public.prepare_tournament_reset() returns uuid
language plpgsql security definer set search_path='' as $$
begin
  -- Generation only: rejects stale dialogs after another reset. No authentication.
  return (select generation from private.tournament_reset_state where singleton);
end $$;

create function public.reset_tournament(p_confirmation text,p_expected_generation uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare state private.tournament_reset_state%rowtype; mid uuid;
begin
  if p_confirmation is distinct from 'REINICIAR' or p_request_id is null then
    raise exception 'Escribe exactamente REINICIAR para confirmar.';
  end if;
  select * into state from private.tournament_reset_state where singleton for update;
  if state.last_request_id=p_request_id then
    return jsonb_build_object('reset',true,'replayed',true);
  end if;
  if p_expected_generation is null or p_expected_generation is distinct from state.generation then
    raise exception 'El campeonato ya fue reiniciado. Cierra este diálogo y revisa los datos actuales.';
  end if;
  -- Serialize ordinary mutations; a timeout/deadlock aborts the whole transaction.
  lock table public.matches,public.categories,public.teams,public.players,public.matchdays,
    public.match_events,public.match_players,public.match_prechecks,public.match_foul_counters,
    public.player_initial_goals,public.penalty_shootouts,public.penalty_shootout_attempts,
    public.penalty_shootout_operations in access exclusive mode;
  -- Reuse trusted event deletion, never disable triggers. Child match data cascades.
  for mid in select id from public.matches order by id loop
    perform public.delete_match(mid,(select updated_at from public.matches where id=mid));
  end loop;
  delete from public.player_initial_goals;
  delete from public.players;
  update public.categories set regular_closed_at=null,qualified_team_ids=null;
  delete from public.teams;
  update public.matchdays set date=null;
  update private.tournament_reset_state set generation=gen_random_uuid(),last_request_id=p_request_id
    where singleton;
  return jsonb_build_object('reset',true,'replayed',false);
end $$;
revoke all on function public.prepare_tournament_reset(),public.reset_tournament(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_tournament_reset(),public.reset_tournament(text,uuid,uuid) to anon;
-- No new table grants or roles. The existing anonymous client calls both RPCs.
notify pgrst,'reload schema';
commit;
