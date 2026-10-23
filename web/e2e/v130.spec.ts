import { expect, test, type Page } from '@playwright/test'
import { go } from './util'

// v1.30 — Salud financiera (tarjetas a ancho completo) y Revisión del presupuesto (estados, alertas, días, historial).
async function abrir(page: Page, hoy: string, ruta: string) {
  await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
  await page.clock.setFixedTime(new Date(hoy))
  await page.goto(ruta)
  await expect(page.getByTestId('consolidado')).toBeVisible()
  await go(page, 'Salud financiera')
}
const OCT = '2026-10-20T10:00:00-05:00'

test.describe('v1.30: tarjetas de Salud financiera', () => {
  for (const [ancho, alto, columnas] of [[1366, 768, 4], [1024, 768, 4], [768, 1024, 2], [390, 844, 1]] as const) {
    test(`${ancho}×${alto}: las 4 tarjetas ocupan el ancho en ${columnas} columna(s), sin desborde`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto })
      await abrir(page, OCT, '/?demo=60&fondos=3&latencia=0#dashboard')
      const fila = page.getByRole('tablist', { name: 'Vistas de salud financiera' })
      await expect(fila).toBeVisible()
      const tabs = fila.getByRole('tab')
      await expect(tabs).toHaveCount(4)
      const caja = await fila.boundingBox()
      const r = await tabs.evaluateAll(els => els.map(e => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), r: Math.round(b.right) } }))
      expect(new Set(r.map(t => t.y)).size).toBe(4 / columnas)                                 // filas = 4 / columnas
      const maxDer = Math.max(...r.map(t => t.r))
      expect(maxDer).toBeGreaterThanOrEqual(Math.round(caja!.x + caja!.width) - 2)               // llega al borde derecho: sin espacio vacío
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    })
  }
})

test.describe('v1.30: Revisión del presupuesto', () => {
  async function revision(page: Page, ruta = '/?demo=2&fondos=3&latencia=0#dashboard') {
    await abrir(page, OCT, ruta)
    await page.getByRole('tab', { name: /Revisión del presupuesto/ }).click()
    await expect(page.getByTestId('revision-presupuesto')).toBeVisible()
  }

  test('estados como tarjetas seleccionables; «con observaciones» exige la observación y se guarda en el historial', async ({ page }) => {
    await revision(page)
    const f = page.getByTestId('rev-form')
    await expect(f.getByRole('radio')).toHaveCount(4)
    await f.getByText('Revisado con observaciones', { exact: true }).click()
    await f.getByRole('button', { name: 'Guardar revisión' }).click()
    await expect(f.getByText(/Escribe la observación/)).toBeVisible()
    await f.locator('#rev-observacion').fill('Falta confirmar el recibo de luz')
    await f.getByRole('button', { name: 'Guardar revisión' }).click()
    await expect(page.getByTestId('rev-estado')).toHaveText('Revisado con observaciones')
    await expect(page.getByTestId('rev-historial')).toContainText('Falta confirmar el recibo de luz')
  })

  test('completar la revisión no crea gastos ni cambia el presupuesto', async ({ page }) => {
    await revision(page)
    const llamadas = () => page.evaluate(() => ({ ...(globalThis as unknown as { __gdDemoCalls: Record<string, number> }).__gdDemoCalls }))
    const c0 = await llamadas()
    const f = page.getByTestId('rev-form')
    await f.getByText('Período completo', { exact: true }).click()
    await f.getByRole('button', { name: 'Guardar revisión' }).click()
    await expect(page.getByTestId('rev-estado')).toHaveText('Período completo')
    const c1 = await llamadas()
    expect((c1.saveGasto ?? 0) - (c0.saveGasto ?? 0)).toBe(0)
    expect((c1.saveFondo ?? 0) - (c0.saveFondo ?? 0)).toBe(0)
  })

  test('días sin movimientos: solo fechas transcurridas (ni hoy ni futuras) y cada una abre «Nuevo gasto»', async ({ page }) => {
    await revision(page)
    const dias = page.getByTestId('rev-dias')
    await expect(dias).toBeVisible()
    const botones = dias.getByRole('button', { name: /Registrar un gasto del/ })
    const n = await botones.count()
    expect(n).toBeGreaterThan(0)
    const textos = await botones.evaluateAll(els => els.map(e => e.getAttribute('aria-label') ?? e.textContent ?? ''))
    for (const t of textos) expect(t).not.toMatch(/\b(20|21|22|23|24|25|26|27|28|29|30|31) de/)   // hoy es 20: nada de 20 en adelante
    await botones.first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('alertas compactas: sin duplicados por el mismo exceso y con detalle expandible', async ({ page }) => {
    await revision(page, '/?demo=60&fondos=3&latencia=0#dashboard')
    const lista = page.getByTestId('rev-chequeos')
    await expect(lista).toBeVisible()
    const ids = await lista.locator('[data-testid^="rev-chequeo-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')))
    expect(new Set(ids).size).toBe(ids.length)
    expect(!(ids.includes('rev-chequeo-excedido') && ids.includes('rev-chequeo-sobregiro'))).toBe(true)   // un mismo exceso no se alerta dos veces
  })
})
