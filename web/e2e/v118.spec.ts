import { expect, test, type Page } from '@playwright/test'

// v1.18 — Design System. Modo demostración (sin Google Sheets). Verifica estilos CALCULADOS, no solo que compile.
async function go(page: Page, tab: string) {
  const nav = page.getByRole('navigation', { name: 'Secciones' }).filter({ visible: true }).first()
  const b = nav.getByRole('button', { name: tab, exact: true })
  if (await b.count()) { await b.click(); return }
  const menu = page.getByRole('button', { name: 'Abrir navegación' })
  if (await menu.count()) { await menu.click(); await page.getByRole('dialog', { name: 'Navegación' }).getByRole('button', { name: tab, exact: true }).click(); return }
  await nav.getByRole('button', { name: 'Más', exact: true }).click()
  await page.getByRole('dialog', { name: 'Más opciones' }).getByRole('button', { name: new RegExp(`^${tab}`) }).click()
}
const estilo = (l: ReturnType<Page['locator']>) => l.evaluate(e => { const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return { bg: c.backgroundColor, fg: c.color, radio: c.borderRadius, fs: c.fontSize, fw: c.fontWeight, h: Math.round(r.height), px: c.paddingLeft } })
const token = (page: Page, v: string) => page.evaluate(n => { const d = document.createElement('div'); d.style.color = `var(${n})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c }, v)
const sinScrollH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`Design System (${tema})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: tema })
      await page.addInitScript(t => { try { localStorage.setItem('deejota.tema', t); localStorage.setItem('theme', t) } catch { /* */ } }, tema)
      await page.setViewportSize({ width: 1366, height: 768 })
      await page.goto('/?demo=60&fuentes=3')
      await expect(page.getByTestId('cons-gastado-del-período')).toBeVisible()
      if (tema === 'dark') {
        await go(page, 'Configuración')
        await page.locator('#cfg-tema').click()
        await page.getByRole('listbox').getByRole('option', { name: /Oscuro/ }).click()
        await go(page, 'Dashboard')
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', tema)
      await page.waitForTimeout(500)   // termina la transición de colores del cambio de tema
    })

    test('todos los switches: mismo azul ON y mismo gris OFF (Cajas, Catálogo y Configuración)', async ({ page }) => {
      const primary = await token(page, '--primary'), off = await token(page, '--switch-off')
      const ons = new Set<string>(), offs = new Set<string>()
      for (const tab of ['Cajas', 'Catálogo', 'Configuración']) {
        await go(page, tab)
        await page.waitForTimeout(300)
        const sw = page.locator('[role="switch"]:visible')
        const n = await sw.count()
        expect(n, `switches en ${tab}`).toBeGreaterThan(0)
        for (let i = 0; i < n; i++) {
          const el = sw.nth(i)
          const on = (await el.getAttribute('aria-checked')) === 'true'
          const c = await el.locator('[data-ds="switch"]').evaluate(e => getComputedStyle(e).backgroundColor)
          const dim = await el.locator('[data-ds="switch"]').evaluate(e => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}` })
          expect(dim).toBe('36x20')
          ;(on ? ons : offs).add(c)
        }
      }
      expect([...ons]).toEqual([primary])
      if (offs.size) expect([...offs]).toEqual([off])
    })

    test('botones Nuevo gasto / Nueva fuente / Nueva caja idénticos y mensuales idénticos; Nuevo siempre antes', async ({ page }) => {
      const nuevo: Record<string, unknown> = {}, mensual: Record<string, unknown> = {}
      nuevo.gasto = await estilo(page.getByRole('button', { name: 'Nuevo gasto' }).first())
      mensual.gasto = await estilo(page.getByRole('button', { name: 'Gastos mensuales' }).first())
      await go(page, 'Cajas')
      nuevo.fuente = await estilo(page.getByRole('button', { name: 'Nueva fuente' }).first())
      mensual.fuente = await estilo(page.getByRole('button', { name: 'Fuentes mensuales' }).first())
      nuevo.subcaja = await estilo(page.getByRole('button', { name: 'Nueva caja' }).first())
      mensual.subcaja = await estilo(page.getByRole('button', { name: 'Cajas mensuales' }).first())
      expect(nuevo.fuente).toEqual(nuevo.gasto); expect(nuevo.subcaja).toEqual(nuevo.gasto)
      expect(mensual.fuente).toEqual(mensual.gasto); expect(mensual.subcaja).toEqual(mensual.gasto)
      expect(nuevo.gasto).not.toEqual(mensual.gasto)
    })

    test('orden DOM: Nuevo → Mensuales en cada módulo', async ({ page }) => {
      const orden = async (a: string, b: string) => {
        const ba = await page.getByRole('button', { name: a }).first().boundingBox(), bb = await page.getByRole('button', { name: b }).first().boundingBox()
        expect(ba!.x + ba!.y * 2000).toBeLessThan(bb!.x + bb!.y * 2000)
      }
      await orden('Nuevo gasto', 'Gastos mensuales')
      await go(page, 'Gastos'); await orden('Nuevo gasto', 'Gastos mensuales')
      await go(page, 'Cajas'); await orden('Nueva fuente', 'Fuentes mensuales'); await orden('Nueva caja', 'Cajas mensuales')
    })

    test('menú ⋯: orden canónico, iconos de 16px y Eliminar con el rojo semántico', async ({ page }) => {
      await go(page, 'Cajas')
      const danger = await token(page, '--danger')
      await page.getByRole('button', { name: /^Más acciones de la fuente / }).first().click()
      const items = page.getByRole('menuitem')
      expect((await items.allInnerTexts()).map(t => t.trim())).toEqual(['Clonar', 'Guardar como plantilla', 'Subir', 'Bajar', 'Eliminar'])
      expect((await estilo(items.last())).fg).toBe(danger)
      const tam = await items.evaluateAll(els => els.map(e => { const r = e.querySelector('svg')!.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}` }))
      expect(new Set(tam)).toEqual(new Set(['16x16']))
      const hs = await items.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)))
      expect(new Set(hs).size).toBe(1)
      await page.keyboard.press('Escape')
      // Subcajas: mismo menú
      const mc = page.getByTestId('caja-fila').first().getByRole('button', { name: /^Más acciones de / })
      await mc.scrollIntoViewIfNeeded(); await page.waitForTimeout(250); await mc.click()
      expect((await page.getByRole('menuitem').allInnerTexts()).map(t => t.trim())).toEqual(['Clonar', 'Guardar como plantilla', 'Subir', 'Bajar', 'Eliminar'])
      expect((await estilo(page.getByRole('menuitem').last())).fg).toBe(danger)
    })

    test('Editar: mismo estilo en fuentes y subcajas; botón Eliminar de confirmación usa Danger', async ({ page }) => {
      await go(page, 'Cajas')
      const ef = await estilo(page.getByRole('button', { name: /^Editar fuente / }).first())
      const ec = await estilo(page.locator('button[title="Editar"]:visible').last())
      expect(ec).toEqual(ef)
      // Eliminar (confirmación) = variante Danger: se crea una plantilla de prueba y se elimina
      await page.getByRole('button', { name: 'Fuentes mensuales' }).first().click()
      await page.getByRole('dialog').getByRole('button', { name: /Nueva plantilla/ }).click()
      await page.getByRole('menuitem', { name: 'Crear desde cero' }).click()
      await page.locator('#pf-nombre').fill('Temporal'); await page.locator('#pf-monto').fill('1')
      await page.getByRole('button', { name: 'Guardar plantilla' }).click()
      await page.getByRole('button', { name: 'Más acciones de la plantilla Temporal' }).click()
      await page.getByRole('menuitem', { name: 'Eliminar' }).click()
      const solido = await token(page, '--danger-solid')
      const btn = page.getByRole('dialog').last().getByRole('button', { name: 'Eliminar', exact: true })
      expect((await estilo(btn)).bg).toBe(solido)
    })
  })
}

test.describe('Design System: catálogo y responsive', () => {
  test('los colores del catálogo siguen viniendo del catálogo (no de tokens del sistema)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?demo=60')
    await expect(page.getByTestId('cons-gastado-del-período')).toBeVisible()
    await go(page, 'Catálogo')
    const colores = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[style*="color"]')].map(e => e.style.color).filter(Boolean))
    const propios = new Set(colores.filter(c => !c.startsWith('var(')))
    expect(propios.size, 'colores propios del catálogo').toBeGreaterThan(2)
  })

  for (const [w, h] of [[1920, 1080], [1440, 900], [1366, 768], [1024, 768], [768, 1024], [430, 932], [390, 844], [375, 667], [320, 568]] as const) {
    test(`${w}×${h}: sin desborde y botones de módulo en orden`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/?demo=60&fuentes=3')
      await expect(page.getByTestId('cons-gastado-del-período')).toBeVisible()
      for (const tab of ['Dashboard', 'Gastos', 'Cajas', 'Catálogo', 'Salud financiera', 'Configuración']) {
        await go(page, tab); await page.waitForTimeout(200)
        expect(await sinScrollH(page), `${tab} a ${w}px`).toBe(true)
      }
      await go(page, 'Cajas')
      const nf = await page.getByRole('button', { name: 'Nueva fuente' }).first().boundingBox(), mf = await page.getByRole('button', { name: 'Fuentes mensuales' }).first().boundingBox()
      expect(nf!.x + nf!.y * 2000).toBeLessThan(mf!.x + mf!.y * 2000)
      expect(nf!.x + nf!.width).toBeLessThanOrEqual(w + 1)
      expect(mf!.x + mf!.width).toBeLessThanOrEqual(w + 1)
    })
  }
})
