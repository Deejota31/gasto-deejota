import { aggregate, cajaMatches } from './engine'
import { ratesFromConfig } from './money'
import type { AppData, Caja, Filters, Fuente } from './types'

/**
 * Dependencias de una fuente o subcaja antes de eliminarla. Ningún gasto guarda el ID de una fuente ni de una caja
 * (la atribución se calcula por medio de pago / alcance), así que eliminar nunca borra gastos; pero sí cambia a dónde
 * se atribuyen y qué presupuesto suman. Por eso, si hay gastos (de cualquier fecha) la web propone DESACTIVAR.
 */

const filtroTotal = (desde: string, hasta: string): Filters => ({ preset: 'custom', desde, hasta, ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] })

export interface DepsFuente { gastos: number; ajustes: number }

/** Gastos (todo el historial) atribuidos hoy a la fuente + cantidad de importes por mes propios que se borrarían con ella. */
export function dependenciasFuente(f: Fuente, data: AppData, today: string): DepsFuente {
  const ajustes = (data.fuentesMeses ?? []).filter(m => m.fuenteId === f.id).length
  const vivos = data.gastos.filter(g => g.estado !== 'Anulado')
  if (!vivos.length) return { gastos: 0, ajustes }
  const fechas = vivos.map(g => g.fecha).sort()
  const a = aggregate(data.gastos, filtroTotal(fechas[0], fechas.at(-1)! > today ? fechas.at(-1)! : today), {
    base: data.config.moneda || 'PEN', rates: ratesFromConfig(data.config), today, cajas: data.cajas, presupuestos: data.presupuestos,
    fuentes: data.fuentes ?? [], fuentesMeses: data.fuentesMeses ?? [],
  })
  const r = a.cajas.fuentes.lista.find(x => x.fuente.id === f.id)
  // En la cascada un gasto se cuenta en la primera fuente que toma parte; las siguientes solo reciben el excedente (gastado > 0).
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
