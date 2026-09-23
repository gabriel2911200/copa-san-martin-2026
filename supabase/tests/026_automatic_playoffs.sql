begin;
do $$ declare c uuid; ids uuid[]; t uuid; n integer; r integer; pair integer; h integer; a integer;
 day integer; rejected boolean; detail text; j jsonb; kicks jsonb; sf record; home_id uuid:=gen_random_uuid(); away_id uuid:=gen_random_uuid();
begin
 -- Equal PJ with no fourth matchday, independent of the absolute number.
 foreach n in array array[0,2,4,10] loop
   insert into public.categories(name) values('__026_equal_'||n) returning id into c;
   ids:=array[]::uuid[];
   for r in 1..4 loop
     insert into public.teams(category_id,name) values(c,'Equipo '||r) returning id into t;
     ids:=array_append(ids,t);
   end loop;
   for r in 1..n loop
     day:=1+(r-1)/6;
     for pair in 1..2 loop
       if (r-1)%3=0 then h:=case when pair=1 then 1 else 3 end; a:=case when pair=1 then 2 else 4 end;
       elsif (r-1)%3=1 then h:=case when pair=1 then 1 else 2 end; a:=case when pair=1 then 3 else 4 end;
       else h:=case when pair=1 then 1 else 2 end; a:=case when pair=1 then 4 else 3 end; end if;
       insert into public.matches(category_id,matchday_id,home_team_id,away_team_id,status)
       values(c,(select id from public.matchdays where number=day),ids[case when (r-1)%6<3 then h else a end],ids[case when (r-1)%6<3 then a else h end],'FINALIZADO');
     end loop;
   end loop;
   assert not exists(select 1 from public.matches m join public.matchdays d on d.id=m.matchday_id where m.category_id=c and d.number=4);
   set local role anon;
   perform public.close_regular(c);
   if n=0 then
     perform public.create_semifinals(c,ids[1],ids[2],ids[3],ids[4]);
     perform public.create_semifinals(c,ids[1],ids[2],ids[3],ids[4]);
     for sf in select * from public.matches where category_id=c and stage='SEMIFINAL' order by created_at,id loop
       perform public.record_walkover(sf.id,sf.away_team_id,gen_random_uuid(),sf.updated_at);
     end loop;
     assert exists(select 1 from public.matches where category_id=c and stage='FINAL' and home_team_id=ids[1] and away_team_id=ids[3]),'W.O. generates final automatically';
     assert exists(select 1 from public.matches where category_id=c and stage='THIRD_PLACE' and home_team_id=ids[2] and away_team_id=ids[4]);
     perform public.generate_day6(c);
     assert (select count(*) from public.matches where category_id=c and stage<>'REGULAR')=4,'No duplicates';
   end if;
   assert (select regular_closed_at is not null and cardinality(qualified_team_ids)=4 from public.categories where id=c);
   perform public.close_regular(c);
   reset role;
 end loop;
 -- 4/4/3/4 requires an opponent outside the active set (odd sum otherwise).
 insert into public.categories(name) values('__026_unequal') returning id into c;
 ids:=array[]::uuid[];
 for r in 1..5 loop
   insert into public.teams(category_id,name,active) values(c,'Equipo '||r,r<5) returning id into t;
   ids:=array_append(ids,t);
 end loop;
 for pair in 1..4 loop
   for r in 1..case when pair=3 then 3 else 4 end loop
     insert into public.matches(category_id,matchday_id,home_team_id,away_team_id,status)
     values(c,(select id from public.matchdays where number=r),ids[pair],ids[5],'FINALIZADO');
   end loop;
 end loop;
 set local role anon;
 rejected:=false;
 begin perform public.close_regular(c); exception when raise_exception then rejected:=true; detail:=sqlerrm; end;
 assert rejected and detail like '%Equipo 3: 3 PJ%' and detail like '%Equipo 1: 4 PJ%','Useful per-team counts';
 reset role;
 -- All three PJ plus a pending match must still be blocked.
 delete from public.matches where category_id=c and matchday_id=(select id from public.matchdays where number=4);
 insert into public.matches(category_id,matchday_id,home_team_id,away_team_id)
 values(c,(select id from public.matchdays where number=4),ids[1],ids[2]);
 set local role anon;
 rejected:=false;
 begin perform public.close_regular(c); exception when raise_exception then rejected:=true; detail:=sqlerrm; end;
 assert rejected and detail like '%pendientes%';
 reset role;
 -- Formula and equal-count extra rounds, including both scoring and both missing.
 kicks:='[]'::jsonb;
 for r in 1..6 loop
   kicks:=kicks||jsonb_build_array(jsonb_build_object('team_id',case when r%2=1 then home_id else away_id end,'converted',r%2=1));
   j:=public.penalty_decision(home_id,away_id,kicks);
   assert (j->>'winner_team_id' is not null)=(r=6),'3–0 ends after three each, never earlier';
 end loop;
 assert j->>'winner_team_id'=home_id::text and (j->>'decided_at')::int=6;
 -- A 3–2 result that is only decided on attempt ten (not by round count alone).
 kicks:='[]'::jsonb;
 for r in 1..10 loop
   kicks:=kicks||jsonb_build_array(jsonb_build_object('team_id',case when r%2=1 then home_id else away_id end,'converted',r in(1,2,5,6,9)));
   j:=public.penalty_decision(home_id,away_id,kicks);
   assert (j->>'winner_team_id' is not null)=(r=10);
 end loop;
 assert j->>'winner_team_id'=home_id::text;
 kicks:='[]'::jsonb;
 for r in 1..10 loop
   kicks:=kicks||jsonb_build_array(jsonb_build_object('team_id',case when r%2=1 then away_id else home_id end,'converted',true));
 end loop;
 assert public.penalty_decision(home_id,away_id,kicks)->>'winner_team_id' is null;
 for r in 11..14 loop
   kicks:=kicks||jsonb_build_array(jsonb_build_object('team_id',case when r%2=1 then away_id else home_id end,'converted',r<13));
   assert public.penalty_decision(home_id,away_id,kicks)->>'winner_team_id' is null,'Both score or miss: continue';
 end loop;
 kicks:=kicks||jsonb_build_array(jsonb_build_object('team_id',away_id,'converted',true));
 assert public.penalty_decision(home_id,away_id,kicks)->>'winner_team_id' is null,'Leading sixth-or-later shooter cannot win alone';
 kicks:=kicks||jsonb_build_array(jsonb_build_object('team_id',home_id,'converted',false));
 assert public.penalty_decision(home_id,away_id,kicks)->>'winner_team_id'=away_id::text;
end $$;
rollback;
