begin;
-- Consulta sin escrituras, sujeta a las políticas SELECT del llamador.
-- false permite consultar la clasificación definitiva sin partidos activos.
create function public.get_standings(p_category_id uuid, p_include_live boolean default true)
returns table (
  team_id uuid, team_name text, pj bigint, pg bigint, pe bigint, pp bigint,
  gf bigint, gc bigint, dg bigint, pts bigint, "position" bigint, is_live boolean
)
language sql stable security invoker set search_path = '' as $$
  with eligible_matches as (
    select m.* from public.matches m
    where m.category_id=p_category_id and m.stage='REGULAR'
      and (m.status='FINALIZADO' or (p_include_live and m.status in
        ('PRIMER_TIEMPO','DESCANSO','SEGUNDO_TIEMPO','PAUSADO')))
  ), scores as (
    select m.id, m.home_team_id, m.away_team_id,
      count(e.id) filter (where e.team_id=m.home_team_id) as home_goals,
      count(e.id) filter (where e.team_id=m.away_team_id) as away_goals
    from eligible_matches m left join public.match_events e
      on e.match_id=m.id and e.type='GOAL' and e.voided_at is null
    group by m.id,m.home_team_id,m.away_team_id
  ), results as (
    select home_team_id as team_id,home_goals as gf,away_goals as gc from scores
    union all
    select away_team_id,away_goals,home_goals from scores
  ), totals as (
    select t.id as team_id,t.name as team_name,count(r.team_id) as pj,
      count(r.team_id) filter(where r.gf>r.gc) as pg,
      count(r.team_id) filter(where r.gf=r.gc) as pe,
      count(r.team_id) filter(where r.gf<r.gc) as pp,
      coalesce(sum(r.gf),0)::bigint as gf,coalesce(sum(r.gc),0)::bigint as gc
    from public.teams t left join results r on r.team_id=t.id
    where t.category_id=p_category_id and (t.active or exists
      (select 1 from results played where played.team_id=t.id))
    group by t.id,t.name
  ), calculated as (
    select t.*,t.gf-t.gc as dg,t.pg*3+t.pe as pts from totals t
  )
  select c.team_id,c.team_name,c.pj,c.pg,c.pe,c.pp,c.gf,c.gc,c.dg,c.pts,
    row_number() over(order by c.pts desc,c.dg desc,c.gf desc,c.team_name asc,c.team_id asc),
    exists(select 1 from eligible_matches where status<>'FINALIZADO')
  from calculated c
  order by c.pts desc,c.dg desc,c.gf desc,c.team_name asc,c.team_id asc;
$$;
revoke all on function public.get_standings(uuid,boolean) from public,anon,authenticated;
grant execute on function public.get_standings(uuid,boolean) to anon;
commit;
