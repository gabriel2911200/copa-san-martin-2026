import { useRef, useState } from 'react'
import EventDialog from './EventDialog'
import { supabase } from './lib/supabase'

export default function ReopenMatch({matchId,version,home,away,score,onChange}:{matchId:string;version:string;home:string;away:string;score:{home:number;away:number};onChange:(data:unknown)=>void}) {
  const [open,setOpen]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const lock=useRef(false)
  async function reopen() {
    if(lock.current||!supabase)return
    lock.current=true;setBusy(true);setError('')
    try {
      const result=await supabase.rpc('reopen_match',{p_match_id:matchId,p_expected_updated_at:version})
      if(result.error)throw result.error
      if(!result.data?.match)throw Error('Actualiza el calendario para comprobar si se reabrió.')
      onChange(result.data);setOpen(false)
    }catch(err){setError((err as Error).message||'No se pudo reabrir el partido.')}
    finally{lock.current=false;setBusy(false)}
  }
  return <><button type="button" onClick={()=>{setError('');setOpen(true)}}>Reabrir partido</button>
    {open&&<EventDialog title="REABRIR PARTIDO" busy={busy} onClose={()=>setOpen(false)}>
      <p>{home} {score.home} - {score.away} {away}</p>
      <p>Se recuperará el reloj en pausa, conservando goles, tarjetas, jugadores y eventos.</p>
      {error&&<p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={()=>void reopen()}>CONFIRMAR REAPERTURA</button>
    </EventDialog>}
  </>
}
