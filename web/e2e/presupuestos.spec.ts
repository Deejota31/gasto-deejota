import { expect, test, type Page } from '@playwright/test'
import { dialog, go, pick } from './util'

// v1.28 — Pestaña Presupuestos: navegación, formulario de fondos, restricción de medios y asignación. Modo demostración.
const money = (s: string) => Number(s.replace(/[^\d.-]/g, ''))
const sinScrollH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

/** Agrega un medio permitido en el multiselect (queda abierto: Escape cierra solo el panel). */
async function agregarMedio(page: Page, nombre: string) {
  const t = page.locator('#fondo-medios')
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click()
  await page.getByRole('listbox', { name: 'Medios permitidos' }).getByRole('option', { name: nombre, exact: true }).click()
  await page.keyboard.press('Escape')
}
/** Marca una categoría en el multiselect «Categorías» del editor de cobertura. */
async function elegirCobertura(page: Page, nombre: string) {
  await page.locator('#cob-multi-categoria').click()
  await page.getByRole('listbox', { name: 'Categorías' }).getByRole('option', { name: nombre, exact: true }).click()
  await page.keyboard.press('Escape')
}

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
    await expect(d.getByTestId('vista-previa-fondo')).toHaveCount(0)               // v1.30: sin bloque de vista previa
    await expect(d.getByText('Vista previa')).toHaveCount(0)
    await expect(d.locator('#fondo-modo-medios')).toBeVisible()
    await expect(d.locator('#fondo-medios')).toHaveCount(0)                      // «Elige los medios permitidos» solo con «Solo seleccionados»
    await d.locator('#fondo-modo-medios').click()
    await expect(page.getByRole('listbox').getByRole('option', { name: /excepto/i })).toHaveCount(0)   // «Todos excepto» ya no se ofrece
    await page.keyboard.press('Escape')
    await expect(d.getByTestId('cobertura-todos')).toBeVisible()
    await pick(page, '#fondo-modo-medios', 'Solo seleccionados')
    await agregarMedio(page, 'Sodexo')
    await expect(d.getByRole('switch', { name: /Restringir el uso/ })).toBeVisible()
    await pick(page, '#fondo-cobertura', 'Por categoría')
    await pick(page, '#cob-ambito', 'Personal')
    await elegirCobertura(page, 'Alimentación')
    await expect(d.getByTestId('rutas-elegidas').getByRole('listitem')).toHaveCount(1)
    await expect(d.getByTestId('fondo-medios-elegidos')).toContainText('Sodexo')
  })

  test('sin cobertura elegida no se guarda; con nombre e importe válidos se crea sin nombres fijos en el código', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3&latencia=0#presupuestos')
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    await d.getByLabel('Nombre del fondo').fill('Prueba v1.28')
    await d.getByLabel('Importe').fill('120')
    await pick(page, '#fondo-cobertura', 'Por categoría')
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(d).toBeVisible()                                                  // falta elegir categorías: no guarda
    await pick(page, '#fondo-cobertura', 'Todos los gastos')
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
    await pick(page, '#fondo-modo-medios', 'Solo seleccionados')
    await agregarMedio(page, 'Plin')
    await d.getByRole('switch', { name: /Restringir el uso/ }).click()
    await pick(page, '#fondo-cobertura', 'Por categoría')
    await pick(page, '#cob-ambito', 'Personal')
    await elegirCobertura(page, 'Alimentación')
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Solo comida con Plin creado' })).toBeVisible({ timeout: 15_000 })

    await go(page, 'Gastos')
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
    await expect(d.getByRole('heading', { name: 'Asignación a fondos' })).toBeVisible()
    await d.getByRole('button', { name: 'Cambiar asignación' }).click()
    await expect(d.getByRole('button', { name: 'Guardar asignación' })).toBeVisible()
    await d.getByRole('button', { name: 'Cancelar' }).click()
    await expect(d.getByRole('button', { name: 'Cambiar asignación' })).toBeVisible()           // sin guardar: no hay asignación manual que restaurar
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
      await expect(dialog(page).getByTestId('form-fondo')).toBeVisible()
      expect(await sinScrollH(page)).toBe(true)
      await page.keyboard.press('Escape')
      await go(page, 'Dashboard')
      await expect(page.getByTestId('bloque-consolidado')).toBeVisible()
      expect(money(await page.getByTestId('cons-presupuesto-consolidado').locator('p').nth(1).innerText())).toBeGreaterThan(0)
    })
  }
})

// ───────────────────────── v1.29 — rediseño UX/UI ─────────────────────────
test.describe('v1.29: rediseño', () => {
  test('Nuevo fondo: «Solo seleccionados» sin medios no guarda; con medios muestra chips y la restricción solo aparece para «Solo seleccionados»', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3&latencia=0#presupuestos')
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    await expect(d.getByRole('switch', { name: /Restringir el uso/ })).toHaveCount(0)
    await d.getByLabel('Nombre del fondo').fill('Solo Yape v1.29')
    await d.getByLabel('Importe').fill('90')
    await pick(page, '#fondo-modo-medios', 'Solo seleccionados')
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(d.getByText(/Elige al menos un medio/).first()).toBeVisible()          // validación de lista vacía
    await agregarMedio(page, 'Yape')
    await expect(d.getByTestId('fondo-medios-elegidos').getByRole('button', { name: 'Quitar Yape' })).toBeVisible()
    await expect(d.getByRole('switch', { name: /Restringir el uso/ })).toBeVisible()
    await pick(page, '#fondo-modo-medios', 'Todos los medios')                           // volver a «todos» oculta lista y restricción
    await expect(d.locator('#fondo-medios')).toHaveCount(0)
    await expect(d.getByRole('switch', { name: /Restringir el uso/ })).toHaveCount(0)
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Solo Yape v1.29 creado' })).toBeVisible({ timeout: 15_000 })
  })

  test('cobertura personalizada: agrega rutas, no duplica y las quita con su chip', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3&latencia=0#presupuestos')
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    await pick(page, '#fondo-cobertura', 'Personalizada')
    await pick(page, '#cob-ambito', 'Personal')
    await pick(page, '#cob-cat', 'Alimentación')
    await d.getByRole('button', { name: /Agregar ruta/ }).click()
    await expect(d.getByTestId('rutas-elegidas').getByRole('listitem')).toHaveCount(1)
    await expect(d.getByRole('button', { name: /Agregar ruta/ })).toBeDisabled()          // sin duplicados
    await d.getByTestId('rutas-elegidas').getByRole('button', { name: /^Quitar / }).click()
    await expect(d.getByTestId('rutas-elegidas')).toContainText('Aún no elegiste')
  })

  test('filtros de fondos: selects modernos combinables, indicador de filtros activos y «Limpiar filtros»', async ({ page }) => {
    await page.goto('/?demo=60&fondos=20&latencia=0#presupuestos')
    const cards = page.getByRole('list', { name: 'Lista de fondos' }).getByTestId('fondo')
    await expect(cards).toHaveCount(20)
    const total = 20
    await page.getByRole('button', { name: 'Tipo', exact: true }).click()
    await page.getByRole('listbox', { name: 'Tipo' }).getByRole('option', { name: 'Extra', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('filtros-activos')).toContainText('1 filtro(s) activo(s)')
    expect(await cards.count()).toBeLessThan(total)
    await pick(page, 'Filtrar fondos por estado', 'Activos')
    await expect(page.getByTestId('filtros-activos')).toContainText('2 filtro(s) activo(s)')
    await page.getByTestId('filtros-activos').getByRole('button', { name: 'Limpiar filtros' }).click()
    await expect(cards).toHaveCount(total)
    await expect(page.getByTestId('filtros-activos')).toHaveCount(0)
  })

  test('Movimientos no muestra el aviso de excedente; Salud financiera ya no tiene «Mi presupuesto»', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3&latencia=0#gastos')
    await expect(page.getByTestId('indicador-fondos').first()).toBeVisible()
    await expect(page.locator('main')).not.toContainText(/Excedente S\//)
    await go(page, 'Salud financiera')
    await expect(page.getByRole('tab', { name: /Mi presupuesto/ })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: /Compromisos/ })).toBeVisible()
  })

  test('plantilla de fondo con modelo completo: cobertura, medios y tipo; se aplica a un mes sin duplicar', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3&latencia=0#presupuestos')
    await page.getByRole('button', { name: 'Fondos mensuales' }).first().click()
    let m = dialog(page)
    await m.getByRole('button', { name: /Nueva plantilla/ }).click()
    await page.getByRole('menuitem', { name: 'Crear desde cero' }).click()
    m = dialog(page)
    await m.locator('#pf-nombre').fill('Almuerzos plantilla')
    await m.locator('#pf-monto').fill('300')
    await pick(page, '#pf-tipo', 'Ahorro asignado')
    await pick(page, '#pf-modo-medios', 'Solo seleccionados')
    await m.locator('#pf-medios').click()
    await page.getByRole('listbox', { name: 'Medios permitidos' }).getByRole('option', { name: 'Sodexo', exact: true }).click()
    await page.keyboard.press('Escape')
    await pick(page, '#pf-cobertura', 'Por categoría')
    await pick(page, '#cob-ambito', 'Personal')
    await page.locator('#cob-multi-categoria').click()
    await page.getByRole('listbox', { name: 'Categorías' }).getByRole('option', { name: 'Alimentación', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(m.getByTestId('pf-vista-previa')).toContainText('Alimentación')
    await m.getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(page.getByTestId('pf-fila')).toHaveCount(1)
    // reabrir: la configuración completa persiste
    await page.getByTestId('pf-fila').first().getByRole('button', { name: /Más acciones/ }).click()
    await page.getByRole('menuitem', { name: 'Editar' }).click()
    m = dialog(page)
    await expect(m.locator('#pf-tipo')).toContainText('Ahorro asignado')
    await expect(m.locator('#pf-modo-medios')).toContainText('Solo seleccionados')
    await expect(m.getByTestId('fondo-medios-elegidos')).toContainText('Sodexo')
    await expect(m.getByTestId('rutas-elegidas')).toContainText('Alimentación')
  })

  test('Sankey: en móvil se muestra la misma información como lista; en escritorio, el diagrama', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/?demo=60&fondos=3&latencia=0')
    await page.getByRole('tab', { name: 'Flujo de medios de pago' }).click()
    const lista = page.getByTestId('sankey-lista')
    await expect(lista).toBeVisible()
    await expect(lista.getByTestId('sankey-lista-enlace').first()).toBeVisible()
    await expect(page.getByTestId('sankey-medio')).toHaveCount(0)
    expect(await sinScrollH(page)).toBe(true)
    await page.setViewportSize({ width: 1366, height: 800 })
    await expect(page.getByTestId('sankey-medio').first()).toBeVisible()
    await expect(lista).toHaveCount(0)
  })
})
