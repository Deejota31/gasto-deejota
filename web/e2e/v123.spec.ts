import { expect, test, type Page } from '@playwright/test'
import { dialog, go, newGasto } from './util'

// v1.23 — correcciones de la auditoría (P1–P7). Modo demostración.

test.describe('P1: la fecha de hoy no se congela', () => {
  test('al pasar la medianoche el Dashboard y la Revisión del presupuesto avanzan solos', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
    await page.clock.install({ time: new Date('2026-10-15T23:58:00-05:00') })
    await page.goto('/?demo=60&fondos=3&cajas=3&latencia=0#dashboard')
    await expect(page.getByText('15 días transcurridos')).toBeVisible()
    await page.clock.runFor(3 * 60_000)                         // 00:01 del 16/10
    await expect(page.getByText('16 días transcurridos')).toBeVisible()
    await expect(page.getByText('15 días transcurridos')).toHaveCount(0)
    // Revisión del presupuesto: el período por defecto es el mes de hoy
    await page.evaluate(() => { location.hash = '#salud' })
    await page.getByRole('tab', { name: /Revisión del presupuesto/ }).click()
    await expect(page.getByTestId('revision-presupuesto')).toContainText('Octubre 2026')
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

const dinero = (t: string) => Number(t.match(/[\d,]+\.\d{2}/)![0].replace(/,/g, ''))
// "Total gastado" ya no es una tarjeta: el Dashboard lo muestra como "Gastado del período" en el Presupuesto consolidado.
const kpiTotal = (page: Page) => page.getByTestId('cons-gastado-del-período').locator('p').nth(1)

test.describe('P4: los errores de validación se borran al corregir el campo', () => {
  test('Nuevo gasto: monto y medio de pago', async ({ page }) => {
    await page.goto('/?demo=60')
    await expect(page.getByRole('button', { name: 'Nuevo gasto' })).toBeEnabled()
    await page.getByRole('button', { name: 'Nuevo gasto' }).click()
    const d = dialog(page)
    await d.getByRole('button', { name: 'Registrar gasto' }).click()
    await expect(d.getByText('Elige un medio de pago')).toBeVisible()
    await d.getByRole('radiogroup', { name: 'Medio de pago' }).getByRole('radio').first().click()
    await expect(d.getByText('Elige un medio de pago')).toHaveCount(0)
    await d.getByLabel('Monto', { exact: true }).fill('12')
    await expect(d.getByText(/monto/i).filter({ hasText: /mayor|inválido|Ingresa/i })).toHaveCount(0)
  })

  test('Nueva categoría: el aviso de duplicado desaparece y no aparece el de "otro ámbito" en el mismo ámbito', async ({ page }) => {
    await page.goto('/?demo=60')
    await go(page, 'Catálogo')
    await page.getByRole('button', { name: 'Agregar', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Nueva categoría' }).click()
    const d = dialog(page)
    const nombre = d.getByLabel('Nombre', { exact: true })
    await nombre.fill('Alimentación')
    await d.getByRole('button', { name: 'Agregar', exact: true }).click()
    const dup = d.getByText(/Ya existe ese nombre/)
    await expect(dup).toBeVisible()
    await expect(d.getByText(/ya existe en otro ámbito/)).toHaveCount(0)
    await nombre.fill('TEST-categoría nueva')
    await expect(dup).toHaveCount(0)
  })

})

test.describe('P5: el total de Gastos cuadra con el Dashboard', () => {
  test('incluye USD convertido y lo dice', async ({ page }) => {
    await page.goto('/?demo=60')
    await expect(page.getByRole('button', { name: 'Nuevo gasto' })).toBeEnabled()
    await page.getByRole('button', { name: 'Nuevo gasto' }).click()
    const d = dialog(page)
    await d.getByRole('radiogroup', { name: 'Ámbito' }).getByRole('radio', { name: 'Personal', exact: true }).click()
    await d.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Alimentación', exact: true }).click()
    await d.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio', { name: 'Almuerzo', exact: true }).click()
    await d.getByRole('radiogroup', { name: 'Moneda' }).getByRole('radio', { name: 'USD' }).click()
    await d.getByLabel('Monto', { exact: true }).fill('10')
    await d.getByRole('radiogroup', { name: 'Medio de pago' }).getByRole('radio').first().click()
    await d.getByLabel('Descripción').fill('TEST-USD')
    await d.getByRole('button', { name: 'Registrar gasto' }).click()
    await expect(d).toHaveCount(0)
    await expect(kpiTotal(page)).toContainText('S/', { timeout: 10000 })
    const dash = dinero(await kpiTotal(page).innerText())
    await go(page, 'Gastos')
    const t = page.getByTestId('gastos-total')
    await expect(t).toContainText('≈')
    await expect(page.getByTestId('gastos-total-conv')).toContainText('USD')
    expect(Math.abs(dinero(await t.innerText()) - dash)).toBeLessThan(0.02)
  })
})

test.describe('P6: menús ⋯ en portal y búsqueda conservada', () => {
  test('con una sola fila, "Eliminar" queda visible; al confirmar vuelve la lista con la búsqueda', async ({ page }) => {
    await page.goto('/?demo=60')
    await go(page, 'Gastos')
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    const m = dialog(page)
    await m.getByLabel('Buscar plantilla').fill('Antojos')
    const filas = m.getByRole('list', { name: 'Plantillas' }).getByRole('listitem')
    await expect(filas).toHaveCount(1)
    await filas.first().getByRole('button', { name: /Más acciones/ }).click()
    const eliminar = page.getByRole('menuitem', { name: 'Eliminar' })
    await expect(eliminar).toBeVisible()
    const box = await eliminar.boundingBox()
    const vp = page.viewportSize()!
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height)
    // el menú no vive dentro del contenedor con scroll (portal)
    expect(await eliminar.evaluate(el => !!el.closest('[role="list"]'))).toBe(false)
    await eliminar.click()
    await dialog(page).getByRole('button', { name: 'Eliminar', exact: true }).click()
    await expect(dialog(page).getByLabel('Buscar plantilla')).toHaveValue('Antojos')
  })
})

test.describe('P7: etiquetas del Catálogo', () => {
  test('el chip del ámbito y el encabezado dicen "N activas · M en total"', async ({ page }) => {
    await page.goto('/?demo=60')
    await go(page, 'Catálogo')
    const chip = page.getByRole('tab').first()
    await expect(chip).toContainText(/\d+ activas · \d+ en total/)
    await expect(chip).not.toContainText('sub.')
    await expect(page.getByText(/subcategorías activas · \d+ en total/).first()).toBeVisible()
  })
})

test.describe('?demo ignora la conexión guardada', () => {
  test('con una conexión en localStorage, ?demo=60 sigue mostrando datos de demostración y no la modifica', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('gd.connection', JSON.stringify({ url: 'https://script.google.com/macros/s/NO-USAR/exec', token: 't'.repeat(32) })) } catch { /* sin almacenamiento */ } })
    const llamadas: string[] = []
    page.on('request', r => { if (r.url().includes('script.google.com')) llamadas.push(r.url()) })
    await page.goto('/?demo=60')
    await expect(page.getByTestId('cons-gastado-del-período').locator('p').nth(1)).toContainText('S/', { timeout: 10000 })
    expect(llamadas).toEqual([])
    expect(await page.evaluate(() => localStorage.getItem('gd.connection'))).toContain('NO-USAR')
  })
})
