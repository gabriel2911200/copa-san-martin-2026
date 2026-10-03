import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

export default function VersionRefresh() {
  const { pathname } = useLocation()
  const [available, setAvailable] = useState(false)
  const admin = useRef(pathname === '/admin' || pathname.startsWith('/admin/'))
  useEffect(() => { admin.current = pathname === '/admin' || pathname.startsWith('/admin/') }, [pathname])
  useEffect(() => {
    let checking = false
    let disposed = false
    const controller = new AbortController()
    async function check() {
      if (checking || document.hidden) return
      checking = true
      try {
        const response = await fetch(`/version.json?check=${Date.now()}`, { cache: 'no-store', signal: controller.signal })
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return
        const { version } = await response.json()
        if (disposed || typeof version !== 'string' || !version || version === import.meta.env.VITE_APP_VERSION) return
        setAvailable(true)
        // Never reload an administrative form or a match controller automatically.
        if (admin.current) return
        const key = 'app-version-reload'
        if (sessionStorage.getItem(key) === version) return
        sessionStorage.setItem(key, version)
        window.location.reload()
      } catch { /* Offline/storage failure: keep the current page working. */ }
      finally { checking = false }
    }
    const onReturn = () => { void check() }
    void check()
    const timer = setInterval(onReturn, 60000)
    window.addEventListener('pageshow', onReturn)
    window.addEventListener('focus', onReturn)
    window.addEventListener('online', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      disposed = true; controller.abort(); clearInterval(timer)
      window.removeEventListener('pageshow', onReturn)
      window.removeEventListener('focus', onReturn)
      window.removeEventListener('online', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [])
  return available ? <div className="version-notice" role="status">Hay una nueva versión disponible. <button onClick={() => window.location.reload()}>Actualizar aplicación</button></div> : null
}
