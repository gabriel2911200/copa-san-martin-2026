-- Un autogol conserva tipo GOAL y equipo beneficiado, pero no tiene jugador.
-- No altera eventos ni marcadores; permite únicamente la etiqueta explícita.
begin;
alter table public.match_events drop constraint match_events_player_snapshot;
alter table public.match_events add constraint match_events_player_snapshot check (
  (player_id is null and player_name is null and shirt_number is null)
  or (player_id is not null and player_name is not null and (shirt_number is not null or type='GOAL'))
  or (type='GOAL' and player_id is null and player_name='Autogol' and shirt_number is null)
);
commit;
