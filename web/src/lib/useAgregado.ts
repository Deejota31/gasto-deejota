import { useMemo } from 'react'
import { aggregate, type Aggregates } from './engine'
import { ratesFromConfig } from './money'
import type { AppData, Filters } from './types'

/**
 * El único punto donde Dashboard, Cajas y Salud financiera arman el contexto del motor: mismas fuentes, cajas,
 * ajustes mensuales y tipos de cambio, así las tres pestañas muestran exactamente las mismas cifras.
 * Dependencias explícitas: un cambio en vínculos o revisiones (Salud financiera) no recalcula nada.
 */
export function useAgregado(data: AppData | null | undefined, filters: Filters, today: string): Aggregates | null {
  const gastos = data?.gastos, config = data?.config, cajas = data?.cajas, presupuestos = data?.presupuestos
  const fuentes = data?.fuentes, fuentesMeses = data?.fuentesMeses
  return useMemo(() => gastos && config && cajas && presupuestos ? aggregate(gastos, filters, {
    base: config.moneda || 'PEN', rates: ratesFromConfig(config), today, cajas, presupuestos, fuentes: fuentes ?? [], fuentesMeses: fuentesMeses ?? [],
  }) : null, [gastos, config, cajas, presupuestos, fuentes, fuentesMeses, filters, today])
}
