import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import MatchControlPage from './MatchControlPage'
import { AdminPage, EquiposPage, InicioPage, PartidosPage, TablasPage } from './pages'
import ControlHub from './ControlHub'

function Icon({ name }: { name: string }) {
  const paths: Record<string,string> = { home:'M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10', table:'M5 20v-7h3v7M10 20V4h4v16M16 20V9h3v11', calendar:'M4 5h16v16H4zM8 2v6M16 2v6M4 11h16', teams:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21v-3c0-6 14-6 14 0v3M17 4c5 0 5 7 0 7M19 14c3 1 3 4 3 7', plus:'M12 4v16M4 12h16', control:'M4 6h16M4 18h16M8 3v6M16 15v6M4 12h16M13 9v6' }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>
}
function Layout({ admin=false }: {admin?:boolean}) {
  const {pathname}=useLocation()
  const links=admin ? [ ['equipos','Equipos','teams'], ['crear','Crear','plus'], ['calendario','Calendario','calendar'], ['controlar','Controlar','control'] ] : [['','Inicio','home'],['tablas','Tabla','table'],['calendario','Calendario','calendar']]
  return <><header className="brand-header"><img src="/brand/parroquia.png" alt="Parroquia San Martín de Porres – Tarija"/><div><strong>COPA MARTÍN <span>2026</span></strong><small>{admin?'CENTRO DE ADMINISTRACIÓN':'FUTSAL · COMUNIDAD · PASIÓN'}</small></div></header>
    <main className="app-main"><Outlet/></main>
    <nav className="bottom-nav" aria-label={admin?'Navegación administrativa':'Navegación pública'}>{links.map(([path,label,icon])=><NavLink key={path} to={admin?`/admin/${path}`:`/${path}`} end className={({isActive})=>isActive||(admin&&path==='controlar'&&pathname.startsWith('/admin/partidos/'))?'active':''}><Icon name={icon}/><span>{label}</span></NavLink>)}</nav></>
}
export default function App(){return <BrowserRouter><Routes>
  <Route element={<Layout/>}><Route index element={<InicioPage/>}/><Route path="tablas" element={<TablasPage/>}/><Route path="calendario" element={<PartidosPage/>}/><Route path="partidos" element={<Navigate to="/calendario" replace/>}/></Route>
  <Route path="admin" element={<Layout admin/>}><Route index element={<Navigate to="controlar" replace/>}/><Route path="crear" element={<AdminPage/>}/><Route path="equipos" element={<EquiposPage/>}/><Route path="calendario" element={<PartidosPage admin/>}/><Route path="controlar" element={<ControlHub/>}/><Route path="fechas" element={<Navigate to="/admin/crear" replace/>}/><Route path="partidos/:id" element={<MatchControlPage/>}/></Route>
  <Route path="*" element={<main className="app-main"><h1>Página no encontrada</h1></main>}/>
</Routes></BrowserRouter>}
