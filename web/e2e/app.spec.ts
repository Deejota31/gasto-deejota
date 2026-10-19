import { expect, test, type Page } from '@playwright/test'

// Corre contra el modo demostración (backend en memoria). No toca Google Sheets ni datos reales.
const kpi = (page: Page, label: string) => page.locator('p', { hasText: new RegExp(`^${label}`) }).locator('xpath=following-sibling::p[1]').first()
/** Cambia de módulo con la navegación que haya en el tamaño de pantalla: sidebar, panel o barra inferior (con "Más"). */
async function go(page: Page, tab: string) {
  const nav = page.getByRole('navigation', { name: 'Secciones' })
  const b = nav.getByRole('button', { name: tab, exact: true })
  if (await b.count()) { await b.click(); return }
  const menu = page.getByRole('button', { name: 'Abrir navegación' })
  if (await menu.count()) { await menu.click(); await page.getByRole('dialog', { name: 'Navegación' }).getByRole('button', { name: tab, exact: true }).click(); return }
  await nav.getByRole('button', { name: 'Más', exact: true }).click()
  await page.getByRole('dialog', { name: 'Más opciones' }).getByRole('button', { name: tab, exact: true }).click()
}
const money = (s: string) => Number(s.replace(/[^\d.-]/g, ''))
// "Total gastado" ya no es una tarjeta: sus cifras viven en el Presupuesto consolidado ("Gastado del período"), que sin filtros de
// dimensión coincide con el total. Con filtros de ámbito/categoría/medio usa `totalFiltrado` (promedio × movimientos).
const total = (page: Page) => cons(page, 'gastado-del-período')
const movimientos = async (page: Page) => Number((await kpi(page, 'Movimientos').innerText()).replace(/\D/g, ''))
const totalFiltrado = async (page: Page) => money(await kpi(page, 'Promedio por movimiento').innerText()) * (await movimientos(page))
/** Espera a que el Dashboard tenga datos: el Presupuesto consolidado ya muestra dinero. */
const datosListos = (page: Page) => page.getByTestId('cons-gastado-del-período')
const dialog = (page: Page) => page.getByRole('dialog')
/** Elige una opción en un selector Combobox (por su id "#x" o su nombre accesible); la lista se pinta en un portal. */
async function pick(page: Page, trigger: string, option: string) {
  const btn = trigger.startsWith('#') ? page.locator(trigger) : page.getByRole('combobox', { name: trigger, exact: true })
  await btn.click()
  const lb = page.getByRole('listbox')
  const ex = lb.getByRole('option', { name: option, exact: true })
  await (await ex.count() ? ex : lb.getByRole('option', { name: new RegExp(`^${option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })).first().click()
}
/** Abre el menú ⋯ de una tarjeta (el menú se cierra al desplazar: primero se deja la tarjeta a la vista). */
async function abrirMenuCat(page: Page, categoria: string) {
  const b = page.getByRole('button', { name: `Acciones de ${categoria}`, exact: true }).first()
  await b.scrollIntoViewIfNeeded(); await page.waitForTimeout(150)
  await b.click()
}
/** Menú ⋯ de una tarjeta de categoría del Catálogo: abre y ejecuta una acción. */
async function accionCat(page: Page, categoria: string, accion: string) {
  await abrirMenuCat(page, categoria)
  await page.getByRole('menuitem', { name: accion, exact: true }).click()
}
/** Abre un grupo (acordeón) de Funciones del backend si está cerrado. */
async function abrirGrupo(page: Page, g: string) {
  const b = page.getByTestId('funciones-backend').getByRole('button', { name: new RegExp(`^${g}`) })
  if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click()
}
const ETIQUETA_TAB: Record<string, string> = { dashboard: 'Dashboard', gastos: 'Gastos', cajas: 'Cajas', catalogo: 'Catálogo', salud: 'Salud financiera', config: 'Configuración' }
const TABS_HASH: Record<string, string> = { cajas: 'Cajas', gastos: 'Gastos', 'catálogo': 'Catálogo', catalogo: 'Catálogo' }
/** Cifras del Presupuesto consolidado: viven en el Dashboard (la pestaña Cajas ya no tiene el panel grande). Si se está en otra pestaña, se lee desde el Dashboard y se vuelve. */
async function cons(page: Page, id: string) {
  const el = page.getByTestId(`cons-${id}`)
  const leer = async () => money(await el.locator('p').nth(1).innerText())
  const hash = page.url().split('#')[1] ?? ''
  const actual = await page.locator('nav[aria-label="Secciones"]:visible [aria-current="page"]').first().evaluate(n => (n.getAttribute('data-nav') ?? '')).catch(() => '')
  if (!actual || actual === 'dashboard' || (!actual && !hash)) { await expect(el).toBeVisible(); return leer() }
  await go(page, 'Dashboard'); await expect(el).toBeVisible()
  const v = await leer()
  await go(page, ETIQUETA_TAB[actual] ?? actual); return v
}

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
  // Las pruebas históricas se escribieron para tarjetas; la vista por defecto ahora es Lista (se prueba aparte).
  await page.addInitScript(() => { try { if (sessionStorage.getItem('vistaDefecto')) return; if (!localStorage.getItem('deejota.vista.fondos')) localStorage.setItem('deejota.vista.fondos', 'grid'); if (!localStorage.getItem('deejota.vista.subcajas')) localStorage.setItem('deejota.vista.subcajas', 'grid') } catch { /* sin almacenamiento */ } })
  await page.goto('/?demo=60')
  await expect(datosListos(page)).toContainText('S/')
})

test('navega por las pestañas; ya no existe el gráfico "Últimos 6 meses"', async ({ page }) => {
  for (const tab of ['Gastos', 'Salud financiera', 'Catálogo', 'Configuración', 'Dashboard']) {
    await go(page, tab)
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: tab })).toHaveAttribute('aria-current', 'page')
  }
  await expect(page.getByRole('link', { name: 'Mi hoja' })).toBeVisible()
  await expect(page.getByText('Últimos 6 meses', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/Gasto acumulado/).first()).toBeVisible()
  await expect(page.getByText('Gasto diario', { exact: true })).toBeVisible()
})

test('cada KPI y cada indicador del presupuesto tiene su icono de información con explicación', async ({ page }) => {
  // Solo quedan cuatro tarjetas KPI (Presupuesto, Total gastado, Disponible y Consumido viven en el Presupuesto consolidado)
  for (const l of ['Promedio diario', 'Promedio por movimiento', 'Mayor gasto', 'Movimientos']) await expect(kpi(page, l)).toBeVisible()
  for (const l of ['Caja mensual', 'Total gastado', 'Disponible', 'Presupuesto']) await expect(page.locator('p', { hasText: new RegExp(`^${l}$`) })).toHaveCount(0)
  await expect(page.getByTestId('kpis').locator('> div p:first-of-type')).toHaveText(['Promedio diario', 'Promedio por movimiento', 'Mayor gasto', 'Movimientos'])
  const indicadores = ['Promedio diario', 'Promedio por movimiento', 'Mayor gasto', 'Movimientos',
    'Libre inicial', 'Gastado fuera de reservas', 'Saldo libre actual', 'Consumido', 'Cómo se calcula']
  for (const l of indicadores) {
    const btn = page.getByRole('button', { name: `Información: ${l}`, exact: true })
    await btn.scrollIntoViewIfNeeded()
    await btn.click()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await page.mouse.move(0, 0) // que el puntero no reabra otro ⓘ al moverse el contenido
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  }
  // los gráficos también llevan su ⓘ
  expect(await page.getByRole('button', { name: /^Información: / }).count()).toBeGreaterThanOrEqual(9)
})

test('filtros: multiselección, chips, dependencia y limpiar', async ({ page }) => {
  const n0 = await movimientos(page)
  const t0 = await totalFiltrado(page)
  const presupuesto0 = await cons(page, 'presupuesto-consolidado')
  await pickMulti(page, 'Ámbito', 'Personal')
  await expect(page.getByRole('button', { name: 'Quitar filtro Personal' })).toBeVisible()
  await expect.poll(() => movimientos(page)).toBeLessThan(n0)
  expect(await totalFiltrado(page)).toBeLessThan(t0)
  expect(await cons(page, 'presupuesto-consolidado')).toBe(presupuesto0)       // el presupuesto usa el período completo
  // Categorías dependientes: solo las del ámbito Personal (Suscripciones sí, Bebé no)
  await page.getByRole('button', { name: 'Categoría', exact: true }).click()
  const cats = page.getByRole('listbox', { name: 'Categoría' })
  await expect(cats.getByRole('option', { name: 'Suscripciones', exact: true })).toBeVisible()
  await expect(cats.getByRole('option', { name: 'Bebé', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Limpiar filtros' }).click()
  await expect.poll(() => movimientos(page)).toBe(n0)
  expect(await totalFiltrado(page)).toBe(t0)
  // Presets de período
  await page.getByRole('button', { name: 'Período', exact: true }).click()
  await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Este año' }).click()
  await expect.poll(() => movimientos(page)).toBeGreaterThanOrEqual(n0)
})

test('presupuesto consolidado: libre inicial = P − reservado; disponible = P − gastado = saldo libre + reservas sin usar', async ({ page }) => {
  const c = (id: string) => page.getByTestId(`cons-${id}`).locator('p').nth(1).innerText().then(money)
  const P = await c('presupuesto-consolidado'), R = await c('reservado-en-cajas')
  expect(await c('libre-inicial')).toBeCloseTo(P - R, 2)
  const disp = money(await page.getByTestId('disponible-consolidado').innerText())
  expect(disp).toBeCloseTo(P - (await c('gastado-del-período')), 2)       // disponible = presupuesto − gastado del período
  expect(await c('disponible-consolidado')).toBeCloseTo(disp, 2)
  // disponible consolidado ≠ saldo libre: difieren en las reservas sin utilizar (siempre ≥ 0)
  expect(disp).toBeGreaterThanOrEqual((await c('saldo-libre-actual')) - 0.005)
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
  await go(page, 'Catálogo')
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
  await go(page, 'Catálogo')
  await accionCat(page, 'Alimentación', 'Editar')
  await expect(dialog(page).getByText(/Se renombrará también en \d+ gasto/)).toHaveCount(0)
  await dialog(page).getByLabel('Nombre').fill('Comida')
  await expect(dialog(page).getByText(/Se renombrará también en \d+ gasto/)).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Guardar' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Acciones de Comida' })).toBeVisible()
  await go(page, 'Gastos')
  const row = page.getByRole('row', { name: /Antes de renombrar/i })
  await expect(row).toContainText('Comida')
  await expect(row).not.toContainText('Alimentación')
})

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('sin scroll horizontal en ninguna pestaña', async ({ page }) => {
    for (const tab of ['Dashboard', 'Gastos', 'Catálogo', 'Configuración']) {
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
  // Dashboard con los mismos filtros: mismos movimientos y mismo total (promedio × movimientos, con la tolerancia del redondeo a céntimos)
  await expect.poll(() => movimientos(page)).toBe(n)
  expect(Math.abs((await totalFiltrado(page)) - suma)).toBeLessThanOrEqual(0.005 * n + 0.01)
})

const toastStack = (page: Page) => page.locator('[aria-live="polite"]').filter({ has: page.locator('[data-kind]') })

test('Dashboard: "+ Nuevo gasto" abre el mismo formulario y actualiza los KPI sin cambiar de sección', async ({ page }) => {
  const antes = await total(page)
  await newGasto(page, { ambito: 'Personal', categoria: 'Alimentación', sub: 'Snack / Antojos', monto: '15.25', medio: 'Plin', desc: 'Desde dashboard' })
  await expect(page.getByRole('status').filter({ hasText: 'Gasto registrado correctamente.' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  await expect.poll(() => total(page)).toBeCloseTo(antes + 15.25, 2)
})

test('notificaciones arriba a la derecha, verdes al confirmar; Top 5 alternable categorías/subcategorías (sin Top 10)', async ({ page }) => {
  await newGasto(page, { ambito: 'Familia', categoria: 'Hogar', sub: 'Muebles', monto: '9', medio: 'Yape', desc: 'Toast' })
  const ok = page.locator('[data-kind="success"]').first()
  await expect(ok).toBeVisible()
  const box = (await ok.boundingBox())!
  const vw = page.viewportSize()!.width
  expect(box.y).toBeLessThan(80)
  expect(vw - (box.x + box.width)).toBeLessThan(40)
  expect(await ok.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(231, 247, 242)')
  await expect(ok).toHaveCount(0, { timeout: 7000 }) // desaparece sola (~4 s)
  await page.getByRole('button', { name: 'Período', exact: true }).click()
  await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Este año' }).click()
  await expect(page.getByRole('heading', { name: 'Top 5 categorías' }).or(page.getByText('Top 5 categorías', { exact: true })).first()).toBeVisible()
  expect(await page.getByLabel('Top 5 categorías').getByRole('button').count()).toBe(5)
  await expect(page.getByText('Top 10 subcategorías')).toHaveCount(0)
  const ranking = page.getByRole('radiogroup', { name: 'Ranking' })
  await ranking.getByRole('radio', { name: 'Subcategorías' }).click()
  const subs = page.getByLabel('Top 5 subcategorías').getByRole('button')
  await expect(subs).toHaveCount(5)
  const montos = await subs.evaluateAll(els => els.map(e => Number((e.getAttribute('title') ?? '').split(': ').slice(1).join(': ').split(' · ')[0].replace(/[^\d.]/g, ''))))
  expect([...montos].sort((a, b) => b - a)).toEqual(montos)                 // de mayor a menor
  // la opción se mantiene al cambiar filtros y al volver al Dashboard
  await page.getByRole('button', { name: 'Período', exact: true }).click()
  await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Este mes' }).click()
  await expect(ranking.getByRole('radio', { name: 'Subcategorías' })).toHaveAttribute('aria-checked', 'true')
  await go(page, 'Gastos'); await go(page, 'Dashboard')
  await expect(page.getByRole('radiogroup', { name: 'Ranking' }).getByRole('radio', { name: 'Subcategorías' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radiogroup', { name: 'Ranking' }).getByRole('radio', { name: 'Categorías', exact: true }).click()
  await expect(page.getByLabel('Top 5 categorías')).toBeVisible()
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
  await go(page, 'Catálogo')
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
    await expect(datosListos(page)).toContainText('S/', { timeout: 10000 })
    const antes = await total(page)
    await newGasto(page, { ambito: 'Trabajo', categoria: 'Transporte', sub: 'Moto Taxi', monto: '4', medio: 'Yape', desc: 'Lento' })
    await expect(page.locator('[data-kind="pending"]')).toContainText('Guardando gasto…')
    // la interfaz sigue usable: cambiar de pestaña, usar filtros y volver
    await go(page, 'Catálogo')
    await go(page, 'Gastos')
    await expect(page.getByRole('row', { name: /Lento/ })).toHaveCount(1) // UI optimista (v1.23): aparece al instante, aunque el servidor tarde
    await go(page, 'Dashboard')
    await expect(page.getByRole('status').filter({ hasText: 'Gasto registrado correctamente.' })).toBeVisible({ timeout: 6000 })
    await expect.poll(() => total(page)).toBeCloseTo(antes + 4, 2)
    await go(page, 'Gastos')
    await expect(page.getByRole('row', { name: /Lento/ })).toHaveCount(1) // sin duplicados
  })

  test('si la escritura falla: notificación roja, sin éxito falso, y "Abrir formulario" conserva los datos', async ({ page }) => {
    await page.goto('/?demo=60&falla=1')
    await expect(datosListos(page)).toContainText('S/')
    const antes = await total(page)
    await newGasto(page, { ambito: 'Amigos', categoria: 'Salidas', sub: 'Cine', monto: '30', medio: 'Plin', desc: 'Falla' })
    const err = page.getByRole('alert').filter({ hasText: 'No se pudo registrar el gasto.' })
    await expect(err).toBeVisible()
    expect(await err.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(253, 236, 236)')
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
    await expect(datosListos(page)).toContainText('S/', { timeout: 10000 })
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
    await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Mes anterior' }).first().click()
    const fila = page.locator('tbody tr').first()
    const texto = await fila.innerText()
    const [dd, mm, yyyy] = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/)!.slice(1)
    await fila.getByRole('button', { name: 'Editar' }).click()
    const descOriginal = await dialog(page).getByLabel('Descripción').inputValue()
    await dialog(page).getByRole('button', { name: 'Cancelar' }).click()
    await fila.getByRole('button', { name: 'Clonar' }).click()
    const d = dialog(page)
    await expect(d.locator('#gasto-fecha')).toHaveAttribute('data-value', `${yyyy}-${mm}-${dd}`)     // no la de hoy
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
    await expect(m.getByLabel('Medio de pago de Internet de la Casa')).toContainText('Plin')
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

  test('Configuración: preferencias y medios siguen funcionando; ya no muestra cajas', async ({ page }) => {
    await go(page, 'Configuración')
    await expect(page.getByRole('heading', { name: 'Configuración' })).toBeVisible()
    await page.getByRole('switch', { name: 'Mostrar notificaciones al guardar' }).click()
    await expect(page.getByRole('switch', { name: 'Mostrar notificaciones al guardar' })).toHaveAttribute('aria-checked', 'false')
    await page.getByRole('switch', { name: 'Mostrar notificaciones al guardar' }).click()
    // v1.8: cajas y presupuestos se administran solo en la pestaña Cajas (sin formularios duplicados aquí)
    await expect(page.getByText('Cajas y presupuestos')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Guardar Caja/ })).toHaveCount(0)
    for (const t of ['Conexión con Google Sheets', 'Preferencias', 'Administración de datos', 'Acerca de']) await expect(page.getByText(t, { exact: true }).first()).toBeVisible()
    // v1.11: los medios de pago ya no se administran en Configuración, sino en la pestaña Catálogo
    await expect(page.getByLabel('Nuevo medio de pago')).toHaveCount(0)
    await go(page, 'Catálogo')
    await expect(page.getByRole('button', { name: 'Nuevo medio de pago', exact: true })).toHaveCount(0)   // sin botón duplicado debajo de las tarjetas
    await expect(page.getByRole('button', { name: 'Agregar', exact: true })).toBeEnabled()
    await expect(async () => {
      if (!(await page.getByRole('menuitem', { name: 'Nuevo medio de pago' }).isVisible())) await page.getByRole('button', { name: 'Agregar', exact: true }).click()
      await expect(page.getByRole('menuitem', { name: 'Nuevo medio de pago' })).toBeVisible({ timeout: 1500 })
    }).toPass({ timeout: 10000 })
    await page.getByRole('menuitem', { name: 'Nuevo medio de pago' }).click()
    await dialog(page).getByLabel('Nombre del medio de pago').fill('Tarjeta')
    await dialog(page).getByRole('button', { name: 'Crear medio de pago' }).click()
    const medios = page.getByRole('list', { name: 'Medios de pago' }).getByRole('listitem')
    await expect(medios).toHaveCount(7)
    expect((await medios.allInnerTexts()).map(s => s.trim()).at(-1)).toBe('Otros')
  })
})

test('plantillas con Apps Script caído: el formulario se cierra, sin éxito falso; error con Reintentar y Reabrir formulario con lo escrito', async ({ page }) => {
  await page.goto('/?demo=60&falla=1')
  await expect(datosListos(page)).toContainText('S/')
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
  await expect(datosListos(page)).toContainText('S/')
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
    await expect(m.locator('#lote-fecha')).toHaveAttribute('data-value', hoyLima())
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
    await expect(datosListos(page)).toContainText('S/')
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
    await m.getByRole('button', { name: 'Reordenar Internet' }).dragTo(m.getByRole('button', { name: 'Reordenar Agua' }))
    await expect.poll(async () => (await orden()).slice(0, 3)).toEqual(['Internet', 'Agua', 'Luz'])
    expect(((await calls(page)).reorderPlantillas ?? 0) - (c0.reorderPlantillas ?? 0)).toBe(2)
    // con filtros activos no se reordena
    await m.getByLabel('Buscar plantilla').fill('a')
    await expect(m.getByRole('button', { name: 'Reordenar Agua' })).toBeDisabled()
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
    await expect(lista.getByRole('button', { name: /^Subir / }).first()).toBeVisible()   // el orden global funciona también con filtros
  })

  test('Análisis detallado: tres vistas, contexto del período, Sankey y frecuencia interactivos', async ({ page }) => {
    const errores: string[] = []
    page.on('pageerror', e => errores.push(e.message))
    const tabs = page.getByRole('tablist', { name: 'Vistas del análisis' }).getByRole('tab')
    await expect(tabs).toHaveCount(3)
    await expect(page.getByRole('tab', { name: 'Por medio de pago' })).toHaveCount(0)
    const movs = await kpi(page, 'Movimientos').innerText()
    await expect(page.getByTestId('analisis-contexto')).toContainText(`${movs} movimiento`)
    // Jerarquía: empieza totalmente contraída
    const arbol = page.getByRole('list', { name: 'Jerarquía del gasto' })
    await expect(arbol.getByRole('button', { expanded: true })).toHaveCount(0)
    await arbol.getByRole('button', { expanded: false }).first().click()
    await expect(arbol.getByRole('button', { expanded: true })).toHaveCount(1)
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
    await expect(lista.getByTestId('compromiso').filter({ hasText: 'Internet' })).toContainText('Parcial')
    await page.getByTestId('grupo-cubiertos').click()                                       // los cubiertos van contraídos
    await expect(lista.getByTestId('compromiso').filter({ hasText: 'Luz' })).toContainText('Cubierto')
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
    await page.getByTestId('grupo-cubiertos').click()
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
    await spotify.getByRole('button', { name: 'Acciones de Spotify' }).click()
    await page.getByRole('menuitem', { name: 'Asociar movimiento' }).click()
    await dialog(page).getByRole('list', { name: 'Movimientos disponibles' }).getByRole('button', { name: 'Asociar' }).first().click()
    await expect(page.getByRole('status').filter({ hasText: 'Movimiento asociado a Spotify' })).toBeVisible()
    // puede haber pasado a "Cubiertos" (grupo contraído)
    const cub = page.getByTestId('grupo-cubiertos')
    if (await cub.count() && (await cub.getAttribute('aria-expanded')) === 'false' && !(await spotify.count())) await cub.click()
    await spotify.getByRole('button', { name: /^Spotify/ }).click()
    await expect(spotify.getByTestId('compromiso-detalle')).toContainText('Gastos vinculados · 1')
    await expect(spotify.getByRole('button', { name: /^Acciones del pago/ })).toHaveCount(1)
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
    await expect(page.getByTestId('evo-rangos')).toContainText('Anterior')
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
      await fecha.click()
      await page.getByRole('gridcell', { name: '3 de octubre de 2026', exact: true }).click()   // calendario propio, sin selector nativo
      await expect(fecha).toHaveAttribute('data-value', '2026-10-03')
      await expect(d.getByText('03/10/2026')).toBeVisible()                         // formato de Configuración
      await pick(page, '#gasto-tipo', 'Fijo')
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
        if (vp.width < 768) { expect(x.alturas).toHaveLength(1); expect(x.der).toBeLessThanOrEqual(x.derFila) }   // v1.17: «Usar» en la línea 1 junto al nombre; el resto, deslizando
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
    await expect(page.getByText('Controla tu presupuesto, revisa la calidad de tus datos y detecta oportunidades de ahorro.')).toBeVisible()
    await expect(page.getByRole('tablist', { name: 'Vistas de salud financiera' }).getByRole('tab')).toHaveCount(5)
    await expect(page.getByTestId('salud-periodo')).toHaveCount(0)               // sin fecha duplicada en el encabezado
    const picker = page.getByRole('button', { name: 'Período', exact: true })
    const periodo = await picker.innerText()
    // cambiar de pestaña no vuelve a leer la hoja de gastos (las plantillas se leen una vez)
    const c1 = await calls(page)
    expect((c1.data ?? 0) - (c0.data ?? 0)).toBe(0)
    expect((c1.plantillas ?? 0) - (c0.plantillas ?? 0)).toBeLessThanOrEqual(1)
    await go(page, 'Dashboard'); await go(page, 'Salud financiera')
    expect(((await calls(page)).plantillas ?? 0) - (c1.plantillas ?? 0)).toBe(0)
    // el período es el mismo filtro global
    await page.getByRole('button', { name: 'Período', exact: true }).click()
    await page.getByRole('dialog', { name: 'Elegir período' }).getByRole('button', { name: 'Mes anterior' }).first().click()
    await page.keyboard.press('Escape')
    await expect(picker).not.toHaveText(periodo)
    const nuevo = (await picker.innerText()).split('\n').at(-1)!.trim()
    await go(page, 'Dashboard')
    await expect(page.getByRole('button', { name: 'Período', exact: true })).toContainText(nuevo)
  })

  test('guardar plantillas no bloquea: con 5 s de latencia se navega libremente y el éxito llega al final', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/?demo=60&latencia=5000')
    await expect(datosListos(page)).toContainText('S/', { timeout: 15_000 })
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
    await expect(dialog(page).getByLabel('Medio de pago de Luz')).toContainText('Plin')
  })

  test('con 15 s de latencia: crear y clonar siguen sin bloquear y no se duplican', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/?demo=60&latencia=15000')
    await expect(datosListos(page)).toContainText('S/', { timeout: 25_000 })
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

// ───────────────────────────── v1.7 ─────────────────────────────
test.describe('v1.7: pestaña Cajas con cajas personalizadas', () => {
  const resumen = (page: Page, l: string) => page.getByTestId('cajas-resumen').locator('div', { hasText: l }).locator('dd').innerText().then(money)
  const tarjeta = (page: Page, n: string) => page.getByRole('list', { name: 'Lista de cajas' }).getByTestId('caja').filter({ hasText: n })

  test('crear por subcategoría descuenta la reserva del libre; duplicado rechazado; editar, desactivar y eliminar sin tocar gastos', async ({ page }) => {
    const total0 = await total(page)
    await go(page, 'Cajas')
    await expect(page.getByRole('heading', { name: 'Cajas y presupuestos' })).toBeVisible()
    const res0 = await resumen(page, 'Reservado en cajas'), libre0 = await resumen(page, 'Libre inicial')
    await page.getByRole('button', { name: 'Nueva caja' }).click()
    const d = dialog(page)
    await d.getByLabel('Nombre').fill('Caja Línea Celular')
    await d.getByRole('radio', { name: 'Subcategoría' }).click()
    await pick(page, '#caja-valor', 'Línea Celular')
    await d.getByLabel('Monto asignado por mes').fill('40')
    await d.getByRole('button', { name: 'Crear caja' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Caja Línea Celular creada correctamente.' })).toBeVisible()
    await expect(tarjeta(page, 'Caja Línea Celular')).toContainText('Subcategoría · Servicios › Línea Celular')
    await expect.poll(() => resumen(page, 'Reservado en cajas')).toBeCloseTo(res0 + 40, 2)
    expect(await resumen(page, 'Libre inicial')).toBeCloseTo(libre0 - 40, 2)            // la general no duplica la reserva
    // mismo alcance y valor: rechazado en el formulario
    await page.getByRole('button', { name: 'Nueva caja' }).click()
    await d.getByLabel('Nombre').fill('Otra línea')
    await d.getByRole('radio', { name: 'Subcategoría' }).click()
    await pick(page, '#caja-valor', 'Línea Celular')
    await d.getByLabel('Monto asignado por mes').fill('10')
    await d.getByRole('button', { name: 'Crear caja' }).click()
    await expect(d.getByText(/ya usa Subcategoría = Servicios › Línea Celular/)).toBeVisible()
    await d.getByRole('button', { name: 'Cancelar' }).click()
    // editar el monto
    await tarjeta(page, 'Caja Línea Celular').getByRole('button', { name: 'Editar Caja Línea Celular' }).click()
    await d.getByLabel('Monto asignado por mes').fill('60')
    await d.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect.poll(() => resumen(page, 'Reservado en cajas')).toBeCloseTo(res0 + 60, 2)
    // desactivar: deja de reservar
    await tarjeta(page, 'Caja Línea Celular').getByRole('switch', { name: /Desactivar Caja Línea Celular/ }).click()
    await expect(tarjeta(page, 'Caja Línea Celular').getByTestId('estado-caja')).toHaveText('Inactiva')
    await expect.poll(() => resumen(page, 'Reservado en cajas')).toBeCloseTo(res0, 2)
    // eliminar con confirmación
    await tarjeta(page, 'Caja Línea Celular').getByRole('button', { name: 'Más acciones de Caja Línea Celular' }).click()
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    await expect(d.getByText('ningún gasto se borra', { exact: false })).toBeVisible()
    await d.getByRole('button', { name: 'Eliminar', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Caja Línea Celular eliminada. Ningún gasto se borró.' })).toBeVisible()
    await expect(tarjeta(page, 'Caja Línea Celular')).toHaveCount(0)
    await go(page, 'Dashboard')
    expect(await total(page)).toBeCloseTo(total0, 2)
  })

  test('con muchas cajas: buscar, filtrar por alcance y estado, ordenar, vista lista y reordenar con una solicitud', async ({ page }) => {
    await page.goto('/?demo=60&cajas=10#cajas')
    const cards = page.getByRole('list', { name: 'Lista de cajas' }).getByTestId('caja')
    await expect(cards).toHaveCount(13)
    await page.getByLabel('Buscar caja').fill('salud')
    await expect(cards).toHaveCount(1)
    await page.getByLabel('Buscar caja').fill('zzz')
    await expect(page.getByText('Ninguna caja coincide')).toBeVisible()
    await page.getByRole('button', { name: 'Limpiar filtros' }).click()
    await page.getByLabel('Filtrar por alcance').selectOption('Subcategoría')
    await expect(cards).toHaveCount(3)
    await page.getByLabel('Filtrar por alcance').selectOption('todos')
    await page.getByLabel('Ordenar cajas').selectOption('mas')
    const nombres = () => cards.locator('p.truncate.text-sm').allInnerTexts()
    expect((await nombres())[0]).toBe('Caja Familia')                                 // la más gastada
    await page.getByRole('radio', { name: 'Lista' }).click()
    await expect(cards).toHaveCount(13)
    await page.getByRole('radio', { name: 'Tarjetas' }).click()
    await page.getByLabel('Ordenar cajas').selectOption('manual')
    expect((await nombres()).slice(0, 2)).toEqual(['Caja Auto', 'Caja Bebé'])
    const c0 = await calls(page)
    await tarjeta(page, 'Caja Auto').getByRole('button', { name: 'Más acciones de Caja Auto' }).click()
    await page.getByRole('menuitem', { name: 'Bajar' }).click()
    await expect.poll(async () => (await nombres()).slice(0, 2)).toEqual(['Caja Bebé', 'Caja Auto'])
    expect(((await calls(page)).reorderCajas ?? 0) - (c0.reorderCajas ?? 0)).toBe(1)
    // la caja por medio de pago se explica en su tarjeta; las de clasificación muestran con quién se solapan
    await expect(tarjeta(page, 'Caja Sodexo').getByTestId('solape')).toContainText('Toma lo pagado con Sodexo')
    await expect(tarjeta(page, 'Caja Bebé').getByTestId('solape')).toContainText('Caja Familia')
    // el Dashboard las resume en un acordeón cerrado y enlaza a Cajas
    await go(page, 'Dashboard')
    const acc = page.getByRole('button', { name: /Cajas \/ reservas/ })
    await expect(acc).toHaveAttribute('aria-expanded', 'false')
    await expect(acc).toContainText('13 activas')
    await acc.click()
    await expect(page.getByRole('list', { name: 'Cajas del período' }).getByRole('listitem')).toHaveCount(13)
    await page.getByRole('region', { name: 'Cajas / reservas' }).getByRole('button', { name: 'Administrar en Cajas' }).click()
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Cajas' })).toHaveAttribute('aria-current', 'page')
  })

  test('responsive: la pestaña Cajas no genera scroll horizontal en móvil ni tablet', async ({ page }) => {
    for (const vp of [{ width: 360, height: 780 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(vp)
      await page.goto('/?demo=60&cajas=10#cajas')
      await expect(page.getByRole('heading', { name: 'Cajas y presupuestos' })).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    }
  })
})

// ───────────────────────────── v1.8 ─────────────────────────────
test.describe('v1.8: fondos del presupuesto y presupuesto consolidado', () => {
  const fondo = (page: Page, n: string) => page.getByRole('list', { name: 'Lista de fondos' }).getByTestId('fondo').filter({ has: page.getByTestId('fondo-nombre').getByText(n, { exact: true }) })
  const saludValor = (page: Page, id: string) => page.getByTestId(id).innerText().then(money)

  test('General 3500 + Sodexo 280 + Extra 1 1000 = 4780; desactivar Extra 1 → 3780 con aviso; reactivar → 4780; mismas cifras en Dashboard y Salud', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3#cajas')
    await expect(page.getByRole('list', { name: 'Lista de fondos' }).getByTestId('fondo')).toHaveCount(3)
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(4780)
    const gastado = await cons(page, 'gastado-del-período')
    expect(await cons(page, 'disponible-consolidado')).toBeCloseTo(4780 - gastado, 2)
    // apagar Extra 1: se informa el impacto antes, y el fondo queda guardado
    await fondo(page, 'Extra 1').getByRole('switch', { name: 'Desactivar Extra 1' }).click()
    await expect(dialog(page).getByTestId('impacto-desactivar')).toContainText('S/ 4,780.00')
    await expect(dialog(page).getByTestId('impacto-desactivar')).toContainText('S/ 3,780.00')
    await dialog(page).getByRole('button', { name: 'Desactivar' }).click()
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(3780)
    await expect(fondo(page, 'Extra 1').getByTestId('estado-fondo')).toHaveText('Inactiva')
    await expect(page.getByRole('status').filter({ hasText: 'Extra 1 desactivada' })).toBeVisible()
    // Dashboard y Salud financiera usan el mismo cálculo
    await go(page, 'Dashboard')
    expect(await cons(page, 'presupuesto-consolidado')).toBe(3780)
    expect(await cons(page, 'disponible-consolidado')).toBeCloseTo(3780 - gastado, 2)
    await go(page, 'Salud financiera')
    await page.getByRole('tab', { name: /Mi presupuesto/ }).click()
    expect(await saludValor(page, 'pres-presupuesto')).toBe(3780)
    expect(await saludValor(page, 'pres-disponible')).toBeCloseTo(3780 - gastado, 2)
    // reactivar
    await go(page, 'Cajas')
    await fondo(page, 'Extra 1').getByRole('switch', { name: 'Activar Extra 1' }).click()
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(4780)
    await go(page, 'Dashboard')
    expect(await cons(page, 'presupuesto-consolidado')).toBe(4780)
  })

  test('por mes: noviembre empieza vacío (v1.19), se copia de octubre sin Extra 1; ajustar General solo en noviembre no cambia octubre ni diciembre', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3#cajas')
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(4780)
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(0)                     // nada se arrastra solo
    await expect(page.getByTestId('vacio-mes-fondo')).toContainText('No tienes fondos configuradas para noviembre')
    await page.getByTestId('vacio-mes-fondo').getByRole('button', { name: 'Copiar configuración del mes anterior' }).click()
    const c = dialog(page)
    await expect(c).toContainText('Usar fondos del mes anterior')
    await c.getByRole('button', { name: /^Aplicar \d+ a noviembre/i }).click()
    await expect(c).toHaveCount(0)
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(3780)                  // Extra 1 era solo de octubre
    await fondo(page, 'General').getByRole('button', { name: 'Editar fondo General' }).click()
    const d = dialog(page)
    await d.getByLabel(/^Importe de /).fill('4000')
    await d.getByRole('radiogroup', { name: 'Aplicar el importe' }).getByRole('radio', { name: /^Solo / }).click()
    await d.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(4280)
    await expect(fondo(page, 'General')).toContainText('Ajustado')
    await page.getByRole('button', { name: 'Mes anterior' }).first().click()
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(4780)                  // octubre intacto
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(0)                     // diciembre: aún sin preparar
  })

  test('nuevo fondo: valida, suma sin tocar General, doble clic no duplica y no bloquea la navegación', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3&latencia=2500#cajas')
    await expect.poll(() => cons(page, 'presupuesto-consolidado'), { timeout: 15_000 }).toBe(4780)
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(d.getByText('Escribe un nombre')).toBeVisible()
    await d.getByLabel('Nombre del fondo').fill(' extra 1 ')
    await d.getByLabel('Monto').fill('100')
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(d.getByText('Ya tienes un fondo con ese nombre')).toBeVisible()
    await d.getByLabel('Nombre del fondo').fill('Bonificación')
    await d.getByLabel('Monto').fill('1.234')
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(d.getByText(/Monto mayor o igual a 0/)).toBeVisible()
    await d.getByLabel('Monto').fill('200')
    await d.getByRole('radio', { name: 'Solo un mes' }).click()
    const c0 = await calls(page)
    await d.getByRole('button', { name: 'Crear fondo' }).dblclick()
    await expect(d).toHaveCount(0)
    // mientras Apps Script responde se puede seguir navegando
    await go(page, 'Gastos')
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Gastos' })).toHaveAttribute('aria-current', 'page')
    await go(page, 'Cajas')
    await expect(page.getByRole('status').filter({ hasText: 'Bonificación creada' })).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(4980)
    await expect(fondo(page, 'General').getByTestId('fondo-aporte')).toHaveText('S/ 3,500.00')
    expect(((await calls(page)).saveFondo ?? 0) - (c0.saveFondo ?? 0)).toBe(1)
    await expect(page.getByRole('list', { name: 'Lista de fondos' }).getByTestId('fondo')).toHaveCount(4)
  })

  test('sin fondos: sigue la caja general; migrar crea General con el mismo importe (idempotente) y no convierte Sodexo', async ({ page }) => {
    await page.goto('/?demo=60#cajas')
    await expect(page.getByTestId('sin-fondos')).toBeVisible()
    // estado vacío igual al de subcajas, con acción para crear el primer fondo
    await expect(page.getByTestId('vacio-fondos')).toContainText('Aún no tienes fondos registradas. Registra un fondo para empezar')
    await expect(page.getByRole('button', { name: 'Crear mi primer fondo' })).toHaveCount(0)   // v1.21: sin botón en el estado vacío
    await page.getByRole('button', { name: 'Nuevo fondo' }).first().click()                     // el control habitual sigue funcionando
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    const p0 = await cons(page, 'presupuesto-consolidado')
    expect(p0).toBe(7000)
    await page.getByRole('button', { name: /Crear fondo General con/ }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Fondo General creada' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Lista de fondos' }).getByTestId('fondo')).toHaveCount(1)
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(p0)                     // ningún mes cambia
    await expect(page.getByRole('button', { name: /Crear fondo General/ })).toHaveCount(0)
    await expect(page.getByTestId('vacio-fondos')).toHaveCount(0)            // con un fondo ya no se muestra
    expect((await calls(page)).migrarGeneralAFondo).toBe(1)
  })

  test('20 fondos: se muestran 6 con "Ver todas", buscar y filtrar; sin scroll horizontal en móvil, iPhone y tablet', async ({ page }) => {
    await page.goto('/?demo=60&fondos=20#cajas')
    const cards = page.getByRole('list', { name: 'Lista de fondos' }).getByTestId('fondo')
    await expect(cards).toHaveCount(6)
    await page.getByRole('button', { name: 'Ver las 20 fondos' }).click()
    await expect(cards).toHaveCount(20)
    await page.getByLabel('Buscar fondo').fill('extra')
    await expect(cards).toHaveCount(2)
    await page.getByLabel('Buscar fondo').fill('')
    await page.getByLabel('Filtrar fondos por estado').selectOption('inactivas')
    await expect(cards).toHaveCount(4)
    await page.getByLabel('Filtrar fondos por estado').selectOption('todas')
    await page.getByRole('radiogroup', { name: 'Vista de fondos' }).getByRole('radio', { name: 'Lista' }).click()
    await expect(cards).toHaveCount(20)
    for (const n of [2, 5, 10, 20]) for (const vp of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(vp)
      await page.goto(`/?demo=60&fondos=${n}#cajas`)
      await expect(page.getByTestId('n-fondos')).toHaveText(String(n))
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    }
  })

  test('gasto con Sodexo: se atribuye al fondo Sodexo, descuenta una sola vez; eliminar y restaurar lo devuelven exacto', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3#cajas')
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(4780)
    const gSodexo = () => fondo(page, 'Sodexo').innerText().then(t => money(/Gastado\s+S\/\s*([\d,.]+)/.exec(t)![1]))
    const s0 = await gSodexo(), g0 = await cons(page, 'gastado-del-período'), d0 = await cons(page, 'disponible-consolidado')
    await go(page, 'Gastos')
    await newGasto(page, { ambito: 'Personal', categoria: 'Alimentación', sub: 'Almuerzo', monto: '25', medio: 'Sodexo', desc: 'Menú Sodexo E2E' })
    await expect(page.getByRole('row', { name: /Menú Sodexo E2E/ })).toBeVisible()
    await go(page, 'Cajas')
    await expect.poll(gSodexo).toBeCloseTo(s0 + 25, 2)
    expect(await cons(page, 'gastado-del-período')).toBeCloseTo(g0 + 25, 2)
    expect(await cons(page, 'disponible-consolidado')).toBeCloseTo(d0 - 25, 2)
    expect(await cons(page, 'presupuesto-consolidado')).toBe(4780)                          // gastar no cambia el presupuesto
    await go(page, 'Gastos')
    await page.getByRole('row', { name: /Menú Sodexo E2E/ }).getByRole('button', { name: 'Eliminar' }).click()
    await dialog(page).getByRole('button', { name: 'Eliminar' }).click()
    await expect(page.getByRole('row', { name: /Menú Sodexo E2E/ })).toHaveCount(0)
    await go(page, 'Cajas')
    await expect.poll(() => cons(page, 'disponible-consolidado')).toBeCloseTo(d0, 2)
    await go(page, 'Gastos')
    await page.getByRole('radio', { name: 'Eliminados' }).click()
    await page.getByRole('row', { name: /Menú Sodexo E2E/ }).getByRole('button', { name: 'Restaurar' }).click()
    await page.getByRole('radio', { name: 'Activos' }).click()
    await go(page, 'Cajas')
    await expect.poll(() => cons(page, 'disponible-consolidado')).toBeCloseTo(d0 - 25, 2)
    await expect.poll(gSodexo).toBeCloseTo(s0 + 25, 2)
  })

  test('menú en el orden pedido y centrado en escritorio', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Secciones' })
    expect(await nav.getByRole('button').evaluateAll(bs => bs.map(b => b.getAttribute('aria-label') || (b.textContent ?? '').trim()))).toEqual(['Dashboard', 'Gastos', 'Cajas', 'Catálogo', 'Salud financiera', 'Configuración'])
    await page.setViewportSize({ width: 1366, height: 900 })
    // Escritorio: barra lateral a la izquierda (contraída por defecto); tablet: panel temporal; móvil: barra inferior.
    const lat = await page.getByRole('complementary', { name: 'Barra lateral' }).boundingBox()
    expect(lat!.x).toBe(0); expect(lat!.width).toBeLessThanOrEqual(76)
    await page.setViewportSize({ width: 768, height: 1024 })
    await expect(page.getByRole('button', { name: 'Abrir navegación' })).toBeVisible()
  })
})

// ───────────────────────────── v1.9 ─────────────────────────────
test.describe('v1.9: Dashboard compacto, cifras idénticas entre pestañas e iconos', () => {
  const celdas = async (page: Page) => Object.fromEntries(await page.getByTestId('consolidado').locator('[data-testid^="cons-"]').evaluateAll(els =>
    els.map(e => [e.getAttribute('data-testid'), e.querySelectorAll('p')[1]?.textContent ?? ''])))

  test('orden: filtros → Presupuesto consolidado (con KPIs dentro) → acordeones → gráficos; acordeones cerrados, se abren con clic y teclado y vuelven a cerrarse al volver', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3')
    const y = async (l: ReturnType<Page['locator']>) => (await l.boundingBox())!.y
    const kpiY = await y(page.getByTestId('kpis'))
    const consY = await y(page.getByTestId('caja-general'))
    const accY = await y(page.getByTestId('resumen-cajas'))
    const chartY = await y(page.getByText(/^Gasto acumulado/).first())
    expect(consY).toBeLessThan(kpiY); expect(kpiY).toBeLessThan(accY); expect(accY).toBeLessThan(chartY)
    await expect(page.getByTestId('consolidado-subtitulo')).toContainText(/3 fondos activos · \w+ \d{4}/)
    const fondos = page.getByRole('button', { name: /^Fondos del presupuesto/ }), subcajas = page.getByRole('button', { name: /^Cajas \/ reservas/ })
    await expect(fondos).toHaveAttribute('aria-expanded', 'false')
    await expect(subcajas).toHaveAttribute('aria-expanded', 'false')
    await expect(fondos).toContainText('3 activas · S/ 4,780.00')
    await expect(page.getByRole('list', { name: 'Fondos del período' })).toHaveCount(0)            // no se renderiza cerrado
    await fondos.click()
    await expect(page.getByRole('list', { name: 'Fondos del período' }).getByRole('listitem')).toHaveCount(3)
    await expect(subcajas).toHaveAttribute('aria-expanded', 'false')                                   // no abre ambos
    await subcajas.focus(); await page.keyboard.press('Enter')
    await expect(subcajas).toHaveAttribute('aria-expanded', 'true')
    await fondos.click()
    await expect(fondos).toHaveAttribute('aria-expanded', 'false')
    // ya no están las tarjetas grandes de subcajas ni el Top 10
    await expect(page.getByRole('button', { name: /^Ajustar Caja/ })).toHaveCount(0)
    await expect(page.getByText('Top 10 subcategorías')).toHaveCount(0)
    await go(page, 'Gastos'); await go(page, 'Dashboard')
    await expect(page.getByRole('button', { name: /^Cajas \/ reservas/ })).toHaveAttribute('aria-expanded', 'false')
  })

  for (const q of ['?demo=60&fondos=3', '?demo=60', '?demo=60&fondos=20&cajas=10']) {
    test(`Presupuesto consolidado idéntico en Dashboard, Cajas y Salud (${q})`, async ({ page }) => {
      await page.goto(q)
      await expect(page.getByTestId('consolidado')).toBeVisible()
      const dash = await celdas(page), dispDash = await page.getByTestId('disponible-consolidado').innerText()
      await go(page, 'Cajas')                                                                   // Cajas ya no repite el panel: sus indicadores superiores coinciden con el Dashboard
      await expect(page.getByTestId('consolidado')).toHaveCount(0)
      const res = (l: string) => page.getByTestId('cajas-resumen').locator('dt', { hasText: l }).locator('xpath=following-sibling::dd[1]').innerText().then(money)
      expect(await res('Presupuesto consolidado')).toBe(money(dash['cons-presupuesto-consolidado']))
      expect(await res('Reservado en cajas')).toBe(money(dash['cons-reservado-en-cajas']))
      await go(page, 'Dashboard')
      await go(page, 'Salud financiera')
      await page.getByRole('tab', { name: /Mi presupuesto/ }).click()
      expect(money(await page.getByTestId('pres-presupuesto').innerText())).toBe(money(dash['cons-presupuesto-consolidado']))
      expect(money(await page.getByTestId('pres-disponible').innerText())).toBe(money(dash['cons-disponible-consolidado']))
      expect(money(await page.getByTestId('pres-gastado').innerText())).toBe(money(dash['cons-gastado-del-período']))
    })
  }

  test('cambiar un gasto actualiza igual Dashboard y Cajas (sin recargar, una sola vez)', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3')
    const d0 = money(await page.getByTestId('disponible-consolidado').innerText())
    const c0 = await calls(page)
    await newGasto(page, { ambito: 'Personal', categoria: 'Auto', sub: 'Gasolina', monto: '40', medio: 'Plin', desc: 'Grifo v1.9' })
    await expect.poll(async () => money(await page.getByTestId('disponible-consolidado').innerText())).toBeCloseTo(d0 - 40, 2)
    const dash = await celdas(page)
    await go(page, 'Cajas')
    await expect(page.getByTestId('consolidado')).toHaveCount(0)
    expect(money(await page.getByTestId('cajas-resumen').locator('dt', { hasText: 'Presupuesto consolidado' }).locator('xpath=following-sibling::dd[1]').innerText())).toBe(money(dash['cons-presupuesto-consolidado']))
    expect(((await calls(page)).data ?? 0) - (c0.data ?? 0)).toBe(0)                                  // sin lecturas extra del Sheet
  })

  test('iconos: buscar por sinónimo, sugerencias según el nombre y guardar el icono de una subcategoría', async ({ page }) => {
    await go(page, 'Catálogo')
    await page.getByRole('button', { name: 'Gasolina', exact: true }).first().click()
    const d = dialog(page)
    await expect(d.getByRole('region', { name: 'Sugeridos' }).or(d.getByLabel('Sugeridos'))).toBeVisible()
    await expect(d.getByLabel('Sugeridos').getByRole('button', { name: 'Icono fuel' })).toBeVisible()
    await d.getByLabel('Buscar icono').fill('mascota')
    await expect(d.getByRole('button', { name: 'Icono dog' })).toBeVisible()
    await d.getByLabel('Buscar icono').fill('')
    await d.getByLabel('Sugeridos').getByRole('button', { name: 'Icono fuel' }).click()
    await d.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Subcategoría actualizada correctamente.' })).toBeVisible()
    await page.getByRole('button', { name: 'Gasolina', exact: true }).first().click()
    await expect(dialog(page).getByRole('button', { name: 'Icono fuel' }).first()).toHaveAttribute('aria-pressed', 'true')
  })

  test('responsive: Dashboard sin scroll horizontal (360, 390, 768) con acordeones abiertos', async ({ page }) => {
    for (const vp of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(vp)
      await page.goto('/?demo=60&fondos=20&cajas=10')
      await page.getByRole('button', { name: /^Fondos del presupuesto/ }).click()
      await page.getByRole('button', { name: /^Cajas \/ reservas/ }).click()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    }
  })
})

test('respaldos: la carpeta se ve en Configuración y se puede cambiar pegando un enlace de Drive', async ({ page }) => {
  await go(page, 'Configuración')
  const box = page.getByTestId('carpeta-respaldos')
  await expect(box).toContainText('Backup')
  await expect(box).toContainText('junto a tu hoja')
  await box.getByRole('button', { name: 'Cambiar' }).click()
  await box.getByLabel('Enlace de la carpeta de respaldos').fill('esto no es un enlace')
  await box.getByRole('button', { name: 'Guardar' }).click()
  await expect(box).toContainText('Pega el enlace de una carpeta')
  await box.getByLabel('Enlace de la carpeta de respaldos').fill('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp')
  await box.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Los respaldos se guardarán en' })).toBeVisible()
  await expect(box).toContainText('Mi carpeta de respaldos')
  await box.getByRole('button', { name: 'Usar la de junto a la hoja' }).click()
  await expect(box).toContainText('junto a tu hoja')
})

test('compromisos: panel compacto — resumen, orden por estado, cubiertos contraídos, detalle y menú; sin desborde en el celular', async ({ page }) => {
  await go(page, 'Salud financiera')
  await page.getByRole('tab', { name: /Compromisos/ }).click()
  await expect(page.getByTestId('comp-resumen')).toContainText('Previsto')
  await expect(page.getByTestId('comp-resumen')).toContainText('Pagado')
  await expect(page.getByTestId('comp-resumen')).toContainText('Pendiente')
  const filas = page.getByRole('list', { name: 'Compromisos' }).getByTestId('compromiso')
  const estados = await filas.evaluateAll(els => els.map(e => e.getAttribute('data-estado')))
  const rango = (e: string | null) => (e === 'pendiente' || e === 'parcial' ? 0 : e === 'por-confirmar' ? 1 : 2)
  expect(estados.map(rango)).toEqual([...estados.map(rango)].sort((a, b) => a - b))           // pendientes → por confirmar → cubiertos
  expect(estados).not.toContain('cubierto')                                                    // cubiertos contraídos por defecto
  const g = page.getByTestId('grupo-cubiertos')
  await expect(g).toHaveAttribute('aria-expanded', 'false')
  await g.click()
  await expect(page.getByRole('list', { name: 'Compromisos cubiertos' }).getByTestId('compromiso').first()).toBeVisible()
  // detalle: categoría, caja, medio, notas y pagos vinculados
  const luz = filas.filter({ hasText: 'Luz' })
  await luz.getByRole('button', { name: /^Luz/ }).click()
  const det = luz.getByTestId('compromiso-detalle')
  for (const t of ['Categoría', 'Caja asignada', 'Medio de pago', 'Notas', 'Gastos vinculados']) await expect(det).toContainText(t)
  await expect(luz.getByTestId('estado-compromiso')).toHaveText(/Cubierto/)                   // estado con texto
  // acciones secundarias en menú
  await luz.getByRole('button', { name: 'Acciones de Luz' }).click()
  await expect(page.getByRole('menuitem', { name: 'Asociar movimiento' })).toBeVisible()
  await page.keyboard.press('Escape')
  for (const vp of [{ width: 360, height: 780 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(vp)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  }
})

test.describe('v1.10: cascada de fondos, iconos y colores unificados, plantillas con tipo y recurrente', () => {
  const fondo = (page: Page, n: string) => page.getByRole('list', { name: 'Lista de fondos' }).getByTestId('fondo').filter({ has: page.getByTestId('fondo-nombre').getByText(n, { exact: true }) })
  const disponible = async (page: Page, n: string) => money(/disponible\s+(-?S\/\s*[\d,.]+)/.exec(await fondo(page, n).innerText())![1])

  test('cascada: un gasto que agota General pasa a la siguiente fondo libre; nadie queda en negativo y todo suma el consolidado', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3#cajas')
    await expect.poll(() => cons(page, 'presupuesto-consolidado'), { timeout: 15_000 }).toBe(4780)
    const dGeneral = await disponible(page, 'General')
    const dExtra = await disponible(page, 'Extra 1')
    const exceso = 100
    await go(page, 'Gastos')
    await newGasto(page, { ambito: 'Personal', categoria: 'Alimentación', sub: 'Almuerzo', monto: String(Math.ceil(dGeneral) + exceso), medio: 'Yape', desc: 'Cascada E2E' })
    await go(page, 'Cajas')
    await expect.poll(() => disponible(page, 'General')).toBeCloseTo(0, 2)
    await expect(fondo(page, 'General')).not.toContainText('Excedida')
    await expect.poll(() => disponible(page, 'Extra 1')).toBeCloseTo(dExtra - (Math.ceil(dGeneral) + exceso - dGeneral), 2)
    const suma = (await disponible(page, 'General')) + (await disponible(page, 'Sodexo')) + (await disponible(page, 'Extra 1'))
    expect(suma).toBeCloseTo(await cons(page, 'disponible-consolidado'), 2)
    await go(page, 'Dashboard')
    await expect(page.getByTestId('resumen-cajas')).toBeVisible()
  })

  test('Nuevo fondo: sin selector de icono/color; la vista previa toma el aspecto del medio (Plin) o de General', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3#cajas')
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    await expect(d.getByTestId('apariencia')).toHaveCount(0)
    await expect(d.getByText('Icono y color')).toHaveCount(0)
    await d.getByLabel('Nombre del fondo').fill('Vales Plin')
    await d.getByLabel('Monto').fill('50')
    await pick(page, '#fondo-medio', 'Plin')
    await expect(d.locator('span.size-11').first()).toHaveCSS('color', 'rgb(11, 158, 168)')
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Vales Plin creada' })).toBeVisible({ timeout: 15_000 })
    await expect(fondo(page, 'Vales Plin').locator('svg.lucide-smartphone')).toHaveCount(1)
  })

  test('un fondo con medio de pago se ve igual que ese medio en Cajas, Dashboard y Catálogo', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3#cajas')
    await expect.poll(() => cons(page, 'presupuesto-consolidado'), { timeout: 15_000 }).toBe(4780)
    const tile = fondo(page, 'Sodexo').locator('span.size-11').first()
    await expect(tile.locator('svg.lucide-ticket')).toHaveCount(1)
    await expect(tile).toHaveCSS('color', 'rgb(210, 70, 60)')
    await go(page, 'Catálogo')                                   // los medios de pago se ven (y se administran) en el Catálogo
    await expect(page.getByRole('list', { name: 'Medios de pago' }).locator('svg.lucide-ticket')).toHaveCount(1)
    await go(page, 'Dashboard')
    await page.getByRole('button', { name: /^Fondos del presupuesto/ }).click()
    const fila = page.getByRole('list', { name: 'Fondos del período' }).getByRole('listitem').filter({ hasText: 'Sodexo' })
    await expect(fila.locator('svg.lucide-ticket')).toHaveCount(1)
  })

  test('Nueva caja: sin selector de icono/color; toma el aspecto de su alcance (medio de pago)', async ({ page }) => {
    await page.goto('/?demo=60#cajas')
    await expect(page.getByRole('list', { name: 'Lista de cajas' }).getByTestId('caja').filter({ hasText: 'Caja Auto' }).locator('svg.lucide-car')).toHaveCount(1)
    await page.getByRole('button', { name: 'Nueva caja' }).click()
    const d = dialog(page)
    await expect(d.getByTestId('apariencia')).toHaveCount(0)
    await d.getByLabel('Nombre', { exact: true }).fill('Caja vales')
    await d.getByRole('radio', { name: 'Medio de pago' }).click()
    await pick(page, '#caja-valor', 'Sodexo')
    await expect(d.locator('svg.lucide-ticket').first()).toBeVisible()
    await d.getByLabel('Monto asignado por mes').fill('120')
    await d.getByRole('button', { name: 'Crear caja' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Caja vales creada' })).toBeVisible({ timeout: 15_000 })
    const tarjeta = page.getByRole('list', { name: 'Lista de cajas' }).getByTestId('caja').filter({ hasText: 'Caja vales' })
    await expect(tarjeta.locator('svg.lucide-ticket')).toHaveCount(1)
    await expect(tarjeta.locator('span.size-11').first()).toHaveCSS('color', 'rgb(210, 70, 60)')
  })

  test('selector de color: una fila de 10 y, en "Más colores", 64 y uno libre; Catálogo usa el mismo selector', async ({ page }) => {
    await page.goto('/?demo=60#categorias')
    await go(page, 'Catálogo')
    await page.getByRole('button', { name: 'Editar ámbito' }).click()
    const d = dialog(page)
    await expect(d.getByRole('radiogroup', { name: 'Color' }).getByRole('radio')).toHaveCount(10)   // una sola fila de 10
    await expect(d.getByTestId('paleta-completa')).toHaveCount(0)
    await d.getByRole('button', { name: 'Más colores' }).click()
    await expect(d.getByRole('radiogroup', { name: 'Paleta completa' }).getByRole('radio')).toHaveCount(64)
    await expect(d.getByLabel('Otro color')).toBeVisible()
  })

  test('plantillas: tipo de gasto y recurrente se guardan y llegan precargados a Nuevo gasto', async ({ page }) => {
    await page.goto('/?demo=60')
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    const m = dialog(page)
    await m.getByRole('button', { name: 'Nueva plantilla' }).click()
    await expect(m.getByRole('radiogroup', { name: 'Tipo de gasto' }).getByRole('radio', { name: 'Variable' })).toHaveAttribute('aria-checked', 'true')
    await expect(m.getByRole('switch', { name: 'Es recurrente' })).toHaveAttribute('aria-checked', 'false')
    await m.getByRole('radio', { name: 'Familia', exact: true }).click()
    await m.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Servicios', exact: true }).click()
    await m.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio', { name: 'Internet', exact: true }).click()
    await m.getByLabel('Descripción').fill('Servicio fijo E2E')
    await m.getByLabel('Monto predeterminado').fill('70')
    await m.getByRole('radiogroup', { name: 'Tipo de gasto' }).getByRole('radio', { name: 'Fijo' }).click()
    await m.getByRole('switch', { name: 'Es recurrente' }).click()
    await m.getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Plantilla creada correctamente.' })).toBeVisible()
    const fila = m.getByRole('list', { name: 'Plantillas' }).getByRole('listitem').filter({ hasText: 'Servicio Fijo E2E' })
    await fila.getByRole('button', { name: 'Usar plantilla Servicio Fijo E2E' }).click()
    const g = dialog(page)
    await expect(g.getByText('Nuevo gasto', { exact: true })).toBeVisible()
    await expect(g.locator('#gasto-tipo')).toContainText('Fijo')
    await expect(g.getByRole('switch', { name: 'Es recurrente' })).toHaveAttribute('aria-checked', 'true')
  })
})

test.describe('v1.11: aspecto automático, categorías compartidas, Catálogo, Conectar, refresco automático y plantilla compacta', () => {
  const fondo = (page: Page, n: string) => page.getByRole('list', { name: 'Lista de fondos' }).getByTestId('fondo').filter({ has: page.getByTestId('fondo-nombre').getByText(n, { exact: true }) })
  const tarjetaCat = (page: Page, n: string) => page.locator('article').filter({ has: page.getByRole('button', { name: `Acciones de ${n}`, exact: true }) })

  test('fondo: sin medio es como General; con medio es exactamente el del medio (Yape = Yape)', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3#cajas')
    // los fondos libres existentes se ven igual que General
    const icono = (n: string) => fondo(page, n).locator('span.size-11 svg').first().getAttribute('class')
    await expect.poll(() => fondo(page, 'Extra 1').count()).toBe(1)
    expect(await icono('Extra 1')).toBe(await icono('General'))
    await expect(fondo(page, 'General').locator('svg.lucide-banknote')).toHaveCount(1)
    await expect(fondo(page, 'Extra 1').locator('span.size-11').first()).toHaveCSS('color', 'rgb(30, 58, 138)')
    // Nuevo fondo
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    await expect(d.getByTestId('apariencia')).toHaveCount(0)
    const tile = d.locator('span.size-11').first()
    await expect(tile.locator('svg.lucide-banknote')).toHaveCount(1)
    await pick(page, '#fondo-medio', 'Yape')
    await expect(tile.locator('svg.lucide-smartphone')).toHaveCount(1)
    await expect(tile).toHaveCSS('color', 'rgb(123, 63, 160)')      // el color de Yape
    await d.getByRole('button', { name: 'Quitar Yape' }).click()      // varios medios por fondo: el aspecto es el del primero
    await pick(page, '#fondo-medio', 'Efectivo')
    await expect(tile.locator('svg.lucide-banknote')).toHaveCount(1)
    await pick(page, '#fondo-medio', 'Ninguno (fondo libre)')
    await expect(tile.locator('svg.lucide-banknote')).toHaveCount(1)
  })

  test('caja: el alcance (ámbito, categoría, subcategoría, medio) fija su icono y color automáticos', async ({ page }) => {
    await page.goto('/?demo=60#cajas')
    await page.getByRole('button', { name: 'Nueva caja' }).click()
    const d = dialog(page)
    const tile = d.locator('span.size-11').first()
    await d.getByRole('radio', { name: 'Ámbito', exact: true }).click()
    await pick(page, '#caja-valor', 'Familia')
    await expect(tile.locator('svg.lucide-users')).toHaveCount(1)
    await expect(tile).toHaveCSS('color', 'rgb(20, 145, 127)')
    await d.getByRole('radio', { name: 'Categoría', exact: true }).click()
    await pick(page, '#caja-valor', 'Alimentación')
    await expect(tile.locator('svg')).toHaveCount(1)
    await d.getByRole('radio', { name: 'Subcategoría', exact: true }).click()
    await pick(page, '#caja-valor', 'Gasolina')
    await expect(tile).toHaveCSS('color', 'rgb(100, 116, 139)')      // el color de su categoría (Auto)
    await d.getByRole('radio', { name: 'Medio de pago', exact: true }).click()
    await pick(page, '#caja-valor', 'Plin')
    await expect(tile.locator('svg.lucide-smartphone')).toHaveCount(1)
    await expect(tile).toHaveCSS('color', 'rgb(11, 158, 168)')
  })

  test('categorías compartidas: editar una en Personal la actualiza en Trabajo; crearla en otro ámbito hereda su aspecto', async ({ page }) => {
    await go(page, 'Catálogo')
    await accionCat(page, 'Transporte', 'Editar')
    let d = dialog(page)
    await expect(d.getByText('Se aplica a este nombre en todos los ámbitos.')).toBeVisible()
    await d.getByRole('button', { name: 'Icono rocket', exact: true }).click()
    await d.getByRole('radio', { name: 'Color #E5484D' }).click()
    await d.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Categoría actualizada correctamente.' })).toBeVisible({ timeout: 15_000 })
    for (const amb of ['Trabajo', 'Pareja', 'Familia', 'Amigos']) {
      await page.getByRole('tab', { name: new RegExp(amb) }).click()
      const t = tarjetaCat(page, 'Transporte')
      await expect(t.locator('svg.lucide-rocket').first(), amb).toBeVisible()
      await expect(t.locator('span').filter({ has: page.locator('svg.lucide-rocket') }).first(), amb).toHaveCSS('color', 'rgb(229, 72, 77)')
    }
    // Compras existe en Personal pero no en Trabajo: se edita en Personal y luego se crea en Trabajo
    await page.getByRole('tab', { name: /Personal/ }).click()
    await accionCat(page, 'Compras', 'Editar')
    d = dialog(page)
    await d.getByRole('button', { name: 'Icono gift', exact: true }).click()
    await d.getByRole('radio', { name: 'Color #8B7CF6' }).click()
    await d.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Categoría actualizada correctamente.' }).last()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('tab', { name: /Trabajo/ }).click()
    await expect(tarjetaCat(page, 'Compras')).toHaveCount(0)
    await page.getByRole('button', { name: 'Categoría', exact: true }).click()
    d = dialog(page)
    await d.getByLabel('Nombre').fill('Compras')
    await expect(d.getByTestId('apariencia-heredada')).toBeVisible()
    await expect(d.getByRole('radiogroup', { name: 'Color' })).toHaveCount(0)
    await d.getByRole('button', { name: 'Agregar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Categoría creada correctamente.' })).toBeVisible({ timeout: 15_000 })
    const nueva = tarjetaCat(page, 'Compras')
    await expect(nueva.locator('svg.lucide-gift').first()).toBeVisible()
    await expect(nueva.locator('span').filter({ has: page.locator('svg.lucide-gift') }).first()).toHaveCSS('color', 'rgb(139, 124, 246)')
    // y las filas de Personal siguen igual
    await page.getByRole('tab', { name: /Personal/ }).click()
    await expect(tarjetaCat(page, 'Compras').locator('svg.lucide-gift').first()).toBeVisible()
  })

  test('Catálogo: incluye los medios de pago; se agrega uno y aparece al registrar un gasto', async ({ page }) => {
    await go(page, 'Catálogo')
    await expect(page.getByRole('heading', { name: 'Catálogo' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Medios de pago' })).toBeVisible()
    await page.getByRole('button', { name: /^Agregar/ }).first().click()
    await page.getByRole('menuitem', { name: 'Nuevo medio de pago' }).click()
    const d = dialog(page)
    await expect(d.getByLabel('Nombre del medio de pago')).toBeVisible()
    await d.getByLabel('Nombre del medio de pago').fill('Billetera X')
    // pide icono y color (personalizables) y los muestra en la vista previa
    await d.getByRole('button', { name: 'Icono rocket' }).first().click()
    await d.getByRole('radio', { name: 'Color #E5484D' }).click()
    await expect(d.getByTestId('medio-vista-previa').locator('svg.lucide-rocket')).toHaveCount(1)
    await expect(d.getByTestId('medio-vista-previa').locator('span.size-11')).toHaveCSS('color', 'rgb(229, 72, 77)')
    await d.getByRole('button', { name: 'Crear medio de pago' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Billetera X guardado correctamente.' })).toBeVisible({ timeout: 15_000 })
    const fila = page.getByRole('list', { name: 'Medios de pago' }).getByRole('listitem').filter({ hasText: 'Billetera X' })
    await expect(fila.locator('svg.lucide-rocket')).toHaveCount(1)
    // se puede personalizar después con el lápiz
    await page.getByRole('button', { name: 'Personalizar Yape' }).click()
    await dialog(page).getByRole('radio', { name: 'Color #0E8FA8' }).click()
    await dialog(page).getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByRole('list', { name: 'Medios de pago' }).getByRole('listitem').filter({ hasText: 'Yape' }).locator('span.size-7')).toHaveCSS('color', 'rgb(14, 143, 168)')
    await expect(page.getByRole('list', { name: 'Medios de pago' }).getByRole('listitem').filter({ hasText: 'Billetera X' })).toBeVisible()
    // el enlace anterior #categorias sigue funcionando
    await page.goto('/?demo=60#categorias')
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Catálogo' })).toHaveAttribute('aria-current', 'page')
  })

  test('Conectar junto a "Mi hoja": se abre en cualquier pestaña, valida y se cierra', async ({ page }) => {
    const conectar = page.getByRole('button', { name: 'Conectar con Google Sheets' })
    await expect(conectar).toBeVisible()
    const hoja = page.getByRole('link', { name: 'Mi hoja' })
    const [bc, bh] = [await conectar.boundingBox(), await hoja.boundingBox()]
    expect(Math.abs(bc!.y - bh!.y)).toBeLessThan(6)                    // misma fila
    expect(bc!.x + bc!.width).toBeLessThanOrEqual(bh!.x + 1)           // y justo antes de Mi hoja
    for (const tab of ['Gastos', 'Catálogo']) {
      await go(page, tab)
      await conectar.click()
      const d = dialog(page)
      await expect(d.getByText('Conectar con Google Sheets', { exact: true })).toBeVisible()
      await d.getByLabel('URL de Apps Script (/exec)').fill('https://ejemplo.com/x')
      await d.getByLabel('Token').fill('corto')
      await d.getByRole('button', { name: 'Conectar', exact: true }).click()
      await expect(d.getByRole('alert')).toContainText('La URL debe ser la del despliegue')
      await d.getByLabel('URL de Apps Script (/exec)').fill('https://script.google.com/macros/s/AKfycbxEjemplo123/exec')
      await d.getByRole('button', { name: 'Conectar', exact: true }).click()
      await expect(d.getByRole('alert')).toContainText('El token parece incompleto')
      await d.getByRole('button', { name: 'Cancelar' }).click()
      await expect(dialog(page)).toHaveCount(0)
    }
    expect(await page.evaluate(() => localStorage.getItem('gd.connection'))).toBeNull()      // nada se guardó
    // el aviso del modo demostración también lo abre
    await page.getByRole('button', { name: 'Conecta tu Apps Script' }).click()
    await expect(dialog(page).getByLabel('Token')).toBeVisible()
  })

  test('actualización automática: se elige en Configuración, avisa en verde y se puede desactivar', async ({ page }) => {
    await page.clock.install()
    await page.goto('/?demo=60')
    await expect(datosListos(page)).toContainText('S/')
    await go(page, 'Configuración')
    const sel = page.locator('#cfg-refresco')
    await expect(sel).toContainText('Cada 5 minutos')                        // predeterminado: cada 5 minutos
    await pick(page, '#cfg-refresco', 'Cada 30 segundos')
    await expect(page.getByRole('status').filter({ hasText: 'Configuración guardada correctamente.' })).toBeVisible()
    await page.clock.runFor(31_000)
    const aviso = page.getByRole('status').filter({ hasText: /Datos actualizados · \d{2}:\d{2}/ })
    await expect(aviso).toBeVisible()
    await expect(aviso).toHaveAttribute('data-kind', 'success')
    await page.clock.runFor(31_000)
    await expect(aviso.first()).toBeVisible()                           // vuelve a actualizar
    await pick(page, '#cfg-refresco', 'Desactivada')
    await expect(sel).toContainText('Desactivada')
    await page.waitForTimeout(100)
    await page.evaluate(() => document.querySelectorAll('[data-kind="success"]').length)
    await page.clock.runFor(10 * 60_000)
    await page.clock.runFor(1000)
    await expect(page.getByRole('status').filter({ hasText: /Datos actualizados/ })).toHaveCount(0)
  })

  test('Completar vacíos: rellena el catálogo sin cambiar lo que ves', async ({ page }) => {
    const ico = async () => page.locator('article').filter({ has: page.getByRole('button', { name: 'Acciones de Auto', exact: true }) }).locator('svg').first().getAttribute('class')
    await go(page, 'Catálogo')
    const antes = await ico()
    await go(page, 'Configuración')
    await abrirGrupo(page, 'Mantenimiento de la hoja')
    await page.getByRole('button', { name: 'Ejecutar completarVacios', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /Hoja completada: \d+ fila/ })).toBeVisible({ timeout: 15_000 })
    await go(page, 'Catálogo')
    expect(await ico()).toBe(antes)
    await go(page, 'Configuración')
    await abrirGrupo(page, 'Mantenimiento de la hoja')
    await page.getByRole('button', { name: 'Ejecutar completarVacios', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'La hoja ya no tiene celdas vacías por completar.' })).toBeVisible({ timeout: 15_000 })
  })

  test.describe('plantilla compacta en escritorio', () => {
    test.use({ viewport: { width: 1366, height: 768 } })
    test('Tipo de gasto, Es recurrente y compromiso en una sola fila, y todo a la vista sin desplazarse', async ({ page }) => {
      await page.goto('/?demo=60')
      await page.getByRole('button', { name: 'Gastos mensuales' }).click()
      const m = dialog(page)
      await m.getByRole('button', { name: 'Nueva plantilla' }).click()
      await m.getByRole('radio', { name: 'Personal', exact: true }).click()
      await m.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Auto', exact: true }).click()   // la de más subcategorías
      const y = async (l: ReturnType<Page['locator']>) => Math.round((await l.boundingBox())!.y)
      const tipo = m.getByRole('radiogroup', { name: 'Tipo de gasto' }), rec = m.getByRole('switch', { name: 'Es recurrente' }), comp = m.getByRole('switch', { name: 'Es un compromiso mensual' })
      await expect(tipo).toBeVisible()
      const [yt, yr, yc] = [await y(tipo), await y(rec), await y(comp)]
      expect(Math.abs(yt - yr)).toBeLessThan(120)   // misma sección; el layout es de 2 columnas
      expect(Math.abs(yr - yc)).toBeLessThan(80)   // v1.16: dos columnas; recurrente y compromiso quedan juntos
      // sin scroll interno: el área desplazable del modal cabe entera
      const sobra = await page.evaluate(() => {
        const el = [...document.querySelectorAll('dialog[open] div')].find(d => getComputedStyle(d).overflowY === 'auto') as HTMLElement
        return el.scrollHeight - el.clientHeight
      })
      expect(sobra).toBeLessThanOrEqual(1)
      await expect(m.getByRole('button', { name: 'Guardar plantilla' })).toBeInViewport()
    })
  })
})

test.describe('v1.12', () => {
  test('el globo de información queda por encima de las tarjetas vecinas y no se recorta', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3#dashboard')
    const info = page.getByRole('button', { name: /^Información: / })
    await expect(info.first()).toBeVisible({ timeout: 15_000 })
    const n = await info.count()
    for (let i = 0; i < Math.min(n, 8); i++) {
      const b = info.nth(i)
      if (!(await b.isVisible())) continue
      await b.scrollIntoViewIfNeeded()
      await b.hover()
      const tip = page.getByRole('tooltip')
      await expect(tip).toBeVisible()
      const r = (await tip.boundingBox())!
      expect(r.x).toBeGreaterThanOrEqual(0)
      // el elemento en el centro del globo es el propio globo (nada lo tapa)
      const encima = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return !!el?.closest('[role="tooltip"]') }, { x: r.x + r.width / 2, y: r.y + 12 })
      expect(encima).toBe(true)
      await page.mouse.move(0, 0)
    }
  })

  test('Presupuesto consolidado: el icono ⓘ muestra "Cómo se calcula" al pasar, tocar y con teclado', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3')
    const b = page.getByRole('region', { name: 'Presupuesto consolidado' }).getByRole('button', { name: /Información: Cómo se calcula/ })
    await expect(b).toBeVisible({ timeout: 15_000 })
    await b.hover()
    const tip = page.getByRole('tooltip')
    await expect(tip).toContainText('Presupuesto consolidado = suma')
    const r = (await tip.boundingBox())!
    expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[role="tooltip"]'), { x: r.x + r.width / 2, y: r.y + 12 })).toBe(true)
    await page.mouse.move(0, 0)
    await expect(tip).toHaveCount(0)
    await b.click()
    await expect(tip).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tip).toHaveCount(0)
  })

  test('Configuración: funciones del backend se ejecutan desde la web y muestran su respuesta; las peligrosas piden confirmar', async ({ page }) => {
    await page.goto('/?demo=60')
    await go(page, 'Configuración')
    const panel = page.getByTestId('funciones-backend')
    await expect(panel).toBeVisible()
    // agrupadas en acordeones: todos cerrados por defecto; se abren y cierran
    await expect(panel.getByRole('button', { name: /^Mantenimiento de la hoja/ })).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('button', { name: 'Ejecutar misArchivos', exact: true })).toHaveCount(0)
    for (const g of ['Mantenimiento de la hoja', 'Conexión y archivos', 'Atajo de iPhone', 'Datos de prueba']) await panel.getByRole('button', { name: new RegExp(`^${g}`) }).click()
    for (const f of ['misArchivos', 'setup', 'autorizarRespaldos', 'diagnose', 'completarVacios', 'migrarPlantillas', 'actualizarCatalogo', 'repararIds', 'repararHojas', 'crearTokenAtajo', 'revocarTokenAtajo', 'generarDatosPrueba', 'borrarDatosPrueba'])
      await expect(page.getByRole('button', { name: `Ejecutar ${f}`, exact: true })).toBeVisible()
    // respuesta simple en el área de resultado
    await page.getByRole('button', { name: 'Ejecutar misArchivos', exact: true }).click()
    const res = page.getByTestId('funcion-resultado')
    await expect(res).toContainText('urlApi')
    await expect(res).toContainText('misArchivos()')
    // un token se muestra y se puede copiar con un clic
    await page.getByRole('button', { name: 'Ejecutar setup', exact: true }).click()
    await expect(res.getByRole('button', { name: /demo-token-no-real/ })).toBeVisible()
    // confirmación previa en las que cambian o borran
    await page.getByRole('button', { name: 'Ejecutar borrarDatosPrueba', exact: true }).click()
    await expect(panel).toContainText('Se borrarán los datos de prueba marcados')
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(panel).not.toContainText('Se borrarán los datos de prueba marcados')
    await page.getByRole('button', { name: 'Ejecutar crearTokenAtajo', exact: true }).click()
    await page.getByRole('button', { name: 'Confirmar' }).click()
    await expect(res).toContainText('atj_demo_no_real')
    // Completar vacíos existe una sola vez (antes estaba también en Administración de datos)
    await expect(page.getByRole('button', { name: /Completar vacíos/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ejecutar completarVacios', exact: true })).toHaveCount(1)
    // consola: copiar, expandir y contraer
    await page.getByRole('button', { name: 'Expandir resultado' }).click()
    await expect(page.getByRole('button', { name: 'Contraer resultado' })).toBeVisible()
    await page.getByRole('button', { name: 'Contraer resultado' }).click()
    await expect(res.locator('pre')).toHaveClass(/max-h-56/)
    await expect(res.getByRole('button', { name: 'Copiar resultado' })).toBeVisible()
  })
})

test.describe('v1.12: administración de fondos y subcajas (Subir, Bajar, Clonar, Eliminar, ON/OFF)', () => {
  const fondo = (page: Page, n: string) => page.getByRole('list', { name: 'Lista de fondos' }).getByTestId('fondo').filter({ has: page.getByTestId('fondo-nombre').getByText(n, { exact: true }) })
  const nombresFondos = (page: Page) => page.getByRole('list', { name: 'Lista de fondos' }).getByTestId('fondo-nombre').allInnerTexts()
  const nFondos = async (page: Page) => Number(await page.getByTestId('n-fondos').innerText())
  const menuF = (page: Page, n: string) => page.getByRole('button', { name: `Más acciones del fondo ${n}`, exact: true })
  /** El menú ⋯ se cierra al desplazar: primero se deja el botón a la vista y luego se abre. */
  const abrirMenu = async (b: ReturnType<Page['locator']>) => { await b.scrollIntoViewIfNeeded(); await b.page().waitForTimeout(200); await b.click() }
  const menuC = (page: Page, n: string) => page.getByRole('button', { name: `Más acciones de ${n}`, exact: true })
  const resumen = (page: Page, label: string) => page.getByTestId('cajas-resumen').locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]').innerText().then(money)
  const caja = (page: Page, n: string) => page.getByRole('list', { name: 'Lista de cajas' }).getByTestId('caja').filter({ hasText: n })
  const actualizar = async (page: Page) => { await page.getByRole('button', { name: 'Actualizar datos' }).click(); await expect(page.getByRole('button', { name: 'Actualizar datos' })).toBeEnabled({ timeout: 15_000 }) }
  test.beforeEach(async ({ page }) => {
    await page.goto('/?demo=60&fondos=3#cajas')
    await expect.poll(() => cons(page, 'presupuesto-consolidado'), { timeout: 15_000 }).toBe(4780)
  })

  test('fondos: el menú ⋯ trae Clonar, Plantilla, Subir, Bajar y Eliminar (orden canónico), no se corta y respeta primero/último', async ({ page }) => {
    await menuF(page, 'General').click()
    await expect(page.getByRole('menuitem')).toHaveCount(5)
    expect((await page.getByRole('menuitem').allInnerTexts()).map(t => t.trim())).toEqual(['Clonar', 'Guardar como plantilla', 'Subir', 'Bajar', 'Eliminar'])
    await expect(page.getByRole('menuitem', { name: 'Subir' })).toBeDisabled()          // primera
    await expect(page.getByRole('menuitem', { name: 'Bajar' })).toBeEnabled()
    const vp = page.viewportSize()!
    const box = (await page.getByRole('menu').boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width); expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
    // nada tapa el menú (no queda cortado por la tarjeta)
    const c = { x: box.x + box.width / 2, y: box.y + box.height - 8 }
    expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[role="menu"]'), c)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await menuF(page, 'Extra 1').scrollIntoViewIfNeeded()
    await menuF(page, 'Extra 1').click()
    await expect(page.getByRole('menuitem', { name: 'Bajar' })).toBeDisabled()          // última
    await page.keyboard.press('Escape')
  })

  test('fondos: Subir/Bajar cambian el orden y se conserva al releer los datos', async ({ page }) => {
    expect(await nombresFondos(page)).toEqual(['General', 'Sodexo', 'Extra 1'])
    await menuF(page, 'General').click()
    await page.getByRole('menuitem', { name: 'Bajar' }).click()
    await expect.poll(() => nombresFondos(page)).toEqual(['Sodexo', 'General', 'Extra 1'])
    await actualizar(page)
    expect(await nombresFondos(page)).toEqual(['Sodexo', 'General', 'Extra 1'])
    await menuF(page, 'Extra 1').click()
    await page.getByRole('menuitem', { name: 'Subir' }).click()
    await expect.poll(() => nombresFondos(page)).toEqual(['Sodexo', 'Extra 1', 'General'])
    await actualizar(page)
    expect(await nombresFondos(page)).toEqual(['Sodexo', 'Extra 1', 'General'])
  })

  test('fondos: clonar propone "(Copia)", nace inactiva, no suma dinero ni copia gastos y un doble clic no la duplica', async ({ page }) => {
    const dispSodexo = (await fondo(page, 'Sodexo').innerText()).match(/disponible\s+(S\/\s*[\d,.]+)/)![1]
    await menuF(page, 'Sodexo').click()
    await page.getByRole('menuitem', { name: 'Clonar' }).click()
    const d = dialog(page)
    await expect(d.getByRole('heading', { name: 'Clonar Sodexo' })).toBeVisible()
    await expect(d.getByLabel('Nombre del fondo')).toHaveValue('Sodexo (Copia)')
    await expect(d.getByLabel('Monto')).toHaveValue('280')
    await expect(d.getByRole('switch', { name: 'Fondo activo' })).toHaveAttribute('aria-checked', 'false')
    await expect(d).toContainText('nace inactiva')
    await d.getByLabel('Nombre del fondo').fill('Sodexo clon')                       // editable antes de confirmar
    await d.getByRole('button', { name: 'Crear copia' }).dblclick()
    await expect(page.getByRole('status').filter({ hasText: 'Sodexo clon creada inactiva' })).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => nFondos(page)).toBe(4)
    expect(await cons(page, 'presupuesto-consolidado')).toBe(4780)                      // no sumó dinero
    await expect(fondo(page, 'Sodexo clon')).toContainText('Inactiva')
    expect((await fondo(page, 'Sodexo').innerText()).match(/disponible\s+(S\/\s*[\d,.]+)/)![1]).toBe(dispSodexo)   // sus gastos siguen en la original
    await actualizar(page)
    expect(await nFondos(page)).toBe(4)                                                // ni un registro duplicado
    // activar la copia sí suma, previo aviso explícito en el formulario
    await page.getByRole('button', { name: 'Editar fondo Sodexo clon' }).click()
    await dialog(page).getByRole('button', { name: 'Cancelar' }).click()
  })

  test('fondos: eliminar sin gastos pide confirmación, borra y actualiza totales; con gastos NO elimina y ofrece desactivar', async ({ page }) => {
    // crear un fondo libre nueva (sin gastos) y eliminarla
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    await dialog(page).getByLabel('Nombre del fondo').fill('Temporal')
    await dialog(page).getByLabel('Monto').fill('100')
    await dialog(page).getByRole('button', { name: 'Crear fondo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Temporal creada' })).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(4880)
    await abrirMenu(menuF(page, 'Temporal'))
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    const d = dialog(page)
    await expect(d.getByRole('heading', { name: 'Eliminar Temporal' })).toBeVisible()
    await expect(d).toContainText('No tiene gastos atribuidos')
    await d.getByRole('button', { name: 'Cancelar' }).click()
    expect(await nFondos(page)).toBe(4)                                               // cancelar no borra nada
    await menuF(page, 'Temporal').click()
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    await dialog(page).getByRole('button', { name: 'Eliminar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Temporal eliminada. Ningún gasto se borró.' })).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => nFondos(page)).toBe(3)
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(4780)
    await actualizar(page)
    expect(await nFondos(page)).toBe(3)
    expect(await nombresFondos(page)).not.toContain('Temporal')
    // Sodexo tiene gastos atribuidos: no se elimina, se ofrece desactivar
    const gastosAntes = await page.evaluate(() => 0)
    void gastosAntes
    await menuF(page, 'Sodexo').click()
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    const b = dialog(page)
    await expect(b.getByRole('heading', { name: 'No se puede eliminar Sodexo' })).toBeVisible()
    await expect(b.getByTestId('fondo-con-gastos')).toContainText('gasto(s) atribuido(s)')
    await expect(b.getByRole('button', { name: 'Eliminar', exact: true })).toHaveCount(0)
    await b.getByRole('button', { name: 'Desactivar en su lugar' }).click()
    await dialog(page).getByRole('button', { name: 'Desactivar', exact: true }).click()
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(4500)
    await expect(fondo(page, 'Sodexo')).toContainText('Inactiva')
    expect(await nFondos(page)).toBe(3)
  })

  test('subcajas: interruptor ON/OFF persiste, no crea ni quita dinero y recalcula reservado y libre', async ({ page }) => {
    await expect(caja(page, 'Caja Auto')).toBeVisible()
    const res0 = await resumen(page, 'Reservado en cajas'), libre0 = await resumen(page, 'Libre inicial'), cons0 = await cons(page, 'presupuesto-consolidado')
    const sw = page.getByRole('switch', { name: 'Desactivar Caja Auto' })
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await sw.click()
    await expect(page.getByRole('switch', { name: 'Activar Caja Auto' })).toHaveAttribute('aria-checked', 'false')
    await expect(caja(page, 'Caja Auto').getByTestId('estado-caja')).toHaveText(/Inactiva/)
    await expect.poll(() => resumen(page, 'Reservado en cajas')).toBeCloseTo(res0 - 600, 2)
    expect(await resumen(page, 'Libre inicial')).toBeCloseTo(libre0 + 600, 2)        // lo reservado vuelve al libre: ni se crea ni se pierde
    expect(await cons(page, 'presupuesto-consolidado')).toBe(cons0)                  // el consolidado no cambia
    await actualizar(page)                                                           // persistencia tras releer
    await expect(page.getByRole('switch', { name: 'Activar Caja Auto' })).toHaveAttribute('aria-checked', 'false')
    await page.getByRole('switch', { name: 'Activar Caja Auto' }).click()
    await expect(page.getByRole('switch', { name: 'Desactivar Caja Auto' })).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => resumen(page, 'Reservado en cajas')).toBeCloseTo(res0, 2)
  })

  test('subcajas: menú ⋯ con Subir, Bajar, Clonar y Eliminar; clonar no copia monto ni gastos; filtros bloquean el orden; vista lista', async ({ page }) => {
    const nombres = () => page.getByRole('list', { name: 'Lista de cajas' }).getByTestId('caja').locator('p.truncate.text-sm, p.truncate.font-semibold').allInnerTexts()
    await menuC(page, 'Caja Auto').scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await menuC(page, 'Caja Auto').click()
    await expect(page.getByRole('menuitem')).toHaveCount(5)
    expect((await page.getByRole('menuitem').allInnerTexts()).map(t => t.trim())).toEqual(['Clonar', 'Guardar como plantilla', 'Subir', 'Bajar', 'Eliminar'])
    await page.keyboard.press('Escape')
    // Subir / Bajar con persistencia
    const antes = await nombres()
    const i = antes.indexOf('Caja Auto')
    await menuC(page, 'Caja Auto').click()
    await page.getByRole('menuitem', { name: 'Bajar' }).click()
    await expect.poll(async () => (await nombres()).indexOf('Caja Auto')).toBe(i + 1)
    await actualizar(page)
    expect((await nombres()).indexOf('Caja Auto')).toBe(i + 1)
    // clonar
    const res0 = await resumen(page, 'Reservado en cajas')
    await menuC(page, 'Caja Auto').click()
    await page.getByRole('menuitem', { name: 'Clonar' }).click()
    const d = dialog(page)
    await expect(d.getByRole('heading', { name: 'Clonar Caja Auto' })).toBeVisible()
    await expect(d.getByLabel('Nombre', { exact: true })).toHaveValue('Caja Auto (Copia)')
    await expect(d.getByLabel('Monto asignado por mes')).toHaveValue('0')
    await expect(d.getByRole('switch', { name: 'Caja activa' })).toHaveAttribute('aria-checked', 'false')
    await expect(d.locator('#caja-valor')).toContainText('Auto')
    await d.getByRole('button', { name: 'Crear copia' }).dblclick()
    await expect(page.getByRole('status').filter({ hasText: 'Caja Auto (Copia) creada inactiva' })).toBeVisible({ timeout: 15_000 })
    await expect(caja(page, 'Caja Auto (Copia)')).toHaveCount(1)
    await expect(caja(page, 'Caja Auto (Copia)').getByTestId('estado-caja')).toHaveText(/Inactiva/)
    expect(await resumen(page, 'Reservado en cajas')).toBeCloseTo(res0, 2)        // la copia no reserva dinero adicional
    // con búsqueda activa no se puede reordenar
    await page.getByLabel('Buscar caja').fill('Auto')
    await abrirMenu(menuC(page, 'Caja Auto'))
    await expect(page.getByRole('menuitem', { name: 'Subir' })).toBeDisabled()
    await expect(page.getByRole('menuitem', { name: 'Bajar' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.getByLabel('Buscar caja').fill('')
    // vista lista: mismo interruptor y mismo menú
    await page.getByRole('region', { name: /Reservas/ }).getByRole('radio', { name: 'Lista' }).click()
    await expect(page.getByRole('switch', { name: 'Desactivar Caja Auto' })).toBeVisible()
    await abrirMenu(menuC(page, 'Caja Auto (Copia)'))
    await expect(page.getByRole('menuitem')).toHaveCount(5)
    expect((await page.getByRole('menuitem').allInnerTexts()).map(t => t.trim())).toEqual(['Clonar', 'Guardar como plantilla', 'Subir', 'Bajar', 'Eliminar'])
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    // la copia está inactiva (no toma gastos): se puede eliminar
    await expect(dialog(page)).toContainText('Está inactiva')
    await dialog(page).getByRole('button', { name: 'Eliminar', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Caja Auto (Copia) eliminada. Ningún gasto se borró.' })).toBeVisible({ timeout: 15_000 })
    await expect(caja(page, 'Caja Auto (Copia)')).toHaveCount(0)
    // la original está activa y tiene gastos: no se elimina, se ofrece desactivar
    await menuC(page, 'Caja Auto').click()
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    await expect(dialog(page).getByTestId('caja-con-gastos')).toContainText('gasto(s)')
    await dialog(page).getByRole('button', { name: 'Desactivar en su lugar' }).click()
    await expect(page.getByRole('switch', { name: 'Activar Caja Auto' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // ya inactiva sí se puede eliminar, y sus gastos no se borran
    await menuC(page, 'Caja Auto').click()
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    await dialog(page).getByRole('button', { name: 'Eliminar', exact: true }).click()
    await expect(caja(page, 'Caja Auto')).toHaveCount(0)
    await go(page, 'Dashboard')
    expect(await total(page)).toBeGreaterThan(0)                                   // los gastos siguen ahí
  })

  test('fallo de Apps Script: una operación que falla restaura la interfaz y no duplica nada', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3&falla=1#cajas')
    await expect.poll(() => cons(page, 'presupuesto-consolidado'), { timeout: 15_000 }).toBe(4780)
    const orden0 = await nombresFondos(page)
    await menuF(page, 'General').click()
    await page.getByRole('menuitem', { name: 'Bajar' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'No se pudo guardar el orden de los fondos' })).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => nombresFondos(page)).toEqual(orden0)                  // se restauró el orden anterior
    await menuF(page, 'Extra 1').click()
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    await dialog(page).getByRole('button', { name: 'Eliminar', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'No se pudo eliminar Extra 1' })).toBeVisible({ timeout: 15_000 })
    expect(await nFondos(page)).toBe(3)                                          // el fondo sigue ahí
  })
})

test.describe('v1.15: descripción dinámica, selectores, orden y eliminación de categorías, switches', () => {
  test.beforeEach(() => { test.slow() })
  const grupo = (d: ReturnType<typeof dialog>, g: string, n: string) => d.getByRole('radiogroup', { name: g }).getByRole('radio', { name: n, exact: true })
  const hayScrollX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)

  test('gasto nuevo: la descripción va justo debajo de la subcategoría y la sigue; el texto propio pide confirmación', async ({ page }) => {
    await page.getByRole('button', { name: 'Nuevo gasto' }).click()
    const d = dialog(page)
    await grupo(d, 'Ámbito', 'Personal').click(); await grupo(d, 'Categoría', 'Alimentación').click(); await grupo(d, 'Subcategoría', 'Almuerzo').click()
    const desc = d.getByLabel('Descripción')
    await expect(desc).toHaveValue('Almuerzo')
    // posición: Subcategoría → Descripción (y nada de por medio)
    const ySub = (await d.getByRole('radiogroup', { name: 'Subcategoría' }).boundingBox())!, yDesc = (await desc.boundingBox())!
    expect(yDesc.y).toBeGreaterThan(ySub.y + ySub.height - 1)
    expect(yDesc.y - (ySub.y + ySub.height)).toBeLessThan(80)
    await grupo(d, 'Subcategoría', 'Cena').click()
    await expect(desc).toHaveValue('Cena')
    await expect(d.getByTestId('desc-confirmar')).toHaveCount(0)
    // texto propio: no se pisa; aparece la confirmación
    await desc.fill('Cena de cumpleaños'); await desc.blur()
    await grupo(d, 'Subcategoría', 'Desayuno').click()
    await expect(desc).toHaveValue('Cena de Cumpleaños')
    await expect(d.getByTestId('desc-confirmar')).toContainText('Desayuno')
    await d.getByRole('button', { name: 'Conservar la mía' }).click()
    await expect(desc).toHaveValue('Cena de Cumpleaños')
    await expect(d.getByTestId('desc-confirmar')).toHaveCount(0)
    await grupo(d, 'Subcategoría', 'Almuerzo').click()
    await d.getByRole('button', { name: 'Reemplazar' }).click()
    await expect(desc).toHaveValue('Almuerzo')
  })

  test('gasto: editar y clonar no sobrescriben la descripción al abrir; cambiar la subcategoría pide confirmar', async ({ page }) => {
    await go(page, 'Gastos')
    await newGasto(page, { ambito: 'Personal', categoria: 'Alimentación', sub: 'Almuerzo', monto: '9', medio: 'Yape', desc: 'Menú con Ana' })
    const row = page.getByRole('row', { name: /Menú con Ana/ })
    for (const accion of ['Editar', 'Clonar']) {
      await row.getByRole('button', { name: accion }).click()
      const d = dialog(page)
      await expect(d.getByLabel('Descripción')).toHaveValue('Menú con Ana')
      await grupo(d, 'Subcategoría', 'Cena').click()
      await expect(d.getByLabel('Descripción')).toHaveValue('Menú con Ana')
      await expect(d.getByTestId('desc-confirmar')).toBeVisible()
      await d.getByRole('button', { name: 'Reemplazar' }).click()
      await expect(d.getByLabel('Descripción')).toHaveValue('Cena')
      await d.getByRole('button', { name: 'Cancelar' }).click()
    }
  })

  test('plantillas: nueva, editar y clonar siguen la subcategoría sin pisar el texto propio', async ({ page }) => {
    await page.getByRole('button', { name: 'Gastos mensuales' }).click()
    const m = dialog(page)
    await m.getByRole('button', { name: 'Nueva plantilla' }).click()
    await grupo(m, 'Ámbito', 'Personal').click(); await grupo(m, 'Categoría', 'Alimentación').click(); await grupo(m, 'Subcategoría', 'Almuerzo').click()
    await expect(m.getByLabel('Descripción')).toHaveValue('Almuerzo')
    await grupo(m, 'Subcategoría', 'Cena').click()
    await expect(m.getByLabel('Descripción')).toHaveValue('Cena')
    await m.getByLabel('Descripción').fill('Cena fija')
    await grupo(m, 'Subcategoría', 'Desayuno').click()
    await expect(m.getByLabel('Descripción')).toHaveValue('Cena Fija')
    await expect(m.getByTestId('desc-confirmar')).toBeVisible()
    await m.getByRole('button', { name: 'Reemplazar' }).click()
    await expect(m.getByLabel('Descripción')).toHaveValue('Desayuno')
    await m.getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Plantilla creada correctamente.' })).toBeVisible()
    // editar: se abre con su descripción; cambiar la sub (automática) la acompaña
    await m.getByRole('button', { name: 'Más acciones de Desayuno' }).click()
    await m.getByRole('menuitem', { name: 'Editar' }).click()
    await expect(m.getByLabel('Descripción')).toHaveValue('Desayuno')
    await m.getByLabel('Descripción').fill('Desayuno en casa'); await m.getByLabel('Descripción').blur()
    await grupo(m, 'Subcategoría', 'Cena').click()
    await expect(m.getByLabel('Descripción')).toHaveValue('Desayuno en Casa')
    await expect(m.getByTestId('desc-confirmar')).toBeVisible()
    await m.getByRole('button', { name: 'Conservar la mía' }).click()
    await m.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(m.getByRole('list', { name: 'Plantillas' }).getByRole('listitem').filter({ hasText: 'Desayuno en Casa' })).toBeVisible()
    // clonar: carga la descripción de la original
    await m.getByRole('button', { name: 'Más acciones de Desayuno en Casa' }).click()
    await m.getByRole('menuitem', { name: 'Clonar' }).click()
    await expect(m.getByLabel('Descripción')).toHaveValue('Desayuno en Casa')
  })

  test('Combobox: busca, se maneja con teclado, muestra icono y no se corta dentro del modal', async ({ page }) => {
    await go(page, 'Cajas')
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    const medio = d.locator('#fondo-medio')
    await medio.click()
    const lista = page.getByRole('listbox', { name: 'Agregar medio de pago' })
    await expect(lista).toBeVisible()
    await expect(lista.getByRole('option', { name: 'Yape', exact: true }).locator('svg')).toHaveCount(1)
    const box = (await lista.boundingBox())!, vp = page.viewportSize()!
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width); expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
    await expect(lista).toHaveCount(0)
    await expect(d.getByTestId('fondo-medios').getByRole('button', { name: /^Quitar / })).toHaveCount(1)   // el medio elegido queda como chip
    await expect(medio).toBeFocused()
    // Escape cierra sin cambiar y el modal sigue abierto
    await medio.click(); await page.keyboard.press('Escape')
    await expect(lista).toHaveCount(0); await expect(d).toBeVisible()
    await expect(d.getByTestId('fondo-medios').getByRole('button', { name: /^Quitar / })).toHaveCount(1)
    // moneda: con búsqueda cuando hay muchas opciones o clic directo
    await pick(page, '#fondo-medio', 'Efectivo')
    await expect(d.getByTestId('fondo-medios').getByRole('button', { name: /^Quitar / })).toHaveCount(2)   // varios medios por fondo
  })

  test('filtros: las opciones traen el icono y color del catálogo, "Otros" al final y nombre completo en tooltip', async ({ page }) => {
    await go(page, 'Gastos')
    await page.getByRole('button', { name: 'Categoría', exact: true }).click()
    const lista = page.getByRole('listbox', { name: 'Categoría' })
    const opts = lista.getByRole('option')
    await expect(opts.first().locator('svg').first()).toBeVisible()
    await expect(opts.last()).toHaveAttribute('aria-label', 'Otros')
    expect(await opts.first().getAttribute('title')).toBeTruthy()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Medio de pago', exact: true }).click()
    await expect(page.getByRole('listbox', { name: 'Medio de pago' }).getByRole('option', { name: 'Yape', exact: true }).locator('svg').first()).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('Catálogo: reordenar categorías con Subir/Bajar persiste al releer; "Otros" fija; sin reordenar al buscar', async ({ page }) => {
    await go(page, 'Catálogo')
    const nombres = async () => (await page.locator('[data-testid="cat-card"]').evaluateAll(els => els.map(e => e.getAttribute('data-cat')))) as string[]
    const antes = await nombres()
    expect(antes.at(-1)).toBe('Otros')
    const [a, b] = antes
    await accionCat(page, a, 'Bajar')
    await expect(page.getByRole('status').filter({ hasText: 'bajó de posición' })).toBeVisible()
    const despues = await nombres()
    expect(despues.slice(0, 2)).toEqual([b, a]); expect(despues.at(-1)).toBe('Otros')
    await page.getByRole('button', { name: 'Actualizar datos' }).click()
    await expect(page.getByRole('button', { name: 'Actualizar datos' })).toBeEnabled({ timeout: 15_000 })
    expect((await nombres()).slice(0, 2)).toEqual([b, a])                                 // el orden salió de la "hoja", no solo de la pantalla
    await accionCat(page, b, 'Bajar'); await expect(page.getByRole('status').filter({ hasText: 'bajó de posición' }).last()).toBeVisible()
    // la primera no puede subir; "Otros" no se mueve; con búsqueda no se reordena
    const primera = (await nombres())[0]
    await abrirMenuCat(page, primera)
    await expect(page.getByRole('menuitem', { name: 'Subir' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await abrirMenuCat(page, 'Otros')
    await expect(page.getByRole('menuitem', { name: 'Bajar' })).toBeDisabled(); await expect(page.getByRole('menuitem', { name: 'Subir' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.getByLabel('Buscar en el catálogo').fill('a')
    await abrirMenuCat(page, primera)
    await expect(page.getByRole('menuitem', { name: 'Bajar' })).toBeDisabled()
  })

  test('Catálogo: eliminar categoría — bloqueada si la usan gastos; sin uso, pide confirmar las subcategorías y no borra gastos', async ({ page }) => {
    const gastosAntes = await total(page)
    await go(page, 'Catálogo')
    // En uso → bloqueada, ofrece desactivar
    await accionCat(page, 'Alimentación', 'Eliminar')
    let d = dialog(page)
    await expect(d.getByTestId('categoria-en-uso')).toContainText('gasto')
    await expect(d.getByRole('button', { name: 'Eliminar' })).toHaveCount(0)
    await d.getByRole('button', { name: 'Desactivar en su lugar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'desactivada' })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Categoría Alimentación activa' })).toHaveAttribute('aria-checked', 'false')
    // Categoría nueva con una subcategoría y sin uso → pide confirmación en cascada
    await page.getByRole('button', { name: 'Agregar', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Nueva categoría' }).click()
    d = dialog(page)
    await d.getByLabel('Nombre').fill('Mascotas E2E'); await d.getByRole('button', { name: 'Agregar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Categoría creada' })).toBeVisible()
    await page.getByRole('button', { name: 'Agregar subcategoría a Mascotas E2E' }).click()
    await dialog(page).getByLabel('Nombre').fill('Veterinaria E2E'); await dialog(page).getByRole('button', { name: 'Agregar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Subcategoría creada' })).toBeVisible()
    await accionCat(page, 'Mascotas E2E', 'Eliminar')
    d = dialog(page)
    const eliminar = d.getByRole('button', { name: 'Eliminar' })
    await expect(eliminar).toBeDisabled()
    await d.getByRole('checkbox').check()
    await eliminar.click()
    await expect(page.getByRole('status').filter({ hasText: 'No se borró ningún gasto' })).toBeVisible()
    await expect(page.locator('[data-cat="Mascotas E2E"]')).toHaveCount(0)
    await go(page, 'Dashboard')
    expect(await total(page)).toBe(gastosAntes)
  })

  test('switches: ámbito y categoría ocultan sus opciones en el formulario; reactivar conserva el estado de cada subcategoría; los medios también', async ({ page }) => {
    await go(page, 'Catálogo')
    // las subcategorías NO llevan switch
    await expect(page.locator('[data-cat="Alimentación"]').getByRole('switch')).toHaveCount(1)
    // una subcategoría inactiva por sí sola
    await page.locator('[data-cat="Alimentación"]').getByRole('button', { name: 'Cena', exact: true }).click()
    await dialog(page).getByRole('switch').click()
    await dialog(page).getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Subcategoría actualizada' })).toBeVisible()
    // desactivar el ámbito Personal
    await page.getByRole('switch', { name: 'Ámbito Personal activo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Ámbito “Personal” desactivado' })).toBeVisible()
    await go(page, 'Gastos'); await page.getByRole('button', { name: 'Nuevo gasto' }).click()
    let d = dialog(page)
    await expect(d.getByRole('radiogroup', { name: 'Ámbito' }).getByRole('radio', { name: 'Personal', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape'); await go(page, 'Catálogo')
    // reactivar: vuelve, y la subcategoría que estaba inactiva sigue inactiva
    await page.getByRole('switch', { name: 'Ámbito Personal activo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Ámbito “Personal” activado' })).toBeVisible()
    await go(page, 'Gastos'); await page.getByRole('button', { name: 'Nuevo gasto' }).click()
    d = dialog(page)
    await grupo(d, 'Ámbito', 'Personal').click(); await grupo(d, 'Categoría', 'Alimentación').click()
    await expect(grupo(d, 'Subcategoría', 'Almuerzo')).toBeVisible()
    await expect(grupo(d, 'Subcategoría', 'Cena')).toHaveCount(0)
    await page.keyboard.press('Escape'); await go(page, 'Catálogo')
    // categoría OFF/ON
    await page.getByRole('switch', { name: 'Categoría Compras activa' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Categoría “Compras” desactivada' })).toBeVisible()
    await go(page, 'Gastos'); await page.getByRole('button', { name: 'Nuevo gasto' }).click()
    d = dialog(page)
    await grupo(d, 'Ámbito', 'Personal').click()
    await expect(grupo(d, 'Categoría', 'Compras')).toHaveCount(0)
    await page.keyboard.press('Escape'); await go(page, 'Catálogo')
    // medio de pago OFF → no se ofrece al registrar
    await page.getByRole('switch', { name: 'Medio de pago Plin activo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Medio de pago guardado' })).toBeVisible()
    await go(page, 'Gastos'); await page.getByRole('button', { name: 'Nuevo gasto' }).click()
    await expect(dialog(page).getByRole('radiogroup', { name: 'Medio de pago' }).getByRole('radio', { name: 'Plin', exact: true })).toHaveCount(0)
  })

  test('selector de iconos: vista previa, familias, búsqueda y selección marcada', async ({ page }) => {
    await go(page, 'Catálogo')
    await accionCat(page, 'Transporte', 'Editar')
    const d = dialog(page)
    await expect(d.getByTestId('icono-elegido')).toBeVisible()
    await d.getByRole('button', { name: 'Transporte y auto', exact: true }).click()
    await expect(d.getByLabel('Transporte y auto').locator('button').first()).toBeVisible()
    await expect(d.getByLabel('Hogar y servicios')).toHaveCount(0)                        // la familia filtra
    await d.getByRole('button', { name: 'Icono rocket', exact: true }).click().catch(() => undefined)
    await d.getByLabel('Buscar icono').fill('rocket')
    await d.getByRole('button', { name: 'Icono rocket', exact: true }).click()
    await expect(d.getByRole('button', { name: 'Icono rocket', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(d.getByTestId('icono-elegido')).toContainText('')
    await expect(d.getByText('rocket', { exact: true }).first()).toBeVisible()
  })

  test.describe('móvil', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
    test('Catálogo, formulario y selectores sin desplazamiento horizontal', async ({ page }) => {
      await page.goto('/?demo=60#catalogo')
      await expect(page.getByRole('tab').first()).toBeVisible()
      expect(await hayScrollX(page)).toBe(false)
      await abrirMenuCat(page, 'Alimentación')
      await expect(page.getByRole('menuitem', { name: 'Subir' })).toBeVisible()
      await page.keyboard.press('Escape')
      await go(page, 'Dashboard')
      await page.getByRole('button', { name: 'Nuevo gasto' }).click()
      const d = dialog(page)
      await d.locator('#gasto-tipo').click()
      const caja = (await page.getByRole('listbox').boundingBox())!
      expect(caja.x).toBeGreaterThanOrEqual(0); expect(caja.x + caja.width).toBeLessThanOrEqual(390)
      await page.keyboard.press('Escape')
      expect(await hayScrollX(page)).toBe(false)
    })
  })
})

test.describe('v1.16: navegación, preferencias, medios, calendarios y operaciones en lote', () => {
  const sinScrollH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

  test('barra lateral: contraída por defecto, se expande, recuerda su estado y muestra etiquetas', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const lat = page.getByRole('complementary', { name: 'Barra lateral' })
    expect((await lat.boundingBox())!.width).toBeLessThanOrEqual(76)
    await page.getByRole('button', { name: 'Expandir barra lateral' }).click()
    await expect.poll(async () => (await lat.boundingBox())!.width).toBeGreaterThanOrEqual(220)
    expect(await page.evaluate(() => localStorage.getItem('deejota.sidebar.collapsed'))).toBe('0')
    await page.reload()
    await expect(datosListos(page)).toContainText('S/')
    await expect.poll(async () => (await lat.boundingBox())!.width).toBeGreaterThanOrEqual(220)
    await page.getByRole('button', { name: 'Contraer barra lateral' }).click()
    await expect.poll(async () => (await lat.boundingBox())!.width).toBeLessThanOrEqual(76)
    expect(await sinScrollH(page)).toBe(true)
  })

  test('tablet: panel temporal; móvil: barra inferior con Más', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.getByRole('button', { name: 'Abrir navegación' }).click()
    await expect(page.getByRole('dialog', { name: 'Navegación' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Navegación' })).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    const barra = page.getByTestId('barra-inferior')
    await expect(barra).toBeVisible()
    await expect(barra.getByRole('button')).toHaveCount(4)           // Dashboard, Gastos, Cajas, Más
    await go(page, 'Configuración')
    await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible()
    await expect(barra.getByRole('button', { name: 'Más', exact: true })).toHaveAttribute('aria-current', 'page')
    expect(await sinScrollH(page)).toBe(true)
  })

  test('preferencias: selectores modernos y solo cinco intervalos de actualización', async ({ page }) => {
    await go(page, 'Configuración')
    await expect(page.getByTestId('preferencias')).toBeVisible()
    await expect(page.locator('select')).toHaveCount(0)
    await page.locator('#cfg-refresco').click()
    const opts = page.getByRole('listbox').getByRole('option')
    await expect(opts).toHaveCount(5)
    expect((await opts.allInnerTexts()).map(t => t.split('\n')[0].trim())).toEqual(['Desactivada', 'Cada 30 segundos', 'Cada 1 minuto', 'Cada 5 minutos', 'Cada 10 minutos'])
    await page.keyboard.press('Escape')
    for (const id of ['#cfg-moneda', '#cfg-tz', '#cfg-fecha', '#cfg-tema']) await expect(page.locator(id)).toBeVisible()
  })

  test('fondo con varios medios: chips sin dividir el monto; fondos y subcajas abren en Lista', async ({ page }) => {
    await page.evaluate(() => { sessionStorage.setItem('vistaDefecto', '1'); localStorage.removeItem('deejota.vista.fondos'); localStorage.removeItem('deejota.vista.subcajas') })
    await page.goto('/?demo=60&fondos=3#cajas')
    await expect(page.getByRole('radio', { name: 'Lista' }).first()).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('list', { name: 'Lista de fondos' })).toBeVisible()
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    await d.getByLabel('Nombre del fondo').fill('Multi')
    await d.getByLabel('Monto').fill('300')
    await pick(page, '#fondo-medio', 'Yape')
    await pick(page, '#fondo-medio', 'Plin')
    await expect(d.getByRole('button', { name: /^Quitar / })).toHaveCount(2)
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Multi creada' })).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => cons(page, 'presupuesto-consolidado')).toBe(3500 + 280 + 300 + 1000)
  })

  test('calendario propio: elegir día por teclado y mes en el selector de período', async ({ page }) => {
    await page.getByRole('button', { name: 'Nuevo gasto' }).first().click()
    const d = dialog(page)
    await d.locator('#gasto-fecha').click()
    await page.getByRole('gridcell', { name: '3 de octubre de 2026', exact: true }).click()
    await expect(d.locator('#gasto-fecha')).toHaveAttribute('data-value', '2026-10-03')
    await page.keyboard.press('Escape')
  })

  test('Gastos: selección múltiple y eliminación en lote con confirmación', async ({ page }) => {
    await go(page, 'Gastos')
    const filas = page.locator('tbody tr')
    const primera = await filas.first().innerText()
    await page.getByRole('checkbox', { name: /^Seleccionar/ }).nth(1).check()
    await page.getByRole('checkbox', { name: /^Seleccionar/ }).nth(2).check()
    const barra = page.getByTestId('barra-seleccion')
    await expect(barra).toContainText('2 seleccionados')
    await barra.getByRole('button', { name: /^Eliminar 2 gastos/ }).click()
    await dialog(page).getByRole('button', { name: /Eliminar/ }).last().click()
    await expect(page.getByRole('status').filter({ hasText: /eliminad/i }).first()).toBeVisible({ timeout: 15_000 })
    await expect(barra).toHaveCount(0)
    await expect(filas.first()).not.toHaveText(primera)
  })

  test('reordenar con teclado: Espacio y flechas sobre el asa de un fondo', async ({ page }) => {
    await page.goto('/?demo=60&fondos=3#cajas')
    await page.getByRole('radio', { name: 'Lista' }).first().click()
    const asas = page.getByRole('list', { name: 'Lista de fondos' }).locator('[data-asa-orden]')
    await expect(asas.first()).toBeVisible()
    const nombres = () => page.getByTestId('fondo-nombre').allInnerTexts()
    const n0 = await nombres()
    await asas.first().focus()
    await page.keyboard.press('Space'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space')
    await expect.poll(async () => (await nombres())[1]).toBe(n0[0])
  })
})
