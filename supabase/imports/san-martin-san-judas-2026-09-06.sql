-- Carga autorizada: únicamente los cinco GOAL existentes de este partido.
-- Ejecutar con rol propietario después de 020. No crea partidos ni eventos.
begin;
set local lock_timeout='10s';
lock table public.matches,public.match_events,public.players in access exclusive mode;
create temporary table attribution_map(event_id uuid primary key, team_id uuid not null, player_name text not null) on commit drop;
insert into attribution_map values
 ('45d6eb94-eac7-4cb4-b338-f7b8a709aa4d','727c85fc-42ef-49d6-b9e8-d27d4065ec91','Leyson Nain Camacho'),
 ('518f2778-2a00-409b-9148-abe8fd723fcd','727c85fc-42ef-49d6-b9e8-d27d4065ec91','Leyson Nain Camacho'),
 ('925668ce-d802-4f1b-88a2-3f993d57bad7','727c85fc-42ef-49d6-b9e8-d27d4065ec91','Juan José Colque Moncada'),
 ('b718172d-2f3b-4ef2-8b6e-041d640c7549','727c85fc-42ef-49d6-b9e8-d27d4065ec91','Dylan Mamani'),
 ('f89ac51a-9d6f-4af0-9f3b-3dbcc893b6aa','4202eac2-a347-419a-bb9f-6ebcf3612a97','Angelo David Martínez');
create temporary table attribution_before_matches on commit drop as select id,to_jsonb(m) data from public.matches m;
create temporary table attribution_before_events on commit drop as select id,to_jsonb(e) data from public.match_events e;
create temporary table attribution_before_players on commit drop as select id,to_jsonb(p) data from public.players p;
create temporary table attribution_players(team_id uuid,full_name text,player_id uuid,primary key(team_id,full_name)) on commit drop;
do $$ declare r record; pid uuid; n integer;
begin
 if not exists(select 1 from public.matches where id='bd6cf1c6-ba27-4590-89fb-24f4e9a9b757'
   and status='FINALIZADO' and home_team_id='727c85fc-42ef-49d6-b9e8-d27d4065ec91' and away_team_id='4202eac2-a347-419a-bb9f-6ebcf3612a97') then
   raise exception 'El partido no coincide con el autorizado.';
 end if;
 if (select count(*) from public.match_events where match_id='bd6cf1c6-ba27-4590-89fb-24f4e9a9b757' and type='GOAL' and voided_at is null)<>5
 or (select count(*) from attribution_map a join public.match_events e on e.id=a.event_id and e.team_id=a.team_id
   where e.match_id='bd6cf1c6-ba27-4590-89fb-24f4e9a9b757' and e.type='GOAL' and e.voided_at is null)<>5 then
   raise exception 'Los cinco eventos ya no coinciden; no se carga nada.';
 end if;
 for r in select distinct team_id,player_name from attribution_map loop
   select count(*) into n from public.players where team_id=r.team_id
     and lower(translate(regexp_replace(btrim(full_name),'\s+',' ','g'),'áéíóúüñ','aeiouun'))=lower(translate(r.player_name,'áéíóúüñ','aeiouun'));
   if n>1 then raise exception 'Nombre ambiguo: %',r.player_name; end if;
   select id into pid from public.players where team_id=r.team_id
     and lower(translate(regexp_replace(btrim(full_name),'\s+',' ','g'),'áéíóúüñ','aeiouun'))=lower(translate(r.player_name,'áéíóúüñ','aeiouun'));
   if pid is null then
     insert into public.players(team_id,full_name,active) values(r.team_id,r.player_name,true) returning id into pid;
   end if;
   insert into attribution_players values(r.team_id,r.player_name,pid);
 end loop;
 if exists(select 1 from attribution_map a join attribution_players p on p.team_id=a.team_id and p.full_name=a.player_name
   join public.match_events e on e.id=a.event_id where e.player_id is not null and e.player_id<>p.player_id) then
   raise exception 'Un gol ya pertenece a otro jugador; se cancela toda la carga.';
 end if;
 if (select tgenabled from pg_trigger where tgrelid='public.match_events'::regclass and tgname='guard_tournament_event')<>'O' then
   raise exception 'Estado inesperado de la protección de eventos.';
 end if;
end $$;
-- Excepción administrativa acotada: bloqueo exclusivo durante toda la transacción.
-- Se conserva el validador de equipo, FKs y demás triggers; no se habilita una RPC pública.
alter table public.match_events disable trigger guard_tournament_event;
update public.match_events e set player_id=p.player_id,player_name=roster.full_name
from attribution_map a join attribution_players p on p.team_id=a.team_id and p.full_name=a.player_name
join public.players roster on roster.id=p.player_id
where e.id=a.event_id and e.player_id is null;
alter table public.match_events enable trigger guard_tournament_event;
do $$ begin
 if exists(select 1 from attribution_before_matches b full join public.matches m on m.id=b.id where b.data is distinct from to_jsonb(m)) then
   raise exception 'Cambió un partido. Rollback.';
 end if;
 if exists(select 1 from attribution_before_events b full join public.match_events e on e.id=b.id
   where case when b.id in (select event_id from attribution_map)
     then (b.data-array['player_id','player_name']) is distinct from (to_jsonb(e)-array['player_id','player_name'])
     else b.data is distinct from to_jsonb(e) end) then
   raise exception 'Cambió un evento fuera de la atribución autorizada. Rollback.';
 end if;
 if exists(select 1 from attribution_before_players b left join public.players p on p.id=b.id where b.data is distinct from to_jsonb(p)) then
   raise exception 'Cambió un jugador anterior. Rollback.';
 end if;
 if (select count(*) from attribution_map a join public.match_events e on e.id=a.event_id join attribution_players p
   on p.player_id=e.player_id and p.team_id=a.team_id and p.full_name=a.player_name)<>5 then
   raise exception 'Atribución incompleta. Rollback.';
 end if;
end $$;
select e.id,e.period,e.clock_seconds,e.player_name,e.shirt_number,e.team_id from public.match_events e
join attribution_map a on a.event_id=e.id order by e.created_at,e.id;
commit;
