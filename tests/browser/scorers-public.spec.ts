import { test, expect } from '@playwright/test'

test('TOP 5 ordena, numera empates y separa categorías incluso ante respuesta mezclada', async ({ page }) => {
  let emptyWomen = false
  const rows = Array.from({ length: 8 }, (_, i) => ({ position: 1, player_id: `p${i}`, player_name: `Jugador ${i}`, team_name: `Equipo ${i}`, category_id: i % 2 ? 'w' : 'm', goals: i < 4 ? 2 : 5 }))
  await page.route('**/rest/v1/**', route => {
    if (route.request().url().includes('/categories')) return route.fulfill({ json: [{ id: 'w', name: 'Mujeres' }, { id: 'm', name: 'Varones' }] })
    expect(route.request().url()).toContain('/get_top_scorers')
    return route.fulfill({ json: emptyWomen ? rows.filter(r => r.category_id === 'm') : rows })
  })
  await page.goto('/goleadores')
  await expect(page.locator('.category-tabs button')).toHaveText(['TODOS', 'MUJERES', 'VARONES'])
  await expect(page.locator('tbody tr')).toHaveCount(5)
  await expect(page.locator('tbody tr td:first-child')).toHaveText(['1', '2', '3', '4', '5'])
  await expect(page.locator('tbody tr td:last-child')).toHaveText(['5', '5', '5', '5', '2'])
  for (const [tab, names] of [['MUJERES', ['Jugador 5', 'Jugador 7', 'Jugador 1', 'Jugador 3']], ['VARONES', ['Jugador 4', 'Jugador 6', 'Jugador 0', 'Jugador 2']]] as const) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await expect(page.locator('tbody th')).toHaveText([...names])
    await expect(page.locator('tbody tr td:first-child')).toHaveText(['1', '2', '3', '4'])
  }
  emptyWomen = true
  await page.getByRole('button', { name: 'MUJERES', exact: true }).click()
  await expect(page.getByText('Aún no hay goleadores en esta categoría.')).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(0)
})

for (const status of ['FINALIZADO', 'PRIMER_TIEMPO']) test(`estadísticas públicas ${status}: nombres, autogol y tiempos sin acciones`, async ({ page }) => {
  const now = new Date().toISOString()
  const events = [
    { id: 'g', type: 'GOAL', team_id: 'a', player_id: 'p', player_name: 'Jugador real', period_number: 1, clock_seconds: 320 },
    { id: 'own', type: 'GOAL', team_id: 'b', player_id: null, player_name: 'Autogol', period_number: 2, clock_seconds: 734 },
  ]
  const match = { match: { id: 'm', category_id: 'c', home_team_id: 'a', away_team_id: 'b', status, stage: 'REGULAR', updated_at: now, phase_started_at: null, phase_elapsed_seconds: 900 }, home: 'Local', away: 'Visitante', category: 'Varones', matchday: 1, server_now: now, score: { home: 1, away: 1 }, goals: events, events }
  await page.route('**/rest/v1/**', route => {
    expect(route.request().url()).toContain('/get_tournament')
    return route.fulfill({ json: { categories: [], matchdays: [{ id: 'd', number: 1 }], matches: [match] } })
  })
  for (const path of status === 'FINALIZADO' ? ['/calendario'] : ['/']) {
    await page.goto(path)
    if (status === 'FINALIZADO') await page.getByText('Estadísticas del partido', { exact: false }).click()
    const timeline = page.getByRole('list', { name: 'Cronología del partido' })
    await expect(timeline.getByText('⚽ Jugador real', { exact: true })).toBeVisible()
    await expect(timeline.getByText('⚽ Autogol', { exact: true })).toBeVisible()
    await expect(timeline.locator('time')).toHaveText(['1T 05:20', '2T 12:14'])
    await expect(timeline.getByRole('button')).toHaveCount(0)
  }
})
