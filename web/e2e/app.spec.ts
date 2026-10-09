import { expect, test, type Page } from '@playwright/test'

// Corre contra el modo demostración (backend en memoria), sin tocar Google Sheets.
const kpi = (page: Page, label: string) => page.locator('p', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::p[1]')
const go = (page: Page, tab: string) => page.getByRole('navigation').getByRole('button', { name: tab }).click()
const money = (s: string) => Number(s.replace(/[^\d.-]/g, ''))

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(kpi(page, 'Total gastado')).toContainText('S/')
})

test('navega por las cuatro pestañas y muestra Mi hoja', async ({ page }) => {
  for (const tab of ['Gastos', 'Categorías', 'Configuración', 'Dashboard']) {
    await page.getByRole('navigation').getByRole('button', { name: tab }).click()
    await expect(page.getByRole('navigation').getByRole('button', { name: tab })).toHaveAttribute('aria-current', 'page')
  }
  await expect(page.getByRole('link', { name: 'Mi hoja' })).toBeVisible()
  await expect(page.getByText('Gastos mensuales')).toHaveCount(0)
})

test('dashboard: 8 KPIs, gráficos y filtros consistentes', async ({ page }) => {
  for (const l of ['Caja mensual', 'Total gastado', 'Disponible', 'Consumido', 'Promedio diario', 'Promedio por movimiento', 'Mayor gasto', 'Movimientos']) {
    await expect(kpi(page, l)).toBeVisible()
  }
  await expect(page.locator('.recharts-surface').first()).toBeVisible()
  const total = money(await kpi(page, 'Total gastado').innerText())
  await page.getByLabel('Ámbito', { exact: true }).selectOption('Personal')
  const filtered = money(await kpi(page, 'Total gastado').innerText())
  expect(filtered).toBeLessThan(total)
  await page.getByRole('button', { name: 'Restablecer' }).click()
  expect(money(await kpi(page, 'Total gastado').innerText())).toBe(total)
  for (const t of ['Flujo de medios de pago', 'Frecuencia vs monto', 'Por medio de pago']) {
    await page.getByRole('tab', { name: t }).click()
    await expect(page.getByRole('tab', { name: t })).toHaveAttribute('aria-selected', 'true')
  }
})

test('registro individual, edición, anulación y restauración', async ({ page }) => {
  const before = money(await kpi(page, 'Total gastado').innerText())
  await go(page, 'Gastos')
  await page.getByRole('button', { name: 'Nuevo gasto' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'Registrar' }).click()
  await expect(dlg.getByText('Ingresa un monto')).toBeVisible()
  await dlg.getByLabel('Monto').fill('123.45')
  await dlg.getByLabel('Medio de pago').selectOption('Yape')
  await dlg.getByLabel('Categoría', { exact: true }).selectOption('Comida')
  await dlg.getByLabel('Descripción').fill('Prueba E2E')
  await dlg.getByRole('button', { name: 'Registrar' }).click()
  await expect(dlg).toBeHidden()
  const row = page.getByRole('row', { name: /Prueba E2E/ })
  await expect(row).toContainText('S/ 123.45')

  await row.getByRole('button', { name: 'Editar' }).click()
  await page.getByRole('dialog').getByLabel('Monto').fill('100')
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(row).toContainText('S/ 100.00')

  await go(page, 'Dashboard')
  expect(money(await kpi(page, 'Total gastado').innerText())).toBeCloseTo(before + 100, 2)

  await go(page, 'Gastos')
  await page.getByRole('row', { name: /Prueba E2E/ }).getByRole('button', { name: 'Anular' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Anular' }).click()
  await expect(page.getByRole('row', { name: /Prueba E2E/ })).toHaveCount(0)
  await page.getByLabel('Estado').selectOption('Anulado')
  await page.getByRole('row', { name: /Prueba E2E/ }).getByRole('button', { name: 'Restaurar' }).click()
  await page.getByLabel('Estado').selectOption('Activo')
  await expect(page.getByRole('row', { name: /Prueba E2E/ })).toBeVisible()
})

test('gastos: búsqueda, ordenamiento, paginación y exportación CSV', async ({ page }) => {
  await go(page, 'Gastos')
  await page.getByLabel('Buscar').fill('Taxi')
  const rows = page.locator('tbody tr')
  await expect(rows.first()).toContainText('Taxi')
  await page.getByLabel('Buscar').fill('')
  await page.getByRole('button', { name: /Monto/ }).click()
  const first = money(await rows.nth(0).locator('td').nth(6).innerText())
  const second = money(await rows.nth(1).locator('td').nth(6).innerText())
  expect(first).toBeGreaterThanOrEqual(second)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'CSV' }).click()
  expect((await download).suggestedFilename()).toMatch(/^gastos-\d{4}-\d{2}\.csv$/)
})

test('categorías: agrega una subcategoría y se ofrece en el formulario', async ({ page }) => {
  await go(page, 'Categorías')
  await page.getByLabel('Categoría', { exact: true }).fill('Mascotas')
  await page.getByLabel('Subcategoría').fill('Veterinario')
  await page.getByRole('button', { name: 'Agregar' }).click()
  await expect(page.getByRole('button', { name: 'Veterinario' })).toBeVisible()
  await go(page, 'Gastos')
  await page.getByRole('button', { name: 'Nuevo gasto' }).click()
  await page.getByRole('dialog').getByLabel('Categoría', { exact: true }).selectOption('Mascotas')
  await expect(page.getByRole('dialog').getByLabel('Subcategoría')).toContainText('Veterinario')
})

test('configuración: tema oscuro y validación de conexión', async ({ page }) => {
  await go(page, 'Configuración')
  await page.getByLabel('Tema visual').selectOption('oscuro')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Conectar' }).click()
  await expect(page.getByRole('alert')).toContainText('/exec')
})

test('responsive: sin scroll horizontal en móvil', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  for (const tab of ['Dashboard', 'Gastos', 'Categorías', 'Configuración']) {
    await page.getByRole('navigation').getByRole('button', { name: tab }).click()
    await page.waitForTimeout(300)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, tab).toBeLessThanOrEqual(0)
  }
})
