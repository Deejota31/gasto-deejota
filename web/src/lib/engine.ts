import { addDays, daysBetween, monthsInRange } from './dates'
import { percent, toBaseCents } from './money'
import type { Caja, Filters, Gasto, Presupuesto } from './types'

/**
 * Motor único de agregaciones. Una pasada por los gastos por cada combinación de filtros;
 * KPIs, cajas y gráficos salen del mismo resultado, así que siempre cuadran entre sí.
 *
 * Reglas:
 *  - Los anulados no cuentan. Los montos en otra moneda se convierten con el tipo de cambio de Configuración;
 *    si falta, se excluyen y se informa cuántos (no se suman como si fueran PEN).
 *  - KPIs de gasto y gráficos usan todos los filtros. Presupuesto, disponible, consumido y cajas usan solo el
 *    período: un presupuesto no se puede "filtrar" por categoría sin volverse incoherente.
 *  - Cajas: la general es el presupuesto total (P). Las subcajas son reservas dentro de P, no dinero extra.
 *    Cada gasto se imputa como máximo a una subcaja (la primera que coincide, por orden).
 */

export interface Ctx {
  base: string
  rates: Record<string, number>
  today: string // AAAA-MM-DD en la zona horaria del usuario
  cajas: Caja[]
  presupuestos: Presupuesto[]
}

export interface Item { name: string; cents: number; count: number }
export interface SubItem extends Item { categoria: string; subcategoria: string; key: string }
export interface DayPoint { date: string; label: string; diario: number; acumulado: number | null; ideal: number | null; proyeccion: number | null }
export interface SubcajaResumen { caja: Caja; asignado: number; gastado: number; disponible: number; pct: number | null; excedido: boolean }
export interface CajasResumen {
  general: Caja | null
  presupuesto: number        // P
  reservado: number          // R = Σ asignaciones de subcajas
  libreInicial: number       // P − R
  gastadoSubcajas: number    // Gs
  gastadoLibre: number       // Gl
  excesoSubcajas: number     // gasto de subcajas por encima de lo asignado: sale del saldo libre
  saldoLibre: number         // P − R − Gl − exceso
  disponible: number         // P − Gs − Gl
  pct: number | null
  sobreasignado: boolean     // R > P
  subcajas: SubcajaResumen[]
}

export interface Aggregates {
  total: number
  count: number
  max: Gasto | null
  maxCents: number
  promedioMovimiento: number
  promedioDiario: number
  diasPeriodo: number
  totalPeriodo: number       // gasto del período sin filtros de dimensión (base de presupuesto)
  filtrado: boolean
  excluidosSinTipoCambio: number
  porAmbito: Item[]
  porCategoria: Item[]
  porSubcategoria: SubItem[]
  porMedio: Item[]
  jerarquia: { name: string; cents: number; children: { name: string; cents: number; children: Item[] }[] }[]
  sankey: { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] }
  frecuencia: { name: string; count: number; cents: number }[]
  dias: DayPoint[]
  estado: 'pasado' | 'en-curso' | 'futuro'
  cajas: CajasResumen
}

const sortDesc = <T extends Item>(a: T, b: T) => b.cents - a.cents || a.name.localeCompare(b.name)

function bump(map: Map<string, Item>, name: string, cents: number) {
  const it = map.get(name)
  if (it) { it.cents += cents; it.count++ } else map.set(name, { name, cents, count: 1 })
}

export const subKey = (categoria: string, sub: string) => `${categoria} › ${sub || 'Sin subcategoría'}`

export function matchesDims(g: Gasto, f: Filters): boolean {
  return (!f.ambitos.length || f.ambitos.includes(g.ambito)) &&
    (!f.categorias.length || f.categorias.includes(g.categoria)) &&
    (!f.subcategorias.length || f.subcategorias.includes(subKey(g.categoria, g.subcategoria))) &&
    (!f.medios.length || f.medios.includes(g.medioPago)) &&
    (!f.tipos.length || f.tipos.includes(g.tipoGasto))
}

export const hasDimFilters = (f: Filters) =>
  !!(f.ambitos.length || f.categorias.length || f.subcategorias.length || f.medios.length || f.tipos.length)

export function cajaMatches(c: Caja, g: Gasto): boolean {
  switch (c.filtroCampo) {
    case 'Todos': return true
    case 'Ámbito': return g.ambito === c.filtroValor
    case 'Categoría': return g.categoria === c.filtroValor
    case 'Subcategoría': return g.subcategoria === c.filtroValor
    case 'Medio de pago': return g.medioPago === c.filtroValor
  }
}

/** Presupuesto de una caja para un mes: el de PRESUPUESTOS si existe; si no, el de la caja. */
export function budgetCents(caja: Caja, periodo: string, presupuestos: Presupuesto[]): number {
  const override = presupuestos.find(p => p.periodo === periodo && p.cajaId === caja.id)
  return Math.round((override ? override.monto : caja.presupuesto) * 100)
}

/** Presupuesto de una caja para un rango: suma de los meses que toca (meses completos). */
export function budgetForRange(caja: Caja, desde: string, hasta: string, presupuestos: Presupuesto[]): number {
  return monthsInRange(desde, hasta).reduce((s, p) => s + budgetCents(caja, p, presupuestos), 0)
}

/** Días que cuentan para el promedio diario: hasta hoy si el período está en curso, completo si ya pasó, 0 si es futuro. */
export function diasDelPeriodo(desde: string, hasta: string, today: string): number {
  if (today < desde) return 0
  return daysBetween(desde, today < hasta ? today : hasta)
}

export function aggregate(gastos: Gasto[], f: Filters, ctx: Ctx): Aggregates {
  // Rango inválido (vacío o desde > hasta) → sin días, nunca un arreglo de longitud negativa.
  const totalDays = Math.max(0, Math.min(3700, daysBetween(f.desde, f.hasta) || 0))
  const daily = new Array<number>(totalDays).fill(0)
  const amb = new Map<string, Item>(), cat = new Map<string, Item>(), med = new Map<string, Item>()
  const sub = new Map<string, SubItem>()
  const hier = new Map<string, Map<string, Map<string, Item>>>()
  const flow = new Map<string, number>()
  const ordered = [...ctx.cajas].sort((a, b) => a.orden - b.orden)
  const general = ordered.find(c => c.filtroCampo === 'Todos') ?? null
  const subcajas = ordered.filter(c => c !== general)
  const subGastado = new Array<number>(subcajas.length).fill(0)
  let total = 0, count = 0, maxCents = 0, max: Gasto | null = null, excluidos = 0, totalPeriodo = 0, gastadoLibre = 0

  for (const g of gastos) {
    if (g.estado === 'Anulado' || g.fecha < f.desde || g.fecha > f.hasta) continue
    const cents = toBaseCents(g.monto, g.moneda, ctx.base, ctx.rates)
    if (cents === null) { excluidos++; continue }

    // Presupuesto: solo período. Cada gasto va a una sola subcaja o al saldo libre.
    totalPeriodo += cents
    const i = subcajas.findIndex(c => cajaMatches(c, g))
    if (i >= 0) subGastado[i] += cents; else gastadoLibre += cents

    if (!matchesDims(g, f)) continue
    total += cents
    count++
    if (cents > maxCents) { maxCents = cents; max = g }
    daily[daysBetween(f.desde, g.fecha) - 1] += cents
    const subName = g.subcategoria || 'Sin subcategoría'
    bump(amb, g.ambito, cents)
    bump(cat, g.categoria, cents)
    bump(med, g.medioPago, cents)
    const key = subKey(g.categoria, g.subcategoria)
    const s = sub.get(key)
    if (s) { s.cents += cents; s.count++ } else sub.set(key, { name: key, key, categoria: g.categoria, subcategoria: subName, cents, count: 1 })
    const a = hier.get(g.ambito) ?? new Map<string, Map<string, Item>>()
    hier.set(g.ambito, a)
    const c = a.get(g.categoria) ?? new Map<string, Item>()
    a.set(g.categoria, c)
    bump(c, subName, cents)
    const fk = `${g.medioPago}\u0000${g.ambito}`
    flow.set(fk, (flow.get(fk) ?? 0) + cents)
  }

  // Cajas (P, R, Gs, Gl). El exceso de una subcaja sobre su asignación se descuenta del saldo libre.
  const P = general ? budgetForRange(general, f.desde, f.hasta, ctx.presupuestos) : 0
  const subResumen: SubcajaResumen[] = subcajas.map((caja, i) => {
    const asignado = budgetForRange(caja, f.desde, f.hasta, ctx.presupuestos)
    const gastado = subGastado[i]
    return { caja, asignado, gastado, disponible: asignado - gastado, pct: percent(gastado, asignado), excedido: gastado > asignado }
  })
  const R = subResumen.reduce((s, x) => s + x.asignado, 0)
  const Gs = subResumen.reduce((s, x) => s + x.gastado, 0)
  const exceso = subResumen.reduce((s, x) => s + Math.max(0, x.gastado - x.asignado), 0)
  const cajas: CajasResumen = {
    general, presupuesto: P, reservado: R, libreInicial: P - R, gastadoSubcajas: Gs, gastadoLibre, excesoSubcajas: exceso,
    saldoLibre: P - R - gastadoLibre - exceso, disponible: P - Gs - gastadoLibre, pct: percent(Gs + gastadoLibre, P),
    sobreasignado: R > P, subcajas: subResumen,
  }

  // Serie diaria: real hasta hoy (o el último gasto si hay fechas futuras), ritmo ideal y proyección solo si está en curso.
  const estado = ctx.today < f.desde ? 'futuro' : ctx.today > f.hasta ? 'pasado' : 'en-curso'
  const diasPeriodo = diasDelPeriodo(f.desde, f.hasta, ctx.today)
  let lastIdx = estado === 'pasado' ? totalDays - 1 : estado === 'en-curso' ? daysBetween(f.desde, ctx.today) - 1 : -1
  for (let d = totalDays - 1; d > lastIdx; d--) if (daily[d]) { lastIdx = d; break }
  const ritmo = diasPeriodo ? total / diasPeriodo : 0
  const dias: DayPoint[] = []
  let acc = 0
  for (let d = 0; d < totalDays; d++) {
    acc += daily[d]
    const date = addDays(f.desde, d)
    dias.push({
      date,
      label: totalDays <= 31 ? String(Number(date.slice(8))) : `${date.slice(8)}/${date.slice(5, 7)}`,
      diario: daily[d],
      acumulado: d <= lastIdx ? acc : null,
      ideal: P ? Math.round((P * (d + 1)) / totalDays) : null,
      proyeccion: estado === 'en-curso' && d >= lastIdx ? Math.round(total + ritmo * (d - lastIdx)) : null,
    })
  }

  const ambitoNames = [...amb.keys()]
  const medioNames = [...med.keys()]
  const links = [...flow.entries()].map(([k, value]) => {
    const [m, a] = k.split('\u0000')
    return { source: medioNames.indexOf(m), target: medioNames.length + ambitoNames.indexOf(a), value }
  })

  return {
    total, count, max, maxCents,
    promedioMovimiento: count ? Math.round(total / count) : 0,
    promedioDiario: diasPeriodo ? Math.round(total / diasPeriodo) : 0,
    diasPeriodo, totalPeriodo, filtrado: hasDimFilters(f), excluidosSinTipoCambio: excluidos,
    porAmbito: [...amb.values()].sort(sortDesc),
    porCategoria: [...cat.values()].sort(sortDesc),
    porSubcategoria: [...sub.values()].sort(sortDesc).slice(0, 10),
    porMedio: [...med.values()].sort(sortDesc),
    jerarquia: [...hier.entries()].map(([name, cats]) => {
      const children = [...cats.entries()].map(([cn, subs]) => {
        const items = [...subs.values()].sort(sortDesc)
        return { name: cn, cents: items.reduce((s, x) => s + x.cents, 0), children: items }
      }).sort((x, y) => y.cents - x.cents)
      return { name, cents: children.reduce((s, x) => s + x.cents, 0), children }
    }).sort((x, y) => y.cents - x.cents),
    sankey: { nodes: [...medioNames, ...ambitoNames].map(name => ({ name })), links },
    frecuencia: [...cat.values()].map(c => ({ name: c.name, count: c.count, cents: c.cents })),
    dias, estado, cajas,
  }
}
