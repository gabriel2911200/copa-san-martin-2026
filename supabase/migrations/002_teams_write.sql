begin;
grant insert (category_id, name, active), update (name, active)
  on public.teams to anon;
create policy teams_anon_insert on public.teams
  for insert to anon with check (true);
create policy teams_anon_update on public.teams
  for update to anon using (true) with check (true);
commit;
