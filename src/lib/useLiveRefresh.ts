import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
export type LiveChange = RealtimePostgresChangesPayload<Record<string, unknown>>

export function useLiveRefresh(refresh: () => void, onChange?: (change: LiveChange) => void) {
  const handlers = useRef({ refresh, onChange })
  useEffect(() => { handlers.current = { refresh, onChange } }, [refresh, onChange])
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let disposed = false
    let online = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { if (!disposed) handlers.current.refresh() }, 120)
    }
    const channel = client.channel(`tournament:${crypto.randomUUID()}`)
    for (const table of ['matches','match_events','categories','teams','matchdays']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
        if (disposed) return
        handlers.current.onChange?.(payload)
        schedule()
      })
    }
    channel.subscribe(status => {
      if (disposed) return
      online = status === 'SUBSCRIBED'
      setConnected(online)
      if (online) schedule() // recupera eventos perdidos al reconectar
    })
    // 60 s como red de seguridad; sin Realtime, 30 s. No escribe datos.
    let ticks = 0
    const fallback = setInterval(() => { ticks++; if (!document.hidden && (!online || ticks % 2 === 0)) schedule() }, 30000)
    const onReturn = () => { if (!document.hidden) schedule() }
    window.addEventListener('online', onReturn)
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      disposed = true; clearTimeout(timer); clearInterval(fallback)
      window.removeEventListener('online', onReturn)
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
      void client.removeChannel(channel)
    }
  }, [])
  return connected
}
