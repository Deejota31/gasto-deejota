import { expect, test, type Page } from '@playwright/test'
import { dialog, go } from './util'

// v1.28 — Pestaña Presupuestos: navegación, formulario de fondos, restricción de medios y asignación. Modo demostración.
const money = (s: string) => Number(s.replace(/[^\d.-]/g, ''))
const sinScrollH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00-05:00'))
  await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
})

test.describe('Navegación', () => {
  test('#presupuestos muestra título y subtítulo; #cajas es solo un alias y no existe pestaña Cajas', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3&latencia=0#cajas')
    await expect(page.getByRole('heading', { name: 'Presupuestos', level: 1 })).toBeVisible()
    await expect(page.getByText('Administra tus fondos y controla cómo se distribuyen tus gastos')).toBeVisible()
    await expect(page.getByRole('heading', { name: /Fondos del presupuesto/ })).toBeVisible()
    expect(page.url()).not.toContain('#cajas')
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: /^Cajas/ })).toHaveCount(0)
    await expect(page.locator('main')).not.toContainText(/subcaja|\bcajas?\b|reservas?/i)
  })
})

test.describe('Formulario de fondos', () => {
  test('secciones A–D con vista previa; «Solo seleccionados» habilita medios y restricción; cobertura se arma desde el catálogo', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3&latencia=0#presupuestos')
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    await expect(d.getByTestId('vista-previa-fondo')).toBeVisible()
    await expect(d.getByRole('radiogroup', { name: 'Medios de pago del fondo' })).toBeVisible()
    await expect(d.getByTestId('cobertura-todos')).toBeVisible()
    await d.getByRole('radiogroup', { name: 'Medios de pago del fondo' }).getByRole('radio', { name: 'Solo seleccionados' }).click()
    await d.locator('#fondo-medio').click()
    await page.getByRole('listbox').getByRole('option', { name: 'Sodexo', exact: true }).click()
    await expect(d.getByRole('switch', { name: /Restringir el uso/ })).toBeVisible()
    await d.getByRole('radiogroup', { name: 'Cobertura del fondo' }).getByRole('radio', { name: 'Por categoría' }).click()
    await d.locator('#cob-ambito').selectOption({ index: 1 })
    await d.getByTestId('opciones-cobertura').getByRole('button').first().click()
    await expect(d.getByTestId('rutas-elegidas').getByRole('listitem')).toHaveCount(1)
    await expect(d.getByTestId('vista-previa-fondo')).toContainText('Sodexo')
  })

  test('sin cobertura elegida no se guarda; con nombre e importe válidos se crea sin nombres fijos en el código', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3&latencia=0#presupuestos')
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    await d.getByLabel('Nombre del fondo').fill('Prueba v1.28')
    await d.getByLabel('Importe').fill('120')
    await d.getByRole('radiogroup', { name: 'Cobertura del fondo' }).getByRole('radio', { name: 'Por categoría' }).click()
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(d).toBeVisible()                                                  // falta elegir categorías: no guarda
    await d.getByRole('radiogroup', { name: 'Cobertura del fondo' }).getByRole('radio', { name: 'Todos los gastos' }).click()
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Prueba v1.28 creado' })).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('Restricción de medios y asignación', () => {
  test('un medio restringido para una categoría bloquea el guardado con el mensaje de la configuración', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3&latencia=0#presupuestos')
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    await d.getByLabel('Nombre del fondo').fill('Solo comida con Plin')
    await d.getByLabel('Importe').fill('100')
    await d.getByRole('radiogroup', { name: 'Medios de pago del fondo' }).getByRole('radio', { name: 'Solo seleccionados' }).click()
    await d.locator('#fondo-medio').click()
    await page.getByRole('listbox').getByRole('option', { name: 'Plin', exact: true }).click()
    await d.getByRole('switch', { name: /Restringir el uso/ }).click()
    await d.getByRole('radiogroup', { name: 'Cobertura del fondo' }).getByRole('radio', { name: 'Por categoría' }).click()
    await d.locator('#cob-ambito').selectOption({ label: 'Personal' })
    await d.getByTestId('opciones-cobertura').getByRole('button', { name: 'Alimentación', exact: true }).click()
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Solo comida con Plin creado' })).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Nuevo gasto' }).first().click()
    const g = dialog(page)
    await g.getByRole('radiogroup', { name: 'Ámbito' }).getByRole('radio', { name: 'Personal', exact: true }).click()
    await g.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Auto', exact: true }).click()
    await g.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio', { name: 'Gasolina', exact: true }).click()
    await g.getByLabel('Monto', { exact: true }).fill('20')
    await g.getByRole('radiogroup', { name: 'Medio de pago' }).getByRole('radio', { name: 'Plin', exact: true }).click()
    await expect(g.getByText('El medio Plin no está permitido para esta categoría según la configuración de tus presupuestos')).toBeVisible()
    await g.getByRole('button', { name: 'Registrar gasto' }).click()
    await expect(g).toBeVisible()                                                  // no se guardó
  })

  test('el gasto registrado muestra su indicador de fondos y permite ver / restaurar la asignación', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3&latencia=0#gastos')
    const chip = page.getByTestId('indicador-fondos').first()
    await expect(chip).toBeVisible()
    await chip.click()
    const d = dialog(page)
    await expect(d.getByRole('button', { name: /Restaurar asignación automática/ })).toBeVisible()
  })
})

test.describe('Responsive', () => {
  for (const [w, h] of [[360, 780], [390, 844], [768, 1024], [1366, 768]] as const) {
    test(`${w}×${h}: Presupuestos y su formulario sin desborde horizontal`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/?demo=60&fondos=20&latencia=0#presupuestos')
      await expect(page.getByTestId('presupuestos-resumen')).toBeVisible()
      expect(await sinScrollH(page)).toBe(true)
      await page.getByRole('button', { name: 'Nuevo fondo' }).click()
      await expect(dialog(page).getByTestId('vista-previa-fondo')).toBeVisible()
      expect(await sinScrollH(page)).toBe(true)
      await page.keyboard.press('Escape')
      await go(page, 'Dashboard')
      await expect(page.getByTestId('bloque-consolidado')).toBeVisible()
      expect(money(await page.getByTestId('cons-presupuesto-consolidado').locator('p').nth(1).innerText())).toBeGreaterThan(0)
    })
  }
})
