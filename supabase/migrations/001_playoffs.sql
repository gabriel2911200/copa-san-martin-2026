-- Ejecutar UNA SOLA VEZ después de schema.sql, en el mismo proyecto.
-- Preparación estructural: no genera partidos ni implementa eliminatorias.
begin;

-- Los partidos existentes y los nuevos sin stage explícito serán REGULAR.
alter table public.matches
  add column stage text not null default 'REGULAR'
  constraint matches_stage_check
    check (stage in ('REGULAR', 'SEMIFINAL', 'THIRD_PLACE', 'FINAL'));

-- Sin valor predeterminado: los partidos existentes conservan NULL.
-- Representa al ganador POR PENALES, sin registrar una tanda detallada.
-- No agrega goles a match_events ni modifica el marcador reglamentario.
-- La lógica futura deberá exigir empate reglamentario para usar este campo
-- e impedir resolver una eliminatoria empatada mientras siga en NULL.
alter table public.matches
  add column tiebreak_winner_team_id uuid
    references public.teams(id),
  add constraint matches_tiebreak_winner_check check (
    tiebreak_winner_team_id is null
    or (
      stage in ('SEMIFINAL', 'THIRD_PLACE', 'FINAL')
      and tiebreak_winner_team_id in (home_team_id, away_team_id)
    )
  );

-- Conserva las fechas existentes y no modifica sus días de celebración.
insert into public.matchdays (number)
values (5), (6)
on conflict (number) do nothing;

commit;
