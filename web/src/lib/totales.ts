import { toBaseCents } from './money'
import type { Gasto } from './types'

export interface TotalesLista {
  /** Suma de los movimientos ACTIVOS en la moneda base (los de otra moneda, convertidos con el tipo de cambio de Configuración). */
  cents: number
  /** ¿Algún importe en otra moneda se convirtió? Entonces el total es aproximado (≈). */
  convertido: boolean
  /** Monedas convertidas con el tipo de cambio (para decir qué incluye el total). */
  monedasConvertidas: string[]
  /** Suma (en moneda base) de los movimientos anulados de la lista: se informa aparte, nunca dentro del total. */
  anuladosCents: number
  nAnulados: number
  /** Monedas sin tipo de cambio: esos movimientos activos no se suman (igual que en el Dashboard) y se avisa. */
  sinCambio: string[]
  nSinCambio: number
}

/** Mismo criterio que el motor del Dashboard (engine.aggregate): anulados fuera, conversión por tipo de cambio, sin cambio = excluido y avisado. */
export function totalesLista(gastos: Gasto[], base: string, rates: Record<string, number>): TotalesLista {
  const r: TotalesLista = { cents: 0, convertido: false, monedasConvertidas: [], anuladosCents: 0, nAnulados: 0, sinCambio: [], nSinCambio: 0 }
  const faltan = new Set<string>(), conv = new Set<string>()
  for (const g of gastos) {
    const c = toBaseCents(g.monto, g.moneda, base, rates)
    if (g.estado === 'Anulado') { r.nAnulados++; r.anuladosCents += c ?? 0; continue }
    if (g.estado !== 'Activo') continue
    if (c === null) { r.nSinCambio++; faltan.add(g.moneda); continue }
    if (g.moneda !== base) { r.convertido = true; conv.add(g.moneda) }
    r.cents += c
  }
  r.sinCambio = [...faltan].sort()
  r.monedasConvertidas = [...conv].sort()
  return r
}
