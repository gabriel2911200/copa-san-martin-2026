-- Applied only by the embedded test runner, BEFORE migration 026.
do $$ declare c uuid; ids uuid[]:=array[]::uuid[]; t uuid; mid uuid; r integer;
begin
 insert into public.categories(name) values('__026_legacy') returning id into c;
 for r in 1..4 loop
   insert into public.teams(category_id,name) values(c,'Legacy '||r) returning id into t;
   ids:=array_append(ids,t);
 end loop;
 update public.categories set regular_closed_at=clock_timestamp(),qualified_team_ids=ids where id=c;
 insert into public.matches(category_id,matchday_id,home_team_id,away_team_id,stage,status,tiebreak_winner_team_id)
 values(c,(select id from public.matchdays where number=5),ids[1],ids[2],'SEMIFINAL','FINALIZADO',ids[1]) returning id into mid;
 insert into public.penalty_shootouts(match_id,first_team_id,request_id,completed_at)
 values(mid,ids[1],gen_random_uuid(),clock_timestamp());
 insert into public.penalty_shootout_attempts(match_id,team_id,sequence,converted,request_id)
 values(mid,ids[1],1,true,gen_random_uuid()),(mid,ids[2],2,false,gen_random_uuid());
 insert into public.matches(category_id,matchday_id,home_team_id,away_team_id,stage,status,tiebreak_winner_team_id)
 values(c,(select id from public.matchdays where number=5),ids[3],ids[4],'SEMIFINAL','FINALIZADO',ids[3]);
end $$;
