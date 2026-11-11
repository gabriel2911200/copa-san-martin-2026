import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

async function setup(page:Page, status='PRIMER_TIEMPO') {
  const now=new Date().toISOString()
  const data={match:{id:'m',category_id:'c',home_team_id:'h',away_team_id:'a',stage:'FRIENDLY',friendly_penalties:true,status,paused_from_status:null as string|null,phase_elapsed_seconds:50,phase_started_at:now as string|null,updated_at:now,tiebreak_winner_team_id:null as string|null,period_duration_seconds:900},home:'Santa Rita',away:'Santa Ana',category:'Mujeres',matchday:1,server_now:now,score:{home:0,away:0},goals:[],events:[],lineup:[] as {id:string;team_id:string;shirt_number:number;full_name:string;active:boolean;used:boolean}[],players:[{id:'p',team_id:'h',full_name:'Juan',active:true},{id:'q',team_id:'h',full_name:'Pedro',active:true},{id:'r',team_id:'a',full_name:'Carlos',active:true}],shootout:null as null|{first_team_id:string;next_team_id:string|null;revision:number;completed_at:string|null;winner_team_id:string|null;score:{home:number;away:number};attempts:{id:string;team_id:string;sequence:number;converted:boolean;request_id:string;created_at:string;updated_at:string;voided_at:null}[]}}
  let catalog=[{seconds:900,built_in:true},{seconds:1200,built_in:true}]
  const actions:string[]=[]
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  await page.route('**/rest/v1/**',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1)
    if(name==='duration_options') return route.fulfill({json:catalog})
    const body=route.request().postDataJSON()
    if(name==='set_match_player') {
      const player=data.players.find(p=>p.id===body.p_player_id)!
      data.lineup=[...data.lineup.filter(p=>p.id!==player.id),{...player,shirt_number:body.p_shirt_number,used:false}]
    }
    if(name==='control_match') {actions.push(body.p_action);data.match.status=body.p_action==='BREAK'?'DESCANSO':body.p_action==='SECOND_HALF'?'SEGUNDO_TIEMPO':'FINALIZADO'}
    if(name==='set_match_duration') data.match.period_duration_seconds=body.p_seconds
    if(name==='manage_duration') {catalog=body.p_remove?catalog.filter(o=>o.seconds!==body.p_seconds):[...catalog,{seconds:body.p_seconds,built_in:false}];return route.fulfill({json:null})}
    if(name==='manage_penalty_shootout') {actions.push(body.p_action);data.shootout!.completed_at=now;data.shootout!.winner_team_id='h';data.match.status='FINALIZADO'}
    return route.fulfill({json:data})
  })
  return {data,actions}
}

test('confirmaciones cancelan sin escribir y no duplican transiciones',async({page})=>{
  const {actions}=await setup(page)
  await page.goto('/admin/partidos/m')
  await page.getByRole('button',{name:'Terminar primer tiempo',exact:true}).click()
  await expect(page.getByRole('dialog')).toContainText('Santa Rita')
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  expect(actions).toEqual([])
  await page.getByRole('button',{name:'Terminar primer tiempo',exact:true}).click()
  await page.getByRole('button',{name:'CONFIRMAR',exact:true}).click()
  await expect(page.getByRole('button',{name:'Finalizar descanso e iniciar segundo tiempo',exact:true})).toBeVisible()
  expect(actions).toEqual(['BREAK'])
})

test('dorsal cero, traslado automático, edición, cancelación y duplicado sin bloqueo',async({page})=>{
  const {data}=await setup(page)
  await page.goto('/admin/partidos/m')
  await page.locator('summary.lineup-toggle').click()
  await expect(page.locator('details.match-lineup')).toHaveAttribute('open','')
  const team=page.getByRole('region',{name:'Convocatoria de Santa Rita'})
  await team.getByLabel('Jugador',{exact:true}).selectOption('p')
  await team.getByRole('button',{name:'AÑADIR DORSAL',exact:true}).last().click()
  await page.getByRole('dialog').getByRole('spinbutton').fill('0')
  await page.getByRole('button',{name:'GUARDAR',exact:true}).click()
  await expect(team.getByLabel('Jugador',{exact:true}).locator('option')).toHaveCount(2)
  await team.getByRole('button',{name:'EDITAR DORSAL',exact:true}).first().click()
  await team.getByLabel('Jugador',{exact:true}).selectOption('p')
  await expect(team).toContainText('Dorsal actual: 0')
  await team.getByRole('button',{name:'EDITAR DORSAL',exact:true}).last().click()
  await page.getByRole('dialog').getByRole('spinbutton').fill('8')
  await page.getByRole('button',{name:'GUARDAR',exact:true}).click()
  await team.getByLabel('Jugador',{exact:true}).selectOption('p')
  await team.getByRole('button',{name:'EDITAR DORSAL',exact:true}).last().click()
  await page.getByRole('dialog').getByRole('spinbutton').fill('10')
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  expect(data.lineup.find(p=>p.id==='p')?.shirt_number).toBe(8)
  await team.getByRole('button',{name:'AÑADIR DORSAL',exact:true}).first().click()
  await team.getByLabel('Jugador',{exact:true}).selectOption('q')
  await team.getByRole('button',{name:'AÑADIR DORSAL',exact:true}).last().click()
  await page.getByRole('dialog').getByRole('spinbutton').fill('8')
  await page.getByRole('button',{name:'GUARDAR',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('DORSAL YA ASIGNADO')
  await page.getByRole('dialog').getByRole('spinbutton').fill('10')
  await page.getByRole('button',{name:'GUARDAR',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await page.locator('summary.lineup-toggle').click()
  await team.getByRole('button',{name:'EDITAR DORSAL',exact:true}).first().click()
  await expect(team.getByLabel('Jugador',{exact:true}).locator('option')).toHaveCount(3)
})

for(const width of [320,390,768]) test(`cierre manual 3-2 conserva pendientes y cabe en ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844})
  const {data,actions}=await setup(page,'PAUSADO')
  data.match.paused_from_status='SEGUNDO_TIEMPO';data.match.phase_started_at=null
  data.shootout={first_team_id:'h',next_team_id:'h',revision:6,completed_at:null,winner_team_id:null,score:{home:3,away:2},attempts:Array.from({length:6},(_,i)=>({id:String(i),team_id:i%2===0?'h':'a',sequence:i+1,converted:i!==5,request_id:String(i),created_at:data.server_now,updated_at:data.server_now,voided_at:null}))}
  await page.goto('/admin/partidos/m')
  const panel=page.getByRole('region',{name:'Tanda de penales'})
  await expect(panel.locator('.kick-pending')).toHaveCount(4)
  await panel.getByRole('button',{name:'FINALIZAR TANDA DE PENALES',exact:true}).click()
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  expect(actions).toEqual([])
  await panel.getByRole('button',{name:'FINALIZAR TANDA DE PENALES',exact:true}).click()
  await page.getByRole('button',{name:'CONFIRMAR FINALIZACIÓN ADMINISTRATIVA'}).click()
  await expect(panel).toContainText('SANTA RITA GANA EN PENALES')
  await expect(panel.locator('.kick-pending')).toHaveCount(4)
  expect(data.shootout.attempts).toHaveLength(6)
  expect(actions).toEqual(['FINISH_MANUAL'])
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.reload()
  await expect(panel.getByLabel('Marcador de penales',{exact:true})).toHaveText('3 - 2')
})

test('catálogo compartido y duración exclusiva conservan el encuentro al eliminar',async({page})=>{
  const {data}=await setup(page,'PROGRAMADO')
  await page.goto('/admin/partidos/m')
  await page.getByRole('button',{name:'Administrar tiempos'}).click()
  await page.getByRole('button',{name:'AGREGAR TIEMPO',exact:true}).click()
  await page.getByRole('dialog').getByRole('spinbutton').fill('25')
  await page.getByRole('button',{name:'GUARDAR',exact:true}).click()
  await expect(page.getByLabel('Duración por tiempo',{exact:true})).toHaveValue('1500')
  await page.getByRole('button',{name:'Administrar tiempos'}).click()
  await page.getByRole('button',{name:'ELIMINAR TIEMPO',exact:true}).click()
  await page.getByRole('dialog').getByRole('combobox').selectOption('1500')
  await page.getByRole('button',{name:'CONFIRMAR ELIMINACIÓN'}).click()
  expect(data.match.period_duration_seconds).toBe(1500)
  await page.getByRole('button',{name:'Administrar tiempos'}).click()
  await page.getByRole('button',{name:'TIEMPO PERSONALIZADO',exact:true}).click()
  await page.getByRole('dialog').getByRole('spinbutton').fill('7')
  await page.getByRole('button',{name:'GUARDAR',exact:true}).click()
  await expect(page.getByLabel('Duración por tiempo',{exact:true})).toHaveValue('420')
  await page.reload()
  await expect(page.getByLabel('Duración por tiempo',{exact:true})).toHaveValue('420')
})

test('crear amistosos manualmente actualiza el historial',async({page})=>{
  const matches:unknown[]=[]
  const saved:Record<string,unknown>[]=[]
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  await page.route('**/rest/v1/**',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1)
    if(name==='teams') return route.fulfill({json:[{id:'h',category_id:'c',name:'Santa Rita',active:true},{id:'a',category_id:'c',name:'Santa Ana',active:true}]})
    if(name==='categories') return route.fulfill({json:[{id:'c',name:'Mujeres'}]})
    if(name==='duration_options') return route.fulfill({json:[{seconds:900,built_in:true}]})
    if(name==='create_friendly') {
      const body=route.request().postDataJSON();saved.push(body)
      matches.push({match:{id:body.p_request_id,status:'PROGRAMADO',scheduled_date:body.p_date,scheduled_time:body.p_time},category:'Mujeres',home:'Santa Rita',away:'Santa Ana',score:{home:0,away:0}})
      return route.fulfill({json:matches.at(-1)})
    }
    return route.fulfill({json:matches})
  })
  await page.goto('/admin/amistosos')
  const selects=page.getByRole('combobox')
  await selects.nth(0).selectOption('c')
  await selects.nth(1).selectOption('h')
  await selects.nth(2).selectOption('a')
  await page.getByRole('button',{name:'CREAR AMISTOSO',exact:true}).click()
  await expect(page.getByRole('link',{name:'VER Y CONTROLAR AMISTOSO'})).toHaveCount(1)
  await expect(page.getByRole('button',{name:'ELEGIR EQUIPOS AL AZAR'})).toHaveCount(0)
  await selects.nth(1).selectOption('a');await selects.nth(2).selectOption('h')
  expect(await selects.nth(1).inputValue()).not.toBe(await selects.nth(2).inputValue())
  await page.getByRole('button',{name:'CREAR AMISTOSO',exact:true}).click()
  await expect(page.getByRole('link',{name:'VER Y CONTROLAR AMISTOSO'})).toHaveCount(2)
  expect(saved.every(s=>s.p_home!==s.p_away)).toBe(true)
  await page.reload()
  await expect(page.getByRole('link',{name:'VER Y CONTROLAR AMISTOSO'})).toHaveCount(2)
})
