import { expect, test, type Page } from '@playwright/test'
import { newGasto } from './util'

// v1.25 — Iconos coherentes en el Presupuesto consolidado y explorador de gasto acumulado/diario. Modo demostración
// (hoy = 19/10/2026 en la demo: días con gasto 1–17, el 8 sin gasto, del 20 en adelante son proyección).

const money = (s: string) => Number(s.replace(/[^\d.-]/g, ''))
const sinScrollH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const detalle = (page: Page) => page.getByTestId('detalle-dia')
const grafico = (page: Page, n: 0 | 1) => page.locator('[data-testid="explorador-gasto"] .recharts-wrapper').nth(n)

async function abrir(page: Page, w = 1366, h = 900) {
  await page.setViewportSize({ width: w, height: h })
  await page.goto('/?demo=60&fuentes=3')
  await expect(page.getByTestId('explorador-gasto')).toBeAttached()
  await page.getByTestId('explorador-gasto').scrollIntoViewIfNeeded()
}
/** Centro (x) de la etiqueta del día en el eje del gráfico n. */
async function xDia(page: Page, n: 0 | 1, dia: number) {
  const t = grafico(page, n).locator('.recharts-xAxis-tick-labels text', { hasText: new RegExp(`^${dia}$`) }).first()
  const b = (await t.boundingBox())!
  return b.x + b.width / 2
}
async function clic(page: Page, n: 0 | 1, dia: number, tap = false) {
  const w = (await grafico(page, n).boundingBox())!
  const x = await xDia(page, n, dia)
  const y = w.y + (n === 0 ? w.height * 0.4 : 25)
  if (tap) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y)
}
const lineaX = async (page: Page, n: 0 | 1) => { const b = (await grafico(page, n).locator('.recharts-reference-line line').first().boundingBox())!; return b.x }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
})

test.describe('Iconografía del Presupuesto consolidado', () => {
  for (const [w, h] of [[1366, 768], [390, 844]] as const) {
    test(`${w}×${h}: los 12 indicadores tienen icono a la izquierda del título, ⓘ a la derecha y sin desborde`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/?demo=60&fuentes=3')
      const ids = ['cons-presupuesto-consolidado', 'cons-gastado-del-período', 'cons-disponible-consolidado', 'cons-reservado-en-cajas', 'cons-libre-inicial', 'cons-gastado-fuera-de-reservas', 'cons-saldo-libre-actual', 'cons-consumido',
        'kpi-promedio-diario', 'kpi-promedio-por-movimiento', 'kpi-mayor-gasto', 'kpi-movimientos']
      for (const id of ids) {
        const c = page.getByTestId(id)
        await expect(c, id).toBeVisible()
        const ico = (await c.locator('svg').first().boundingBox())!, titulo = (await c.locator('p').first().boundingBox())!
        expect(ico.x + ico.width, `${id}: icono a la izquierda del título`).toBeLessThanOrEqual(titulo.x + 2)
        const info = (await c.getByRole('button', { name: /^Información:/ }).boundingBox())!
        expect(info.x, `${id}: ⓘ a la derecha`).toBeGreaterThan(titulo.x)
      }
      // tamaño de icono por nivel: principal > secundario, y mismo tamaño dentro de cada nivel
      const tam = async (id: string) => (await page.getByTestId(id).locator('span[aria-hidden="true"]').first().boundingBox())!.width
      const principales = await Promise.all(ids.slice(0, 4).map(tam)), secundarios = await Promise.all(ids.slice(4, 8).map(tam)), complementarios = await Promise.all(ids.slice(8).map(tam))
      expect(new Set(principales).size).toBe(1); expect(new Set(secundarios).size).toBe(1); expect(new Set(complementarios).size).toBe(1)
      expect(principales[0]).toBeGreaterThan(complementarios[0]); expect(complementarios[0]).toBeGreaterThan(secundarios[0])
      expect(await sinScrollH(page)).toBe(true)
    })
  }

  test('los iconos nuevos son los pedidos y el bloque no crece en escritorio', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?demo=60&fuentes=3')
    for (const [id, cls] of [['cons-libre-inicial', 'lucide-wallet'], ['cons-gastado-fuera-de-reservas', 'lucide-arrow-up-right'], ['cons-saldo-libre-actual', 'lucide-scale'], ['cons-consumido', 'lucide-gauge']] as const) {
      await expect(page.getByTestId(id).locator(`svg.${cls}`).first(), id).toBeVisible()
    }
    const h = (await page.getByTestId('consolidado').boundingBox())!.height
    expect(h).toBeLessThanOrEqual(420)
  })
})

test.describe('Explorador de gasto acumulado y diario', () => {
  test('clic en el gráfico de líneas selecciona el día y resalta ambos gráficos; el detalle coincide con los movimientos', async ({ page }) => {
    await abrir(page)
    await expect(page.getByTestId('detalle-dia-ayuda')).toBeVisible()
    await clic(page, 0, 6)
    await expect(detalle(page)).toHaveAttribute('data-fecha', '2026-10-06')
    await expect(page.getByTestId('detalle-dia-fecha')).toContainText('06/10/2026')
    // línea de referencia en ambos gráficos, sobre el mismo día; la curva completa sigue visible
    await expect(page.locator('[data-testid="explorador-gasto"] .recharts-reference-line')).toHaveCount(2)
    expect(Math.abs((await lineaX(page, 0)) - (await xDia(page, 0, 6)))).toBeLessThan(6)
    expect(Math.abs((await lineaX(page, 1)) - (await xDia(page, 1, 6)))).toBeLessThan(6)
    await expect(grafico(page, 0).locator('.recharts-area-curve')).toBeVisible()
    await expect(grafico(page, 0).locator('.recharts-reference-dot')).toHaveCount(1)
    // detalle: cantidad, suma de importes = gasto del día; acumulado ≥ gasto del día
    const n = await page.getByTestId('detalle-dia-mov').count()
    expect(n).toBeGreaterThan(0)
    expect(Number(await page.getByTestId('detalle-dia-cantidad').innerText())).toBe(n)
    const importes = await page.getByTestId('detalle-dia-mov').evaluateAll(els => els.map(e => e.querySelector('.tabular.text-\\[13px\\]')!.textContent!))
    const suma = importes.reduce((s, t) => s + money(t), 0)
    expect(money(await page.getByTestId('detalle-dia-gasto').innerText())).toBeCloseTo(suma, 2)
    expect(money(await page.getByTestId('detalle-dia-acumulado').innerText())).toBeGreaterThanOrEqual(suma)
    await expect(page.getByTestId('detalle-dia-categorias')).toBeVisible()
  })

  test('clic en una barra selecciona y sincroniza; cambiar de día; clic en el mismo día y «Limpiar selección» deseleccionan', async ({ page }) => {
    await abrir(page)
    await clic(page, 1, 7)
    await expect(detalle(page)).toHaveAttribute('data-fecha', '2026-10-07')
    expect(Math.abs((await lineaX(page, 0)) - (await xDia(page, 0, 7)))).toBeLessThan(6)       // el gráfico superior sigue a la barra
    await clic(page, 0, 11)
    await expect(detalle(page)).toHaveAttribute('data-fecha', '2026-10-11')                     // cambiar de fecha
    expect(Math.abs((await lineaX(page, 1)) - (await xDia(page, 1, 11)))).toBeLessThan(6)       // la barra sigue a la línea
    await clic(page, 1, 11)                                                                      // mismo día: deselecciona
    await expect(detalle(page)).toHaveCount(0)
    await clic(page, 0, 14)
    await expect(detalle(page)).toHaveAttribute('data-fecha', '2026-10-14')
    await page.getByRole('button', { name: 'Limpiar selección' }).click()
    await expect(detalle(page)).toHaveCount(0)
    await expect(page.locator('[data-testid="explorador-gasto"] .recharts-reference-line')).toHaveCount(0)
    await expect(page.getByTestId('detalle-dia-ayuda')).toBeVisible()
  })

  test('día sin gastos: estado vacío y acumulado igual al del día anterior; la curva no cambia', async ({ page }) => {
    await abrir(page)
    await clic(page, 0, 7)
    const acum7 = money(await page.getByTestId('detalle-dia-acumulado').innerText())
    await clic(page, 0, 8)
    await expect(detalle(page)).toHaveAttribute('data-fecha', '2026-10-08')
    await expect(page.getByTestId('detalle-dia-vacio')).toBeVisible()
    await expect(page.getByTestId('detalle-dia-lista')).toHaveCount(0)
    expect(money(await page.getByTestId('detalle-dia-gasto').innerText())).toBe(0)               // gasto diario ≠ acumulado
    expect(money(await page.getByTestId('detalle-dia-acumulado').innerText())).toBe(acum7)
  })

  test('día futuro: proyección sin movimientos ficticios', async ({ page }) => {
    await abrir(page)
    await clic(page, 0, 25)
    await expect(detalle(page)).toHaveAttribute('data-fecha', '2026-10-25')
    await expect(page.getByTestId('detalle-dia-proyeccion')).toContainText('sin movimientos reales')
    await expect(page.getByTestId('detalle-dia-mov')).toHaveCount(0)
    await expect(page.getByTestId('detalle-dia-lista')).toHaveCount(0)
    await expect(page.getByTestId('detalle-dia-cantidad')).toHaveCount(0)
    await expect(grafico(page, 0).locator('.recharts-reference-dot')).toHaveCount(1)
  })

  test('la selección no altera período, totales del Presupuesto consolidado ni KPIs', async ({ page }) => {
    await abrir(page)
    const leer = async () => ({
      g: await page.getByTestId('cons-gastado-del-período').innerText(), p: await page.getByTestId('cons-presupuesto-consolidado').innerText(),
      d: await page.getByTestId('cons-disponible-consolidado').innerText(), k: await page.getByTestId('kpis').innerText(),
      periodo: await page.getByRole('button', { name: 'Período', exact: true }).innerText(),
    })
    const antes = await leer()
    await clic(page, 0, 6); await clic(page, 1, 14); await clic(page, 0, 25)
    expect(await leer()).toEqual(antes)
  })

  test('el total del gráfico acumulado no cambia al seleccionar (curva intacta) y el último día real coincide con «Real»', async ({ page }) => {
    await abrir(page)
    const real = money(await page.getByText(/^Real:/).first().innerText())
    await clic(page, 0, 17)
    expect(money(await page.getByTestId('detalle-dia-acumulado').innerText())).toBeCloseTo(real, 2)
    await clic(page, 0, 3)
    await expect(page.getByText(/^Real:/).first()).toContainText(String(real.toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ','))
  })

  test('filtros: el detalle usa solo los movimientos que cumplen el filtro y el cambio de mes restablece la selección', async ({ page }) => {
    await abrir(page)
    await clic(page, 0, 6)
    const todos = await page.getByTestId('detalle-dia-mov').count()
    await page.getByRole('button', { name: 'Ámbito', exact: true }).click()
    await page.getByRole('listbox', { name: 'Ámbito' }).getByRole('option', { name: 'Personal', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(detalle(page)).toHaveAttribute('data-fecha', '2026-10-06')
    const personal = await page.getByTestId('detalle-dia-mov').count()
    expect(personal).toBeLessThanOrEqual(todos)
    for (const t of await page.getByTestId('detalle-dia-mov').allInnerTexts()) expect(t).toContain('Personal')
    await page.getByRole('button', { name: 'Mes anterior' }).click()
    await expect(detalle(page)).toHaveCount(0)                                                    // otro período: sin selección
    await expect(page.getByTestId('detalle-dia-ayuda')).toBeVisible()
  })

  test('teclado y accesibilidad: grupo con nombre, ← → cambian de día, Inicio/Fin, Esc limpia, región en vivo', async ({ page }) => {
    await abrir(page)
    const grupo = page.getByRole('group', { name: /Gasto acumulado y gasto diario/ })
    await expect(grupo).toBeVisible()
    await grupo.focus()
    await page.keyboard.press('ArrowRight')
    const f0 = await detalle(page).getAttribute('data-fecha')
    expect(f0).toBe('2026-10-19')                                                                 // sin selección previa: último día real
    await page.keyboard.press('ArrowLeft')
    await expect(detalle(page)).toHaveAttribute('data-fecha', '2026-10-18')
    await page.keyboard.press('Home')
    await expect(detalle(page)).toHaveAttribute('data-fecha', '2026-10-01')
    await page.keyboard.press('End')
    await expect(detalle(page)).toHaveAttribute('data-fecha', '2026-10-31')
    await page.keyboard.press('Escape')
    await expect(detalle(page)).toHaveCount(0)
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('detalle-dia-region')).toHaveAttribute('aria-live', 'polite')
    await expect(page.getByRole('region', { name: /^Detalle del/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Limpiar selección' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Movimientos del día' }).or(page.getByTestId('detalle-dia-vacio'))).toBeVisible()
  })

  test('tooltips: línea con acumulado, gasto del día y diferencia frente al ideal; barra con gasto, movimientos y participación', async ({ page }) => {
    await abrir(page)
    const w0 = (await grafico(page, 0).boundingBox())!
    await page.mouse.move(await xDia(page, 0, 6), w0.y + w0.height * 0.4)
    const tip = page.locator('[data-testid="explorador-gasto"] .recharts-tooltip-wrapper').first()
    await expect(tip).toContainText('Acumulado hasta este día')
    await expect(tip).toContainText('Gasto de este día')
    await expect(tip).toContainText('Ritmo ideal acumulado')
    await expect(tip).toContainText(/Por (encima|debajo) del ideal|Igual al ideal/)
    const w1 = (await grafico(page, 1).boundingBox())!
    await page.mouse.move(await xDia(page, 1, 6), w1.y + 25)
    const tip2 = page.locator('[data-testid="explorador-gasto"] .recharts-tooltip-wrapper').nth(1)
    await expect(tip2).toContainText('Gasto diario')
    await expect(tip2).toContainText('Movimientos')
    await expect(tip2).toContainText('Del gasto del período')
  })

  test('sin consultas al backend, sin errores de consola y sin desborde al seleccionar', async ({ page }) => {
    const errores: string[] = []
    page.on('console', m => { if (m.type() === 'error') errores.push(m.text()) })
    page.on('pageerror', e => errores.push(String(e)))
    await abrir(page)
    const peticiones: string[] = []
    page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().includes('localhost')) peticiones.push(r.url()) })
    page.on('request', r => { if (r.method() !== 'GET' && !r.url().startsWith('data:')) peticiones.push(`${r.method()} ${r.url()}`) })
    for (const d of [2, 6, 11, 14, 17, 8, 25]) { await clic(page, d % 2 ? 0 : 1, d) }
    await page.getByRole('button', { name: 'Limpiar selección' }).click()
    expect(peticiones).toEqual([])
    expect(errores).toEqual([])
    expect(await sinScrollH(page)).toBe(true)
  })

  test('muchos movimientos el mismo día: lista con scroll interno, altura acotada y cantidad correcta', async ({ page }) => {
    await abrir(page)
    for (let i = 1; i <= 7; i++) await newGasto(page, { monto: String(10 + i), desc: `Mov masivo ${i}` })
    await page.getByTestId('explorador-gasto').scrollIntoViewIfNeeded()
    await clic(page, 0, 19)
    await expect(detalle(page)).toHaveAttribute('data-fecha', '2026-10-19')
    const n = await page.getByTestId('detalle-dia-mov').count()
    expect(n).toBeGreaterThanOrEqual(7)
    expect(Number(await page.getByTestId('detalle-dia-cantidad').innerText())).toBe(n)
    const lista = page.getByTestId('detalle-dia-lista')
    await expect(lista).toHaveCSS('overflow-y', 'auto')
    expect((await lista.boundingBox())!.height).toBeLessThanOrEqual(212)
    expect(await lista.evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true)
    await expect(page.getByText('Mov masivo 7')).toBeAttached()
  })
})

test.describe('Explorador en móvil', () => {
  test.use({ hasTouch: true })
  test('toque en barra y en línea, sin desborde y con panel legible a 390 px', async ({ page }) => {
    await abrir(page, 390, 844)
    await clic(page, 0, 6, true).catch(async () => { /* algunas etiquetas se omiten por espacio */ })
    // en móvil el eje omite etiquetas: se toca el centro de la columna 14 del gráfico de barras
    const w = (await grafico(page, 1).boundingBox())!
    await page.touchscreen.tap(w.x + w.width * 0.5, w.y + 25)
    await expect(detalle(page)).toBeVisible()
    const f1 = await detalle(page).getAttribute('data-fecha')
    const wl = (await grafico(page, 0).boundingBox())!
    await page.touchscreen.tap(wl.x + wl.width * 0.2, wl.y + wl.height * 0.4)
    await expect(detalle(page)).toBeVisible()
    expect(await detalle(page).getAttribute('data-fecha')).not.toBe(f1)
    const p = (await detalle(page).boundingBox())!
    expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x + p.width).toBeLessThanOrEqual(390 + 1)
    expect(await sinScrollH(page)).toBe(true)
  })
})
