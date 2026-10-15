import type { Opcion } from '../components/Combobox'
import type { CatalogoItem } from './types'
import { otrosAlFinal } from './orden'
import { ambitoLook, categoriaLook, medioLook, subcategoriaLook } from './visual'

/** Campos con los que una subcaja (o su plantilla) delimita qué gastos toma. */
export type Alcance = 'Ámbito' | 'Categoría' | 'Subcategoría' | 'Medio de pago'
export const ALCANCES_LISTA: Alcance[] = ['Subcategoría', 'Categoría', 'Ámbito', 'Medio de pago']

/** Valores posibles del alcance según el catálogo vigente (y los medios activos). */
export function opcionesValor(campo: Alcance, catalogo: CatalogoItem[], medios: string[]): string[] {
  const vig = catalogo.filter(c => c.activo !== false)
  if (campo === 'Ámbito') return [...new Set(vig.map(c => c.ambito))]
  if (campo === 'Categoría') return otrosAlFinal([...new Set(vig.filter(c => c.categoria).map(c => c.categoria))].sort((a, b) => a.localeCompare(b)))
  if (campo === 'Subcategoría') return [...new Set(vig.filter(c => c.subcategoria).map(c => `${c.categoria} › ${c.subcategoria}`))].sort((a, b) => a.localeCompare(b))
  return medios
}

/** Opciones con icono y color del catálogo; las subcategorías se agrupan por su categoría. */
export function opcionesAlcanceCombo(opciones: string[], campo: Alcance, catalogo: CatalogoItem[]): Opcion[] {
  return opciones.map(o => {
    if (campo === 'Ámbito') { const l = ambitoLook(o, catalogo); return { value: o, label: o, Icon: l.Icon, color: l.color } }
    if (campo === 'Categoría') { const l = categoriaLook(o, catalogo); return { value: o, label: o, Icon: l.Icon, color: l.color } }
    if (campo === 'Medio de pago') { const l = medioLook(o); return { value: o, label: o, Icon: l.Icon, color: l.color } }
    const [cat, sub] = o.includes(' › ') ? o.split(' › ') : ['', o]
    const l = subcategoriaLook(sub, cat, catalogo)
    return { value: o, label: sub, desc: cat ? `en ${cat}` : undefined, group: cat || 'Otras', Icon: l.Icon, color: l.color }
  })
}
