import { test, expect } from '@playwright/test'

test('17 equipos reales visibles con estadísticas coherentes, solo lectura', async ({ page }) => {
  await page.route('**/rest/v1/**', route => {
    const request = route.request()
    if (request.method() !== 'GET' && !/\/rpc\/(get_tournament|get_standings)$/.test(request.url())) throw Error('Escritura no autorizada en prueba')
    return route.continue()
  })
  await page.goto('/tablas')
  const expected = {
    Varones: ['San Martin','San Judas','San Pablo','San Benito','San Jose','San Roque','San Francisco','San Lorenzo','San Andrés','San Juan Bosco','San Antonio'],
    Mujeres: ['Santa Gema','Santa Rosa','Santa Ana','Santa Catalina','Santa Lucia','Santa Rita'],
  }
  for (const [category, names] of Object.entries(expected)) {
    await page.getByRole('button', { name: category, exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(names.length)
    for (const name of names) await expect(page.getByRole('rowheader', { name, exact: true })).toBeVisible()
    for (const row of await page.locator('tbody tr').all()) {
      const [,pj,pg,pe,pp,gf,gc,dg,pts]=(await row.locator('td').allTextContents()).map(Number)
      expect(pj).toBe(pg+pe+pp)
      expect(dg).toBe(gf-gc)
      expect(pts).toBe(3*pg+pe)
    }
  }
})
