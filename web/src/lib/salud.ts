import { daysInMonth, monthEnd, monthsInRange, shiftMonth } from './dates'
import { cajaMatches, matchesDims, subKey, type Aggregates } from './engine'
import { toBaseCents } from './money'
import { normName } from './orden'
import type { Caja, CatalogoItem, Filters, Gasto, Medio, Plantilla, Revision } from './types'

/**
 * Salud de datos y salud financiera. Todo se calcula en el navegador con los datos ya cargados
 * (sin consultas nuevas a la hoja), en recorridos lineales con Map/Set. Nada de aquí modifica movimientos.
 */

/* ============================== Utilidades ============================== */

/** Texto comparable: sin tildes, minúsculas y espacios simples. */
export const normTexto = (s: string) => normName(s.normalize('NFD').replace(/[̀-ͯ]/g, ''))
const ISO = /^\d{4}-\d{2}-\d{2}$/
export function fechaValida(f: string): boolean {
  if (!ISO.test(f)) return false
  const d = new Date(`${f}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f
}

/* ============================== Catálogo histórico ============================== */

/**
 * Nombres antiguos que siguen siendo una clasificación válida para movimientos históricos.
 * Se reconocen, pero nunca se reemplazan en la hoja. Agrega aquí nuevas equivalencias conocidas.
 */
export const EQUIVALENCIAS: { nivel: 'categoria' | 'subcategoria'; categoria?: string; antiguo: string; actual: string }[] = [
  { nivel: 'subcategoria', categoria: 'Alimentación', antiguo: 'Antojos', actual: 'Snack / Antojos' },
  { nivel: 'subcategoria', categoria: 'Bebé', antiguo: 'Cuidado Darielita', actual: 'Cuidado Infantil' },
  { nivel: 'categoria', antiguo: 'Familia', actual: 'Apoyo Familiar' },
]

interface Indice {
  ambitos: Set<string>
  categorias: Set<string>                 // nombre normalizado (en cualquier ámbito)
  subcategorias: Set<string>
  triples: Map<string, boolean>           // a|c|s → activo
  porSub: Map<string, CatalogoItem[]>     // subcategoría normalizada → filas activas que la tienen
}

const tk = (a: string, c: string, s: string) => `${normTexto(a)}|${normTexto(c)}|${normTexto(s)}`

export function indexarCatalogo(catalogo: CatalogoItem[]): Indice {
  const ix: Indice = { ambitos: new Set(), categorias: new Set(), subcategorias: new Set(), triples: new Map(), porSub: new Map() }
  for (const c of catalogo) {
    if (c.ambito) ix.ambitos.add(normTexto(c.ambito))
    if (c.categoria) ix.categorias.add(normTexto(c.categoria))
    if (c.subcategoria) {
      ix.subcategorias.add(normTexto(c.subcategoria))
      const k = tk(c.ambito, c.categoria, c.subcategoria)
      ix.triples.set(k, (ix.triples.get(k) ?? false) || c.activo)
      if (c.activo) {
        const s = normTexto(c.subcategoria)
        ix.porSub.set(s, [...(ix.porSub.get(s) ?? []), c])
      }
    }
  }
  for (const e of EQUIVALENCIAS) (e.nivel === 'categoria' ? ix.categorias : ix.subcategorias).add(normTexto(e.antiguo))
  return ix
}

export type EstadoClasificacion = 'valida' | 'historica' | 'invalida'
export interface Clasificacion { estado: EstadoClasificacion; motivo?: string; sugerencia?: { ambito: string; categoria: string; subcategoria: string } }

/** Valida ámbito → categoría → subcategoría contra el catálogo. No mira la descripción: no adivina por el texto. */
export function clasificar(g: Pick<Gasto, 'ambito' | 'categoria' | 'subcategoria'>, ix: Indice): Clasificacion {
  const activo = ix.triples.get(tk(g.ambito, g.categoria, g.subcategoria))
  if (activo === true) return { estado: 'valida' }
  if (activo === false) return { estado: 'historica', motivo: 'Opción antigua del catálogo (inactiva): válida para movimientos anteriores.' }
  // Equivalencias conocidas: nombre antiguo → actual.
  let cat = g.categoria, sub = g.subcategoria
  for (const e of EQUIVALENCIAS) {
    if (e.nivel === 'categoria' && normTexto(cat) === normTexto(e.antiguo)) cat = e.actual
    if (e.nivel === 'subcategoria' && normTexto(sub) === normTexto(e.antiguo) && (!e.categoria || normTexto(cat) === normTexto(e.categoria))) sub = e.actual
  }
  if ((cat !== g.categoria || sub !== g.subcategoria) && ix.triples.has(tk(g.ambito, cat, sub))) {
    return { estado: 'historica', motivo: `Nombre anterior de ${cat} › ${sub}.`, sugerencia: { ambito: g.ambito, categoria: cat, subcategoria: sub } }
  }
  // Inválida: sugerir solo si hay una alternativa evidente (la misma subcategoría en el catálogo vigente).
  const cand = ix.porSub.get(normTexto(sub)) ?? []
  const mejor = cand.find(c => normTexto(c.ambito) === normTexto(g.ambito)) ?? cand.find(c => normTexto(c.categoria) === normTexto(cat)) ?? (cand.length === 1 ? cand[0] : undefined)
  const motivo = !ix.ambitos.has(normTexto(g.ambito)) ? `El ámbito “${g.ambito}” no existe en el catálogo.`
    : `“${g.categoria} › ${g.subcategoria || '(sin subcategoría)'}” no pertenece a ${g.ambito}.`
  return { estado: 'invalida', motivo, ...(mejor ? { sugerencia: { ambito: mejor.ambito, categoria: mejor.categoria, subcategoria: mejor.subcategoria } } : {}) }
}

/* ============================== Integridad ============================== */

export type ProblemaIntegridad = 'id' | 'id-repetido' | 'fecha' | 'monto' | 'moneda' | 'ambito' | 'categoria' | 'subcategoria' | 'medio' | 'estado'
export const PROBLEMA_TXT: Record<ProblemaIntegridad, string> = {
  id: 'ID vacío o inválido', 'id-repetido': 'ID repetido', fecha: 'Fecha inválida', monto: 'Monto inválido o ≤ 0',
  moneda: 'Moneda no configurada', ambito: 'Ámbito inexistente', categoria: 'Categoría inexistente', subcategoria: 'Subcategoría inválida',
  medio: 'Medio de pago desconocido', estado: 'Estado inconsistente',
}

export function problemasIntegridad(g: Gasto, ix: Indice, monedas: Set<string>, medios: Set<string>): ProblemaIntegridad[] {
  const out: ProblemaIntegridad[] = []
  if (!g.id || g.problemaId === 'invalido') out.push('id')
  if (g.problemaId === 'duplicado') out.push('id-repetido')
  if (!fechaValida(g.fecha)) out.push('fecha')
  if (!Number.isFinite(g.monto) || g.monto <= 0) out.push('monto')
  if (!monedas.has(g.moneda)) out.push('moneda')
  if (!ix.ambitos.has(normTexto(g.ambito))) out.push('ambito')
  if (!ix.categorias.has(normTexto(g.categoria))) out.push('categoria')
  if (!g.subcategoria || !ix.subcategorias.has(normTexto(g.subcategoria))) out.push('subcategoria')
  if (!medios.has(normTexto(g.medioPago))) out.push('medio')
  if (g.estadoHoja !== undefined) out.push('estado')
  return out   // la descripción vacía no es error: el formulario la permite opcional
}

/* ============================== Consistencia del catálogo ============================== */

export interface ProblemaCatalogo { tipo: 'repetida' | 'sin-ambito' | 'ambito-inactivo' | 'medio-repetido'; texto: string }

export function revisarCatalogo(catalogo: CatalogoItem[], medios: Medio[]): ProblemaCatalogo[] {
  const out: ProblemaCatalogo[] = []
  const vistos = new Map<string, number>()
  const ambitoActivo = new Map<string, boolean>()
  for (const c of catalogo) {
    const k = tk(c.ambito, c.categoria, c.subcategoria)
    vistos.set(k, (vistos.get(k) ?? 0) + 1)
    if (!c.categoria && !c.subcategoria) ambitoActivo.set(normTexto(c.ambito), c.activo)
  }
  const repetidas = new Set<string>()
  for (const c of catalogo) {
    const k = tk(c.ambito, c.categoria, c.subcategoria)
    const label = [c.ambito, c.categoria, c.subcategoria].filter(Boolean).join(' › ')
    if ((vistos.get(k) ?? 0) > 1 && !repetidas.has(k)) { repetidas.add(k); out.push({ tipo: 'repetida', texto: `“${label}” aparece ${vistos.get(k)} veces en el catálogo.` }) }
    if (c.categoria && ambitoActivo.size && !ambitoActivo.has(normTexto(c.ambito))) out.push({ tipo: 'sin-ambito', texto: `“${label}” pertenece a un ámbito que no tiene fila propia.` })
    else if (c.categoria && c.activo && ambitoActivo.get(normTexto(c.ambito)) === false) out.push({ tipo: 'ambito-inactivo', texto: `“${label}” está activa pero su ámbito está inactivo.` })
  }
  const mv = new Map<string, number>()
  for (const m of medios) mv.set(normTexto(m.nombre), (mv.get(normTexto(m.nombre)) ?? 0) + 1)
  for (const [m, n] of mv) if (n > 1) out.push({ tipo: 'medio-repetido', texto: `El medio de pago “${m}” está repetido ${n} veces.` })
  return out
}

/* ============================== Posibles duplicados ============================== */

export interface GrupoSimilar {
  clave: string             // firma: datos que comparten (si uno cambia, el grupo cambia y la alerta se reevalúa)
  ids: string[]             // ordenados, en minúsculas
  gastos: Gasto[]
  revision: Revision | null // decisión vigente (solo si coincide el mismo conjunto y la misma firma)
  estado: 'sin-revisar' | 'pendiente' | 'legitimo' | 'duplicado'
}

/**
 * Agrupa por clave normalizada en una sola pasada (sin comparar todos contra todos).
 * Coincidir NO es un error: tres "Propina Madre" iguales el mismo día pueden ser pagos distintos y legítimos.
 */
export function gruposSimilares(gastos: Gasto[], revisiones: Revision[]): GrupoSimilar[] {
  const grupos = new Map<string, Gasto[]>()
  for (const g of gastos) {
    if (g.estado !== 'Activo' || g.problemaId) continue
    const k = ['dup', g.fecha, Math.round(g.monto * 100), g.moneda, normTexto(g.ambito), normTexto(g.categoria), normTexto(g.subcategoria),
      normTexto(g.descripcion), normTexto(g.medioPago)].join('|')
    const xs = grupos.get(k)
    if (xs) xs.push(g); else grupos.set(k, [g])
  }
  const rev = new Map(revisiones.map(r => [r.ids.join(','), r]))
  const out: GrupoSimilar[] = []
  for (const [clave, gs] of grupos) {
    if (gs.length < 2) continue
    const ids = gs.map(g => g.id.toLowerCase()).sort()
    const r = rev.get(ids.join(','))
    const vigente = r && r.firma === clave ? r : null
    out.push({ clave, ids, gastos: gs, revision: vigente, estado: vigente ? vigente.estado : 'sin-revisar' })
  }
  return out.sort((a, b) => b.gastos[0].fecha.localeCompare(a.gastos[0].fecha) || b.gastos.length - a.gastos.length)
}

/* ============================== Índice de calidad ============================== */

export const PESOS = { integridad: 0.3, clasificacion: 0.3, consistencia: 0.2, duplicados: 0.2 } as const

export interface CalidadDatos {
  evaluados: number
  indice: number | null                 // 0–100; null sin movimientos
  integridad: number | null
  clasificacion: number | null
  consistencia: number
  duplicados: number | null
  conProblemas: { gasto: Gasto; problemas: ProblemaIntegridad[] }[]
  invalidas: { gasto: Gasto; c: Clasificacion }[]
  historicas: { gasto: Gasto; c: Clasificacion }[]
  catalogo: ProblemaCatalogo[]
  similares: GrupoSimilar[]
  pendientes: number                    // alertas que requieren tu revisión
}

const pct100 = (ok: number, total: number) => (total ? Math.round((ok / total) * 1000) / 10 : null)

/**
 * Índice = 30 % integridad + 30 % clasificación + 20 % consistencia del catálogo + 20 % duplicados confirmados.
 * Las coincidencias sin revisar o legítimas no restan: solo restan los duplicados que tú confirmes.
 */
export function evaluarCalidad(p: {
  gastos: Gasto[]; f: Filters; catalogo: CatalogoItem[]; medios: Medio[]; monedas: string[]; revisiones: Revision[]
}): CalidadDatos {
  const ix = indexarCatalogo(p.catalogo)
  const monedas = new Set(p.monedas)
  const medios = new Set(p.medios.map(m => normTexto(m.nombre)))
  // Activos del período y con los filtros; los de fecha inválida siempre (no se pueden ubicar en un período).
  const evaluados = p.gastos.filter(g => g.estado === 'Activo' && (!fechaValida(g.fecha) || (g.fecha >= p.f.desde && g.fecha <= p.f.hasta && matchesDims(g, p.f))))
  const conProblemas: CalidadDatos['conProblemas'] = []
  const invalidas: CalidadDatos['invalidas'] = []
  const historicas: CalidadDatos['historicas'] = []
  for (const g of evaluados) {
    const pr = problemasIntegridad(g, ix, monedas, medios)
    if (pr.length) conProblemas.push({ gasto: g, problemas: pr })
    const c = clasificar(g, ix)
    if (c.estado === 'invalida') invalidas.push({ gasto: g, c })
    else if (c.estado === 'historica') historicas.push({ gasto: g, c })
  }
  const catalogo = revisarCatalogo(p.catalogo, p.medios)
  const similares = gruposSimilares(evaluados, p.revisiones)
  const n = evaluados.length
  const extraConfirmados = similares.filter(s => s.estado === 'duplicado').reduce((acc, s) => acc + s.gastos.length - 1, 0)
  const filasCat = Math.max(1, p.catalogo.length + p.medios.length)
  const integridad = pct100(n - conProblemas.length, n)
  const clasificacion = pct100(n - invalidas.length, n)
  const consistencia = Math.max(0, Math.round((1 - catalogo.length / filasCat) * 1000) / 10)
  const duplicados = pct100(n - extraConfirmados, n)
  const indice = n ? Math.round(PESOS.integridad * integridad! + PESOS.clasificacion * clasificacion! + PESOS.consistencia * consistencia + PESOS.duplicados * duplicados!) : null
  // Un movimiento con varios problemas (p. ej. subcategoría inexistente = integridad y clasificación) cuenta una vez.
  const conAlerta = new Set([...conProblemas.map(x => x.gasto), ...invalidas.map(x => x.gasto)])
  const pendientes = conAlerta.size + catalogo.length + similares.filter(s => s.estado === 'sin-revisar' || s.estado === 'pendiente').length
  return { evaluados: n, indice, integridad, clasificacion, consistencia, duplicados, conProblemas, invalidas, historicas, catalogo, similares, pendientes }
}

/* ============================== Compromisos mensuales ============================== */

export interface CompromisoItem {
  plantilla: Plantilla
  previsto: number | null     // céntimos en moneda base para todo el rango (null = sin monto o sin tipo de cambio)
  cubierto: number            // pagos vinculados y activos dentro del rango
  aplicado: number            // parte de lo cubierto que cuenta para lo previsto (un pago de más no cubre otros meses)
  pendiente: number
  pagos: Gasto[]
  cubiertoCompleto: boolean
  meses: number
}

export interface Compromisos {
  meses: string[]
  items: CompromisoItem[]
  previsto: number
  cubierto: number           // solo lo que cubre lo previsto (un pago de más no "cubre" otros compromisos)
  pendiente: number
  n: number
  nCubiertos: number
  nPendientes: number
  sinMonto: number
}

/**
 * Compromisos = plantillas marcadas como compromiso. Por cada mes del rango: previsto = monto de la plantilla;
 * cubierto = suma de gastos ACTIVOS vinculados a esa plantilla con fecha en ese mes (pagos parciales se suman);
 * pendiente = max(0, previsto − cubierto). La fecha real del movimiento manda: no hay "período correspondiente".
 * Un gasto anulado deja de cubrir; al restaurarlo vuelve a cubrir. Clonar o editar no crea vínculos.
 */
export function calcularCompromisos(p: {
  gastos: Gasto[]; plantillas: Plantilla[]; vinculos: Map<string, string>; desde: string; hasta: string; base: string; rates: Record<string, number>
}): Compromisos {
  const meses = monthsInRange(p.desde, p.hasta)
  const comp = p.plantillas.filter(x => x.esCompromiso)
  const ids = new Set(comp.map(x => x.id))
  // Pagos por plantilla y mes, en una pasada.
  const pagos = new Map<string, Gasto[]>()
  const porMes = new Map<string, number>()
  for (const g of p.gastos) {
    const pl = p.vinculos.get(g.id.toLowerCase())
    if (!pl || !ids.has(pl) || g.estado !== 'Activo' || g.fecha < p.desde || g.fecha > p.hasta) continue
    const c = toBaseCents(g.monto, g.moneda, p.base, p.rates)
    if (c === null) continue
    pagos.set(pl, [...(pagos.get(pl) ?? []), g])
    const k = `${pl}|${g.fecha.slice(0, 7)}`
    porMes.set(k, (porMes.get(k) ?? 0) + c)
  }
  const items: CompromisoItem[] = comp.map(pl => {
    const unidad = pl.monto === null ? null : toBaseCents(pl.monto, pl.moneda || p.base, p.base, p.rates)
    let cubierto = 0, pendiente = 0, cubiertoUtil = 0
    for (const m of meses) {
      const c = porMes.get(`${pl.id}|${m}`) ?? 0
      cubierto += c
      if (unidad !== null) { pendiente += Math.max(0, unidad - c); cubiertoUtil += Math.min(unidad, c) }
    }
    return { plantilla: pl, previsto: unidad === null ? null : unidad * meses.length, cubierto, aplicado: cubiertoUtil, pendiente, pagos: pagos.get(pl.id) ?? [],
      cubiertoCompleto: unidad !== null && pendiente === 0, meses: meses.length }
  })
  const conMonto = items.filter(i => i.previsto !== null)
  return {
    meses, items,
    previsto: conMonto.reduce((s, i) => s + i.previsto!, 0),
    cubierto: conMonto.reduce((s, i) => s + i.aplicado, 0),
    pendiente: conMonto.reduce((s, i) => s + i.pendiente, 0),
    n: items.length,
    nCubiertos: conMonto.filter(i => i.cubiertoCompleto).length,
    nPendientes: conMonto.filter(i => !i.cubiertoCompleto).length,
    sinMonto: items.length - conMonto.length,
  }
}

/* ============================== Mi presupuesto ============================== */

export type NivelPresupuesto = 'sin-presupuesto' | 'ok' | 'atencion' | 'cerca' | 'excedido'
export function nivelPresupuesto(pct: number | null): NivelPresupuesto {
  if (pct === null) return 'sin-presupuesto'
  return pct >= 100 ? 'excedido' : pct >= 90 ? 'cerca' : pct >= 70 ? 'atencion' : 'ok'
}

export interface MiPresupuesto {
  presupuesto: number
  gastado: number
  pendiente: number
  disponible: number                 // presupuesto − gastado
  disponibleTrasCompromisos: number  // presupuesto − gastado − compromisos pendientes
  pctUsado: number | null
  pctComprometido: number | null     // compromisos pendientes / presupuesto
  nivel: NivelPresupuesto
  cajas: { caja: Caja; asignado: number; gastado: number; pendiente: number; disponibleTrasCompromisos: number; pct: number | null; nivel: NivelPresupuesto }[]
}

const pct1 = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)

/**
 * Reutiliza el resultado del motor (caja general y subcajas, con ajustes mensuales). Un pago de compromiso
 * sube "gastado" y baja "pendiente" en lo mismo: el disponible tras compromisos no se descuenta dos veces.
 * Las subcajas son reservas dentro del presupuesto general: no se suman a él.
 */
export function calcularPresupuesto(a: Aggregates, comp: Compromisos): MiPresupuesto {
  const P = a.cajas.presupuesto
  const gastado = a.totalPeriodo
  const pendiente = comp.pendiente
  const pctUsado = pct1(gastado, P)
  // Igual que el motor: cada compromiso se imputa solo a la PRIMERA subcaja que coincide (sin contarlo dos veces).
  const subs = a.cajas.subcajas.map(s => s.caja)
  const cajaDe = new Map(comp.items.map(i => [i.plantilla.id, subs.find(c => cajaMatches(c, i.plantilla as unknown as Gasto))?.id]))
  const cajas = a.cajas.subcajas.map(s => {
    const pend = comp.items.filter(i => cajaDe.get(i.plantilla.id) === s.caja.id).reduce((x, i) => x + i.pendiente, 0)
    const pct = pct1(s.gastado, s.asignado)
    return { caja: s.caja, asignado: s.asignado, gastado: s.gastado, pendiente: pend, disponibleTrasCompromisos: s.asignado - s.gastado - pend, pct, nivel: nivelPresupuesto(s.asignado ? pct : null) }
  })
  return {
    presupuesto: P, gastado, pendiente, disponible: P - gastado, disponibleTrasCompromisos: P - gastado - pendiente,
    pctUsado, pctComprometido: pct1(pendiente, P), nivel: nivelPresupuesto(P ? pctUsado : null), cajas,
  }
}

/* ============================== Evolución ============================== */

export interface Rango { desde: string; hasta: string }
export type NivelComparacion = 'ambito' | 'categoria' | 'subcategoria'

/** Mes en curso hasta hoy contra los mismos días del mes anterior (si el anterior es más corto, hasta su último día). */
export function periodosEquivalentes(mes: string, today: string): { actual: Rango; anterior: Rango; parcial: boolean } {
  const prev = shiftMonth(mes, -1)
  const enCurso = today.slice(0, 7) === mes
  const dia = enCurso ? Number(today.slice(8, 10)) : daysInMonth(mes)
  const diaPrev = enCurso ? Math.min(dia, daysInMonth(prev)) : daysInMonth(prev)
  return {
    actual: { desde: `${mes}-01`, hasta: enCurso ? today : monthEnd(mes) },
    anterior: { desde: `${prev}-01`, hasta: `${prev}-${String(diaPrev).padStart(2, '0')}` },
    parcial: enCurso,
  }
}

/** Dos meses completos; si uno es el mes en curso, ambos se recortan al mismo número de días (comparación justa). */
export function periodosMeses(a: string, b: string, today: string): { actual: Rango; anterior: Rango; parcial: boolean } {
  const enCurso = [a, b].includes(today.slice(0, 7))
  if (!enCurso) return { actual: { desde: `${a}-01`, hasta: monthEnd(a) }, anterior: { desde: `${b}-01`, hasta: monthEnd(b) }, parcial: false }
  const dia = Number(today.slice(8, 10))
  const corte = (m: string) => `${m}-${String(Math.min(dia, daysInMonth(m))).padStart(2, '0')}`
  return { actual: { desde: `${a}-01`, hasta: corte(a) }, anterior: { desde: `${b}-01`, hasta: corte(b) }, parcial: true }
}

export interface FilaEvolucion {
  key: string; nombre: string; detalle?: string
  actual: number; anterior: number; nActual: number; nAnterior: number
  diferencia: number; variacion: number | null   // null = sin base de comparación (anterior en 0)
  promedioActual: number; promedioAnterior: number
}
export interface Evolucion {
  filas: FilaEvolucion[]
  aumentaron: FilaEvolucion[]
  disminuyeron: FilaEvolucion[]
  nuevos: FilaEvolucion[]
  totalActual: number; totalAnterior: number; nActual: number; nAnterior: number
  hayHistorial: boolean
}

export function compararPeriodos(p: {
  gastos: Gasto[]; f: Filters; actual: Rango; anterior: Rango; nivel: NivelComparacion; base: string; rates: Record<string, number>
}): Evolucion {
  const m = new Map<string, FilaEvolucion>()
  let totalActual = 0, totalAnterior = 0, nActual = 0, nAnterior = 0
  for (const g of p.gastos) {
    if (g.estado !== 'Activo' || !matchesDims(g, p.f)) continue
    const enA = g.fecha >= p.actual.desde && g.fecha <= p.actual.hasta
    const enB = g.fecha >= p.anterior.desde && g.fecha <= p.anterior.hasta
    if (!enA && !enB) continue
    const c = toBaseCents(g.monto, g.moneda, p.base, p.rates)
    if (c === null) continue
    const key = p.nivel === 'ambito' ? g.ambito : p.nivel === 'categoria' ? g.categoria : subKey(g.categoria, g.subcategoria)
    let r = m.get(key)
    if (!r) {
      r = { key, nombre: p.nivel === 'subcategoria' ? (g.subcategoria || 'Sin subcategoría') : key, detalle: p.nivel === 'subcategoria' ? g.categoria : undefined,
        actual: 0, anterior: 0, nActual: 0, nAnterior: 0, diferencia: 0, variacion: null, promedioActual: 0, promedioAnterior: 0 }
      m.set(key, r)
    }
    if (enA) { r.actual += c; r.nActual++; totalActual += c; nActual++ }
    if (enB) { r.anterior += c; r.nAnterior++; totalAnterior += c; nAnterior++ }
  }
  const filas = [...m.values()].map(r => ({
    ...r, diferencia: r.actual - r.anterior,
    variacion: r.anterior > 0 ? Math.round(((r.actual - r.anterior) / r.anterior) * 1000) / 10 : null,
    promedioActual: r.nActual ? Math.round(r.actual / r.nActual) : 0, promedioAnterior: r.nAnterior ? Math.round(r.anterior / r.nAnterior) : 0,
  })).sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia) || a.nombre.localeCompare(b.nombre))
  return {
    filas,
    aumentaron: filas.filter(r => r.anterior > 0 && r.diferencia > 0).sort((a, b) => b.diferencia - a.diferencia),
    disminuyeron: filas.filter(r => r.anterior > 0 && r.diferencia < 0).sort((a, b) => a.diferencia - b.diferencia),
    nuevos: filas.filter(r => r.anterior === 0 && r.actual > 0).sort((a, b) => b.actual - a.actual),
    totalActual, totalAnterior, nActual, nAnterior,
    hayHistorial: nAnterior > 0,
  }
}

/* ============================== Oportunidades de ahorro ============================== */

const ESENCIALES_CAT = new Set(['bebe', 'salud', 'salud familiar', 'servicios', 'educacion', 'apoyo familiar', 'hogar'].map(normTexto))
const ESENCIALES_SUB = new Set(['medicamentos', 'consultas medicas', 'examenes medicos', 'leche', 'panales', 'emergencias'].map(normTexto))
const DISCRECIONAL_SUB = new Set(['delivery', 'snack / antojos', 'antojos'].map(normTexto))
const DISCRECIONAL_CAT = new Set(['suscripciones', 'salidas'].map(normTexto))
const COMPRAS_NO_ESENCIALES = new Set(['tecnologia', 'perfumes', 'accesorios', 'ropa', 'calzado', 'regalos'].map(normTexto))

/** Gasto discrecional: delivery, antojos, suscripciones, salidas y compras no esenciales. Lo esencial nunca entra. */
export function esDiscrecional(g: Pick<Gasto, 'categoria' | 'subcategoria'>): boolean {
  const c = normTexto(g.categoria), s = normTexto(g.subcategoria)
  if (ESENCIALES_CAT.has(c) || ESENCIALES_SUB.has(s)) return false
  return DISCRECIONAL_SUB.has(s) || DISCRECIONAL_CAT.has(c) || (c === 'compras' && COMPRAS_NO_ESENCIALES.has(s))
}

export interface Oportunidad { key: string; nombre: string; categoria: string; cents: number; count: number; ahorro: number; variacion: number | null }

export const REDUCCION_SIMULADA = 0.15
const MINIMO_RELEVANTE = 2000 // S/ 20: por debajo no vale la pena sugerir nada

/** Simulación: cuánto ahorrarías reduciendo un 15 % cada gasto discrecional del período (con datos reales, no supuestos). */
export function oportunidadesAhorro(p: { gastos: Gasto[]; f: Filters; rango: Rango; evolucion?: Evolucion; base: string; rates: Record<string, number> }): Oportunidad[] {
  const m = new Map<string, Oportunidad>()
  for (const g of p.gastos) {
    if (g.estado !== 'Activo' || g.fecha < p.rango.desde || g.fecha > p.rango.hasta || !matchesDims(g, p.f) || !esDiscrecional(g)) continue
    const c = toBaseCents(g.monto, g.moneda, p.base, p.rates)
    if (c === null) continue
    const key = subKey(g.categoria, g.subcategoria)
    const o = m.get(key) ?? { key, nombre: g.subcategoria || g.categoria, categoria: g.categoria, cents: 0, count: 0, ahorro: 0, variacion: null }
    o.cents += c; o.count++
    m.set(key, o)
  }
  const varPorKey = new Map((p.evolucion?.filas ?? []).map(r => [r.key, r.variacion]))
  return [...m.values()].filter(o => o.cents >= MINIMO_RELEVANTE)
    .map(o => ({ ...o, ahorro: Math.round(o.cents * REDUCCION_SIMULADA), variacion: varPorKey.get(o.key) ?? null }))
    .sort((a, b) => b.cents - a.cents).slice(0, 5)
}
