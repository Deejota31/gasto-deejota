import { expect, test, type Page } from '@playwright/test'
import { go, newGasto } from './util'

// v1.24 — Dashboard: Presupuesto consolidado rediseñado y cuatro KPIs no duplicados. Modo demostración.

const money = (s: string) => Number(s.replace(/[^\d.-]/g, ''))
const sinScrollH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const celda = (page: Page, id: string) => page.getByTestId(`cons-${id}`).locator('p').nth(1)
const cajas = (page: Page, selector: string) => page.locator(selector).evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }))

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
})

const KPIS = ['Promedio diario', 'Promedio por movimiento', 'Mayor gasto', 'Movimientos']
const KPI_SEL = '[data-testid="kpis"] > div'

test.describe('KPIs complementarios: dentro del Presupuesto consolidado, compactos', () => {
  test('1366×768: cuatro mini-tarjetas en una fila, al final del bloque, bajas y sin sección separada', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?demo=60&fondos=3')
    await expect(page.getByTestId('kpis').locator('> div p:first-of-type')).toHaveText(KPIS)
    await expect(page.getByTestId('consolidado').getByTestId('kpis')).toBeVisible()
    await expect(page.getByTestId('kpis')).toHaveCount(1)
    const t = await cajas(page, KPI_SEL)
    expect(t).toHaveLength(4)
    expect(new Set(t.map(c => c.y)).size).toBe(1)
    expect(Math.max(...t.map(c => c.h))).toBeLessThanOrEqual(84)                       // compactas
    const bloque = (await page.getByTestId('consolidado').boundingBox())!
    const ultimo = (await page.getByTestId('kpis').boundingBox())!
    expect(Math.abs(ultimo.y + ultimo.height - (bloque.y + bloque.height))).toBeLessThanOrEqual(2)   // al final del bloque
    expect(await sinScrollH(page)).toBe(true)
  })

  for (const [w, h, filas] of [[1024, 768, 1], [834, 1112, 2], [768, 1024, 2], [430, 932, 2], [390, 844, 2], [360, 740, 2]] as const) {
    test(`${w}×${h}: ${filas} fila(s), sin desborde ni superposición`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/?demo=60&fondos=3')
      await expect(page.getByTestId('kpis')).toBeVisible()
      const t = await cajas(page, KPI_SEL)
      expect(new Set(t.map(c => c.y)).size, `${w}px`).toBe(filas)
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
        const a = t[i], b = t[j]
        const solapa = a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1
        expect(solapa, `tarjetas ${i} y ${j} a ${w}px`).toBe(false)
      }
      expect(await sinScrollH(page), `${w}px`).toBe(true)
    })
  }
})

test.describe('Filtros superiores', () => {
  test('1366×768: seis filtros en una fila, altura compacta, Período y textos largos con más ancho', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?demo=60&fondos=3')
    const nombres = ['Ámbito', 'Categoría', 'Subcategoría', 'Medio de pago', 'Tipo de gasto']
    const bs = await Promise.all(nombres.map(async n => (await page.getByRole('button', { name: n, exact: true }).boundingBox())!))
    const periodo = (await page.getByRole('button', { name: /^Período/ }).first().boundingBox())!
    expect(new Set([...bs.map(b => Math.round(b.y)), Math.round(periodo.y)]).size).toBe(1)
    for (const b of bs) expect(b.height).toBeLessThanOrEqual(44)
    const [amb, cat, sub, med, tipo] = bs.map(b => b.width)
    expect(sub).toBeGreaterThan(cat); expect(cat).toBeGreaterThan(med); expect(med).toBeGreaterThan(tipo); expect(tipo).toBeGreaterThan(amb)
    expect(periodo.width).toBeGreaterThan(amb)
    expect(await sinScrollH(page)).toBe(true)
  })
})

test.describe('Presupuesto consolidado', () => {
  test('conserva los ocho valores (cifras clave en línea arriba, indicadores debajo)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?demo=60&fondos=3')
    const ids = ['presupuesto-consolidado', 'gastado-del-período', 'disponible-consolidado', 'reservado-en-cajas', 'libre-inicial', 'gastado-fuera-de-reservas', 'saldo-libre-actual', 'consumido']
    for (const id of ids) await expect(page.getByTestId(`cons-${id}`)).toBeVisible()
    await expect(page.getByTestId('consolidado').locator('[data-testid^="cons-"]')).toHaveCount(8)
    // todos en el mismo orden visual: principales arriba, secundarios debajo
    const ys = await Promise.all(ids.map(async id => (await page.getByTestId(`cons-${id}`).boundingBox())!.y))
    expect(Math.max(...ys.slice(0, 4))).toBeLessThan(Math.min(...ys.slice(4)))
  })


  test('barra segmentada: tooltip con nombre e importe, leyenda y teclado', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?demo=60&fondos=3&cajas=3')
    const barra = page.getByTestId('barra-presupuesto')
    await expect(barra).toBeVisible()
    await expect(barra.getByRole('list', { name: 'Leyenda de la distribución' })).toContainText('Gastado fuera de reservas')
    await expect(barra.getByRole('list', { name: 'Leyenda de la distribución' })).toContainText('Reservas sin utilizar')
    const seg = barra.locator('[data-segmento="fuera"]')
    await seg.focus()
    await expect(page.getByRole('tooltip')).toContainText('Gastado fuera de reservas')
    await expect(page.getByRole('tooltip')).toContainText('S/')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await seg.hover()
    await expect(page.getByRole('tooltip')).toContainText('del presupuesto')
    // los tramos nunca desbordan la pista
    const caja = (await barra.getByRole('group').boundingBox())!
    for (const s of await barra.locator('[data-segmento]').all()) {
      const b = (await s.boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(caja.x + caja.width + 1)
    }
  })

  test('presupuesto excedido: advertencia con el importe calculado, saldo negativo, barra acotada y sin errores de consola', async ({ page }) => {
    const errores: string[] = []
    page.on('console', m => { if (m.type() === 'error') errores.push(m.text()) })
    page.on('pageerror', e => errores.push(String(e)))
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?demo=60&fondos=3')
    const estado = page.getByTestId('consolidado-estado')
    await expect(estado).toBeVisible()
    const disp0 = money(await celda(page, 'disponible-consolidado').innerText())
    expect(disp0).toBeGreaterThan(0)
    await expect(estado).not.toContainText('excedido')
    const monto = Math.ceil(disp0 + 347.25)                                // se pasa por un importe conocido
    await newGasto(page, { ambito: 'Personal', categoria: 'Alimentación', sub: 'Almuerzo', monto: String(monto), desc: 'Exceso e2e' })
    await expect(estado).toContainText('Presupuesto excedido en')
    const disp = money(await celda(page, 'disponible-consolidado').innerText())
    expect(disp).toBeLessThan(0)
    expect(money(await estado.innerText())).toBeCloseTo(-disp, 2)          // el importe de la advertencia es el calculado
    await expect(celda(page, 'disponible-consolidado')).toHaveCSS('color', /.+/)
    await expect(estado).toHaveAttribute('data-tono', 'alerta')
    expect(Number((await celda(page, 'consumido').innerText()).replace('%', ''))).toBeGreaterThan(100)
    await expect(page.getByTestId('barra-limite')).toBeVisible()
    const pista = (await page.getByTestId('barra-presupuesto').getByRole('group').boundingBox())!
    for (const s of await page.locator('[data-segmento]').all()) {
      const b = (await s.boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(pista.x + pista.width + 1)
    }
    const pb = page.getByRole('progressbar', { name: 'Consumido' })
    expect(await pb.locator('span').evaluate(e => (e as HTMLElement).style.width)).toBe('100%')
    expect(await sinScrollH(page)).toBe(true)
    expect(errores).toEqual([])
  })

  test('los filtros no cambian el presupuesto (período completo) pero sí los KPIs complementarios', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3')
    const p0 = await celda(page, 'presupuesto-consolidado').innerText(), g0 = await celda(page, 'gastado-del-período').innerText()
    const n0 = Number((await page.getByTestId('kpis').getByText(/^\d+$/).first().innerText()))
    await page.getByRole('button', { name: 'Ámbito', exact: true }).click()
    await page.getByRole('listbox', { name: 'Ámbito' }).getByRole('option', { name: 'Personal', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect.poll(async () => Number(await page.getByTestId('kpis').getByText(/^\d+$/).first().innerText())).toBeLessThan(n0)
    expect(await celda(page, 'presupuesto-consolidado').innerText()).toBe(p0)
    expect(await celda(page, 'gastado-del-período').innerText()).toBe(g0)
  })

  test('oscuro: el estado y los tramos se ven y no hay desborde', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('deejota.tema', 'dark'); localStorage.setItem('theme', 'dark') } catch { /* */ } })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/?demo=60&fondos=3')
    await expect(page.getByTestId('consolidado-estado')).toBeVisible()
    await expect(page.getByTestId('barra-presupuesto')).toBeVisible()
    expect(await sinScrollH(page)).toBe(true)
    await go(page, 'Gastos'); await go(page, 'Dashboard')
    await expect(page.getByTestId('kpis')).toBeVisible()
  })
})
