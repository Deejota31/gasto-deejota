import { addDays, daysBetween, monthsInRange } from './dates'
import { percent, toBaseCents } from './money'
import { aislaDesde, AISLAMIENTO_DEFECTO, asignarMes, conflictosConfig, fondoMontoMes, ordenFondos, reglaEn, type ResultadoMes } from './presupuesto'
import type { Filters, Fondo, FondoMes, Gasto, ParteManual, ReglaFondo } from './types'

export { aislaDesde, AISLAMIENTO_DEFECTO, fondoMontoMes, ordenFondos }

/**
 * Motor único de agregaciones. Una pasada por los gastos por cada combinación de filtros;
 * KPIs, presupuesto y gráficos salen del mismo resultado, así que siempre cuadran entre sí.
 *
 * Reglas:
 *  - Los anulados no cuentan. Los montos en otra moneda se convierten con el tipo de cambio de Configuración;
 *    si falta, se excluyen y se informa cuántos (no se suman como si fueran PEN).
 *  - KPIs de gasto y gráficos usan todos los filtros. Presupuesto, disponible, consumido y fondos usan solo el
 *    período: un presupuesto no se puede "filtrar" por categoría sin volverse incoherente.
 *  - Presupuesto consolidado P = Σ aportes del período de los fondos ACTIVOS. El reparto de cada gasto entre fondos lo decide
 *    lib/presupuesto.ts (mes a mes); repartir nunca cambia P, el gastado ni el disponible consolidado.
 */

export interface Ctx {
  base: string
  rates: Record<string, number>
  today: string // AAAA-MM-DD en la zona horaria del usuario
  fondos?: Fondo[]
  fondosMeses?: FondoMes[]
  /** Asignaciones manuales (ID de gasto en minúsculas → partes). */
  asignaciones?: Record<string, ParteManual[]>
  /** Mes de corte del aislamiento mensual (ver aislaDesde). Sin valor = comportamiento histórico. */
  aislarDesde?: string
}

export interface Item { name: string; cents: number; count: number }
export interface SubItem extends Item { categoria: string; subcategoria: string; key: string }
/** Subcategoría identificada por ámbito + categoría + subcategoría: "Otros" de dos categorías o ámbitos nunca se mezclan. */
export interface RankSub extends SubItem { ambito: string }
export interface DayPoint { date: string; label: string; diario: number; acumulado: number | null; ideal: number | null; proyeccion: number | null }
export type EstadoFondo = 'inactivo' | 'sin_importe' | 'disponible' | 'cerca' | 'agotado' | 'sobregirado'
export interface FondoResumen {
  fondo: Fondo
  /** Regla vigente al final del período (la que se muestra). */
  regla: ReglaFondo
  /** Importe del período en moneda base (aunque esté inactivo, para mostrar cuánto aportaría). */
  asignado: number
  /** Lo que suma a P: asignado si está activo y tiene tipo de cambio; si no, 0. */
  aporta: number
  /** Importe imputado (partes de gastos que cubre este fondo). */
  gastado: number
  /** Gastos con alguna parte en este fondo (un gasto repartido cuenta en cada fondo que lo cubre). */
  count: number
  disponible: number
  pct: number | null
  sinTipoCambio: boolean
  /** Algún mes del período tiene un importe propio (FONDOS_PRESUPUESTO_MESES). */
  ajustado: boolean
  /** ¿Aplicado al período (importe del mes o fondo de ese mes)? false = solo definición: no suma dinero */
  aplicada: boolean
  /** Parte de gastos de su cobertura que pasó a otro fondo porque este se agotó. */
  enviado: number
  /** Excedentes de otros fondos que recibió. */
  recibido: number
  /** Fondos que recibieron lo que este no pudo cubrir. */
  destinos: string[]
  /** Parte imputada por asignación manual. */
  manual: number
  estado: EstadoFondo
}
/** Fondos con exactamente la misma cobertura: su capacidad se suma (p. ej. dos fondos de Auto). */
export interface GrupoCobertura { clave: string; fondos: FondoResumen[]; asignado: number; gastado: number; enviado: number }
export interface PresupuestoResumen {
  presupuesto: number        // P = Σ aportes de los fondos activos
  gastadoPeriodo: number     // todo lo gastado del período (sin filtros de dimensión), cada movimiento una vez
  disponible: number         // P − gastado
  pct: number | null
  /** Céntimos por encima del presupuesto consolidado (0 si no se excede). */
  exceso: number
  fondos: FondoResumen[]
  total: number              // = presupuesto (compatibilidad de lectura)
  activos: number
  agotados: number
  desbordados: number
  sobregirados: number
  sinFondo: { cents: number; count: number }
  /** Gastos cuyo medio viola una restricción configurada (anteriores a la regla). */
  incompatibles: number
  /** Asignaciones manuales que dejaron de ser válidas. */
  conflictos: number
  grupos: GrupoCobertura[]
  /** Avisos de configuración del último mes del período. */
  avisosConfig: string[]
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
  presupuesto: PresupuestoResumen
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
  let total = 0, count = 0, maxCents = 0, max: Gasto | null = null, excluidos = 0, totalPeriodo = 0
  const meses = monthsInRange(f.desde, f.hasta)
  const delPeriodo: Gasto[] = []

  for (const g of gastos) {
    if (g.estado === 'Anulado' || g.fecha < f.desde || g.fecha > f.hasta) continue
    const cents = toBaseCents(g.monto, g.moneda, ctx.base, ctx.rates)
    if (cents === null) { excluidos++; continue }

    // Presupuesto: solo período (sin filtros de dimensión). El reparto entre fondos se hace después, mes a mes.
    totalPeriodo += cents
    delPeriodo.push(g)

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

  const presupuesto = resumirPresupuesto(delPeriodo, meses, totalPeriodo, ctx)
  const P = presupuesto.presupuesto

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
    dias, estado, presupuesto,
  }
}

/**
 * Presupuesto del período: P (Σ aportes de fondos activos, igual que antes de v1.28) y el reparto de los gastos entre fondos,
 * calculado mes a mes por lib/presupuesto.ts (así un mes nunca depende de los gastos de otro). Repartir no cambia P ni el gastado.
 */
export function resumirPresupuesto(gastos: Gasto[], meses: string[], gastadoPeriodo: number, ctx: Ctx): PresupuestoResumen {
  const fondos = ordenFondos(ctx.fondos ?? [])
  const fMeses = ctx.fondosMeses ?? []
  const reparto: ResultadoMes[] = meses.map(m => asignarMes(m, gastos, fondos, { base: ctx.base, rates: ctx.rates, fondosMeses: fMeses, aislarDesde: ctx.aislarDesde, asignaciones: ctx.asignaciones }))
  const ultimo = meses[meses.length - 1] ?? ''
  const lista: FondoResumen[] = fondos.map(fu => {
    let monto = 0, ajustado = false, aplicada = false, gastado = 0, count = 0, enviado = 0, recibido = 0, manual = 0
    const destinos = new Set<string>()
    for (const m of meses) { const x = fondoMontoMes(fu, m, fMeses, ctx.aislarDesde); monto += x.monto; ajustado ||= x.ajustado; aplicada ||= x.aplicada }
    for (const r of reparto) {
      const c = r.porFondo.get(fu.id)
      if (c) { gastado += c.imputado; count += c.count; enviado += c.enviado; recibido += c.recibido; manual += c.manual; c.destinos.forEach(d => destinos.add(d)) }
    }
    const cents = toBaseCents(monto, fu.moneda, ctx.base, ctx.rates)
    const asignado = cents ?? 0
    const aporta = fu.activo ? asignado : 0
    const pct = percent(gastado, aporta)
    const estado: EstadoFondo = !fu.activo ? 'inactivo' : gastado > aporta ? 'sobregirado' : !aporta ? 'sin_importe' : gastado === aporta ? 'agotado' : (pct ?? 0) >= 90 ? 'cerca' : 'disponible'
    return { fondo: fu, regla: reglaEn(fu, ultimo || ctx.today.slice(0, 7)), asignado, aporta, gastado, count, disponible: aporta - gastado, pct, sinTipoCambio: cents === null && monto > 0, ajustado, aplicada, enviado, recibido, destinos: [...destinos], manual, estado }
  })
  const P = lista.reduce((s, r) => s + r.aporta, 0)
  // Grupos: fondos activos con la misma cobertura y medios (capacidad comparable) y al menos dos integrantes.
  const porClave = new Map<string, FondoResumen[]>()
  for (const r of lista) {
    if (!r.fondo.activo || !r.aplicada || r.regla.cobertura === 'todos') continue
    const k = JSON.stringify([r.regla.cobertura, r.regla.rutas.map(x => [x.ambito, x.categoria, x.subcategoria].map(v => v.trim().toLowerCase()).join('|')).sort(), r.regla.medios, r.regla.listaMedios.map(m => m.trim().toLowerCase()).sort()])
    porClave.set(k, [...(porClave.get(k) ?? []), r])
  }
  const grupos: GrupoCobertura[] = [...porClave.entries()].filter(([, xs]) => xs.length > 1).map(([clave, xs]) => ({
    clave, fondos: xs, asignado: xs.reduce((s, x) => s + x.aporta, 0), gastado: xs.reduce((s, x) => s + x.gastado, 0), enviado: xs.reduce((s, x) => s + x.enviado, 0),
  }))
  return {
    presupuesto: P, gastadoPeriodo, disponible: P - gastadoPeriodo, pct: percent(gastadoPeriodo, P), exceso: Math.max(0, gastadoPeriodo - P),
    fondos: lista, total: P,
    activos: lista.filter(r => r.fondo.activo).length,
    agotados: lista.filter(r => r.estado === 'agotado').length,
    desbordados: lista.filter(r => r.fondo.activo && r.enviado > 0).length,
    sobregirados: lista.filter(r => r.estado === 'sobregirado').length,
    sinFondo: reparto.reduce((s, r) => ({ cents: s.cents + r.sinFondo.cents, count: s.count + r.sinFondo.count }), { cents: 0, count: 0 }),
    incompatibles: reparto.reduce((s, r) => s + r.incompatibles, 0),
    conflictos: reparto.reduce((s, r) => s + r.conflictos, 0),
    grupos,
    avisosConfig: ultimo ? conflictosConfig(fondos, ultimo) : [],
  }
}
