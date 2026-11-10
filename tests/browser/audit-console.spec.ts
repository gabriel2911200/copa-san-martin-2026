import { test, expect } from '@playwright/test'

for(const width of [320,1280])test(`rutas públicas y administrativas: consola limpia y lecturas aisladas a ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844})
  const scriptErrors:string[]=[];const consoleErrors:string[]=[]
  page.on('pageerror',err=>scriptErrors.push(err.message))
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())})
  await page.routeWebSocket('**/realtime/**',socket=>socket.close())
  await page.route('**/rest/v1/**',async route=>{
    expect(route.request().method()==='GET'||/\/rpc\/get_[a-z_]+$/.test(route.request().url())).toBe(true)
    await route.continue()
  })
  for(const path of ['/','/tablas','/calendario','/goleadores','/admin/equipos','/admin/crear','/admin/controlar','/admin/amistosos']){
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.getByText(/^Cargando/)).toHaveCount(0)
    if(path==='/admin/amistosos')await expect(page.getByRole('button',{name:'CREAR AMISTOSO',exact:true})).toBeEnabled()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  }
  expect(scriptErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
