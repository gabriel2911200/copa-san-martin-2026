begin;
do $$ declare c uuid; h uuid; a uuid; t3 uuid; t4 uuid; mid uuid; starter uuid; opponent uuid; j jsonb; rid uuid; kick uuid; rejected boolean; converted boolean;
begin
 assert not has_function_privilege('anon','public.start_penalty_shootout(uuid,uuid,uuid,timestamptz)','EXECUTE');
 foreach converted in array array[true,false] loop
 for side in 1..2 loop
 insert into public.categories(name) values('__027_'||gen_random_uuid()) returning id into c;
 insert into public.teams(category_id,name) values(c,'A') returning id into h;
 insert into public.teams(category_id,name) values(c,'B') returning id into a;
 insert into public.teams(category_id,name) values(c,'C') returning id into t3;
 insert into public.teams(category_id,name) values(c,'D') returning id into t4;
 perform public.close_regular(c);
 insert into public.matches(category_id,matchday_id,home_team_id,away_team_id,stage,status,paused_from_status,phase_elapsed_seconds)
 values(c,(select id from public.matchdays where number=5),h,a,'SEMIFINAL','PAUSADO','SEGUNDO_TIEMPO',900) returning id into mid;
 starter:=case when side=1 then h else a end; opponent:=case when side=1 then a else h end;
 set local role anon;
 j:=public.open_penalty_shootout(mid,gen_random_uuid(),(select updated_at from public.matches where id=mid));
 assert j->'shootout'->>'first_team_id' is null and j->'shootout'->>'next_team_id' is null;
 assert jsonb_array_length(j->'shootout'->'attempts')=0;
 rejected:=false;
 begin perform public.manage_penalty_shootout(mid,'RECORD',starter,null,null,gen_random_uuid(),0);
 exception when raise_exception then rejected:=true; end;
 assert rejected;
 assert (public.get_match_control(mid)->'shootout'->>'first_team_id') is null,'Invalid first kick rolls back starter';
 rid:=gen_random_uuid();
 j:=public.manage_penalty_shootout(mid,'RECORD',starter,null,converted,rid,0);
 assert (j->'shootout'->>'first_team_id')::uuid=starter;
 assert (j->'shootout'->>'next_team_id')::uuid=opponent;
 kick:=(j->'shootout'->'attempts'->0->>'id')::uuid;
 j:=public.manage_penalty_shootout(mid,'RECORD',starter,null,converted,rid,0);
 assert jsonb_array_length(j->'shootout'->'attempts')=1,'Lost response replay is idempotent';
 rejected:=false;
 begin perform public.manage_penalty_shootout(mid,'RECORD',opponent,null,true,gen_random_uuid(),0);
 exception when raise_exception then rejected:=true; end;
 assert rejected,'Competing first request with stale revision is rejected';
 rejected:=false;
 begin perform public.manage_penalty_shootout(mid,'RECORD',starter,null,true,gen_random_uuid(),1);
 exception when raise_exception then rejected:=true; end;
 assert rejected,'Same team cannot kick twice';
 j:=public.open_penalty_shootout(mid,gen_random_uuid(),'2000-01-01');
 assert (j->'shootout'->>'first_team_id')::uuid=starter,'Opening again never changes order';
 j:=public.manage_penalty_shootout(mid,'VOID',null,kick,null,gen_random_uuid(),1);
 assert (j->'shootout'->>'first_team_id')::uuid=starter and (j->'shootout'->>'next_team_id')::uuid=starter;
 assert jsonb_array_length(j->'shootout'->'attempts')=0;
 j:=public.manage_penalty_shootout(mid,'RECORD',starter,null,converted,gen_random_uuid(),2);
 assert (j->'shootout'->>'next_team_id')::uuid=opponent;
 reset role;
 -- Release the global active-match slot for the next isolated case.
 delete from public.matches where id=mid;
 end loop;
 end loop;
end $$;
rollback;
