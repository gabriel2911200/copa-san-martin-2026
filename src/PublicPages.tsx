import { useCallback, useEffect, useRef, useState } from 'react'
import MatchDetails, { MatchTimeline } from './MatchDetails'
import MatchStats from './MatchStats'
import ScheduleEditor from './ScheduleEditor'
import DeleteMatchButton from './DeleteMatchButton'
import { useTournament } from './lib/useTournament'
import { clockAt, elapsedSeconds, formatClock, timeoutSeconds } from './lib/matchClock'
import { currentPeriod } from './lib/matchEvents'
import { featuredMatch, isActive, podium, stageLabels, teamName } from './lib/tournament'
import type { PublicMatch, Tournament } from './lib/tournament'
import type { LiveChange } from './lib/useLiveRefresh'

export function PublicMatchCard({ item, clock = false, statistics = false, refresh }: { item: PublicMatch; clock?: boolean; statistics?: boolean; refresh?: () => Promise<void> }) {
  const [now,setNow] = useState(() => Date.parse(item.server_now))
  useEffect(() => {
    if (!clock && !item.match.timeout_started_at) return
    const start = performance.now()
    const server = Date.parse(item.server_now)
    const tick = () => setNow(server + performance.now() - start)
    const initial = setTimeout(tick,0)
    const timer = setInterval(tick,1000)
    return () => { clearTimeout(initial); clearInterval(timer) }
  }, [item.server_now,clock,item.match.timeout_started_at])
  const displayMatch = clockAt(item.match, now)
  const inTimeout = displayMatch.status === 'TIEMPO_MUERTO'
  const penalty = item.match.tiebreak_winner_team_id
  return <article className={`match-card ${clock?'featured-match':''}`}>
    <div className="match-meta"><span>{item.category} · Fecha {item.matchday}</span><span>{stageLabels[item.match.stage]}</span></div>
    {isActive(item) && <MatchStats match={displayMatch} fouls={item.fouls} events={item.events} home={item.home} away={item.away}/>}
    <div className="score-line"><p>{item.home}</p><strong className={item.match.status==='PROGRAMADO'?'scheduled-score':''}>{item.match.status==='PROGRAMADO'?'Programado':`${item.score.home} - ${item.score.away}`}</strong><p>{item.away}</p></div>
    <div className="match-status"><span className={isActive(item)&&!inTimeout?'live-dot':''}>{inTimeout?`En vivo · ${currentPeriod(displayMatch)}T`:isActive(item)?`En vivo · ${displayMatch.status.replaceAll('_',' ')}`:item.match.status==='FINALIZADO'?'Resultado final':'Pendiente de inicio'}</span>
      {(clock||inTimeout)&&isActive(item)&&<p role="timer" aria-label="Cronómetro">{formatClock(elapsedSeconds(displayMatch,now))}</p>}
    </div>
    {inTimeout && <div className="public-timeout" role="region" aria-label="Minuto en curso">
      <p className="public-timeout-title">⏸️ MINUTO</p>
      <p>{teamName(item, item.match.timeout_team_id ?? null)}</p>
      <p>Tiempo del partido: {currentPeriod(displayMatch)}T {formatClock(elapsedSeconds(displayMatch,now))} · Detenido</p>
      <p role="timer" aria-label="Contador de minuto">{formatClock(60 - timeoutSeconds(displayMatch,now))}</p>
    </div>}
    <p className="schedule-line">{item.match.scheduled_date?item.match.scheduled_date.split('-').reverse().join('/'):'Fecha individual por confirmar'} · {item.match.scheduled_time?.slice(0,5)??'Hora por confirmar'} <small>Tarija</small></p>
    {penalty&&item.score.home===item.score.away&&<p className="penalty-label">{teamName(item,penalty)} gana por penales</p>}
    {(statistics || (!clock && item.match.status !== 'PROGRAMADO')) && <MatchDetails item={item} refresh={refresh}/>}
    {clock && isActive(item) && !statistics && <section className="live-match-stats p-3" aria-label="Estadísticas del partido">
      <h2>ESTADÍSTICAS DEL PARTIDO</h2>
      <MatchTimeline item={item}/>
    </section>}
  </article>
}

export function Podium({ data, categoryId }: { data: Tournament; categoryId: string }) {
  const names = podium(data.matches,categoryId)
  if (!names) return null
  return <section className="space-y-2 rounded-xl bg-blue-50 p-5">
    <h2 className="text-xl font-bold">Resultado final · {data.categories.find(c=>c.id===categoryId)?.name}</h2>
    {names.map((name,i)=><p key={i}><strong>{['CAMPEÓN','SUBCAMPEÓN','TERCER LUGAR','CUARTO LUGAR'][i]}</strong> · {name}</p>)}
  </section>
}

export function InicioPage() {
  const candidate = useRef<{ id: string; matchId: string; received: number } | null>(null)
  const seen = useRef(new Set<string>())
  const [celebration,setCelebration] = useState('')
  const onChange = useCallback((change: LiveChange) => {
    const event = change.new as Record<string, unknown>
    if (change.table === 'match_events' && change.eventType === 'INSERT' && event.type === 'GOAL' && !event.voided_at && typeof event.id === 'string' && !seen.current.has(event.id)) {
      seen.current.add(event.id)
      candidate.current = { id:event.id, matchId:String(event.match_id), received:performance.now() }
    }
    if (change.table === 'match_events' && change.eventType === 'UPDATE' && event.voided_at) setCelebration('')
  }, [])
  const {data,error,loading}=useTournament(onChange)
  useEffect(() => {
    const event = candidate.current
    if (!data || !event) return
    const match = data.matches.find(m=>m.match.id===event.matchId)
    const goal = match?.goals.find(g=>g.id===event.id)
    if (!match || !goal || !isActive(match) || performance.now()-event.received>10000) return
    candidate.current=null
    const show = setTimeout(()=>setCelebration(teamName(match,goal.team_id)),0)
    return ()=>{clearTimeout(show)}
  },[data])
  useEffect(()=>{
    if(!celebration) return
    const timer=setTimeout(()=>setCelebration(''),4000)
    return ()=>clearTimeout(timer)
  },[celebration])
  const featured=data && featuredMatch(data.matches)
  const latest = data?.matches.filter(m=>m.match.status==='FINALIZADO').sort((a,b)=>b.match.updated_at.localeCompare(a.match.updated_at))[0]
  return <div className="space-y-6">
    <section className="hero"><div><p className="eyebrow">LA PASIÓN NOS UNE</p><h1>Copa Martín <span>2026</span></h1><p>El campeonato se vive aquí.</p></div><img src="/brand/copa.png" alt="Logo oficial Copa Martín"/></section>
    {celebration && <div role="status" className="rounded-xl bg-green-100 p-6 text-center text-2xl font-bold text-green-900">¡GOOOL!<br/>{celebration}</div>}
    {loading && <p role="status">Cargando campeonato…</p>}
    {error && <p role="alert">{error}</p>}
    {featured ? <><h2 className="text-xl font-bold">{isActive(featured)?'EN VIVO':'Próximo partido'}</h2><PublicMatchCard item={featured} clock /></> : !loading && <p>No hay partidos activos ni programados.</p>}
    {!featured && latest && <><h2>Último resultado</h2><PublicMatchCard item={latest}/></>}
    {data?.categories.map(c=><div key={c.id} className="space-y-4">
      <Podium data={data} categoryId={c.id}/>
      {c.regular_closed_at && <><h2 className="text-xl font-bold">Fase eliminatoria · {c.name}</h2>
        {data.matches.filter(m=>m.match.category_id===c.id && m.match.stage!=='REGULAR').map(m=><PublicMatchCard key={m.match.id} item={m}/>)}
        {!data.matches.some(m=>m.match.category_id===c.id && m.match.stage!=='REGULAR') && <p>Clasificados definidos. Cruces pendientes.</p>}
      </>}
    </div>)}
  </div>
}

export function PartidosPage({admin=false}:{admin?:boolean}) {
  const {data,error,loading,refresh}=useTournament()
  const [category,setCategory]=useState('all')
  const [deleted,setDeleted]=useState<string[]>([])
  return <div className="space-y-5"><div className="page-heading"><div><p className="eyebrow">CADA ENCUENTRO, EN UN LUGAR</p><h1>Calendario</h1></div></div>
    <div className="category-tabs"><button aria-pressed={category==='all'} onClick={()=>setCategory('all')}>Todos</button>{data?.categories.map(c=><button key={c.id} aria-pressed={category===c.id} onClick={()=>setCategory(c.id)}>{c.name}</button>)}</div>
    {loading&&<p role="status">Cargando calendario…</p>}{error&&<p role="alert">{error}</p>}
    {data?.matchdays.map(d=>{
      const matches=data.matches.filter(m=>m.match.status==='FINALIZADO'&&!deleted.includes(m.match.id)&&m.matchday===d.number&&(category==='all'||m.match.category_id===category)).sort((a,b)=>(a.match.scheduled_date??'9999').localeCompare(b.match.scheduled_date??'9999')||(a.match.scheduled_time??'99').localeCompare(b.match.scheduled_time??'99'))
      return <section key={d.id} className="calendar-day"><div className="day-heading"><h2>Fecha {d.number}</h2><span>{d.number<=4?'Regular':d.number===5?'Semifinales':'Final / Tercer puesto'}</span></div>
        {d.date&&<p className="schedule-line">Referencia de jornada: {d.date.split('-').reverse().join('/')}</p>}
        {!matches.length&&<p className="empty-state">Sin partidos finalizados.</p>}
        <div className="calendar-grid">{matches.map(m=><div key={m.match.id} className="calendar-entry"><PublicMatchCard item={m} statistics refresh={admin?refresh:undefined}/>{admin&&<div className="calendar-actions"><ScheduleEditor key={m.match.updated_at} item={m} refresh={refresh}/><DeleteMatchButton item={m} onDeleted={id=>{setDeleted(current=>[...current,id]);void refresh()}}/></div>}</div>)}</div>
      </section>
    })}
  </div>
}
