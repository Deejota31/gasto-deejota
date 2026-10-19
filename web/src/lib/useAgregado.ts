import { useMemo } from 'react'
import { aggregate, aislaDesde, type Aggregates } from './engine'
import { ratesFromConfig } from './money'
import type { AppData, Filters } from './types'

/**
 * El único punto donde Dashboard, Cajas y Salud financiera arman el contexto del motor: mismos fondos, cajas,
 * ajustes mensuales y tipos de cambio, así las tres pestañas muestran exactamente las mismas cifras.
 * Dependencias explícitas: un cambio en vínculos o revisiones (Salud financiera) no recalcula nada.
 */
export function useAgregado(data: AppData | null | undefined, filters: Filters, today: string): Aggregates | null {
  const gastos = data?.gastos, config = data?.config, cajas = data?.cajas, presupuestos = data?.presupuestos
  const fondos = data?.fondos, fondosMeses = data?.fondosMeses
  return useMemo(() => gastos && config && cajas && presupuestos ? aggregate(gastos, filters, {
    base: config.moneda || 'PEN', rates: ratesFromConfig(config), today, cajas, presupuestos, fondos: fondos ?? [], fondosMeses: fondosMeses ?? [], aislarDesde: aislaDesde(config),
  }) : null, [gastos, config, cajas, presupuestos, fondos, fondosMeses, filters, today])
}
