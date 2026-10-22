import { aggregate, aislaDesde } from './engine'
import { ratesFromConfig } from './money'
import type { AppData, Filters, Fondo, Plantilla } from './types'

/**
 * Dependencias de un fondo antes de eliminarlo. Ningún gasto guarda el ID de un fondo salvo una asignación manual (la atribución
 * se calcula), así que eliminar nunca borra gastos; pero sí cambia a dónde se atribuyen y qué presupuesto suman. Por eso, si hay
 * gastos (de cualquier fecha) o asignaciones manuales, la web propone DESACTIVAR.
 */

const filtroTotal = (desde: string, hasta: string): Filters => ({ preset: 'custom', desde, hasta, ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] })

export interface DepsFondo { gastos: number; ajustes: number; manuales: number }

/** Gastos (todo el historial) imputados hoy al fondo + importes por mes propios + asignaciones manuales que lo usan. */
export function dependenciasFondo(f: Fondo, data: AppData, today: string): DepsFondo {
  const ajustes = (data.fondosMeses ?? []).filter(m => m.fondoId === f.id).length
  const manuales = Object.values(data.asignaciones ?? {}).filter(ps => ps.some(p => p.fondoId === f.id)).length
  const vivos = data.gastos.filter(g => g.estado !== 'Anulado')
  if (!vivos.length) return { gastos: 0, ajustes, manuales }
  const fechas = vivos.map(g => g.fecha).sort()
  const a = aggregate(data.gastos, filtroTotal(fechas[0], fechas.at(-1)! > today ? fechas.at(-1)! : today), {
    base: data.config.moneda || 'PEN', rates: ratesFromConfig(data.config), today,
    fondos: data.fondos ?? [], fondosMeses: data.fondosMeses ?? [], asignaciones: data.asignaciones, aislarDesde: aislaDesde(data.config),
  })
  const r = a.presupuesto.fondos.find(x => x.fondo.id === f.id)
  return { gastos: r?.count ?? 0, ajustes, manuales }
}

export interface DepsCategoria { gastos: number; plantillas: number; compromisos: number; fondos: number; subcategorias: number }

const nm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/**
 * Qué usa una categoría de un ámbito (espejo de `dependenciasCategoria_` del backend): gastos y plantillas con esa
 * ámbito+categoría, cuántas de esas plantillas son compromisos, y fondos cuya cobertura (cualquier versión de sus reglas) apunta
 * a la categoría en ese ámbito, o en "todos los ámbitos" si no existe en otro.
 */
export function dependenciasCategoria(ambito: string, categoria: string, data: AppData, plantillas: Plantilla[]): DepsCategoria {
  const a = nm(ambito), c = nm(categoria)
  const filas = data.catalogo.filter(x => nm(x.ambito) === a && nm(x.categoria) === c)
  const subs = filas.filter(x => x.subcategoria).map(x => nm(x.subcategoria))
  const gastos = data.gastos.filter(g => nm(g.ambito) === a && nm(g.categoria) === c).length
  const pl = plantillas.filter(p => nm(p.ambito) === a && nm(p.categoria) === c)
  const existeEnOtro = data.catalogo.some(x => nm(x.ambito) !== a && nm(x.categoria) === c)
  const fondos = (data.fondos ?? []).filter(f => f.reglas.some(v => v.rutas.some(ru => nm(ru.categoria) === c && (nm(ru.ambito) === a || (!ru.ambito && !existeEnOtro))))).length
  return { gastos, plantillas: pl.length, compromisos: pl.filter(p => p.esCompromiso).length, fondos, subcategorias: subs.length }
}
