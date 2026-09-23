import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Shootout } from '../../src/lib/penalties'

function fixture() {
  const now = new Date().toISOString()
  return { match: { id: 'm', category_id: 'c', home_team_id: 'a', away_team_id: 'b', stage: 'SEMIFINAL', status: 'SEGUNDO_TIEMPO', paused_from_status: null as string | null,
    phase_elapsed_seconds: 900, phase_started_at: now as string | null, updated_at: now, tiebreak_winner_team_id: null as string | null, walkover_loser_team_id: null as string | null },
    home: 'San Martín', away: 'San Pablo', category: 'Mujeres', matchday: 5, server_now: now, score: { home: 1, away: 1 },
    goals: [], events: [], lineup: [], players: [], shootout: null as Shootout | null, resolved: false,
  }
}
async function mock(page: Page, data = fixture(), loseResponse = false) {
  const requests: Record<string, unknown>[] = []
  const seen = new Set<string>()
  await page.routeWebSocket('**/realtime/**', socket => socket.close())
  await page.route('**/rest/v1/**', async route => {
    const rpc = route.request().url().split('/').at(-1)!
    const body = route.request().postDataJSON()
    if (rpc === 'open_penalty_shootout') {
      data.shootout = { first_team_id: null, next_team_id: null, revision: 0, completed_at: null, winner_team_id: null, score: { home: 0, away: 0 }, attempts: [] }
      data.match.status = 'PAUSADO'; data.match.paused_from_status = 'SEGUNDO_TIEMPO'; data.match.phase_started_at = null
    } else if (rpc === 'manage_penalty_shootout') {
      requests.push(body)
      const s = data.shootout!
      if (!seen.has(body.p_request_id)) {
        seen.add(body.p_request_id)
        if (body.p_action === 'RECORD' && !s.first_team_id) s.first_team_id = body.p_team_id
        if (body.p_action === 'RECORD') s.attempts.push({ id: String(s.revision), sequence: s.attempts.length + 1, team_id: body.p_team_id,
          converted: body.p_converted, request_id: body.p_request_id, created_at: data.server_now, updated_at: data.server_now, voided_at: null })
        if (body.p_action === 'CORRECT') s.attempts.find(k => k.id === body.p_attempt_id)!.converted = body.p_converted
        if (body.p_action === 'VOID') s.attempts.pop()
        s.revision++
        s.score = { home: s.attempts.filter(k => k.team_id === 'a' && k.converted).length, away: s.attempts.filter(k => k.team_id === 'b' && k.converted).length }
        s.next_team_id = s.attempts.length % 2 === 0 ? s.first_team_id : s.first_team_id === 'a' ? 'b' : 'a'
        const nh = s.attempts.filter(k => k.team_id === 'a').length, na = s.attempts.filter(k => k.team_id === 'b').length
        const decided = nh <= 5 && na <= 5 ? s.score.home > s.score.away + 5 - na || s.score.away > s.score.home + 5 - nh : nh === na && s.score.home !== s.score.away
        if (decided) {
          s.completed_at = data.server_now; s.winner_team_id = s.score.home > s.score.away ? 'a' : 'b'; s.next_team_id = null
          data.match.tiebreak_winner_team_id = s.winner_team_id; data.match.status = 'FINALIZADO'; data.resolved = true
        }
        if (loseResponse && body.p_action === 'RECORD') { loseResponse = false; return route.abort('failed') }
      }
    } else if (!['get_match_control', 'get_tournament'].includes(rpc)) throw Error('Unexpected request ' + rpc)
    return route.fulfill({ json: rpc === 'get_tournament' ? { categories: [{ id: 'c', name: 'Mujeres', regular_closed_at: null, qualified: [] }], matchdays: [{ id: 'd', number: 5, date: null }], matches: [data] } : data })
  })
  return { data, requests }
}

for (const width of [320, 390, 768, 1280]) test(`tanda completa, corrección y calendarios a ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 })
  const { data } = await mock(page)
  await page.goto('/admin/partidos/m')
  const panel = page.getByRole('region', { name: 'Tanda de penales' })
  await expect(panel.locator('.penalty-actions button:enabled')).toHaveCount(4)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await panel.getByRole('button', { name: 'GOL San Pablo', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'GOL San Pablo', exact: true })).toBeDisabled()
  await expect(panel.getByText('SIGUIENTE LANZAMIENTO:')).toContainText('San Martín')
  await panel.locator('.penalty-actions button:enabled').filter({hasText:'ERRÓ'}).click()
  await expect(panel.getByLabel('Marcador de penales')).toHaveCount(0)
  await expect(panel.locator('.kick-pending')).toHaveCount(8)
  if (width === 390) await panel.screenshot({ path: 'test-results/penalty-shootout-mobile.png' })
  await panel.getByRole('button', { name: 'Lanzamiento 2 San Martín: fallado' }).click()
  let correction = page.getByRole('dialog', { name: 'CORREGIR LANZAMIENTO' })
  await correction.getByRole('button', { name: 'Cambiar a CONVERTIDO' }).click()
  await expect(panel.getByRole('button', { name: 'FINALIZAR TANDA' })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Lanzamiento 1 San Pablo: convertido' }).click()
  correction = page.getByRole('dialog', { name: 'CORREGIR LANZAMIENTO' })
  await expect(correction.getByRole('button', { name: 'ANULAR último lanzamiento' })).toBeDisabled()
  await correction.getByRole('button', { name: 'Cancelar' }).click()
  await panel.getByRole('button', { name: 'Lanzamiento 2 San Martín: convertido' }).click()
  await correction.getByRole('button', { name: 'ANULAR último lanzamiento' }).click()
  await expect(panel.getByText('SIGUIENTE LANZAMIENTO:')).toContainText('San Martín')
  await panel.locator('.penalty-actions button:enabled').filter({hasText:'ERRÓ'}).click()
  for (let round = 0; round < 2; round++) {
    await panel.locator('.penalty-actions button:enabled').filter({hasText:'GOL'}).click()
    await panel.locator('.penalty-actions button:enabled').filter({hasText:'ERRÓ'}).click()
  }
  await expect(panel.getByText('SAN PABLO GANA EN PENALES')).toBeVisible()
  await expect(panel.getByLabel('Marcador de penales')).toHaveText('0 - 3')
  await expect(panel.locator('.kick-pending')).toHaveCount(4)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Marcador', { exact: true })).toHaveText('1 - 1')
  expect(data.match.status).toBe('FINALIZADO')
  await page.goto('/')
  await expect(page.locator('.match-card')).toHaveCount(0)
  for (const path of ['/partidos', '/admin/calendario']) {
    await page.goto(path)
    await expect(page.getByLabel('Marcador de penales').first()).toHaveText('0 - 3')
    await expect(page.getByText('1 - 1', { exact: true }).first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.getByRole('button', { name: 'Lanzamiento 1 San Pablo: convertido' }).click()
  await expect(page.getByRole('dialog', { name: 'CORREGIR LANZAMIENTO' })).toContainText('conservar el ganador confirmado')
})

test('respuesta perdida: recarga y reintento conservan request_id y un solo tiro', async ({ page }) => {
  const { requests } = await mock(page, fixture(), true)
  await page.goto('/admin/partidos/m')
  await page.getByRole('region', { name: 'Tanda de penales' }).getByRole('button', { name: 'GOL San Martín', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reintentar operación pendiente' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Reintentar operación pendiente' }).click()
  await expect(page.getByLabel('Marcador de penales')).toHaveCount(0)
  expect(requests).toHaveLength(2)
  expect(requests[0]).toEqual(requests[1])
  await expect(page.getByRole('button', { name: /^Lanzamiento / })).toHaveCount(1)
})

test('Inicio refresca tanda desde notificación existente sin celebrar GOAL', async ({ page }) => {
  const data = fixture()
  data.match.status = 'PAUSADO'; data.match.paused_from_status = 'SEGUNDO_TIEMPO'
  data.shootout = { first_team_id: 'a', next_team_id: 'a', revision: 0, completed_at: null, winner_team_id: null, score: { home: 0, away: 0 }, attempts: [] }
  await mock(page, data)
  await page.goto('/')
  await expect(page.getByLabel('Marcador de penales')).toHaveCount(0)
  data.shootout.score.home = 1
  data.shootout.attempts.push({id:'kick',team_id:'a',sequence:1,converted:true,request_id:'r',created_at:data.server_now,updated_at:data.server_now,voided_at:null})
  await page.evaluate(async () => {
    // Deliver to the real hook; no remote WebSocket is used by this test.
    // @ts-expect-error Browser imports the Vite-served module.
    const { supabase } = await import('/src/lib/supabase.ts')
    for (const channel of supabase.getChannels()) for (const binding of channel.bindings.postgres_changes ?? []) {
      if (binding.filter.table === 'penalty_shootout_attempts') binding.callback({ table: 'penalty_shootout_attempts', eventType: 'INSERT', new: { id: 'kick' }, old: {} })
    }
  })
  await expect(page.getByLabel('Lanzamiento 1 San Martín: convertido').first()).toBeVisible()
  await expect(page.getByLabel('Marcador de penales')).toHaveCount(0)
  await expect(page.getByText('¡GOOOL!')).toHaveCount(0)
})

for (const mode of ['regular', 'early', 'unequal', 'walkover']) test(`no inicia tanda: ${mode}`, async ({ page }) => {
  const data = fixture()
  if (mode === 'regular') data.match.stage = 'REGULAR'
  if (mode === 'early') data.match.phase_elapsed_seconds = 0
  if (mode === 'unequal') data.score.home = 2
  if (mode === 'walkover') { data.match.walkover_loser_team_id = 'b'; data.match.status = 'FINALIZADO' }
  await mock(page, data)
  await page.goto('/admin/partidos/m')
  await expect(page.getByLabel('Marcador', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Tanda de penales' })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

for (const width of [320,390,768,1280]) test(`tanda larga: tercera fila sin desbordamiento a ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:850})
  const data=fixture()
  data.home='Comunidad parroquial San Martín de Porres'
  data.away='Comunidad parroquial Santa Rosa de Lima'
  data.match.status='PAUSADO';data.match.paused_from_status='SEGUNDO_TIEMPO';data.match.phase_started_at=null
  data.shootout={first_team_id:'a',next_team_id:'a',revision:20,completed_at:null,winner_team_id:null,score:{home:10,away:10},
    attempts:Array.from({length:20},(_,i)=>({id:String(i),team_id:i%2===0?'a':'b',sequence:i+1,converted:true,request_id:String(i),created_at:data.server_now,updated_at:data.server_now,voided_at:null}))}
  await mock(page,data)
  await page.goto('/admin/partidos/m')
  const panel=page.getByRole('region',{name:'Tanda de penales'})
  await expect(panel.locator('.penalty-attempts').first().locator(':scope > *')).toHaveCount(11)
  for(const grid of await panel.locator('.penalty-attempts').all()) {
    const rows=await grid.evaluate(el=>{
      const counts:Record<string,number>={}
      for(const child of el.children){const top=child.getBoundingClientRect().top;counts[top]=(counts[top]??0)+1}
      return Object.values(counts)
    })
    expect(rows).toEqual([5,5,1])
  }
  await expect(panel.getByLabel('Marcador de penales')).toHaveCount(0)
  await panel.locator('.penalty-actions button:enabled').filter({hasText:'GOL'}).click()
  await expect(panel.locator('.penalty-actions button:enabled').filter({hasText:'ERRÓ'})).toBeEnabled()
  await expect(panel.getByLabel('Marcador de penales')).toHaveCount(0)
  await panel.locator('.penalty-actions button:enabled').filter({hasText:'ERRÓ'}).click()
  await expect(panel.getByLabel('Marcador de penales')).toHaveText('11 - 10')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.goto('/')
  await expect(page.getByLabel('Marcador de penales')).toHaveCount(0)
  await page.goto('/calendario')
  await expect(page.getByLabel('Marcador de penales')).toHaveText('11 - 10')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await expect(page.getByText(/muerte súbita/i)).toHaveCount(0)
})

for(const stage of ['SEMIFINAL','FINAL','THIRD_PLACE']) test(`acceso directo ${stage}: abre controles automáticamente`,async({page})=>{
  const data=fixture();data.match.stage=stage
  await mock(page,data)
  await page.goto('/admin/partidos/m')
  await expect(page.locator('.penalty-actions button:enabled')).toHaveCount(4)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.penalty-attempts').first().locator(':scope > *')).toHaveCount(5)
})

for (const team of ['San Martín','San Pablo']) for (const action of ['GOL','ERRÓ']) test('primer tiro '+team+' '+action+' fija alternancia',async({page})=>{
  const {data}=await mock(page)
  await page.goto('/admin/partidos/m')
  const panel=page.getByRole('region',{name:'Tanda de penales'})
  await expect(panel.locator('.penalty-actions button:enabled')).toHaveCount(4)
  await panel.getByRole('button',{name:action+' '+team,exact:true}).click()
  await expect(panel.getByRole('button',{name:'GOL '+team,exact:true})).toBeDisabled()
  await expect(panel.getByRole('button',{name:'ERRÓ '+team,exact:true})).toBeDisabled()
  const opponent=team==='San Martín'?'San Pablo':'San Martín'
  await expect(panel.getByRole('button',{name:'GOL '+opponent,exact:true})).toBeEnabled()
  expect(data.shootout!.first_team_id).toBe(team==='San Martín'?'a':'b')
  expect(data.shootout!.attempts[0].converted).toBe(action==='GOL')
  await panel.getByRole('button',{name:'ERRÓ '+opponent,exact:true}).click()
  await expect(panel.getByRole('button',{name:'GOL '+team,exact:true})).toBeEnabled()
})
