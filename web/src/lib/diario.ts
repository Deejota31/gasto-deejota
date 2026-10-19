import { matchesDims } from './engine'
import { toBaseCents } from './money'
import type { Filters, Gasto } from './types'

/** Un movimiento real con su importe en moneda base (centavos). */
export interface MovDia { g: Gasto; cents: number }

/**
 * Movimientos del período agrupados por fecha, con exactamente las mismas reglas que `aggregate()` para la serie diaria:
 * dentro del rango, no anulados, con tipo de cambio disponible y que cumplan los filtros de dimensión.
 * Se calcula una vez por combinación de datos/filtros; seleccionar un día solo consulta el mapa (sin backend ni reagregar).
 * No inventa registros: una fecha sin gastos (o futura) simplemente no está en el mapa.
 */
export function movimientosPorDia(gastos: Gasto[], f: Filters, base: string, rates: Record<string, number>): Map<string, MovDia[]> {
  const porDia = new Map<string, MovDia[]>()
  for (const g of gastos) {
    if (g.estado === 'Anulado' || g.fecha < f.desde || g.fecha > f.hasta) continue
    if (!matchesDims(g, f)) continue
    const cents = toBaseCents(g.monto, g.moneda, base, rates)
    if (cents === null) continue
    const lista = porDia.get(g.fecha)
    if (lista) lista.push({ g, cents }); else porDia.set(g.fecha, [{ g, cents }])
  }
  for (const lista of porDia.values()) lista.sort((x, y) => y.cents - x.cents)
  return porDia
}
