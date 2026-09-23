import { test, expect } from '@playwright/test'
import type { MatchEvent } from '../../src/lib/matchEvents'

for(const status of ['PRIMER_TIEMPO','FINALIZADO']) for(const type of ['GOAL','YELLOW_CARD','RED_CARD'] as const) test(`Control ${status}: editar y anular ${type} sin cambiar tiempo ni equipo`,async({page})=>{
  const time=new Date().toISOString()
  const players=[{id:'p',team_id:'a',full_name:'Jugador A',active:true,shirt_number:5},{id:'r',team_id:'a',full_name:'Jugador B',active:true,shirt_number:8},{id:'q',team_id:'b',full_name:'Rival',active:true,shirt_number:10}]
  const event:MatchEvent={id:'e',type,team_id:'a',player_id:'p',player_name:'Jugador A',shirt_number:5,period_number:1,clock_seconds:125}
  const data={match:{id:'m',home_team_id:'a',away_team_id:'b',status,stage:'REGULAR',phase_started_at:status==='FINALIZADO'?null:time,phase_elapsed_seconds:120,updated_at:time},home:'Local',away:'Visitante',category:'Varones',matchday:1,server_now:time,score:{home:type==='GOAL'?1:0,away:0},players,lineup:players,events:[event],goals:type==='GOAL'?[event]:[]}
  let edits=0,voids=0
  await page.route('**/rest/v1/**',route=>{
    const url=route.request().url(),body=route.request().postDataJSON()
    if(url.endsWith('/edit_match_event_player')) {
      expect(body).toEqual({p_match_id:'m',p_event_id:'e',p_player_id:'r',p_expected_player_id:'p'})
      edits++;event.player_id='r';event.player_name='Jugador B';event.shirt_number=8
      return route.fulfill({json:{event,control:data}})
    }
    if(url.endsWith('/void_match_event')) {voids++;event.voided_at=time;data.events=[];data.goals=[];data.score.home=0;return route.fulfill({json:{event,control:data}})}
    expect(url).toContain('/get_match_control');return route.fulfill({json:data})
  })
  await page.goto('/admin/partidos/m')
  const timeline=page.getByRole('list',{name:'Cronología del partido'})
  await timeline.getByRole('button').click()
  await page.getByRole('heading',{name:'Control del partido',exact:true}).click()
  await expect(page.getByRole('button',{name:'EDITAR',exact:true})).toHaveCount(0)
  await timeline.getByRole('button').click()
  await page.getByRole('button',{name:'EDITAR',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Editar jugador del evento'})
  await expect(dialog.getByRole('option',{name:/Rival/})).toHaveCount(0)
  await dialog.getByRole('button',{name:'#8 Jugador B',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  await expect(timeline).toContainText('Jugador B')
  await expect(timeline.locator('time')).toHaveText('1T 02:05')
  await expect(page.getByLabel('Marcador')).toHaveText(type==='GOAL'?'1 - 0':'0 - 0')
  if(type==='RED_CARD' && status!=='FINALIZADO') {
    await page.getByRole('button',{name:'GOL Local',exact:true}).click()
    const selector=page.getByRole('dialog', { name: 'Seleccionar jugador',exact:true})
    await expect(selector.getByRole('button',{name:'#5 Jugador A',exact:true})).toBeVisible()
    await expect(selector.getByRole('button',{name:'#8 Jugador B',exact:true})).toHaveCount(0)
    await selector.getByRole('button',{name:'Cancelar'}).click()
  }
  await timeline.getByRole('button').click()
  await page.getByRole('button',{name:'ANULAR',exact:true}).click()
  const confirm=page.getByRole('dialog',{name:'Anular evento'})
  await confirm.getByRole('button',{name:'Cancelar',exact:true}).click();expect(voids).toBe(0)
  await timeline.getByRole('button').click();await page.getByRole('button',{name:'ANULAR',exact:true}).click()
  await confirm.getByRole('button',{name:'Anular',exact:true}).click()
  await expect(timeline.getByRole('listitem')).toHaveCount(0)
  await expect(page.getByLabel('Marcador')).toHaveText('0 - 0')
  expect(edits).toBe(1);expect(voids).toBe(1);expect(data.match.status).toBe(status)
})
