import { useCallback, useEffect, useRef, useState } from 'react'
import EventDialog from './EventDialog'
import { supabase } from './lib/supabase'

export default function DurationSelector({ value, disabled, onChange }: {value:number; disabled?:boolean; onChange:(seconds:number)=>void}) {
  const [options,setOptions]=useState<{seconds:number;built_in:boolean}[]>([{seconds:900,built_in:true},{seconds:1200,built_in:true}])
  const [mode,setMode]=useState<'add'|'remove'|'custom'|null>(null)
  const [menu,setMenu]=useState(false)
  const [minutes,setMinutes]=useState('')
  const [remove,setRemove]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const lock=useRef(false)
  const loaded=useRef(false)
  const mounted=useRef(false)
  const sequence=useRef(0)
  const invalidate=useCallback(()=>{sequence.current++},[])
  const load=useCallback(async () => {
    const current=++sequence.current
    const result=await supabase?.from('duration_options').select('*').order('seconds')
    if(!mounted.current||current!==sequence.current)return false
    if(result?.error||!Array.isArray(result?.data)) {setError('No se pudo cargar el catálogo de tiempos. Puedes actualizarlo y reintentar.');return false}
    setOptions(result.data);loaded.current=true;setError('');return true
  },[])
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;invalidate()}},[invalidate])
  useEffect(()=>{
    if(disabled)return
    const timer=!loaded.current?setTimeout(()=>void load(),0):undefined
    const onReturn=()=>{if(!document.hidden&&!lock.current)void load()}
    window.addEventListener('focus',onReturn)
    window.addEventListener('online',onReturn)
    document.addEventListener('visibilitychange',onReturn)
    return()=>{clearTimeout(timer);window.removeEventListener('focus',onReturn);window.removeEventListener('online',onReturn);document.removeEventListener('visibilitychange',onReturn)}
  },[disabled,load])
  async function save() {
    if(lock.current || disabled) return
    const seconds=mode==='remove'?Number(remove):Number(minutes)*60
    if(!Number.isInteger(seconds/60)||seconds<60||seconds>10800){setError('Indica minutos enteros entre 1 y 180.');return}
    lock.current=true;invalidate();setBusy(true);setError('')
    try {
      if(mode!=='custom') {
        if(!supabase) throw Error('Sin conexión')
        const result=await supabase.rpc('manage_duration',{p_seconds:seconds,p_remove:mode==='remove'})
        if(result.error) throw result.error
        if(!await load()) return
      }
      if(mode!=='remove') onChange(seconds)
      setMode(null)
    } catch(err) {setError((err as Error).message || 'No se pudo guardar el tiempo.')}
    finally {lock.current=false;setBusy(false)}
  }
  return <fieldset className="duration-selector" disabled={disabled || busy}>
    <legend className="sr-only">Duración por tiempo</legend>
    <div className="duration-inline">
    <select aria-label="Duración por tiempo" value={value} onChange={e=>onChange(Number(e.target.value))}>
      {!options.some(o=>o.seconds===value)&&<option value={value}>{value/60} min · exclusivo del partido</option>}
      {options.map(o=><option key={o.seconds} value={o.seconds}>{o.seconds/60} minutos</option>)}
    </select>
    <button type="button" aria-label="Administrar tiempos" aria-expanded={menu} onClick={()=>setMenu(!menu)}>⋮</button>
    </div>
    {menu&&<div className="duration-menu">{([['add','AGREGAR TIEMPO'],['remove','ELIMINAR TIEMPO'],['custom','TIEMPO PERSONALIZADO']] as const).map(([key,label])=><button type="button" key={key} onClick={()=>{setMode(key);setMenu(false);setError('');setMinutes('');setRemove('')}}>{label}</button>)}</div>}
    {error&&!mode&&<p role="alert">{error}</p>}
    {error&&!mode&&<button type="button" onClick={()=>void load()}>Actualizar catálogo</button>}
    {mode&&<EventDialog title={mode==='add'?'AGREGAR TIEMPO':mode==='remove'?'ELIMINAR TIEMPO':'TIEMPO PERSONALIZADO'} busy={busy} onClose={()=>setMode(null)}>
      <form onSubmit={e=>{e.preventDefault();void save()}}>
      <fieldset disabled={busy||disabled}>
      {mode==='remove'?<><label>Duración a eliminar<select value={remove} onChange={e=>setRemove(e.target.value)}><option value="">Seleccionar</option>{options.filter(o=>!o.built_in).map(o=><option key={o.seconds} value={o.seconds}>{o.seconds/60} minutos</option>)}</select></label><p>Confirmar elimina la opción del catálogo. Los encuentros conservan su duración.</p></>:<label>Minutos por tiempo<input type="number" min="1" max="180" step="1" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label>}
      {mode==='custom'&&<p>Se aplicará únicamente a este encuentro.</p>}
      {error&&<p role="alert">{error}</p>}
      <button type="submit" disabled={busy||disabled}>{mode==='remove'?'CONFIRMAR ELIMINACIÓN':'GUARDAR'}</button>
      </fieldset>
      </form>
    </EventDialog>}
  </fieldset>
}
