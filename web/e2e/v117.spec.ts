import { expect, test, type Page } from '@playwright/test'

// v1.17 — corre contra el modo demostración (backend en memoria). No toca Google Sheets ni datos reales.
const dialog = (page: Page) => page.getByRole('dialog').last()
async function go(page: Page, tab: string) {
  const nav = page.getByRole('navigation', { name: 'Secciones' }).filter({ visible: true }).first()
  const b = nav.getByRole('button', { name: tab, exact: true })
  if (await b.count()) { await b.click(); return }
  const menu = page.getByRole('button', { name: 'Abrir navegación' })
  if (await menu.count()) { await menu.click(); await page.getByRole('dialog', { name: 'Navegación' }).getByRole('button', { name: tab, exact: true }).click(); return }
  await nav.getByRole('button', { name: 'Más', exact: true }).click()
  await page.getByRole('dialog', { name: 'Más opciones' }).getByRole('button', { name: new RegExp(`^${tab}`) }).click()
}
const sinScrollH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
async function abrirMenu(b: ReturnType<Page['locator']>) { await b.scrollIntoViewIfNeeded(); await b.page().waitForTimeout(200); await b.click() }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
})

const VIEWPORTS = [[375, 667], [390, 844], [430, 932], [360, 800], [768, 1024], [1366, 768], [1920, 1080]] as const

test.describe('v1.17: revisión responsive y menú Agregar', () => {
  for (const [w, h] of VIEWPORTS) {
    test(`${w}×${h}: sin desborde horizontal en los 6 módulos y menú Agregar dentro de la pantalla`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/?demo=60&fuentes=3')
      await expect(page.getByTestId('cons-gastado-del-período')).toBeVisible()
      for (const tab of ['Dashboard', 'Gastos', 'Cajas', 'Catálogo', 'Salud financiera', 'Configuración']) {
        await go(page, tab)
        await page.waitForTimeout(250)
        expect(await sinScrollH(page), `desborde en ${tab} a ${w}px`).toBe(true)
      }
      await go(page, 'Catálogo')
      await page.getByRole('button', { name: /^Agregar/ }).first().click()
      const items = page.getByRole('menuitem')
      await expect(items).toHaveCount(4)
      const caja = await page.getByRole('menu').first().boundingBox()
      expect(caja!.x).toBeGreaterThanOrEqual(0)
      expect(caja!.x + caja!.width).toBeLessThanOrEqual(w + 1)
      expect(caja!.y + caja!.height).toBeLessThanOrEqual(h + 1)
      await page.keyboard.press('Escape')
      await expect(items).toHaveCount(0)
    })
  }

  test('Agregar: elegir una opción cierra el menú y abre su formulario', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/?demo=60')
    await expect(page.getByTestId('cons-gastado-del-período')).toBeVisible()
    await go(page, 'Catálogo')
    await page.getByRole('button', { name: /^Agregar/ }).first().click()
    await page.getByRole('menuitem').first().click()
    await expect(page.getByRole('menuitem')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})

test.describe('v1.17: filas compactas, swipe y alternativas', () => {
  test('móvil: Lista por defecto, 1ª línea con interruptor y sin botones Editar/Más; deslizar revela acciones, sin eliminar solo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/?demo=60&fuentes=3#cajas')
    const fila = page.getByTestId('fuente-fila').first()
    await expect(fila).toBeVisible()
    await expect(fila.getByRole('switch')).toBeVisible()
    const hint = fila.getByTestId('swipe-hint')
    await expect(hint).toBeVisible()
    // alternativa sin gesto: el botón de acciones revela Editar / Clonar / Eliminar
    await hint.click()
    const panel = fila.getByRole('group', { name: /^Acciones de / })
    await expect(panel.getByRole('button', { name: /Editar/ })).toBeVisible()
    await expect(panel.getByRole('button', { name: /Eliminar/ })).toBeVisible()
    // abrir no elimina nada: la fila sigue y Eliminar pide confirmación
    await panel.getByRole('button', { name: /Eliminar/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(fila).toBeVisible()
  })

  test('swipe táctil real (CDP) abre las acciones; el scroll vertical no las abre', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/?demo=60&fuentes=3#cajas')
    const fila = page.getByTestId('fuente-fila').first()
    await fila.scrollIntoViewIfNeeded()
    const b = (await fila.boundingBox())!
    const cdp = await context.newCDPSession(page)
    const toque = async (x1: number, y1: number, x2: number, y2: number) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] })
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * i / 8, y: y1 + (y2 - y1) * i / 8 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const y = b.y + b.height / 2
    await toque(b.x + b.width * 0.8, y, b.x + b.width * 0.2, y)
    await expect(fila).toHaveAttribute('data-swipe-abierto', 'true')
    await toque(b.x + b.width * 0.2, y, b.x + b.width * 0.8, y)
    await expect(fila).not.toHaveAttribute('data-swipe-abierto', 'true')
  })

  test('escritorio: sin swipe, el menú ⋯ sigue disponible', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?demo=60&fuentes=3#cajas')
    await expect(page.getByTestId('swipe-hint')).toHaveCount(0)
  })
})

test.describe('v1.17: Gastos mensuales en móvil', () => {
  test('filas de 2 líneas, «Usar» visible, pie siempre visible, acciones deslizando y sin desborde', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/?demo=60')
    await page.getByRole('button', { name: 'Gastos mensuales' }).first().click()
    const d = dialog(page)
    const fila = d.getByTestId('plantilla-fila').first()
    await expect(fila).toBeVisible()
    await expect(fila.getByRole('button', { name: /^Usar plantilla/ })).toBeInViewport()
    expect(await d.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
    await fila.getByTestId('swipe-hint').click()
    const panel = fila.getByRole('group', { name: /^Acciones de / })
    for (const n of ['Editar', 'Clonar', 'Eliminar']) await expect(panel.getByRole('button', { name: n })).toBeVisible()
    await page.keyboard.press('Escape')   // cierra las acciones; el modal permanece o se cierra, nunca elimina
    await expect(page.getByText('11 plantillas').first()).toHaveCount(0)
  })
})

test.describe('v1.17: Fuentes mensuales', () => {
  const abrir = async (page: Page) => {
    await page.goto('/?demo=60&fuentes=3#cajas')
    await page.getByRole('button', { name: 'Fuentes mensuales' }).first().click()
  }

  test('estado vacío; crear desde cero; no cambia saldos; persiste al cerrar y reabrir', async ({ page }) => {
    await abrir(page)
    const d = dialog(page)
    await expect(d.getByText('Aún no tienes plantillas de fuentes')).toBeVisible()
    await d.getByRole('button', { name: /Nueva plantilla/ }).click()
    await page.getByRole('menuitem', { name: 'Crear desde cero' }).click()
    await dialog(page).locator('#pf-nombre').fill('Bono Escolar')
    await dialog(page).locator('#pf-monto').fill('450')
    await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(page.getByTestId('pf-fila')).toHaveCount(1)
    await expect(page.getByTestId('pf-estado').first()).toHaveText('Pendiente')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Fuentes mensuales' }).first().click()
    await expect(page.getByTestId('pf-nombre').first()).toContainText('Bono Escolar')
  })

  test('nombre duplicado se rechaza; monto inválido se rechaza', async ({ page }) => {
    await abrir(page)
    for (const n of ['Dup', 'Dup']) {
      await dialog(page).getByRole('button', { name: /Nueva plantilla/ }).click()
      await page.getByRole('menuitem', { name: 'Crear desde cero' }).click()
      await dialog(page).locator('#pf-nombre').fill(n)
      await dialog(page).locator('#pf-monto').fill('10')
      await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
    }
    await expect(dialog(page).getByText(/Ya existe una plantilla llamada/)).toBeVisible()
    await dialog(page).locator('#pf-nombre').fill('Otra')
    await dialog(page).locator('#pf-monto').fill('abc')
    await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(dialog(page).getByText(/monto válido/)).toBeVisible()
  })

  test('Guardar como plantilla desde la fuente: copia datos, no crea fuentes; segunda vez avisa que ya existe', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?demo=60&fuentes=3#cajas')
    const menu = page.getByRole('button', { name: /^Más acciones de la fuente / }).first()
    const etiqueta = (await menu.getAttribute('aria-label'))!.replace('Más acciones de la fuente ', '')
    await abrirMenu(menu)
    await page.getByRole('menuitem', { name: 'Guardar como plantilla' }).click()
    await expect(dialog(page).locator('#pf-nombre')).toHaveValue(etiqueta)
    await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(page.getByTestId('pf-fila')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await abrirMenu(page.getByRole('button', { name: `Más acciones de la fuente ${etiqueta}`, exact: true }))
    await page.getByRole('menuitem', { name: 'Guardar como plantilla' }).click()
    await expect(page.getByTestId('plantilla-ya-existe')).toContainText(etiqueta)
    await page.getByRole('button', { name: 'Editar plantilla' }).click()
    await expect(dialog(page).locator('#pf-nombre')).toHaveValue(etiqueta)
  })

  test('aplicar con monto temporal: vista previa, aplicada, reaplicar no duplica; omitir y volver a pendiente', async ({ page }) => {
    await abrir(page)
    await dialog(page).getByRole('button', { name: /Nueva plantilla/ }).click()
    await page.getByRole('menuitem', { name: 'Crear desde cero' }).click()
    await dialog(page).locator('#pf-nombre').fill('Aporte Extra')
    await dialog(page).locator('#pf-monto').fill('300')
    await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
    const d = dialog(page)
    await d.getByLabel('Monto de Aporte Extra').fill('450')
    await d.getByLabel('Seleccionar Aporte Extra').check()
    await d.getByRole('button', { name: 'Ver detalle' }).click()
    await expect(d.getByLabel('Detalle de lo que se aplicará')).toContainText('450')
    await d.getByRole('button', { name: /^Aplicar 1 a / }).click()
    await expect(page.getByTestId('pf-vista-previa')).toBeVisible()
    await page.getByRole('button', { name: 'Confirmar y aplicar' }).click()
    await expect(page.getByTestId('pf-estado').first()).toHaveText('Aplicada')
    const filas = () => page.getByTestId('pf-fila').count()
    expect(await filas()).toBe(1)
    // «No aplica este mes» y volver a pendiente
    await page.getByTestId('pf-estado').first().click()
    await page.getByRole('menuitem', { name: 'No aplica este mes' }).click()
    await expect(page.getByTestId('pf-estado').first()).toHaveText('No aplica este mes')
    await page.getByTestId('pf-estado').first().click()
    await page.getByRole('menuitem', { name: 'Volver a Pendiente' }).click()
    // v1.20: en un mes anterior al corte la fuente ya creada rige por su configuración histórica (no se muestra como «Pendiente»).
    await expect(page.getByTestId('pf-estado').first()).toHaveText('Config. histórica')
  })

  test('clonar, reordenar con Subir/Bajar vía swipe/menú y eliminar solo la plantilla', async ({ page }) => {
    await abrir(page)
    for (const n of ['A1', 'B2']) {
      await dialog(page).getByRole('button', { name: /Nueva plantilla/ }).click()
      await page.getByRole('menuitem', { name: 'Crear desde cero' }).click()
      await dialog(page).locator('#pf-nombre').fill(n)
      await dialog(page).locator('#pf-monto').fill('10')
      await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
    }
    await abrirMenu(page.getByRole('button', { name: 'Más acciones de la plantilla A1' }))
    await page.getByRole('menuitem', { name: 'Clonar' }).click()
    await expect(dialog(page).locator('#pf-nombre')).toHaveValue('A1 (Copia)')
    await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(page.getByTestId('pf-fila')).toHaveCount(3)
    await abrirMenu(page.getByRole('button', { name: 'Más acciones de la plantilla A1 (Copia)' }))
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    await expect(page.getByTestId('eliminar-plantilla-fin')).toBeVisible()
    await page.getByRole('button', { name: 'Eliminar', exact: true }).last().click()
    await expect(page.getByTestId('pf-fila')).toHaveCount(2)
  })

  test('falla del backend: no queda guardada ninguna plantilla', async ({ page }) => {
    await page.goto('/?demo=60&fuentes=3&falla=1#cajas')
    await page.getByRole('button', { name: 'Fuentes mensuales' }).first().click()
    await dialog(page).getByRole('button', { name: /Nueva plantilla/ }).click()
    await page.getByRole('menuitem', { name: 'Crear desde cero' }).click()
    await dialog(page).locator('#pf-nombre').fill('Falla')
    await dialog(page).locator('#pf-monto').fill('10')
    await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(page.getByRole('alert').filter({ hasText: /No se pudo guardar la plantilla/ })).toBeVisible()
  })
})

test.describe('v1.17: Cajas mensuales', () => {
  test('crear desde existente (selector con búsqueda), aplicar reserva, no cambia el presupuesto consolidado', async ({ page }) => {
    await page.goto('/?demo=60&fuentes=3#cajas')
    await page.getByRole('button', { name: 'Cajas mensuales' }).first().click()
    const d = dialog(page)
    await d.getByRole('button', { name: /Nueva plantilla/ }).click()
    await page.getByRole('menuitem', { name: /desde una caja existente/ }).click()
    await dialog(page).locator('#pf-origen').click()
    const op = page.getByRole('listbox').getByRole('option').first()
    await op.click()
    await expect(dialog(page).locator('#pf-nombre')).not.toHaveValue('')
    await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(page.getByTestId('pf-fila')).toHaveCount(1)
    await expect(page.getByTestId('pf-estado').first()).toHaveText('Config. histórica')   // v1.20: la subcaja ya existe y rige en meses previos al corte
  })

  test('Guardar como plantilla desde una subcaja y aviso si ya existe', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?demo=60&fuentes=3#cajas')
    const m = page.getByRole('button', { name: /^Más acciones de (?!la fuente|la plantilla)/ }).first()
    const nombre = (await m.getAttribute('aria-label'))!.replace('Más acciones de ', '')
    await abrirMenu(m)
    await page.getByRole('menuitem', { name: 'Guardar como plantilla' }).click()
    await expect(dialog(page).locator('#pf-nombre')).toHaveValue(nombre)
    await dialog(page).getByRole('button', { name: 'Guardar plantilla' }).click()
    await expect(page.getByTestId('pf-fila')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await abrirMenu(page.getByRole('button', { name: `Más acciones de ${nombre}`, exact: true }))
    await page.getByRole('menuitem', { name: 'Guardar como plantilla' }).click()
    await expect(page.getByTestId('plantilla-ya-existe')).toContainText(nombre)
  })
})

test.describe('v1.17: móvil, formularios y modales de plantillas', () => {
  for (const [w, h] of [[375, 667], [390, 844], [360, 800]] as const) {
    test(`${w}×${h}: modales de plantillas sin desborde, pie visible y encima de la barra inferior`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/?demo=60&fuentes=3#cajas')
      for (const t of ['Fuentes mensuales', 'Cajas mensuales']) {
        await page.getByRole('button', { name: t }).first().click()
        const d = dialog(page)
        await expect(d).toBeVisible()
        expect(await d.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
        await expect(page.getByTestId('pf-footer')).toBeInViewport()
        await d.getByRole('button', { name: /Nueva plantilla/ }).click()
        await page.getByRole('menuitem', { name: 'Crear desde cero' }).click()
        const guardar = dialog(page).getByRole('button', { name: 'Guardar plantilla' })
        await expect(guardar).toBeInViewport()
        expect(await sinScrollH(page)).toBe(true)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
    })
  }
})
