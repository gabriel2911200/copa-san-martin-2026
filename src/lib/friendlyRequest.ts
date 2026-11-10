export type FriendlyArgs={p_category_id:string;p_home:string;p_away:string;p_date:string|null;p_time:string|null;p_seconds:number;p_penalties:boolean}
export type PendingFriendly={id:string;args:FriendlyArgs}
export const friendlyStorageKey='pending-friendly'

export function loadFriendlyRequest(storage:Pick<Storage,'getItem'>):PendingFriendly|null {
  const raw=storage.getItem(friendlyStorageKey)
  if(!raw)return null
  const value=JSON.parse(raw) as PendingFriendly|null
  const args=value?.args
  if(!value||typeof value.id!=='string'||!value.id||!args||
    ![args.p_category_id,args.p_home,args.p_away].every(id=>typeof id==='string'&&!!id)||args.p_home===args.p_away||
    !Number.isInteger(args.p_seconds)||args.p_seconds<60||args.p_seconds>10800||args.p_seconds%60!==0||typeof args.p_penalties!=='boolean'||
    !(args.p_date===null||typeof args.p_date==='string')||!(args.p_time===null||typeof args.p_time==='string')||(!args.p_date&&args.p_time))throw Error('Solicitud de amistoso inválida')
  return value
}
