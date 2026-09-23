import { test, expect } from '@playwright/test'
import type { MatchEvent } from '../../src/lib/matchEvents'

function fixture(status = 'PRIMER_TIEMPO') {
  const now = new Date().toISOString()
  const lineup = [...Array.from({length: 30}, (_, i) => ({id: `p${i}`, team_id: 'a', full_name: `Jugador ${i}`, shirt_number: i, active: true})),
    {id: 'q', team_id: 'b', full_name: 'Rival', shirt_number: 10, active: true}]
  return {match: {id: 'm', category_id: 'c', home_team_id: 'a', away_team_id: 'b', status, stage: 'REGULAR',
    phase_started_at: status === 'PRIMER_TIEMPO' ? now : null, phase_elapsed_seconds: 0, updated_at: now,
    walkover_loser_team_id: null as string | null}, home: 'San Martín', away: 'San Pablo', category: 'Varones', matchday: 1,
    server_now: now, score: {home: 0, away: 0}, lineup, players: lineup, events: [] as MatchEvent[], goals: [] as MatchEvent[]}
}

for (const width of [320, 390, 768, 1280]) test(`modal de jugadores a ${width}px conserva foco y scroll; error recuperable`, async ({page}) => {
  await page.setViewportSize({width, height: 720})
  const data = fixture()
  let calls = 0
  await page.route('**/rest/v1/**', route => {
    if (route.request().url().endsWith('/record_match_event')) {
      calls++
      if (calls === 1) return route.fulfill({status: 400, json: {code: 'P0001', message: 'Rechazo de prueba'}})
      const body = route.request().postDataJSON()
      expect(body.p_player_id).toBe('p29')
      const event: MatchEvent = {id: 'e', type: 'GOAL', team_id: 'a', player_id: 'p29', player_name: 'Jugador 29', shirt_number: 29}
      data.events = [event]; data.goals = [event]; data.score.home = 1
      return route.fulfill({json: {event, control: data}})
    }
    expect(route.request().url()).toContain('/get_match_control')
    return route.fulfill({json: data})
  })
  await page.goto('/admin/partidos/m')
  const trigger = page.getByRole('button', {name: 'GOL San Martín', exact: true})
  await trigger.evaluate(el => el.scrollIntoView({block: 'center'}))
  const scroll = await page.evaluate(() => window.scrollY)
  await trigger.click()
  const modal = page.getByRole('dialog', {name: 'Seleccionar jugador', exact: true})
  await expect(modal).toBeVisible()
  const box = await modal.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(720)
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll)
  expect(await modal.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await modal.getByRole('button', {name: '#29 Jugador 29', exact: true}).click()
  await expect(modal.getByRole('alert')).toHaveText('Rechazo de prueba')
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll)
  await page.waitForTimeout(750)
  await modal.getByRole('button', {name: '#29 Jugador 29', exact: true}).click()
  await expect(modal).toHaveCount(0)
  await expect(page.getByLabel('Marcador')).toHaveText('1 - 0')
  await expect(trigger).toBeFocused()
  expect(calls).toBe(2)
})

test('W.O. confirma perdedor, recupera respuesta perdida y muestra resultado oficial', async ({page}) => {
  const data = fixture('PROGRAMADO')
  const requests: Record<string, string>[] = []
  await page.route('**/rest/v1/**', route => {
    if (route.request().url().endsWith('/record_walkover')) {
      const body = route.request().postDataJSON(); requests.push(body)
      expect(body.p_loser_team_id).toBe('a')
      data.match.status = 'FINALIZADO'; data.match.walkover_loser_team_id = 'a'; data.score = {home: 0, away: 3}
      if (requests.length === 1) return route.abort('failed')
      return route.fulfill({json: data})
    }
    expect(route.request().url()).toContain('/get_match_control')
    return route.fulfill({json: data})
  })
  await page.goto('/admin/partidos/m')
  await page.getByRole('button', {name: 'Walkover (W.O.)', exact: true}).click()
  const modal = page.getByRole('dialog', {name: '¿Qué equipo pierde por W.O.?'})
  await modal.getByRole('button', {name: 'San Martín', exact: true}).click()
  await expect(modal).toContainText('San Martín 0 - 3 San Pablo')
  expect(requests).toHaveLength(0)
  await modal.getByRole('button', {name: 'CONFIRMAR W.O.'}).click()
  await expect(modal.getByRole('alert')).toBeVisible()
  await modal.getByRole('button', {name: 'CONFIRMAR W.O.'}).click()
  await expect(modal).toHaveCount(0)
  expect(requests[0]).toEqual(requests[1])
  await expect(page.getByLabel('Marcador')).toHaveText('0 - 3')
  await expect(page.getByText('Resultado oficial · Walkover (W.O.)')).toBeVisible()
  expect(data.events).toHaveLength(0)
})

for (const type of ['GOAL', 'YELLOW_CARD', 'RED_CARD'] as const) test(`Calendario finalizado: editar y anular ${type}, protección explícita`, async ({page}) => {
  const data = fixture('FINALIZADO')
  const event: MatchEvent = {id: 'e', type, team_id: 'a', player_id: 'p0', player_name: 'Jugador 0', shirt_number: 0, clock_seconds: 125, period_number: 1}
  data.events = [event]; data.goals = type === 'GOAL' ? [event] : []; data.score.home = type === 'GOAL' ? 1 : 0
  let blocked = true
  await page.route('**/rest/v1/**', route => {
    const url = route.request().url()
    if (url.endsWith('/get_match_control')) return route.fulfill({json: data})
    if (url.endsWith('/edit_match_event_player')) {
      expect(route.request().postDataJSON()).toMatchObject({p_event_id: 'e', p_player_id: 'p1', p_expected_player_id: 'p0'})
      Object.assign(event, {player_id: 'p1', player_name: 'Jugador 1', shirt_number: 1})
      return route.fulfill({json: {event, control: data}})
    }
    if (url.endsWith('/void_match_event')) {
      if (blocked) return route.fulfill({status: 400, json: {code: 'P0001', message: 'La clasificación regular ya está cerrada.'}})
      event.voided_at = new Date().toISOString(); data.events = []; data.goals = []; data.score.home = 0
      return route.fulfill({json: {event, control: data}})
    }
    expect(url).toContain('/get_tournament')
    return route.fulfill({json: {categories: [], matchdays: [{id: 'd', number: 1}], matches: [data]}})
  })
  await page.goto('/admin/calendario')
  await page.locator('summary').filter({hasText: 'Estadísticas del partido'}).click()
  const timeline = page.getByRole('list', {name: 'Cronología del partido'})
  await timeline.getByRole('button').click()
  await page.getByRole('button', {name: 'EDITAR', exact: true}).click()
  const modal = page.getByRole('dialog', {name: 'Editar jugador del evento'})
  await modal.getByRole('button', {name: '#1 Jugador 1', exact: true}).click()
  await expect(modal).toHaveCount(0)
  await expect(timeline).toContainText('Jugador 1')
  await expect(timeline.locator('time')).toHaveText('1T 02:05')
  await expect(page.locator('.score-line strong')).toHaveText(type === 'GOAL' ? '1 - 0' : '0 - 0')
  await page.reload()
  await page.locator('summary').filter({hasText: 'Estadísticas del partido'}).click()
  await expect(timeline).toContainText('Jugador 1')
  await expect(timeline.locator('time')).toHaveText('1T 02:05')
  await expect(page.getByText('Resultado final',{exact:true})).toBeVisible()
  expect(data.match.status).toBe('FINALIZADO')
  expect(data.match.phase_started_at).toBeNull()
  await timeline.getByRole('button').click(); await page.getByRole('button', {name: 'ANULAR', exact: true}).click()
  const confirm = page.getByRole('dialog', {name: 'Anular evento'})
  await confirm.getByRole('button', {name: 'Anular', exact: true}).click()
  await expect(confirm.getByRole('alert')).toHaveText('La clasificación regular ya está cerrada.')
  blocked = false
  await confirm.getByRole('button', {name: 'Anular', exact: true}).click()
  await expect(timeline.getByRole('listitem')).toHaveCount(0)
  await page.reload()
  await page.locator('summary').filter({hasText: 'Estadísticas del partido'}).click()
  await expect(timeline.getByRole('listitem')).toHaveCount(0)
  await expect(page.locator('.score-line strong')).toHaveText('0 - 0')
  await expect(page.getByText('Resultado final',{exact:true})).toBeVisible()
  expect(event.voided_at).toBeTruthy()
  expect(data.match.status).toBe('FINALIZADO')
  await page.goto('/calendario')
  await page.locator('summary').filter({hasText: 'Estadísticas del partido'}).click()
  await expect(page.getByRole('button', {name: /Opciones de/})).toHaveCount(0)
})

test('corrección en Calendario actualiza público y goleadores mediante el Realtime existente', async ({page, context}) => {
  const data = fixture('FINALIZADO')
  const event: MatchEvent = {id: 'e', type: 'GOAL', team_id: 'a', player_id: 'p0', player_name: 'Jugador 0', shirt_number: 0}
  data.events = [event]; data.goals = [event]; data.score.home = 1
  await context.route('**/rest/v1/**', route => {
    const url = route.request().url()
    if (url.includes('/categories')) return route.fulfill({json: [{id: 'c', name: 'Varones'}]})
    if (url.endsWith('/get_top_scorers')) return route.fulfill({json: event.voided_at ? [] : [
      {position: 1, player_id: event.player_id, player_name: event.player_name, team_name: data.home, category_id: 'c', goals: 1}]})
    if (url.endsWith('/get_match_control')) return route.fulfill({json: data})
    if (url.endsWith('/edit_match_event_player')) {
      Object.assign(event, {player_id: 'p1', player_name: 'Jugador 1', shirt_number: 1})
      return route.fulfill({json: {event, control: data}})
    }
    if (url.endsWith('/void_match_event')) {
      event.voided_at = new Date().toISOString(); data.events = []; data.goals = []; data.score.home = 0
      return route.fulfill({json: {event, control: data}})
    }
    expect(url).toContain('/get_tournament')
    return route.fulfill({json: {categories: [], matchdays: [{id: 'd', number: 1}], matches: [data]}})
  })
  const publicPage = await context.newPage(), scorers = await context.newPage()
  await page.goto('/admin/calendario'); await publicPage.goto('/calendario'); await scorers.goto('/goleadores')
  await publicPage.locator('summary').filter({hasText: 'Estadísticas del partido'}).click()
  await expect(scorers.getByRole('rowheader', {name: 'Jugador 0'})).toBeVisible()
  await page.locator('summary').filter({hasText: 'Estadísticas del partido'}).click()
  const timeline = page.getByRole('list', {name: 'Cronología del partido'})
  await timeline.getByRole('button').click(); await page.getByRole('button', {name: 'EDITAR', exact: true}).click()
  await page.getByRole('dialog', {name: 'Editar jugador del evento'}).getByRole('button', {name: '#1 Jugador 1', exact: true}).click()
  async function notify() {
    for (const target of [publicPage, scorers]) await target.evaluate(async () => {
      // @ts-expect-error Importación de Vite dentro del navegador; evento simulado, sin escritura remota.
      const {supabase} = await import('/src/lib/supabase.ts')
      for (const channel of supabase.getChannels()) for (const binding of channel.bindings.postgres_changes ?? [])
        if (binding.filter.table === 'match_events') binding.callback({table: 'match_events', eventType: 'UPDATE', new: {id: 'e', match_id: 'm'}, old: {}})
    })
  }
  await notify()
  await expect(publicPage.getByRole('list', {name: 'Cronología del partido'})).toContainText('Jugador 1')
  await expect(scorers.getByRole('rowheader', {name: 'Jugador 1'})).toBeVisible()
  await expect(scorers.getByRole('rowheader', {name: 'Jugador 0'})).toHaveCount(0)
  await timeline.getByRole('button').click(); await page.getByRole('button', {name: 'ANULAR', exact: true}).click()
  await page.getByRole('dialog', {name: 'Anular evento'}).getByRole('button', {name: 'Anular', exact: true}).click()
  await notify()
  await expect(publicPage.locator('.score-line strong')).toHaveText('0 - 0')
  await expect(scorers.getByRole('rowheader')).toHaveCount(0)
})
