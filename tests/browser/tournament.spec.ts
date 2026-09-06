import { test, expect } from '@playwright/test'

test('público móvil: marcador, celebración, anulación y pausa por eventos simulados', async ({ page }) => {
  const data = {
    categories: [{ id: 'c', name: 'Varones', regular_closed_at: null, qualified: [] }, { id: 'w', name: 'Mujeres', regular_closed_at: null, qualified: [] }],
    matchdays: Array.from({ length: 6 }, (_, i) => ({ id: String(i), number: i + 1, date: null })),
    matches: [{ match: { id: 'm', category_id: 'c', home_team_id: 'a', away_team_id: 'b', stage: 'REGULAR', status: 'PAUSADO', paused_from_status: 'PRIMER_TIEMPO', phase_elapsed_seconds: 120, phase_started_at: null, tiebreak_winner_team_id: null }, category: 'Varones', matchday: 1, home: 'Equipo A', away: 'Equipo B', server_now: new Date().toISOString(), score: { home: 0, away: 0 }, goals: [] as { id: string; team_id: string }[], resolved: false }],
  }
  await page.route('**/rest/v1/**', route => route.fulfill({ json: data }))
  await page.goto('/')
  await expect(page.getByRole('timer')).toHaveText('02:00')
  await expect(page.getByText('0 - 0', { exact: true })).toBeVisible()
  await expect(page.getByText('¡GOOOL!')).toHaveCount(0)
  const emit = async (type: string, record: Record<string, unknown>) => {
    await page.evaluate(async ({ type, record }) => {
      // Simula la entrega al manejador; la conexión real se verifica por separado.
      const { supabase } = await import('/src/lib/supabase.ts')
      for (const channel of supabase.getChannels()) {
        for (const binding of channel.bindings.postgres_changes ?? []) {
          if (binding.filter.table === 'match_events') binding.callback({ table: 'match_events', eventType: type, new: record, old: {} })
        }
      }
    }, { type, record })
  }
  data.matches[0].score.home = 1
  data.matches[0].goals = [{ id: 'g', team_id: 'a' }]
  await emit('INSERT', { id: 'g', match_id: 'm', team_id: 'a', type: 'GOAL', voided_at: null })
  await expect(page.getByText('1 - 0', { exact: true })).toBeVisible()
  await expect(page.getByText('¡GOOOL!')).toBeVisible()
  await expect(page.getByText('¡GOOOL!')).toHaveCount(0, { timeout: 6000 })
  data.matches[0].score.home = 0
  data.matches[0].goals = []
  await emit('UPDATE', { id: 'g', voided_at: new Date().toISOString() })
  await expect(page.getByText('0 - 0', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('timer')).toHaveText('02:00')
  await expect(page.getByText('¡GOOOL!')).toHaveCount(0)
  await page.goto('/partidos')
  await expect(page.getByRole('heading', { name: /^Fecha \d/ })).toHaveCount(6)
  await page.getByRole('button', { name: 'Mujeres', exact: true }).click()
  await expect(page.getByText('Equipo A', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('rutas reales cargan sin errores de JavaScript y sin escrituras', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/rest/v1/**', async route => {
    const request = route.request()
    if (request.method() !== 'GET' && !/\/rpc\/(get_tournament|get_standings|get_match_control)$/.test(request.url())) {
      throw new Error('Escritura inesperada: ' + request.url())
    }
    await route.continue()
  })
  for (const path of ['/', '/partidos', '/tablas', '/admin', '/admin/equipos', '/admin/fechas']) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  }
  expect(errors).toEqual([])
})

test('penales: exige ganador antes de finalizar y conserva el empate', async ({ page }) => {
  const snapshot = { match: { id: 'm', category_id: 'c', home_team_id: 'a', away_team_id: 'b', stage: 'SEMIFINAL', status: 'SEGUNDO_TIEMPO', paused_from_status: null, phase_elapsed_seconds: 900, phase_started_at: new Date().toISOString(), updated_at: new Date().toISOString(), tiebreak_winner_team_id: null as string | null }, category: 'Varones', matchday: 5, home: 'Equipo A', away: 'Equipo B', server_now: new Date().toISOString(), score: { home: 1, away: 1 }, goals: [] }
  await page.route('**/rest/v1/**', async route => {
    if (route.request().url().endsWith('/set_penalty_winner')) {
      expect(route.request().postDataJSON()).toEqual({ p_match_id: 'm', p_team_id: 'b' })
      snapshot.match.tiebreak_winner_team_id = 'b'
    } else if (!route.request().url().endsWith('/get_match_control')) throw Error('RPC inesperada')
    await route.fulfill({ json: snapshot })
  })
  await page.goto('/admin/partidos/m')
  await expect(page.getByRole('timer')).toHaveText('15:00')
  await expect(page.getByRole('button', { name: /finalizar/i })).toBeDisabled()
  await page.getByRole('button', { name: 'Equipo B', exact: true }).click()
  await expect(page.getByText('Equipo B gana por penales')).toBeVisible()
  await expect(page.getByRole('button', { name: /finalizar/i })).toBeEnabled()
  await expect(page.getByLabel('Marcador')).toHaveText('1 - 1')
})

test('tabla pública muestra podio separado y conserva clasificación regular', async ({ page }) => {
  const categories = [{ id: 'c', name: 'Varones', regular_closed_at: new Date().toISOString(), qualified: [] }, { id: 'w', name: 'Mujeres', regular_closed_at: null, qualified: [] }]
  const match = (id: string, stage: string, home: string, away: string) => ({ match: { id, category_id: 'c', stage, status: 'FINALIZADO', home_team_id: home, away_team_id: away, tiebreak_winner_team_id: home }, home, away, score: { home: 1, away: 1 }, resolved: true, winner_team_id: home, loser_team_id: away })
  await page.route('**/rest/v1/**', route => {
    const url = route.request().url()
    return route.fulfill({ json: url.includes('/categories?') ? categories : url.endsWith('/get_standings') ? [{ team_id: 'a', team_name: 'Equipo regular', position: 1, pj: 4, pg: 4, pe: 0, pp: 0, gf: 8, gc: 0, dg: 8, pts: 12, is_live: false }] : { categories, matchdays: [], matches: [match('f', 'FINAL', 'Campeón prueba', 'Segundo prueba'), match('t', 'THIRD_PLACE', 'Tercero prueba', 'Cuarto prueba')] } })
  })
  await page.goto('/tablas')
  await expect(page.getByText('CAMPEÓN', { exact: true })).toBeVisible()
  await expect(page.getByText(/Campeón prueba/)).toBeVisible()
  await expect(page.getByText('CUARTO LUGAR', { exact: true })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Equipo regular' })).toBeVisible()
  await page.getByRole('button', { name: 'Mujeres', exact: true }).click()
  await expect(page.getByText('CAMPEÓN', { exact: true })).toHaveCount(0)
})
