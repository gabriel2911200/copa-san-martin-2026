import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './lib/supabase'
import { useLiveRefresh } from './lib/useLiveRefresh'

type Category = { id: string; name: string }
type Team = { id: string; category_id: string; name: string; active: boolean }
const fields = 'id, category_id, name, active'
const control = 'min-h-12 rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-50'

function errorMessage(error: unknown) {
  const code = (error as { code?: string })?.code
  if (code === '23505') return 'Ya existe un equipo con ese nombre en esta categoría.'
  if (code === '42501') return 'No hay permisos para guardar equipos. Intenta de nuevo más tarde.'
  return 'No se pudo completar la operación. Comprueba tu conexión y vuelve a intentarlo.'
}

export default function EquiposPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [teams, setTeams] = useState<Team[]>([])
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [retry, setRetry] = useState(0)
  useLiveRefresh(() => { if (!busy) setRetry(value => value + 1) })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingCategories(true)
      setError('')
      try {
        if (!supabase) throw new Error('Sin configuración')
        const result = await supabase.from('categories').select('id, name').in('name', ['Varones', 'Mujeres'])
        if (result.error) throw result.error
        if (!result.data.length) throw new Error('Sin categorías')
        if (!cancelled) {
          const rows = result.data.sort((a, b) => (a.name === 'Varones' ? -1 : b.name === 'Varones' ? 1 : 0))
          setCategories(rows)
          setCategoryId(current => current || rows[0].id)
        }
      } catch (err) { if (!cancelled) setError(errorMessage(err)) }
      finally { if (!cancelled) setLoadingCategories(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [retry])

  useEffect(() => {
    if (!categoryId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setTeams([])
      setError('')
      try {
        if (!supabase) throw new Error('Sin configuración')
        const result = await supabase.from('teams').select(fields).eq('category_id', categoryId).is('deleted_at', null).order('name')
        if (result.error) throw result.error
        if (!cancelled) setTeams(result.data)
      } catch (err) { if (!cancelled) setError(errorMessage(err)) }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [categoryId, retry])

  async function save(action: 'create' | 'rename', team?: Team) {
    if (busy || loading || loadingCategories || !categoryId) return
    const trimmed = (action === 'rename' ? editName : name).trim()
    setError(''); setSuccess('')
    if (!trimmed) { setError('Escribe un nombre de equipo.'); return }
    if (teams.some(t => t.name === trimmed && t.id !== team?.id)) {
      setError('Ya existe un equipo con ese nombre en esta categoría.'); return
    }
    setBusy(true)
    try {
      if (!supabase) throw new Error('Sin configuración')
      const result = action === 'create'
        ? await supabase.from('teams').insert({ category_id: categoryId, name: trimmed, active: true }).select(fields).single()
        : await supabase.from('teams').update({ name: trimmed })
            .eq('id', team!.id).eq('category_id', categoryId).select(fields).single()
      if (result.error) throw result.error
      const saved = result.data as Team
      setTeams(current => [...current.filter(t => t.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'es')))
      if (action === 'create') setName('')
      if (action === 'rename') setEditing(null)
      setSuccess(action === 'create' ? 'Equipo creado.' : 'Nombre actualizado.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }

  async function remove(team:Team) {
    if(busy || !window.confirm(`¿Seguro que deseas eliminar este equipo: ${team.name}? Se retirará de la lista y de nuevas programaciones. Su historial y resultados se conservarán.`)) return
    setBusy(true);setError('');setSuccess('')
    try {
      if(!supabase) throw Error('Sin conexión')
      const result=await supabase.rpc('archive_team',{p_team_id:team.id})
      if(result.error) throw result.error
      setTeams(current=>current.filter(t=>t.id!==team.id));setSuccess('Equipo retirado. Historial conservado.')
    } catch(err){setError(errorMessage(err))} finally {setBusy(false)}
  }
  function submit(event: FormEvent) { event.preventDefault(); void save('create') }
  const disabled = busy || loading || loadingCategories || !categoryId
  return (
    <div className="space-y-6">
      <h1>Equipos</h1>
      <div>
        <label htmlFor="category" className="mb-2 block font-medium">Categoría</label>
        <select id="category" className={`${control} w-full bg-white`} value={categoryId} disabled={busy || loadingCategories} onChange={event => {
          setCategoryId(event.target.value); setEditing(null); setName(''); setSuccess(''); setError('')
        }}>
          {!categories.length && <option value="">Cargando categorías…</option>}
          {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </div>
      {error && <div role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</div>}
      <p role="status" className="text-green-800">{success}</p>
      <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <label htmlFor="team-name" className="block font-medium">Nuevo equipo</label>
        <input id="team-name" value={name} onChange={event => setName(event.target.value)} disabled={disabled} className={`${control} w-full`} placeholder="Nombre del equipo" required />
        <button disabled={disabled} className={`${control} w-full bg-blue-700 font-medium text-white`}>Agregar equipo</button>
      </form>
      {(loading || loadingCategories || busy) && <p role="status">{busy ? 'Guardando…' : 'Cargando…'}</p>}
      {!loading && !loadingCategories && !error && !teams.length && <p>No hay equipos en esta categoría.</p>}
      <ul className="space-y-3" aria-label="Equipos de la categoría" aria-busy={loading || busy}>
        {teams.map(team => <li key={team.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          {editing === team.id ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save('rename', team) }}>
            <label htmlFor={`edit-${team.id}`} className="block font-medium">Editar nombre</label>
            <input autoFocus id={`edit-${team.id}`} className={`${control} w-full`} value={editName} onChange={event => setEditName(event.target.value)} disabled={busy} required />
            <div className="flex flex-wrap gap-2"><button className={`${control} bg-blue-700 text-white`} disabled={busy}>Guardar</button><button type="button" className={control} disabled={busy} onClick={() => setEditing(null)}>Cancelar</button></div>
          </form> : <>
            <p className="break-words font-semibold">{team.name}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={control} disabled={disabled} aria-label={`Editar ${team.name}`} onClick={() => { setEditing(team.id); setEditName(team.name); setSuccess('') }}>Editar</button>
              <button type="button" className={control} disabled={disabled} aria-label={`Eliminar ${team.name}`} onClick={()=>void remove(team)}>Eliminar</button>
            </div>
          </>}
        </li>)}
      </ul>
    </div>
  )
}
