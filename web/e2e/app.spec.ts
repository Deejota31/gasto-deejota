import { expect, test, type Page } from '@playwright/test'

// Corre contra el modo demostración (backend en memoria). No toca Google Sheets ni datos reales.
const kpi = (page: Page, label: string) => page.locator('p', { hasText: new RegExp(`^${label}`) }).locator('xpath=following-sibling::p[1]').first()
const go = (page: Page, tab: string) => page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: tab }).click()
const money = (s: string) => Number(s.replace(/[^\d.-]/g, ''))
const total = async (page: Page) => money(await kpi(page, 'Total gastado').innerText())
const dialog = (page: Page) => page.getByRole('dialog')

async function pickMulti(page: Page, label: string, option: string) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('listbox', { name: label }).getByRole('option', { name: option, exact: true }).click()
  await page.keyboard.press('Escape')
}

async function newGasto(page: Page, { ambito, categoria, sub, monto, medio, desc }: { ambito: string; categoria: string; sub: string; monto: string; medio: string; desc: string }) {
  await page.getByRole('button', { name: 'Nuevo gasto' }).click()
  const d = dialog(page)
  await d.getByRole('radiogroup', { name: 'Ámbito' }).getByRole('radio', { name: ambito, exact: true }).click()
  await d.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: categoria, exact: true }).click()
  await d.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio', { name: sub, exact: true }).click()
  await d.getByLabel('Monto', { exact: true }).fill(monto)
  await d.getByRole('radiogroup', { name: 'Medio de pago' }).getByRole('radio', { name: medio, exact: true }).click()
  await d.getByLabel('Descripción').fill(desc)
  await d.getByRole('button', { name: 'Registrar gasto' }).click()
  await expect(d).toHaveCount(0)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?demo=60')
  await expect(kpi(page, 'Total gastado')).toContainText('S/')
})

test('navega por las pestañas; ya no existe el gráfico "Últimos 6 meses"', async ({ page }) => {
  for (const tab of ['Gastos', 'Categorías', 'Configuración', 'Dashboard']) {
    await go(page, tab)
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: tab })).toHaveAttribute('aria-current', 'page')
  }
  await expect(page.getByRole('link', { name: 'Mi hoja' })).toBeVisible()
  await expect(page.getByText('Últimos 6 meses', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/Gasto acumulado/).first()).toBeVisible()
  await expect(page.getByText('Gasto diario', { exact: true })).toBeVisible()
})

test('cada KPI tiene su icono de información con explicación', async ({ page }) => {
  for (const l of ['Caja mensual', 'Total gastado', 'Disponible', 'Consumido', 'Promedio diario', 'Promedio por movimiento', 'Mayor gasto', 'Movimientos']) {
    await expect(kpi(page, l)).toBeVisible()
    const btn = page.getByRole('button', { name: `Información: ${l}`, exact: true })
    await btn.click()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  }
  // los gráficos también llevan su ⓘ
  expect(await page.getByRole('button', { name: /^Información: / }).count()).toBeGreaterThanOrEqual(13)
})

test('filtros: multiselección, chips, dependencia y limpiar', async ({ page }) => {
  const t0 = await total(page)
  await pickMulti(page, 'Ámbito', 'Personal')
  await expect(page.getByRole('button', { name: 'Quitar filtro Personal' })).toBeVisible()
  const t1 = await total(page)
  expect(t1).toBeLessThan(t0)
  // Categorías dependientes: solo las del ámbito Personal (Suscripciones sí, Bebé no)
  await page.getByRole('button', { name: 'Categoría', exact: true }).click()
  const cats = page.getByRole('listbox', { name: 'Categoría' })
  await expect(cats.getByRole('option', { name: 'Suscripciones', exact: true })).toBeVisible()
  await expect(cats.getByRole('option', { name: 'Bebé', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Limpiar filtros' }).click()
  expect(await total(page)).toBe(t0)
  // Presets de período
  await page.getByRole('button', { name: 'Período', exact: true }).click()
  await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Este año' }).click()
  expect(await total(page)).toBeGreaterThanOrEqual(t0)
})

test('cajas: libre inicial = presupuesto − reservado; disponible global = P − gastado', async ({ page }) => {
  const val = async (l: string) => money(await page.locator('p', { hasText: new RegExp(`^${l.replace(/[()]/g, '\\$&')}$`) }).locator('xpath=following-sibling::p[1]').first().innerText())
  const P = await val('Presupuesto (P)')
  const R = await val('Reservado en subcajas')
  expect(await val('Libre inicial (P − R)')).toBeCloseTo(P - R, 2)
  const disp = money(await page.getByText('Disponible global').locator('xpath=following-sibling::p[1]').innerText())
  expect(disp).toBeCloseTo(P - (await total(page)), 2)
})

test('medios de pago: orden pedido y sin opciones en blanco', async ({ page }) => {
  await go(page, 'Gastos')
  await page.getByRole('button', { name: 'Nuevo gasto' }).click()
  const radios = dialog(page).getByRole('radiogroup', { name: 'Medio de pago' }).getByRole('radio')
  const names = (await radios.allInnerTexts()).map(s => s.trim())
  expect(names).toEqual(['Yape', 'Plin', 'Sodexo', 'Transferencia', 'Efectivo', 'Otros'])
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Medio de pago', exact: true }).click()
  const opts = (await page.getByRole('listbox', { name: 'Medio de pago' }).getByRole('option').allInnerTexts()).map(s => s.trim())
  expect(opts).toEqual(['Yape', 'Plin', 'Sodexo', 'Transferencia', 'Efectivo', 'Otros'])
})

test('registrar, editar, clonar, eliminar y restaurar un gasto', async ({ page }) => {
  const before = await total(page)
  await go(page, 'Gastos')
  await newGasto(page, { ambito: 'Personal', categoria: 'Alimentación', sub: 'Almuerzo', monto: '12.34', medio: 'Yape', desc: 'Prueba E2E' })
  const row = page.getByRole('row', { name: /Prueba E2E/ })
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: 'Editar' }).click()
  await dialog(page).getByLabel('Monto', { exact: true }).fill('20')
  await dialog(page).getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(row).toContainText('S/ 20.00')

  await row.getByRole('button', { name: 'Clonar' }).click()
  await expect(dialog(page).getByText('Clonar gasto')).toBeVisible()
  await dialog(page).getByLabel('Descripción').fill('Prueba E2E copia')
  await dialog(page).getByRole('button', { name: 'Crear copia' }).click()
  await expect(page.getByRole('row', { name: /Prueba E2E copia/ })).toBeVisible()

  const copy = page.getByRole('row', { name: /Prueba E2E copia/ })
  await copy.getByRole('button', { name: 'Eliminar' }).click()
  await dialog(page).getByRole('button', { name: 'Eliminar' }).click()
  await expect(page.getByRole('row', { name: /Prueba E2E copia/ })).toHaveCount(0)
  await page.getByRole('radio', { name: 'Eliminados' }).click()
  await page.getByRole('row', { name: /Prueba E2E copia/ }).getByRole('button', { name: 'Restaurar' }).click()
  await page.getByRole('radio', { name: 'Activos' }).click()
  await expect(page.getByRole('row', { name: /Prueba E2E copia/ })).toBeVisible()

  await go(page, 'Dashboard')
  expect(await total(page)).toBeCloseTo(before + 40, 2)
})

test('tabla: paginación 5/10/15/25/50 con "Mostrando x–y de N"', async ({ page }) => {
  await go(page, 'Gastos')
  await page.getByRole('button', { name: 'Período', exact: true }).click()
  await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Este año' }).click()
  const size = page.getByLabel('Registros por página')
  await expect(size).toHaveValue('10')
  expect(await size.locator('option').allInnerTexts()).toEqual(['5', '10', '15', '25', '50'])
  const status = page.getByText(/^Mostrando/)
  await expect(status).toContainText('1–10 de')
  const n = Number((await status.innerText()).match(/de (\d+)/)![1])
  expect(n).toBeGreaterThan(10)
  await expect(page.locator('tbody tr')).toHaveCount(10)
  await page.getByRole('button', { name: 'Página siguiente' }).click()
  await expect(status).toContainText(`11–${Math.min(20, n)} de ${n}`)
  await size.selectOption('5')
  await expect(status).toContainText(`1–5 de ${n}`)
  await expect(page.locator('tbody tr')).toHaveCount(5)
  await size.selectOption('50')
  await expect(page.locator('tbody tr')).toHaveCount(Math.min(50, n))
})

test('catálogo: crear subcategoría y usarla al registrar', async ({ page }) => {
  await go(page, 'Categorías')
  await page.getByRole('button', { name: 'Agregar subcategoría a Alimentación' }).click()
  await dialog(page).getByLabel('Nombre').fill('Café de prueba')
  await dialog(page).getByRole('button', { name: 'Agregar' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Café de prueba' })).toBeVisible()
  await page.getByLabel('Buscar en el catálogo').fill('café de')
  await expect(page.locator('mark', { hasText: /café de/i }).first()).toBeVisible()
  await go(page, 'Gastos')
  await newGasto(page, { ambito: 'Personal', categoria: 'Alimentación', sub: 'Café de prueba', monto: '5', medio: 'Plin', desc: 'Usa nueva sub' })
  await expect(page.getByRole('row', { name: /Usa nueva sub/ })).toContainText('Café de prueba')
})

test('catálogo: renombrar categoría actualiza los gastos de ese ámbito', async ({ page }) => {
  await go(page, 'Gastos')
  await newGasto(page, { ambito: 'Personal', categoria: 'Alimentación', sub: 'Almuerzo', monto: '7', medio: 'Efectivo', desc: 'Antes de renombrar' })
  await go(page, 'Categorías')
  await page.getByRole('button', { name: 'Editar Alimentación' }).click()
  await expect(dialog(page).getByText(/Se renombrará también en \d+ gasto/)).toHaveCount(0)
  await dialog(page).getByLabel('Nombre').fill('Comida')
  await expect(dialog(page).getByText(/Se renombrará también en \d+ gasto/)).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Guardar' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Editar Comida' })).toBeVisible()
  await go(page, 'Gastos')
  const row = page.getByRole('row', { name: /Antes de renombrar/ })
  await expect(row).toContainText('Comida')
  await expect(row).not.toContainText('Alimentación')
})

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('sin scroll horizontal en ninguna pestaña', async ({ page }) => {
    for (const tab of ['Dashboard', 'Gastos', 'Categorías', 'Configuración']) {
      await go(page, tab)
      await page.waitForTimeout(300)
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(over, tab).toBeLessThanOrEqual(0)
    }
  })

  test('deslizar revela acciones y tocar no elimina', async ({ page }) => {
    await go(page, 'Gastos')
    const list = page.getByRole('list', { name: 'Movimientos' })
    const first = list.getByRole('listitem').first()
    const count = await list.getByRole('listitem').count()
    const box = (await first.boundingBox())!
    // un toque simple no ejecuta nada destructivo
    await first.click({ position: { x: box.width - 30, y: box.height / 2 } })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // gesto de deslizar a la izquierda
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width - 20, y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width - 20 - i * 20, y)
    await page.mouse.up()
    await expect(first.getByRole('button', { name: 'Eliminar' })).toBeInViewport()
    await first.getByRole('button', { name: 'Eliminar' }).click()
    await expect(dialog(page).getByText('Eliminar gasto')).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Cancelar' }).click()
    await expect(list.getByRole('listitem')).toHaveCount(count)
  })
})

test('caso 10: Familia + Bebé + Yape → tabla y KPI muestran exactamente esos movimientos', async ({ page }) => {
  await go(page, 'Gastos')
  await page.getByRole('button', { name: 'Período', exact: true }).click()
  await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Este año' }).click()
  await newGasto(page, { ambito: 'Familia', categoria: 'Bebé', sub: 'Pañales', monto: '100', medio: 'Yape', desc: 'Caso 10' })
  await pickMulti(page, 'Ámbito', 'Familia')
  await pickMulti(page, 'Categoría', 'Bebé')
  await pickMulti(page, 'Medio de pago', 'Yape')
  await page.getByLabel('Registros por página').selectOption('50')
  const rows = page.locator('tbody tr')
  const n = await rows.count()
  expect(n).toBeGreaterThan(0)
  let suma = 0
  for (let i = 0; i < n; i++) {
    const t = await rows.nth(i).innerText()
    expect(t).toContain('Familia'); expect(t).toContain('Bebé'); expect(t).toContain('Yape')
    suma += money(t.match(/S\/\s?[\d,.]+/)![0])
  }
  await go(page, 'Dashboard')
  expect(await total(page)).toBeCloseTo(suma, 2)
})
