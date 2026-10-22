import { useMemo } from 'react'
import { aggregate, aislaDesde, type Aggregates } from './engine'
import { ratesFromConfig } from './money'
import { imputacionesDe, type CtxReparto, type Imputacion } from './presupuesto'
import type { AppData, Filters } from './types'

/**
 * El único punto donde Dashboard, Presupuestos y Salud financiera arman el contexto del motor: mismos fondos, ajustes mensuales,
 * asignaciones manuales y tipos de cambio, así las tres pestañas muestran exactamente las mismas cifras.
 * Dependencias explícitas: un cambio en vínculos o revisiones (Salud financiera) no recalcula nada.
 */
export function useAgregado(data: AppData | null | undefined, filters: Filters, today: string): Aggregates | null {
  const gastos = data?.gastos, config = data?.config, fondos = data?.fondos, fondosMeses = data?.fondosMeses, asignaciones = data?.asignaciones
  return useMemo(() => gastos && config ? aggregate(gastos, filters, {
    base: config.moneda || 'PEN', rates: ratesFromConfig(config), today, fondos: fondos ?? [], fondosMeses: fondosMeses ?? [], asignaciones, aislarDesde: aislaDesde(config),
  }) : null, [gastos, config, fondos, fondosMeses, asignaciones, filters, today])
}

export const ctxReparto = (data: Pick<AppData, 'config' | 'fondosMeses' | 'asignaciones'>): CtxReparto => ({
  base: data.config.moneda || 'PEN', rates: ratesFromConfig(data.config), fondosMeses: data.fondosMeses ?? [], aislarDesde: aislaDesde(data.config), asignaciones: data.asignaciones,
})

/** Reparto de cada gasto entre fondos (mes completo, sin filtros): la tabla de Gastos y el detalle de un gasto lo leen de aquí. */
export function useImputaciones(data: AppData | null | undefined): Map<string, Imputacion> {
  const gastos = data?.gastos, config = data?.config, fondos = data?.fondos, fondosMeses = data?.fondosMeses, asignaciones = data?.asignaciones
  return useMemo(() => gastos && config ? imputacionesDe(gastos, fondos ?? [], ctxReparto({ config, fondosMeses, asignaciones })) : new Map(),
    [gastos, config, fondos, fondosMeses, asignaciones])
}
