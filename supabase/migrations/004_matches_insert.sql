begin;
grant insert (category_id, matchday_id, home_team_id, away_team_id, stage, status)
  on public.matches to anon;
create policy matches_anon_insert on public.matches for insert to anon
with check (
  status = 'PROGRAMADO'
  and home_team_id <> away_team_id
  and exists (select 1 from public.teams t where t.id = home_team_id and t.category_id = matches.category_id and t.active)
  and exists (select 1 from public.teams t where t.id = away_team_id and t.category_id = matches.category_id and t.active)
  and exists (
    select 1 from public.matchdays d where d.id = matchday_id
      and ((d.number between 1 and 4 and stage = 'REGULAR')
        or (d.number = 5 and stage = 'SEMIFINAL')
        or (d.number = 6 and stage in ('THIRD_PLACE', 'FINAL')))
  )
);
-- Solo impide repetir exactamente este cruce en la misma jornada y etapa.
create unique index matches_exact_fixture
  on public.matches(category_id, matchday_id, home_team_id, away_team_id, stage);
commit;
