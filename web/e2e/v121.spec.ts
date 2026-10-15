import { expect, test, type Page } from '@playwright/test'

// v1.21 — Sin conexión ≠ conectado sin datos; terminología «Caja»; Finalizar en segundo plano.
const NOV = '2026-11-05T10:00:00-05:00'
async function ir(page: Page, ruta: string) {
  await page.addInitScript(() => { try { sessionStorage.setItem('vistaDefecto', '1') } catch { /* */ } })
  await page.clock.setFixedTime(new Date(NOV))
  await page.goto(ruta)
}
const main = (page: Page) => page.locator('main')

test.describe('v1.21 sin conexión: nada de datos de ejemplo', () => {
  for (const [hash, testid] of [['#dashboard', 'desconectado-dashboard'], ['#cajas', 'desconectado-cajas'], ['#gastos', 'desconectado-gastos'], ['#salud', 'desconectado-salud'], ['#catalogo', 'desconectado-catalogo']] as const) {
    test(`${hash}: estado vacío sin datos ni gráficos`, async ({ page }) => {
      await ir(page, `/${hash}`)
      await expect(page.getByTestId(testid)).toBeVisible()
      await expect(page.getByTestId('aviso-desconectado')).toBeVisible()
      await expect(page.locator('svg.recharts-surface')).toHaveCount(0)
      await expect(main(page)).not.toContainText(/Alimentación|Yape|Comprometido|Sin definir|Crear mi primera/)
    })
  }
  test('Catálogo pide conectarse y Configuración conserva la conexión pero bloquea las funciones', async ({ page }) => {
    await ir(page, '/#catalogo')
    await expect(page.getByTestId('desconectado-catalogo')).toContainText('Conéctate para ver y administrar tu catálogo')
    await page.goto('/#config')
    await expect(page.getByTestId('requiere-conexion')).toHaveCount(4)
    await expect(page.getByTestId('requiere-conexion').first()).toContainText('Conéctate para acceder a estas funciones')
    await expect(page.getByRole('button', { name: /Conectar|Guardar y conectar|Probar/ }).first()).toBeVisible()
  })
})

test.describe('v1.21 conectado sin registros: cada sección con su estado vacío', () => {
  test('Fuentes y Cajas sin botones «Crear mi primera…»; Gastos, Dashboard y Salud sin gráficos', async ({ page }) => {
    await ir(page, '/?demo=1&vacio=1&latencia=0#cajas')
    await expect(page.getByTestId('vacio-fuentes')).toContainText('Aún no tienes fuentes registradas. Registra una fuente para empezar')
    await expect(page.getByText('Aún no tienes cajas registradas. Añade una caja para empezar')).toBeVisible()
    await expect(page.getByRole('button', { name: /Crear mi primera/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Nueva caja' }).first()).toBeVisible()
    await page.goto('/?demo=1&vacio=1&latencia=0#gastos')
    await expect(page.getByText('Aún no has registrado gastos')).toBeVisible()
    await page.goto('/?demo=1&vacio=1&latencia=0#dashboard')
    await expect(page.getByText('Aún no hay gastos registrados')).toBeVisible()
    await expect(page.locator('svg.recharts-surface')).toHaveCount(0)
    await page.goto('/?demo=1&vacio=1&latencia=0#salud')
    await expect(page.getByTestId('salud-sin-datos')).toContainText('Todavía no hay información disponible')
    await page.goto('/?demo=1&vacio=1&latencia=0#catalogo')
    await expect(page.getByText('Aún no tienes elementos en tu catálogo')).toBeVisible()
  })
  test('terminología: la interfaz dice «Caja/Cajas», no «Subcaja»', async ({ page }) => {
    await ir(page, '/?demo=60&fuentes=3&cajas=3&latencia=0#cajas')
    await expect(page.getByRole('button', { name: 'Nueva caja' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cajas mensuales' })).toBeVisible()
    await expect(main(page)).not.toContainText(/subcaja/i)
    await page.goto('/?demo=60&fuentes=3&cajas=3&latencia=0#dashboard')
    await expect(main(page)).not.toContainText(/subcaja/i)
  })
})
