import { aggregate, aislaDesde, cajaMatches } from './engine'
import { ratesFromConfig } from './money'
import type { AppData, Caja, Filters, Fondo, Plantilla } from './types'

/**
 * Dependencias de un fondo o subcaja antes de eliminarla. Ningún gasto guarda el ID de un fondo ni de una caja
 * (la atribución se calcula por medio de pago / alcance), así que eliminar nunca borra gastos; pero sí cambia a dónde
 * se atribuyen y qué presupuesto suman. Por eso, si hay gastos (de cualquier fecha) la web propone DESACTIVAR.
 */

const filtroTotal = (desde: string, hasta: string): Filters => ({ preset: 'custom', desde, hasta, ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] })

export interface DepsFondo { gastos: number; ajustes: number }

/** Gastos (todo el historial) atribuidos hoy al fondo + cantidad de importes por mes propios que se borrarían con ella. */
export function dependenciasFondo(f: Fondo, data: AppData, today: string): DepsFondo {
  const ajustes = (data.fondosMeses ?? []).filter(m => m.fondoId === f.id).length
  const vivos = data.gastos.filter(g => g.estado !== 'Anulado')
  if (!vivos.length) return { gastos: 0, ajustes }
  const fechas = vivos.map(g => g.fecha).sort()
  const a = aggregate(data.gastos, filtroTotal(fechas[0], fechas.at(-1)! > today ? fechas.at(-1)! : today), {
    base: data.config.moneda || 'PEN', rates: ratesFromConfig(data.config), today, cajas: data.cajas, presupuestos: data.presupuestos,
    fondos: data.fondos ?? [], fondosMeses: data.fondosMeses ?? [], aislarDesde: aislaDesde(data.config),
  })
  const r = a.cajas.fondos.lista.find(x => x.fondo.id === f.id)
  // En la cascada un gasto se cuenta en el primer fondo que toma parte; las siguientes solo reciben el excedente (gastado > 0).
  return { gastos: r ? (r.count > 0 ? r.count : r.gastado > 0 ? 1 : 0) : 0, ajustes }
}

export interface DepsCaja { gastos: number; presupuestos: number }

/** Gastos (todo el historial) que coinciden con el alcance de la subcaja y ajustes mensuales propios. */
export function dependenciasCaja(c: Caja, data: AppData): DepsCaja {
  return {
    gastos: data.gastos.filter(g => g.estado !== 'Anulado' && c.filtroCampo !== 'Todos' && cajaMatches(c, g)).length,
    presupuestos: data.presupuestos.filter(p => p.cajaId === c.id).length,
  }
}

export interface DepsCategoria { gastos: number; plantillas: number; compromisos: number; cajas: number; subcategorias: number }

const nm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/**
 * Qué usa una categoría de un ámbito (espejo de `dependenciasCategoria_` del backend): gastos y plantillas con esa
 * ámbito+categoría, cuántas de esas plantillas son compromisos, y subcajas que apuntan a la categoría o a sus
 * subcategorías (solo cuentan si esa opción no existe también en otro ámbito).
 */
export function dependenciasCategoria(ambito: string, categoria: string, data: AppData, plantillas: Plantilla[]): DepsCategoria {
  const a = nm(ambito), c = nm(categoria)
  const filas = data.catalogo.filter(x => nm(x.ambito) === a && nm(x.categoria) === c)
  const subs = filas.filter(x => x.subcategoria).map(x => nm(x.subcategoria))
  const gastos = data.gastos.filter(g => nm(g.ambito) === a && nm(g.categoria) === c).length
  const pl = plantillas.filter(p => nm(p.ambito) === a && nm(p.categoria) === c)
  const existeEnOtro = data.catalogo.some(x => nm(x.ambito) !== a && nm(x.categoria) === c)
  const subEnOtro = (s: string) => data.catalogo.some(x => nm(x.ambito) !== a && nm(x.subcategoria) === s)
  const cajas = data.cajas.filter(k => {
    const v = nm(k.filtroValor)
    if (k.filtroCampo === 'Categoría') return v === c && !existeEnOtro
    if (k.filtroCampo === 'Subcategoría') return subs.includes(v) && !subEnOtro(v)
    return false
  }).length
  return { gastos, plantillas: pl.length, compromisos: pl.filter(p => p.esCompromiso).length, cajas, subcategorias: subs.length }
}
