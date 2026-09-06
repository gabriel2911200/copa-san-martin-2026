-- Ejecutar una sola vez en un proyecto Supabase NUEVO y vacío.
-- Este archivo no conecta ni configura Realtime.
begin;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name = btrim(name) and name <> ''),
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id),
  name text not null check (name = btrim(name) and name <> ''),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category_id, name),
  unique (id, category_id)
);

create table public.matchdays (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique check (number > 0),
  date date,
  created_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id),
  matchday_id uuid not null references public.matchdays(id),
  home_team_id uuid not null,
  away_team_id uuid not null,
  status text not null default 'PROGRAMADO'
    check (status in ('PROGRAMADO', 'PRIMER_TIEMPO', 'DESCANSO',
      'SEGUNDO_TIEMPO', 'PAUSADO', 'FINALIZADO')),
  paused_from_status text,
  phase_elapsed_seconds integer not null default 0 check (phase_elapsed_seconds >= 0),
  phase_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (home_team_id <> away_team_id),
  foreign key (home_team_id, category_id) references public.teams(id, category_id),
  foreign key (away_team_id, category_id) references public.teams(id, category_id),
  constraint valid_pause check (
    (status = 'PAUSADO' and paused_from_status is not null
      and paused_from_status in ('PRIMER_TIEMPO', 'DESCANSO', 'SEGUNDO_TIEMPO'))
    or (status <> 'PAUSADO' and paused_from_status is null)
  ),
  constraint valid_clock check (
    (status in ('PRIMER_TIEMPO', 'DESCANSO', 'SEGUNDO_TIEMPO') and phase_started_at is not null)
    or (status in ('PROGRAMADO', 'PAUSADO', 'FINALIZADO') and phase_started_at is null)
  )
);

-- La constante hace que todos los partidos activos compitan por una sola entrada.
-- También protege frente a dos solicitudes simultáneas.
create unique index matches_one_active on public.matches ((true))
  where status in ('PRIMER_TIEMPO', 'DESCANSO', 'SEGUNDO_TIEMPO', 'PAUSADO');
create index matches_matchday on public.matches(matchday_id);
create index matches_category on public.matches(category_id);
create index matches_home_team on public.matches(home_team_id, category_id);
create index matches_away_team on public.matches(away_team_id, category_id);

create table public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id),
  team_id uuid not null references public.teams(id),
  type text not null default 'GOAL' check (type = 'GOAL'),
  period text not null check (period in ('PRIMER_TIEMPO', 'SEGUNDO_TIEMPO')),
  clock_seconds integer not null check (clock_seconds >= 0),
  created_at timestamptz not null default now(),
  voided_at timestamptz
);
create index match_events_match on public.match_events(match_id);
create index match_events_team on public.match_events(team_id);

-- El bloqueo serializa esta validación con cambios de rivales del partido.
create function public.validate_goal_team() returns trigger
language plpgsql set search_path = '' as $$
declare
  home_id uuid;
  away_id uuid;
begin
  select home_team_id, away_team_id into home_id, away_id
    from public.matches where id = new.match_id for update;
  if not found then
    raise exception 'El partido no existe';
  end if;
  if new.team_id not in (home_id, away_id) then
    raise exception 'El equipo del gol debe participar en el partido';
  end if;
  return new;
end;
$$;
create trigger validate_goal_team before insert or update on public.match_events
  for each row execute function public.validate_goal_team();

create function public.prepare_match_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.home_team_id, new.away_team_id, new.category_id)
      is distinct from (old.home_team_id, old.away_team_id, old.category_id)
      and exists (select 1 from public.match_events where match_id = old.id) then
    raise exception 'No se pueden cambiar los rivales o categoría de un partido con eventos';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger prepare_match_update before update on public.matches
  for each row execute function public.prepare_match_update();

create function public.prevent_goal_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Los goles se anulan mediante voided_at; no se eliminan';
end;
$$;
create trigger prevent_goal_delete before delete on public.match_events
  for each row execute function public.prevent_goal_delete();

insert into public.categories(name) values ('Varones'), ('Mujeres');
insert into public.matchdays(number) values (1), (2), (3), (4);

-- Acceso inicial: lectura pública únicamente. La escritura se habilita después.
-- Sin login, los espectadores y /admin comparten el rol anon.
alter table public.categories enable row level security;
alter table public.teams enable row level security;
alter table public.matchdays enable row level security;
alter table public.matches enable row level security;
alter table public.match_events enable row level security;

revoke all on public.categories, public.teams, public.matchdays,
  public.matches, public.match_events from anon, authenticated;
grant usage on schema public to anon;
grant select on public.categories, public.teams, public.matchdays,
  public.matches, public.match_events to anon;

create policy public_read on public.categories for select to anon using (true);
create policy public_read on public.teams for select to anon using (true);
create policy public_read on public.matchdays for select to anon using (true);
create policy public_read on public.matches for select to anon using (true);
create policy public_read on public.match_events for select to anon using (true);

commit;
