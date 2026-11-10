import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import DurationSelector from './DurationSelector'
import { supabase } from './lib/supabase'
import { useLiveRefresh } from './lib/useLiveRefresh'
import type { PublicMatch } from './lib/tournament'
import { friendlyStorageKey, loadFriendlyRequest } from './lib/friendlyRequest'
import type { PendingFriendly } from './lib/friendlyRequest'
import { isConfirmedRejection } from './lib/rpcErrors'

type Team={id:string;name:string;category_id:string;active:boolean}
const control='min-h-12 w-full rounded-lg border bg-white p-3 disabled:opacity-50'
export default function FriendliesPage() {
  const [recovery]=useState(()=>{try{return {pending:loadFriendlyRequest(sessionStorage),error:''}}catch{return {pending:null,error:'No se pudo recuperar la solicitud anterior. Revisa el historial antes de crear otro amistoso.'}}})
  const [pending,setPending]=useState<PendingFriendly|null>(recovery.pending)
  const pendingRef=useRef(recovery.pending)
  const [teams,setTeams]=useState<Team[]>([])
  const [categories,setCategories]=useState<{id:string;name:string}[]>([])
  const [matches,setMatches]=useState<PublicMatch[]>([])
  const [category,setCategory]=useState(recovery.pending?.args.p_category_id??'')
  const [home,setHome]=useState(recovery.pending?.args.p_home??'')
  const [away,setAway]=useState(recovery.pending?.args.p_away??'')
  const [date,setDate]=useState(recovery.pending?.args.p_date??'')
  const [time,setTime]=useState(recovery.pending?.args.p_time??'')
  const [seconds,setSeconds]=useState(recovery.pending?.args.p_seconds??900)
  const [penalties,setPenalties]=useState(recovery.pending?.args.p_penalties??false)
  const [busy,setBusy]=useState(false)
  const [ready,setReady]=useState(false)
  const [error,setError]=useState(recovery.error)
  const [loadError,setLoadError]=useState('')
  const [success,setSuccess]=useState('')
  const lock=useRef(false)
  const sequence=useRef(0)
  const invalidate=useCallback(()=>{sequence.current++},[])
  const mounted=useRef(false)
  const clearPending=useCallback(()=>{
    try {sessionStorage.removeItem(friendlyStorageKey)}catch{/* A replay still uses the same idempotent ID. */}
    pendingRef.current=null;setPending(null)
  },[])
  const refresh=useCallback(async()=>{
    if(lock.current)return
    const current=++sequence.current
    try {
      if(!supabase)throw Error('Sin conexión configurada')
      const [t,c,m]=await Promise.all([supabase.from('teams').select('id,name,category_id,active').order('name'),supabase.from('categories').select('id,name').order('name'),supabase.rpc('get_friendlies')])
      if(t.error||c.error||m.error||!Array.isArray(t.data)||!Array.isArray(c.data)||!Array.isArray(m.data))throw Error('Respuesta incompleta')
      if(!mounted.current||current!==sequence.current||lock.current)return
      setTeams(t.data);setCategories(c.data);setMatches(m.data);setReady(true);setLoadError('')
      if(pendingRef.current&&m.data.some((item:PublicMatch)=>item.match.id===pendingRef.current?.id)){
        clearPending();setHome('');setAway('');setError('');setSuccess('Amistoso confirmado en el historial. No se creó otro encuentro.')
      }
    }catch{if(mounted.current&&current===sequence.current)setLoadError('No se pudieron cargar los amistosos. Comprueba la conexión y vuelve a actualizar.')}
  },[clearPending])
  useEffect(()=>{mounted.current=true;const timer=setTimeout(()=>void refresh(),0);return ()=>{mounted.current=false;invalidate();clearTimeout(timer)}},[refresh,invalidate])
  useLiveRefresh(refresh)
  const eligible=teams.filter(t=>t.active&&t.category_id===category)
  function randomize() {
    if(eligible.length<2) return
    const first=crypto.getRandomValues(new Uint32Array(1))[0]%eligible.length
    const rest=eligible.filter((_,index)=>index!==first)
    setHome(eligible[first].id);setAway(rest[crypto.getRandomValues(new Uint32Array(1))[0]%rest.length].id)
  }
  async function create() {
    if(lock.current||(!ready&&!pendingRef.current)||!supabase) return
    if(!pendingRef.current&&(!home||!away||home===away||![home,away].every(id=>eligible.some(t=>t.id===id)))){setError('Selecciona dos equipos activos diferentes de la misma categoría.');return}
    lock.current=true;sequence.current++;setBusy(true);setError('');setSuccess('')
    const operation=pendingRef.current??{id:crypto.randomUUID(),args:{p_category_id:category,p_home:home,p_away:away,p_date:date||null,p_time:time||null,p_seconds:seconds,p_penalties:penalties}}
    try {
      try {sessionStorage.setItem(friendlyStorageKey,JSON.stringify(operation))}catch{throw Error('No se pudo guardar la solicitud en este navegador. Habilita el almacenamiento antes de crear el amistoso.')}
      pendingRef.current=operation;setPending(operation)
      const result=await supabase.rpc('create_friendly',{...operation.args,p_request_id:operation.id})
      if(result.error){if(isConfirmedRejection(result.error.code))clearPending();throw result.error}
      if(result.data?.match?.id!==operation.id)throw Error('Respuesta incompleta. Actualiza el historial o reintenta la misma solicitud.')
      if(mounted.current){clearPending();setSuccess('Amistoso guardado. Ya puedes controlarlo.');setHome('');setAway('')}
    } catch(err) {if(mounted.current)setError((err as Error).message||'No se pudo confirmar la creación. Reintentar conserva la misma solicitud.')}
    finally {lock.current=false;if(mounted.current){setBusy(false);void refresh()}}
  }
  return <div className="space-y-5"><p className="eyebrow">ENCUENTROS INDEPENDIENTES</p><h1>AMISTOSOS</h1>
    <p>Los amistosos conservan su historial y no aportan puntos ni goles a la competición oficial.</p>
    {error&&<p role="alert">{error}</p>}<p role="status">{success}</p>
    {loadError&&<p role="alert">{loadError}</p>}
    {loadError&&<button type="button" disabled={busy} onClick={()=>void refresh()}>Actualizar amistosos</button>}
    {pending&&<div role="status"><p>Hay una creación pendiente de confirmar. Se conservarán sus equipos y su identificador al recargar.</p><button type="button" disabled={busy} onClick={()=>void create()}>Reintentar creación pendiente</button></div>}
    <form className="surface space-y-3" onSubmit={e=>{e.preventDefault();void create()}}>
      <fieldset disabled={!ready||busy||!!pending} className="space-y-3">
        <label>Categoría<select required className={control} value={category} onChange={e=>{setCategory(e.target.value);setHome('');setAway('')}}><option value="">Seleccionar categoría</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Local<select className={control} required value={home} onChange={e=>setHome(e.target.value)}><option value="">Seleccionar equipo</option>{eligible.map(t=><option key={t.id} value={t.id} disabled={t.id===away}>{t.name}</option>)}</select></label>
        <label>Visitante<select className={control} required value={away} onChange={e=>setAway(e.target.value)}><option value="">Seleccionar equipo</option>{eligible.map(t=><option key={t.id} value={t.id} disabled={t.id===home}>{t.name}</option>)}</select></label>
        <button className={control} type="button" disabled={eligible.length<2} onClick={randomize}>ELEGIR EQUIPOS AL AZAR</button>
        <label>Fecha<input className={control} type="date" value={date} onChange={e=>{setDate(e.target.value);if(!e.target.value)setTime('')}}/></label>
        <label>Hora<input className={control} type="time" value={time} disabled={!date} onChange={e=>setTime(e.target.value)}/></label>
        <DurationSelector value={seconds} onChange={setSeconds} disabled={!ready||busy||!!pending}/>
        <label><input type="checkbox" checked={penalties} onChange={e=>setPenalties(e.target.checked)}/> Habilitar penales en caso de empate</label>
        <button className={control}>CREAR AMISTOSO</button>
      </fieldset>
    </form>
    <h2>Historial de amistosos</h2>
    {matches.map(m=><article key={m.match.id} className="surface space-y-2"><p>{m.category} · {m.match.status.replaceAll('_',' ')}</p><h3>{m.home} {m.score.home} - {m.score.away} {m.away}</h3><p>{m.match.scheduled_date??'Fecha pendiente'} · {m.match.scheduled_time?.slice(0,5)??'Hora pendiente'}</p><Link className="primary-link" to={'/admin/partidos/'+m.match.id}>VER Y CONTROLAR AMISTOSO</Link></article>)}
    {ready&&!matches.length&&<p>Aún no hay amistosos.</p>}
  </div>
}
