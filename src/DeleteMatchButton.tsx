import { useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import type { PublicMatch } from './lib/tournament'

export default function DeleteMatchButton({item,onDeleted}:{item:PublicMatch;onDeleted:(id:string)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null)
  const lock=useRef(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  async function remove(){
    if(lock.current) return
    lock.current=true;setBusy(true);setError('')
    try {
      if(!supabase) throw Error('Sin conexión')
      const result=await supabase.rpc('delete_match',{p_match_id:item.match.id,p_expected_updated_at:item.match.updated_at})
      if(result.error) throw result.error
      dialog.current?.close();onDeleted(item.match.id)
    }catch(err){setError((err as {code?:string}).code==='P0001'?(err as {message:string}).message:'No se pudo confirmar el borrado. Comprueba tu conexión; reintentar no afecta a otros partidos.')}
    finally{lock.current=false;setBusy(false)}
  }
  return <><button className="delete-match-button" onClick={()=>{setError('');dialog.current?.showModal()}}>Eliminar partido</button>
    <dialog ref={dialog} className="delete-match-dialog" aria-labelledby={`delete-title-${item.match.id}`} onCancel={e=>{if(busy)e.preventDefault()}}>
      <h2 id={`delete-title-${item.match.id}`}>¿Seguro que deseas eliminar este partido?</h2>
      <p>{item.home} vs {item.away}</p><p>Se eliminarán este partido y todos sus goles y eventos. Esta acción no se puede deshacer.</p>
      {error&&<p role="alert">{error}</p>}
      <div className="flex gap-3"><button disabled={busy} onClick={()=>dialog.current?.close()}>Cancelar</button><button className="delete-match-button" disabled={busy} onClick={()=>void remove()}>{busy?'Eliminando…':'Eliminar'}</button></div>
    </dialog>
  </>
}
