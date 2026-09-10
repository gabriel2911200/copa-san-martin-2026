import {test, expect} from '@playwright/test'
import type {MatchEvent, Precheck, FoulCount} from '../../src/lib/matchEvents'

const base = '2026-09-08T12:00:00Z'

test('arbitraje separa periodos, omite tarjetas revertidas y no repite equipamiento al final', async ({page}) => {
  const data=fixture()
  data.match.status='DESCANSO'
  data.precheck={home_ball:true,home_band:true,away_ball:false,away_band:true}
  data.events=[
    {id:'red',type:'RED_CARD',team_id:'b',player_name:'Roja primero',shirt_number:10,period_number:1},
    {id:'void',type:'YELLOW_CARD',team_id:'a',player_name:'Revertida',period_number:1,voided_at:base},
    {id:'second',type:'YELLOW_CARD',team_id:'a',player_name:'Amarilla segundo',shirt_number:5,period_number:2},
  ]
  await page.route('**/rest/v1/**',route=>route.fulfill({json:data}))
  await page.goto('/admin/partidos/m')
  const first=page.getByRole('dialog',{name:'ARBITRAJE'})
  await expect(first).toContainText('🟥 Tarjeta roja #10 Roja primero')
  await expect(first).toContainText('Sin balón')
  await expect(first).not.toContainText('Santa Ana')
  await expect(first).not.toContainText('Amarilla segundo')
  await expect(first).not.toContainText('Revertida')
  data.match.status='FINALIZADO'
  await page.reload()
  const second=page.getByRole('dialog',{name:'AVISO PENDIENTE'})
  await expect(second).toContainText('🟨 Tarjeta amarilla #5 Amarilla segundo')
  await expect(second).not.toContainText('Roja primero')
  await expect(second).not.toContainText('Sin balón')
  data.events[2].voided_at=base
  await page.reload()
  await expect(page.getByRole('heading',{name:'Control del partido'})).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('fallo de control previo conserva SI/NO y permite guardar sin actualizar ni mensajes técnicos', async ({page}) => {
  const data=fixture()
  let available=false
  await page.route('**/rest/v1/**', route=>{
    if(route.request().url().endsWith('/save_match_precheck')) {
      if(!available) return route.fulfill({status:404,json:{code:'PGRST202',message:'Missing function'}})
      data.precheck={home_ball:true,home_band:false,away_ball:true,away_band:false}
    }
    return route.fulfill({json:data})
  })
  await page.goto('/admin/partidos/m')
  const dialog=page.getByRole('dialog',{name:'CONTROL PREVIO DEL PARTIDO'})
  await expect(dialog).toBeVisible()
  const groups=dialog.getByRole('group')
  for(let i=0;i<4;i++) await groups.nth(i).getByRole('button',{name:i%2===0?'SI':'NO',exact:true}).click()
  await dialog.getByRole('button',{name:'Guardar control previo'}).click()
  await expect(dialog.getByRole('alert')).toContainText('Vuelve a guardar')
  await expect(page.getByRole('button',{name:'Actualizar partido'})).toHaveCount(0)
  await expect(dialog).not.toContainText('migración')
  await expect(dialog.locator('button[aria-pressed=true]')).toHaveText(['SI','NO','SI','NO'])
  available=true
  await dialog.getByRole('button',{name:'Guardar control previo'}).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('status').filter({hasText:'Control previo guardado correctamente'})).toBeVisible()
})
function fixture() {
  const players = [{id:'p',team_id:'a',full_name:'Juan Pérez',active:true},{id:'q',team_id:'b',full_name:'Pedro Gómez',active:true}]
  return {
    match:{id:'m',category_id:'c',home_team_id:'a',away_team_id:'b',stage:'REGULAR',status:'PROGRAMADO',paused_from_status:null,
      phase_elapsed_seconds:0,phase_started_at:null as string|null,updated_at:base,tiebreak_winner_team_id:null},
    home:'Santa Ana',away:'Santa Lucía',category:'Varones',matchday:1,server_now:base,
    score:{home:0,away:0},goals:[] as MatchEvent[],events:[] as MatchEvent[],fouls:[] as FoulCount[],
    precheck:null as Precheck|null,players,lineup:players.map((p,i)=>({...p,shirt_number:i===0?5:10})),
  }
}

for (const failure of ['stale', 'lost-response']) test(`control previo recupera ${failure} sin actualizar manualmente`, async ({page}) => {
  const data = fixture()
  let saves = 0
  await page.route('**/rest/v1/**', route => {
    if (route.request().url().endsWith('/save_match_precheck')) {
      saves++
      if (saves === 1) {
        data.match.updated_at = '2026-09-08T12:01:00Z'
        if (failure === 'lost-response') {
          data.precheck = {home_ball:true,home_band:true,away_ball:true,away_band:true}
          return route.fulfill({status:503,json:{message:'Respuesta perdida'}})
        }
        return route.fulfill({status:400,json:{code:'P0001',message:'El partido cambió. Actualiza antes de guardar.'}})
      }
      expect(route.request().postDataJSON().p_expected_updated_at).toBe(data.match.updated_at)
      data.precheck = {home_ball:true,home_band:true,away_ball:true,away_band:true}
    }
    return route.fulfill({json:data})
  })
  await page.goto('/admin/partidos/m')
  const dialog = page.getByRole('dialog',{name:'CONTROL PREVIO DEL PARTIDO'})
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button',{name:'SI',exact:true})).toHaveCount(4)
  for (const button of await dialog.getByRole('button',{name:'SI',exact:true}).all()) await button.click()
  await dialog.getByRole('button',{name:'Guardar control previo'}).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('status').filter({hasText:'Control previo guardado correctamente'})).toBeVisible()
  expect(saves).toBe(2)
  data.match.status = 'DESCANSO'
  data.events = []
  await page.reload()
  await expect(page.getByRole('button',{name:'Finalizar descanso e iniciar segundo tiempo'})).toBeVisible()
  await expect(page.getByRole('dialog',{name:'ARBITRAJE'})).toHaveCount(0)
})

test('control previo persistido, cobros por periodo, roja sin pausa y doble amarilla solo en partido',async({page})=>{
  const data=fixture()
  await page.clock.install({time:new Date(base)})
  await page.route('**/rest/v1/**',async route=>{
    const body=route.request().postDataJSON(), url=route.request().url()
    data.server_now=await page.evaluate(()=>new Date().toISOString())
    if(url.endsWith('/save_match_precheck')) {
      expect(body).toMatchObject({p_match_id:'m',p_home_ball:true,p_home_band:true,p_away_ball:false,p_away_band:false})
      data.precheck={home_ball:true,home_band:true,away_ball:false,away_band:false}
    } else if(url.endsWith('/control_match')) {
      expect(data.precheck).not.toBeNull()
      data.match.status=({START:'PRIMER_TIEMPO',BREAK:'DESCANSO',SECOND_HALF:'SEGUNDO_TIEMPO',FINISH:'FINALIZADO'} as Record<string,string>)[body.p_action]
      data.match.phase_elapsed_seconds=0
      data.match.phase_started_at=data.match.status==='FINALIZADO'?null:data.server_now
    } else if(url.endsWith('/record_match_event')) {
      const player=data.lineup.find(p=>p.id===body.p_player_id)!
      const event:MatchEvent={id:String(data.events.length+1),team_id:body.p_team_id,type:body.p_type,
        player_id:player.id,player_name:player.full_name,shirt_number:player.shirt_number,
        period_number:data.match.status==='SEGUNDO_TIEMPO'?2:1,clock_seconds:5}
      data.events.push(event)
      if(event.type==='GOAL'){data.goals.push(event);data.score.home++}
      return route.fulfill({json:{event,control:data}})
    } else expect(url).toContain('/get_match_control')
    return route.fulfill({json:data})
  })
  await page.goto('/admin/partidos/m')
  const check=page.getByRole('dialog',{name:'CONTROL PREVIO DEL PARTIDO'})
  await expect(check).toBeVisible()
  await expect(check.getByRole('button',{name:'Guardar control previo'})).toBeDisabled()
  for(const team of ['Santa Ana','Santa Lucía']) {
    const section=check.getByRole('region',{name:team})
    for(const question of ['⚽ ¿Tiene balón?','🎽 ¿Tiene cintillo?'])
      await section.getByRole('group',{name:question}).getByRole('button',{name:team==='Santa Ana'?'SI':'NO',exact:true}).click()
  }
  await check.getByRole('button',{name:'Guardar control previo'}).click()
  await expect(check).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button',{name:'INICIAR PARTIDO'})).toBeEnabled()
  await expect(check).toHaveCount(0)
  await page.getByRole('button',{name:'INICIAR PARTIDO'}).click()
  async function card(action:string,team:string,player:string) {
    await page.getByRole('button',{name:`${action} ${team}`,exact:true}).click()
    await page.getByRole('region',{name:'Seleccionar jugador'}).getByRole('button',{name:player,exact:true}).click()
  }
  await card('GOL','Santa Ana','#5 Juan Pérez')
  await card('AMARILLA','Santa Ana','#5 Juan Pérez')
  await page.getByRole('button',{name:'Terminar primer tiempo',exact:true}).click()
  const reminder=page.getByRole('dialog',{name:'ARBITRAJE'})
  await expect(reminder).toContainText('Santa Lucía')
  await expect(reminder).toContainText('Sin balón')
  await expect(reminder).toContainText('Sin cintillo')
  await expect(reminder).toContainText('🟨 Tarjeta amarilla #5 Juan Pérez')
  await reminder.getByRole('button',{name:'Entendido'}).click()
  await page.getByRole('button',{name:'Finalizar descanso e iniciar segundo tiempo'}).click()
  await page.clock.runFor(800)
  await card('AMARILLA','Santa Ana','#5 Juan Pérez')
  await page.getByText('JUGADORES',{exact:true}).click()
  await expect(page.getByRole('region',{name:'Convocatoria de Santa Ana',exact:true}).getByText('#5 Juan Pérez',{exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'GOL Santa Ana',exact:true}).click()
  await expect(page.getByRole('region',{name:'Seleccionar jugador'}).getByRole('button',{name:'#5 Juan Pérez',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Cancelar selección'}).click()
  const started=data.match.phase_started_at
  await card('ROJA','Santa Lucía','#10 Pedro Gómez')
  expect(data.match.phase_started_at).toBe(started)
  expect(data.match.status).toBe('SEGUNDO_TIEMPO')
  const before=await page.getByRole('timer',{name:'Tiempo de la fase'}).textContent()
  await page.clock.runFor(2000)
  await expect(page.getByRole('timer',{name:'Tiempo de la fase'})).not.toHaveText(before!)
  expect(data.players.every(p=>p.active)).toBe(true)
  await page.getByRole('button',{name:'FINALIZAR PARTIDO',exact:true}).click()
  const finalReminder=page.getByRole('dialog',{name:'AVISO PENDIENTE'})
  await expect(finalReminder).toBeVisible()
  await expect(finalReminder).toContainText('🟨 Tarjeta amarilla #5 Juan Pérez')
  await expect(finalReminder).toContainText('🟥 Tarjeta roja #10 Pedro Gómez')
  await expect(finalReminder).not.toContainText('Sin balón')
  await expect(finalReminder).not.toContainText('Sin cintillo')
  await expect(finalReminder.getByText('🟨 Tarjeta amarilla #5 Juan Pérez',{exact:true})).toHaveCount(1)
  await expect(page.getByLabel('Marcador')).toHaveText('1 - 0')
})

test('público: contadores compactos, alerta de tiro libre y tarjetas por equipo sin cobros',async({page})=>{
  const data=fixture(); data.match.status='SEGUNDO_TIEMPO';data.match.phase_started_at=base
  data.precheck={home_ball:false,home_band:false,away_ball:true,away_band:true}
  data.fouls=[{team_id:'a',period_number:1,count:9},{team_id:'a',period_number:2,count:5}]
  data.events=[{id:'old',type:'FOUL',team_id:'a',period_number:1},
    ...[1,2].map(n=>({id:`y${n}`,type:'YELLOW_CARD' as const,team_id:'a',player_id:'p',player_name:'Juan Pérez',shirt_number:5,period_number:n})),
    {id:'r',type:'RED_CARD',team_id:'b',player_id:'q',player_name:'Pedro Gómez',shirt_number:10,period_number:2}]
  await page.route('**/rest/v1/**',route=>{expect(route.request().url()).toContain('/get_tournament');return route.fulfill({json:{categories:[],matchdays:[{id:'d',number:1}],matches:[data]}})})
  await page.goto('/')
  await expect(page.getByLabel('Faltas acumuladas').getByText('Santa Ana: 5 faltas')).toHaveClass('fouls-yellow')
  data.fouls[1].count=6
  await page.reload()
  await expect(page.getByLabel('Faltas acumuladas').getByText(/Santa Ana: 6 faltas/)).toHaveClass('fouls-red')
  await expect(page.getByText('TIRO LIBRE SIN BARRERA')).toBeVisible()
  await expect(page.getByRole('region',{name:'Estadísticas del partido',exact:true})).toBeVisible()
  data.match.status='FINALIZADO';data.match.phase_started_at=null
  await page.goto('/calendario')
  await page.getByText('Estadísticas del partido',{exact:false}).click()
  await expect(page.locator('.match-details').getByRole('heading',{name:'Santa Ana',exact:true})).toHaveCount(0)
  await expect(page.locator('.timeline-home').filter({hasText:'Expulsado por doble amarilla'})).toContainText('Expulsado por doble amarilla')
  const direct=page.locator('.timeline-away')
  await expect(direct).toContainText('🟥 #10 Pedro Gómez')
  await expect(direct).not.toContainText('Expulsado')
  await expect(page.locator('.match-details').getByLabel('Faltas acumuladas')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

