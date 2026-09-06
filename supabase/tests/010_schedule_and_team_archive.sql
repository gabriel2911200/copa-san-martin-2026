begin;
do $$
declare c uuid; d uuid; a uuid; b uuid; mid uuid; version timestamptz; original jsonb; after_row jsonb; rejected boolean;
begin
  select id into strict c from public.categories where name='Varones';
  select id into strict d from public.matchdays where number=1;
  insert into public.teams(category_id,name) values(c,'__schedule_a_'||gen_random_uuid()) returning id into a;
  insert into public.teams(category_id,name) values(c,'__schedule_b_'||gen_random_uuid()) returning id into b;
  set local role anon;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id,scheduled_date,scheduled_time)
    values(c,d,a,b,'2026-09-13','15:00') returning id,updated_at into mid,version;
  reset role;
  select to_jsonb(m)-array['scheduled_date','scheduled_time','updated_at'] into original from public.matches m where id=mid;
  set local role anon;
  perform public.reschedule_match(mid,'2026-09-27','16:30',version);
  reset role;
  select to_jsonb(m)-array['scheduled_date','scheduled_time','updated_at'] into after_row from public.matches m where id=mid;
  assert original=after_row,'Reprogramación conserva identidad y estado';
  assert (select scheduled_date='2026-09-27' and scheduled_time='16:30' from public.matches where id=mid);
  rejected:=false;
  begin perform public.reschedule_match(mid,'2026-10-01','17:00',version-interval '1 second'); exception when raise_exception then rejected:=true; end;
  assert rejected,'Rechaza versión obsoleta';
  select updated_at into version from public.matches where id=mid;
  rejected:=false;
  begin perform public.reschedule_match(mid,null,'17:00',version); exception when raise_exception then rejected:=true; end;
  assert rejected,'Hora requiere fecha';
  -- Un resultado final tampoco se pierde al corregir su agenda.
  update public.matches set status='FINALIZADO' where id=mid;
  select updated_at into version from public.matches where id=mid;
  set local role anon;
  perform public.reschedule_match(mid,'2026-10-01','17:00',version);
  perform public.archive_team(a);
  perform public.archive_team(a);
  reset role;
  assert (select deleted_at is not null and not active from public.teams where id=a);
  assert (select home_team_id=a and status='FINALIZADO' and matchday_id=d from public.matches where id=mid);
  assert exists(select 1 from public.get_standings(c,false) where team_id=a),'Conserva clasificación histórica';
  assert not has_table_privilege('anon','public.matches','UPDATE');
  assert not has_table_privilege('anon','public.teams','DELETE');
end $$;
rollback;
