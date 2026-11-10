import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

function matchFixture() {
  const now=new Date().toISOString()
  const players=[{id:'p',team_id:'h',full_name:'Juan',active:true},{id:'q',team_id:'a',full_name:'Pedro',active:true}]
  return {match:{id:'m',category_id:'c',home_team_id:'h',away_team_id:'a',stage:'FRIENDLY',friendly_penalties:true,status:'PAUSADO',paused_from_status:'SEGUNDO_TIEMPO',phase_elapsed_seconds:900,phase_started_at:null,updated_at:now,tiebreak_winner_team_id:null,scheduled_date:null as string|null,scheduled_time:null as string|null},home:'Santa Rita',away:'Santa Ana',category:'Mujeres',matchday:1,server_now:now,score:{home:0,away:0},goals:[],events:[] as {id:string;type:string;player_id:string;team_id:string;period_number:number}[],players,lineup:players.map(p=>({...p,shirt_number:8,used:false})),shootout:{first_team_id:null as string|null,next_team_id:null as string|null,revision:0,completed_at:null,initial_attempts:5,score:{home:0,away:0},attempts:[] as {id:string;team_id:string;sequence:number;converted:boolean}[]}}
}
async function friendlyMock(page:Page,{lose=false,readFailure=false}={}) {
  const saved:ReturnType<typeof matchFixture>[]=[]
  const requests:string[]=[]
  let failed=readFailure
  let lost=lose
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  await page.route('**/rest/v1/**',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1)
    if(name==='teams')return route.fulfill({json:[{id:'h',category_id:'c',name:'Santa Rita',active:true},{id:'a',category_id:'c',name:'Santa Ana',active:true}]})
    if(name==='categories')return route.fulfill({json:[{id:'c',name:'Mujeres'}]})
    if(name==='duration_options')return route.fulfill({json:[{seconds:900,built_in:true},{seconds:1200,built_in:true}]})
    if(name==='create_friendly'){
      const args=route.request().postDataJSON();requests.push(args.p_request_id)
      if(!saved.some(m=>m.match.id===args.p_request_id)){const m=matchFixture();m.match.id=args.p_request_id;m.match.status='PROGRAMADO';saved.push(m)}
      if(lost){lost=false;return route.abort('failed')}
      return route.fulfill({json:saved.find(m=>m.match.id===args.p_request_id)})
    }
    if(failed){failed=false;return route.fulfill({status:503,json:{message:'Temporary failure'}})}
    // Keep committed results hidden until the second request to test recovery
    // from both a lost write response and a temporarily stale history read.
    return route.fulfill({json:lose&&requests.length<2?[]:saved})
  })
  return {saved,requests}
}
async function selectFriendly(page:Page) {
  const selects=page.getByRole('combobox')
  await selects.nth(0).selectOption('c');await selects.nth(1).selectOption('h');await selects.nth(2).selectOption('a')
}

test('Enter en tiempo personalizado no crea un amistoso ni envía el formulario exterior',async({page})=>{
  const {requests}=await friendlyMock(page)
  await page.goto('/admin/amistosos');await selectFriendly(page)
  await page.getByRole('button',{name:'Administrar tiempos'}).click()
  await page.getByRole('button',{name:'TIEMPO PERSONALIZADO',exact:true}).click()
  await page.getByRole('dialog').getByRole('spinbutton').fill('7')
  await page.getByRole('dialog').getByRole('spinbutton').press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Duración por tiempo',{exact:true})).toHaveValue('420')
  expect(requests).toEqual([])
  await expect(page.getByLabel('Hora',{exact:true})).toBeDisabled()
})

test('amistoso: recarga tras respuesta perdida conserva ID y no duplica encuentros',async({page})=>{
  const {saved,requests}=await friendlyMock(page,{lose:true})
  await page.goto('/admin/amistosos');await selectFriendly(page)
  await page.getByRole('button',{name:'CREAR AMISTOSO',exact:true}).click()
  await expect(page.getByRole('button',{name:'Reintentar creación pendiente'})).toBeEnabled()
  const id=requests[0]
  await page.reload()
  await expect(page.getByRole('button',{name:'Reintentar creación pendiente'})).toBeEnabled()
  await page.getByRole('button',{name:'Reintentar creación pendiente'}).click()
  await expect(page.getByRole('link',{name:'VER Y CONTROLAR AMISTOSO'})).toHaveCount(1)
  expect(requests).toEqual([id,id]);expect(saved).toHaveLength(1)
  await expect(page.getByRole('button',{name:'Reintentar creación pendiente'})).toHaveCount(0)
})

test('amistoso: un fallo de lectura permite actualizar y elimina el error obsoleto',async({page})=>{
  await friendlyMock(page,{readFailure:true})
  await page.goto('/admin/amistosos')
  await expect(page.getByRole('button',{name:'Actualizar amistosos'})).toBeVisible()
  await page.getByRole('button',{name:'Actualizar amistosos'}).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'CREAR AMISTOSO',exact:true})).toBeEnabled()
})

for(const corrupted of [true,false])test(`penales: ${corrupted?'caché inválida':'almacenamiento bloqueado'} no congela los controles`,async({page})=>{
  const data=matchFixture();let writes=0
  await page.addInitScript(({corrupted})=>{
    if(corrupted)sessionStorage.setItem('pending-shootout:m','true')
    const original=Storage.prototype.setItem
    Object.defineProperty(window,'blockPending',{value:!corrupted,writable:true})
    Storage.prototype.setItem=function(key,value){if(key.startsWith('pending-shootout:')&&(window as unknown as {blockPending:boolean}).blockPending)throw Error('Storage blocked');return original.call(this,key,value)}
  },{corrupted})
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  await page.route('**/rest/v1/**',async route=>{
    if(route.request().url().endsWith('/manage_penalty_shootout')){
      writes++;data.shootout.first_team_id='h';data.shootout.next_team_id='a';data.shootout.revision++
      data.shootout.attempts.push({id:'kick',team_id:'h',sequence:1,converted:true});data.shootout.score.home=1
    }
    return route.fulfill({json:data})
  })
  await page.goto('/admin/partidos/m')
  const panel=page.getByRole('region',{name:'Tanda de penales'})
  await expect(panel.locator('.penalty-actions button:enabled')).toHaveCount(4)
  await panel.getByRole('button',{name:'GOL Santa Rita',exact:true}).click()
  if(!corrupted){
    await expect(panel.getByRole('alert')).toContainText('almacenamiento');expect(writes).toBe(0)
    await expect(panel.getByRole('button',{name:'Reintentar operación pendiente'})).toHaveCount(0)
    await page.evaluate(()=>{(window as unknown as {blockPending:boolean}).blockPending=false})
    await panel.getByRole('button',{name:'GOL Santa Rita',exact:true}).click()
  }
  await expect(panel.getByRole('button',{name:'GOL Santa Ana',exact:true})).toBeEnabled()
  expect(writes).toBe(1)
})

test('dorsal de expulsado sigue editable pero el jugador no puede anotar',async({page})=>{
  const data={...matchFixture(),shootout:null};data.match.status='PRIMER_TIEMPO';data.lineup[0].used=true
  data.events=[{id:'red',type:'RED_CARD',player_id:'p',team_id:'h',period_number:1}]
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  await page.route('**/rest/v1/**',route=>route.fulfill({json:data}))
  await page.goto('/admin/partidos/m');await page.locator('summary.lineup-toggle').click()
  const team=page.getByRole('region',{name:'Convocatoria de Santa Rita'})
  await expect(team.getByText('#8 Juan',{exact:true})).toBeVisible()
  await team.getByRole('button',{name:'EDITAR DORSAL',exact:true}).first().click()
  await team.getByRole('combobox').selectOption('p')
  await expect(team.getByRole('button',{name:'EDITAR DORSAL',exact:true}).last()).toBeEnabled()
  await page.getByRole('button',{name:'GOL Santa Rita',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('button',{name:'#8 Juan',exact:true})).toHaveCount(0)
  await expect(page.getByRole('dialog')).toContainText('No hay jugadores disponibles')
})

test('un cambio remoto del cronómetro conserva el borrador de agenda y su versión',async({page})=>{
  const data={...matchFixture(),shootout:null};data.match.stage='REGULAR';data.match.status='PRIMER_TIEMPO'
  const oldVersion=data.match.updated_at;let received:unknown
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  await page.route('**/rest/v1/**',route=>{
    if(route.request().url().endsWith('/reschedule_match')){received=route.request().postDataJSON().p_expected_updated_at;return route.fulfill({status:400,json:{code:'P0001',message:'El partido cambió. Actualiza antes de guardar.'}})}
    return route.fulfill({json:{categories:[],matchdays:[],matches:[data]}})
  })
  await page.goto('/admin/controlar');await page.getByText('PROGRAMAR',{exact:true}).click()
  await page.getByLabel('Fecha del partido',{exact:true}).fill('2026-11-10')
  data.match.updated_at=new Date(Date.parse(oldVersion)+10000).toISOString()
  await page.evaluate(async()=>{
    // @ts-expect-error Vite browser import.
    const {supabase}=await import('/src/lib/supabase.ts')
    for(const channel of supabase.getChannels())for(const binding of channel.bindings.postgres_changes??[]){if(binding.filter.table==='matches')binding.callback({table:'matches',eventType:'UPDATE',new:{},old:{}})}
  })
  await expect(page.getByLabel('Fecha del partido',{exact:true})).toHaveValue('2026-11-10')
  await page.getByRole('button',{name:'Guardar agenda'}).click()
  await expect(page.getByRole('status').filter({hasText:'El partido cambió'})).toBeVisible()
  expect(received).toBe(oldVersion)
  await expect(page.getByLabel('Fecha del partido',{exact:true})).toHaveValue('2026-11-10')
})

test('fallo al releer el catálogo mantiene el diálogo y permite reintentar',async({page})=>{
  const data={...matchFixture(),shootout:null};data.match.status='PROGRAMADO'
  let failed=false;let added=false
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  await page.route('**/rest/v1/**',route=>{
    const url=route.request().url()
    if(url.includes('/duration_options')){
      if(added&&!failed){failed=true;return route.fulfill({status:400,json:{code:'P0001',message:'Catalog read failed'}})}
      return route.fulfill({json:[{seconds:900,built_in:true},...(added?[{seconds:1500,built_in:false}]:[])]})
    }
    if(url.endsWith('/manage_duration')){added=true;return route.fulfill({json:null})}
    if(url.endsWith('/set_match_duration'))return route.fulfill({json:{...data,match:{...data.match,period_duration_seconds:1500}}})
    return route.fulfill({json:data})
  })
  await page.goto('/admin/partidos/m');await expect(page.getByLabel('Duración por tiempo',{exact:true}).locator('option')).toHaveCount(1)
  await page.getByRole('button',{name:'Administrar tiempos'}).click()
  await page.getByRole('button',{name:'AGREGAR TIEMPO',exact:true}).click()
  await page.getByRole('dialog').getByRole('spinbutton').fill('25')
  await page.getByRole('dialog').getByRole('button',{name:'GUARDAR',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('catálogo')
  await page.getByRole('dialog').getByRole('button',{name:'GUARDAR',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Duración por tiempo',{exact:true})).toHaveValue('1500')
})
