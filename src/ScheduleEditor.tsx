import { useRef, useState } from 'react'
import type { PublicMatch } from './lib/tournament'
import { supabase } from './lib/supabase'

export default function ScheduleEditor({ item, refresh }: { item: PublicMatch; refresh: () => Promise<void> }) {
  const [date,setDate]=useState(item.match.scheduled_date ?? '')
  const [time,setTime]=useState(item.match.scheduled_time?.slice(0,5) ?? '')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const lock=useRef(false)
  return <details className="match-details"><summary>Editar fecha y hora</summary><form onSubmit={async e=>{
    e.preventDefault(); if(lock.current) return; lock.current=true; setBusy(true); setMessage('')
    try {
      if(!supabase) throw Error('Sin conexión')
      const result=await supabase.rpc('reschedule_match',{p_match_id:item.match.id,p_date:date||null,p_time:time||null,p_expected_updated_at:item.match.updated_at})
      if(result.error) throw result.error
      setMessage('Agenda guardada.'); await refresh()
    } catch(err) { setMessage((err as {code?:string}).code==='P0001'?(err as {message:string}).message:'No se pudo confirmar. Actualiza el calendario antes de reintentar.') }
    finally {lock.current=false;setBusy(false)}
  }}><p>Jornada {item.matchday} · La reprogramación conserva el partido y su resultado.</p><div className="form-grid">
    <label>Fecha del partido<input type="date" value={date} disabled={busy} onChange={e=>{setDate(e.target.value);if(!e.target.value)setTime('')}}/></label>
    <label>Hora (Tarija)<input type="time" value={time} disabled={busy||!date} onChange={e=>setTime(e.target.value)}/></label>
  </div><button disabled={busy}>{busy?'Guardando…':'Guardar agenda'}</button><p role="status">{message}</p></form></details>
}
