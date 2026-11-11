import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

function match(stage = 'REGULAR', duration = 900) {
  const now = new Date().toISOString()
  return { match: { id:'m',category_id:'c',home_team_id:'a',away_team_id:'b',stage,status:'PROGRAMADO',
    paused_from_status:null as string|null,phase_elapsed_seconds:0,phase_started_at:null as string|null,period_duration_seconds:duration,
    updated_at:now,tiebreak_winner_team_id:null },server_now:now,home:'Local',away:'Visitante',category:'Mujeres',matchday:1,
    score:{home:0,away:0},goals:[],events:[],lineup:[],players:[],shootout:null as object|null }
}
async function emit(page: Page, table: string) {
  await page.evaluate(async table => {
    // @ts-expect-error Browser Vite module, not a filesystem import.
    const { supabase } = await import('/src/lib/supabase.ts')
    for(const channel of supabase.getChannels()) for(const binding of channel.bindings.postgres_changes ?? []) {
      if(binding.filter.table===table) binding.callback({table,eventType:'UPDATE',new:{},old:{}})
    }
  },table)
}

for(const stage of ['REGULAR','SEMIFINAL','THIRD_PLACE','FINAL']) test(`duración ${stage}: persiste, recarga, público y bloqueo al iniciar`,async({page})=>{
  const data=match(stage)
  let saves=0
  await page.route('**/rest/v1/**',async route=>{
    const rpc=route.request().url().split('/').at(-1)
    if(rpc?.startsWith('duration_options')) return route.fulfill({json:[{seconds:900,built_in:true},{seconds:1200,built_in:true}]})
    if(rpc==='set_match_duration') {
      expect(route.request().postDataJSON()).toEqual({p_match_id:'m',p_seconds:1200,p_expected_updated_at:data.match.updated_at})
      saves++;data.match.period_duration_seconds=1200
    } else expect(['get_match_control','get_tournament']).toContain(rpc)
    await route.fulfill({json:rpc==='get_tournament'?{categories:[],matchdays:[],matches:[data]}:data})
  })
  await page.goto('/admin/partidos/m')
  await expect(page.getByRole('timer')).toHaveText('15:00')
  await page.getByLabel('Duración por tiempo',{exact:true}).selectOption('1200')
  await expect(page.getByRole('timer')).toHaveText('20:00')
  await expect(page.getByLabel('Duración por tiempo',{exact:true})).toHaveValue('1200')
  await page.reload()
  await expect(page.getByRole('timer')).toHaveText('20:00')
  // Server state changed on another controller; the existing channel refreshes it.
  data.match.status='PAUSADO';data.match.paused_from_status='PRIMER_TIEMPO'
  await emit(page,'matches')
  await expect(page.getByLabel('Duración por tiempo',{exact:true})).toBeDisabled()
  expect(saves).toBe(1)
  await page.goto('/')
  await expect(page.getByRole('timer')).toHaveText('20:00')
  await expect(page.getByRole('button',{name:'20 min',exact:true})).toHaveCount(0)
  data.match.period_duration_seconds=900
  await emit(page,'matches')
  await expect(page.getByRole('timer')).toHaveText('15:00')
})

for(const stage of ['SEMIFINAL','THIRD_PLACE','FINAL']) test(`${stage} de 20: penales solo a los 20 minutos`,async({page})=>{
  const data=match(stage,1200)
  Object.assign(data.match,{status:'PAUSADO',paused_from_status:'SEGUNDO_TIEMPO',phase_elapsed_seconds:900})
  let opens=0
  await page.route('**/rest/v1/**',async route=>{
    if(route.request().url().endsWith('/open_penalty_shootout')) {
      opens++
      expect(data.match.phase_elapsed_seconds).toBe(1200)
      data.shootout={first_team_id:null,next_team_id:null,revision:0,completed_at:null,winner_team_id:null,score:{home:0,away:0},attempts:[]}
    } else expect(route.request().url()).toContain('get_match_control')
    await route.fulfill({json:data})
  })
  await page.goto('/admin/partidos/m')
  await expect(page.getByRole('timer')).toHaveText('05:00')
  expect(opens).toBe(0)
  await expect(page.getByRole('region',{name:'Tanda de penales'})).toHaveCount(0)
  data.match.phase_elapsed_seconds=1200
  await emit(page,'matches')
  await page.getByRole('button',{name:'Penales',exact:true}).click()
  expect(opens).toBe(0)
  await page.getByRole('button',{name:'INICIAR TANDA DE PENALES'}).click()
  await expect(page.getByRole('region',{name:'Tanda de penales'})).toBeVisible()
  await expect(page.getByRole('timer')).toHaveText('00:00')
  expect(opens).toBe(1)
})

test('reinicio anónimo: sin login, texto exacto, error y reintento sin cambiar solicitud',async({page})=>{
  const requests: object[]=[]
  let reads=0
  let authCalls=0
  await page.route('**/auth/v1/**',route=>{authCalls++;return route.abort()})
  let anonHeader: string | undefined
  await page.route('**/rest/v1/**',async route=>{
    const rpc=route.request().url().split('/').at(-1)
    if(rpc==='get_tournament') {
      reads++
      anonHeader=route.request().headers().authorization
      return route.fulfill({json:{categories:[],matchdays:[],matches:[]}})
    }
    expect(route.request().headers().authorization).toBe(anonHeader)
    if(rpc==='prepare_tournament_reset') return route.fulfill({json:'00000000-0000-4000-8000-000000000002'})
    expect(rpc).toBe('reset_tournament')
    requests.push(route.request().postDataJSON())
    if(requests.length===1) return route.fulfill({status:503,json:{message:'Response lost'}})
    return route.fulfill({json:{reset:true,replayed:true}})
  })
  await page.goto('/admin/controlar')
  await page.getByRole('button',{name:'REINICIAR CAMPEONATO',exact:true}).click()
  await expect(page.getByText('Esta acción eliminará permanentemente todos los datos del campeonato actual.')).toBeVisible()
  await expect(page.locator('input[type=email],input[type=password]')).toHaveCount(0)
  const input=page.getByLabel('Escribe exactamente REINICIAR')
  const final=page.getByRole('button',{name:'REINICIAR DEFINITIVAMENTE'})
  for(const invalid of ['','reiniciar','REINICIAR ']) {await input.fill(invalid);await expect(final).toBeDisabled()}
  await input.fill('REINICIAR');await final.click()
  await expect(page.getByRole('alert')).toContainText('No se pudo confirmar')
  await expect(page.getByRole('dialog')).toBeVisible()
  await final.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText(/Campeonato reiniciado correctamente/)).toBeVisible()
  expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1])
  expect(reads).toBeGreaterThan(1)
  expect(authCalls).toBe(0)
  await page.goto('/')
  await expect(page.getByRole('button',{name:/REINICIAR/})).toHaveCount(0)
})

test('versión nueva: público recarga una vez; administración conserva el formulario',async({page})=>{
  let checks=0
  await page.route('**/version.json*',route=>{checks++;return route.fulfill({json:{version:'new-deployment-test'}})})
  await page.route('**/rest/v1/**',route=>route.fulfill({json:{categories:[],matchdays:[],matches:[]}}))
  await page.goto('/')
  await expect.poll(()=>checks).toBeGreaterThanOrEqual(2)
  await expect(page.getByText('Hay una nueva versión disponible.')).toBeVisible()
  expect(await page.evaluate(()=>sessionStorage.getItem('app-version-reload'))).toBe('new-deployment-test')
  await page.goto('/admin/controlar')
  await page.getByRole('button',{name:'REINICIAR CAMPEONATO',exact:true}).click()
  await page.getByLabel('Escribe exactamente REINICIAR').fill('BORRADOR')
  await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')))
  await expect(page.getByLabel('Escribe exactamente REINICIAR')).toHaveValue('BORRADOR')
  await expect(page.getByRole('button',{name:'Actualizar aplicación'})).toBeVisible()
})
