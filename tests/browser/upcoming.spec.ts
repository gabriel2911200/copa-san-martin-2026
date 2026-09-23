import { test, expect } from '@playwright/test'

test('permite programar tres partidos seguidos sin abrir control previo', async ({ page }) => {
  const created: Record<string, string>[]=[]
  await page.route('**/rest/v1/**', route=>{
    const url=route.request().url()
    if(url.includes('/categories')) return route.fulfill({json:[{id:'c',name:'Varones'}]})
    if(url.includes('/matchdays')) return route.fulfill({json:[{id:'d',number:2}]})
    if(url.includes('/teams')) return route.fulfill({json:['a','b','c','d'].map(id=>({id,name:`Equipo ${id}`,category_id:'c',active:true}))})
    expect(url).toContain('/matches')
    if(route.request().method()==='POST') {
      const row=route.request().postDataJSON();expect(row.status).toBe('PROGRAMADO');created.push(row)
      return route.fulfill({json:{...row,id:`match-${created.length}`}})
    }
    return route.fulfill({json:[]})
  })
  await page.goto('/admin/crear')
  await page.getByRole('combobox',{name:'Categoría',exact:true}).selectOption('c')
  await page.getByRole('combobox',{name:'Jornada',exact:true}).selectOption('d')
  for(const away of ['b','c','d']) {
    await page.getByRole('combobox',{name:'Equipo local',exact:true}).selectOption('a')
    await page.getByRole('combobox',{name:'Equipo visitante',exact:true}).selectOption(away)
    await page.getByRole('button',{name:'Crear partido',exact:true}).click()
    await expect(page.getByText('Partido programado correctamente. Puedes crear otro partido.')).toBeVisible()
    await expect(page.getByRole('combobox',{name:'Equipo local',exact:true})).toHaveValue('')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/admin\/crear$/)
  }
  expect(created).toHaveLength(3)
})

test('Inicio muestra todos los programados ordenados y actualiza la lista por Realtime', async ({ page }) => {
  const now=new Date().toISOString()
  function match(id:string,date:string|null,time:string|null,status='PROGRAMADO') {
    return {match:{id,status,category_id:'c',home_team_id:'a',away_team_id:'b',stage:'REGULAR',scheduled_date:date,scheduled_time:time,updated_at:now,phase_started_at:null,phase_elapsed_seconds:0},home:`Local ${id}`,away:`Visitante ${id}`,category:'Mujeres',matchday:2,server_now:now,score:{home:0,away:0},goals:[],events:[]}
  }
  const data={categories:[],matchdays:[],matches:[match('late','2026-09-11','15:00'),match('unknown',null,null),match('second','2026-09-10','16:00'),match('first','2026-09-10','15:00'),match('live','2026-09-10','14:00','PRIMER_TIEMPO')]}
  await page.route('**/rest/v1/**',route=>{expect(route.request().url()).toContain('/get_tournament');return route.fulfill({json:data})})
  await page.goto('/')
  const upcoming=page.getByRole('region',{name:'FASE REGULAR · MUJERES'})
  await expect(upcoming.locator('.score-line p:first-child')).toHaveText(['Local first','Local second','Local late','Local unknown'])
  await expect(upcoming.locator('.match-meta')).toContainText(Array(4).fill('FASE REGULAR · MUJERES'))
  await expect(upcoming.locator('.match-meta')).toContainText(Array(4).fill('Fecha 2'))
  await expect(upcoming.locator('.schedule-line').first()).toContainText('10/09/2026 · 15:00')
  await expect(page.locator('.featured-match')).toContainText('Local live')
  data.matches[3].match.status='FINALIZADO'
  data.matches.push(match('new','2026-09-10','17:00'))
  await page.evaluate(async()=>{
    // @ts-expect-error Vite serves this module to the browser.
    const {supabase}=await import('/src/lib/supabase.ts')
    for(const channel of supabase.getChannels()) for(const binding of channel.bindings.postgres_changes??[])
      if(binding.filter.table==='matches') binding.callback({table:'matches',eventType:'UPDATE',new:{id:'first'},old:{}})
  })
  await expect(upcoming.locator('.score-line p:first-child')).toHaveText(['Local second','Local new','Local late','Local unknown'])
})
