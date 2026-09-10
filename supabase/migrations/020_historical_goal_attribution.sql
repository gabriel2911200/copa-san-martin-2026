-- Compatible desde 014. Solo permite que un gol atribuido no tenga dorsal conocido.
-- No modifica datos ni habilita edición pública: los triggers siguen protegiendo eventos.
begin;
alter table public.match_events drop constraint match_events_player_snapshot;
alter table public.match_events add constraint match_events_player_snapshot check (
  (player_id is null and player_name is null and shirt_number is null)
  or (player_id is not null and player_name is not null and (shirt_number is not null or type='GOAL'))
);
commit;
