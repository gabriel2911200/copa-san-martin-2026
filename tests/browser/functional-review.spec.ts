import { test, expect } from '@playwright/test'

function fixture() {
  const now=new Date().toISOString()
  return {match:{id:'m',category_id:'c',home_team_id:'h',away_team_id:'a',stage:'REGULAR',status:'PROGRAMADO',paused_from_status:null,phase_elapsed_seconds:0,phase_started_at:null,period_duration_seconds:900,updated_at:now,scheduled_date:null as string|null,scheduled_time:null as string|null,tiebreak_winner_team_id:null},home:'Santa Rita',away:'Santa Ana',category:'Mujeres',matchday:1,server_now:now,score:{home:0,away:0},events:[],goals:[],players:[],lineup:[],shootout:null}
}

test('agenda confirmada conserva fecha y versión si falla la lectura posterior',async({page})=>{
  const data=fixture();let writes=0;let readsAvailable=false
  data.match.updated_at='2026-11-09T12:00:00.000001+00:00'
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  await page.route('**/rest/v1/**',route=>{
    if(route.request().url().endsWith('/reschedule_match')){
      const body=route.request().postDataJSON()
      expect(body.p_expected_updated_at).toBe(data.match.updated_at)
      writes++;data.match.scheduled_date=body.p_date;data.match.scheduled_time=body.p_time
      data.match.updated_at=`2026-11-09T12:00:00.00000${writes+1}+00:00`
      return route.fulfill({json:data})
    }
    if(writes&&!readsAvailable)return route.fulfill({status:400,json:{code:'P0001',message:'Temporary read failure'}})
    return route.fulfill({json:{categories:[],matchdays:[],matches:[data]}})
  })
  await page.goto('/admin/controlar');await page.getByText('PROGRAMAR',{exact:true}).click()
  await page.getByLabel('Fecha del partido',{exact:true}).fill('2026-11-15')
  await page.getByLabel('Hora (Tarija)',{exact:true}).fill('18:00')
  await page.getByRole('button',{name:'Guardar agenda',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Agenda guardada.'})).toBeVisible()
  await expect(page.getByLabel('Fecha del partido',{exact:true})).toHaveValue('2026-11-15')
  await expect(page.getByLabel('Hora (Tarija)',{exact:true})).toHaveValue('18:00')
  await page.getByLabel('Hora (Tarija)',{exact:true}).fill('19:00')
  await page.getByRole('button',{name:'Guardar agenda',exact:true}).click()
  await expect.poll(()=>writes).toBe(2)
  await expect(page.getByLabel('Hora (Tarija)',{exact:true})).toHaveValue('19:00')
  readsAvailable=true
  data.match.updated_at='2026-11-09T12:00:00.000004+00:00'
  data.match.scheduled_date='2026-11-16';data.match.scheduled_time='20:00'
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await expect(page.getByLabel('Fecha del partido',{exact:true})).toHaveValue('2026-11-16')
  await expect(page.getByLabel('Hora (Tarija)',{exact:true})).toHaveValue('20:00')
})

test('catálogo se sincroniza al volver a la ventana y conserva la duración del encuentro',async({page})=>{
  const data=fixture()
  let catalog=[{seconds:900,built_in:true},{seconds:1200,built_in:true}]
  let reads=0
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  await page.route('**/rest/v1/**',route=>{
    if(route.request().url().includes('/duration_options')){reads++;return route.fulfill({json:catalog})}
    if(route.request().url().endsWith('/set_match_duration'))data.match.period_duration_seconds=route.request().postDataJSON().p_seconds
    return route.fulfill({json:data})
  })
  await page.goto('/admin/partidos/m')
  await expect.poll(()=>reads).toBeGreaterThan(0)
  const selector=page.getByLabel('Duración por tiempo',{exact:true})
  catalog=[...catalog,{seconds:1500,built_in:false}]
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await expect(selector.locator('option[value="1500"]')).toHaveCount(1)
  await selector.selectOption('1500')
  await expect(selector).toHaveValue('1500')
  catalog=catalog.filter(o=>o.seconds!==1500)
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await expect(selector.locator('option[value="1500"]')).toContainText('exclusivo')
  await expect(selector).toHaveValue('1500')
  expect(data.match.period_duration_seconds).toBe(1500)
})
