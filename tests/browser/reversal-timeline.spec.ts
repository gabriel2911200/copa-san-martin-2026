import {test,expect} from '@playwright/test'
import type {MatchEvent} from '../../src/lib/matchEvents'

test('equipos: TODOS conserva edición y categorías filtran sin desplegable', async ({page}) => {
  const teams = [{id:'a',category_id:'w',name:'Local mujeres',active:true},{id:'b',category_id:'m',name:'Local varones',active:true}]
  await page.route('**/rest/v1/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/categories')) return route.fulfill({json:[{id:'m',name:'Varones'},{id:'w',name:'Mujeres'}]})
    expect(url.pathname).toContain('/teams')
    const category = url.searchParams.get('category_id')?.replace('eq.','')
    if (route.request().method() === 'PATCH') {
      expect(category).toBe('w')
      Object.assign(teams[0],route.request().postDataJSON())
      return route.fulfill({json:teams[0]})
    }
    return route.fulfill({json:teams.filter(t=>!category || t.category_id === category)})
  })
  await page.goto('/admin/equipos')
  await expect(page.locator('.category-tabs button')).toHaveText(['TODOS','MUJERES','VARONES'])
  await page.getByRole('button',{name:'Editar Local mujeres',exact:true}).click()
  await page.getByLabel('Editar nombre').fill('Mujeres actualizado')
  await page.getByRole('button',{name:'Guardar',exact:true}).click()
  await expect(page.getByText('Mujeres actualizado',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'MUJERES',exact:true}).click()
  await expect(page.getByText('Local varones',{exact:true})).toHaveCount(0)
  await expect(page.getByLabel('Nuevo equipo')).toBeEnabled()
  await page.getByRole('button',{name:'VARONES',exact:true}).click()
  await expect(page.getByText('Local varones',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'TODOS',exact:true}).click()
  await expect(page.getByText('Mujeres actualizado',{exact:true})).toBeVisible()
  await expect(page.getByRole('combobox')).toHaveCount(0)
})

function fixture(id='m',status='PRIMER_TIEMPO') {
  const time=new Date().toISOString()
  const players=[{id:'p',team_id:'a',full_name:'Juan Pérez',active:true},{id:'q',team_id:'b',full_name:'Pedro Gómez',active:true}]
  return {match:{id,status,stage:'REGULAR',category_id:'c',home_team_id:'a',away_team_id:'b',updated_at:time,
    phase_started_at:status==='FINALIZADO'?null:time as string|null,phase_elapsed_seconds:515,paused_from_status:null as string|null,
    timeout_started_at:null as string|null,timeout_team_id:null as string|null,scheduled_date:'2026-09-08',scheduled_time:'15:00',tiebreak_winner_team_id:null},
    category:'Varones',matchday:1,home:'Santa Ana',away:'Santa Lucía',server_now:time,score:{home:0,away:0},goals:[] as MatchEvent[],events:[] as MatchEvent[],players,lineup:players.map((p,i)=>({...p,shirt_number:i===0?5:10}))}
}

for(const publicView of [false,true]) test(`${publicView?'Inicio público':'Control'}: cronología compacta con Realtime sin duplicados`,async({page})=>{
  const data=fixture()
  await page.route('**/rest/v1/**',route=>{
    expect(route.request().url()).toContain(publicView?'/get_tournament':'/get_match_control')
    return route.fulfill({json:publicView?{categories:[],matchdays:[],matches:[data]}:data})
  })
  await page.goto(publicView?'/':'/admin/partidos/m')
  const stats=page.getByRole('region',{name:publicView?'Estadísticas del partido':'Estadísticas del partido en vivo',exact:true})
  await expect(stats).toBeVisible()
  data.events=[
    {id:'g',team_id:'a',type:'GOAL',player_name:'Juan Pérez',shirt_number:5,period_number:1,clock_seconds:180},
    {id:'y',team_id:'b',type:'YELLOW_CARD',player_name:'Pedro Gómez',shirt_number:10,period_number:1,clock_seconds:300},
    {id:'t',team_id:'a',type:'TIMEOUT',period_number:1,clock_seconds:600},
    {id:'r',team_id:'a',type:'RED_CARD',player_name:'Juan Pérez',shirt_number:5,period_number:2,clock_seconds:500},
    {id:'f',team_id:'b',type:'FOUL',period_number:1,clock_seconds:1},
  ]
  data.goals=[data.events[0]];data.score.home=1
  async function notify() {
    await page.evaluate(async()=>{
      const {supabase}=await import('/src/lib/supabase.ts')
      for(const channel of supabase.getChannels()) for(const binding of channel.bindings.postgres_changes??[])
        if(binding.filter.table==='match_events')binding.callback({table:'match_events',eventType:'INSERT',new:{id:'g',match_id:'m'},old:{}})
    })
  }
  await notify()
  await expect(stats.locator('time')).toHaveText(publicView ? ['1T 03:00','1T 05:00','2T 08:20'] : ['1T 03:00','1T 05:00','1T 10:00','2T 08:20'])
  await expect(stats.getByRole('listitem')).toHaveCount(publicView ? 3 : 4)
  await expect(stats.getByText('⚽ #5 Juan Pérez')).toBeVisible()
  await expect(stats.getByText('🟨 #10 Pedro Gómez')).toBeVisible()
  await expect(stats.getByText('⏸ Minuto',{exact:true})).toHaveCount(publicView ? 0 : 1)
  await expect(stats.getByText('🟥 #5 Juan Pérez')).toBeVisible()
  await expect(stats.getByRole('button',{name:'Revertir evento'})).toHaveCount(0)
  await notify()
  await expect(stats.getByRole('listitem')).toHaveCount(publicView ? 3 : 4)
  await expect(stats).not.toContainText('Santa Ana')
  await expect(stats).not.toContainText('Santa Lucía')
  for (const width of [390,1280]) {
    await page.setViewportSize({width,height:844})
    for (const side of ['home','away']) {
      const row=stats.locator(`.timeline-${side}`).first()
      const time=await row.locator('time').boundingBox()
      const action=await row.locator('.timeline-event').boundingBox()
      expect(time!.y+time!.height).toBeLessThanOrEqual(action!.y)
      expect(Math.abs(time!.x-action!.x)).toBeLessThan(1)
      await expect(row.locator('time')).toHaveCSS('text-align',side === 'home' ? 'left' : 'right')
    }
  }
  if(publicView) {
    await expect(stats.getByRole('button')).toHaveCount(0)
    await expect(stats.getByRole('heading',{name:'Santa Ana',exact:true})).toHaveCount(0)
    await expect(stats.getByLabel('Faltas acumuladas')).toHaveCount(0)
    const fouls=await page.getByLabel('Faltas acumuladas').boundingBox()
    const score=await page.locator('.score-line').boundingBox()
    expect(fouls!.y+fouls!.height).toBeLessThanOrEqual(score!.y)
  } else {
    await stats.getByRole('button',{name:'Opciones de ⚽ Gol Juan Pérez'}).click()
    await expect(stats.getByRole('button',{name:'Revertir evento'})).toBeVisible()
  }
})

test('revertir roja recupera jugador; revertir minuto reanuda reloj y devuelve solicitud',async({page})=>{
  const data=fixture();let calls=0
  await page.clock.install()
  await page.route('**/rest/v1/**',async route=>{
    const url=route.request().url(),body=route.request().postDataJSON()
    data.server_now=await page.evaluate(()=>new Date().toISOString())
    if(url.endsWith('/record_match_event')) {
      const type=body.p_type
      const event:MatchEvent={id:String(++calls),type,team_id:'a',period_number:1,clock_seconds:515,
        ...(type==='RED_CARD'?{player_id:'p',player_name:'Juan Pérez',shirt_number:5}:{})}
      data.events.push(event)
      if(type==='TIMEOUT') Object.assign(data.match,{status:'TIEMPO_MUERTO',paused_from_status:'PRIMER_TIEMPO',phase_started_at:null,timeout_started_at:data.server_now,timeout_team_id:'a'})
      return route.fulfill({json:{event,control:data}})
    }
    if(url.endsWith('/control_match')) {
      expect(body.p_action).toBe('END_TIMEOUT')
      Object.assign(data.match,{status:'PRIMER_TIEMPO',paused_from_status:null,phase_started_at:data.server_now,timeout_started_at:null,timeout_team_id:null})
      return route.fulfill({json:data})
    }
    if(url.endsWith('/void_match_event')) {
      const event=data.events.find(e=>e.id===body.p_event_id)!
      event.voided_at=data.server_now
      if(event.type==='TIMEOUT') Object.assign(data.match,{status:'PRIMER_TIEMPO',paused_from_status:null,phase_started_at:data.server_now,timeout_started_at:null,timeout_team_id:null})
      return route.fulfill({json:{event,control:data}})
    }
    expect(url).toContain('/get_match_control');return route.fulfill({json:data})
  })
  await page.goto('/admin/partidos/m')
  const started=data.match.phase_started_at
  await page.getByRole('button',{name:'ROJA Santa Ana',exact:true}).click()
  await page.getByRole('button',{name:'#5 Juan Pérez',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'🟥 Roja registrado.'})).toBeVisible()
  expect(data.match.phase_started_at).toBe(started)
  await expect(page.getByRole('button',{name:'PAUSAR',exact:true})).toBeEnabled()
  await page.getByText('JUGADORES',{exact:true}).click()
  const lineup=page.getByRole('region',{name:'Convocatoria de Santa Ana',exact:true})
  await expect(lineup.getByText('#5 Juan Pérez',{exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Opciones de 🟥 Roja Juan Pérez',exact:true}).click()
  await page.getByRole('button',{name:'Revertir evento',exact:true}).click()
  await expect(lineup.getByText('#5 Juan Pérez',{exact:true})).toBeVisible()
  expect(data.players[0].active).toBe(true)
  await page.getByRole('button',{name:'MINUTO LOCAL',exact:true}).click()
  await expect(page.getByRole('timer',{name:'Tiempo de la fase'})).toHaveText('08:35')
  await expect(page.getByRole('timer',{name:'Contador de minuto'})).toBeVisible()
  await page.getByRole('button',{name:'Opciones de ⏸ Minuto',exact:true}).click()
  await page.getByRole('button',{name:'Revertir evento',exact:true}).click()
  await expect(page.getByRole('timer',{name:'Contador de minuto'})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'MINUTO LOCAL',exact:true})).toBeEnabled()
  await expect(page.getByRole('button',{name:'PAUSAR',exact:true})).toBeEnabled()
  await expect(page.getByRole('heading',{name:'Goles válidos'})).toHaveCount(0)
  await expect(page.getByRole('button',{name:/ANULAR/})).toHaveCount(0)
})

test('Controlar lista pendientes y activos; Calendario solo finalizados con cronología y reversión',async({page})=>{
  const live=fixture('live'),pending=fixture('pending','PROGRAMADO'),done=fixture('done','FINALIZADO')
  done.home='Local final';done.away='Visitante final'
  done.events=[{id:'r',type:'RED_CARD',team_id:'a',player_id:'p',player_name:'Juan Pérez',shirt_number:5,period_number:2,clock_seconds:500},
    {id:'g',type:'GOAL',team_id:'a',player_id:'p',player_name:'Juan Pérez',shirt_number:5,period_number:1,clock_seconds:180},
    {id:'y',type:'YELLOW_CARD',team_id:'b',player_id:'q',player_name:'Pedro Gómez',shirt_number:10,period_number:1,clock_seconds:300},
    {id:'t',type:'TIMEOUT',team_id:'a',period_number:1,clock_seconds:600},
    {id:'f',type:'FOUL',team_id:'b',period_number:1,clock_seconds:1}]
  done.goals=[done.events[1]];done.score.home=1
  let reversions=0
  await page.route('**/rest/v1/**',route=>{
    if(route.request().url().endsWith('/void_match_event')) {
      const body=route.request().postDataJSON();expect(body).toEqual({p_match_id:'done',p_event_id:'g'})
      const event=done.events.find(e=>e.id==='g')!;event.voided_at=new Date().toISOString();done.goals=[];done.score.home=0;reversions++
      return route.fulfill({json:{event,control:done}})
    }
    expect(route.request().url()).toContain('/get_tournament')
    return route.fulfill({json:{categories:[],matchdays:[{id:'d',number:1}],matches:[live,pending,done]}})
  })
  await page.goto('/admin/controlar')
  await expect(page.getByRole('link',{name:'CONTROLAR PARTIDO',exact:true})).toHaveCount(2)
  await expect(page.getByRole('link',{name:'CONTROLAR PARTIDO',exact:true}).first()).toHaveAttribute('href','/admin/partidos/live')
  await expect(page.getByText('Local final vs Visitante final')).toHaveCount(0)
  await page.goto('/admin/calendario')
  await expect(page.locator('.match-card')).toHaveCount(1)
  await page.getByText('Estadísticas del partido',{exact:false}).click()
  const timeline=page.getByRole('list',{name:'Cronología del partido'})
  await expect(timeline.locator('time')).toHaveText(['1T 03:00','1T 05:00','1T 10:00','2T 08:20'])
  await expect(timeline.getByText(/Local final|Visitante final/)).toHaveCount(0)
  await expect(timeline.getByText(/Falta/)).toHaveCount(0)
  await expect(timeline.locator('.timeline-away')).toContainText('🟨 #10 Pedro Gómez')
  await timeline.getByRole('button',{name:'Opciones de ⚽ Gol Juan Pérez',exact:true}).click()
  await timeline.getByRole('button',{name:'Revertir evento',exact:true}).click()
  await expect(timeline.getByText('⚽ #5 Juan Pérez')).toHaveCount(0)
  await expect(page.locator('.score-line strong')).toHaveText('0 - 0')
  expect(reversions).toBe(1)
  expect(done.events.find(e=>e.id==='g')?.voided_at).toBeTruthy()
  await page.goto('/calendario')
  await page.getByText('Estadísticas del partido',{exact:false}).click()
  await expect(page.getByRole('button',{name:/Opciones de/})).toHaveCount(0)
})

test('goleadores filtra automáticamente con botones y solo destaca la primera fila',async({page})=>{
  const requests:(string|null)[]=[]
  await page.route('**/rest/v1/**',route=>{
    if(route.request().url().includes('/categories'))return route.fulfill({json:[{id:'w',name:'Mujeres'},{id:'m',name:'Varones'}]})
    expect(route.request().url()).toContain('/get_top_scorers')
    requests.push(route.request().postDataJSON().p_category_id)
    return route.fulfill({json:[{position:1,player_id:'p',player_name:'Juan',team_name:'Local',goals:4},{position:2,player_id:'q',player_name:'Pedro',team_name:'Visitante',goals:2},...Array.from({length:5},(_,i)=>({position:i+3,player_id:`extra-${i}`,player_name:`Jugador ${i+3}`,team_name:'Local',goals:1}))]})
  })
  await page.goto('/goleadores')
  await expect(page.getByRole('heading',{name:'TOP 5 GOLEADORES'})).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(5)
  await expect(page.getByText('Jugador 6',{exact:true})).toHaveCount(0)
  await expect(page.locator('.category-tabs button')).toHaveText(['TODOS','MUJERES','VARONES'])
  await expect(page.locator('tr.qualification-zone')).toHaveCount(1)
  await expect(page.locator('tr.qualification-zone')).toContainText('Juan')
  await page.getByRole('button',{name:'MUJERES',exact:true}).click()
  await expect.poll(()=>requests.at(-1)).toBe('w')
  await page.getByRole('button',{name:'VARONES',exact:true}).click()
  await expect.poll(()=>requests.at(-1)).toBe('m')
  await page.getByRole('button',{name:'TODOS',exact:true}).click()
  await expect.poll(()=>requests.at(-1)).toBeNull()
  const beforeRefresh=requests.length
  await page.evaluate(async()=>{
    const {supabase}=await import('/src/lib/supabase.ts')
    for(const channel of supabase.getChannels()) for(const binding of channel.bindings.postgres_changes??[])
      if(binding.filter.table==='player_initial_goals') binding.callback({table:'player_initial_goals',eventType:'INSERT',new:{player_id:'p'},old:{}})
  })
  await expect.poll(()=>requests.length).toBeGreaterThan(beforeRefresh)
  await expect(page.locator('tbody tr')).toHaveCount(5)
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await expect(page.getByRole('button',{name:/Actualizar/})).toHaveCount(0)
})

