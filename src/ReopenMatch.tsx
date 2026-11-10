import { useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import EventDialog from './EventDialog'

export default function ReopenMatch({matchId,version,home,away,score,onChange}:{matchId:string;version:string;home:string;away:string;score:{home:number;away:number};onChange:(data:unknown)=>void}) {
  const [open,setOpen]=useState(false)
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const lock=useRef(false)
  async function reopen() {
    if(lock.current) return
    lock.current=true;setBusy(true);setError('')
    // An isolated, in-memory session authorizes only reopening. The existing
    // anonymous client and its public control permissions are unaffected.
    const client=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_ANON_KEY,{auth:{storageKey:`reopen-${crypto.randomUUID()}`,persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
    try {
      const login=await client.auth.signInWithPassword({email,password})
      if(login.error) throw Error('No se pudo iniciar sesión. Comprueba tus credenciales.')
      const result=await client.rpc('reopen_match',{p_match_id:matchId,p_expected_updated_at:version})
      if(result.error) throw result.error
      if(!result.data) throw Error('Actualiza el partido para comprobar si se reabrió.')
      onChange(result.data);setOpen(false);setPassword('')
    } catch(err) {setError((err as Error).message)}
    finally {await client.auth.signOut({scope:'local'});lock.current=false;setBusy(false)}
  }
  return <><button type="button" onClick={()=>{setError('');setOpen(true)}}>REABRIR PARTIDO</button>
    {open&&<EventDialog title="REABRIR PARTIDO" busy={busy} onClose={()=>{setOpen(false);setPassword('')}}>
      <p>{home} {score.home} - {score.away} {away}</p><p>Estado: FINALIZADO. Se recuperará el reloj en pausa, conservando los eventos.</p>
      <p>Requiere una cuenta administradora autorizada.</p>
      <form onSubmit={e=>{e.preventDefault();void reopen()}}>
        <label>Correo<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
        {error&&<p role="alert">{error}</p>}
        <button disabled={busy}>CONFIRMAR REAPERTURA</button>
      </form>
    </EventDialog>}
  </>
}
