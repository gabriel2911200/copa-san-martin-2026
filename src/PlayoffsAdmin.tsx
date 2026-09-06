import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useTournament } from './lib/useTournament'
import type { TournamentCategory, PublicMatch } from './lib/tournament'
import { stageLabels } from './lib/tournament'

export default function PlayoffsAdmin() {
  const {data,error,refresh}=useTournament()
  return <section id="eliminatorias" className="space-y-5 scroll-mt-4">
    <h2 className="text-2xl font-bold">Semifinales y jornada 6</h2>
    {error && <p role="alert">{error}</p>}
    {data?.categories.map(c=><CategoryPlayoffs key={c.id} category={c} matches={data.matches.filter(m=>m.match.category_id===c.id)} refresh={refresh}/>)}
  </section>
}

function CategoryPlayoffs({category,matches,refresh}:{category:TournamentCategory;matches:PublicMatch[];refresh:()=>Promise<void>}) {
  const [home,setHome]=useState('')
  const [away,setAway]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')
  const lock=useRef(false)
  const semis=matches.filter(m=>m.match.stage==='SEMIFINAL')
  const finals=matches.filter(m=>['FINAL','THIRD_PLACE'].includes(m.match.stage))
  const remaining=category.qualified.filter(t=>t.id!==home && t.id!==away)
  async function run(action:'close'|'semis'|'finals') {
    if(lock.current) return
    if(action==='close' && !window.confirm(`Cerrar la fase regular de ${category.name} fijará los cuatro clasificados y bloqueará los resultados regulares. ¿Confirmar?`)) return
    lock.current=true;setBusy(true);setError('');setSuccess('')
    try {
      if(!supabase) throw Error('Sin conexión')
      const result=action==='close' ? await supabase.rpc('close_regular',{p_category_id:category.id})
        : action==='semis' ? await supabase.rpc('create_semifinals',{p_category_id:category.id,p_home1:home,p_away1:away,p_home2:remaining[0]?.id,p_away2:remaining[1]?.id})
        : await supabase.rpc('generate_day6',{p_category_id:category.id})
      if(result.error) throw result.error
      await refresh()
      setSuccess(action==='close'?'Fase regular cerrada.':action==='semis'?'Semifinales creadas.':'Final y tercer puesto creados.')
    } catch(err) {
      const e=err as {code?:string;message?:string}
      setError(e.code==='P0001'?e.message??'Operación rechazada.':'No se pudo confirmar. Actualiza antes de reintentar; las operaciones no duplican cruces.')
    } finally {lock.current=false;setBusy(false)}
  }
  const button='min-h-12 rounded-lg border px-4 py-3 disabled:opacity-50'
  return <div className="space-y-4 rounded-xl border bg-white p-4">
    <h3 className="text-xl font-semibold">{category.name}</h3>
    {!category.regular_closed_at ? <><p>Al terminar todos los partidos regulares, cierra la fase para fijar sus cuatro clasificados.</p><button disabled={busy} className={button} onClick={()=>void run('close')}>Cerrar fase regular</button></> : <>
      <p className="font-semibold">Cuatro clasificados confirmados</p>
      <ol className="list-inside list-decimal">{category.qualified.map(t=><li key={t.id}>{t.name}</li>)}</ol>
      {!semis.length && <fieldset disabled={busy} className="space-y-3">
        <legend className="font-medium">Elegir Semifinal 1 (cruces manuales)</legend>
        <label className="block">Equipo A<select className={`${button} w-full`} value={home} onChange={e=>setHome(e.target.value)}><option value="">Seleccionar</option>{category.qualified.filter(t=>t.id!==away).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="block">Equipo B<select className={`${button} w-full`} value={away} onChange={e=>setAway(e.target.value)}><option value="">Seleccionar</option>{category.qualified.filter(t=>t.id!==home).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        {home && away && remaining.length===2 && <p>Semifinal 2: {remaining[0].name} vs {remaining[1].name}</p>}
        <button disabled={!home||!away||remaining.length!==2||busy} className={`${button} bg-blue-700 text-white`} onClick={()=>void run('semis')}>Crear las dos semifinales</button>
      </fieldset>}
      {semis.map((m,i)=><p key={m.match.id}>Semifinal {i+1}: {m.home} vs {m.away} · <Link className="inline-block py-3 text-blue-700 underline" to={`/admin/partidos/${m.match.id}`}>Controlar</Link></p>)}
      {!finals.length && <button disabled={busy||semis.length!==2||!semis.every(m=>m.resolved)} className={`${button} bg-blue-700 text-white`} onClick={()=>void run('finals')}>Generar partidos de jornada 6</button>}
      {semis.length===2 && !semis.every(m=>m.resolved) && <p>Finaliza ambas semifinales y resuelve sus empates para habilitar la jornada 6.</p>}
      {finals.map(m=><p key={m.match.id}>{stageLabels[m.match.stage]}: {m.home} vs {m.away} · <Link className="inline-block py-3 text-blue-700 underline" to={`/admin/partidos/${m.match.id}`}>Controlar</Link></p>)}
    </>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
    <p role="status" className="text-green-800">{busy?'Guardando…':success}</p>
  </div>
}
