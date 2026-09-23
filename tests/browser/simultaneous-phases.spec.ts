import { test, expect } from '@playwright/test'

function fixture(withSemis = true) {
  const now=new Date().toISOString()
  const match=(id:string,stage:string,categoryId:string,home:string,away:string)=>({
    match:{id,stage,category_id:categoryId,home_team_id:home,away_team_id:away,status:'PROGRAMADO',created_at:now,updated_at:now,scheduled_date:null as string|null,scheduled_time:null as string|null},
    home,away,category:categoryId==='w'?'Mujeres':'Varones',matchday:stage==='REGULAR'?3:5,server_now:now,score:{home:0,away:0},goals:[],resolved:false,
  })
  const semis=[match('sf1','SEMIFINAL','w','Equipo A','Equipo D'),match('sf2','SEMIFINAL','w','Equipo B','Equipo C')]
  return {semis,data:{categories:[{id:'w',name:'Mujeres',regular_closed_at:now,qualified:['A','B','C','D'].map(id=>({id,name:'Equipo '+id}))},
    {id:'v',name:'Varones',regular_closed_at:null,qualified:[]}],matchdays:[{id:'d',number:3,date:null}],
    matches:[...Array.from({length:5},(_,i)=>match('v'+i,'REGULAR','v','Local '+i,'Visita '+i)),...(withSemis?semis:[])]}}
}

test('cinco regulares y dos semifinales: Controlar, programación y únicas tarjetas en Inicio',async({page})=>{
  const {data}=fixture()
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  await page.route('**/rest/v1/**',route=>{
    if(route.request().url().endsWith('/reschedule_match')){
      const body=route.request().postDataJSON()
      expect(Object.keys(body).sort()).toEqual(['p_date','p_expected_updated_at','p_match_id','p_time'])
      const m=data.matches.find(m=>m.match.id===body.p_match_id)!
      m.match.scheduled_date=body.p_date;m.match.scheduled_time=body.p_time;m.match.updated_at=new Date().toISOString()
      return route.fulfill({json:m})
    }
    expect(route.request().url()).toContain('get_tournament')
    return route.fulfill({json:data})
  })
  await page.goto('/admin/controlar')
  await expect(page.getByText('FASE REGULAR · VARONES',{exact:true})).toHaveCount(5)
  await expect(page.getByText('SEMIFINAL 1 · MUJERES',{exact:true})).toHaveCount(1)
  await expect(page.getByText('SEMIFINAL 2 · MUJERES',{exact:true})).toHaveCount(1)
  const card=page.locator('section.surface').filter({has:page.getByRole('heading',{name:'Equipo A vs Equipo D',exact:true})})
  await card.getByText('PROGRAMAR',{exact:true}).click()
  await card.getByLabel('Fecha del partido').fill('2026-09-27')
  await card.getByLabel('Hora (Tarija)').fill('15:00')
  await card.getByRole('button',{name:'Guardar agenda'}).click()
  await expect(card.getByText('27/09/2026 · 15:00')).toBeVisible()
  await page.goto('/')
  await expect(page.locator('.match-card')).toHaveCount(7)
  await expect(page.getByText('SEMIFINAL · MUJERES',{exact:true})).toHaveCount(2)
  await expect(page.getByText(/27\/09\/2026 · 15:00/)).toBeVisible()
  const second=data.matches.find(m=>m.match.id==='sf2')!
  second.match.scheduled_date='2026-09-27';second.match.scheduled_time='16:00'
  await page.evaluate(async()=>{
    // @ts-expect-error Vite-served module in the browser.
    const {supabase}=await import('/src/lib/supabase.ts')
    for(const channel of supabase.getChannels())for(const binding of channel.bindings.postgres_changes??[]){
      if(binding.filter.table==='matches')binding.callback({table:'matches',eventType:'UPDATE',new:{id:'sf2'},old:{}})
    }
  })
  await expect(page.getByText(/27\/09\/2026 · 16:00/)).toBeVisible()
  await expect(page.locator('.match-card')).toHaveCount(7)
  await expect(page.locator('.match-meta').filter({hasText:'FASE REGULAR · VARONES'})).toHaveCount(5)
})

test('configurar cruces crea ambas semifinales sin usar Crear partido',async({page})=>{
  const {data,semis}=fixture(false)
  let creates=0
  await page.route('**/rest/v1/**',route=>{
    if(route.request().url().endsWith('/create_semifinals')) {
      creates++
      expect(route.request().postDataJSON()).toEqual({p_category_id:'w',p_home1:'A',p_away1:'D',p_home2:'B',p_away2:'C'})
      data.matches.push(...semis)
    } else expect(route.request().url()).toContain('get_tournament')
    return route.fulfill({json:data})
  })
  await page.goto('/admin/controlar')
  await expect(page.getByText('FASE REGULAR CERRADA · 4 CLASIFICADOS')).toBeVisible()
  await page.getByLabel('Equipo A',{exact:true}).selectOption('A')
  await page.getByLabel('Equipo B',{exact:true}).selectOption('D')
  await page.getByRole('button',{name:'Crear las dos semifinales'}).click()
  await expect(page.getByText('FASE REGULAR CERRADA · 4 CLASIFICADOS')).toHaveCount(0)
  await expect(page.getByText('SEMIFINAL 1 · MUJERES',{exact:true})).toHaveCount(1)
  await expect(page.getByText('SEMIFINAL 2 · MUJERES',{exact:true})).toHaveCount(1)
  expect(creates).toBe(1)
  await page.reload()
  await expect(page.getByText('FASE REGULAR CERRADA · 4 CLASIFICADOS')).toHaveCount(0)
  await expect(page.getByText('SEMIFINAL 1 · MUJERES',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Generar partidos de jornada 6'})).toHaveCount(0)
})

test('configuración independiente: Varones cierra y crea sus cruces después de Mujeres',async({page})=>{
  const {data,semis}=fixture()
  const men=data.categories.find(c=>c.id==='v')!
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  page.on('dialog',dialog=>dialog.accept())
  await page.route('**/rest/v1/**',route=>{
    const url=route.request().url()
    if(url.endsWith('/close_regular')){
      expect(route.request().postDataJSON()).toEqual({p_category_id:'v'})
      men.regular_closed_at=new Date().toISOString()
      men.qualified=['E','F','G','H'].map(id=>({id,name:'Equipo '+id}))
    }else if(url.endsWith('/create_semifinals')){
      expect(route.request().postDataJSON()).toEqual({p_category_id:'v',p_home1:'E',p_away1:'H',p_home2:'F',p_away2:'G'})
      data.matches.push(...semis.map((m,i)=>({...m,category:'Varones',home:i?'Equipo F':'Equipo E',away:i?'Equipo G':'Equipo H',match:{...m.match,id:'men-'+i,category_id:'v'}})))
    }else expect(url).toContain('get_tournament')
    return route.fulfill({json:data})
  })
  await page.goto('/admin/controlar')
  const setup=page.locator('#eliminatorias')
  await expect(setup.getByRole('heading',{name:'Varones',exact:true})).toBeVisible()
  await expect(setup.getByRole('heading',{name:'Mujeres',exact:true})).toHaveCount(0)
  await expect(setup.getByRole('combobox')).toHaveCount(0)
  await page.reload()
  await expect(setup.getByRole('heading',{name:'Mujeres',exact:true})).toHaveCount(0)
  await setup.getByRole('button',{name:'Cerrar fase regular'}).click()
  await expect(setup.locator('ol li')).toHaveCount(4)
  await expect(setup.getByRole('combobox')).toHaveCount(2)
  await expect(setup.getByRole('heading',{name:'Mujeres',exact:true})).toHaveCount(0)
  await setup.getByLabel('Equipo A',{exact:true}).selectOption('E')
  await setup.getByLabel('Equipo B',{exact:true}).selectOption('H')
  await setup.getByRole('button',{name:'Crear las dos semifinales'}).click()
  await expect(setup).toHaveCount(0)
  await page.reload()
  for(const category of ['MUJERES','VARONES'])for(const number of [1,2]){
    await expect(page.getByText(`SEMIFINAL ${number} · ${category}`,{exact:true})).toHaveCount(1)
  }
  await expect(setup).toHaveCount(0)
  const cards=page.locator('section.surface').filter({hasText:/SEMIFINAL [12] ·/})
  await expect(cards).toHaveCount(4)
  await expect(cards.getByRole('link',{name:'CONTROLAR PARTIDO',exact:true})).toHaveCount(4)
  await expect(cards.getByText('PROGRAMAR',{exact:true})).toHaveCount(4)
})

test('una semifinal no oculta el bloque; dos semifinales finalizadas sí lo ocultan',async({page})=>{
  const {data,semis}=fixture(false)
  data.matches.push(semis[0])
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  await page.route('**/rest/v1/**',route=>{
    expect(route.request().url()).toContain('get_tournament')
    return route.fulfill({json:data})
  })
  await page.goto('/admin/controlar')
  await expect(page.locator('#eliminatorias').getByRole('heading',{name:'Mujeres',exact:true})).toBeVisible()
  data.matches.push(semis[1])
  for(const m of semis)m.match.status='FINALIZADO'
  await page.reload()
  await expect(page.locator('#eliminatorias').getByRole('heading',{name:'Varones',exact:true})).toBeVisible()
  await expect(page.locator('#eliminatorias').getByRole('heading',{name:'Mujeres',exact:true})).toHaveCount(0)
})
