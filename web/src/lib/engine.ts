import { addDays, daysBetween, monthsInRange } from './dates'
import { percent, toBaseCents } from './money'
import type { Caja, Filters, Fuente, FuenteMes, Gasto, Presupuesto } from './types'

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
 *  - Fuentes (v1.8): si hay al menos una fuente, P = Σ aportes del período de las fuentes ACTIVAS (las reservas no suman).
 *    Sin fuentes, P sigue siendo el presupuesto de la caja general (compatibilidad con hojas anteriores).
 *    Cada gasto se atribuye a UNA fuente efectiva: la que tiene su medio de pago asociado, o la fuente principal.
 */

export interface Ctx {
  base: string
  rates: Record<string, number>
  today: string // AAAA-MM-DD en la zona horaria del usuario
  cajas: Caja[]
  presupuestos: Presupuesto[]
  fuentes?: Fuente[]
  fuentesMeses?: FuenteMes[]
}

export interface Item { name: string; cents: number; count: number }
export interface SubItem extends Item { categoria: string; subcategoria: string; key: string }
/** Subcategoría identificada por ámbito + categoría + subcategoría: "Otros" de dos categorías o ámbitos nunca se mezclan. */
export interface RankSub extends SubItem { ambito: string }
export interface DayPoint { date: string; label: string; diario: number; acumulado: number | null; ideal: number | null; proyeccion: number | null }
export interface SubcajaResumen { caja: Caja; asignado: number; gastado: number; count: number; disponible: number; pct: number | null; excedido: boolean }
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
  /** Gs + Gl: todo lo gastado del período (sin filtros de dimensión), cada movimiento una vez. */
  gastadoPeriodo: number
  /** Σ max(0, asignado − gastado) de las subcajas activas. Conciliación: disponible = saldoLibre + reservasSinUsar. */
  reservasSinUsar: number
  pct: number | null
  sobreasignado: boolean     // R > P
  subcajas: SubcajaResumen[]
  /** Subcajas desactivadas: no reservan ni toman gastos. */
  inactivas: Caja[]
  /** De dónde sale P: suma de fuentes activas o, sin fuentes, la caja general. */
  origen: 'fuentes' | 'caja-general'
  fuentes: FuentesResumen
}

export interface FuenteResumen {
  fuente: Fuente
  /** Importe del período en moneda base (aunque esté inactiva, para mostrar cuánto aportaría). */
  asignado: number
  /** Lo que suma a P: asignado si está activa y tiene tipo de cambio; si no, 0. */
  aporta: number
  gastado: number
  count: number
  disponible: number
  pct: number | null
  principal: boolean
  sinTipoCambio: boolean
  /** Algún mes del período tiene un importe propio (FUENTES_MESES). */
  ajustado: boolean
}
export interface FuentesResumen {
  lista: FuenteResumen[]
  total: number
  activas: number
  /** Gastos pagados con el medio de una fuente inactiva: siguen descontando de P (conciliación aparte). */
  gastadoInactivas: number
  countInactivas: number
  /** Gastos sin fuente válida (no hay fuente principal activa): también descuentan de P. */
  gastadoSinFuente: number
  countSinFuente: number
}

export interface FlowLink { medio: string; ambito: string; cents: number; count: number }
export interface FrecuenciaPunto extends Item { ambitos: string[] }
export interface ResumenPeriodo {
  primerFecha: string | null
  ultimaFecha: string | null
  diaMax: { date: string; cents: number } | null
  medioDominante: Item | null
  /** Monedas originales de los movimientos considerados (antes de convertir a la moneda base). */
  monedas: string[]
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
  /** Ranking de subcategorías por ámbito › categoría › subcategoría (mayor a menor, máx. 20). */
  rankingSubcategorias: RankSub[]
  jerarquia: { name: string; cents: number; count: number; children: { name: string; cents: number; count: number; children: Item[] }[] }[]
  /** Flujo medio de pago → ámbito. Nodos ordenados de mayor a menor monto. */
  sankey: { medios: Item[]; ambitos: Item[]; links: FlowLink[] }
  frecuencia: FrecuenciaPunto[]
  resumen: ResumenPeriodo
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

/**
 * Prioridad entre cajas que se solapan: gana la más específica (Subcategoría > Categoría > Ámbito > Medio de pago);
 * a igual nivel, la primera en el orden manual. Así cada gasto cae en UNA sola subcaja y nunca se cuenta dos veces.
 */
export const ESPECIFICIDAD: Record<Caja['filtroCampo'], number> = { 'Subcategoría': 4, 'Categoría': 3, 'Ámbito': 2, 'Medio de pago': 1, Todos: 0 }
export const cajaActiva = (c: Caja) => c.activo !== false
export function prioridadCajas(cajas: Caja[]): Caja[] {
  return cajas.filter(c => c.filtroCampo !== 'Todos' && cajaActiva(c))
    .sort((a, b) => ESPECIFICIDAD[b.filtroCampo] - ESPECIFICIDAD[a.filtroCampo] || a.orden - b.orden)
}
/** La subcaja que se queda con el gasto (o undefined: va a "gastado fuera de subcajas"). */
export const cajaDe = (priorizadas: Caja[], g: Pick<Gasto, 'ambito' | 'categoria' | 'subcategoria' | 'medioPago'>) => priorizadas.find(c => cajaMatches(c, g))

const nrm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
export function cajaMatches(c: Caja, g: Pick<Gasto, 'ambito' | 'categoria' | 'subcategoria' | 'medioPago'>): boolean {
  const v = nrm(c.filtroValor)
  switch (c.filtroCampo) {
    case 'Todos': return true
    case 'Ámbito': return nrm(g.ambito) === v
    case 'Categoría': return nrm(g.categoria) === v
    // "Categoría › Subcategoría" identifica una sola subcategoría ("Otros" existe en muchas); solo el nombre, todas las de ese nombre.
    case 'Subcategoría': {
      const [cat, sub] = v.includes(' › ') ? v.split(' › ') : [null, v]
      return nrm(g.subcategoria) === sub && (cat === null || nrm(g.categoria) === cat)
    }
    case 'Medio de pago': return nrm(g.medioPago) === v
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

/**
 * Importe de una fuente para un mes, en su moneda: un importe "solo ese mes" manda; si no, el último "desde" vigente
 * (solo fuentes mensuales); si no, el importe habitual (mensual: desde su mes de aplicación; única: solo en su mes).
 */
export function fuenteMontoMes(f: Fuente, mes: string, meses: FuenteMes[]): { monto: number; ajustado: boolean } {
  let solo: FuenteMes | undefined, desde: FuenteMes | undefined
  for (const m of meses) {
    if (m.fuenteId !== f.id) continue
    if (m.modo === 'solo' && m.mes === mes) solo = m
    else if (m.modo === 'desde' && m.mes <= mes && (!desde || m.mes > desde.mes)) desde = m
  }
  if (solo) return { monto: solo.monto, ajustado: true }
  if (f.recurrencia === 'unica') return { monto: mes === f.mes ? f.monto : 0, ajustado: false }
  if (desde) return { monto: desde.monto, ajustado: true }
  return { monto: !f.mes || mes >= f.mes ? f.monto : 0, ajustado: false }
}

export const ordenFuentes = (fs: Fuente[]) => [...fs].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))

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
  const rsub = new Map<string, RankSub>()
  const hier = new Map<string, Map<string, Map<string, Item>>>()
  const flow = new Map<string, FlowLink>()
  const catAmb = new Map<string, Map<string, number>>()
  const monedas = new Set<string>()
  let primerFecha: string | null = null, ultimaFecha: string | null = null
  const ordered = [...ctx.cajas].sort((a, b) => a.orden - b.orden)
  const general = ordered.find(c => c.filtroCampo === 'Todos') ?? null
  const subcajas = ordered.filter(c => c !== general && c.filtroCampo !== 'Todos' && cajaActiva(c))
  const inactivas = ordered.filter(c => c.filtroCampo !== 'Todos' && !cajaActiva(c))
  const priorizadas = prioridadCajas(subcajas)
  const indice = new Map(subcajas.map((c, i) => [c, i]))
  const subGastado = new Array<number>(subcajas.length).fill(0)
  const subCount = new Array<number>(subcajas.length).fill(0)
  let total = 0, count = 0, maxCents = 0, max: Gasto | null = null, excluidos = 0, totalPeriodo = 0, gastadoLibre = 0

  // Fuentes: importe del período por fuente y a qué fuente se atribuye cada gasto (una sola).
  const fuentes = ordenFuentes(ctx.fuentes ?? [])
  const meses = monthsInRange(f.desde, f.hasta)
  const fMeses = ctx.fuentesMeses ?? []
  const fResumen: FuenteResumen[] = fuentes.map(fu => {
    let monto = 0, ajustado = false
    for (const m of meses) { const x = fuenteMontoMes(fu, m, fMeses); monto += x.monto; ajustado ||= x.ajustado }
    const cents = toBaseCents(monto, fu.moneda, ctx.base, ctx.rates)
    const asignado = cents ?? 0
    return { fuente: fu, asignado, aporta: fu.activo ? asignado : 0, gastado: 0, count: 0, disponible: 0, pct: null, principal: false, sinTipoCambio: cents === null && monto > 0, ajustado }
  })
  const porMedio = new Map<string, FuenteResumen>()
  for (const r of fResumen) {
    const k = r.fuente.medioPago && nrm(r.fuente.medioPago)
    if (k && (!porMedio.has(k) || (r.fuente.activo && !porMedio.get(k)!.fuente.activo))) porMedio.set(k, r)
  }
  const libres = fResumen.filter(r => r.fuente.activo && !r.fuente.medioPago)
  const principal = libres.find(r => r.aporta > 0) ?? libres[0] ?? null
  if (principal) principal.principal = true
  let gastadoInactivas = 0, countInactivas = 0, gastadoSinFuente = 0, countSinFuente = 0

  for (const g of gastos) {
    if (g.estado === 'Anulado' || g.fecha < f.desde || g.fecha > f.hasta) continue
    const cents = toBaseCents(g.monto, g.moneda, ctx.base, ctx.rates)
    if (cents === null) { excluidos++; continue }

    // Presupuesto: solo período. Cada gasto va a una sola subcaja o al saldo libre.
    totalPeriodo += cents
    const dueña = cajaDe(priorizadas, g)
    if (dueña) { const i = indice.get(dueña)!; subGastado[i] += cents; subCount[i]++ } else gastadoLibre += cents
    if (fResumen.length) {
      const fm = porMedio.get(nrm(g.medioPago))
      const efectiva = fm ?? principal
      if (fm && !fm.fuente.activo) { gastadoInactivas += cents; countInactivas++ }
      if (efectiva) { efectiva.gastado += cents; efectiva.count++ }
      if (!efectiva) { gastadoSinFuente += cents; countSinFuente++ }
    }

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
    const rk = `${g.ambito} › ${key}`
    const rs = rsub.get(rk)
    if (rs) { rs.cents += cents; rs.count++ } else rsub.set(rk, { name: rk, key, ambito: g.ambito, categoria: g.categoria, subcategoria: subName, cents, count: 1 })
    const a = hier.get(g.ambito) ?? new Map<string, Map<string, Item>>()
    hier.set(g.ambito, a)
    const c = a.get(g.categoria) ?? new Map<string, Item>()
    a.set(g.categoria, c)
    bump(c, subName, cents)
    const fk = `${g.medioPago}\u0000${g.ambito}`
    const fl = flow.get(fk)
    if (fl) { fl.cents += cents; fl.count++ } else flow.set(fk, { medio: g.medioPago, ambito: g.ambito, cents, count: 1 })
    const ca = catAmb.get(g.categoria) ?? new Map<string, number>()
    catAmb.set(g.categoria, ca)
    ca.set(g.ambito, (ca.get(g.ambito) ?? 0) + cents)
    monedas.add(g.moneda)
    if (!primerFecha || g.fecha < primerFecha) primerFecha = g.fecha
    if (!ultimaFecha || g.fecha > ultimaFecha) ultimaFecha = g.fecha
  }

  // Cajas (P, R, Gs, Gl). El exceso de una subcaja sobre su asignación se descuenta del saldo libre.
  const origen = fResumen.length ? 'fuentes' as const : 'caja-general' as const
  for (const r of fResumen) { r.disponible = r.aporta - r.gastado; r.pct = percent(r.gastado, r.aporta) }
  const totalFuentes = fResumen.reduce((s, r) => s + r.aporta, 0)
  const P = origen === 'fuentes' ? totalFuentes : general ? budgetForRange(general, f.desde, f.hasta, ctx.presupuestos) : 0
  const subResumen: SubcajaResumen[] = subcajas.map((caja, i) => {
    const asignado = budgetForRange(caja, f.desde, f.hasta, ctx.presupuestos)
    const gastado = subGastado[i]
    return { caja, asignado, gastado, count: subCount[i], disponible: asignado - gastado, pct: percent(gastado, asignado), excedido: gastado > asignado }
  })
  const R = subResumen.reduce((s, x) => s + x.asignado, 0)
  const Gs = subResumen.reduce((s, x) => s + x.gastado, 0)
  const exceso = subResumen.reduce((s, x) => s + Math.max(0, x.gastado - x.asignado), 0)
  const cajas: CajasResumen = {
    general, presupuesto: P, reservado: R, libreInicial: P - R, gastadoSubcajas: Gs, gastadoLibre, excesoSubcajas: exceso,
    saldoLibre: P - R - gastadoLibre - exceso, disponible: P - Gs - gastadoLibre,
    gastadoPeriodo: Gs + gastadoLibre, reservasSinUsar: subResumen.reduce((s, x) => s + Math.max(0, x.asignado - x.gastado), 0), pct: percent(Gs + gastadoLibre, P),
    sobreasignado: R > P, subcajas: subResumen, inactivas, origen,
    fuentes: { lista: fResumen, total: totalFuentes, activas: fResumen.filter(r => r.fuente.activo).length, gastadoInactivas, countInactivas, gastadoSinFuente, countSinFuente },
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

  const medios = [...med.values()].sort(sortDesc)
  const ambitos = [...amb.values()].sort(sortDesc)
  let diaMax: ResumenPeriodo['diaMax'] = null
  daily.forEach((c, i) => { if (c > 0 && (!diaMax || c > diaMax.cents)) diaMax = { date: addDays(f.desde, i), cents: c } })

  return {
    total, count, max, maxCents,
    promedioMovimiento: count ? Math.round(total / count) : 0,
    promedioDiario: diasPeriodo ? Math.round(total / diasPeriodo) : 0,
    diasPeriodo, totalPeriodo, filtrado: hasDimFilters(f), excluidosSinTipoCambio: excluidos,
    porAmbito: [...amb.values()].sort(sortDesc),
    porCategoria: [...cat.values()].sort(sortDesc),
    porSubcategoria: [...sub.values()].sort(sortDesc).slice(0, 10),
    rankingSubcategorias: [...rsub.values()].sort(sortDesc).slice(0, 20),
    jerarquia: [...hier.entries()].map(([name, cats]) => {
      const children = [...cats.entries()].map(([cn, subs]) => {
        const items = [...subs.values()].sort(sortDesc)
        return { name: cn, cents: items.reduce((s, x) => s + x.cents, 0), count: items.reduce((s, x) => s + x.count, 0), children: items }
      }).sort((x, y) => y.cents - x.cents || x.name.localeCompare(y.name))
      return { name, cents: children.reduce((s, x) => s + x.cents, 0), count: children.reduce((s, x) => s + x.count, 0), children }
    }).sort((x, y) => y.cents - x.cents || x.name.localeCompare(y.name)),
    sankey: { medios, ambitos, links: [...flow.values()].sort((x, y) => y.cents - x.cents) },
    frecuencia: [...cat.values()].sort(sortDesc).map(c => ({
      ...c, ambitos: [...(catAmb.get(c.name) ?? new Map<string, number>()).entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n),
    })),
    resumen: { primerFecha, ultimaFecha, diaMax, medioDominante: medios[0] ?? null, monedas: [...monedas].sort() },
    dias, estado, cajas,
  }
}
