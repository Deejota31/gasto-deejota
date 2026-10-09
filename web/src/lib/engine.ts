import { daysInMonth, shiftMonth } from './dates'
import { percent, toBaseCents } from './money'
import type { Caja, Filters, Gasto, Presupuesto } from './types'

/** Motor único de agregaciones: todo se calcula en una pasada por selección de filtros. */

export interface Ctx {
  base: string
  rates: Record<string, number>
  today: string // AAAA-MM-DD en la zona horaria del usuario
  cajas: Caja[]
  presupuestos: Presupuesto[]
}

export interface Item { name: string; cents: number; count: number }
export interface DayPoint { day: number; diario: number; acumulado: number | null; ideal: number | null; proyeccion: number | null }
export interface MonthPoint { periodo: string; cents: number | null }
export interface CajaResumen { caja: Caja; presupuesto: number; gastado: number; disponible: number; pct: number | null }

export interface Aggregates {
  total: number
  count: number
  max: Gasto | null
  maxCents: number
  promedioMovimiento: number
  promedioDiario: number
  diasPeriodo: number
  cajaMensual: number
  disponible: number
  consumidoPct: number | null
  excluidosSinTipoCambio: number
  porAmbito: Item[]
  porCategoria: Item[]
  porSubcategoria: Item[]
  porMedio: Item[]
  jerarquia: { name: string; cents: number; children: { name: string; cents: number; children: Item[] }[] }[]
  sankey: { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] }
  frecuencia: { name: string; count: number; cents: number }[]
  dias: DayPoint[]
  meses: MonthPoint[]
  cajas: CajaResumen[]
}

const sortDesc = (a: Item, b: Item) => b.cents - a.cents || a.name.localeCompare(b.name)

function bump(map: Map<string, Item>, name: string, cents: number) {
  const it = map.get(name)
  if (it) { it.cents += cents; it.count++ } else map.set(name, { name, cents, count: 1 })
}

export function matchesDims(g: Gasto, f: Filters): boolean {
  return (!f.ambito || g.ambito === f.ambito) &&
    (!f.categoria || g.categoria === f.categoria) &&
    (!f.subcategoria || g.subcategoria === f.subcategoria) &&
    (!f.medioPago || g.medioPago === f.medioPago) &&
    (!f.tipoGasto || g.tipoGasto === f.tipoGasto)
}

export function cajaMatches(c: Caja, g: Gasto): boolean {
  switch (c.filtroCampo) {
    case 'Todos': return true
    case 'Ámbito': return g.ambito === c.filtroValor
    case 'Categoría': return g.categoria === c.filtroValor
    case 'Subcategoría': return g.subcategoria === c.filtroValor
    case 'Medio de pago': return g.medioPago === c.filtroValor
  }
}

/** Presupuesto del mes: el valor de PRESUPUESTOS para ese periodo o, si no existe, el de la caja. */
export function budgetCents(caja: Caja, periodo: string, presupuestos: Presupuesto[]): number {
  const override = presupuestos.find(p => p.periodo === periodo && p.cajaId === caja.id)
  return Math.round((override ? override.monto : caja.presupuesto) * 100)
}

/** Días que cuentan para el promedio diario: mes en curso hasta hoy, meses pasados completos, futuros 0. */
export function diasDelPeriodo(periodo: string, today: string): number {
  const current = today.slice(0, 7)
  if (periodo < current) return daysInMonth(periodo)
  if (periodo > current) return 0
  return Number(today.slice(8, 10))
}

export function aggregate(gastos: Gasto[], f: Filters, ctx: Ctx): Aggregates {
  const desde6 = shiftMonth(f.periodo, -5)
  const dim = daysInMonth(f.periodo)
  const daily = new Array<number>(dim + 1).fill(0)
  const mesMap = new Map<string, number>()
  const amb = new Map<string, Item>(), cat = new Map<string, Item>(), sub = new Map<string, Item>(), med = new Map<string, Item>()
  const hier = new Map<string, Map<string, Map<string, Item>>>()
  const flow = new Map<string, number>()
  const cajas = [...ctx.cajas].sort((a, b) => a.orden - b.orden)
  const cajaGastado = new Array<number>(cajas.length).fill(0)
  let total = 0, count = 0, maxCents = 0, max: Gasto | null = null, excluidos = 0, primerMes: string | null = null

  for (const g of gastos) {
    if (g.estado === 'Anulado') continue
    const mes = g.fecha.slice(0, 7)
    if (!primerMes || mes < primerMes) primerMes = mes
    if (mes < desde6 || mes > f.periodo) continue
    const cents = toBaseCents(g.monto, g.moneda, ctx.base, ctx.rates)
    if (cents === null) { if (mes === f.periodo) excluidos++; continue }

    if (mes === f.periodo) cajas.forEach((c, i) => { if (cajaMatches(c, g)) cajaGastado[i] += cents })
    if (!matchesDims(g, f)) continue
    mesMap.set(mes, (mesMap.get(mes) ?? 0) + cents)
    if (mes !== f.periodo) continue

    total += cents
    count++
    if (cents > maxCents) { maxCents = cents; max = g }
    daily[Number(g.fecha.slice(8, 10))] += cents
    const subName = g.subcategoria || 'Sin subcategoría'
    bump(amb, g.ambito, cents)
    bump(cat, g.categoria, cents)
    bump(sub, `${g.categoria} › ${subName}`, cents)
    bump(med, g.medioPago, cents)
    const a = hier.get(g.ambito) ?? new Map<string, Map<string, Item>>()
    hier.set(g.ambito, a)
    const c = a.get(g.categoria) ?? new Map<string, Item>()
    a.set(g.categoria, c)
    bump(c, subName, cents)
    const fk = `${g.medioPago}\u0000${g.ambito}`
    flow.set(fk, (flow.get(fk) ?? 0) + cents)
  }

  const general = cajas.find(c => c.filtroCampo === 'Todos')
  const cajaMensual = general ? budgetCents(general, f.periodo, ctx.presupuestos) : 0
  const diasPeriodo = diasDelPeriodo(f.periodo, ctx.today)

  // Serie diaria: real hasta hoy (o hasta el último gasto si hay fechas futuras), ideal y proyección.
  const isCurrent = f.periodo === ctx.today.slice(0, 7)
  let lastDay = f.periodo < ctx.today.slice(0, 7) ? dim : isCurrent ? Number(ctx.today.slice(8, 10)) : 0
  for (let d = dim; d > lastDay; d--) if (daily[d]) { lastDay = d; break }
  const ritmo = diasPeriodo ? total / diasPeriodo : 0
  const dias: DayPoint[] = []
  let acc = 0
  for (let d = 1; d <= dim; d++) {
    acc += daily[d]
    dias.push({
      day: d,
      diario: daily[d],
      acumulado: d <= lastDay ? acc : null,
      ideal: cajaMensual ? Math.round((cajaMensual * d) / dim) : null,
      proyeccion: isCurrent && d >= lastDay ? Math.round(total + ritmo * (d - lastDay)) : null,
    })
  }

  const meses: MonthPoint[] = []
  for (let i = 5; i >= 0; i--) {
    const p = shiftMonth(f.periodo, -i)
    // Antes del primer registro no hay información: null, no cero.
    meses.push({ periodo: p, cents: primerMes && p >= primerMes ? (mesMap.get(p) ?? 0) : null })
  }

  const ambitoNames = [...amb.keys()]
  const medioNames = [...med.keys()]
  const nodes = [...medioNames, ...ambitoNames].map(name => ({ name }))
  const links = [...flow.entries()].map(([k, value]) => {
    const [m, a] = k.split('\u0000')
    return { source: medioNames.indexOf(m), target: medioNames.length + ambitoNames.indexOf(a), value }
  })

  return {
    total,
    count,
    max,
    maxCents,
    promedioMovimiento: count ? Math.round(total / count) : 0,
    promedioDiario: diasPeriodo ? Math.round(total / diasPeriodo) : 0,
    diasPeriodo,
    cajaMensual,
    disponible: cajaMensual - total,
    consumidoPct: percent(total, cajaMensual),
    excluidosSinTipoCambio: excluidos,
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
    sankey: { nodes, links },
    frecuencia: [...cat.values()].map(c => ({ name: c.name, count: c.count, cents: c.cents })),
    dias,
    meses,
    cajas: cajas.map((caja, i) => {
      const presupuesto = budgetCents(caja, f.periodo, ctx.presupuestos)
      return { caja, presupuesto, gastado: cajaGastado[i], disponible: presupuesto - cajaGastado[i], pct: percent(cajaGastado[i], presupuesto) }
    }),
  }
}
