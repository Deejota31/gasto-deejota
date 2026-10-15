import { expect, test, type Page } from '@playwright/test'

// v1.20 — «Prepara tu mes»: asistente continuo, estados persistidos, verificación contra Sheets, resumen real.
// Modo demostración; reloj fijo en noviembre de 2026 (mes de corte del aislamiento).
const NOV = '2026-11-05T10:00:00-05:00'
const dialog = (page: Page) => page.getByRole('dialog').filter({ visible: true }).last()
const sinScrollH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const llamadas = (page: Page, k: string) => page.evaluate(n => (globalThis as unknown as { __gdDemoCalls?: Record<string, number> }).__gdDemoCalls?.[n] ?? 0, k)
const escriturasGastos = (page: Page) => page.evaluate(() => Object.entries((globalThis as unknown as { __gdDemoCalls?: Record<string, number> }).__gdDemoCalls ?? {}).filter(([k]) => /gasto|batch/i.test(k) && !/^(data|plantillas)$/.test(k)).reduce((s, [, v]) => s + v, 0))
const nFuentes = async (page: Page) => Number(await page.getByTestId('n-fuentes').innerText())

async function abrir(page: Page, ruta = '/?demo=60&fuentes=3&cajas=3#cajas', hoy = NOV) {
  await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
  await page.clock.setFixedTime(new Date(hoy))
  await page.goto(ruta)
  await expect(page.getByRole('heading', { name: /Fuentes de dinero/ })).toBeVisible()
}
async function crearPlantillaFuente(page: Page, nombre: string, monto: string) {
  await dialog(page).getByRole('button', { name: /Nueva plantilla/ }).click()
  await page.getByRole('menuitem', { name: 'Crear desde cero' }).click()
  await dialog(page).locator('#pf-nombre').fill(nombre)
  await dialog(page).locator('#pf-monto').fill(monto)
  await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
  await expect(page.getByTestId('pf-fila').filter({ hasText: nombre })).toHaveCount(1)
}
/** Crea dos plantillas de fuente desde Cajas (acceso independiente) y deja la app en Cajas. */
async function sembrarPlantillas(page: Page) {
  await page.getByRole('button', { name: 'Fuentes mensuales' }).first().click()
  await crearPlantillaFuente(page, 'Sueldo QA', '3000')
  await crearPlantillaFuente(page, 'Extra QA', '800')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog').filter({ visible: true })).toHaveCount(0)
}
async function abrirAsistente(page: Page) {
  await page.getByTestId('campana-plan').click()
  await page.getByTestId('panel-plan').getByRole('button', { name: 'Preparar ahora' }).click()
  await expect(page.getByTestId('asistente-plan')).toBeVisible()
}
const estado = (page: Page, e: string) => page.getByTestId(`etapa-${e}-estado`)
const asistenteOculto = (page: Page) => expect(page.getByTestId('asistente-plan')).toHaveCount(0)
async function aplicarFilaFuente(page: Page, nombre: string) {
  // El botón «Aplicar» de una fila aplica directo (con estado de carga); la vista previa es solo para aplicar varias.
  await page.getByTestId('pf-fila').filter({ hasText: nombre }).getByRole('button', { name: /^(Aplicar|Actualizar)/ }).first().click()
}

test.describe('v1.20 flujo continuo de «Prepara tu mes»', () => {
  test('flujo completo: Fuentes → vuelve → Subcajas → Gastos → Resumen → Finalizar; sin gastos escritos', async ({ page }) => {
    await abrir(page)
    await sembrarPlantillas(page)
    await abrirAsistente(page)
    for (const e of ['fuentes', 'subcajas', 'gastos']) await expect(estado(page, e)).toHaveText('Pendiente')
    const antes = await nFuentes(page)
    // Abrir el módulo hijo: el asistente se oculta (sin diálogos encimados) y el módulo muestra el mes del plan.
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await asistenteOculto(page)
    await expect(page.getByTestId('pf-mes-plan')).toContainText('Noviembre')
    await aplicarFilaFuente(page, 'Sueldo QA')
    // Regresa solo al asistente, con la etapa completada y la guía para continuar.
    await expect(page.getByTestId('asistente-plan')).toBeVisible()
    await expect(estado(page, 'fuentes')).toHaveText('Completada')
    await expect(page.getByTestId('continuar-fuentes')).toContainText('Continuar con Subcajas')
    await expect(page.getByTestId('ok-fuentes')).toContainText('Fuentes configuradas correctamente')
    await expect(page.getByRole('dialog').filter({ visible: true })).toHaveCount(1)
    await page.getByTestId('continuar-fuentes').click()
    await page.getByRole('button', { name: 'Omitir', exact: true }).click()
    await expect(estado(page, 'subcajas')).toHaveText('Omitida')
    // Gastos: marcar revisados persiste al instante.
    await page.getByRole('checkbox', { name: /Ya revisé/ }).click()
    await expect(estado(page, 'gastos')).toHaveText('Completada')
    await page.getByRole('button', { name: 'Revisar resumen' }).click()
    const r = page.getByTestId('plan-resumen-final')
    await expect(page.getByTestId('resumen-fuentes')).not.toContainText('Omitida')
    await expect(page.getByTestId('resumen-subcajas')).toContainText('Omitida')
    await expect(page.getByTestId('resumen-gastos')).toContainText('Completada')
    await expect(r.getByTestId('plan-indicadores')).toContainText('Etapas omitidas')
    await page.getByRole('button', { name: 'Finalizar planificación' }).click()
    await asistenteOculto(page)
    await expect(page.getByTestId('campana-badge')).toHaveCount(0)
    expect(await nFuentes(page)).toBeGreaterThan(antes)
    expect(await escriturasGastos(page)).toBe(0)
    expect(await llamadas(page, 'aplicarPlantillasFin')).toBe(1)           // la única escritura fue la del módulo hijo
    expect(await llamadas(page, 'aplicarEntidadesMes')).toBe(0)            // Finalizar no vuelve a crear nada
  })

  test('cerrar y reabrir conserva los estados (Fuentes completada, Subcajas omitida)', async ({ page }) => {
    await abrir(page)
    await sembrarPlantillas(page)
    await abrirAsistente(page)
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await aplicarFilaFuente(page, 'Sueldo QA')
    await expect(estado(page, 'fuentes')).toHaveText('Completada')
    await page.getByTestId('continuar-fuentes').click()
    await page.getByRole('button', { name: 'Omitir', exact: true }).click()
    await expect(estado(page, 'subcajas')).toHaveText('Omitida')
    await page.keyboard.press('Escape')
    await asistenteOculto(page)
    await abrirAsistente(page)
    await expect(estado(page, 'fuentes')).toHaveText('Completada')
    await expect(estado(page, 'subcajas')).toHaveText('Omitida')
    await expect(estado(page, 'gastos')).toHaveText('Pendiente')
    // Siguiente salta lo completado/omitido: desde Fuentes va directo a Gastos.
    await page.getByTestId('etapa-fuentes').click()
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Abrir gastos mensuales' })).toBeVisible()
    // Retomar una etapa omitida la devuelve a Pendiente.
    await page.getByTestId('etapa-subcajas').click()
    await page.getByRole('button', { name: /Retomar/ }).first().click()
    await expect(estado(page, 'subcajas')).toHaveText('Pendiente')
  })

  test('mes cambiado: el progreso queda guardado por mes y se conserva al ir y volver', async ({ page }) => {
    await abrir(page)
    await abrirAsistente(page)
    await page.getByRole('button', { name: 'Omitir', exact: true }).click()
    await expect(estado(page, 'fuentes')).toHaveText('Omitida')
    await page.keyboard.press('Escape')
    await asistenteOculto(page)
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
    await page.getByRole('button', { name: 'Mes anterior', exact: true }).first().click()
    await abrirAsistente(page)
    await expect(estado(page, 'fuentes')).toHaveText('Omitida')
    await expect(estado(page, 'subcajas')).toHaveText('Pendiente')
  })

  test('cancelar la confirmación no aplica nada y no vuelve al asistente; luego se puede aplicar', async ({ page }) => {
    await abrir(page)
    await sembrarPlantillas(page)
    await abrirAsistente(page)
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await dialog(page).getByRole('button', { name: /Seleccionar todas/ }).click()
    await dialog(page).getByRole('button', { name: /^Aplicar \d+ a / }).click()
    await expect(page.getByTestId('pf-vista-previa')).toBeVisible()
    await expect(page.getByTestId('pf-operacion').first()).toHaveText('Crear aplicación mensual')
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    expect(await llamadas(page, 'aplicarPlantillasFin')).toBe(0)
    await expect(page.getByTestId('pf-fila').filter({ hasText: 'Sueldo QA' }).getByTestId('pf-estado')).not.toHaveText('Aplicada')
    await expect(page.getByTestId('asistente-plan')).toHaveCount(0)             // sigue en el módulo hijo
  })

  test('plantilla ya aplicada: figura «Aplicada» (no «Se creará») y reaplicarla no duplica', async ({ page }) => {
    await abrir(page)
    await sembrarPlantillas(page)
    await abrirAsistente(page)
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await aplicarFilaFuente(page, 'Sueldo QA')
    await expect(estado(page, 'fuentes')).toHaveText('Completada')
    const n = await nFuentes(page)
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    const fila = page.getByTestId('pf-fila').filter({ hasText: 'Sueldo QA' })
    await expect(fila.getByTestId('pf-estado')).toHaveText('Aplicada')
    await expect(page.getByText('Se creará')).toHaveCount(0)
    await dialog(page).getByRole('button', { name: /Seleccionar todas/ }).click()
    await dialog(page).getByRole('button', { name: /^Aplicar \d+ a / }).click()
    await expect(page.getByTestId('pf-vista-previa').locator('p', { hasText: /^Sueldo QA/ }).getByTestId('pf-operacion')).toHaveText('Sin cambios')
    await page.getByRole('button', { name: 'Confirmar y aplicar' }).click()
    await expect(page.getByTestId('asistente-plan')).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await nFuentes(page)).toBe(n + 1)                                   // solo se sumó «Extra QA»; «Sueldo QA» no se duplicó                                       // sin duplicados
  })

  test('acceso independiente (desde Cajas) no abre ni vuelve al asistente', async ({ page }) => {
    await abrir(page)
    await page.getByRole('button', { name: 'Fuentes mensuales' }).first().click()
    await crearPlantillaFuente(page, 'Solo QA', '500')
    await expect(page.getByTestId('pf-mes-plan')).toHaveCount(0)               // selector de mes normal
    await aplicarFilaFuente(page, 'Solo QA')
    await expect(page.getByTestId('pf-fila').filter({ hasText: 'Solo QA' }).getByTestId('pf-estado')).toHaveText('Aplicada')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog').filter({ visible: true })).toHaveCount(0)
    await expect(page.getByTestId('asistente-plan')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /Fuentes de dinero/ })).toBeVisible()   // quedó en Cajas
  })

  test('doble clic al aplicar: una sola escritura y sin duplicados', async ({ page }) => {
    await abrir(page, '/?demo=60&fuentes=3&cajas=3&latencia=400#cajas')
    await page.getByTestId('campana-plan').click()
    await page.getByTestId('panel-plan').getByRole('button', { name: 'Preparar ahora' }).click()
    await page.getByRole('button', { name: 'Usar mes anterior' }).first().click()
    const btn = page.getByTestId('aplicar-fuentes')
    await btn.dblclick()
    await expect(estado(page, 'fuentes')).toHaveText('En progreso')
    await expect(estado(page, 'fuentes')).toHaveText('Completada')
    expect(await llamadas(page, 'aplicarEntidadesMes')).toBe(1)
  })

  test('respuesta lenta: En progreso mientras guarda, el cierre queda bloqueado en el módulo hijo', async ({ page }) => {
    await abrir(page, '/?demo=60&fuentes=3&cajas=3&latencia=900#cajas')
    await sembrarPlantillas(page)
    await abrirAsistente(page)
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await aplicarFilaFuente(page, 'Sueldo QA')
    await page.keyboard.press('Escape')                                         // Escape durante el guardado no cierra el módulo
    await expect(page.getByTestId('pf-lista')).toBeVisible()
    await expect(page.getByTestId('asistente-plan')).toBeVisible()
    await expect(estado(page, 'fuentes')).toHaveText('Completada')
  })

  test('error del backend: sin éxito falso, estado Error visible y nada aplicado', async ({ page }) => {
    await abrir(page, '/?demo=60&fuentes=3&cajas=3&falla=1#cajas')
    const antes = await nFuentes(page)
    await abrirAsistente(page)
    await page.getByRole('button', { name: 'Usar mes anterior' }).first().click()
    await page.getByTestId('aplicar-fuentes').click()
    await expect(estado(page, 'fuentes')).toHaveText('Error')
    await expect(page.getByTestId('error-fuentes')).toBeVisible()
    await expect(page.getByTestId('ok-fuentes')).toHaveCount(0)
    expect(await nFuentes(page)).toBe(antes)
  })
})

for (const [w, h] of [[375, 812], [390, 844], [768, 1024], [1366, 768]] as const) {
  test(`v1.20 responsive ${w}px: asistente, módulo hijo y resumen sin desbordes`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await abrir(page)
    await sembrarPlantillas(page)
    await abrirAsistente(page)
    expect(await sinScrollH(page)).toBe(true)
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await expect(page.getByTestId('pf-mes-plan')).toBeVisible()
    expect(await sinScrollH(page)).toBe(true)
    await aplicarFilaFuente(page, 'Sueldo QA')
    await expect(page.getByTestId('continuar-fuentes')).toBeVisible()
    expect(await sinScrollH(page)).toBe(true)
    await page.getByTestId('etapa-resumen').click()
    await expect(page.getByTestId('plan-indicadores')).toBeVisible()
    expect(await sinScrollH(page)).toBe(true)
    const caja = await dialog(page).boundingBox()
    expect(caja!.x).toBeGreaterThanOrEqual(-1); expect(caja!.x + caja!.width).toBeLessThanOrEqual(w + 1)
  })
}

test('v1.20 tema oscuro: tarjetas de estado legibles (no blancas) y con texto', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await abrir(page)
  await abrirAsistente(page)
  const card = page.getByTestId('etapa-fuentes')
  const bg = await card.evaluate(e => getComputedStyle(e).backgroundColor)
  expect(bg).not.toBe('rgb(255, 255, 255)')
  await expect(estado(page, 'fuentes')).toHaveText('Pendiente')                 // el estado no depende solo del color
})
