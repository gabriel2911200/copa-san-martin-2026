import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { MatchEvent, Precheck } from './lib/matchEvents'

function Modal({ title, children, onDismiss }: { title: string; children: ReactNode; onDismiss?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="match-check-dialog" aria-label={title}
    onCancel={e => { e.preventDefault(); onDismiss?.() }}>
    <h2>{title}</h2>{children}
  </dialog>
}

export function PreMatchCheck({ home, away, busy, error, onSave }: {
  home: string; away: string; busy: boolean; error: string
  onSave: (values: Precheck) => void
}) {
  const [answers, setAnswers] = useState<Partial<Precheck>>({})
  const complete = ['home_ball','home_band','away_ball','away_band'].every(key => typeof answers[key as keyof Precheck] === 'boolean')
  return <Modal title="CONTROL PREVIO DEL PARTIDO">
    <form onSubmit={e => { e.preventDefault(); if (complete) onSave(answers as Precheck) }}>
      {(['home','away'] as const).map(side => <section key={side} aria-label={side === 'home' ? home : away}>
        <h3>{side === 'home' ? home : away}</h3>
        {(['ball','band'] as const).map(kind => {
          const key = `${side}_${kind}` as keyof Precheck
          return <fieldset key={key} disabled={busy}><legend>{kind === 'ball' ? '⚽ ¿Tiene balón?' : '🎽 ¿Tiene cintillo?'}</legend>
            {[true,false].map(value => <button key={String(value)} type="button" aria-pressed={answers[key] === value}
              onClick={() => setAnswers(a => ({ ...a, [key]: value }))}>{value ? 'SI' : 'NO'}</button>)}
          </fieldset>
        })}
      </section>)}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy || !complete}>Guardar control previo</button>
    </form>
  </Modal>
}

export function CollectionReminder({ status, home, away, homeId, awayId, precheck, events }: {
  status: string; home: string; away: string; homeId: string; awayId: string; precheck?: Precheck | null; events: MatchEvent[]
}) {
  const [dismissed, setDismissed] = useState('')
  const period = status === 'DESCANSO' ? 1 : status === 'FINALIZADO' ? 2 : 0
  const cards = events.filter(e => !e.voided_at && e.period_number === period && (e.type === 'YELLOW_CARD' || e.type === 'RED_CARD'))
  const missing = period === 1 && precheck && ['home_ball','home_band','away_ball','away_band'].some(key => precheck[key as keyof Precheck] === false)
  const key = `${status}:${cards.map(e => e.id).join(',')}:${period === 1 ? JSON.stringify(precheck) : ''}`
  if (!period || (!missing && !cards.length) || dismissed === key) return null
  return <Modal title={period === 1 ? 'ARBITRAJE' : 'AVISO PENDIENTE'} onDismiss={() => setDismissed(key)}>
    {(['home','away'] as const).map(side => {
      const noBall = period === 1 && precheck?.[`${side}_ball`] === false, noBand = period === 1 && precheck?.[`${side}_band`] === false
      const teamCards = cards.filter(e => e.team_id === (side === 'home' ? homeId : awayId))
      if (!noBall && !noBand && !teamCards.length) return null
      return <section key={side}><h3>{side === 'home' ? home : away}</h3>
        {noBall && <p>⚽ Sin balón</p>}{noBand && <p>🎽 Sin cintillo</p>}
        {teamCards.map(e => <p key={e.id}>{e.type === 'RED_CARD' ? '🟥 Tarjeta roja' : '🟨 Tarjeta amarilla'} {e.shirt_number != null && `#${e.shirt_number} `}{e.player_name ?? 'Jugador no registrado'}</p>)}
      </section>
    })}
    <button onClick={() => setDismissed(key)}>Entendido</button>
  </Modal>
}
