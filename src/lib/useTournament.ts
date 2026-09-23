import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useLiveRefresh } from './useLiveRefresh'
import type { LiveChange } from './useLiveRefresh'
import type { Tournament } from './tournament'

export function useTournament(onChange?: (change: LiveChange) => void) {
  const [data, setData] = useState<Tournament | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const invalidate = useCallback(() => { seq.current++ }, [])
  const refresh = useCallback(async () => {
    const current = ++seq.current
    try {
      if (!supabase) throw Error('Sin conexión')
      const response = await supabase.rpc('get_tournament')
      if (response.error) throw response.error
      if (current === seq.current) {
        const tournament = response.data as Tournament
        for (const category of tournament.categories) {
          tournament.matches.filter(m => m.match.category_id === category.id && m.match.stage === 'SEMIFINAL')
            .sort((a,b) => (a.match.created_at ?? '').localeCompare(b.match.created_at ?? '') || a.match.id.localeCompare(b.match.id))
            .forEach((match,index) => { match.semifinal_number = index + 1 })
        }
        setData(tournament); setError('')
      }
    } catch { if (current === seq.current) setError('No se pudieron actualizar los datos. Se reintentará automáticamente al recuperar la conexión.') }
    finally { if (current === seq.current) setLoading(false) }
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => void refresh(),0)
    return () => { clearTimeout(timer); invalidate() }
  }, [refresh,invalidate])
  const connected = useLiveRefresh(refresh,onChange)
  return { data, error, loading, refresh, connected }
}
