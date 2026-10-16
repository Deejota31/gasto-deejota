import { expect, test, type Page } from '@playwright/test'

// v1.23 — correcciones de la auditoría (P1–P7). Modo demostración.
const dialog = (page: Page) => page.getByRole('dialog').filter({ visible: true }).last()

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
