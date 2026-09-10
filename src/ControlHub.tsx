import { Link } from 'react-router-dom'
import { useTournament } from './lib/useTournament'
import { useState } from 'react'
import ScheduleEditor from './ScheduleEditor'
import DeleteMatchButton from './DeleteMatchButton'
import { isActive } from './lib/tournament'
import PlayoffsAdmin from './PlayoffsAdmin'
export default function ControlHub(){
  const {data,error,loading,refresh}=useTournament()
  const [deleted,setDeleted]=useState<string[]>([])
  const matches=data?.matches.filter(m=>!deleted.includes(m.match.id)&&(isActive(m)||m.match.status==='PROGRAMADO')).sort((a,b)=>Number(isActive(b))-Number(isActive(a))||(a.match.scheduled_date??'9999').localeCompare(b.match.scheduled_date??'9999')||(a.match.scheduled_time??'99').localeCompare(b.match.scheduled_time??'99')) ?? []
  return <div className="space-y-5"><p className="eyebrow">CENTRO DE JUEGO</p><h1>Controlar</h1>
    {loading&&<p role="status">Cargando partido…</p>}{error&&<p role="alert">{error}</p>}
    {matches.map(item=><section key={item.match.id} className="surface">
      <h2>{item.home} vs {item.away}</h2>
      <p>{isActive(item)?'En vivo':'Programado'} · {item.category}</p>
      <p>{item.match.scheduled_date?.split('-').reverse().join('/') ?? 'Fecha por confirmar'} · {item.match.scheduled_time?.slice(0,5) ?? 'Hora por confirmar'}</p>
      <Link className="primary-link" to={`/admin/partidos/${item.match.id}`}>CONTROLAR PARTIDO</Link>
      <details><summary>Opciones del partido</summary>
        <ScheduleEditor key={item.match.updated_at} item={item} refresh={refresh}/>
        <DeleteMatchButton item={item} onDeleted={id=>{setDeleted(current=>[...current,id]);void refresh()}}/>
      </details>
    </section>)}
    {!loading&&!matches.length&&<p>No hay partidos programados ni en vivo.</p>}
    <PlayoffsAdmin/>
  </div>
}
