import { test, expect } from '@playwright/test'
import type { MatchEvent, MatchPlayer, Player, FoulCount } from '../../src/lib/matchEvents'

function fixture() {
  const time = new Date().toISOString()
  const players: Player[] = [
    { id: 'p', team_id: 'a', full_name: 'Carlos López', active: true },
    { id: 'q', team_id: 'b', full_name: 'Pedro Gómez', active: true },
  ]
  const lineup: MatchPlayer[] = players.map((p, i) => ({ ...p, shirt_number: i === 0 ? 5 : 10 }))
  const events: MatchEvent[] = [{ id: 'old', team_id: 'a', type: 'GOAL', period_number: 1, clock_seconds: 90 }]
  return {
    match: { id: 'm', category_id: 'c', home_team_id: 'a', away_team_id: 'b', stage: 'REGULAR', status: 'PRIMER_TIEMPO', paused_from_status: null as string | null, phase_elapsed_seconds: 480, phase_started_at: time as string | null, updated_at: time, tiebreak_winner_team_id: null, timeout_started_at: null as string | null, timeout_team_id: null as string | null },
    category: 'Varones', matchday: 1, home: 'San Martín', away: 'San Judas', server_now: time,
    score: { home: 1, away: 0 }, goals: [...events], events, players, lineup, fouls: [] as FoulCount[],
  }
}

test('plantilla permite agregar, editar y desactivar sin borrar jugadores', async ({ page }) => {
  const data = fixture()
  const roster = data.players.filter(p => p.team_id === 'a')
  await page.route('**/rest/v1/**', async route => {
    const request = route.request(), url = request.url()
    expect(request.method()).not.toBe('DELETE')
    if (url.includes('/categories')) return route.fulfill({ json: [{ id: 'c', name: 'Varones' }] })
    if (url.includes('/teams')) return route.fulfill({ json: [{ id: 'a', name: 'San Martín', category_id: 'c', active: true }] })
    expect(url).toContain('/players')
    if (request.method() === 'POST') {
      expect(request.postDataJSON()).not.toHaveProperty('shirt_number')
      const row = { ...request.postDataJSON(), id: 'new' }
      roster.push(row); return route.fulfill({ json: row })
    }
    if (request.method() === 'PATCH') {
      expect(request.postDataJSON()).not.toHaveProperty('shirt_number')
      const row = roster.find(p => p.id === new URL(url).searchParams.get('id')?.replace('eq.', ''))!
      Object.assign(row, request.postDataJSON()); return route.fulfill({ json: row })
    }
    return route.fulfill({ json: roster })
  })
  await page.goto('/admin/equipos')
  await page.getByRole('button', { name: 'Jugadores', exact: true }).click()
  await expect(page.getByText('Carlos López · Activo')).toBeVisible()
  await expect(page.getByLabel('Número de camiseta')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Actualizar plantilla' })).toHaveCount(0)
  await page.getByLabel('Nombre completo').fill('Juan Pérez')
  await page.getByRole('button', { name: 'Agregar jugador' }).click()
  const row = page.getByRole('listitem').filter({ has: page.getByText('Juan Pérez · Activo', { exact: true }) }).last()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Editar jugador' }).click()
  await page.getByLabel('Nombre completo').fill('Juan Pablo Pérez')
  await page.getByRole('button', { name: 'Guardar jugador' }).click()
  const renamed=page.getByRole('listitem').filter({ has: page.getByText('Juan Pablo Pérez · Activo', { exact: true }) }).last()
  page.once('dialog',dialog=>dialog.dismiss())
  await renamed.getByRole('button',{name:'Eliminar jugador',exact:true}).click()
  await expect(page.getByText('Juan Pablo Pérez · Activo')).toBeVisible()
  await renamed.getByRole('button',{name:'Desactivar',exact:true}).click()
  await expect(page.getByText('Juan Pablo Pérez · Inactivo')).toBeVisible()
  await page.getByRole('listitem').filter({has:page.getByText('Juan Pablo Pérez · Inactivo',{exact:true})}).last().getByRole('button',{name:'Activar',exact:true}).click()
  await expect(page.getByText('Juan Pablo Pérez · Activo')).toBeVisible()
  page.once('dialog',dialog=>dialog.accept())
  await renamed.getByRole('button',{name:'Eliminar jugador',exact:true}).click()
  await expect(page.getByText('Juan Pablo Pérez · Inactivo')).toBeVisible()
  expect(roster).toHaveLength(2)
})

test('gol y amarilla seleccionan jugador del equipo; faltas y tiempos muertos se reinician por periodo', async ({ page }) => {
  const data = fixture()
  const calls: { p_type: string; p_player_id: string | null }[] = []
  await page.clock.install()
  await page.route('**/rest/v1/**', async route => {
    const url = route.request().url()
    if (url.endsWith('/record_match_event')) {
      const body = route.request().postDataJSON()
      calls.push(body)
      const player = data.lineup.find(p => p.id === body.p_player_id)
      const event: MatchEvent = { id: String(calls.length), team_id: body.p_team_id, type: body.p_type, player_id: player?.id, player_name: player?.full_name, shirt_number: player?.shirt_number, period_number: data.match.status === 'SEGUNDO_TIEMPO' ? 2 : 1, clock_seconds: 480 }
      if(event.type === 'FOUL') {
        let counter = data.fouls.find(c => c.team_id === event.team_id && c.period_number === event.period_number)
        if (!counter) { counter = {team_id:event.team_id,period_number:event.period_number!,count:0}; data.fouls.push(counter) }
        counter.count++
      } else data.events.push(event)
      if (event.type === 'GOAL') { data.goals.push(event); data.score[event.team_id === 'a' ? 'home' : 'away']++ }
      if (event.type === 'TIMEOUT') {
        data.match.paused_from_status = data.match.status; data.match.status = 'TIEMPO_MUERTO'
        data.match.phase_started_at = null; data.match.timeout_started_at = data.server_now; data.match.timeout_team_id = body.p_team_id
      }
      return route.fulfill({ json: { event, control: data } })
    }
    if (url.endsWith('/control_match')) {
      if (route.request().postDataJSON().p_action === 'END_TIMEOUT') {
        data.match.status = data.match.paused_from_status!; data.match.paused_from_status = null
        data.match.phase_started_at = data.server_now; data.match.timeout_started_at = null; data.match.timeout_team_id = null
        return route.fulfill({ json: data })
      }
      data.match.status = route.request().postDataJSON().p_action === 'BREAK' ? 'DESCANSO' : 'SEGUNDO_TIEMPO'
      data.match.phase_elapsed_seconds = 0
      return route.fulfill({ json: data })
    }
    expect(url).toContain('/get_match_control')
    return route.fulfill({ json: data })
  })
  await page.goto('/admin/partidos/m')
  await expect(page.getByLabel('Marcador')).toBeVisible()
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    const positions = await page.locator('.control-scoreboard > p').evaluateAll(nodes => nodes.map(n => {
      const r = n.getBoundingClientRect(); return { x: r.x, right: r.right, centerY: r.y + r.height / 2 }
    }))
    expect(positions).toHaveLength(3)
    expect(positions[0].right).toBeLessThan(positions[1].x)
    expect(positions[1].right).toBeLessThan(positions[2].x)
    expect(Math.abs(positions[0].centerY - positions[2].centerY)).toBeLessThan(2)
    const toggle = await page.getByText('JUGADORES', { exact: true }).boundingBox()
    expect(toggle!.width).toBeLessThan(150)
    await page.screenshot({ path: `test-results/control-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'GOL San Martín' }).click()
  const selector = page.getByRole('region', { name: 'Seleccionar jugador' })
  await expect(selector.getByText('#5 Carlos López')).toBeVisible()
  await expect(selector.getByText('#10 Pedro Gómez')).toHaveCount(0)
  await selector.getByRole('button', { name: '#5 Carlos López' }).click()
  await expect(page.getByLabel('Marcador')).toHaveText('2 - 0')
  await expect(page.getByRole('status').filter({hasText:'Carlos López'})).toContainText('⚽ Gol registrado.')
  expect(data.goals.some(e=>e.id==='old')).toBe(true)
  await expect(page.getByRole('heading',{name:'Goles válidos'})).toHaveCount(0)
  await page.getByRole('button', { name: 'AMARILLA San Judas' }).click()
  await selector.getByRole('button', { name: '#10 Pedro Gómez' }).click()
  expect(calls[1]).toMatchObject({ p_type: 'YELLOW_CARD', p_player_id: 'q', p_team_id: 'b' })
  await page.getByRole('button', { name: 'ROJA San Martín', exact: true }).click()
  await expect(selector.getByText('#10 Pedro Gómez')).toHaveCount(0)
  await selector.getByRole('button', { name: '#5 Carlos López' }).click()
  await expect(page.getByRole('status').filter({hasText:'🟥 Roja registrado.'})).toBeVisible()
  expect(calls[2]).toMatchObject({ p_type: 'RED_CARD', p_player_id: 'p', p_team_id: 'a' })
  await expect(page.getByLabel('Marcador')).toHaveText('2 - 0')
  for (let i = 1; i <= 6; i++) {
    await page.clock.runFor(800)
    await page.getByRole('button', { name: 'FALTA San Martín', exact: true }).click()
    await expect.poll(() => data.fouls.find(c => c.team_id === 'a' && c.period_number === 1)?.count).toBe(i)
    expect(data.events.some(e => e.type === 'FOUL')).toBe(false)
    await expect(page.getByLabel('Faltas acumuladas')).toContainText(`San Martín: ${i} faltas`)
  }
  await page.getByRole('button', { name: 'MINUTO LOCAL', exact: true }).click()
  await expect(page.getByRole('button', { name: 'MINUTO LOCAL', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'MINUTO VISITANTE', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'FINALIZAR MINUTO', exact: true }).click()
  await expect(page.getByRole('button', { name: 'MINUTO VISITANTE', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Terminar primer tiempo' }).click()
  expect(data.fouls.find(c => c.period_number === 1)?.count).toBe(6)
  await expect(page.getByRole('dialog', { name: 'ARBITRAJE' })).toBeVisible()
  await page.getByRole('button', { name: 'Entendido', exact: true }).click()
  await page.getByRole('button', { name: 'Finalizar descanso e iniciar segundo tiempo' }).click()
  expect(data.fouls.filter(c => c.period_number === 2)).toHaveLength(0)
  await expect(page.getByRole('button', { name: 'MINUTO LOCAL', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Marcador')).toHaveText('2 - 0')
})

test('reintento tras fallo y recarga conserva UUID y jugador sin duplicar goles', async ({ page }) => {
  const data = fixture()
  const requests: unknown[] = []
  await page.route('**/rest/v1/**', async route => {
    if (route.request().url().endsWith('/record_match_event')) {
      requests.push(route.request().postDataJSON())
      if (requests.length === 1) return route.abort('failed')
      return route.fulfill({ json: { event: { id: 'new' }, control: data } })
    }
    expect(route.request().url()).toContain('/get_match_control')
    return route.fulfill({ json: data })
  })
  await page.goto('/admin/partidos/m')
  await page.getByRole('button', { name: 'GOL San Martín' }).click()
  await page.getByRole('button', { name: '#5 Carlos López' }).click()
  await expect(page.getByRole('button', { name: 'Reintentar evento pendiente' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Terminar primer tiempo' })).toBeDisabled()
  await page.getByRole('button', { name: 'Reintentar evento pendiente' }).click()
  await expect(page.getByRole('button', { name: 'Reintentar evento pendiente' })).toHaveCount(0)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(requests[1]).toMatchObject({ p_player_id: 'p', p_type: 'GOAL' })
})

test('público comparte estadísticas en inicio y calendario; goleadores recibe datos calculados', async ({ page }) => {
  const data = fixture()
  data.goals.push({ id: 'new', type: 'GOAL', team_id: 'a', player_id: 'p', player_name: 'Carlos López', shirt_number: 5, period_number: 1, clock_seconds: 480 })
  data.fouls = [{team_id:'a',period_number:1,count:5}]
  data.events = [...data.goals, { id: 'red', type: 'RED_CARD', team_id: 'a', player_name: 'Carlos López', shirt_number: 5, period_number: 1, clock_seconds: 610 }, { id: 'card', type: 'YELLOW_CARD', team_id: 'b', player_name: 'Pedro Gómez', shirt_number: 10, period_number: 1, clock_seconds: 600 },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, type: 'FOUL' as const, team_id: 'a', period_number: 1 }))]
  await page.route('**/rest/v1/**', route => {
    const url = route.request().url()
    if (url.endsWith('/get_top_scorers')) return route.fulfill({ json: [{ position: 1, player_id: 'p', player_name: 'Carlos López', team_name: 'San Martín', category_id: 'c', goals: 1 }] })
    if (url.includes('/categories')) return route.fulfill({ json: [{ id: 'c', name: 'Varones' }] })
    expect(url).toContain('/get_tournament')
    return route.fulfill({ json: { categories: [], matchdays: [{ id: 'd', number: 1 }], matches: [data] } })
  })
  await page.goto('/')
  await expect(page.getByLabel('Faltas acumuladas').getByText('San Martín: 5 faltas')).toBeVisible()
  await expect(page.getByRole('region',{name:'Estadísticas del partido',exact:true})).toBeVisible()
  data.match.status='FINALIZADO';data.match.phase_started_at=null
  await page.goto('/calendario')
  await page.getByText('Estadísticas del partido',{exact:false}).click()
  const timeline=page.getByRole('list',{name:'Cronología del partido'})
  await expect(timeline.getByText('⚽ #5 Carlos López')).toBeVisible()
  await expect(timeline.getByText('🟨 #10 Pedro Gómez')).toBeVisible()
  await expect(timeline.locator('.timeline-home').filter({hasText:'🟥 #5 Carlos López'})).toBeVisible()
  await expect(page.getByLabel('Faltas acumuladas')).toHaveCount(0)
  await expect(page.getByRole('button',{name:/Opciones de/})).toHaveCount(0)
  await page.getByRole('link', { name: 'Goleadores', exact: true }).click()
  await expect(page.getByRole('rowheader', { name: 'Carlos López' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Carlos López' })).toHaveText('1Carlos LópezSan Martín1')
  await expect(page.getByRole('button', { name: 'Actualizar goleadores' })).toHaveCount(0)
  await expect(page.locator('tr.qualification-zone')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('convocatoria habilita eventos y permite distinto dorsal al mismo jugador en otro partido', async ({ page }) => {
  const first = fixture(), second = fixture()
  first.lineup = []; second.lineup = []; second.match.id = 'm2'
  first.players.push({ id: 'unlisted', team_id: 'a', full_name: 'No convocado', active: true })
  const recorded: { match: string; player: string; shirt: number }[] = []
  await page.route('**/rest/v1/**', async route => {
    const body = route.request().postDataJSON()
    const data = body.p_match_id === 'm2' ? second : first
    const url = route.request().url()
    if (url.endsWith('/set_match_player')) {
      const player = data.players.find(p => p.id === body.p_player_id)!
      expect(body.p_expected_updated_at).toBe(data.match.updated_at)
      data.lineup = [...data.lineup.filter(p => p.id !== player.id), { ...player, shirt_number: body.p_shirt_number }]
    } else if (url.endsWith('/record_match_event')) {
      const player = data.lineup.find(p => p.id === body.p_player_id)!
      recorded.push({ match: data.match.id, player: player.id, shirt: player.shirt_number })
      player.used = true
      const event: MatchEvent = { id: `goal${recorded.length}`, team_id: player.team_id, player_id: player.id, shirt_number: player.shirt_number, player_name: player.full_name, type: 'GOAL', period_number: 1, clock_seconds: 480 }
      data.goals.push(event); data.events.push(event); data.score.home++
      return route.fulfill({ json: { event, control: data } })
    } else expect(url).toContain('/get_match_control')
    return route.fulfill({ json: data })
  })
  for (const [matchId, number] of [['m', '5'], ['m2', '10']]) {
    await page.goto(`/admin/partidos/${matchId}`)
    await expect(page.getByRole('button', { name: 'GOL San Martín' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'FALTA San Martín', exact: true })).toBeDisabled()
    await page.getByText('JUGADORES', { exact: true }).click()
    const home = page.getByRole('region', { name: 'Convocatoria de San Martín', exact: true })
    await home.getByRole('combobox', { name: 'Jugador', exact: true }).selectOption('p')
    await home.getByLabel('Número en este partido').fill(number)
    await home.getByRole('button', { name: 'Guardar convocatoria' }).click()
    await expect(home.getByText(`#${number} Carlos López`, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'GOL San Martín' })).toBeDisabled()
    const away = page.getByRole('region', { name: 'Convocatoria de San Judas', exact: true })
    await away.getByRole('combobox', { name: 'Jugador', exact: true }).selectOption('q')
    await away.getByLabel('Número en este partido').fill('7')
    await away.getByRole('button', { name: 'Guardar convocatoria' }).click()
    await expect(page.getByRole('button', { name: 'GOL San Martín' })).toBeEnabled()
    await page.getByRole('button', { name: 'GOL San Martín' }).click()
    const selector = page.getByRole('region', { name: 'Seleccionar jugador', exact: true })
    await expect(selector.getByText('No convocado')).toHaveCount(0)
    await selector.getByRole('button', { name: `#${number} Carlos López` }).click()
    await expect(home.getByText('Dorsal fijado por eventos del partido.')).toBeVisible()
    await expect(page.getByRole('status').filter({hasText:`#${number} Carlos López`})).toBeVisible()
  }
  expect(recorded).toEqual([{ match: 'm', player: 'p', shirt: 5 }, { match: 'm2', player: 'p', shirt: 10 }])
})
