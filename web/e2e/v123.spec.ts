import { expect, test, type Page } from '@playwright/test'
import { dialog, go, newGasto } from './util'

// v1.23 — correcciones de la auditoría (P1–P7). Modo demostración.

test.describe('P1: la fecha de hoy no se congela', () => {
  test('al pasar la medianoche el Dashboard y el corte de la conciliación avanzan solos', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
    await page.clock.install({ time: new Date('2026-10-15T23:58:00-05:00') })
    await page.goto('/?demo=60&fuentes=3&cajas=3&latencia=0#dashboard')
    await expect(page.getByText('15 días transcurridos')).toBeVisible()
    await page.clock.runFor(3 * 60_000)                         // 00:01 del 16/10
    await expect(page.getByText('16 días transcurridos')).toBeVisible()
    await expect(page.getByText('15 días transcurridos')).toHaveCount(0)
    // Conciliación: la fecha de corte por defecto es la de hoy (16/10), no la del día en que se abrió la pestaña
    await page.evaluate(() => { location.hash = '#salud' })
    await page.getByRole('tab', { name: /Conciliación de saldos/ }).click()
    await expect(page.getByTestId('conciliacion').getByText('16/10/2026').first()).toBeVisible()
  })
  test('cruce de mes: el filtro "Este mes" avanza a noviembre', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
    await page.clock.install({ time: new Date('2026-10-31T23:59:00-05:00') })
    await page.goto('/?demo=60&latencia=0#dashboard')
    await expect(page.getByRole('button', { name: 'Período', exact: true })).toContainText('Octubre 2026')
    await page.clock.runFor(2 * 60_000)
    await expect(page.getByRole('button', { name: 'Período', exact: true })).toContainText('Noviembre 2026')
  })
})

test.describe('P3: UI optimista con Apps Script lento o caído', () => {
  const vista = (page: Page) => page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })

  test('?latencia=8000: crear, editar y eliminar se ven al instante y se confirman en segundo plano', async ({ page }) => {
    test.setTimeout(120_000)
    await vista(page)
    await page.goto('/?demo=20&latencia=8000')
    await go(page, 'Gastos')
    await expect(page.getByRole('button', { name: 'Nuevo gasto' })).toBeEnabled({ timeout: 30_000 })   // la primera lectura tarda 8 s (sin respaldo en demo)
    const t0 = Date.now()
    await newGasto(page, { monto: '12.34', desc: 'Optimista E2E' })
    const fila = page.getByRole('row', { name: /Optimista E2E/ })
    await expect(fila).toBeVisible({ timeout: 1500 })                       // no espera los 8 s de Apps Script
    expect(Date.now() - t0).toBeLessThan(4000)
    await expect(page.getByTestId('cambios-pendientes')).toContainText('1 cambio pendiente')
    await expect(page.getByText('Gasto registrado correctamente.')).toBeVisible({ timeout: 30_000 })   // la confirmación llega después
    await expect(page.getByTestId('cambios-pendientes')).toHaveCount(0)

    await fila.getByRole('button', { name: 'Editar' }).click()
    await dialog(page).getByLabel('Monto', { exact: true }).fill('20')
    await dialog(page).getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(fila).toContainText('S/ 20.00', { timeout: 1500 })

    await fila.getByRole('button', { name: 'Eliminar' }).click()
    await dialog(page).getByRole('button', { name: 'Eliminar' }).click()
    await expect(page.getByRole('row', { name: /Optimista E2E/ })).toHaveCount(0, { timeout: 1500 })
    await expect(page.getByTestId('cambios-pendientes')).toBeVisible()
    await expect(page.getByTestId('cambios-pendientes')).toHaveCount(0, { timeout: 40_000 })
  })

  test('?falla=timeout: el gasto aparece, se revierte al fallar y "Reintentar" lo vuelve a mostrar', async ({ page }) => {
    await vista(page)
    await page.goto('/?demo=20&latencia=0&falla=timeout')
    await go(page, 'Gastos')
    await expect(page.getByRole('button', { name: 'Nuevo gasto' })).toBeEnabled()
    // La falla simulada tarda 300 ms: un observador registra si la fila llegó a pintarse (cambio optimista) antes de revertirse.
    const observar = () => page.evaluate(() => {
      const w = window as unknown as { __vio?: boolean }; w.__vio = false
      new MutationObserver(() => { if (document.querySelector('tbody')?.textContent?.includes('Falla E2E')) w.__vio = true }).observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    const vio = () => page.evaluate(() => (window as unknown as { __vio?: boolean }).__vio === true)
    await observar()
    await newGasto(page, { monto: '7.50', desc: 'Falla E2E' })
    const toast = page.getByRole('alert').filter({ hasText: 'No se pudo registrar el gasto.' })
    await expect(toast).toBeVisible({ timeout: 10_000 })
    expect(await vio()).toBe(true)                                                         // se mostró al instante...
    await expect(page.getByRole('row', { name: /Falla E2E/ })).toHaveCount(0)             // ...y se revirtió al fallar
    await page.evaluate(() => { (window as unknown as { __vio?: boolean }).__vio = false })
    await toast.getByRole('button', { name: 'Reintentar' }).click()
    await expect.poll(vio, { timeout: 3000 }).toBe(true)                                   // "Reintentar" lo vuelve a mostrar al instante
  })
})
