import { expect, test, type Page } from '@playwright/test'

// v1.19 — Planificación mensual, recordatorios, aislamiento por período y normalización de descripciones.
// Modo demostración; el reloj se fija en noviembre de 2026 (mes de corte del aislamiento).
async function go(page: Page, tab: string) {
  const nav = page.getByRole('navigation', { name: 'Secciones' }).filter({ visible: true }).first()
  const b = nav.getByRole('button', { name: tab, exact: true })
  if (await b.count()) { await b.click(); return }
  const menu = page.getByRole('button', { name: 'Abrir navegación' })
  if (await menu.count()) { await menu.click(); await page.getByRole('dialog', { name: 'Navegación' }).getByRole('button', { name: tab, exact: true }).click(); return }
  await nav.getByRole('button', { name: 'Más', exact: true }).click()
  await page.getByRole('dialog', { name: 'Más opciones' }).getByRole('button', { name: new RegExp(`^${tab}`) }).click()
}
const OCT = '2026-10-20T10:00:00-05:00'
const dialog = (page: Page) => page.getByRole('dialog').filter({ visible: true }).last()
const sinScrollH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
/** Acciones de escritura de gastos hechas desde que se abrió la app (el demo las cuenta). */
const escriturasGastos = (page: Page) => page.evaluate(() => Object.entries((globalThis as unknown as { __gdDemoCalls?: Record<string, number> }).__gdDemoCalls ?? {}).filter(([k]) => /gasto|batch/i.test(k) && !/^(data|plantillas)$/.test(k)).reduce((s, [, v]) => s + v, 0))
const fuentesAplicadas = async (page: Page) => Number(await page.getByTestId('n-fuentes').innerText())

async function abrir(page: Page, hoy = '2026-11-05T10:00:00-05:00', ruta = '/?demo=60&fuentes=3&cajas=3#cajas') {
  await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
  await page.clock.setFixedTime(new Date(hoy))
  await page.goto(ruta)
  await expect(page.getByRole('heading', { name: /Fuentes de dinero/ })).toBeVisible()
}

test.describe('v1.19 aislamiento por mes', () => {
  test('noviembre arranca sin fuentes ni subcajas; diciembre y enero también; octubre conserva lo suyo', async ({ page }) => {
    await abrir(page, OCT)
    await expect(page.getByTestId('vacio-mes-fuente')).toHaveCount(0)             // octubre (anterior al corte): comportamiento histórico
    await expect(page.getByRole('list', { name: 'Lista de fuentes' })).toBeVisible()
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
    await expect(page.getByTestId('vacio-mes-fuente')).toContainText('No tienes fuentes configuradas para noviembre')
    await expect(page.getByTestId('vacio-mes-subcaja')).toContainText('No tienes subcajas configuradas para noviembre')
    await expect(page.getByTestId('n-fuentes')).toHaveText(/\d+/)
    // Dashboard: mensajes guiados, sin porcentajes engañosos.
    await go(page, 'Dashboard')
    const av = page.getByTestId('aviso-mes-sin-config')
    await expect(av).toContainText('Todavía no has configurado fuentes de dinero para este mes.')
    await expect(av).toContainText('Todavía no has reservado presupuesto para este mes.')
    await expect(av.getByRole('button', { name: 'Preparar fuentes mensuales' })).toBeVisible()
    await expect(av.getByRole('button', { name: 'Preparar subcajas mensuales' })).toBeVisible()
    await expect(page.getByText(/NaN|Infinity/)).toHaveCount(0)
    // Diciembre y enero (cambio de año) también empiezan vacíos.
    await go(page, 'Cajas')
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
    await expect(page.getByRole('heading', { name: /Fuentes de dinero/ })).toBeVisible()
    await expect(page.getByTestId('vacio-mes-fuente')).toContainText('No tienes fuentes configuradas para diciembre')
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
    await expect(page.getByTestId('vacio-mes-fuente')).toContainText('No tienes fuentes configuradas para enero')
  })

  test('copiar del mes anterior: vista previa editable, sin duplicar y sin tocar octubre', async ({ page }) => {
    await abrir(page, OCT)
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
    await page.getByTestId('vacio-mes-fuente').getByRole('button', { name: 'Copiar configuración del mes anterior' }).click()
    const d = dialog(page)
    await expect(d).toContainText('Usar fuentes del mes anterior')
    const montos = d.getByRole('textbox', { name: /^Monto de / })
    const n = await montos.count()
    expect(n).toBeGreaterThan(0)
    await montos.first().fill('1234.5')
    await d.getByRole('button', { name: /^Aplicar \d+ a noviembre/i }).click()
    await expect(d).toHaveCount(0)
    await expect(page.getByTestId('vacio-mes-fuente')).toHaveCount(0)
    await expect(page.getByTestId('n-fuentes')).toHaveText(String(n))
    // Repetir: no queda nada por copiar (no se duplica ni se sobrescribe).
    // Octubre sigue igual.
    await page.getByRole('button', { name: 'Mes anterior' }).first().click()
    await expect(page.getByTestId('vacio-mes-fuente')).toHaveCount(0)
  })

  test('nueva subcaja se aplica al mes seleccionado con "Mes de aplicación" visible', async ({ page }) => {
    await abrir(page, OCT)
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
    await page.getByRole('button', { name: 'Nueva subcaja' }).click()
    const d = dialog(page)
    await expect(d.getByText('Mes de aplicación')).toBeVisible()
    await expect(d.locator('#caja-mes')).toContainText(/noviembre/i)
    await d.getByLabel('Nombre', { exact: true }).fill('Viajes')
    await d.getByLabel('Monto asignado por mes').fill('250')
    await d.getByRole('combobox', { name: /Valor/ }).click()
    await page.getByRole('listbox').getByRole('option').first().click()
    await d.getByRole('button', { name: 'Crear caja' }).click()
    await expect(d).toHaveCount(0)
    await expect(page.getByTestId('vacio-mes-subcaja')).toHaveCount(0)
    await expect(page.getByText('Viajes').first()).toBeVisible()
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
    await expect(page.getByTestId('vacio-mes-subcaja')).toBeVisible()      // diciembre no la hereda
  })
})

test.describe('v1.19 asistente y campana', () => {
  test('campana con aviso: preparar ahora → fuentes (mes anterior) → omitir subcajas → gastos → resumen → aplicar; no registra gastos', async ({ page }) => {
    await abrir(page)
    const antesF = await fuentesAplicadas(page)
    await expect(page.getByTestId('campana-badge')).toHaveText('1')
    await page.getByTestId('campana-plan').click()
    const panel = page.getByTestId('panel-plan')
    await expect(panel).toContainText('Prepara Noviembre 2026')
    await panel.getByRole('button', { name: 'Preparar ahora' }).click()
    const w = page.getByTestId('asistente-plan')
    await expect(w).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Prepara tu mes · Noviembre 2026')).toBeVisible()
    const dlg = page.getByRole('dialog').filter({ visible: true }).last()
    await dlg.getByRole('button', { name: 'Usar mes anterior' }).click()
    await dlg.getByRole('button', { name: 'Siguiente', exact: true }).click()
    await dlg.getByRole('button', { name: 'Omitir', exact: true }).click()
    await expect(w.getByRole('checkbox', { name: /Ya revisé/ })).toBeVisible()
    await w.getByRole('checkbox', { name: /Ya revisé/ }).click()
    await expect(w.getByRole('checkbox', { name: /Ya revisé/ })).toBeChecked()
    await dlg.getByRole('button', { name: 'Revisar resumen' }).click()
    await expect(page.getByTestId('plan-resumen-final')).toContainText('Omitida')
    await expect(page.getByTestId('plan-resumen-final')).toContainText('Completada')
    await page.getByRole('button', { name: 'Finalizar planificación' }).click()
    // v1.20.3: finalizar guarda en segundo plano y NO cierra ni redirige: el asistente queda en el Resumen como «Finalizada».
    await expect(page.getByTestId('etapa-resumen')).toHaveAttribute('data-estado', 'completada')
    await page.getByTestId('cerrar-plan').click()
    await expect(page.getByTestId('asistente-plan')).toHaveCount(0)
    await expect(page.getByTestId('campana-badge')).toHaveCount(0)
    expect(await fuentesAplicadas(page)).toBeGreaterThan(antesF)             // las fuentes del mes anterior quedaron aplicadas
    await expect(page.getByTestId('vacio-mes-subcaja')).toBeVisible()           // las subcajas se omitieron
    expect(await escriturasGastos(page)).toBe(0)                                // avanzar el asistente nunca registra gastos
  })

  test('cancelar el asistente no escribe nada; Recordar después y Descartar actualizan el aviso', async ({ page }) => {
    await abrir(page)
    const antesF = await fuentesAplicadas(page)
    await page.getByTestId('campana-plan').click()
    await page.getByTestId('panel-plan').getByRole('button', { name: 'Preparar ahora' }).click()
    await page.getByRole('dialog').filter({ visible: true }).last().getByRole('button', { name: 'Usar mes anterior' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('asistente-plan')).toHaveCount(0)
    expect(await fuentesAplicadas(page)).toBe(antesF)                           // nada aplicado
    expect((await page.evaluate(() => (globalThis as unknown as { __gdDemoCalls?: Record<string, number> }).__gdDemoCalls?.aplicarEntidadesMes ?? 0))).toBe(0)
    await page.getByTestId('campana-plan').click()
    await page.getByTestId('panel-plan').getByRole('button', { name: 'Recordar después' }).click()
    await expect(page.getByTestId('campana-badge')).toHaveCount(0)
    await expect(page.getByTestId('plan-al-dia')).toBeVisible()                 // el panel sigue abierto y ahora dice "todo al día"
  })

  test('descartar el aviso del mes lo quita y no vuelve a aparecer', async ({ page }) => {
    await abrir(page)
    await page.getByTestId('campana-plan').click()
    await page.getByTestId('panel-plan').getByRole('button', { name: 'Descartar aviso del mes' }).click()
    await expect(page.getByTestId('campana-badge')).toHaveCount(0)
    await go(page, 'Dashboard'); await go(page, 'Cajas')
    await expect(page.getByTestId('campana-badge')).toHaveCount(0)
  })

  test('la campana va antes de Actualizar y los avisos no aparecen antes de su fecha', async ({ page }) => {
    await abrir(page, '2026-10-20T10:00:00-05:00')
    await expect(page.getByTestId('campana-badge')).toHaveCount(0)             // octubre es anterior al corte
    const orden = await page.evaluate(() => { const b = document.querySelector('[data-testid="campana-plan"]')!, r = document.querySelector('[aria-label="Actualizar datos"]')!; return !!(b.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) })
    expect(orden).toBe(true)
  })

  test('falla el backend al aplicar: error visible, la planificación no queda marcada como aplicada', async ({ page }) => {
    await abrir(page, '2026-11-05T10:00:00-05:00', '/?demo=60&fuentes=3&cajas=3&falla=1#cajas')
    await page.getByTestId('campana-plan').click()
    await page.getByTestId('panel-plan').getByRole('button', { name: 'Preparar ahora' }).click()
    const antesF = await fuentesAplicadas(page)
    const dlg = page.getByRole('dialog').filter({ visible: true }).last()
    await dlg.getByRole('button', { name: 'Usar mes anterior' }).click()
    await dlg.getByTestId('aplicar-fuentes').click()
    await expect(page.getByTestId('error-fuentes')).toBeVisible()
    await expect(page.getByTestId('etapa-fuentes-estado')).toHaveText('Error')
    expect(await fuentesAplicadas(page)).toBe(antesF)
    await expect(page.getByTestId('campana-badge')).toHaveText('1')              // el aviso sigue pendiente
  })
})

test.describe('v1.19 recordatorios en Configuración', () => {
  test('día por mes, validación de bisiestos, mismo día a todos y próximas fechas', async ({ page }) => {
    await abrir(page)
    await go(page, 'Configuración')
    const sec = page.getByTestId('recordatorios-plan')
    await expect(sec).toBeVisible()
    await expect(page.getByTestId('resumen-plan')).toContainText('Noviembre 2026')
    // 2027 no es bisiesto: 29 de febrero se rechaza; 2028 sí lo permite.
    await sec.getByRole('button', { name: 'Año siguiente' }).click()
    await sec.getByLabel('Día de Febrero 2027').fill('29')
    await expect(sec).toContainText('Febrero 2027 solo tiene 28 días.')
    await expect(sec.getByTestId('guardar-recordatorios')).toBeDisabled()
    await sec.getByRole('button', { name: 'Año siguiente' }).click()
    await sec.getByLabel('Día de Febrero 2028').fill('29')
    await expect(sec).not.toContainText('solo tiene')
    await sec.getByTestId('guardar-recordatorios').click()
    // 2026: poner el día 3 en noviembre y desactivar diciembre; la próxima fecha lo refleja.
    await sec.getByRole('button', { name: 'Año anterior' }).click(); await sec.getByRole('button', { name: 'Año anterior' }).click()
    await expect(sec.getByTestId('plan-anio')).toHaveText('2026')
    await sec.getByLabel('Día de Noviembre 2026').fill('3')
    await sec.getByRole('switch', { name: 'Recordatorio de Diciembre 2026' }).click()
    await sec.getByTestId('guardar-recordatorios').click()
    await expect(sec.getByTestId('proximas-fechas')).not.toContainText('Diciembre 2026')
    // Aplicar el mismo día a todos.
    await sec.getByLabel('Día predeterminado').fill('10')
    await sec.getByRole('button', { name: /Aplicar el día 10 a todos/ }).click()
    await expect(sec.getByLabel('Día de Marzo 2026')).toHaveValue('10')
    await expect(sec.getByLabel('Día de Febrero 2026')).toHaveValue('10')
    // Apagar los recordatorios quita el badge.
    await sec.getByRole('switch', { name: 'Recordatorios activos' }).click()
    await expect(page.getByTestId('campana-badge')).toHaveCount(0)
  })
})

test.describe('v1.19 descripciones normalizadas', () => {
  test('la descripción de una subcaja se normaliza al salir del campo y al guardar', async ({ page }) => {
    await abrir(page)
    await page.getByRole('button', { name: 'Nueva subcaja' }).click()
    const d = dialog(page)
    const desc = d.getByLabel('Descripción (opcional)')
    await desc.fill('GASTOS DE LA CASA para el mes con chatgpt')
    await desc.blur()
    await expect(desc).toHaveValue('Gastos de la Casa para el Mes con ChatGPT')
    await desc.fill('papa a la huancaina')
    await desc.blur()
    await expect(desc).toHaveValue('papa a la Huancaina')
  })
})

for (const [w, h] of [[375, 700], [390, 844], [430, 932], [768, 1024], [1366, 768], [1920, 1080]] as const) {
  test(`responsive ${w}px: campana, panel, asistente y recordatorios sin desbordes`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await abrir(page)
    await expect(page.getByTestId('campana-plan')).toBeVisible()
    await page.getByTestId('campana-plan').click()
    const panel = page.getByTestId('panel-plan')
    await expect(panel).toBeVisible()
    const caja = await panel.boundingBox()
    expect(caja!.x).toBeGreaterThanOrEqual(0); expect(caja!.x + caja!.width).toBeLessThanOrEqual(w + 1)
    expect(await sinScrollH(page)).toBe(true)
    await panel.getByRole('button', { name: 'Preparar ahora' }).click()
    await expect(page.getByTestId('asistente-plan')).toBeVisible()
    expect(await sinScrollH(page)).toBe(true)
    await page.keyboard.press('Escape')
    await go(page, 'Configuración')
    await expect(page.getByTestId('recordatorios-plan')).toBeVisible()
    expect(await sinScrollH(page)).toBe(true)
  })
}

test('tema oscuro: la campana y el panel usan colores de tokens (legibles)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await abrir(page)
  await go(page, 'Configuración')
  await page.locator('#cfg-tema').click()
  await page.getByRole('listbox').getByRole('option', { name: /Oscuro/ }).click()
  await page.waitForTimeout(500)
  await page.getByTestId('campana-plan').click()
  const panel = page.getByTestId('panel-plan')
  const bg = await panel.evaluate(e => getComputedStyle(e).backgroundColor)
  expect(bg).not.toBe('rgb(255, 255, 255)')
})

test.describe('v1.19 plantillas de subcajas: aplicar una y aplicar todas (regresión "ID de caja supera 40 caracteres")', () => {
  async function crearPlantilla(page: Page, nombre: string, monto: string, opcion: number) {
    const d = dialog(page)
    await d.getByRole('button', { name: /Nueva plantilla/ }).click()
    await page.getByRole('menuitem', { name: 'Crear desde cero' }).click()
    await dialog(page).locator('#pf-nombre').fill(nombre)
    await dialog(page).locator('#pf-monto').fill(monto)
    await dialog(page).locator('#pf-valor').click()
    await page.getByRole('listbox').getByRole('option').nth(opcion).click()
    await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(page.getByTestId('pf-fila').filter({ hasText: nombre })).toHaveCount(1)
  }
  const errores = (page: Page) => page.getByText(/ID de caja supera|No se pudo confirmar/)

  test('aplicar una sola plantilla y luego todas: sin error, sin duplicar', async ({ page }) => {
    await abrir(page, OCT, '/?demo=60&fuentes=3#cajas')
    await page.getByRole('button', { name: 'Subcajas mensuales' }).first().click()
    await crearPlantilla(page, 'Mascotas', '300', 0)
    await crearPlantilla(page, 'Viajes', '150', 1)
    await crearPlantilla(page, 'Regalos', '90', 5)
    // 1) botón "Aplicar" de una fila
    await page.getByTestId('pf-fila').filter({ hasText: 'Mascotas' }).getByRole('button', { name: /^Aplicar/ }).first().click()
    const vp = page.getByTestId('pf-vista-previa')
    if (await vp.count()) await page.getByRole('button', { name: 'Confirmar y aplicar' }).click()
    await expect(page.getByTestId('pf-fila').filter({ hasText: 'Mascotas' }).getByTestId('pf-estado')).toHaveText('Aplicada')
    // 2) seleccionar todas y aplicar (las pendientes)
    await dialog(page).getByRole('button', { name: /Seleccionar todas/ }).click()
    await dialog(page).getByRole('button', { name: /^Aplicar \d+ a / }).click()
    await page.getByRole('button', { name: 'Confirmar y aplicar' }).click()
    for (const n of ['Mascotas', 'Viajes', 'Regalos']) await expect(page.getByTestId('pf-fila').filter({ hasText: n }).getByTestId('pf-estado')).toHaveText('Aplicada')
    await expect(errores(page)).toHaveCount(0)
    // 3) volver a aplicar todas: idempotente
    await dialog(page).getByRole('button', { name: /Seleccionar todas|Quitar selección/ }).first().click()
    await expect(errores(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('region', { name: 'Reservas y subcajas' }).getByText('Mascotas').first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Reservas y subcajas' }).getByText('Viajes').first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Reservas y subcajas' }).getByText('Regalos').first()).toBeVisible()
    await expect(errores(page)).toHaveCount(0)
  })

  test('con el backend caído el error es visible, con Reintentar, y no queda nada aplicado', async ({ page }) => {
    await abrir(page, OCT, '/?demo=60&fuentes=3&falla=1#cajas')
    await page.getByRole('button', { name: 'Subcajas mensuales' }).first().click()
    await dialog(page).getByRole('button', { name: /Nueva plantilla/ }).click()
    await page.getByRole('menuitem', { name: 'Crear desde cero' }).click()
    await dialog(page).locator('#pf-nombre').fill('Mascotas')
    await dialog(page).locator('#pf-monto').fill('300')
    await dialog(page).locator('#pf-valor').click()
    await page.getByRole('listbox').getByRole('option').nth(0).click()
    await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(page.getByText(/No se pudo/).first()).toBeVisible()          // error visible, no éxito falso
    await expect(page.getByText('Plantilla Mascotas guardada.')).toHaveCount(0)
  })
})
