import { test, expect } from '@playwright/test'
import type { ClockState } from '../../src/lib/matchClock'

const base = '2026-09-08T12:00:00Z'
function fixture(phase: 'PRIMER_TIEMPO' | 'SEGUNDO_TIEMPO') {
  const match: ClockState & { id: string; category_id: string; home_team_id: string; away_team_id: string; stage: string; updated_at: string } = {
    id: 'm', category_id: 'c', home_team_id: 'a', away_team_id: 'b', stage: 'REGULAR', updated_at: base,
    status: phase, paused_from_status: null, phase_elapsed_seconds: 515, phase_started_at: base,
    timeout_started_at: null, timeout_team_id: null,
  }
  const players = [{ id: 'p', team_id: 'a', full_name: 'Carlos', active: true }, { id: 'q', team_id: 'b', full_name: 'Pedro', active: true }]
  return { match, server_now: base, home: 'San Martín', away: 'San Judas', category: 'Varones', matchday: 1,
    score: { home: 2, away: 1 }, goals: [], events: [] as { id: string; type: string; team_id: string; period_number: number }[],
    players, lineup: players.map((p, i) => ({ ...p, shirt_number: i + 5 })) }
}

for (const phase of ['PRIMER_TIEMPO','SEGUNDO_TIEMPO'] as const) {
  for (const mode of ['manual','automatic'] as const) {
    test(`${phase}: pausa real y final ${mode}`, async ({ page }) => {
      const data = fixture(phase)
      const side = phase === 'PRIMER_TIEMPO' ? 'local' : 'visitante'
      const team = side === 'local' ? 'a' : 'b'
      let automaticCalls = 0
      await page.clock.install({ time: new Date(base) })
      await page.route('**/rest/v1/**', async route => {
        const url = route.request().url()
        const time = await page.evaluate(() => new Date().toISOString())
        data.server_now = time
        if (url.endsWith('/record_match_event')) {
          expect(route.request().postDataJSON()).toMatchObject({ p_type: 'TIMEOUT', p_team_id: team, p_player_id: null })
          data.match.status = 'TIEMPO_MUERTO'; data.match.paused_from_status = phase
          data.match.phase_started_at = null; data.match.timeout_started_at = time; data.match.timeout_team_id = team
          const event = { id: 't', type: 'TIMEOUT', team_id: team, period_number: phase === 'PRIMER_TIEMPO' ? 1 : 2 }
          data.events.push(event)
          return route.fulfill({ json: { event, control: data } })
        }
        if (url.endsWith('/finish_match_timeout') || url.endsWith('/control_match')) {
          if (url.endsWith('/finish_match_timeout')) {
            automaticCalls++
            expect(route.request().postDataJSON()).toEqual({ p_match_id: 'm', p_timeout_started_at: data.match.timeout_started_at, p_automatic: true })
            data.match.phase_started_at = new Date(Date.parse(data.match.timeout_started_at!) + 60000).toISOString()
          } else {
            expect(route.request().postDataJSON().p_action).toBe('END_TIMEOUT')
            data.match.phase_started_at = time
          }
          data.match.status = phase; data.match.paused_from_status = null; data.match.timeout_started_at = null; data.match.timeout_team_id = null
        } else expect(url).toContain('/get_match_control')
        return route.fulfill({ json: data })
      })
      await page.goto('/admin/partidos/m')
      await expect(page.getByRole('button', { name: `MINUTO ${side.toUpperCase()}`, exact: true })).toBeEnabled()
      // Congela después de cargar: el cronómetro puede refrescar hasta un segundo
      // después del vencimiento, pero el servidor siempre conserva el instante exacto.
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000))
      await page.getByRole('button', { name: `MINUTO ${side.toUpperCase()}`, exact: true }).click()
      const timeoutStart = data.match.timeout_started_at!
      await expect(page.getByText('⏸️ MINUTO', { exact: true })).toBeVisible()
      await expect(page.getByRole('timer', { name: 'Tiempo de la fase' })).toHaveText('08:35')
      await expect(page.getByRole('timer', { name: 'Contador de minuto' })).toHaveText('01:00')
      await page.clock.runFor(25000)
      await expect(page.getByRole('timer', { name: 'Tiempo de la fase' })).toHaveText('08:35')
      await expect(page.getByRole('timer', { name: 'Contador de minuto' })).toHaveText(/^00:3[56]$/)
      await expect(page.getByRole('button', { name: 'GOL San Martín' })).toBeDisabled()
      if (mode === 'manual') await page.getByRole('button', { name: 'FINALIZAR MINUTO', exact: true }).click()
      else {
        await page.clock.runFor(36000)
        await expect(page.getByRole('timer', { name: 'Contador de minuto' })).toHaveCount(0)
        await page.clock.runFor(100)
      }
      await expect(page.getByRole('timer', { name: 'Contador de minuto' })).toHaveCount(0)
      await expect(page.getByRole('timer', { name: 'Tiempo de la fase' })).toHaveText(mode === 'manual' ? '08:35' : /^08:3[56]$/)
      await expect(page.getByRole('button', { name: 'GOL San Martín' })).toBeEnabled()
      expect(data.match.phase_elapsed_seconds).toBe(515)
      if(mode === 'automatic') expect(Date.parse(data.match.phase_started_at!) - Date.parse(timeoutStart)).toBe(60000)
      const resumed = await page.getByRole('timer', { name: 'Tiempo de la fase' }).textContent()
      await page.clock.runFor(2000)
      await expect(page.getByRole('timer', { name: 'Tiempo de la fase' })).not.toHaveText(resumed!)
      await expect(page.getByLabel('Marcador')).toHaveText('2 - 1')
      expect(automaticCalls).toBe(mode === 'automatic' ? 1 : 0)
      expect(data.events).toHaveLength(1)
    })
  }
}

test('público: reloj congelado, equipo solicitante y continuación al vencer sin escrituras', async ({ page }) => {
  const data = fixture('SEGUNDO_TIEMPO')
  Object.assign(data.match, { status: 'TIEMPO_MUERTO', paused_from_status: 'SEGUNDO_TIEMPO', phase_started_at: null, timeout_started_at: base, timeout_team_id: 'a' })
  await page.clock.install({ time: new Date(base) })
  await page.route('**/rest/v1/**', route => {
    expect(route.request().url()).toContain('/get_tournament')
    return route.fulfill({ json: { categories: [], matchdays: [{ id: 'd', number: 1 }], matches: [data] } })
  })
  await page.goto('/')
  await expect(page.getByText('⏸️ MINUTO', { exact: true })).toBeVisible()
  const notice=page.getByRole('region',{name:'Minuto en curso'})
  await expect(notice).toHaveCSS('text-align','center')
  await expect(notice).toHaveCSS('border-top-width','0px')
  await expect(notice.locator('.public-timeout-title')).toHaveCSS('font-size','28px')
  const score=await page.locator('.score-line').boundingBox()
  const noticeBox=await notice.boundingBox()
  expect(noticeBox!.y).toBeGreaterThan(score!.y+score!.height)
  await expect(page.getByText('Tiempo del partido: 2T 08:35 · Detenido')).toBeVisible()
  await expect(page.getByRole('button', { name: 'FINALIZAR MINUTO' })).toHaveCount(0)
  await page.clock.runFor(25000)
  await expect(page.getByRole('timer', { name: 'Cronómetro', exact: true })).toHaveText('08:35')
  await expect(page.getByRole('timer', { name: 'Contador de minuto' })).toHaveText('00:35')
  await page.clock.runFor(36000)
  await expect(page.getByText('⏸️ MINUTO', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('timer', { name: 'Cronómetro', exact: true })).toHaveText('08:36')
})
