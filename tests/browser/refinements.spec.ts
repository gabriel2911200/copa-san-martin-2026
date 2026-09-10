import { test, expect } from '@playwright/test'

test('público sin actualizar ni enlaces redundantes y Top 4 por posición en ambas categorías',async({page})=>{
  for(const path of ['/','/calendario','/tablas']) {
    await page.goto(path)
    await expect(page.getByText('FUTSAL · COMUNIDAD · PASIÓN')).toBeVisible()
    await expect(page.getByRole('button',{name:/actualizar/i})).toHaveCount(0)
    await expect(page.getByText('Ver tabla regular')).toHaveCount(0)
  }
  await expect(page.getByText('Fase regular',{exact:true})).toHaveCount(0)
  await expect(page.getByText('Clasificación definitiva',{exact:true})).toHaveCount(0)
  for(const category of ['Varones','Mujeres']) {
    await page.getByRole('button',{name:category,exact:true}).click()
    await expect(page.locator('tr.qualification-zone')).toHaveCount(4)
    expect(await page.locator('tr.qualification-zone>td:first-child').allTextContents()).toEqual(['1','2','3','4'])
    const size=await page.locator('.standings-tabs').boundingBox()
    const main=await page.locator('.app-main').boundingBox()
    expect(size!.width).toBeLessThanOrEqual(main!.width)
    await expect(page.locator('.standings-tabs')).toHaveCSS('border-radius','16px')
    await expect(page.locator('.standings-tabs button').first()).toHaveCSS('font-size','13px')
    await page.screenshot({path:`test-results/tabla-${category}.png`,fullPage:true})
  }
})

test('error al crear conserva formulario y no navega ni reintenta INSERT',async({page})=>{
  let attempts=0
  await page.route('**/rest/v1/matches*',route=>{
    if(route.request().method()==='POST'){attempts++;return route.fulfill({status:403,json:{code:'42501',message:'rechazo simulado'}})}
    return route.fulfill({json:[]})
  })
  await page.goto('/admin/crear')
  await page.getByRole('combobox',{name:'Categoría',exact:true}).selectOption({label:'Varones'})
  await page.getByRole('combobox',{name:'Jornada',exact:true}).selectOption({label:'Fecha 3'})
  await page.getByLabel('Fecha del partido',{exact:true}).fill('2026-09-20')
  await page.getByLabel('Hora (Tarija)',{exact:true}).fill('15:00')
  await page.getByRole('combobox',{name:'Equipo local',exact:true}).selectOption({label:'San Judas'})
  await page.getByRole('combobox',{name:'Equipo visitante',exact:true}).selectOption({label:'San Pablo'})
  await page.getByRole('button',{name:'Crear partido',exact:true}).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/crear$/)
  await expect(page.getByLabel('Fecha del partido',{exact:true})).toHaveValue('2026-09-20')
  await expect(page.getByLabel('Hora (Tarija)',{exact:true})).toHaveValue('15:00')
  expect(attempts).toBe(1)
})
