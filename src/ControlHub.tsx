import { Link } from 'react-router-dom'
import { useTournament } from './lib/useTournament'
import { isActive } from './lib/tournament'
import PlayoffsAdmin from './PlayoffsAdmin'
export default function ControlHub(){
  const {data,error,loading}=useTournament()
  const active=data?.matches.find(isActive)
  return <div className="space-y-5"><p className="eyebrow">CENTRO DE JUEGO</p><h1>Controlar</h1>
    {loading&&<p role="status">Cargando partido…</p>}{error&&<p role="alert">{error}</p>}
    <section className="surface"><h2>{active?'Partido en curso':'Listos para el próximo encuentro'}</h2>
      {active?<><p>{active.home} vs {active.away}</p><Link className="primary-link" to={`/admin/partidos/${active.match.id}`}>Abrir control del partido</Link></>:<p>Selecciona un encuentro desde Calendario para abrir sus controles.</p>}
    </section><PlayoffsAdmin/>
  </div>
}
