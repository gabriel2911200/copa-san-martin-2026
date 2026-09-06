import { test,expect } from '@playwright/test'
test('solo administrador: cancelar no borra; confirmar elimina solo el partido elegido',async({page})=>{
  const match=(id:string)=>({match:{id,category_id:'c',home_team_id:'a',away_team_id:'b',status:'FINALIZADO',stage:'REGULAR',updated_at:'2026-09-06T00:00:00Z'},category:'Varones',matchday:1,home:`Local ${id}`,away:'Visitante',score:{home:1,away:0},goals:[],resolved:true})
  const data={categories:[{id:'c',name:'Varones'}],matchdays:[{id:'d',number:1,date:null}],matches:[match('one'),match('two')]}
  let calls=0
  await page.route('**/rest/v1/**',route=>{
    if(route.request().url().endsWith('/delete_match')){
      expect(route.request().postDataJSON()).toEqual({p_match_id:'one',p_expected_updated_at:'2026-09-06T00:00:00Z'})
      calls++;data.matches=data.matches.filter(m=>m.match.id!=='one');return route.fulfill({status:204})
    }
    return route.fulfill({json:data})
  })
  await page.goto('/calendario')
  await expect(page.getByText('Local one',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Eliminar partido',exact:true})).toHaveCount(0)
  await page.goto('/admin/calendario')
  await page.getByRole('button',{name:'Eliminar partido',exact:true}).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  expect(calls).toBe(0)
  await page.getByRole('button',{name:'Eliminar partido',exact:true}).first().click()
  await page.getByRole('button',{name:'Eliminar',exact:true}).click()
  await expect(page.getByText('Local one',{exact:true})).toHaveCount(0)
  await expect(page.getByText('Local two',{exact:true}).first()).toBeVisible()
  expect(calls).toBe(1)
})
