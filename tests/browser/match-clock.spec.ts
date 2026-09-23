import { test, expect } from '@playwright/test'

function fixture(status = 'PRIMER_TIEMPO', seconds = 10) {
  const time = new Date().toISOString()
  return {
    match: { id: 'clock-test', category_id: 'c', home_team_id: 'a', away_team_id: 'b', stage: 'REGULAR', status, paused_from_status: null as string | null, phase_elapsed_seconds: seconds, phase_started_at: time as string | null, updated_at: time, tiebreak_winner_team_id: null as string | null },
    category: 'Varones', matchday: 1, home: 'Equipo A', away: 'Equipo B', server_now: time,
    score: { home: 1, away: 0 }, goals: [{ id: 'g', team_id: 'a', period_number: 1, clock_seconds: 5 }],
  }
}

test('cortes anticipados conservan marcador y goles; finalizado congela reloj', async ({ page }) => {
  const data = fixture()
  const actions: string[] = []
  await page.route('**/rest/v1/**', async route => {
    if (route.request().url().endsWith('/control_match')) {
      const body = route.request().postDataJSON()
      expect(body.p_expected_updated_at).toBe(data.match.updated_at)
      actions.push(body.p_action)
      data.match.status = ({ BREAK: 'DESCANSO', SECOND_HALF: 'SEGUNDO_TIEMPO', FINISH: 'FINALIZADO' } as Record<string, string>)[body.p_action]
      data.match.phase_elapsed_seconds = body.p_action === 'FINISH' ? 12 : 0
      data.match.phase_started_at = body.p_action === 'FINISH' ? null : new Date().toISOString()
      data.match.updated_at = new Date().toISOString()
    } else expect(route.request().url()).toContain('/get_match_control')
    data.server_now = new Date().toISOString()
    await route.fulfill({ json: data })
  })
  await page.goto('/admin/partidos/clock-test')
  for (const label of ['Terminar primer tiempo', 'Finalizar descanso e iniciar segundo tiempo', 'FINALIZAR PARTIDO']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByLabel('Marcador')).toHaveText('1 - 0')
    expect(data.goals).toHaveLength(1)
    await expect(page.getByRole('heading',{name:'Goles válidos'})).toHaveCount(0)
  }
  expect(actions).toEqual(['BREAK', 'SECOND_HALF', 'FINISH'])
  await expect(page.getByRole('timer')).toHaveText('00:12')
  await page.reload()
  await expect(page.getByRole('timer')).toHaveText('00:12')
  await expect(page.getByRole('button', { name: 'FINALIZAR PARTIDO' })).toHaveCount(0)
})

for (const [phase, threshold] of [['PRIMER_TIEMPO', 870], ['DESCANSO', 270], ['SEGUNDO_TIEMPO', 870]] as const) {
  test(`aviso y una vibración en ${phase}, sin repetir tras pausa`, async ({ page }) => {
    const data = fixture(phase, threshold - 1)
    await page.addInitScript(() => {
      Object.defineProperty(window, 'vibrations', { value: [], configurable: true })
      Object.defineProperty(navigator, 'vibrate', { value: (pattern: number[]) => {
        (window as unknown as { vibrations: number[][] }).vibrations.push(pattern)
        return true
      }, configurable: true })
    })
    await page.clock.install()
    // Freeze before navigation: compilation/network time must not consume the
    // one-second margin in this deterministic phase-boundary fixture.
    await page.clock.pauseAt(new Date())
    await page.route('**/rest/v1/**', async route => {
      // The isolated API has no Realtime connection: the 30 s fallback polls.
      // Return a fresh server clock instead of resetting to the original fixture.
      data.server_now = await page.evaluate(() => new Date().toISOString())
      if (route.request().url().endsWith('/control_match')) {
        const action = route.request().postDataJSON().p_action
        data.match.status = action === 'PAUSE' ? 'PAUSADO' : phase
        data.match.paused_from_status = action === 'PAUSE' ? phase : null
        data.match.phase_started_at = action === 'PAUSE' ? null : data.server_now
        data.match.phase_elapsed_seconds = threshold
      } else expect(route.request().url()).toContain('/get_match_control')
      await route.fulfill({ json: data })
    })
    await page.goto('/admin/partidos/clock-test')
    await expect(page.getByRole('heading', { name: 'Control del partido' })).toBeVisible()
    await page.clock.runFor(50) // Run the initial refresh scheduled by the component.
    await expect(page.getByRole('timer')).toBeVisible()
    await expect(page.getByText(/Quedan 30 segundos/)).toHaveCount(0)
    await page.clock.runFor(1100)
    await expect(page.getByText(/Quedan 30 segundos/)).toBeVisible()
    const vibrations = () => page.evaluate(() => (window as unknown as { vibrations: number[][] }).vibrations)
    expect(await vibrations()).toEqual([[200, 100, 200]])
    await page.getByRole('button', { name: 'PAUSAR', exact: true }).click()
    await expect(page.getByText(/Quedan 30 segundos/)).toHaveCount(0)
    await page.getByRole('button', { name: 'REANUDAR', exact: true }).click()
    await expect(page.getByText(/Quedan 30 segundos/)).toBeVisible()
    // Leave room for the asynchronous fallback snapshot and its latency anchor.
    await page.clock.runFor(35000)
    await expect(page.getByText(/Quedan 30 segundos/)).toHaveCount(0)
    expect(await vibrations()).toHaveLength(1)
  })
}

test('el aviso funciona sin API de vibración y no aparece en público', async ({ page }) => {
  const data = fixture('SEGUNDO_TIEMPO', 870)
  await page.addInitScript(() => Object.defineProperty(navigator, 'vibrate', { value: undefined }))
  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().url().endsWith('/get_tournament')
    ? { categories: [], matchdays: [], matches: [data] } : data }))
  await page.goto('/admin/partidos/clock-test')
  await expect(page.getByText(/Quedan 30 segundos/)).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('timer')).toBeVisible()
  await expect(page.getByText(/Quedan 30 segundos/)).toHaveCount(0)
})

test('eliminatoria empatada espera tiempo reglamentario antes de iniciar penales', async ({ page }) => {
  const data = fixture('SEGUNDO_TIEMPO', 120)
  data.match.stage = 'SEMIFINAL'
  data.score.away = 1
  await page.route('**/rest/v1/**', async route => {
    expect(route.request().url()).toContain('/get_match_control')
    await route.fulfill({ json: data })
  })
  await page.goto('/admin/partidos/clock-test')
  await expect(page.getByRole('button', { name: 'FINALIZAR PARTIDO' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'INICIAR PENALES' })).toHaveCount(0)
  await expect(page.getByLabel('Marcador')).toHaveText('1 - 1')
})
