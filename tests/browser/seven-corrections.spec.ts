import {test,expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import type {Shootout} from '../../src/lib/penalties'

function fixture(id='friendly',stage='FRIENDLY',status='PROGRAMADO') {
 const now=new Date().toISOString()
 return {match:{id,stage,status,category_id:'c',home_team_id:'h',away_team_id:'a',friendly_penalties:false,
  updated_at:now,created_at:now,scheduled_date:'2028-01-02',scheduled_time:'18:00:00',period_duration_seconds:1200,
  phase_started_at:null as string|null,phase_elapsed_seconds:50,paused_from_status:null as string|null,tiebreak_winner_team_id:null},
  home:'Local '+id,away:'Visitante '+id,category:'Mujeres',matchday:1,server_now:now,score:{home:1,away:0},
  events:[],goals:[],lineup:[],players:[],resolved:false,shootout:null as Shootout|null}
}
async function mock(page:Page,items:ReturnType<typeof fixture>[]) {
 const writes:{rpc:string;args:Record<string,unknown>}[]=[]
 let auth=0
 const tournament={categories:[{id:'c',name:'Mujeres',qualified:[],regular_closed_at:null}],matchdays:[{id:'d',number:1,date:null}],matches:items}
 await page.routeWebSocket('**/realtime/**',socket=>socket.close())
 await page.route('**/auth/v1/**',route=>{auth++;return route.abort()})
 await page.route('**/rest/v1/**',route=>{
  const rpc=new URL(route.request().url()).pathname.split('/').at(-1)!
  if(rpc==='duration_options')return route.fulfill({json:[{seconds:900,built_in:true},{seconds:1200,built_in:true}]})
  if(rpc==='teams')return route.fulfill({json:[{id:'h',category_id:'c',name:'Local',active:true},{id:'a',category_id:'c',name:'Visitante',active:true}]})
  if(rpc==='categories')return route.fulfill({json:tournament.categories})
  if(rpc==='matchdays')return route.fulfill({json:tournament.matchdays})
  if(rpc==='get_tournament')return route.fulfill({json:tournament})
  if(rpc==='get_friendlies')return route.fulfill({json:tournament.matches.filter(m=>m.match.stage==='FRIENDLY')})
  const args=route.request().postDataJSON()??{}
  if(rpc==='get_match_control')return route.fulfill({json:items.find(m=>m.match.id===args.p_match_id)})
  if(rpc==='matches')return route.fulfill({json:[]})
  writes.push({rpc,args})
  const item=items.find(m=>m.match.id===args.p_match_id)??items[0]
  if(rpc==='delete_match'){tournament.matches=tournament.matches.filter(m=>m.match.id!==args.p_match_id);return route.fulfill({json:null})}
  if(rpc==='create_friendly'){
   const created=fixture(String(args.p_request_id));items.push(created);return route.fulfill({json:created})
  }
  if(rpc==='reopen_match'){item.match.status='PAUSADO';item.match.paused_from_status='SEGUNDO_TIEMPO'}
  if(rpc==='control_match'){item.match.status=({BREAK:'DESCANSO',SECOND_HALF:'SEGUNDO_TIEMPO',FINISH:'FINALIZADO'} as Record<string,string>)[String(args.p_action)];item.match.phase_elapsed_seconds=0}
  if(rpc==='set_match_duration')item.match.period_duration_seconds=Number(args.p_seconds)
  if(rpc==='open_penalty_shootout')item.shootout={first_team_id:null,next_team_id:null,completed_at:null,winner_team_id:null,revision:0,initial_attempts:5,score:{home:0,away:0},attempts:[]}
  if(rpc==='manage_penalty_shootout'){item.shootout!.initial_attempts=Number(args.p_action==='SET_THREE'?3:5);item.shootout!.revision++}
  return route.fulfill({json:item})
 })
 return {writes,tournament,authCalls:()=>auth}
}

test('identidad sin año, fechas intactas y formularios sin duración ni penales',async({page})=>{
 const {writes}=await mock(page,[])
 await page.goto('/')
 await expect(page).toHaveTitle('Copa San Martín')
 await expect(page.locator('.brand-header strong')).toHaveText('COPA SAN MARTÍN')
 await expect(page.getByRole('heading',{level:1})).toHaveText('Copa San Martín')
 await page.goto('/admin/crear')
 await expect(page.getByLabel('Duración por tiempo',{exact:true})).toHaveCount(0)
 await page.goto('/admin/amistosos')
 await expect(page.getByLabel('Duración por tiempo',{exact:true})).toHaveCount(0)
 await expect(page.getByRole('checkbox')).toHaveCount(0)
 await expect(page.getByRole('button',{name:/AL AZAR/})).toHaveCount(0)
 const selects=page.getByRole('combobox')
 await expect(selects).toHaveCount(3)
 await selects.nth(0).selectOption('c');await selects.nth(1).selectOption('h');await selects.nth(2).selectOption('a')
 await page.getByLabel('Fecha',{exact:true}).fill('2028-01-02');await page.getByLabel('Hora',{exact:true}).fill('18:00')
 await page.getByRole('button',{name:'CREAR AMISTOSO',exact:true}).click()
 await expect.poll(()=>writes.length).toBe(1)
 expect(writes[0].args).toMatchObject({p_seconds:900,p_penalties:false,p_date:'2028-01-02',p_time:'18:00'})
})

test('amistosos en vivo y calendario en todos los estados; borrado aislado y cancelable',async({page})=>{
 const items=[fixture('scheduled'),fixture('live','FRIENDLY','PRIMER_TIEMPO'),fixture('finished','FRIENDLY','FINALIZADO'),fixture('official','REGULAR','FINALIZADO')]
 items[3].match.scheduled_date='2026-10-15'
 const {writes,tournament}=await mock(page,items)
 await page.goto('/')
 const live=page.getByRole('region',{name:'Partidos en vivo'})
 await expect(live).toContainText('Local live');await expect(live).toContainText('AMISTOSO')
 items[1].score.home=2
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await expect(live).toContainText('2 - 0')
 items[1].match.status='FINALIZADO'
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await expect(live).toHaveCount(0)
 await page.goto('/admin/calendario')
 await expect(page.locator('.calendar-entry')).toHaveCount(4)
 await expect(page.locator('.calendar-entry').filter({hasText:'Local scheduled'})).toContainText('02/01/2028')
 await expect(page.locator('.calendar-entry').filter({hasText:'Local official'})).toContainText('15/10/2026')
 const scheduled=page.locator('.calendar-entry').filter({hasText:'Local scheduled'})
 await expect(scheduled.getByRole('link',{name:'Controlar partido',exact:true})).toBeVisible()
 await expect(scheduled.getByRole('button',{name:'Reabrir partido',exact:true})).toHaveCount(0)
 await scheduled.getByRole('button',{name:'Eliminar partido',exact:true}).click()
 await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click()
 expect(writes).toHaveLength(0)
 await scheduled.getByRole('button',{name:'Eliminar partido',exact:true}).click()
 await page.getByRole('dialog').getByRole('button',{name:'Eliminar',exact:true}).click()
 await expect(page.locator('.calendar-entry')).toHaveCount(3)
 expect(writes).toHaveLength(1);expect(writes[0].args.p_match_id).toBe('scheduled')
 expect(tournament.matches.some(m=>m.match.id==='official')).toBe(true)
})

for(const stage of ['REGULAR','FRIENDLY'])test(`Calendario reabre ${stage} sin Auth y conserva duración y resultado`,async({page})=>{
 const data=fixture('m',stage,'FINALIZADO')
 const {writes,authCalls}=await mock(page,[data])
 await page.goto('/admin/calendario')
 await page.getByRole('button',{name:'Reabrir partido',exact:true}).click()
 await expect(page.locator('input[type=email],input[type=password]')).toHaveCount(0)
 await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click()
 expect(writes).toHaveLength(0)
 await page.getByRole('button',{name:'Reabrir partido',exact:true}).click()
 await page.getByRole('button',{name:'CONFIRMAR REAPERTURA'}).click()
 await expect.poll(()=>writes.length).toBe(1)
 expect(authCalls()).toBe(0)
 await page.goto('/admin/partidos/m')
 await expect(page.getByLabel('Duración por tiempo',{exact:true})).toHaveValue('1200')
 await expect(page.getByLabel('Duración por tiempo',{exact:true})).toBeDisabled()
 await expect(page.getByRole('timer')).toHaveText('19:10')
 await expect(page.getByLabel('Marcador',{exact:true})).toHaveText('1 - 0')
 await expect(page.getByRole('button',{name:'Reabrir partido',exact:true})).toHaveCount(0)
 await page.reload();await expect(page.getByRole('timer')).toHaveText('19:10')
})

for(const stage of ['REGULAR','FRIENDLY'])for(const width of [320,1280])test(`confirmaciones ${stage} a ${width}px: tamaños iguales, cancelación y una transición`,async({page})=>{
 await page.setViewportSize({width,height:844})
 const data=fixture('m',stage,'PRIMER_TIEMPO')
 const {writes}=await mock(page,[data])
 await page.goto('/admin/partidos/m')
 for(const [label,action] of [['Terminar primer tiempo','BREAK'],['Finalizar descanso e iniciar segundo tiempo','SECOND_HALF'],['FINALIZAR PARTIDO','FINISH']]){
  await page.getByRole('button',{name:label,exact:true}).click()
  const dialog=page.getByRole('dialog')
  const cancel=dialog.getByRole('button',{name:'Cancelar',exact:true})
  const confirm=dialog.getByRole('button',{name:'CONFIRMAR',exact:true})
  const a=await cancel.boundingBox(),b=await confirm.boundingBox()
  expect(a!.height).toBe(b!.height);expect(a!.width).toBe(b!.width);expect(a!.y).toBe(b!.y);expect(b!.x).toBeGreaterThan(a!.x)
  const count=writes.length
  await cancel.click();expect(writes).toHaveLength(count)
  await page.getByRole('button',{name:label,exact:true}).click()
  await confirm.click()
  await expect.poll(()=>writes.length).toBe(count+1)
  expect(writes.at(-1)!.args.p_action).toBe(action)
 }
})

for(const stage of ['FRIENDLY','SEMIFINAL'])test(`Penales ${stage}: abrir panel no inicia; inicio y tres tiros explícitos`,async({page})=>{
 const data=fixture('m',stage,'PAUSADO')
 Object.assign(data.match,{paused_from_status:'SEGUNDO_TIEMPO',phase_elapsed_seconds:1200})
 data.score.home=0
 const {writes}=await mock(page,[data])
 await page.goto('/admin/partidos/m')
 await page.getByRole('button',{name:'Penales',exact:true}).click()
 await expect(page.getByRole('region',{name:'Tanda de penales'})).toBeVisible()
 expect(writes).toHaveLength(0)
 await page.getByRole('button',{name:'Cerrar penales',exact:true}).click()
 expect(writes).toHaveLength(0)
 await page.getByRole('button',{name:'Penales',exact:true}).click()
 await page.getByRole('button',{name:'INICIAR TANDA DE PENALES'}).click()
 await expect.poll(()=>writes.length).toBe(1)
 await page.getByLabel('Lanzamientos iniciales por equipo').selectOption('3')
 await expect.poll(()=>writes.length).toBe(2)
 expect(writes[1].args.p_action).toBe('SET_THREE')
 await page.reload();await expect(page.getByLabel('Lanzamientos iniciales por equipo')).toHaveValue('3')
})
