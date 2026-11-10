begin;
do $$ declare c uuid; h uuid; a uuid; mid uuid; j jsonb; rejected boolean; kick boolean;
begin
 insert into public.categories(name) values('__030_three') returning id into c;
 insert into public.teams(category_id,name) values(c,'H') returning id into h;
 insert into public.teams(category_id,name) values(c,'A') returning id into a;
 for scenario in 1..2 loop
 j:=public.create_friendly(c,h,a,null,null,900,true,gen_random_uuid());mid:=(j->'match'->>'id')::uuid;
 update public.matches set status='PAUSADO',paused_from_status='SEGUNDO_TIEMPO',phase_elapsed_seconds=900 where id=mid;
 set local role anon;
 j:=public.open_penalty_shootout(mid,gen_random_uuid(),(select updated_at from public.matches where id=mid));
 j:=public.manage_penalty_shootout(mid,'SET_THREE',null,null,null,gen_random_uuid(),0);
 assert (j->'shootout'->>'initial_attempts')::int=3;
 for i in 0..case when scenario=1 then 3 else 7 end loop
   kick:=case when scenario=1 then i%2=0 else i<>6 end;
   j:=public.manage_penalty_shootout(mid,'RECORD',case when i%2=0 then h else a end,null,kick,gen_random_uuid(),i+1);
   if i=0 then
     rejected:=false;
     begin perform public.manage_penalty_shootout(mid,'SET_FIVE',null,null,null,gen_random_uuid(),2); exception when raise_exception then rejected:=true; end;
     assert rejected,'Cannot change agreed kicks after the first shot';
   end if;
   if scenario=2 and i=5 then
     assert j->'shootout'->>'completed_at' is null,'Tie never declares a winner';
     rejected:=false;
     begin perform public.manage_penalty_shootout(mid,'FINISH_MANUAL',null,null,null,gen_random_uuid(),7); exception when raise_exception then rejected:=true; end;
     assert rejected,'Manual tie is rejected';
   end if;
 end loop;
 assert j->'match'->>'status'='FINALIZADO';
 assert (j->'shootout'->>'winner_team_id')::uuid=case when scenario=1 then h else a end;
 assert jsonb_array_length(j->'shootout'->'attempts')=case when scenario=1 then 4 else 8 end;
 reset role;
 end loop;
end $$;
rollback;
