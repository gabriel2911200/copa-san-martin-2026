import {test,expect} from '@playwright/test'

for(const width of [320,390,768,1280]) test(`Inicio agrupa sin duplicados y actualiza fases a ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:850})
  const now=new Date().toISOString()
  const match=(id:string,stage:string,category='Mujeres',status='PROGRAMADO')=>({
    match:{id,stage,category_id:category,home_team_id:id+'a',away_team_id:id+'b',status,updated_at:now,created_at:now,
      phase_started_at:null,phase_elapsed_seconds:30,paused_from_status:'SEGUNDO_TIEMPO',scheduled_date:null,scheduled_time:null},
    home:'Comunidad Santa Rosa '+id,away:'Comunidad Santa Rita '+id,category,matchday:2,server_now:now,score:{home:1,away:1},goals:[],events:[],resolved:false,
  })
  const first=match('s1','SEMIFINAL'),second=match('s2','SEMIFINAL'),old=match('old','REGULAR','Varones','FINALIZADO')
  const data={categories:[{id:'Mujeres',name:'Mujeres',regular_closed_at:null,qualified:[]},{id:'Varones',name:'Varones',regular_closed_at:null,qualified:[]}],
    matchdays:[{id:'d',number:2}],matches:[first,second,old,first]}
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  await page.route('**/rest/v1/**',route=>{
    expect(route.request().url()).toContain('get_tournament')
    return route.fulfill({json:data})
  })
  async function refresh(){await page.evaluate(async()=>{
    // @ts-expect-error Vite-served module; simulated notification, no remote writes.
    const {supabase}=await import('/src/lib/supabase.ts')
    for(const channel of supabase.getChannels())for(const binding of channel.bindings.postgres_changes??[])
      if(binding.filter.table==='matches')binding.callback({table:'matches',eventType:'UPDATE',new:{},old:{}})
  })}
  await page.goto('/')
  await expect(page.locator('.home-match-group > h2')).toHaveText(['FASE ELIMINATORIA · MUJERES'])
  await expect(page.locator('.match-card')).toHaveCount(2)
  await expect(page.locator('.match-meta > span:first-child')).toHaveText(['SEMIFINAL · MUJERES','SEMIFINAL · MUJERES'])
  await expect(page.getByRole('heading',{name:/últimos? resultados?|próximos partidos/i})).toHaveCount(0)
  await expect(page.getByText(old.home,{exact:true})).toHaveCount(0)
  const regulars=Array.from({length:5},(_,i)=>match('r'+i,'REGULAR','Varones'))
  data.matches.push(...regulars);await refresh()
  await expect(page.locator('.home-match-group > h2')).toHaveText(['FASE REGULAR · VARONES','FASE ELIMINATORIA · MUJERES'])
  await expect(page.locator('.match-card')).toHaveCount(7)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`test-results/home-upcoming-${width}.png`,fullPage:true})
  regulars[0].match.status='PRIMER_TIEMPO';first.match.status='PAUSADO';await refresh()
  const live=page.getByRole('region',{name:'Partidos en vivo',exact:true})
  await expect(live.locator('.match-card')).toHaveCount(2)
  await expect(live.locator('.match-meta').filter({hasText:'FASE REGULAR · VARONES'})).toHaveCount(1)
  await expect(live.locator('.match-meta').filter({hasText:'SEMIFINAL · MUJERES'})).toHaveCount(1)
  await expect(page.locator('.home-match-group .match-card')).toHaveCount(5)
  await expect(page.getByText(first.home,{exact:true})).toHaveCount(1)
  await expect(page.getByText(regulars[0].home,{exact:true})).toHaveCount(1)
  first.match.status='FINALIZADO';second.match.status='FINALIZADO'
  const final=match('final','FINAL'),third=match('third','THIRD_PLACE')
  data.matches.push(final,third);await refresh()
  const women=page.getByRole('region',{name:'FASE ELIMINATORIA · MUJERES',exact:true})
  await expect(women.locator('.match-meta > span:first-child')).toHaveText(['FINAL · MUJERES','TERCER PUESTO · MUJERES'])
  await expect(page.getByText(first.home,{exact:true})).toHaveCount(0)
  final.match.status='SEGUNDO_TIEMPO';third.match.status='PAUSADO';await refresh()
  await expect(live.locator('.match-meta').filter({hasText:'FINAL · MUJERES'})).toHaveCount(1)
  await expect(live.locator('.match-meta').filter({hasText:'TERCER PUESTO · MUJERES'})).toHaveCount(1)
  await expect(women).toHaveCount(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(await page.locator('.match-meta > span:first-child').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(12)
  await page.screenshot({path:`test-results/home-groups-${width}.png`,fullPage:true})
  for(const item of data.matches)item.match.status='FINALIZADO'
  await refresh()
  await expect(page.locator('.match-card')).toHaveCount(0)
  await expect(page.locator('.home-match-group')).toHaveCount(0)
  await expect(page.getByText(/No hay partidos en vivo ni programados pendientes/)).toBeVisible()
  // The duplicate fixture exercises Inicio only; Calendario keeps its existing contract.
  data.matches=[...new Map(data.matches.map(item=>[item.match.id,item])).values()]
  await page.goto('/calendario')
  await expect(page.getByText(old.home,{exact:true})).toBeVisible()
})
