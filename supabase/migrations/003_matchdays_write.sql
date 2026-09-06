-- Aplicar una sola vez. Solo permite modificar la fecha calendario.
begin;
grant update (date) on public.matchdays to anon;
create policy matchdays_anon_update on public.matchdays
  for update to anon using (true) with check (true);
commit;
