import { currentPeriod, teamPeriodStats } from './lib/matchEvents'
import type { MatchEvent, FoulCount } from './lib/matchEvents'
import type { ClockState } from './lib/matchClock'

export default function MatchStats({ match, events = [], fouls: counters, home, away }: {
  match: ClockState & { home_team_id: string; away_team_id: string }
  events?: MatchEvent[]; fouls?: FoulCount[]; home: string; away: string
}) {
  return <div className="compact-fouls" aria-label="Faltas acumuladas">
    {[[match.home_team_id, home], [match.away_team_id, away]].map(([id, name]) => {
      const period = currentPeriod(match)
      const fouls = counters ? counters.find(c => c.team_id === id && c.period_number === period)?.count ?? 0 : teamPeriodStats(events, id, period).fouls
      return <p key={id} role={fouls >= 5 ? 'status' : undefined} className={fouls >= 6 ? 'fouls-red' : fouls === 5 ? 'fouls-yellow' : ''}>{name}: {fouls} faltas{fouls >= 6 && <span className="block">TIRO LIBRE SIN BARRERA</span>}</p>
    })}
  </div>
}
