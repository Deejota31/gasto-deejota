import { expect, test, type Page } from '@playwright/test'
import { dialog, go } from './util'

// v1.26 — Fondos del presupuesto y Revisión del presupuesto. Modo demostración. Los 10 escenarios de la especificación.
const money = (s: string) => Number(s.replace(/[^\d.-]/g, ''))
const calls = (page: Page) => page.evaluate(() => ({ ...(globalThis as unknown as { __gdDemoCalls: Record<string, number> }).__gdDemoCalls }))
const NOV = '2026-11-05T10:00:00-05:00'

async function abrir(page: Page, hoy = NOV, ruta = '/?demo=60&fondos=3&cajas=3&latencia=0#cajas') {
  await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
  await page.clock.setFixedTime(new Date(hoy))
  await page.goto(ruta)
  if (ruta.endsWith('#cajas')) await expect(page.getByRole('heading', { name: /Fondos del presupuesto/ })).toBeVisible()
  else await expect(page.getByTestId('consolidado')).toBeVisible()
}
/** Cifra del Presupuesto consolidado (Dashboard). */
async function cifra(page: Page, id: 'presupuesto-consolidado' | 'gastado-del-período' | 'disponible-consolidado') {
  await go(page, 'Dashboard')
  const el = page.getByTestId(`cons-${id}`)
  await expect(el).toBeVisible()
  return money(await el.locator('p').nth(1).innerText())
}
async function nuevoFondo(page: Page, { nombre, monto, tipo }: { nombre: string; monto: string; tipo: 'Mensual' | 'Extra' | 'Ahorro asignado' }) {
  await go(page, 'Cajas')
  await page.getByRole('button', { name: 'Nuevo fondo' }).click()
  const d = dialog(page)
  await d.getByLabel('Nombre del fondo').fill(nombre)
  await d.getByLabel('Monto').fill(monto)
  await d.getByRole('radiogroup', { name: 'Tipo de fondo' }).getByRole('radio', { name: tipo, exact: true }).click()
  if (tipo !== 'Mensual') await d.getByRole('radio', { name: 'Solo un mes' }).click()
  await d.getByRole('button', { name: 'Crear fondo' }).click()
  await expect(d).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: `${nombre} creado` })).toBeVisible({ timeout: 15_000 })
}
async function gasto(page: Page, { monto, medio = 'Yape', desc, abrirModal = true }: { monto: string; medio?: string; desc: string; abrirModal?: boolean }) {
  if (abrirModal) await page.getByRole('button', { name: 'Nuevo gasto' }).first().click()
  const d = dialog(page)
  await d.getByRole('radiogroup', { name: 'Ámbito' }).getByRole('radio', { name: 'Personal', exact: true }).click()
  await d.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name: 'Alimentación', exact: true }).click()
  await d.getByRole('radiogroup', { name: 'Subcategoría' }).getByRole('radio', { name: 'Almuerzo', exact: true }).click()
  await d.getByLabel('Monto', { exact: true }).fill(monto)
  await d.getByRole('radiogroup', { name: 'Medio de pago' }).getByRole('radio', { name: medio, exact: true }).click()
  await d.getByLabel('Descripción').fill(desc)
  await expect(d.getByText(/saldo/i)).toHaveCount(0)                      // no se pide ni se usa el saldo de Yape/Plin/etc.
  await d.getByRole('button', { name: 'Registrar gasto' }).click()
  await expect(d).toHaveCount(0)
}

test.describe('v1.26 escenarios de fondos (noviembre 2026)', () => {
  test('1–7: S/ 3,000 de noviembre, gasto de S/ 200, Extra 1, Ahorro asignado, mes anterior intacto, Yape/Plin sin saldo y reserva interna', async ({ page }) => {
    await abrir(page)
    // Octubre antes de tocar nada (para el escenario 4).
    await page.getByRole('button', { name: 'Mes anterior', exact: true }).click()
    const octP0 = await cifra(page, 'presupuesto-consolidado')
    const octG0 = await cifra(page, 'gastado-del-período')
    await go(page, 'Cajas')
    await page.getByRole('button', { name: 'Mes siguiente', exact: true }).click()

    // Escenario 1: S/ 3,000 para noviembre y un gasto de S/ 200.
    const p0 = await cifra(page, 'presupuesto-consolidado')            // lo que el demo ya aporta en noviembre (Extra 1 de un mes)
    await nuevoFondo(page, { nombre: 'Presupuesto noviembre', monto: '3000', tipo: 'Mensual' })
    const g0 = await cifra(page, 'gastado-del-período')
    expect(await cifra(page, 'presupuesto-consolidado')).toBe(p0 + 3000)
    await gasto(page, { monto: '200', desc: 'Escenario 1' })
    await expect.poll(() => cifra(page, 'gastado-del-período')).toBeCloseTo(g0 + 200, 2)
    expect(await cifra(page, 'presupuesto-consolidado')).toBe(p0 + 3000)
    expect(await cifra(page, 'disponible-consolidado')).toBeCloseTo(p0 + 3000 - (g0 + 200), 2)

    // Escenario 2: Extra 1 por S/ 500.
    await nuevoFondo(page, { nombre: 'Extra 1 nov', monto: '500', tipo: 'Extra' })
    expect(await cifra(page, 'presupuesto-consolidado')).toBe(p0 + 3500)
    expect(await cifra(page, 'gastado-del-período')).toBeCloseTo(g0 + 200, 2)
    expect(await cifra(page, 'disponible-consolidado')).toBeCloseTo(p0 + 3500 - (g0 + 200), 2)

    // Escenario 3: Ahorro asignado por S/ 1,000.
    await nuevoFondo(page, { nombre: 'Ahorro viaje', monto: '1000', tipo: 'Ahorro asignado' })
    expect(await cifra(page, 'presupuesto-consolidado')).toBe(p0 + 4500)
    expect(await cifra(page, 'disponible-consolidado')).toBeCloseTo(p0 + 4500 - (g0 + 200), 2)

    // Escenario 5 y 6: gastos con Yape y con Plin sin registrar ningún saldo.
    await gasto(page, { monto: '10', medio: 'Yape', desc: 'Escenario 5' })
    await gasto(page, { monto: '15', medio: 'Plin', desc: 'Escenario 6' })
    await expect.poll(() => cifra(page, 'gastado-del-período')).toBeCloseTo(g0 + 225, 2)

    // Escenario 7: una reserva interna de S/ 500 no aumenta el presupuesto total.
    await go(page, 'Cajas')
    const reservado0 = money(await page.getByTestId('cajas-resumen').locator('div', { hasText: 'Reservado en cajas' }).locator('dd').innerText())
    await page.getByRole('button', { name: 'Nueva caja' }).click()
    const d = dialog(page)
    await d.getByLabel('Nombre').fill('Reserva interna 500')
    await d.getByRole('radio', { name: 'Ámbito', exact: true }).click()
    await page.locator('#caja-valor').click()
    await page.getByRole('listbox').getByRole('option', { name: 'Amigos', exact: true }).click()
    await d.getByLabel('Monto asignado por mes').fill('500')
    await d.getByRole('button', { name: 'Crear caja' }).click()
    await expect(page.getByRole('list', { name: 'Lista de cajas' }).getByTestId('caja').filter({ hasText: 'Reserva interna 500' })).toHaveCount(1, { timeout: 15_000 })
    await expect.poll(async () => money(await page.getByTestId('cajas-resumen').locator('div', { hasText: 'Reservado en cajas' }).locator('dd').innerText())).toBeCloseTo(reservado0 + 500, 2)
    expect(await cifra(page, 'presupuesto-consolidado')).toBe(p0 + 4500)

    // Escenario 4: los fondos nuevos de noviembre no tocaron octubre.
    await go(page, 'Cajas')
    await page.getByRole('button', { name: 'Mes anterior', exact: true }).click()
    expect(await cifra(page, 'presupuesto-consolidado')).toBe(octP0)
    expect(await cifra(page, 'gastado-del-período')).toBe(octG0)
  })

  test('8: marcar el período con gastos anteriores por registrar guarda la observación y no cambia presupuesto ni gastos', async ({ page }) => {
    await abrir(page, NOV, '/?demo=60&fondos=3&cajas=3&latencia=0#dashboard')
    const p0 = await cifra(page, 'presupuesto-consolidado'), g0 = await cifra(page, 'gastado-del-período')
    const c0 = await calls(page)
    await go(page, 'Salud financiera')
    await page.getByRole('tab', { name: /Revisión del presupuesto/ }).click()
    await expect(page.getByTestId('rev-estado')).toHaveText('Pendiente de revisión')
    const f = page.getByTestId('rev-form')
    await f.getByRole('radio', { name: /Con gastos anteriores por registrar/ }).check()
    await f.getByRole('button', { name: 'Guardar revisión' }).click()
    await expect(f.getByText(/Anota qué gastos faltan/)).toBeVisible()          // exige describir lo pendiente, sin inventar importes
    await f.locator('#rev-pendientes').fill('Almuerzos del 3 y 4')
    await f.locator('#rev-observacion').fill('Revisar con el estado de cuenta')
    await f.getByRole('button', { name: 'Guardar revisión' }).dblclick()
    await expect(page.getByTestId('rev-estado')).toHaveText('Con gastos anteriores por registrar')
    await expect(page.getByTestId('rev-historial')).toContainText('Almuerzos del 3 y 4')
    const c1 = await calls(page)
    expect((c1.saveRevisionPresupuesto ?? 0) - (c0.saveRevisionPresupuesto ?? 0)).toBe(1)   // sin doble escritura
    expect((c1.saveGasto ?? 0) - (c0.saveGasto ?? 0)).toBe(0)                               // la observación no crea gastos
    expect(await cifra(page, 'presupuesto-consolidado')).toBe(p0)
    expect(await cifra(page, 'gastado-del-período')).toBe(g0)
  })

  test('9: un gasto olvidado e identificado se registra desde la revisión y actualiza los agregados de ese período (sin duplicar)', async ({ page }) => {
    await abrir(page, '2026-10-20T10:00:00-05:00', '/?demo=2&fondos=3&cajas=3&latencia=0#dashboard')
    const g0 = await cifra(page, 'gastado-del-período')
    await go(page, 'Salud financiera')
    await page.getByRole('tab', { name: /Revisión del presupuesto/ }).click()
    const dias = page.getByTestId('rev-dias')
    await expect(dias).toBeVisible()
    await dias.getByRole('button', { name: /Registrar un gasto del/ }).first().click()
    await gasto(page, { monto: '37.5', desc: 'Gasto olvidado identificado', abrirModal: false })
    await expect.poll(() => cifra(page, 'gastado-del-período')).toBeCloseTo(g0 + 37.5, 2)
    await go(page, 'Gastos')
    await expect(page.getByText('Gasto olvidado identificado').filter({ visible: true })).toHaveCount(1)
  })

  test('10: cambiar de pantalla mientras se guarda un fondo no bloquea la navegación, no duplica y confirma el resultado real', async ({ page }) => {
    await abrir(page, NOV, '/?demo=60&fondos=3&cajas=3&latencia=2500#cajas')
    const c0 = await calls(page)
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    await d.getByLabel('Nombre del fondo').fill('Fondo lento')
    await d.getByLabel('Monto').fill('250')
    await d.getByRole('button', { name: 'Crear fondo' }).dblclick()
    await expect(d).toHaveCount(0)
    await go(page, 'Gastos')
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Gastos' })).toHaveAttribute('aria-current', 'page')
    await go(page, 'Salud financiera')
    await expect(page.getByRole('status').filter({ hasText: 'Fondo lento creado' })).toBeVisible({ timeout: 20_000 })
    const c1 = await calls(page)
    expect((c1.saveFondo ?? 0) - (c0.saveFondo ?? 0)).toBe(1)
    await go(page, 'Cajas')
    await expect(page.getByRole('list', { name: 'Lista de fondos' }).getByTestId('fondo').filter({ hasText: 'Fondo lento' })).toHaveCount(1)
  })
})

test.describe('v1.26 terminología e interfaz', () => {
  test('la interfaz habla de Fondos del presupuesto y Revisión del presupuesto; no queda «fuente» ni «conciliación»', async ({ page }) => {
    await abrir(page, '2026-10-19T10:00:00-05:00')
    await expect(page.getByRole('button', { name: 'Nuevo fondo' })).toBeVisible()
    for (const tab of ['Cajas', 'Dashboard', 'Salud financiera', 'Configuración']) {
      await go(page, tab)
      await expect(page.locator('body')).not.toContainText(/fuentes? de dinero|conciliaci[oó]n/i)
    }
    await go(page, 'Salud financiera')
    await expect(page.getByRole('tab', { name: /Revisión del presupuesto/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Conciliación/ })).toHaveCount(0)
  })

  test('formulario de fondo: tipo y recurrencia son independientes; el tipo se guarda y se conserva', async ({ page }) => {
    await abrir(page, '2026-10-19T10:00:00-05:00')
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    await d.getByLabel('Nombre del fondo').fill('Ahorro tesis nuevo')
    await d.getByLabel('Monto').fill('300')
    await d.getByRole('radio', { name: 'Ahorro asignado', exact: true }).click()
    await expect(d.getByTestId('fondo-tipo-ayuda')).toContainText('Dinero ya separado')
    await expect(d.getByRole('radio', { name: 'Todos los meses' })).toBeChecked()     // elegir tipo no cambia la recurrencia
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Ahorro tesis nuevo creado' })).toBeVisible({ timeout: 15_000 })
    const fila = page.getByRole('list', { name: 'Lista de fondos' }).getByTestId('fondo').filter({ hasText: 'Ahorro tesis nuevo' })
    await fila.getByRole('button', { name: /^Editar fondo / }).first().click()
    await expect(dialog(page).getByRole('radio', { name: 'Ahorro asignado', exact: true })).toBeChecked()
  })
})

test.describe('v1.26 migración pendiente (backend ya actualizado, hoja con nombres anteriores)', () => {
  test('aviso visible; editar fondos se bloquea con un mensaje claro; «Migrar ahora» migra una sola vez y quita el aviso', async ({ page }) => {
    await abrir(page, '2026-10-19T10:00:00-05:00', '/?demo=60&fondos=3&cajas=3&latencia=0&migracion=pendiente#cajas')
    const aviso = page.getByTestId('migracion-fondos')
    await expect(aviso).toBeVisible()
    await expect(aviso).toContainText('Fondos del presupuesto')
    // los fondos se siguen viendo (lectura compatible) pero no se pueden guardar hasta migrar
    await expect(page.getByRole('list', { name: 'Lista de fondos' }).getByTestId('fondo')).toHaveCount(3)
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    const d = dialog(page)
    await d.getByLabel('Nombre del fondo').fill('Bloqueado')
    await d.getByLabel('Monto').fill('10')
    await d.getByRole('button', { name: 'Crear fondo' }).click()
    await expect(page.getByText(/Falta migrar tus datos/).first()).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    // migrar (doble clic: una sola ejecución)
    const c0 = await calls(page)
    await page.getByTestId('migrar-fondos').dblclick()
    await expect(aviso).toHaveCount(0, { timeout: 15_000 })
    const c1 = await calls(page)
    expect((c1.migrarAFondosPresupuesto ?? 0) - (c0.migrarAFondosPresupuesto ?? 0)).toBe(1)
    // ya migrado: guardar un fondo funciona
    await page.getByRole('button', { name: 'Nuevo fondo' }).click()
    await dialog(page).getByLabel('Nombre del fondo').fill('Ya migrado')
    await dialog(page).getByLabel('Monto').fill('10')
    await dialog(page).getByRole('button', { name: 'Crear fondo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Ya migrado creado' })).toBeVisible({ timeout: 15_000 })
  })
})
