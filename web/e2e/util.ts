import { expect, type Page } from '@playwright/test'

/** Ayudas compartidas por las pruebas e2e nuevas (v1.23+). */
export const dialog = (page: Page) => page.getByRole('dialog').filter({ visible: true }).last()

export async function go(page: Page, tab: string) {
  const nav = page.getByRole('navigation', { name: 'Secciones' })
  const b = nav.getByRole('button', { name: tab, exact: true })
  if (await b.count()) { await b.click(); return }
  const menu = page.getByRole('button', { name: 'Abrir navegación' })
  if (await menu.count()) { await menu.click(); await page.getByRole('dialog', { name: 'Navegación' }).getByRole('button', { name: tab, exact: true }).click(); return }
  await nav.getByRole('button', { name: 'Más', exact: true }).click()
  await page.getByRole('dialog', { name: 'Más opciones' }).getByRole('button', { name: tab, exact: true }).click()
}

export async function newGasto(page: Page, { ambito = 'Personal', categoria = 'Alimentación', sub = 'Almuerzo', monto, medio = 'Yape', desc }: { ambito?: string; categoria?: string; sub?: string; monto: string; medio?: string; desc: string }) {
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

/** Elige una opción en un Combobox (por "#id" o nombre accesible); la lista se pinta en un portal. */
export async function pick(page: Page, trigger: string, option: string) {
  const btn = trigger.startsWith('#') ? page.locator(trigger) : page.getByRole('combobox', { name: trigger, exact: true })
  await btn.click()
  await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).first().click()
}
