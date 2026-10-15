import { expect, test, type Page } from '@playwright/test'

// v1.22 — Salud financiera → Conciliación de saldos. Modo demostración (el backend real se prueba en vitest).
// Reloj fijo en octubre de 2026 (antes del aislamiento mensual): las fuentes de la demo cuentan para el período.
const OCT = '2026-10-15T18:00:00-05:00'
const dialog = (page: Page) => page.getByRole('dialog').filter({ visible: true }).last()
const dinero = (s: string) => Number(s.replace(/[^\d.\-−+]/g, '').replace('−', '-'))
const toastOk = (page: Page, t: RegExp) => page.getByRole('status').filter({ hasText: t })
const llamadas = (page: Page) => page.evaluate(() => (globalThis as unknown as { __gdDemoCalls?: Record<string, number> }).__gdDemoCalls ?? {})
const sinScrollH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

async function abrir(page: Page, ruta = '/?demo=60&fuentes=3&cajas=3&latencia=0#salud') {
  await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
  await page.clock.setFixedTime(new Date(OCT))
  await page.goto(ruta)
  await expect(page.getByTestId('conciliacion')).toBeVisible()
}
const abrirNueva = async (page: Page) => { await page.getByTestId('conc-nueva').click(); await expect(page.getByTestId('conc-modal')).toBeVisible() }
const calculadoModal = async (page: Page) => dinero(await dialog(page).getByTestId('conc-calculado').innerText())
async function verificar(page: Page, delta: number, obs = '') {
  await abrirNueva(page)
  const calc = await calculadoModal(page)
  await dialog(page).getByTestId('conc-real').fill((calc + delta).toFixed(2))
  if (obs) await dialog(page).getByLabel('Observaciones (opcional)').fill(obs)
  await dialog(page).getByTestId('conc-guardar').click()
  await expect(page.getByTestId('conc-modal')).toHaveCount(0)
  return calc
}

test.describe('v1.22 conciliación de saldos', () => {
  test('la sección aparece en Salud financiera con tres indicadores y sin saldo verificado todavía', async ({ page }) => {
    await abrir(page)
    await expect(page.getByRole('heading', { name: 'Conciliación de saldos' })).toBeVisible()
    await expect(page.getByText('Compara tus saldos reales con los importes registrados y detecta diferencias pendientes.')).toBeVisible()
    await expect(page.getByTestId('conc-kpi-disponible-valor')).toContainText('S/')
    await expect(page.getByTestId('conc-kpi-real-valor')).toHaveText('Sin saldo verificado')            // nunca 0 en lugar de "desconocido"
    await expect(page.getByTestId('conc-kpi-diferencia-valor')).toHaveText('—')
    await expect(page.getByTestId('conc-ultima')).toContainText('ninguna todavía')
    await expect(page.getByTestId('conc-estado-general')).toHaveAttribute('data-estado', 'sin_verificar')
    await expect(page.getByTestId('conc-historial')).toHaveCount(0)                                       // historial contraído por defecto
  })

  test('el modal recalcula la diferencia al escribir: positiva, negativa y cero (con colores/estados distintos)', async ({ page }) => {
    await abrir(page)
    await abrirNueva(page)
    const d = dialog(page)
    const calc = await calculadoModal(page)
    await expect(d.getByTestId('conc-dif-valor')).toHaveText('—')
    await d.getByTestId('conc-real').fill((calc + 29.88).toFixed(2))
    await expect(d.getByTestId('conc-dif-valor')).toContainText('+')
    expect(dinero(await d.getByTestId('conc-dif-valor').innerText())).toBeCloseTo(29.88, 2)
    await expect(d.getByTestId('conc-dif-estado')).toHaveAttribute('data-estado', 'positiva')
    await d.getByTestId('conc-real').fill((calc - 10).toFixed(2).replace('.', ','))                     // coma decimal
    await expect(d.getByTestId('conc-dif-valor')).toContainText('−')
    await expect(d.getByTestId('conc-dif-estado')).toHaveAttribute('data-estado', 'negativa')
    await d.getByTestId('conc-real').fill(calc.toFixed(2))
    await expect(d.getByTestId('conc-dif-estado')).toHaveAttribute('data-estado', 'conciliado')
    await expect(d.getByTestId('conc-diferencia')).toContainText('Conciliada')
    await d.getByTestId('conc-real').fill('abc')
    await d.getByTestId('conc-guardar').click()
    await expect(d.getByText('Importe inválido')).toBeVisible()
    await expect(page.getByTestId('conc-modal')).toBeVisible()                                           // no se guardó ni se cerró
    await d.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByTestId('conc-modal')).toHaveCount(0)
    expect((await llamadas(page)).saveConciliacion ?? 0).toBe(0)                                         // cancelar no escribe nada
  })

  test('guardar una diferencia positiva: queda pendiente, no crea ingresos ni gastos y no cambia el presupuesto', async ({ page }) => {
    await abrir(page)
    const antes = dinero(await page.getByTestId('conc-kpi-disponible-valor').innerText())
    const antesCalls = await llamadas(page)
    const calc = await verificar(page, 29.88, 'Saldo confirmado después de revisar mis cuentas')
    await expect(toastOk(page, /Conciliación guardada/)).toBeVisible()
    await expect(page.getByTestId('conc-kpi-real-valor')).toContainText('S/')
    expect(dinero(await page.getByTestId('conc-kpi-real-valor').innerText())).toBeCloseTo(calc + 29.88, 2)
    expect(dinero(await page.getByTestId('conc-kpi-diferencia-valor').innerText())).toBeCloseTo(29.88, 2)
    await expect(page.getByTestId('conc-kpi-diferencia')).toContainText('Diferencia positiva')
    await expect(page.getByTestId('conc-estado-general')).toHaveAttribute('data-estado', 'pendiente')
    await expect(page.getByTestId('conc-grupo-dif')).toContainText('+')
    // integridad: el disponible presupuestario es el mismo y ninguna operación financiera se ejecutó
    expect(dinero(await page.getByTestId('conc-kpi-disponible-valor').innerText())).toBe(antes)
    const despues = await llamadas(page)
    for (const k of ['saveGasto', 'saveGastosBatch', 'saveFuente', 'saveFuenteMes', 'saveCaja', 'savePresupuesto', 'aplicarEntidadesMes', 'aplicarPlantillasFin', 'setEstado', 'saveConfig', 'deleteFuente', 'deleteCaja'])
      expect(despues[k] ?? 0, k).toBe(antesCalls[k] ?? 0)
    expect(despues.saveConciliacion).toBe(1)
  })

  test('diferencia negativa y cero; el estado visual no asume que "positivo" sea bueno', async ({ page }) => {
    await abrir(page)
    await verificar(page, -12.5)
    await expect(page.getByTestId('conc-kpi-diferencia')).toContainText('Diferencia negativa')
    await expect(page.getByTestId('conc-grupo').first().getByTestId('conc-grupo-dif')).toContainText('−')
    await verificar(page, 0)
    await expect(page.getByTestId('conc-estado-general')).toHaveAttribute('data-estado', 'conciliado')
    await expect(page.getByTestId('conc-kpi-diferencia')).toContainText('Conciliado')
  })

  test('el historial es inmutable: una nueva verificación añade un registro y conserva el anterior', async ({ page }) => {
    await abrir(page)
    await verificar(page, 5)
    await verificar(page, 7)
    await page.getByTestId('conc-historial-btn').click()
    await expect(page.getByTestId('conc-historial')).toBeVisible()
    await expect(page.getByTestId('conc-hist-fila')).toHaveCount(2)
    await page.getByLabel('Buscar en el historial').fill('no existe esto')
    await expect(page.getByTestId('conc-hist-fila')).toHaveCount(0)
    await expect(page.getByText('Ninguna conciliación coincide')).toBeVisible()
    await page.getByLabel('Buscar en el historial').fill('')
    await page.getByTestId('conc-hist-fila').first().getByRole('button', { name: 'Ver detalle' }).click()
    await expect(page.getByTestId('conc-detalle')).toBeVisible()
    await expect(page.getByTestId('conc-detalle')).toContainText('Saldo calculado')
    await dialog(page).getByRole('button', { name: 'Cerrar' }).first().click()
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByTestId('conc-exportar').click()])
    expect(descarga.suggestedFilename()).toBe('conciliaciones.csv')
  })

  test('revisar diferencia: hipótesis (no diagnósticos), en revisión y cierre justificado exige causa y explicación', async ({ page }) => {
    await abrir(page)
    await verificar(page, 29.88)
    await page.getByTestId('conc-revisar').click()
    const rev = page.getByTestId('conc-revisar')                       // el panel
    await expect(page.getByText('son hipótesis, no un diagnóstico')).toBeVisible()
    await expect(dialog(page)).toContainText('Un ingreso que no registraste')
    await dialog(page).getByTestId('conc-cerrar-just').click()
    await expect(dialog(page).getByText('indica la causa y escribe una explicación')).toBeVisible()
    await dialog(page).getByTestId('conc-en-revision').click()
    await expect(toastOk(page, /en revisión/)).toBeVisible()
    await expect(page.getByTestId('conc-grupo').first()).toContainText('En revisión')
    await page.getByTestId('conc-revisar').first().click()
    await dialog(page).getByLabel('Causa').selectOption('comision')
    await dialog(page).getByLabel('Explicación').fill('Comisión del banco')
    await dialog(page).getByTestId('conc-cerrar-just').click()
    await expect(toastOk(page, /justificada/)).toBeVisible()
    await expect(page.getByTestId('conc-grupo').first()).toContainText('Cerrada con diferencia justificada')
    await expect(page.getByTestId('conc-grupo-dif')).toContainText('+')                          // no se presenta como diferencia cero
    void rev
    expect((await llamadas(page)).saveGasto ?? 0).toBe(0)
  })

  test('registrar un gasto olvidado antes del corte deja la verificación «desactualizada» sin reescribirla', async ({ page }) => {
    await abrir(page)
    const calc = await verificar(page, 29.88)
    await page.getByTestId('conc-revisar').click()
    await page.getByTestId('conc-rev-nuevo').click()
    const d = dialog(page)
    await expect(d.getByText('Nuevo gasto').first()).toBeVisible()
    await d.getByRole('radiogroup', { name: 'Ámbito' }).getByRole('radio', { name: 'Personal', exact: true }).click()
    await d.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Alimentación', exact: true }).click()
    await d.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio', { name: 'Almuerzo', exact: true }).click()
    await d.getByLabel('Monto', { exact: true }).fill('20')
    await d.getByRole('radiogroup', { name: 'Medio de pago' }).getByRole('radio', { name: 'Yape', exact: true }).click()
    await d.getByRole('button', { name: 'Registrar gasto' }).click()
    await expect(d).toHaveCount(0)
    await expect(page.getByTestId('conc-estado-general')).toHaveAttribute('data-estado', 'desactualizada')
    await expect(page.getByTestId('conc-kpi-diferencia')).toContainText('Datos desactualizados')
    // la diferencia guardada sigue siendo la original (+29.88); el disponible de hoy bajó 20
    expect(dinero(await page.getByTestId('conc-kpi-diferencia-valor').innerText())).toBeCloseTo(29.88, 2)
    expect(dinero(await page.getByTestId('conc-kpi-disponible-valor').innerText())).toBeCloseTo(calc - 20, 2)
  })

  test('«Revisar movimientos» abre Gastos con el período de la conciliación', async ({ page }) => {
    await abrir(page)
    await abrirNueva(page)
    await dialog(page).getByRole('button', { name: 'Revisar movimientos' }).click()
    await expect(page).toHaveURL(/#gastos/)
    await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible()
  })

  test('grupos de fondos: Dinero general y Sodexo se concilian por separado; una fuente no puede estar en dos grupos', async ({ page }) => {
    await abrir(page)
    await page.getByTestId('conc-grupos-btn').click()
    await expect(page.getByText('Sin grupos: se concilia el total')).toBeVisible()
    await dialog(page).getByTestId('grupo-nuevo').click()
    await dialog(page).getByLabel('Nombre del grupo').fill('Sodexo')
    await dialog(page).getByRole('checkbox', { name: 'Fuente Sodexo' }).check()
    await dialog(page).getByTestId('grupo-guardar').click()
    await expect(toastOk(page, /Grupo «Sodexo» guardado/)).toBeVisible()
    await dialog(page).getByTestId('grupo-nuevo').click()
    await dialog(page).getByLabel('Nombre del grupo').fill('Dinero general')
    await expect(dialog(page).getByRole('checkbox', { name: 'Fuente Sodexo' })).toBeDisabled()          // ya está en otro grupo
    await dialog(page).getByRole('checkbox', { name: 'Fuente General' }).check()
    await dialog(page).getByTestId('grupo-guardar').click()
    await expect(toastOk(page, /Grupo «Dinero general» guardado/)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('conc-grupo')).toHaveCount(2)
    // cada grupo tiene su calculado y se verifica por separado
    const filas = page.getByTestId('conc-grupo')
    await filas.filter({ hasText: 'Sodexo' }).getByTestId('conc-verificar').click()
    await expect(dialog(page).getByLabel('Grupo de fondos')).toHaveValue(/gf-/)
    const calcSodexo = await calculadoModal(page)
    expect(calcSodexo).toBeLessThanOrEqual(280)
    await dialog(page).getByTestId('conc-real').fill((calcSodexo + 2.92).toFixed(2))
    await dialog(page).getByTestId('conc-guardar').click()
    await expect(filas.filter({ hasText: 'Sodexo' }).getByTestId('conc-grupo-dif')).toContainText('+')
    await expect(filas.filter({ hasText: 'Dinero general' }).getByTestId('conc-grupo-dif')).toHaveText('—')   // sin verificar: no se inventa cero
  })

  test('cambiar de mes recalcula el saldo calculado con las fuentes y gastos de ese mes', async ({ page }) => {
    await abrir(page)
    const oct = await page.getByTestId('conc-kpi-disponible-valor').innerText()
    await page.getByLabel('Período de la conciliación').selectOption('2026-09')
    await expect(page.getByTestId('conc-kpi-disponible')).toContainText(/setiembre|septiembre/i)
    await expect(page.getByTestId('conc-kpi-disponible')).toContainText('corte 30/09/2026')   // un mes pasado compara contra su último día
    expect(await page.getByTestId('conc-kpi-disponible-valor').innerText()).not.toBe(oct)
    await expect(page.getByTestId('conc-kpi-real-valor')).toHaveText('Sin saldo verificado')   // las verificaciones son por período
  })

  test('hoja conectada sin fuentes ni gastos: la sección no inventa importes', async ({ page }) => {
    await abrir(page, '/?demo=1&vacio=1&latencia=0#salud').catch(() => undefined)
    await expect(page.getByTestId('conciliacion')).toHaveCount(0)    // sin datos no hay nada que conciliar (ver el vacío de Salud)
    await expect(page.getByTestId('salud-sin-datos')).toBeVisible()
  })

  test('falla el guardado: error visible con Reintentar y no queda nada verificado', async ({ page }) => {
    await abrir(page, '/?demo=60&fuentes=3&cajas=3&latencia=0&falla=1#salud')
    await abrirNueva(page)
    const calc = await calculadoModal(page)
    await dialog(page).getByTestId('conc-real').fill((calc + 1).toFixed(2))
    await dialog(page).getByTestId('conc-guardar').click()
    await expect(page.getByRole('alert').filter({ hasText: /No se pudo guardar la conciliación/ })).toBeVisible()
    await expect(page.getByTestId('conc-kpi-real-valor')).toHaveText('Sin saldo verificado')
  })

  for (const [ancho, alto, etiqueta] of [[375, 667, 'iPhone'], [390, 844, 'iPhone grande'], [768, 1024, 'tablet'], [1366, 768, 'escritorio']] as const) {
    for (const tema of ['claro', 'oscuro'] as const) {
      test(`${etiqueta} ${ancho}×${alto} (${tema}): sin desbordes; modal con pie visible y desplazamiento interno`, async ({ page }) => {
        await page.setViewportSize({ width: ancho, height: alto })
        await abrir(page)
        if (tema === 'oscuro') await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
        expect(await sinScrollH(page)).toBe(true)
        await verificar(page, 29.88)
        expect(await sinScrollH(page)).toBe(true)
        await page.getByTestId('conc-historial-btn').click()
        await expect(page.getByTestId('conc-hist-fila')).toHaveCount(1)
        expect(await sinScrollH(page)).toBe(true)
        await abrirNueva(page)
        const caja = await dialog(page).getByTestId('conc-guardar').boundingBox()
        expect(caja && caja.y + caja.height <= alto + 1 && caja.x >= 0 && caja.x + caja.width <= ancho + 1).toBe(true)   // pie dentro de la pantalla
        expect(await sinScrollH(page)).toBe(true)
      })
    }
  }
})
