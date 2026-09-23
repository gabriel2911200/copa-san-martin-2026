-- Solo fixtures locales/transaccionales. No ejecutar sobre producción.
begin;
do $$ declare c uuid; h uuid; a uuid; t3 uuid; t4 uuid; mid uuid; other_mid uuid; closed_mid uuid; closed_goal uuid;
  p uuid; q uuid; replacement uuid; eid uuid; j jsonb; original jsonb; before_score jsonb;
  rid uuid:=gen_random_uuid(); version timestamptz; rejected boolean; kind text; sf record;
begin
  insert into public.categories(name) values('__wo_'||gen_random_uuid()) returning id into c;
  insert into public.teams(category_id,name) values(c,'San Martín') returning id into h;
  insert into public.teams(category_id,name) values(c,'San Pablo') returning id into a;
  insert into public.teams(category_id,name) values(c,'Tercero') returning id into t3;
  insert into public.teams(category_id,name) values(c,'Cuarto') returning id into t4;
  insert into public.players(team_id,full_name) values(h,'Jugador A') returning id into p;
  insert into public.players(team_id,full_name) values(h,'Jugador B') returning id into replacement;
  insert into public.players(team_id,full_name) values(a,'Rival') returning id into q;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id)
    values(c,(select id from public.matchdays where number=1),h,a) returning id into mid;
  set local role anon;
  select updated_at into version from public.matches where id=mid;
  rejected:=false;
  begin perform public.record_walkover(mid,t3,rid,version); exception when raise_exception then rejected:=true; end;
  assert rejected,'W.O. rechaza equipos ajenos';
  rejected:=false;
  begin perform public.record_walkover(mid,h,rid,version-interval '1 second'); exception when raise_exception then rejected:=true; end;
  assert rejected,'W.O. exige versión vigente';
  j:=public.record_walkover(mid,h,rid,version);
  assert j->'score'='{"home":0,"away":3}'::jsonb;
  assert j->'match'->>'status'='FINALIZADO';
  assert j->'match'->>'phase_started_at' is null;
  assert public.record_walkover(mid,h,rid,version)->'score'=j->'score','Reintento idempotente';
  assert not exists(select 1 from public.match_events where match_id=mid),'No goles ficticios';
  assert not exists(select 1 from public.get_top_scorers(c)),'Cero goles de jugadores';
  assert exists(select 1 from public.get_standings(c,false) where team_id=a and gf=3 and gc=0 and dg=3 and pg=1 and pts=3 and pj=1);
  assert exists(select 1 from public.get_standings(c,false) where team_id=h and gf=0 and gc=3 and dg=-3 and pp=1 and pts=0 and pj=1);
  assert public.match_outcome(mid)->>'winner_team_id'=a::text;
  assert exists(select 1 from jsonb_array_elements(public.get_tournament()->'matches') x where x->'match'->>'id'=mid::text and x->'score'='{"home":0,"away":3}'::jsonb);
  rejected:=false;
  begin perform public.record_walkover(mid,a,gen_random_uuid(),version); exception when raise_exception then rejected:=true; end;
  assert rejected,'No cambia silenciosamente un W.O. confirmado';

  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id)
    values(c,(select id from public.matchdays where number=4),h,a) returning id into other_mid;
  perform public.save_match_precheck(other_mid,true,true,true,true,(select updated_at from public.matches where id=other_mid));
  perform public.set_match_player(other_mid,p,5,true,(select updated_at from public.matches where id=other_mid));
  perform public.set_match_player(other_mid,replacement,8,true,(select updated_at from public.matches where id=other_mid));
  perform public.set_match_player(other_mid,q,10,true,(select updated_at from public.matches where id=other_mid));
  perform public.control_match(other_mid,'START',(select updated_at from public.matches where id=other_mid));
  foreach kind in array array['GOAL','YELLOW_CARD','RED_CARD'] loop
    perform public.record_match_event(other_mid,h,kind,p,gen_random_uuid());
  end loop;
  j:=public.record_own_goal(other_mid,a,gen_random_uuid()); eid:=(j->'event'->>'id')::uuid;
  assert j->'control'->'score'='{"home":1,"away":1}'::jsonb;
  rejected:=false;
  begin perform public.record_walkover(other_mid,h,gen_random_uuid(),(select updated_at from public.matches where id=other_mid)); exception when raise_exception then rejected:=true; end;
  assert rejected,'No mezcla W.O. con eventos válidos';
  perform public.control_match(other_mid,'BREAK',(select updated_at from public.matches where id=other_mid));
  perform public.control_match(other_mid,'SECOND_HALF',(select updated_at from public.matches where id=other_mid));
  perform public.control_match(other_mid,'FINISH',(select updated_at from public.matches where id=other_mid));
  -- Un jugador dado de baja después del partido conserva su convocatoria histórica.
  update public.players set active=false where id=replacement;
  foreach kind in array array['GOAL','YELLOW_CARD','RED_CARD'] loop
    select to_jsonb(e) into original from public.match_events e where match_id=other_mid and type=kind and player_id=p;
    before_score:=public.get_match_control(other_mid)->'score';
    j:=public.edit_match_event_player(other_mid,(original->>'id')::uuid,replacement,p);
    assert j->'control'->'score'=before_score,'Atribución no cambia marcador';
    assert ((j->'event')-array['player_id','player_name','shirt_number'])=(original-array['player_id','player_name','shirt_number']);
    assert j->'event'->>'shirt_number'='8';
    assert public.edit_match_event_player(other_mid,(original->>'id')::uuid,replacement,p)->'event'=j->'event';
    if kind='GOAL' then
      assert not exists(select 1 from public.get_top_scorers(c) where player_id=p);
      assert exists(select 1 from public.get_top_scorers(c) where player_id=replacement and goals=1);
    end if;
  end loop;
  perform public.void_match_event(other_mid,eid);
  assert public.get_match_control(other_mid)->'score'='{"home":1,"away":0}'::jsonb,'Autogol finalizado reversible';
  select id into eid from public.match_events where match_id=other_mid and type='GOAL' and player_id=replacement;
  perform public.void_match_event(other_mid,eid);
  assert public.get_match_control(other_mid)->'score'='{"home":0,"away":0}'::jsonb;
  assert not exists(select 1 from public.get_top_scorers(c));
  assert exists(select 1 from public.get_standings(c,false) where team_id=h and gf=0 and gc=3 and pe=1 and pp=1 and pts=1);
  assert (select count(*) from public.match_events where match_id=other_mid)=4,'Conserva historial';
  update public.players set active=true where id=replacement;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id)
    values(c,(select id from public.matchdays where number=3),h,a) returning id into closed_mid;
  perform public.save_match_precheck(closed_mid,true,true,true,true,(select updated_at from public.matches where id=closed_mid));
  perform public.set_match_player(closed_mid,p,5,true,(select updated_at from public.matches where id=closed_mid));
  perform public.set_match_player(closed_mid,replacement,8,true,(select updated_at from public.matches where id=closed_mid));
  perform public.set_match_player(closed_mid,q,10,true,(select updated_at from public.matches where id=closed_mid));
  perform public.control_match(closed_mid,'START',(select updated_at from public.matches where id=closed_mid));
  j:=public.record_match_event(closed_mid,h,'GOAL',p,gen_random_uuid()); closed_goal:=(j->'event'->>'id')::uuid;
  perform public.control_match(closed_mid,'BREAK',(select updated_at from public.matches where id=closed_mid));
  perform public.control_match(closed_mid,'SECOND_HALF',(select updated_at from public.matches where id=closed_mid));
  perform public.control_match(closed_mid,'FINISH',(select updated_at from public.matches where id=closed_mid));
  perform public.close_regular(c);
  perform public.create_semifinals(c,h,a,t3,t4);
  perform public.edit_match_event_player(closed_mid,closed_goal,replacement,p);
  assert public.get_match_control(closed_mid)->'score'='{"home":1,"away":0}'::jsonb,'Atribución permitida con clasificación cerrada';
  rejected:=false;
  begin perform public.void_match_event(closed_mid,closed_goal); exception when raise_exception then rejected:=true; end;
  assert rejected,'No altera clasificados con semifinales dependientes';
  -- Corrección de tarjeta permitida aun con fase cerrada y semifinales generadas.
  select id into eid from public.match_events where match_id=other_mid and type='RED_CARD';
  perform public.edit_match_event_player(other_mid,eid,p,replacement);
  perform public.void_match_event(other_mid,eid);
  rejected:=false;
  begin perform public.record_walkover(other_mid,h,gen_random_uuid(),(select updated_at from public.matches where id=other_mid)); exception when raise_exception then rejected:=true; end;
  assert rejected,'Protege fase regular cerrada';
  for sf in select * from public.matches where category_id=c and stage='SEMIFINAL' loop
    perform public.record_walkover(sf.id,sf.away_team_id,gen_random_uuid(),sf.updated_at);
    assert public.match_outcome(sf.id)->>'winner_team_id'=sf.home_team_id::text;
  end loop;
  perform public.generate_day6(c);
  assert (select count(*) from public.matches where category_id=c and stage in ('FINAL','THIRD_PLACE'))=2;
  for sf in select * from public.matches where category_id=c and stage in ('FINAL','THIRD_PLACE') loop
    j:=public.record_walkover(sf.id,sf.home_team_id,gen_random_uuid(),sf.updated_at);
    assert j->'score'='{"home":0,"away":3}'::jsonb;
    assert (public.match_outcome(sf.id)->>'resolved')::boolean;
  end loop;
  assert exists(select 1 from public.get_top_scorers(c) where player_id=replacement and goals=1),'Los W.O. no alteran goleadores anteriores';
end $$;
reset role;
do $$ declare c uuid; h uuid; a uuid; mid uuid; p uuid; q uuid; j jsonb; eid uuid; rejected boolean;
begin
  insert into public.categories(name) values('__wo_active_'||gen_random_uuid()) returning id into c;
  insert into public.teams(category_id,name) values(c,'Local') returning id into h;
  insert into public.teams(category_id,name) values(c,'Visitante') returning id into a;
  insert into public.players(team_id,full_name) values(h,'Local') returning id into p;
  insert into public.players(team_id,full_name) values(a,'Visitante') returning id into q;
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id)
    values(c,(select id from public.matchdays where number=1),h,a) returning id into mid;
  set local role anon;
  perform public.save_match_precheck(mid,true,true,true,true,(select updated_at from public.matches where id=mid));
  perform public.set_match_player(mid,p,5,true,(select updated_at from public.matches where id=mid));
  perform public.set_match_player(mid,q,10,true,(select updated_at from public.matches where id=mid));
  perform public.control_match(mid,'START',(select updated_at from public.matches where id=mid));
  j:=public.record_match_event(mid,h,'GOAL',p,gen_random_uuid()); eid:=(j->'event'->>'id')::uuid;
  perform public.void_match_event(mid,eid);
  j:=public.record_walkover(mid,a,gen_random_uuid(),(select updated_at from public.matches where id=mid));
  assert j->'score'='{"home":3,"away":0}'::jsonb;
  assert j->'match'->>'phase_started_at' is null and j->'match'->>'paused_from_status' is null;
  assert (select count(*) from public.match_events where match_id=mid)=1;
  assert (select voided_at is not null from public.match_events where id=eid),'Conserva evento anulado';
  assert not exists(select 1 from public.get_top_scorers(c));
  insert into public.matches(category_id,matchday_id,home_team_id,away_team_id)
    values(c,(select id from public.matchdays where number=2),h,a) returning id into mid;
  perform public.save_match_precheck(mid,true,true,true,true,(select updated_at from public.matches where id=mid));
  perform public.set_match_player(mid,p,5,true,(select updated_at from public.matches where id=mid));
  perform public.set_match_player(mid,q,10,true,(select updated_at from public.matches where id=mid));
  perform public.control_match(mid,'START',(select updated_at from public.matches where id=mid));
  perform public.record_match_event(mid,h,'FOUL',null,gen_random_uuid());
  rejected:=false;
  begin perform public.record_walkover(mid,h,gen_random_uuid(),(select updated_at from public.matches where id=mid)); exception when raise_exception then rejected:=true; end;
  assert rejected,'Faltas acumuladas requieren revisión, no borrado silencioso';
end $$;
rollback;
