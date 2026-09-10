-- Después de 018. Prepara cargas; no inserta ni modifica datos al aplicarse.
begin;
create table public.player_initial_goals (
  player_id uuid primary key,
  team_id uuid not null,
  goals integer not null check(goals >= 0),
  source text not null check(btrim(source) <> ''),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(player_id,team_id) references public.players(id,team_id)
);
alter table public.player_initial_goals enable row level security;
revoke all on public.player_initial_goals from public,anon,authenticated;
grant select on public.player_initial_goals to anon;
create policy player_initial_goals_read on public.player_initial_goals for select to anon using(true);
alter publication supabase_realtime add table public.player_initial_goals;

-- Solo carga administrativa explícita. No expuesta al navegador.
-- goals es un saldo NO representado ya en match_events, no un total a sumar de nuevo.
-- Reintentos idénticos no duplican; cambios de saldo se rechazan para revisión.
create function public.import_initial_players(p_rows jsonb, p_source text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; tid uuid; pid uuid; pname text; n integer; amount integer; previous integer;
  loaded jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or p_source is null or btrim(p_source)='' then
    raise exception 'Indica una lista de jugadores y una fuente de carga.';
  end if;
  -- Serializa cargas con altas/ediciones para no crear duplicados por concurrencia.
  lock table public.players in share row exclusive mode;
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) is distinct from 'object' or r ? 'shirt_number' then
      raise exception 'Cada fila debe ser un objeto sin dorsal.';
    end if;
    tid := (r->>'team_id')::uuid;
    pname := regexp_replace(btrim(r->>'player_name'),'\s+',' ','g');
    if tid is null or pname is null or pname='' or not exists(
      select 1 from public.teams where id=tid and active and deleted_at is null) then
      raise exception 'Indica nombre y un equipo activo existente.';
    end if;
    pid := null;
    if r->>'player_id' is not null then
      select id into pid from public.players where id=(r->>'player_id')::uuid and team_id=tid
        and lower(regexp_replace(btrim(full_name),'\s+',' ','g'))=lower(pname);
      if pid is null then raise exception 'El ID, nombre y equipo no corresponden al mismo jugador.'; end if;
    else
      select count(*) into n from public.players where team_id=tid
        and lower(regexp_replace(btrim(full_name),'\s+',' ','g'))=lower(pname);
      if n>1 then raise exception 'Nombre ambiguo: indica player_id para evitar duplicados.'; end if;
      select id into pid from public.players where team_id=tid
        and lower(regexp_replace(btrim(full_name),'\s+',' ','g'))=lower(pname);
      if pid is null then
        insert into public.players(team_id,full_name,active) values(tid,pname,true) returning id into pid;
      end if;
    end if;
    if r ? 'goals' then
      if jsonb_typeof(r->'goals') is distinct from 'number' or (r->>'goals') !~ '^[0-9]+$' then
        raise exception 'Los goles deben ser un entero no negativo.';
      end if;
      amount := (r->>'goals')::integer;
      select goals into previous from public.player_initial_goals where player_id=pid;
      if found and previous<>amount then raise exception 'Este jugador ya tiene otro saldo inicial. Revisa la carga.'; end if;
      insert into public.player_initial_goals(player_id,team_id,goals,source)
        values(pid,tid,amount,btrim(p_source)) on conflict(player_id) do nothing;
    end if;
    loaded := loaded || jsonb_build_array(jsonb_build_object('player_id',pid,'team_id',tid,'player_name',pname));
  end loop;
  return loaded;
end $$;
revoke all on function public.import_initial_players(jsonb,text) from public,anon,authenticated;

create or replace function public.get_top_scorers(p_category_id uuid default null)
returns table("position" bigint,player_id uuid,player_name text,team_id uuid,team_name text,category_id uuid,goals bigint)
language sql stable security invoker set search_path='' as $$
  with contributions as (
    select e.player_id,count(*)::bigint goals
    from public.match_events e join public.matches m on m.id=e.match_id
    where e.type='GOAL' and e.voided_at is null and e.player_id is not null and m.status<>'PROGRAMADO'
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
notify pgrst, 'reload schema';
commit;
