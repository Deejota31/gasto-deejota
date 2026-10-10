import { expect, test, type Page } from '@playwright/test'

// Corre contra el modo demostración (backend en memoria). No toca Google Sheets ni datos reales.
const kpi = (page: Page, label: string) => page.locator('p', { hasText: new RegExp(`^${label}`) }).locator('xpath=following-sibling::p[1]').first()
const go = (page: Page, tab: string) => page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: tab }).click()
const money = (s: string) => Number(s.replace(/[^\d.-]/g, ''))
const total = async (page: Page) => money(await kpi(page, 'Total gastado').innerText())
const dialog = (page: Page) => page.getByRole('dialog')

async function pickMulti(page: Page, label: string, option: string) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('listbox', { name: label }).getByRole('option', { name: option, exact: true }).click()
  await page.keyboard.press('Escape')
}

async function newGasto(page: Page, { ambito, categoria, sub, monto, medio, desc }: { ambito: string; categoria: string; sub: string; monto: string; medio: string; desc: string }) {
  await page.getByRole('button', { name: 'Nuevo gasto' }).click()
  const d = dialog(page)
  await d.getByRole('radiogroup', { name: 'Ámbito' }).getByRole('radio', { name: ambito, exact: true }).click()
  await d.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: categoria, exact: true }).click()
  await d.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio', { name: sub, exact: true }).click()
  await d.getByLabel('Monto', { exact: true }).fill(monto)
  await d.getByRole('radiogroup', { name: 'Medio de pago' }).getByRole('radio', { name: medio, exact: true }).click()
  await d.getByLabel('Descripción').fill(desc)
  await d.getByRole('button', { name: 'Registrar gasto' }).click()
  await expect(d).toHaveCount(0)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?demo=60')
  await expect(kpi(page, 'Total gastado')).toContainText('S/')
})

test('navega por las pestañas; ya no existe el gráfico "Últimos 6 meses"', async ({ page }) => {
  for (const tab of ['Gastos', 'Salud financiera', 'Categorías', 'Configuración', 'Dashboard']) {
    await go(page, tab)
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: tab })).toHaveAttribute('aria-current', 'page')
  }
  await expect(page.getByRole('link', { name: 'Mi hoja' })).toBeVisible()
  await expect(page.getByText('Últimos 6 meses', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/Gasto acumulado/).first()).toBeVisible()
  await expect(page.getByText('Gasto diario', { exact: true })).toBeVisible()
})

test('cada KPI tiene su icono de información con explicación', async ({ page }) => {
  for (const l of ['Caja mensual', 'Total gastado', 'Disponible', 'Consumido', 'Promedio diario', 'Promedio por movimiento', 'Mayor gasto', 'Movimientos']) {
    await expect(kpi(page, l)).toBeVisible()
    const btn = page.getByRole('button', { name: `Información: ${l}`, exact: true })
    await btn.click()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await page.mouse.move(0, 0) // que el puntero no reabra otro ⓘ al moverse el contenido
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  }
  // los gráficos también llevan su ⓘ
  expect(await page.getByRole('button', { name: /^Información: / }).count()).toBeGreaterThanOrEqual(13)
})

test('filtros: multiselección, chips, dependencia y limpiar', async ({ page }) => {
  const t0 = await total(page)
  await pickMulti(page, 'Ámbito', 'Personal')
  await expect(page.getByRole('button', { name: 'Quitar filtro Personal' })).toBeVisible()
  const t1 = await total(page)
  expect(t1).toBeLessThan(t0)
  // Categorías dependientes: solo las del ámbito Personal (Suscripciones sí, Bebé no)
  await page.getByRole('button', { name: 'Categoría', exact: true }).click()
  const cats = page.getByRole('listbox', { name: 'Categoría' })
  await expect(cats.getByRole('option', { name: 'Suscripciones', exact: true })).toBeVisible()
  await expect(cats.getByRole('option', { name: 'Bebé', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Limpiar filtros' }).click()
  expect(await total(page)).toBe(t0)
  // Presets de período
  await page.getByRole('button', { name: 'Período', exact: true }).click()
  await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Este año' }).click()
  expect(await total(page)).toBeGreaterThanOrEqual(t0)
})

test('cajas: libre inicial = presupuesto − reservado; disponible global = P − gastado', async ({ page }) => {
  const val = async (l: string) => money(await page.locator('p', { hasText: new RegExp(`^${l.replace(/[()]/g, '\\$&')}$`) }).locator('xpath=following-sibling::p[1]').first().innerText())
  const P = await val('Presupuesto (P)')
  const R = await val('Reservado en subcajas')
  expect(await val('Libre inicial (P − R)')).toBeCloseTo(P - R, 2)
  const disp = money(await page.getByText('Disponible global').locator('xpath=following-sibling::p[1]').innerText())
  expect(disp).toBeCloseTo(P - (await total(page)), 2)
})

test('medios de pago: orden pedido y sin opciones en blanco', async ({ page }) => {
  await go(page, 'Gastos')
  await page.getByRole('button', { name: 'Nuevo gasto' }).click()
  const radios = dialog(page).getByRole('radiogroup', { name: 'Medio de pago' }).getByRole('radio')
  const names = (await radios.allInnerTexts()).map(s => s.trim())
  expect(names).toEqual(['Yape', 'Plin', 'Sodexo', 'Transferencia', 'Efectivo', 'Otros'])
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Medio de pago', exact: true }).click()
  const opts = (await page.getByRole('listbox', { name: 'Medio de pago' }).getByRole('option').allInnerTexts()).map(s => s.trim())
  expect(opts).toEqual(['Yape', 'Plin', 'Sodexo', 'Transferencia', 'Efectivo', 'Otros'])
})

test('registrar, editar, clonar, eliminar y restaurar un gasto', async ({ page }) => {
  const before = await total(page)
  await go(page, 'Gastos')
  await newGasto(page, { ambito: 'Personal', categoria: 'Alimentación', sub: 'Almuerzo', monto: '12.34', medio: 'Yape', desc: 'Prueba E2E' })
  const row = page.getByRole('row', { name: /Prueba E2E/ })
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: 'Editar' }).click()
  await dialog(page).getByLabel('Monto', { exact: true }).fill('20')
  await dialog(page).getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(row).toContainText('S/ 20.00')

  await row.getByRole('button', { name: 'Clonar' }).click()
  await expect(dialog(page).getByText('Clonar gasto')).toBeVisible()
  await dialog(page).getByLabel('Descripción').fill('Prueba E2E copia')
  await dialog(page).getByRole('button', { name: 'Crear copia' }).click()
  await expect(page.getByRole('row', { name: /Prueba E2E copia/i })).toBeVisible()

  const copy = page.getByRole('row', { name: /Prueba E2E copia/i })
  await copy.getByRole('button', { name: 'Eliminar' }).click()
  await dialog(page).getByRole('button', { name: 'Eliminar' }).click()
  await expect(page.getByRole('row', { name: /Prueba E2E copia/i })).toHaveCount(0)
  await page.getByRole('radio', { name: 'Eliminados' }).click()
  await page.getByRole('row', { name: /Prueba E2E copia/i }).getByRole('button', { name: 'Restaurar' }).click()
  await page.getByRole('radio', { name: 'Activos' }).click()
  await expect(page.getByRole('row', { name: /Prueba E2E copia/i })).toBeVisible()

  await go(page, 'Dashboard')
  expect(await total(page)).toBeCloseTo(before + 40, 2)
})

test('tabla: paginación 5/10/15/25/50 con "Mostrando x–y de N"', async ({ page }) => {
  await go(page, 'Gastos')
  await page.getByRole('button', { name: 'Período', exact: true }).click()
  await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Este año' }).click()
  const size = page.getByLabel('Registros por página')
  await expect(size).toHaveValue('10')
  expect(await size.locator('option').allInnerTexts()).toEqual(['5', '10', '15', '25', '50'])
  const status = page.getByText(/^Mostrando/)
  await expect(status).toContainText('1–10 de')
  const n = Number((await status.innerText()).match(/de (\d+)/)![1])
  expect(n).toBeGreaterThan(10)
  await expect(page.locator('tbody tr')).toHaveCount(10)
  await page.getByRole('button', { name: 'Página siguiente' }).click()
  await expect(status).toContainText(`11–${Math.min(20, n)} de ${n}`)
  await size.selectOption('5')
  await expect(status).toContainText(`1–5 de ${n}`)
  await expect(page.locator('tbody tr')).toHaveCount(5)
  await size.selectOption('50')
  await expect(page.locator('tbody tr')).toHaveCount(Math.min(50, n))
})

test('catálogo: crear subcategoría y usarla al registrar', async ({ page }) => {
  await go(page, 'Categorías')
  await page.getByRole('button', { name: 'Agregar subcategoría a Alimentación' }).click()
  await dialog(page).getByLabel('Nombre').fill('Café de prueba')
  await dialog(page).getByRole('button', { name: 'Agregar' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Café de prueba' })).toBeVisible()
  await page.getByLabel('Buscar en el catálogo').fill('café de')
  await expect(page.locator('mark', { hasText: /café de/i }).first()).toBeVisible()
  await go(page, 'Gastos')
  await newGasto(page, { ambito: 'Personal', categoria: 'Alimentación', sub: 'Café de prueba', monto: '5', medio: 'Plin', desc: 'Usa nueva sub' })
  await expect(page.getByRole('row', { name: /Usa nueva sub/i })).toContainText('Café de prueba')
})

test('catálogo: renombrar categoría actualiza los gastos de ese ámbito', async ({ page }) => {
  await go(page, 'Gastos')
  await newGasto(page, { ambito: 'Personal', categoria: 'Alimentación', sub: 'Almuerzo', monto: '7', medio: 'Efectivo', desc: 'Antes de renombrar' })
  await go(page, 'Categorías')
  await page.getByRole('button', { name: 'Editar Alimentación' }).click()
  await expect(dialog(page).getByText(/Se renombrará también en \d+ gasto/)).toHaveCount(0)
  await dialog(page).getByLabel('Nombre').fill('Comida')
  await expect(dialog(page).getByText(/Se renombrará también en \d+ gasto/)).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Guardar' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Editar Comida' })).toBeVisible()
  await go(page, 'Gastos')
  const row = page.getByRole('row', { name: /Antes de renombrar/i })
  await expect(row).toContainText('Comida')
  await expect(row).not.toContainText('Alimentación')
})

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('sin scroll horizontal en ninguna pestaña', async ({ page }) => {
    for (const tab of ['Dashboard', 'Gastos', 'Categorías', 'Configuración']) {
      await go(page, tab)
      await page.waitForTimeout(300)
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(over, tab).toBeLessThanOrEqual(0)
    }
  })

  test('deslizar revela acciones y tocar no elimina', async ({ page }) => {
    await go(page, 'Gastos')
    const list = page.getByRole('list', { name: 'Movimientos' })
    const first = list.getByRole('listitem').first()
    const count = await list.getByRole('listitem').count()
    const box = (await first.boundingBox())!
    // un toque simple no ejecuta nada destructivo
    await first.click({ position: { x: box.width - 30, y: box.height / 2 } })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // gesto de deslizar a la izquierda
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width - 20, y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width - 20 - i * 20, y)
    await page.mouse.up()
    await expect(first.getByRole('button', { name: 'Eliminar' })).toBeInViewport()
    await first.getByRole('button', { name: 'Eliminar' }).click()
    await expect(dialog(page).getByText('Eliminar gasto')).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Cancelar' }).click()
    await expect(list.getByRole('listitem')).toHaveCount(count)
  })
})

test('caso 10: Familia + Bebé + Yape → tabla y KPI muestran exactamente esos movimientos', async ({ page }) => {
  await go(page, 'Gastos')
  await page.getByRole('button', { name: 'Período', exact: true }).click()
  await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Este año' }).click()
  await newGasto(page, { ambito: 'Familia', categoria: 'Bebé', sub: 'Pañales', monto: '100', medio: 'Yape', desc: 'Caso 10' })
  await pickMulti(page, 'Ámbito', 'Familia')
  await pickMulti(page, 'Categoría', 'Bebé')
  await pickMulti(page, 'Medio de pago', 'Yape')
  await page.getByLabel('Registros por página').selectOption('50')
  const rows = page.locator('tbody tr')
  const n = await rows.count()
  expect(n).toBeGreaterThan(0)
  let suma = 0
  for (let i = 0; i < n; i++) {
    const t = await rows.nth(i).innerText()
    expect(t).toContain('Familia'); expect(t).toContain('Bebé'); expect(t).toContain('Yape')
    suma += money(t.match(/S\/\s?[\d,.]+/)![0])
  }
  await go(page, 'Dashboard')
  expect(await total(page)).toBeCloseTo(suma, 2)
})

const toastStack = (page: Page) => page.locator('[aria-live="polite"]').filter({ has: page.locator('[data-kind]') })

test('Dashboard: "+ Nuevo gasto" abre el mismo formulario y actualiza los KPI sin cambiar de sección', async ({ page }) => {
  const antes = await total(page)
  await newGasto(page, { ambito: 'Personal', categoria: 'Alimentación', sub: 'Snack / Antojos', monto: '15.25', medio: 'Plin', desc: 'Desde dashboard' })
  await expect(page.getByRole('status').filter({ hasText: 'Gasto registrado correctamente.' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  await expect.poll(() => total(page)).toBeCloseTo(antes + 15.25, 2)
})

test('notificaciones arriba a la derecha, verdes al confirmar; Top 5 categorías y Top 10 subcategorías', async ({ page }) => {
  await newGasto(page, { ambito: 'Familia', categoria: 'Hogar', sub: 'Muebles', monto: '9', medio: 'Yape', desc: 'Toast' })
  const ok = page.locator('[data-kind="success"]').first()
  await expect(ok).toBeVisible()
  const box = (await ok.boundingBox())!
  const vw = page.viewportSize()!.width
  expect(box.y).toBeLessThan(80)
  expect(vw - (box.x + box.width)).toBeLessThan(40)
  expect(await ok.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(238, 249, 242)')
  await expect(ok).toHaveCount(0, { timeout: 7000 }) // desaparece sola (~4 s)
  await page.getByRole('button', { name: 'Período', exact: true }).click()
  await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Este año' }).click()
  await expect(page.getByRole('heading', { name: 'Top 5 categorías' }).or(page.getByText('Top 5 categorías', { exact: true })).first()).toBeVisible()
  expect(await page.getByLabel('Top 5 categorías').getByRole('button').count()).toBe(5)
  expect(await page.getByLabel('Top 10 subcategorías').getByRole('button').count()).toBe(10)
})

test('formulario y filtros: "Otros" al final, Transporte nuevo y catálogo por ámbito', async ({ page }) => {
  await page.getByRole('button', { name: 'Nuevo gasto' }).click()
  const d = dialog(page)
  for (const amb of ['Personal', 'Trabajo', 'Pareja', 'Familia', 'Amigos']) {
    await d.getByRole('radiogroup', { name: 'Ámbito' }).getByRole('radio', { name: amb, exact: true }).click()
    const cats = (await d.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio').allInnerTexts()).map(s => s.trim())
    expect(cats.at(-1), amb).toBe('Otros')
    await d.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Transporte', exact: true }).click()
    expect((await d.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio').allInnerTexts()).map(s => s.trim()), amb)
      .toEqual(['Taxi', 'Moto Taxi', 'Bus / Micro', 'Otros'])
  }
  await d.getByRole('radiogroup', { name: 'Ámbito' }).getByRole('radio', { name: 'Personal', exact: true }).click()
  await d.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Servicios', exact: true }).click()
  expect((await d.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio').allInnerTexts()).map(s => s.trim())).toEqual(['Línea Celular', 'Otros'])
  await d.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Alimentación', exact: true }).click()
  const alim = (await d.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio').allInnerTexts()).map(s => s.trim())
  expect(alim).toContain('Snack / Antojos')
  expect(alim).not.toContain('Antojos') // obsoleto: no se ofrece para gastos nuevos
  await page.keyboard.press('Escape')
  // Filtro de categorías con varios ámbitos: Otros sigue al final
  await pickMulti(page, 'Ámbito', 'Personal')
  await pickMulti(page, 'Ámbito', 'Pareja')
  await page.getByRole('button', { name: 'Categoría', exact: true }).click()
  const opts = (await page.getByRole('listbox', { name: 'Categoría' }).getByRole('option').allInnerTexts()).map(s => s.trim())
  expect(opts.at(-1)).toBe('Otros')
})

test('Categorías: agregar una subcategoría la deja antes de "Otros"', async ({ page }) => {
  await go(page, 'Categorías')
  await page.getByRole('button', { name: 'Agregar subcategoría a Alimentación' }).click()
  await dialog(page).getByLabel('Nombre').fill('Merienda')
  await dialog(page).getByRole('button', { name: 'Agregar' }).click()
  await expect(dialog(page)).toHaveCount(0) // se cierra al aceptar, sin esperar a la hoja
  await expect(page.getByRole('status').filter({ hasText: 'Subcategoría creada correctamente.' })).toBeVisible()
  const grupo = page.getByRole('button', { name: 'Merienda', exact: true }).locator('xpath=..') // chips de Alimentación
  const chips = (await grupo.getByRole('button').allInnerTexts()).map(s => s.trim()).filter(Boolean)
  expect(chips.at(-1)).toBe('Otros') // (aquí también se listan las inactivas, como "Antojos")
  expect(chips.indexOf('Merienda')).toBeGreaterThan(chips.indexOf('Bebidas'))
  // y en el formulario
  await go(page, 'Gastos')
  await page.getByRole('button', { name: 'Nuevo gasto' }).click()
  await dialog(page).getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Alimentación', exact: true }).click()
  const subs = (await dialog(page).getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio').allInnerTexts()).map(s => s.trim())
  expect(subs.slice(-2)).toEqual(['Merienda', 'Otros'])
})

test('históricos: un gasto con una subcategoría retirada se ve y se puede filtrar', async ({ page }) => {
  await go(page, 'Gastos')
  await page.getByLabel('Buscar gastos').fill('Gasto histórico')
  await expect(page.getByRole('row', { name: /Gasto histórico/ })).toContainText('Antojos')
  await page.getByLabel('Buscar gastos').fill('')
  await page.getByRole('button', { name: 'Subcategoría', exact: true }).click()
  await expect(page.getByRole('listbox', { name: 'Subcategoría' }).getByRole('option', { name: 'Antojos (histórica)' })).toBeVisible()
  await page.getByRole('listbox', { name: 'Subcategoría' }).getByRole('option', { name: 'Antojos (histórica)' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  // editar conserva el valor histórico
  await page.getByRole('row', { name: /Gasto histórico/ }).getByRole('button', { name: 'Editar' }).click()
  await expect(dialog(page).getByRole('radio', { name: 'Antojos', exact: true })).toHaveAttribute('aria-checked', 'true')
})

test.describe('Apps Script lento o caído', () => {
  test('con 2,5 s de latencia se puede navegar mientras se guarda; el éxito llega al final', async ({ page }) => {
    await page.goto('/?demo=60&latencia=2500')
    await expect(kpi(page, 'Total gastado')).toContainText('S/', { timeout: 10000 })
    const antes = await total(page)
    await newGasto(page, { ambito: 'Trabajo', categoria: 'Transporte', sub: 'Moto Taxi', monto: '4', medio: 'Yape', desc: 'Lento' })
    await expect(page.locator('[data-kind="pending"]')).toContainText('Guardando gasto…')
    // la interfaz sigue usable: cambiar de pestaña, usar filtros y volver
    await go(page, 'Categorías')
    await go(page, 'Gastos')
    await expect(page.getByRole('row', { name: /Lento/ })).toHaveCount(0) // aún no confirmado: no se muestra como guardado
    await go(page, 'Dashboard')
    await expect(page.getByRole('status').filter({ hasText: 'Gasto registrado correctamente.' })).toBeVisible({ timeout: 6000 })
    await expect.poll(() => total(page)).toBeCloseTo(antes + 4, 2)
    await go(page, 'Gastos')
    await expect(page.getByRole('row', { name: /Lento/ })).toHaveCount(1) // sin duplicados
  })

  test('si la escritura falla: notificación roja, sin éxito falso, y "Abrir formulario" conserva los datos', async ({ page }) => {
    await page.goto('/?demo=60&falla=1')
    await expect(kpi(page, 'Total gastado')).toContainText('S/')
    const antes = await total(page)
    await newGasto(page, { ambito: 'Amigos', categoria: 'Salidas', sub: 'Cine', monto: '30', medio: 'Plin', desc: 'Falla' })
    const err = page.getByRole('alert').filter({ hasText: 'No se pudo registrar el gasto.' })
    await expect(err).toBeVisible()
    expect(await err.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(253, 240, 239)')
    await expect(page.getByText('Gasto registrado correctamente.')).toHaveCount(0)
    expect(await total(page)).toBe(antes)
    // con otro formulario abierto, el error sigue visible y usable (se muestra dentro del modal).
    // (El aviso de error, más largo por "resultado incierto", tapa el botón: se abre el formulario sin cerrarlo.)
    await page.getByRole('button', { name: 'Nuevo gasto' }).dispatchEvent('click')
    await expect(dialog(page).getByRole('alert').filter({ hasText: 'No se pudo registrar el gasto.' })).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Cancelar' }).click()
    await err.getByRole('button', { name: 'Abrir formulario' }).click()
    await expect(dialog(page).getByLabel('Monto', { exact: true })).toHaveValue('30')
    await expect(dialog(page).getByLabel('Descripción')).toHaveValue('Falla')
    await expect(dialog(page).getByRole('radio', { name: 'Cine', exact: true })).toHaveAttribute('aria-checked', 'true')
  })

  test('las notificaciones no bloquean clics fuera de su área', async ({ page }) => {
    await page.goto('/?demo=60&latencia=3000')
    await expect(kpi(page, 'Total gastado')).toContainText('S/', { timeout: 10000 })
    await newGasto(page, { ambito: 'Personal', categoria: 'Auto', sub: 'Gas', monto: '20', medio: 'Yape', desc: 'Bloqueo' })
    await expect(page.locator('[data-kind="pending"]')).toBeVisible()
    // el botón "Mi hoja"/actualizar está bajo la zona de notificaciones en escritorio: se puede pulsar igual
    await go(page, 'Gastos')
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Gastos' })).toHaveAttribute('aria-current', 'page')
  })
})

test.describe('v1.3: descripción, clonación, plantillas y configuración', () => {
  test('autocompleta la descripción con la subcategoría sin pisar lo escrito', async ({ page }) => {
    await page.getByRole('button', { name: 'Nuevo gasto' }).click()
    const d = dialog(page)
    const desc = d.getByLabel('Descripción')
    const pick = (group: string, name: string) => d.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true }).click()
    await pick('Ámbito', 'Familia'); await pick('Categoría', 'Transporte'); await pick('Subcategoría', 'Moto Taxi')
    await expect(desc).toHaveValue('Moto Taxi')
    await pick('Subcategoría', 'Taxi')
    await expect(desc).toHaveValue('Taxi')                 // seguía siendo automática: se actualiza
    await pick('Subcategoría', 'Otros')
    await expect(desc).toHaveValue('')                     // "Otros" no es una descripción útil
    await desc.fill('taxi a la oficina')
    await desc.blur()
    await expect(desc).toHaveValue('Taxi a la Oficina')    // formato al salir del campo
    await pick('Subcategoría', 'Bus / Micro')
    await expect(desc).toHaveValue('Taxi a la Oficina')    // personalizada: no se pisa
    await desc.fill('')
    await pick('Subcategoría', 'Moto Taxi')
    await expect(desc).toHaveValue('Moto Taxi')            // vaciada: vuelve a completarse
    await pick('Ámbito', 'Personal'); await pick('Categoría', 'Suscripciones'); await pick('Subcategoría', 'ChatGPT')
    await expect(desc).toHaveValue('ChatGPT')
  })

  test('el formato se aplica también al guardar, respetando marcas, tildes y conectores', async ({ page }) => {
    await go(page, 'Gastos')
    await page.getByRole('button', { name: 'Nuevo gasto' }).click()
    const d = dialog(page)
    await d.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Suscripciones', exact: true }).click()
    await d.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio', { name: 'HBO Max', exact: true }).click()
    await d.getByLabel('Monto', { exact: true }).fill('29.90')
    await d.getByRole('radiogroup', { name: 'Medio de pago' }).getByRole('radio', { name: 'Yape', exact: true }).click()
    await d.getByLabel('Descripción').fill('pago de hbo max para la bebé')
    await d.getByRole('button', { name: 'Registrar gasto' }).click()
    await expect(page.getByRole('row', { name: /Pago de HBO Max para la Bebé/ })).toBeVisible()
  })

  test('clonar conserva la fecha y todos los datos del original; editar conserva la descripción', async ({ page }) => {
    await go(page, 'Gastos')
    await page.getByRole('button', { name: 'Período', exact: true }).click()
    await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Mes anterior' }).click()
    const fila = page.locator('tbody tr').first()
    const texto = await fila.innerText()
    const [dd, mm, yyyy] = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/)!.slice(1)
    await fila.getByRole('button', { name: 'Editar' }).click()
    const descOriginal = await dialog(page).getByLabel('Descripción').inputValue()
    await dialog(page).getByRole('button', { name: 'Cancelar' }).click()
    await fila.getByRole('button', { name: 'Clonar' }).click()
    const d = dialog(page)
    await expect(d.getByLabel('Fecha')).toHaveValue(`${yyyy}-${mm}-${dd}`)     // no la de hoy
    await expect(d.getByLabel('Descripción')).toHaveValue(descOriginal)
    await d.getByRole('button', { name: 'Crear copia' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Gasto clonado correctamente.' })).toBeVisible()
    await expect(page.locator('tbody tr', { hasText: descOriginal }).filter({ hasText: `${dd}/${mm}/${yyyy}` })).toHaveCount(2) // original + copia
  })

  test('plantillas: crear con monto/medio, evitar duplicados, usar, editar, clonar y eliminar sin releer la hoja', async ({ page }) => {
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    const m = dialog(page)
    const lista = m.getByRole('list', { name: 'Plantillas' })
    const filas = lista.getByRole('listitem')
    await expect(filas).toHaveCount(11)
    // la plantilla con clasificación retirada pide revisión: no se puede usar ni seleccionar
    const vieja = filas.filter({ hasText: 'Antojos de la Tarde' })
    await expect(vieja).toContainText('Requiere revisión')
    await expect(vieja.getByRole('button', { name: 'Usar plantilla Antojos de la Tarde' })).toBeDisabled()
    await expect(vieja.getByRole('checkbox')).toBeDisabled()
    // crear con monto, moneda y medio predeterminados
    await m.getByRole('button', { name: 'Nueva plantilla' }).click()
    await m.getByRole('radio', { name: 'Familia', exact: true }).click()
    await m.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Servicios', exact: true }).click()
    await m.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio', { name: 'Internet', exact: true }).click()
    await expect(m.getByLabel('Descripción')).toHaveValue('Internet')
    await m.getByLabel('Descripción').fill('internet de la casa')
    await m.getByLabel('Monto predeterminado').fill('89.90')
    await m.getByRole('radiogroup', { name: 'Medio de pago predeterminado' }).getByRole('radio', { name: 'Plin', exact: true }).click()
    await m.getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Plantilla creada correctamente.' })).toBeVisible()
    await expect(filas).toHaveCount(12)
    await expect(m.getByLabel('Monto de Internet de la Casa')).toHaveValue('89.90')
    await expect(m.getByLabel('Medio de pago de Internet de la Casa')).toHaveValue('Plin')
    // duplicado exacto (otra capitalización y espacios) → rechazado
    await m.getByRole('button', { name: 'Nueva plantilla' }).click()
    await m.getByRole('radio', { name: 'Familia', exact: true }).click()
    await m.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Servicios', exact: true }).click()
    await m.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio', { name: 'Internet', exact: true }).click()
    await m.getByLabel('Descripción').fill('  INTERNET DE LA CASA ')
    await m.getByLabel('Monto predeterminado').fill('89.9')
    await m.getByRole('radiogroup', { name: 'Medio de pago predeterminado' }).getByRole('radio', { name: 'Plin', exact: true }).click()
    await m.getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(m.getByText('La plantilla ya existe. Modifica al menos uno de sus valores para guardar una copia.')).toBeVisible()
    await m.getByRole('button', { name: 'Volver' }).click()
    // usar → mismo formulario de Nuevo gasto, precargado con monto y medio de la plantilla
    const antes = await total(page)
    await m.getByRole('button', { name: 'Usar plantilla ChatGPT' }).click()
    const g = dialog(page)
    await expect(g.getByText('Nuevo gasto', { exact: true })).toBeVisible()
    await expect(g.getByRole('radio', { name: 'Personal', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(g.getByRole('radio', { name: 'Suscripciones', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(g.getByRole('radio', { name: 'ChatGPT', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(g.getByLabel('Descripción')).toHaveValue('ChatGPT')
    await expect(g.getByLabel('Monto', { exact: true })).toHaveValue('80')
    await expect(g.getByRole('radiogroup', { name: 'Medio de pago' }).getByRole('radio', { name: 'Yape', exact: true })).toHaveAttribute('aria-checked', 'true')
    await g.getByLabel('Monto', { exact: true }).fill('75')
    await g.getByRole('button', { name: 'Registrar gasto' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Gasto registrado correctamente.' })).toBeVisible()
    await expect.poll(() => total(page)).toBeCloseTo(antes + 75, 2)
    // reabrir: siguen ahí, la plantilla no cambió y no se volvió a leer la hoja de plantillas
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    await expect(filas).toHaveCount(12)
    await expect(m.getByLabel('Monto de ChatGPT')).toHaveValue('80.00')
    expect(await page.evaluate(() => (globalThis as unknown as { __gdDemoCalls: Record<string, number> }).__gdDemoCalls.plantillas)).toBe(1)
    // editar
    await m.getByRole('button', { name: 'Más acciones de Internet de la Casa' }).click()
    await m.getByRole('menuitem', { name: 'Editar' }).click()
    await m.getByLabel('Descripción').fill('internet fibra del hogar')
    await m.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(filas.filter({ hasText: 'Internet Fibra del Hogar' })).toBeVisible()
    // clonar: sin cambios se rechaza; con otro monto se guarda justo debajo de la original, sin "Copia de"
    await m.getByRole('button', { name: 'Más acciones de Netflix' }).click()
    await m.getByRole('menuitem', { name: 'Clonar' }).click()
    await expect(m.getByLabel('Descripción')).toHaveValue('Netflix')
    await m.getByRole('button', { name: 'Guardar copia' }).click()
    await expect(m.getByText('La plantilla ya existe. Modifica al menos uno de sus valores para guardar una copia.')).toBeVisible()
    await m.getByLabel('Monto predeterminado').fill('45')
    await m.getByRole('button', { name: 'Guardar copia' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Plantilla clonada correctamente.' })).toBeVisible()
    await expect(filas).toHaveCount(13)
    const nombres = (await filas.locator('[aria-label^="Seleccionar "]').evaluateAll(els => els.map(e => e.getAttribute('aria-label'))))
    const i = nombres.indexOf('Seleccionar Netflix')
    expect(nombres[i + 1]).toBe('Seleccionar Netflix')
    expect(nombres.some(x => /Copia de/i.test(x ?? ''))).toBe(false)
    // eliminar con confirmación
    await m.getByRole('button', { name: 'Más acciones de Internet Fibra del Hogar' }).click()
    await m.getByRole('menuitem', { name: 'Eliminar' }).click()
    await expect(m.getByText('Esta acción eliminará únicamente la plantilla.', { exact: false })).toBeVisible()
    await m.getByRole('button', { name: 'Eliminar', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Plantilla eliminada correctamente.' })).toBeVisible()
    await expect(filas).toHaveCount(12)
    expect(await total(page)).toBeCloseTo(antes + 75, 2) // las plantillas nunca suman
  })

  test('Configuración: preferencias, cajas y medios siguen funcionando', async ({ page }) => {
    await go(page, 'Configuración')
    await expect(page.getByRole('heading', { name: 'Configuración' })).toBeVisible()
    await page.getByRole('switch', { name: 'Mostrar notificaciones al guardar' }).click()
    await expect(page.getByRole('switch', { name: 'Mostrar notificaciones al guardar' })).toHaveAttribute('aria-checked', 'false')
    await page.getByRole('switch', { name: 'Mostrar notificaciones al guardar' }).click()
    const auto = page.getByRole('button', { name: 'Guardar Caja Auto' }).locator('xpath=../..') // tarjeta de la caja
    await auto.getByLabel('Presupuesto').fill('250')
    await auto.getByRole('button', { name: 'Guardar Caja Auto' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Caja Auto guardada correctamente.' })).toBeVisible()
    await page.getByLabel('Nuevo medio de pago').fill('Tarjeta')
    await page.getByRole('button', { name: 'Agregar' }).click()
    const medios = page.getByRole('list', { name: 'Medios de pago' }).getByRole('button')
    await expect(medios).toHaveCount(7)
    expect((await medios.allInnerTexts()).map(s => s.trim()).at(-1)).toBe('Otros')
  })
})

test('plantillas con Apps Script caído: el formulario se cierra, sin éxito falso; error con Reintentar y Reabrir formulario con lo escrito', async ({ page }) => {
  await page.goto('/?demo=60&falla=1')
  await expect(kpi(page, 'Total gastado')).toContainText('S/')
  await page.getByRole('button', { name: 'Gastos mensuales' }).click()
  const m = dialog(page)
  await m.getByRole('button', { name: 'Nueva plantilla' }).click()
  await m.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Suscripciones', exact: true }).click()
  await m.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio', { name: 'Spotify', exact: true }).click()
  await m.getByLabel('Descripción').fill('spotify familiar')
  await m.getByLabel('Monto predeterminado').fill('25.90')
  await m.getByRole('button', { name: 'Guardar plantilla' }).click()
  await expect(m.getByRole('list', { name: 'Plantillas' })).toBeVisible()                // no bloquea: vuelve a la lista al instante
  const err = page.getByRole('alert').filter({ hasText: 'No se pudo crear la plantilla.' })
  await expect(err).toBeVisible()
  await expect(err).toContainText('Resultado incierto')                                   // sin respuesta: pudo haberse guardado
  await expect(page.getByRole('status').filter({ hasText: 'Plantilla creada correctamente.' })).toHaveCount(0)
  await expect(m.getByRole('list', { name: 'Plantillas' }).getByRole('listitem')).toHaveCount(11) // no aparece como creada
  const c0 = await page.evaluate(() => (globalThis as unknown as { __gdDemoCalls: Record<string, number> }).__gdDemoCalls.savePlantilla ?? 0)
  await expect(err.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await err.getByRole('button', { name: 'Reabrir formulario' }).click()
  await expect(dialog(page).getByLabel('Descripción')).toHaveValue('Spotify Familiar')
  await expect(dialog(page).getByLabel('Monto predeterminado')).toHaveValue('25.90')
  await expect(dialog(page).getByRole('radio', { name: 'Spotify', exact: true })).toHaveAttribute('aria-checked', 'true')
  await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()          // reintento con el mismo ID
  await expect(page.getByRole('alert').filter({ hasText: 'No se pudo crear la plantilla.' }).first()).toBeVisible()
  expect(await page.evaluate(() => (globalThis as unknown as { __gdDemoCalls: Record<string, number> }).__gdDemoCalls.savePlantilla)).toBe(c0 + 1)
})

test('plantillas con tiempo agotado: el error dice que el resultado es incierto y no bloquea', async ({ page }) => {
  await page.goto('/?demo=60&falla=timeout')
  await expect(kpi(page, 'Total gastado')).toContainText('S/')
  await page.getByRole('button', { name: 'Gastos mensuales' }).click()
  const m = dialog(page)
  await m.getByRole('button', { name: 'Más acciones de Luz' }).click()
  await m.getByRole('menuitem', { name: 'Editar' }).click()
  await m.getByLabel('Monto predeterminado').fill('130')
  await m.getByRole('button', { name: 'Guardar cambios' }).click()
  const err = page.getByRole('alert').filter({ hasText: 'No se pudo actualizar la plantilla.' })
  await expect(err).toContainText('tardó demasiado')
  await expect(err).toContainText('Resultado incierto')
  await expect(m.getByLabel('Monto de Luz')).toHaveValue('120.00')                      // sin éxito, no cambia en pantalla
})

// ───────────────────────────── v1.4 ─────────────────────────────
const calls = (page: Page) => page.evaluate(() => ({ ...(globalThis as unknown as { __gdDemoCalls: Record<string, number> }).__gdDemoCalls }))
const hoyLima = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())

test.describe('v1.4: gastos mensuales, registro masivo, orden y análisis', () => {
  test('registro masivo: selección persistente, valores temporales, totales por moneda y una sola solicitud', async ({ page }) => {
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    const m = dialog(page)
    await expect(m.getByLabel('Fecha de registro')).toHaveValue(hoyLima())
    // la selección se mantiene al filtrar: buscar "claude", seleccionar visibles, quitar la búsqueda
    await m.getByLabel('Buscar plantilla').fill('claude')
    await expect(m.getByRole('list', { name: 'Plantillas' }).getByRole('listitem')).toHaveCount(1)
    await m.getByRole('button', { name: /Seleccionar visibles/ }).click()
    await m.getByLabel('Buscar plantilla').fill('')
    await expect(m.getByLabel('Seleccionar Claude')).toBeChecked()
    // marcar Gas antes que Luz: el orden de registro es el de la lista, no el de los clics
    await m.getByLabel('Seleccionar Gas').check()
    await m.getByLabel('Seleccionar Luz').check()
    await expect(m.getByText('3 gastos seleccionados')).toBeVisible()
    // cambio temporal del monto de Gas (45 → 50)
    await m.getByLabel('Monto de Gas').fill('50')
    const tot = m.getByTestId('totales')
    await expect(tot).toContainText('Total PEN: S/ 170.00')
    await expect(tot).toContainText('Total USD:')
    await expect(tot).toContainText('20.00')
    await m.getByRole('button', { name: 'Ver detalle' }).click()
    const det = await m.getByRole('list', { name: 'Detalle del lote' }).getByRole('listitem').allInnerTexts()
    expect(det.map(t => t.replace(/\s+/g, ' ').trim().replace(/^\d+\. /, '').split(' ')[0])).toEqual(['Luz', 'Gas', 'Claude'])
    const antes = await total(page), c0 = await calls(page)
    await m.getByRole('button', { name: 'Registrar 3 gastos' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Se registraron correctamente 3 gastos.' })).toBeVisible()
    const c1 = await calls(page)
    expect((c1.saveGastosBatch ?? 0) - (c0.saveGastosBatch ?? 0)).toBe(1)
    expect((c1.saveGasto ?? 0) - (c0.saveGasto ?? 0)).toBe(0)
    await expect.poll(() => total(page)).toBeCloseTo(antes + 120 + 50 + 20 * 3.75, 2)
    // se limpia lo registrado; la plantilla conserva su monto original
    await expect(m.getByText('0 gastos seleccionados')).toBeVisible()
    await expect(m.getByLabel('Monto de Gas')).toHaveValue('45.00')
    await expect(m.getByLabel('Seleccionar Gas')).not.toBeChecked()
    await expect(m.getByRole('button', { name: 'Registrar 0 gastos' })).toBeDisabled()
  })

  test('registro masivo con Apps Script caído: no suma nada y conserva la selección para reintentar', async ({ page }) => {
    await page.goto('/?demo=60&falla=1')
    await expect(kpi(page, 'Total gastado')).toContainText('S/')
    const antes = await total(page)
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    const m = dialog(page)
    await m.getByLabel('Seleccionar Luz').check()
    await m.getByRole('button', { name: 'Registrar 1 gasto' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'No se pudo confirmar el registro de los gastos.' })).toBeVisible()
    await expect(m.getByLabel('Seleccionar Luz')).toBeChecked()
    expect(await total(page)).toBeCloseTo(antes, 2)
  })

  test('ordenar plantillas: arrastrar y Subir/Bajar guardan con una solicitud; con búsqueda no se puede', async ({ page }) => {
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    const m = dialog(page)
    const orden = () => m.getByRole('list', { name: 'Plantillas' }).locator('[aria-label^="Seleccionar "]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')!.slice(12)))
    await expect.poll(async () => (await orden()).slice(0, 3)).toEqual(['Luz', 'Agua', 'Internet'])
    const c0 = await calls(page)
    await m.getByRole('button', { name: 'Más acciones de Agua' }).click()
    await m.getByRole('menuitem', { name: 'Subir' }).click()
    await expect.poll(async () => (await orden()).slice(0, 2)).toEqual(['Agua', 'Luz'])
    expect(((await calls(page)).reorderPlantillas ?? 0) - (c0.reorderPlantillas ?? 0)).toBe(1)
    // arrastrar Internet sobre Agua
    await m.getByRole('button', { name: 'Arrastrar Internet' }).dragTo(m.getByRole('button', { name: 'Arrastrar Agua' }))
    await expect.poll(async () => (await orden()).slice(0, 3)).toEqual(['Internet', 'Agua', 'Luz'])
    expect(((await calls(page)).reorderPlantillas ?? 0) - (c0.reorderPlantillas ?? 0)).toBe(2)
    // con filtros activos no se reordena
    await m.getByLabel('Buscar plantilla').fill('a')
    await expect(m.getByRole('button', { name: 'Arrastrar Agua' })).toBeDisabled()
    await m.getByRole('button', { name: 'Más acciones de Agua' }).click()
    await expect(m.getByRole('menuitem', { name: 'Subir' })).toBeDisabled()
    await m.getByRole('button', { name: 'Más acciones de Agua' }).click() // cierra el menú
    // el orden persiste al cerrar y reabrir (sin volver a leer la hoja)
    await m.getByLabel('Buscar plantilla').fill('')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    await expect.poll(async () => (await orden()).slice(0, 3)).toEqual(['Internet', 'Agua', 'Luz'])
  })

  test('Ajustar caja: "Solo para el mes" viene activado cada vez que se abre', async ({ page }) => {
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Ajustar caja', exact: true }).click()
      const sw = dialog(page).getByRole('switch', { name: /^Solo para / })
      await expect(sw).toHaveAttribute('aria-checked', 'true')
      await sw.click()
      await expect(sw).toHaveAttribute('aria-checked', 'false')
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toHaveCount(0)
    }
  })

  test('pestaña Gastos: botón Gastos mensuales y orden personalizado con ↑ ↓ (una solicitud, sin tocar fechas)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await go(page, 'Gastos')
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    await expect(dialog(page).getByText('Gastos mensuales', { exact: true }).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByLabel('Registros por página').selectOption('50')
    await page.getByRole('button', { name: /Orden personalizado/ }).click()
    const lista = page.getByRole('list', { name: 'Movimientos' })
    const subir = lista.getByRole('button', { name: /^Subir / })
    const nombres = () => subir.evaluateAll(els => els.map(e => e.getAttribute('aria-label')!.slice(6)))
    const n0 = await nombres()
    expect(n0.length).toBeGreaterThan(2)
    const c0 = await calls(page)
    await subir.nth(2).click()
    await expect.poll(nombres).toEqual([n0[0], n0[2], n0[1], ...n0.slice(3)])
    expect(((await calls(page)).reorderGastos ?? 0) - (c0.reorderGastos ?? 0)).toBe(1)
    // con una búsqueda activa el orden manual se bloquea
    await page.getByLabel('Buscar gastos').fill('a')
    await expect(lista.getByRole('button', { name: /^Subir / })).toHaveCount(0)
  })

  test('Análisis detallado: tres vistas, contexto del período, Sankey y frecuencia interactivos', async ({ page }) => {
    const errores: string[] = []
    page.on('pageerror', e => errores.push(e.message))
    const tabs = page.getByRole('tablist', { name: 'Vistas del análisis' }).getByRole('tab')
    await expect(tabs).toHaveCount(3)
    await expect(page.getByRole('tab', { name: 'Por medio de pago' })).toHaveCount(0)
    const movs = await kpi(page, 'Movimientos').innerText()
    await expect(page.getByTestId('analisis-contexto')).toContainText(`${movs} movimiento`)
    // Jerarquía: el ámbito más importante abierto; su porcentaje coincide con la dona
    await expect(page.getByRole('list', { name: 'Jerarquía del gasto' }).getByRole('button', { expanded: true })).toHaveCount(1)
    // Sankey: hover sobre un medio → tooltip con monto, movimientos y %
    await page.getByRole('tab', { name: 'Flujo de medios de pago' }).click()
    await page.getByTestId('sankey-medio').first().hover()
    const tip = page.getByTestId('sankey-tooltip')
    await expect(tip).toContainText('Monto total')
    await expect(tip).toContainText('Movimientos')
    await expect(tip).toContainText('% del total')
    await page.getByTestId('sankey-link').first().hover({ force: true })
    await expect(tip).toContainText('% de ')
    await expect(page.getByTestId('sankey-resumen')).toContainText('Medio dominante')
    // Frecuencia: un punto por categoría y tooltip con ámbito y porcentaje
    await page.getByRole('tab', { name: 'Frecuencia vs monto' }).click()
    const punto = page.getByTestId('frecuencia-punto').first().locator('circle').first()
    await expect(punto).toBeVisible()
    await page.waitForTimeout(600) // animación de entrada de recharts
    await punto.hover({ force: true })
    await expect(page.locator('.recharts-tooltip-wrapper').filter({ hasText: 'Movimientos' })).toContainText('% del total')
    // navegación con teclado entre pestañas
    await page.getByRole('tab', { name: 'Frecuencia vs monto' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Jerarquía' })).toHaveAttribute('aria-selected', 'true')
    expect(errores).toEqual([])
  })
})

// ───────────────────────────── v1.5 ─────────────────────────────
test.describe('v1.5: salud financiera, compromisos y ajustes móviles', () => {
  const valor = (page: Page, id: string) => page.getByTestId(id).innerText().then(money)

  test('compromisos: pagar desde la plantilla baja lo pendiente sin doble conteo en el disponible', async ({ page }) => {
    await go(page, 'Salud financiera')
    await page.getByRole('tab', { name: /Compromisos/ }).click()
    const lista = page.getByRole('list', { name: 'Compromisos' })
    await expect(lista.getByTestId('compromiso').filter({ hasText: 'Luz' })).toContainText('Cubierto')
    await expect(lista.getByTestId('compromiso').filter({ hasText: 'Internet' })).toContainText('Parcial')
    const pend0 = await valor(page, 'comp-pendiente')
    await page.getByRole('tab', { name: /Mi presupuesto/ }).click()
    const gastado0 = await valor(page, 'pres-gastado'), tras0 = await valor(page, 'pres-tras'), pres = await valor(page, 'pres-presupuesto')
    expect(tras0).toBeCloseTo(pres - gastado0 - pend0, 2)
    // pagar los S/ 50 que faltan de Internet desde "Usar" (monto temporal: la plantilla sigue en 100)
    await go(page, 'Dashboard')
    await page.getByRole('button', { name: 'Gastos mensuales' }).first().click()
    await dialog(page).getByRole('button', { name: 'Usar plantilla Internet' }).click()
    const g = dialog(page)
    await expect(g.getByTestId('vinculo-plantilla')).toBeVisible()
    await expect(g.getByLabel('Monto', { exact: true })).toHaveValue('100')
    await g.getByLabel('Monto', { exact: true }).fill('50')
    await g.getByRole('button', { name: 'Registrar gasto' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Gasto registrado correctamente.' })).toBeVisible()
    await go(page, 'Salud financiera')                                                     // vuelve a la última sección vista
    await expect.poll(() => valor(page, 'pres-gastado')).toBeCloseTo(gastado0 + 50, 2)
    expect(await valor(page, 'pres-pendiente')).toBeCloseTo(pend0 - 50, 2)
    expect(await valor(page, 'pres-tras')).toBeCloseTo(tras0, 2)          // no se descuenta dos veces
    await page.getByRole('tab', { name: /Compromisos/ }).click()
    await expect(lista.getByTestId('compromiso').filter({ hasText: 'Internet' })).toContainText('Cubierto')
    // la plantilla conserva su monto predeterminado
    await go(page, 'Dashboard')
    await page.getByRole('button', { name: 'Gastos mensuales' }).first().click()
    await expect(dialog(page).getByLabel('Monto de Internet')).toHaveValue('100.00')
  })

  test('marcar una plantilla como compromiso y asociar a mano un movimiento existente', async ({ page }) => {
    await page.getByRole('button', { name: 'Gastos mensuales' }).first().click()
    const m = dialog(page)
    await m.getByRole('button', { name: 'Más acciones de Spotify' }).click()
    await m.getByRole('menuitem', { name: 'Editar' }).click()
    await expect(m.getByRole('switch', { name: 'Es un compromiso mensual' })).toHaveAttribute('aria-checked', 'false')
    await m.getByRole('switch', { name: 'Es un compromiso mensual' }).click()
    await m.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Plantilla actualizada correctamente.' })).toBeVisible()
    await expect(m.getByRole('list', { name: 'Plantillas' }).getByRole('listitem').filter({ hasText: 'Spotify' })).toContainText('Compromiso')
    await page.keyboard.press('Escape')
    await go(page, 'Salud financiera')
    await page.getByRole('tab', { name: /Compromisos/ }).click()
    const spotify = page.getByRole('list', { name: 'Compromisos' }).getByTestId('compromiso').filter({ hasText: 'Spotify' })
    await expect(spotify).toContainText('Pendiente')
    await spotify.getByRole('button', { name: 'Asociar un movimiento a Spotify' }).click()
    await dialog(page).getByRole('list', { name: 'Movimientos disponibles' }).getByRole('button', { name: 'Asociar' }).first().click()
    await expect(page.getByRole('status').filter({ hasText: 'Movimiento asociado a Spotify' })).toBeVisible()
    await expect(spotify.getByRole('button', { name: /^Quitar vínculo/ })).toHaveCount(1)
  })

  test('salud de datos: Propina Madre aparece como coincidencia, se marca legítima y no se elimina nada', async ({ page }) => {
    const total0 = await total(page)
    await go(page, 'Salud financiera')
    await page.getByRole('tab', { name: /Calidad de datos/ }).click()
    const indice0 = Number(await page.getByTestId('indice-calidad').innerText().then(t => t.split('/')[0]))
    await page.getByRole('button', { name: /^Revisar datos/ }).click()
    const grupo = dialog(page).getByTestId('grupo-similar').filter({ hasText: 'Propina Madre' })
    await expect(grupo).toContainText('Se encontraron 3 movimientos similares')
    await expect(grupo.getByTestId('estado-grupo')).toHaveText('Sin revisar')
    const c0 = await calls(page)
    await grupo.getByRole('button', { name: 'Son legítimos' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Coincidencia marcada como legítima.' })).toBeVisible()
    await expect(grupo.getByTestId('estado-grupo')).toHaveText('Legítimos')
    expect(((await calls(page)).saveRevision ?? 0) - (c0.saveRevision ?? 0)).toBe(1)
    // la clasificación antigua "Cuidado Darielita" se reconoce como histórica (no inválida)
    await expect(dialog(page).getByText(/clasificación\(es\) histórica\(s\) reconocida\(s\)/)).toBeVisible()
    expect(Number(await page.getByTestId('indice-calidad').innerText().then(t => t.split('/')[0]))).toBe(indice0) // una coincidencia legítima no penaliza
    // "Abrir" lleva a Gastos con el movimiento resaltado y su formulario; se puede volver sin perder el período
    await grupo.getByRole('button', { name: /^Abrir/ }).first().click()
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Gastos' })).toHaveAttribute('aria-current', 'page')
    await expect(dialog(page).getByText('Editar gasto', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('foco-banner')).toContainText('Propina Madre')
    await expect(page.locator('[data-foco="true"]').first()).toBeVisible()
    await page.getByRole('button', { name: 'Volver a Salud financiera' }).click()
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Salud financiera' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('tab', { name: /Calidad de datos/ })).toHaveAttribute('aria-selected', 'true')
    await go(page, 'Dashboard')
    expect(await total(page)).toBeCloseTo(total0, 2)                     // los tres registros siguen sumando
  })

  test('evolución: compara tramos equivalentes y muestra ahorro como simulación', async ({ page }) => {
    await go(page, 'Salud financiera')
    await page.getByRole('tab', { name: /Evolución/ }).click()
    await expect(page.getByTestId('evo-rangos')).toContainText('contra del')
    await page.getByRole('radio', { name: 'Subcategoría' }).click()
    await expect(page.getByText('Simulación', { exact: true })).toBeVisible()
  })

  for (const [nombre, vp] of [['iPhone SE', { width: 320, height: 568 }], ['iPhone moderno', { width: 390, height: 844 }], ['Android', { width: 412, height: 915 }], ['tablet', { width: 768, height: 1024 }], ['escritorio', { width: 1280, height: 800 }]] as const) {
    test(`responsive ${nombre}: Fecha y Tipo uniformes, registrar sin obstrucciones y acciones de plantillas centradas`, async ({ page }) => {
      await page.setViewportSize(vp)
      const sinScrollH = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
      await expect.poll(sinScrollH).toBe(true) // tras el reacomodo de los gráficos al nuevo ancho
      // Nuevo gasto
      await page.getByRole('button', { name: 'Nuevo gasto' }).first().click()
      const d = dialog(page)
      const fecha = d.locator('#gasto-fecha'), tipo = d.locator('#gasto-tipo')
      const [bf, bt] = [await fecha.boundingBox(), await tipo.boundingBox()]
      expect(Math.abs(bf!.height - bt!.height)).toBeLessThan(1)
      const estilo = (l: typeof fecha) => l.evaluate(e => { const c = getComputedStyle(e); return [c.borderTopWidth, c.borderRadius, c.fontSize, c.paddingLeft].join('|') })
      expect(await estilo(fecha)).toBe(await estilo(tipo))
      if (vp.width < 360) expect(bt!.y).toBeGreaterThan(bf!.y + bf!.height - 1)   // apilados en pantallas muy angostas
      else expect(Math.abs(bf!.y - bt!.y)).toBeLessThan(1)                          // misma fila
      await fecha.fill('2026-10-03')
      await expect(fecha).toHaveValue('2026-10-03')
      await expect(d.getByText('03/10/2026')).toBeVisible()                         // formato de Configuración
      await tipo.selectOption('Fijo')
      await d.getByRole('radio', { name: 'Personal', exact: true }).click()
      await d.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Alimentación', exact: true }).click()
      await d.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio', { name: 'Almuerzo', exact: true }).click()
      await d.getByLabel('Monto', { exact: true }).fill('12')
      await d.getByRole('radiogroup', { name: 'Medio de pago' }).getByRole('radio', { name: 'Yape', exact: true }).click()
      await d.getByLabel('Descripción').focus()
      const registrar = d.getByRole('button', { name: 'Registrar gasto' })
      await expect(registrar).toBeInViewport()
      expect(await d.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
      await registrar.click()
      await expect(page.getByRole('status').filter({ hasText: 'Gasto registrado correctamente.' })).toBeVisible()
      // Gastos mensuales: grupo de acciones centrado en móvil, a la derecha en escritorio
      await page.getByRole('button', { name: 'Gastos mensuales' }).first().click()
      const filas = dialog(page).getByRole('list', { name: 'Plantillas' }).getByRole('listitem')
      await expect(filas).toHaveCount(11)
      const medidas = await filas.evaluateAll(lis => lis.map(li => {
        const g = li.querySelector('[data-testid="acciones-plantilla"]')!
        const r = li.getBoundingClientRect(), kids = [...g.children].map(c => c.getBoundingClientRect()).filter(k => k.width > 0)
        const izq = Math.min(...kids.map(k => k.left)), der = Math.max(...kids.map(k => k.right))
        return { centro: (izq + der) / 2, centroFila: (r.left + r.right) / 2, dentro: izq >= r.left && der <= r.right, der, derFila: r.right,
          alturas: [...new Set(kids.map(k => Math.round(k.height)))] }
      }))
      for (const x of medidas) {
        expect(x.dentro).toBe(true)
        if (vp.width < 768) { expect(Math.abs(x.centro - x.centroFila)).toBeLessThan(3); expect(x.alturas).toHaveLength(1) }
        else expect(x.derFila - x.der).toBeLessThan(20)
      }
      await expect.poll(sinScrollH).toBe(true)
    })
  }
})

// ───────────────────────────── v1.6 ─────────────────────────────
test.describe('v1.6: pestaña Salud financiera y plantillas sin bloquear', () => {
  test('Salud financiera es una pestaña propia; el Dashboard ya no la muestra y comparte el período', async ({ page }) => {
    await expect(page.getByRole('tablist', { name: 'Vistas de salud financiera' })).toHaveCount(0)
    await expect(page.getByText('Análisis detallado').first()).toBeVisible()
    const c0 = await calls(page)
    await go(page, 'Salud financiera')
    expect(page.url()).toContain('#salud')
    await expect(page.getByRole('heading', { name: /Salud financiera/ })).toBeVisible()
    await expect(page.getByText('Analiza la calidad de tus datos, controla tu presupuesto y descubre oportunidades de ahorro.')).toBeVisible()
    await expect(page.getByRole('tablist', { name: 'Vistas de salud financiera' }).getByRole('tab')).toHaveCount(4)
    const periodo = await page.getByTestId('salud-periodo').innerText()
    // cambiar de pestaña no vuelve a leer la hoja de gastos (las plantillas se leen una vez)
    const c1 = await calls(page)
    expect((c1.data ?? 0) - (c0.data ?? 0)).toBe(0)
    expect((c1.plantillas ?? 0) - (c0.plantillas ?? 0)).toBeLessThanOrEqual(1)
    await go(page, 'Dashboard'); await go(page, 'Salud financiera')
    expect(((await calls(page)).plantillas ?? 0) - (c1.plantillas ?? 0)).toBe(0)
    // el período es el mismo filtro global
    await page.getByRole('button', { name: 'Período', exact: true }).click()
    await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Mes anterior' }).click()
    await expect(page.getByTestId('salud-periodo')).not.toHaveText(periodo)
    const nuevo = await page.getByTestId('salud-periodo').innerText()
    await go(page, 'Dashboard')
    await expect(page.getByText(nuevo.split('·')[0].trim(), { exact: false }).first()).toBeVisible()
  })

  test('guardar plantillas no bloquea: con 5 s de latencia se navega libremente y el éxito llega al final', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/?demo=60&latencia=5000')
    await expect(kpi(page, 'Total gastado')).toContainText('S/', { timeout: 15_000 })
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    const m = dialog(page)
    await expect(m.getByRole('list', { name: 'Plantillas' }).getByRole('listitem')).toHaveCount(11, { timeout: 15_000 })
    await m.getByRole('button', { name: 'Más acciones de Luz' }).click()
    await m.getByRole('menuitem', { name: 'Editar' }).click()
    await m.getByLabel('Monto predeterminado').fill('55')
    await m.getByRole('radiogroup', { name: 'Medio de pago predeterminado' }).getByRole('radio', { name: 'Plin', exact: true }).click()
    await m.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Guardando plantilla…' })).toBeVisible()
    // mientras se guarda, esa plantilla no admite otra edición (evita cambios simultáneos incompatibles); las demás sí
    await expect(m.getByRole('button', { name: 'Más acciones de Luz' })).toHaveCount(0)
    await expect(m.getByRole('button', { name: 'Más acciones de Agua' })).toBeVisible()
    await page.keyboard.press('Escape')
    for (const t of ['Gastos', 'Salud financiera', 'Configuración', 'Dashboard']) {
      await go(page, t)
      await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: t })).toHaveAttribute('aria-current', 'page')
    }
    await expect(page.getByRole('status').filter({ hasText: 'Plantilla actualizada correctamente.' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    await expect(dialog(page).getByLabel('Monto de Luz')).toHaveValue('55.00')
    await expect(dialog(page).getByLabel('Medio de pago de Luz')).toHaveValue('Plin')
  })

  test('con 15 s de latencia: crear y clonar siguen sin bloquear y no se duplican', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/?demo=60&latencia=15000')
    await expect(kpi(page, 'Total gastado')).toContainText('S/', { timeout: 25_000 })
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    const m = dialog(page)
    const filas = m.getByRole('list', { name: 'Plantillas' }).getByRole('listitem')
    await expect(filas).toHaveCount(11, { timeout: 25_000 })
    await m.getByRole('button', { name: 'Más acciones de Netflix' }).click()
    await m.getByRole('menuitem', { name: 'Clonar' }).click()
    await m.getByLabel('Monto predeterminado').fill('45')
    await m.getByRole('button', { name: 'Guardar copia' }).click()
    await expect(filas).toHaveCount(11)                                                    // aún sin confirmar
    await page.keyboard.press('Escape')
    await go(page, 'Salud financiera')
    await expect(page.getByRole('tablist', { name: 'Vistas de salud financiera' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Plantilla clonada correctamente.' })).toBeVisible({ timeout: 25_000 })
    await go(page, 'Dashboard')
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    await expect(filas).toHaveCount(12)
    expect(await page.evaluate(() => (globalThis as unknown as { __gdDemoCalls: Record<string, number> }).__gdDemoCalls.savePlantilla)).toBe(1)
  })
})
