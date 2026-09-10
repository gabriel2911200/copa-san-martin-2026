import { test, expect } from '@playwright/test'

test('AUTOGOL selecciona solo equipo, conserva reintento y actualiza estadísticas', async ({ page }) => {
  const time = new Date().toISOString()
  const players = [{ id: 'p', team_id: 'a', full_name: 'Jugador local', active: true, shirt_number: 5 }, { id: 'q', team_id: 'b', full_name: 'Jugador visitante', active: true, shirt_number: 10 }]
  const data = { match: { id: 'm', category_id: 'c', home_team_id: 'a', away_team_id: 'b', status: 'PRIMER_TIEMPO', stage: 'REGULAR', phase_started_at: time, phase_elapsed_seconds: 120, updated_at: time },
    home: 'San Martín', away: 'San Judas', category: 'Varones', matchday: 1, server_now: time, score: { home: 0, away: 0 }, players, lineup: players,
    goals: [] as object[], events: [] as object[] }
  const requests: Record<string, string>[] = []
  await page.route('**/rest/v1/**', async route => {
    const url = route.request().url()
    if (url.endsWith('/record_own_goal')) {
      const body = route.request().postDataJSON(); requests.push(body)
      expect(body).not.toHaveProperty('p_player_id')
      const event = { id: body.p_request_id, team_id: body.p_team_id, type: 'GOAL', player_id: null, player_name: 'Autogol', shirt_number: null, period_number: 1, clock_seconds: 125 }
      if (!data.goals.some(e => (e as { id: string }).id === event.id)) {
        data.goals.push(event); data.events.push(event)
        data.score[body.p_team_id === 'a' ? 'home' : 'away']++
      }
      if (requests.length === 1) return route.abort('failed')
      return route.fulfill({ json: { event, control: data } })
    }
    expect(url).toContain('/get_match_control')
    return route.fulfill({ json: data })
  })
  await page.goto('/admin/partidos/m')
  const own = page.getByRole('button', { name: 'AUTOGOL', exact: true })
  await expect(own).toBeEnabled()
  const playersToggle = page.locator('summary.lineup-toggle')
  const first = await playersToggle.boundingBox(), second = await own.boundingBox()
  expect(second!.x).toBeGreaterThan(first!.x + first!.width)
  expect(second!.width).toBe(first!.width)
  expect(second!.height).toBe(first!.height)
  await own.click()
  const chooser = page.getByRole('region', { name: 'Seleccionar equipo para autogol' })
  await expect(chooser.getByRole('button')).toHaveText(['San Martín', 'San Judas', 'Cancelar selección'])
  await expect(page.getByRole('region', { name: 'Seleccionar jugador', exact: true })).toHaveCount(0)
  await chooser.getByRole('button', { name: 'San Martín', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reintentar evento pendiente' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Reintentar evento pendiente' }).click()
  await expect(page.getByLabel('Marcador')).toHaveText('1 - 0')
  expect(requests[1]).toEqual(requests[0])
  await expect(page.getByText('⚽ Autogol', { exact: true })).toHaveCount(1)
  await expect(page.locator('.match-timeline time')).toHaveText(['1T 02:05'])
  await own.click()
  await chooser.getByRole('button', { name: 'San Judas', exact: true }).click()
  await expect(page.getByLabel('Marcador')).toHaveText('1 - 1')
  await expect(page.getByText('⚽ Autogol', { exact: true })).toHaveCount(2)
  await expect(page.getByRole('status').filter({ hasText: '#null' })).toHaveCount(0)
})
