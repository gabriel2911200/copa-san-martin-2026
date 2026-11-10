import { useRef, useState } from 'react'
import type { PublicMatch } from './lib/tournament'
import { supabase } from './lib/supabase'

type Agenda = {date:string;time:string;version:string}
function newerVersion(incoming:string,saved:string) {
  const difference=Date.parse(incoming)-Date.parse(saved)
  // PostgreSQL updated_at retains microseconds; Date.parse only retains millis.
  const remainder=(value:string)=>Number((value.match(/\.(\d+)/)?.[1]??'').padEnd(6,'0').slice(3,6))
  return difference>0||(difference===0&&remainder(incoming)>remainder(saved))
}

export default function ScheduleEditor({ item, refresh, label = 'Editar fecha y hora' }: { item: PublicMatch; refresh: () => Promise<void>; label?: string }) {
  const [draft,setDraft]=useState<Agenda|null>(null)
  const [confirmed,setConfirmed]=useState<Agenda|null>(null)
  const received={date:item.match.scheduled_date??'',time:item.match.scheduled_time?.slice(0,5)??'',version:item.match.updated_at}
  const latest=confirmed&&!newerVersion(received.version,confirmed.version)?confirmed:received
  const current=draft??latest
  const {date,time}=current
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const lock=useRef(false)
  return <details className="match-details"><summary>{label}</summary><form onSubmit={async e=>{
    e.preventDefault(); if(lock.current) return; lock.current=true; setBusy(true); setMessage('')
    try {
      if(!supabase) throw Error('Sin conexión')
      const result=await supabase.rpc('reschedule_match',{p_match_id:item.match.id,p_date:date||null,p_time:time||null,p_expected_updated_at:current.version})
      if(result.error) throw result.error
      const saved=result.data?.match
      if(saved?.id!==item.match.id||typeof saved.updated_at!=='string')throw Error('Respuesta incompleta')
      setConfirmed({date:saved.scheduled_date??'',time:saved.scheduled_time?.slice(0,5)??'',version:saved.updated_at})
      setDraft(null);setMessage('Agenda guardada.')
      try {await refresh()}catch{setMessage('Agenda guardada. No se pudo actualizar el calendario; los datos confirmados se conservan.')}
    } catch(err) { setMessage((err as {code?:string}).code==='P0001'?(err as {message:string}).message:'No se pudo confirmar. Actualiza el calendario antes de reintentar.') }
    finally {lock.current=false;setBusy(false)}
  }}><p>Jornada {item.matchday} · La reprogramación conserva el partido y su resultado.</p><div className="form-grid">
    <label>Fecha del partido<input type="date" value={date} disabled={busy} onChange={e=>setDraft({...current,date:e.target.value,time:e.target.value?time:''})}/></label>
    <label>Hora (Tarija)<input type="time" value={time} disabled={busy||!date} onChange={e=>setDraft({...current,time:e.target.value})}/></label>
  </div><button disabled={busy}>{busy?'Guardando…':'Guardar agenda'}</button>{draft&&<button type="button" disabled={busy} onClick={()=>{setDraft(null);setMessage('')}}>Descartar cambios</button>}<p role="status">{message}</p></form></details>
}
