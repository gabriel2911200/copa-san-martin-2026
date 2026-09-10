import { test, expect } from '@playwright/test'

test('eliminar exige confirmación y llama baja lógica, sin DELETE real',async({page})=>{
  let writes=0
  await page.route('**/rest/v1/rpc/archive_team',route=>{writes++;return route.fulfill({status:204})})
  await page.goto('/admin/equipos')
  const button=page.getByRole('button',{name:'Eliminar San Judas',exact:true})
  await expect(button).toBeVisible()
  page.once('dialog',dialog=>dialog.dismiss())
  await button.click()
  expect(writes).toBe(0)
  page.once('dialog',dialog=>dialog.accept())
  await button.click()
  await expect(page.getByText('Equipo retirado. Historial conservado.')).toBeVisible()
  expect(writes).toBe(1)
  await expect(button).toHaveCount(0)
})

test('navegación móvil y escritorio, calendario compartido y logos reales', async ({ page }) => {
  const errors: string[]=[]
  page.on('pageerror', e=>errors.push(e.message))
  for(const width of [390,1280]) {
    await page.setViewportSize({width,height:900})
    for(const path of ['/','/calendario','/tablas','/admin/equipos','/admin/crear','/admin/calendario','/admin/controlar']) {
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      await expect(page.locator('nav')).toHaveCount(1)
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
      if(path==='/calendario') {
        await expect(page.getByRole('heading',{name:'Fecha 1',exact:true})).toBeVisible()
        await page.screenshot({path:`test-results/calendario-${width}.png`,fullPage:true})
      }
      if(path==='/') {
        await expect(page.getByText('Cargando campeonato…')).toHaveCount(0)
        await page.screenshot({path:`test-results/inicio-${width}.png`,fullPage:true})
      }
    }
  }
  expect(errors).toEqual([])
})

test('crear envía agenda individual sin escribir datos reales',async({page})=>{
  let created=false
  await page.route('**/rest/v1/rpc/get_match_control',route=>{
    expect(route.request().postDataJSON().p_match_id).toBe('simulated')
    return route.fulfill({json:{match:{id:'simulated',status:'PROGRAMADO',stage:'REGULAR',phase_elapsed_seconds:0,phase_started_at:null,paused_from_status:null,updated_at:new Date().toISOString(),home_team_id:'a',away_team_id:'b',tiebreak_winner_team_id:null},server_now:new Date().toISOString(),category:'Varones',matchday:3,home:'San Judas',away:'San Pablo',score:{home:0,away:0},goals:[]}})
  })
  await page.route('**/rest/v1/matches*',async route=>{
    if(route.request().method()==='POST') {
      const body=route.request().postDataJSON()
      expect(body.scheduled_date).toBe('2026-09-20')
      expect(body.scheduled_time).toBe('15:00')
      expect(body.stage).toBe('REGULAR')
      created=true
      return route.fulfill({json:{...body,id:'simulated'}})
    }
    return route.fulfill({json:[]})
  })
  await page.goto('/admin/crear')
  await page.getByRole('combobox',{name:'Categoría',exact:true}).selectOption({label:'Varones'})
  await page.getByRole('combobox',{name:'Jornada',exact:true}).selectOption({label:'Fecha 3'})
  await page.getByLabel('Fecha del partido',{exact:true}).fill('2026-09-20')
  await page.getByLabel('Hora (Tarija)',{exact:true}).fill('15:00')
  await page.getByRole('combobox',{name:'Equipo local',exact:true}).selectOption({label:'San Judas'})
  await page.getByRole('combobox',{name:'Equipo visitante',exact:true}).selectOption({label:'San Pablo'})
  await page.getByRole('button',{name:'Crear partido',exact:true}).click()
  await expect(page).toHaveURL(/\/admin\/partidos\/simulated$/)
  await expect(page.getByRole('heading',{name:'Control del partido'})).toBeVisible()
  await expect(page.getByRole('button',{name:'INICIAR PARTIDO',exact:true})).toBeDisabled()
  await expect(page.getByRole('dialog',{name:'CONTROL PREVIO DEL PARTIDO'})).toBeVisible()
  expect(created).toBe(true)
})

test('estadísticas válidas y reprogramación compartidas sin escrituras reales',async({page})=>{
  const item={match:{id:'m',category_id:'c',home_team_id:'a',away_team_id:'b',stage:'REGULAR',status:'FINALIZADO',updated_at:'2026-09-06T00:00:00Z',scheduled_date:'2026-09-13',scheduled_time:'15:00',tiebreak_winner_team_id:null},category:'Varones',matchday:3,home:'San Andrés',away:'San Martin',score:{home:1,away:0},goals:[{id:'g',team_id:'a',period_number:1,clock_seconds:39,voided_at:null},{id:'void',team_id:'b',period_number:2,clock_seconds:25,voided_at:'2026-09-06'}],resolved:true}
  const data={categories:[{id:'c',name:'Varones',qualified:[],regular_closed_at:null}],matchdays:[{id:'d',number:3,date:null}],matches:[item]}
  await page.route('**/rest/v1/**',async route=>{
    if(route.request().url().endsWith('/reschedule_match')) {
      expect(route.request().postDataJSON()).toEqual({p_match_id:'m',p_date:'2026-09-27',p_time:'16:30',p_expected_updated_at:item.match.updated_at})
      item.match.scheduled_date='2026-09-27';item.match.scheduled_time='16:30'
      return route.fulfill({json:item})
    }
    return route.fulfill({json:data})
  })
  await page.goto('/admin/calendario')
  await page.getByText('Estadísticas del partido',{exact:false}).click()
  await expect(page.getByText("1T 00:39",{exact:true})).toBeVisible()
  await expect(page.getByText("2T 00:25",{exact:true})).toHaveCount(0)
  await page.getByText('Editar fecha y hora',{exact:true}).click()
  await page.getByLabel('Fecha del partido',{exact:true}).fill('2026-09-27')
  await page.getByLabel('Hora (Tarija)',{exact:true}).fill('16:30')
  await page.getByRole('button',{name:'Guardar agenda'}).click()
  await expect(page.getByText(/27\/09\/2026/)).toBeVisible()
  await expect(page.getByRole('heading',{name:'Fecha 3',exact:true})).toBeVisible()
  await page.goto('/calendario')
  await page.getByText('Estadísticas del partido',{exact:false}).click()
  await expect(page.getByText("1T 00:39",{exact:true})).toBeVisible()
  await expect(page.getByText("2T 00:25",{exact:true})).toHaveCount(0)
  await expect(page.getByText('Editar fecha y hora',{exact:true})).toHaveCount(0)
})
