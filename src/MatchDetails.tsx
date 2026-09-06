import type { PublicMatch } from './lib/tournament'
import { teamName } from './lib/tournament'
import { formatClock } from './lib/matchClock'

export default function MatchDetails({ item }: { item: PublicMatch }) {
  const goals = item.goals.filter(g => !g.voided_at)
  return <details className="match-details"><summary>Estadísticas del partido <span aria-hidden="true">↗</span></summary>
    <div><h3>Goles válidos</h3>{goals.length ? <ol>{goals.map(g => <li key={g.id}><span className="event-minute">{g.period_number ?? 1}T {formatClock(g.clock_seconds ?? 0)}</span> — Gol {teamName(item,g.team_id)}</li>)}</ol> : <p>No hay goles válidos registrados.</p>}</div>
  </details>
}
