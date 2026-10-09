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
  for (const tab of ['Gastos', 'Categorías', 'Configuración', 'Dashboard']) {
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
  await expect(page.getByRole('row', { name: /Prueba E2E copia/ })).toBeVisible()

  const copy = page.getByRole('row', { name: /Prueba E2E copia/ })
  await copy.getByRole('button', { name: 'Eliminar' }).click()
  await dialog(page).getByRole('button', { name: 'Eliminar' }).click()
  await expect(page.getByRole('row', { name: /Prueba E2E copia/ })).toHaveCount(0)
  await page.getByRole('radio', { name: 'Eliminados' }).click()
  await page.getByRole('row', { name: /Prueba E2E copia/ }).getByRole('button', { name: 'Restaurar' }).click()
  await page.getByRole('radio', { name: 'Activos' }).click()
  await expect(page.getByRole('row', { name: /Prueba E2E copia/ })).toBeVisible()

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
  await expect(page.getByRole('row', { name: /Usa nueva sub/ })).toContainText('Café de prueba')
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
  const row = page.getByRole('row', { name: /Antes de renombrar/ })
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
    // con otro formulario abierto, el error sigue visible y usable (se muestra dentro del modal)
    await page.getByRole('button', { name: 'Nuevo gasto' }).click()
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
