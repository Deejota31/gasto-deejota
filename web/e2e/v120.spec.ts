import { expect, test, type Page } from '@playwright/test'

// v1.20 — «Prepara tu mes»: asistente continuo, estados persistidos, verificación contra Sheets, resumen real.
// Modo demostración; reloj fijo en noviembre de 2026 (mes de corte del aislamiento).
const NOV = '2026-11-05T10:00:00-05:00'
const dialog = (page: Page) => page.getByRole('dialog').filter({ visible: true }).last()
const sinScrollH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const llamadas = (page: Page, k: string) => page.evaluate(n => (globalThis as unknown as { __gdDemoCalls?: Record<string, number> }).__gdDemoCalls?.[n] ?? 0, k)
const escriturasGastos = (page: Page) => page.evaluate(() => Object.entries((globalThis as unknown as { __gdDemoCalls?: Record<string, number> }).__gdDemoCalls ?? {}).filter(([k]) => /gasto|batch/i.test(k) && !/^(data|plantillas)$/.test(k)).reduce((s, [, v]) => s + v, 0))
const nFondos = async (page: Page) => Number(await page.getByTestId('n-fondos').innerText())

async function abrir(page: Page, ruta = '/?demo=60&fondos=3&cajas=3#presupuestos', hoy = NOV) {
  await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
  await page.clock.setFixedTime(new Date(hoy))
  await page.goto(ruta)
  await expect(page.getByRole('heading', { name: /Fondos del presupuesto/ })).toBeVisible()
}
async function crearPlantillaFondo(page: Page, nombre: string, monto: string) {
  await dialog(page).getByRole('button', { name: /Nueva plantilla/ }).click()
  await page.getByRole('menuitem', { name: 'Crear desde cero' }).click()
  await dialog(page).locator('#pf-nombre').fill(nombre)
  await dialog(page).locator('#pf-monto').fill(monto)
  await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
  await expect(page.getByTestId('pf-fila').filter({ hasText: nombre })).toHaveCount(1)
}
/** Crea dos plantillas de fondo desde Cajas (acceso independiente) y deja la app en Cajas. */
async function sembrarPlantillas(page: Page) {
  await page.getByRole('button', { name: 'Fondos mensuales' }).first().click()
  await crearPlantillaFondo(page, 'Sueldo QA', '3000')
  await crearPlantillaFondo(page, 'Extra QA', '800')
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
async function aplicarFilaFondo(page: Page, nombre: string) {
  // El botón «Aplicar» de una fila aplica directo (con estado de carga); la vista previa es solo para aplicar varias.
  await page.getByTestId('pf-fila').filter({ hasText: nombre }).getByRole('button', { name: /^(Aplicar|Actualizar)/ }).first().click()
}

test.describe('v1.20 flujo continuo de «Prepara tu mes»', () => {
  test('flujo completo: Fondos → vuelve → Subcajas → Gastos → Resumen → Finalizar; sin gastos escritos', async ({ page }) => {
    await abrir(page)
    await sembrarPlantillas(page)
    await abrirAsistente(page)
    for (const e of ['fondos', 'subcajas', 'gastos']) await expect(estado(page, e)).toHaveText('Pendiente')
    const antes = await nFondos(page)
    // Abrir el módulo hijo: el asistente se oculta (sin diálogos encimados) y el módulo muestra el mes del plan.
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await asistenteOculto(page)
    await expect(page.getByTestId('pf-mes-plan')).toContainText('Noviembre')
    await aplicarFilaFondo(page, 'Sueldo QA')
    // Regresa solo al asistente, con la etapa completada y la guía para continuar.
    await expect(page.getByTestId('asistente-plan')).toBeVisible()
    await expect(estado(page, 'fondos')).toHaveText('Completada')
    await expect(page.getByTestId('continuar-fondos')).toContainText('Continuar con Cajas')
    await expect(page.getByTestId('ok-fondos')).toContainText('Fondos configurados correctamente')
    await expect(page.getByRole('dialog').filter({ visible: true })).toHaveCount(1)
    await page.getByTestId('continuar-fondos').click()
    await page.getByRole('button', { name: 'Omitir', exact: true }).click()
    await expect(estado(page, 'subcajas')).toHaveText('Omitida')
    // Gastos: marcar revisados persiste al instante.
    await page.getByRole('checkbox', { name: /Ya revisé/ }).click()
    await expect(estado(page, 'gastos')).toHaveText('Completada')
    await page.getByRole('button', { name: 'Revisar resumen' }).click()
    const r = page.getByTestId('plan-resumen-final')
    await expect(page.getByTestId('resumen-fondos')).not.toContainText('Omitida')
    await expect(page.getByTestId('resumen-subcajas')).toContainText('Omitida')
    await expect(page.getByTestId('resumen-gastos')).toContainText('Completada')
    await expect(r.getByTestId('plan-indicadores')).toContainText('Etapas omitidas')
    await page.getByRole('button', { name: 'Finalizar planificación' }).click()
    await asistenteOculto(page)                                                                      // v1.21: el asistente se cierra al instante con tu clic
    await expect(page.getByTestId('campana-badge')).toHaveCount(0)
    expect(await nFondos(page)).toBeGreaterThan(antes)
    expect(await escriturasGastos(page)).toBe(0)
    expect(await llamadas(page, 'aplicarPlantillasFin')).toBe(1)           // la única escritura fue la del módulo hijo
    expect(await llamadas(page, 'aplicarEntidadesMes')).toBe(0)            // Finalizar no vuelve a crear nada
  })

  test('cerrar y reabrir conserva los estados (Fondos completada, Subcajas omitida)', async ({ page }) => {
    await abrir(page)
    await sembrarPlantillas(page)
    await abrirAsistente(page)
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await aplicarFilaFondo(page, 'Sueldo QA')
    await expect(estado(page, 'fondos')).toHaveText('Completada')
    await page.getByTestId('continuar-fondos').click()
    await page.getByRole('button', { name: 'Omitir', exact: true }).click()
    await expect(estado(page, 'subcajas')).toHaveText('Omitida')
    await page.keyboard.press('Escape')
    await asistenteOculto(page)
    await abrirAsistente(page)
    await expect(estado(page, 'fondos')).toHaveText('Completada')
    await expect(estado(page, 'subcajas')).toHaveText('Omitida')
    await expect(estado(page, 'gastos')).toHaveText('Pendiente')
    // Siguiente salta lo completado/omitido: desde Fondos va directo a Gastos.
    await page.getByTestId('etapa-fondos').click()
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
    await expect(estado(page, 'fondos')).toHaveText('Omitida')
    await page.keyboard.press('Escape')
    await asistenteOculto(page)
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
    await page.getByRole('button', { name: 'Mes anterior', exact: true }).first().click()
    await abrirAsistente(page)
    await expect(estado(page, 'fondos')).toHaveText('Omitida')
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
    await aplicarFilaFondo(page, 'Sueldo QA')
    await expect(estado(page, 'fondos')).toHaveText('Completada')
    const n = await nFondos(page)
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
    await expect.poll(() => nFondos(page)).toBe(n + 1)                        // se sumó «Extra QA» (en segundo plano); «Sueldo QA» no se duplicó
  })

  test('acceso independiente (desde Cajas) no abre ni vuelve al asistente', async ({ page }) => {
    await abrir(page)
    await page.getByRole('button', { name: 'Fondos mensuales' }).first().click()
    await crearPlantillaFondo(page, 'Solo QA', '500')
    await expect(page.getByTestId('pf-mes-plan')).toHaveCount(0)               // selector de mes normal
    await aplicarFilaFondo(page, 'Solo QA')
    await expect(page.getByTestId('pf-fila').filter({ hasText: 'Solo QA' }).getByTestId('pf-estado')).toHaveText('Aplicada')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog').filter({ visible: true })).toHaveCount(0)
    await expect(page.getByTestId('asistente-plan')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /Fondos del presupuesto/ })).toBeVisible()   // quedó en Cajas
  })

  test('doble clic al aplicar: una sola escritura y sin duplicados', async ({ page }) => {
    await abrir(page, '/?demo=60&fondos=3&cajas=3&latencia=400#presupuestos')
    await page.getByTestId('campana-plan').click()
    await page.getByTestId('panel-plan').getByRole('button', { name: 'Preparar ahora' }).click()
    await page.getByRole('button', { name: 'Usar mes anterior' }).first().click()
    const btn = page.getByTestId('aplicar-fondos')
    await btn.dblclick()
    await expect(estado(page, 'fondos')).toHaveText('En progreso')
    await expect(estado(page, 'fondos')).toHaveText('Completada')
    expect(await llamadas(page, 'aplicarEntidadesMes')).toBe(1)
  })

  test('segundo plano: el módulo se cierra al confirmar, el asistente sigue usable y la etapa pasa a Completada sola', async ({ page }) => {
    await abrir(page, '/?demo=60&fondos=3&cajas=3&latencia=900#presupuestos')
    await sembrarPlantillas(page)
    await abrirAsistente(page)
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await aplicarFilaFondo(page, 'Sueldo QA')
    // De inmediato: sin módulo ni confirmaciones encimadas, asistente visible con la etapa En progreso.
    await expect(page.getByTestId('asistente-plan')).toBeVisible()
    await expect(page.getByTestId('pf-lista')).toHaveCount(0)
    await expect(estado(page, 'fondos')).toHaveText('En progreso')
    await expect(page.getByTestId('bg-fondos')).toBeVisible()
    await expect(page.getByRole('dialog').filter({ visible: true })).toHaveCount(1)
    // Mientras guarda se puede seguir con el resto (aquí: omitir Subcajas) y Finalizar queda bloqueado.
    await page.getByTestId('etapa-subcajas').click()
    await page.getByRole('button', { name: 'Omitir', exact: true }).click()
    await expect(estado(page, 'subcajas')).toHaveText('Omitida')
    await expect(estado(page, 'fondos')).toHaveText('Completada')
    await expect(page.getByTestId('bg-fondos')).toHaveCount(0)
    expect(await llamadas(page, 'aplicarPlantillasFin')).toBe(1)
  })

  test('segundo plano con aplicación múltiple (vista previa): se cierra todo y se completa sin duplicar', async ({ page }) => {
    await abrir(page, '/?demo=60&fondos=3&cajas=3&latencia=600#presupuestos')
    await sembrarPlantillas(page)
    await abrirAsistente(page)
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await dialog(page).getByRole('button', { name: /Seleccionar todas/ }).click()
    await dialog(page).getByRole('button', { name: /^Aplicar \d+ a / }).click()
    await page.getByRole('button', { name: 'Confirmar y aplicar' }).click()
    await expect(page.getByTestId('pf-vista-previa')).toHaveCount(0)
    await expect(page.getByTestId('pf-lista')).toHaveCount(0)
    await expect(estado(page, 'fondos')).toHaveText('En progreso')
    await expect(estado(page, 'fondos')).toHaveText('Completada')
    await expect(page.getByTestId('ok-fondos')).toBeVisible()
    expect(await llamadas(page, 'aplicarPlantillasFin')).toBe(1)
  })

  test('segundo plano con error: la etapa pasa a Error con Reintentar, nada queda aplicado ni marcado', async ({ page }) => {
    await abrir(page, '/?demo=60&fondos=3&cajas=3&falla=aplicar#presupuestos')
    await sembrarPlantillas(page)
    const antes = await nFondos(page)
    await abrirAsistente(page)
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await aplicarFilaFondo(page, 'Sueldo QA')
    await expect(page.getByTestId('asistente-plan')).toBeVisible()
    await expect(estado(page, 'fondos')).toHaveText('Error')
    await expect(page.getByTestId('error-fondos')).toBeVisible()
    await expect(page.getByTestId('ok-fondos')).toHaveCount(0)
    expect(await nFondos(page)).toBe(antes)
    await page.getByTestId('error-fondos').getByRole('button', { name: /Reintentar/ }).click()   // reintenta la misma operación (idempotente), sin reabrir nada
    await expect(page.getByTestId('pf-lista')).toHaveCount(0)
    await expect(estado(page, 'fondos')).toHaveText('Error')
    expect(await llamadas(page, 'aplicarPlantillasFin')).toBe(2)
  })

  test('error del backend: sin éxito falso, estado Error visible y nada aplicado', async ({ page }) => {
    await abrir(page, '/?demo=60&fondos=3&cajas=3&falla=1#presupuestos')
    const antes = await nFondos(page)
    await abrirAsistente(page)
    await page.getByRole('button', { name: 'Usar mes anterior' }).first().click()
    await page.getByTestId('aplicar-fondos').click()
    await expect(estado(page, 'fondos')).toHaveText('Error')
    await expect(page.getByTestId('error-fondos')).toBeVisible()
    await expect(page.getByTestId('ok-fondos')).toHaveCount(0)
    expect(await nFondos(page)).toBe(antes)
  })
})

test.describe('v1.20.3 las operaciones en segundo plano no mueven al usuario', () => {
  const toastOk = (page: Page, t: RegExp) => page.getByRole('status').filter({ hasText: t })

  test('al terminar «Fondos» el usuario sigue en el módulo de Gastos mensuales: no se reabre el asistente ni se cierra el módulo', async ({ page }) => {
    await abrir(page, '/?demo=60&fondos=3&cajas=3&latencia=1800#presupuestos')
    await sembrarPlantillas(page)
    await abrirAsistente(page)
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await aplicarFilaFondo(page, 'Sueldo QA')
    await expect(estado(page, 'fondos')).toHaveText('En progreso')
    // Sin esperar: avanza a Gastos y abre Gastos mensuales mientras Fondos aún guarda.
    await page.getByTestId('etapa-gastos').click()
    await dialog(page).getByRole('button', { name: 'Abrir gastos mensuales' }).click()
    await asistenteOculto(page)
    const m = dialog(page)
    await expect(m.getByRole('list', { name: 'Plantillas' })).toBeVisible()
    // Termina la operación anterior: aviso verde, y el módulo de Gastos sigue ahí, sin asistente encima.
    await expect(toastOk(page, /plantilla aplicada/)).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(600)
    await asistenteOculto(page)
    await expect(m.getByRole('list', { name: 'Plantillas' })).toBeVisible()
    await expect(page.getByRole('dialog').filter({ visible: true })).toHaveCount(1)
    // Seguimos en Gastos: seleccionar y registrar sigue funcionando.
    await m.getByLabel('Seleccionar Gas').check()
    await expect(m.getByText('1 gasto seleccionado')).toBeVisible()
  })

  test('registrar gastos en segundo plano: se cierra el módulo, el asistente muestra «En progreso» y al terminar «Completada» con aviso verde', async ({ page }) => {
    await abrir(page, '/?demo=60&fondos=3&cajas=3&latencia=1200#presupuestos')
    await abrirAsistente(page)
    await page.getByTestId('etapa-gastos').click()
    await dialog(page).getByRole('button', { name: 'Abrir gastos mensuales' }).click()
    const m = dialog(page)
    await m.getByLabel('Seleccionar Gas').check()
    await m.getByRole('button', { name: 'Registrar 1 gasto' }).click()
    await expect(page.getByTestId('asistente-plan')).toBeVisible()
    await expect(estado(page, 'gastos')).toHaveText('En progreso')
    await expect(page.getByTestId('bg-gastos')).toBeVisible()
    await expect(toastOk(page, /Se registraron correctamente 1 gasto/)).toBeVisible({ timeout: 10000 })
    await expect(estado(page, 'gastos')).toHaveText('Completada')
    await expect(page.getByTestId('bg-gastos')).toHaveCount(0)
    expect(await llamadas(page, 'saveGastosBatch')).toBe(1)
  })

  test('navegar entre etapas mientras guarda no se interrumpe: la etapa donde estoy no cambia al completarse otra', async ({ page }) => {
    await abrir(page, '/?demo=60&fondos=3&cajas=3&latencia=1500#presupuestos')
    await sembrarPlantillas(page)
    await abrirAsistente(page)
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await aplicarFilaFondo(page, 'Sueldo QA')
    await page.getByTestId('etapa-subcajas').click()
    await expect(page.getByRole('button', { name: 'Omitir', exact: true })).toBeVisible()
    await expect(estado(page, 'fondos')).toHaveText('Completada', { timeout: 10000 })
    // Sigue en Subcajas (no lo devolvió a Fondos), con su propio contenido.
    await expect(page.getByTestId('etapa-subcajas')).toHaveAttribute('aria-current', 'step')
    await expect(page.getByTestId('etapa-fondos')).not.toHaveAttribute('aria-current', 'step')
    await expect(page.getByText('¿Cuánto reservas en cada caja')).toBeVisible()
  })

  test('Finalizar: el asistente se cierra al instante, la vista muestra «Guardando planificación…» y al terminar avisa «Planificación guardada» sin reabrir nada', async ({ page }) => {
    await abrir(page, '/?demo=60&fondos=3&cajas=3&latencia=1200#presupuestos')
    await abrirAsistente(page)
    await page.getByRole('button', { name: 'Omitir', exact: true }).click()
    await page.getByRole('button', { name: 'Omitir', exact: true }).click()
    await page.getByRole('button', { name: 'Omitir', exact: true }).click()
    await page.getByTestId('etapa-resumen').click()
    await page.getByRole('button', { name: 'Finalizar planificación' }).click()
    await expect(page.getByTestId('asistente-plan')).toHaveCount(0)                                 // se cerró con mi clic
    await expect(page.getByTestId('plan-guardando')).toBeVisible()                                  // la vista de planificación muestra el guardado en curso
    await expect(toastOk(page, /Planificación guardada/)).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('plan-guardando')).toHaveCount(0)
    await expect(page.getByTestId('asistente-plan')).toHaveCount(0)                                 // no se reabrió ni redirigió
    await expect(page).toHaveURL(/#presupuestos$/)
  })

  test('el asistente se puede cerrar mientras guarda y la operación termina igual (estado guardado)', async ({ page }) => {
    await abrir(page, '/?demo=60&fondos=3&cajas=3&latencia=1200#presupuestos')
    await sembrarPlantillas(page)
    await abrirAsistente(page)
    await dialog(page).getByRole('button', { name: 'Plantillas mensuales' }).click()
    await aplicarFilaFondo(page, 'Sueldo QA')
    await page.keyboard.press('Escape')
    await asistenteOculto(page)
    await expect(toastOk(page, /plantilla aplicada/)).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(500)
    await asistenteOculto(page)                                                                       // terminar no reabre el asistente
    await abrirAsistente(page)
    await expect(estado(page, 'fondos')).toHaveText('Completada')
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
    await aplicarFilaFondo(page, 'Sueldo QA')
    await expect(page.getByTestId('continuar-fondos')).toBeVisible()
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
  const card = page.getByTestId('etapa-fondos')
  const bg = await card.evaluate(e => getComputedStyle(e).backgroundColor)
  expect(bg).not.toBe('rgb(255, 255, 255)')
  await expect(estado(page, 'fondos')).toHaveText('Pendiente')                 // el estado no depende solo del color
})
