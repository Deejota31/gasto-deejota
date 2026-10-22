import { mediosDeFondo } from './fondoMedios'
import { toBaseCents } from './money'
import type { Fondo, FondoMes, Gasto, ModoMedios, ParteManual, ReglaFondo, Ruta, TipoCobertura } from './types'

/**
 * Motor de Presupuestos (v1.28): ÚNICA especificación de cómo se reparten los gastos entre los fondos del presupuesto.
 * La usan el Dashboard, Presupuestos, Gastos, Salud financiera y el modo demo; el backend (Code.gs) replica solo la
 * validación de medios restringidos y de asignaciones manuales, y las pruebas de paridad comprueban que digan lo mismo.
 *
 * Nada se decide por nombre (ni "Sodexo", ni "Alimentación", ni "General"): todo sale de las reglas de cada fondo.
 *
 * Reglas del reparto, por mes y en orden estable (fecha, creación, ID):
 *  1. Las asignaciones manuales válidas se aplican primero, tal cual (pueden dejar un fondo en negativo).
 *  2. Los demás gastos buscan sus fondos ELEGIBLES: activos y aplicados en ese mes, que cubren su clasificación y aceptan su medio.
 *  3. Prioridad: fondo dedicado al medio del gasto (modo "solo") > más específico (subcategoría > categoría > ámbito > todos) >
 *     orden manual > ID. Así un fondo general nunca consume antes que uno específico aunque esté primero en la lista.
 *  4. Se consume lo disponible de cada fondo en ese orden (varios fondos de la misma cobertura suman capacidad).
 *  5. Lo que sobra va como sobregiro al respaldo: el primer fondo elegible que cubre todos los gastos y no está dedicado al medio
 *     (normalmente "General"); si no hay respaldo compatible, al fondo elegible más prioritario. Nunca se pierde un centavo.
 *  6. Sin ningún fondo elegible, el gasto queda "sin fondo asignable": sigue contando en el gasto del período.
 * Invariante (tolerancia cero): por gasto, Σ partes + sin fondo = importe del gasto en céntimos de la moneda base.
 */

/**
 * Mes desde el cual fondos NO se trasladan solos de un mes a otro (v1.19). Antes de ese mes se conserva el comportamiento histórico
 * (así los meses ya vividos no cambian ni un centavo); desde ese mes cuenta solo lo aplicado explícitamente (FONDOS_PRESUPUESTO_MESES
 * modo 'solo'). Configurable en CONFIG → aislamiento_desde ('9999-12' = apagado).
 */
export const AISLAMIENTO_DEFECTO = '2026-11'
export const aislaDesde = (config?: Record<string, string>): string => /^\d{4}-\d{2}$/.test(config?.aislamiento_desde ?? '') ? config!.aislamiento_desde : AISLAMIENTO_DEFECTO

/**
 * Importe de un fondo para un mes, en su moneda: un importe "solo ese mes" manda; si no, el último "desde" vigente
 * (solo fondos mensuales); si no, el importe habitual (mensual: desde su mes de aplicación; única: solo en su mes).
 */
export function fondoMontoMes(f: Pick<Fondo, 'id' | 'monto' | 'recurrencia' | 'mes'>, mes: string, meses: FondoMes[], aislar?: string): { monto: number; ajustado: boolean; aplicada: boolean } {
  let solo: FondoMes | undefined, desde: FondoMes | undefined
  if (aislar && mes >= aislar) {
    // Aislamiento mensual: solo cuenta lo aplicado a ESE mes (importe "solo ese mes") o un fondo de un único mes.
    const s = meses.find(m => m.fondoId === f.id && m.modo === 'solo' && m.mes === mes)
    if (s) return { monto: s.monto, ajustado: true, aplicada: true }
    const propia = f.recurrencia === 'unica' && mes === f.mes
    return { monto: propia ? f.monto : 0, ajustado: false, aplicada: propia }
  }
  for (const m of meses) {
    if (m.fondoId !== f.id) continue
    if (m.modo === 'solo' && m.mes === mes) solo = m
    else if (m.modo === 'desde' && m.mes <= mes && (!desde || m.mes > desde.mes)) desde = m
  }
  if (solo) return { monto: solo.monto, ajustado: true, aplicada: true }
  if (f.recurrencia === 'unica') return { monto: mes === f.mes ? f.monto : 0, ajustado: false, aplicada: true }
  if (desde) return { monto: desde.monto, ajustado: true, aplicada: true }
  return { monto: !f.mes || mes >= f.mes ? f.monto : 0, ajustado: false, aplicada: true }
}

export const ordenFondos = <T extends Pick<Fondo, 'orden' | 'nombre'>>(fs: T[]) => [...fs].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))

export const nrm = (s: string) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

export const REGLA_LIBRE: ReglaFondo = { desde: '', medios: 'todos', listaMedios: [], cobertura: 'todos', rutas: [], restringeMedio: false }

/**
 * Reglas de un fondo guardado antes de v1.28 (solo tenía "Medio de pago"): con medios → solo esos medios; sin medios → todos.
 * Cubren todos los gastos y no restringen nada: es exactamente el comportamiento anterior. Nunca se deduce una categoría del nombre.
 */
export function reglasLegado(medioPago: string): ReglaFondo[] {
  const lista = mediosDeFondo(medioPago)
  return [{ ...REGLA_LIBRE, medios: lista.length ? 'solo' : 'todos', listaMedios: lista }]
}

/** Versión de reglas vigente en un mes: la última con `desde` ≤ mes; antes de la primera, la primera (más antigua). */
export function reglaEn(f: Pick<Fondo, 'reglas' | 'medioPago'>, mes: string): ReglaFondo {
  const vs = f.reglas?.length ? f.reglas : reglasLegado(f.medioPago)
  let r = vs[0]
  for (const v of vs) if (!v.desde || v.desde <= mes) r = v
  return r
}
/** Regla más reciente (la que se edita en el formulario). */
export const reglaActual = (f: Pick<Fondo, 'reglas' | 'medioPago'>) => (f.reglas?.length ? f.reglas[f.reglas.length - 1] : reglasLegado(f.medioPago)[0])

/** Inserta una versión desde `mes` (reemplaza la de ese mismo mes); las anteriores no cambian. Primera versión = desde siempre. */
export function versionarReglas(prev: ReglaFondo[], nueva: Omit<ReglaFondo, 'desde'>, mes: string): ReglaFondo[] {
  if (!prev.length) return [{ ...nueva, desde: '' }]
  const iguales = (a: Omit<ReglaFondo, 'desde'>, b: Omit<ReglaFondo, 'desde'>) => JSON.stringify(normalizarRegla({ ...a, desde: '' })) === JSON.stringify(normalizarRegla({ ...b, desde: '' }))
  const vigente = prev.reduce((r, v) => (!v.desde || v.desde <= mes ? v : r), prev[0])
  if (iguales(vigente, nueva) && !prev.some(v => v.desde > mes)) return prev
  const base = prev.filter(v => v.desde !== mes && !(v.desde > mes))
  // Las versiones futuras (desde > mes) se descartan: una edición "desde este mes" manda hacia adelante.
  return [...base, { ...nueva, desde: base.length ? mes : '' }].sort((a, b) => a.desde.localeCompare(b.desde))
}

export function normalizarRegla(r: ReglaFondo): ReglaFondo {
  const lista = [...new Map(r.listaMedios.map(m => [nrm(m), m.trim()])).values()].filter(Boolean)
  const rutas = r.cobertura === 'todos' ? [] : [...new Map(r.rutas.map(x => {
    const ru = { ambito: x.ambito.trim(), categoria: x.categoria.trim(), subcategoria: x.categoria.trim() ? x.subcategoria.trim() : '' }
    return [`${nrm(ru.ambito)}|${nrm(ru.categoria)}|${nrm(ru.subcategoria)}`, ru] as const
  })).values()]
  return { desde: r.desde, medios: r.medios === 'todos' ? 'todos' : r.medios, listaMedios: r.medios === 'todos' ? [] : lista, cobertura: r.cobertura, rutas, restringeMedio: r.restringeMedio && r.medios === 'solo' }
}

/* ---------------------------------- Medios y cobertura ---------------------------------- */

export function medioPermitido(r: ReglaFondo, medio: string): boolean {
  if (r.medios === 'todos') return true
  const esta = r.listaMedios.some(m => nrm(m) === nrm(medio))
  return r.medios === 'solo' ? esta : !esta
}
/** El fondo eligió este medio expresamente (modo "solo"): tiene prioridad sobre los fondos que solo lo aceptan. */
export const medioDedicado = (r: ReglaFondo, medio: string) => r.medios === 'solo' && r.listaMedios.some(m => nrm(m) === nrm(medio))

export const especificidadRuta = (ru: Ruta) => (ru.subcategoria ? 3 : ru.categoria ? 2 : ru.ambito ? 1 : 0)
type Clasif = Pick<Gasto, 'ambito' | 'categoria' | 'subcategoria'>
export const coincideRuta = (ru: Ruta, g: Clasif) =>
  (!ru.ambito || nrm(ru.ambito) === nrm(g.ambito)) && (!ru.categoria || nrm(ru.categoria) === nrm(g.categoria)) && (!ru.subcategoria || nrm(ru.subcategoria) === nrm(g.subcategoria))

/** Especificidad con que el fondo cubre el gasto (0 = cubre todo) o null si no lo cubre. */
export function cobertura(r: ReglaFondo, g: Clasif): number | null {
  if (r.cobertura === 'todos') return 0
  let mejor: number | null = null
  for (const ru of r.rutas) if (coincideRuta(ru, g)) mejor = Math.max(mejor ?? -1, especificidadRuta(ru))
  return mejor
}

/** ¿El fondo rige en ese mes según su recurrencia? (configuración; el dinero del mes lo decide fondoMontoMes). */
export const vigenteEnMes = (f: Pick<Fondo, 'recurrencia' | 'mes'>, mes: string) => (f.recurrencia === 'unica' ? mes === f.mes : !f.mes || mes >= f.mes)

/* ---------------------------------- Validaciones ---------------------------------- */

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const TIPOS_COBERTURA: TipoCobertura[] = ['todos', 'ambito', 'categoria', 'subcategoria', 'personalizada']
export const MODOS_MEDIOS: ModoMedios[] = ['todos', 'excepto', 'solo']

/** Error de una regla (mismo criterio que validarReglas_ en Code.gs) o null si es válida. */
export function validarRegla(r: ReglaFondo): string | null {
  if (r.desde && !MES_RE.test(r.desde)) return 'Mes de vigencia de las reglas inválido.'
  if (!MODOS_MEDIOS.includes(r.medios)) return 'Modo de medios inválido.'
  if (!TIPOS_COBERTURA.includes(r.cobertura)) return 'Tipo de cobertura inválido.'
  if (r.medios !== 'todos' && !r.listaMedios.length) return r.medios === 'solo' ? 'Elige al menos un medio de pago.' : 'Elige al menos un medio a excluir.'
  if (r.listaMedios.length > 20 || r.listaMedios.some(m => !m.trim() || m.length > 40 || m.includes('|'))) return 'Medios de pago inválidos.'
  if (r.cobertura === 'todos' && r.rutas.length) return 'Un fondo que cubre todos los gastos no lleva rutas.'
  if (r.cobertura !== 'todos' && !r.rutas.length) return 'Elige qué gastos cubre el fondo.'
  if (r.rutas.length > 60) return 'Demasiadas rutas de cobertura (máximo 60).'
  for (const ru of r.rutas) {
    if ([ru.ambito, ru.categoria, ru.subcategoria].some(x => x.length > 60)) return 'Ruta de cobertura demasiado larga.'
    if (ru.subcategoria && !ru.categoria) return 'Una subcategoría necesita su categoría.'
    if (!ru.ambito && !ru.categoria) return 'Cada ruta necesita al menos un ámbito o una categoría.'
    if (r.cobertura === 'ambito' && (!ru.ambito || ru.categoria)) return 'La cobertura por ámbito solo lleva ámbitos.'
    if (r.cobertura === 'categoria' && (!ru.categoria || ru.subcategoria)) return 'La cobertura por categoría lleva categorías (sin subcategoría).'
    if (r.cobertura === 'subcategoria' && !ru.subcategoria) return 'La cobertura por subcategoría lleva subcategorías.'
  }
  if (r.restringeMedio && r.medios !== 'solo') return 'Solo se puede restringir el uso de medios elegidos con “Solo seleccionados”.'
  if (r.restringeMedio && r.cobertura === 'todos') return 'Restringir el medio a “todos los gastos” no restringe nada: elige una cobertura.'
  return null
}

export type ResultadoMedio = { ok: true } | { ok: false; medio: string; fondos: string[]; mensaje: string }
export const mensajeMedioRestringido = (medio: string) => `El medio ${medio} no está permitido para esta categoría según la configuración de tus presupuestos.`

/**
 * ¿El medio del gasto viola una restricción configurada? Fondos que restringen ese medio = activos, vigentes en el mes y con
 * `restringeMedio` + medio en su lista. Si hay alguno, el gasto debe caer en la cobertura de AL MENOS uno (unión). Determinista:
 * un fondo que solo "acepta" el medio (General con todos los medios) nunca anula una restricción.
 */
export function validarMedioGasto(g: Clasif & Pick<Gasto, 'medioPago' | 'fecha'>, fondos: Fondo[]): ResultadoMedio {
  const mes = g.fecha.slice(0, 7)
  const restrictivos = fondos.filter(f => f.activo && vigenteEnMes(f, mes)).map(f => ({ f, r: reglaEn(f, mes) }))
    .filter(({ r }) => r.restringeMedio && medioDedicado(r, g.medioPago))
  if (!restrictivos.length || restrictivos.some(({ r }) => cobertura(r, g) !== null)) return { ok: true }
  return { ok: false, medio: g.medioPago, fondos: restrictivos.map(x => x.f.nombre), mensaje: mensajeMedioRestringido(g.medioPago) }
}

/**
 * Avisos de configuración del mes (no bloquean): reglas inválidas y fondos que aceptan un medio para gastos que la restricción
 * de otro fondo nunca permitirá (esa parte de su cobertura no recibirá gastos de ese medio).
 */
export function conflictosConfig(fondos: Fondo[], mes: string): string[] {
  const out: string[] = []
  const vig = fondos.filter(f => f.activo && vigenteEnMes(f, mes)).map(f => ({ f, r: reglaEn(f, mes) }))
  for (const { f, r } of vig) { const e = validarRegla(r); if (e) out.push(`${f.nombre}: ${e}`) }
  const restr = vig.filter(x => x.r.restringeMedio)
  for (const { f, r } of vig) {
    if (r.restringeMedio || r.medios !== 'solo') continue
    for (const m of r.listaMedios) {
      const rs = restr.filter(x => medioDedicado(x.r, m))
      if (!rs.length) continue
      const rutasF = r.cobertura === 'todos' ? [{ ambito: '', categoria: '', subcategoria: '' }] : r.rutas
      const fuera = rutasF.filter(ru => !rs.some(x => x.r.rutas.some(q => contieneRuta(q, ru) || contieneRuta(ru, q))))
      if (fuera.length) out.push(`${f.nombre} acepta ${m} en gastos que ${rs.map(x => x.f.nombre).join(' y ')} no permite${rs.length > 1 ? 'n' : ''} con ese medio: esos gastos no se podrán registrar con ${m}.`)
    }
  }
  return out
}
/** ¿La ruta `a` contiene a `b`? (a es igual o más general). */
const contieneRuta = (a: Ruta, b: Ruta) => (!a.ambito || nrm(a.ambito) === nrm(b.ambito)) && (!a.categoria || nrm(a.categoria) === nrm(b.categoria)) && (!a.subcategoria || nrm(a.subcategoria) === nrm(b.subcategoria))

/* ---------------------------------- Reparto ---------------------------------- */

export type TipoParte = 'manual' | 'automatica' | 'desborde' | 'sobregiro'
export interface ParteImputacion { fondoId: string; cents: number; tipo: TipoParte }
export interface Imputacion {
  gastoId: string
  /** Importe del gasto en céntimos de la moneda base. Σ partes + sinFondo = total, siempre. */
  total: number
  partes: ParteImputacion[]
  sinFondo: number
  /** Lo que se fue fuera del nivel de fondos que le correspondía (p. ej. Auto agotado → General). */
  excedente: number
  /** Fondos del nivel principal (los que debían cubrirlo) y fondos que recibieron el excedente. */
  origen: string[]
  destino: string[]
  manual: boolean
  /** La asignación manual guardada ya no es válida (cambió una regla o el gasto): se usó la automática y se avisa. */
  conflicto?: string
  /** El medio del gasto viola una restricción configurada (gasto anterior a la regla): queda sin fondo asignable. */
  incompatible?: boolean
}
export interface CuentaFondo { cupo: number; imputado: number; count: number; enviado: number; recibido: number; manual: number; /** Fondos que recibieron su desborde. */ destinos: string[] }
export interface ResultadoMes {
  mes: string
  porFondo: Map<string, CuentaFondo>
  porGasto: Map<string, Imputacion>
  sinFondo: { cents: number; count: number }
  conflictos: number
  incompatibles: number
}
export interface CtxReparto {
  base: string
  rates: Record<string, number>
  fondosMeses: FondoMes[]
  aislarDesde?: string
  /** ID de gasto en minúsculas → partes manuales. */
  asignaciones?: Record<string, ParteManual[]>
}

interface Elegible { f: Fondo; r: ReglaFondo; dedicado: boolean; esp: number; respaldo: boolean }

/** Fondos que pueden recibir el gasto, en el orden en que lo consumen. */
export function elegibles(g: Clasif & Pick<Gasto, 'medioPago'>, mes: string, fondos: Fondo[], activoMes: (f: Fondo) => boolean): Elegible[] {
  const out: Elegible[] = []
  for (const f of fondos) {
    if (!activoMes(f)) continue
    const r = reglaEn(f, mes)
    if (!medioPermitido(r, g.medioPago)) continue
    const esp = cobertura(r, g)
    if (esp === null) continue
    const dedicado = medioDedicado(r, g.medioPago)
    out.push({ f, r, dedicado, esp, respaldo: r.cobertura === 'todos' && !dedicado })
  }
  return out.sort((a, b) => Number(b.dedicado) - Number(a.dedicado) || b.esp - a.esp || a.f.orden - b.f.orden || a.f.id.localeCompare(b.f.id))
}

/** ¿El fondo participa en el reparto de ese mes? Activo y, desde el corte de aislamiento, aplicado a ese mes; antes, vigente. */
export function activoEnMes(f: Fondo, mes: string, ctx: Pick<CtxReparto, 'fondosMeses' | 'aislarDesde'>): boolean {
  if (!f.activo) return false
  if (ctx.aislarDesde && mes >= ctx.aislarDesde) return fondoMontoMes(f, mes, ctx.fondosMeses, ctx.aislarDesde).aplicada
  return vigenteEnMes(f, mes)
}

/** Reparte en partes enteras de céntimos proporcionales a `pesos`; el último absorbe el redondeo (suma exacta). */
function repartir(total: number, pesos: number[]): number[] {
  const suma = pesos.reduce((s, x) => s + x, 0)
  let acum = 0
  return pesos.map((p, i) => {
    if (i === pesos.length - 1) return total - acum
    const v = suma ? Math.round((total * p) / suma) : 0
    acum += v
    return v
  })
}

/** Error de una asignación manual para ese gasto (mismo criterio que validarAsignacion_ en Code.gs) o null si es válida. */
export function validarAsignacion(g: Gasto, partes: ParteManual[], fondos: Fondo[], ctx: Pick<CtxReparto, 'fondosMeses' | 'aislarDesde'>): string | null {
  if (!partes.length) return null
  if (partes.length > 10) return 'Una asignación manual admite hasta 10 fondos.'
  const mes = g.fecha.slice(0, 7)
  const vistos = new Set<string>()
  let suma = 0
  for (const p of partes) {
    if (vistos.has(p.fondoId)) return 'Un fondo aparece dos veces en la asignación.'
    vistos.add(p.fondoId)
    if (!(p.monto > 0) || Math.abs(Math.round(p.monto * 100) - p.monto * 100) > 1e-6) return 'Cada importe debe ser mayor que 0, con hasta 2 decimales.'
    suma += Math.round(p.monto * 100)
    const f = fondos.find(x => x.id === p.fondoId)
    if (!f) return 'Uno de los fondos ya no existe.'
    if (!activoEnMes(f, mes, ctx)) return `${f.nombre} no está activo ni aplicado en ese mes.`
    const r = reglaEn(f, mes)
    if (!medioPermitido(r, g.medioPago)) return `${f.nombre} no acepta el medio ${g.medioPago}.`
    if (cobertura(r, g) === null) return `${f.nombre} no cubre ${g.categoria}${g.subcategoria ? ` › ${g.subcategoria}` : ''}.`
  }
  if (suma !== Math.round(g.monto * 100)) return `La asignación suma ${(suma / 100).toFixed(2)} y el gasto es de ${g.monto.toFixed(2)}.`
  return null
}

const ordenGasto = (a: Gasto, b: Gasto) => a.fecha.localeCompare(b.fecha) || a.creadoEn.localeCompare(b.creadoEn) || a.id.localeCompare(b.id)

/**
 * Reparte los gastos ACTIVOS de UN mes (todos, sin filtros de ámbito/categoría) entre los fondos. `gastos` puede traer gastos
 * de otros meses o anulados: se ignoran. Devuelve el estado de cada fondo y la imputación de cada gasto.
 */
export function asignarMes(mes: string, gastos: Gasto[], fondos: Fondo[], ctx: CtxReparto): ResultadoMes {
  const porFondo = new Map<string, CuentaFondo>()
  const porId = new Map(fondos.map(f => [f.id, f]))
  const activo = new Map(fondos.map(f => [f.id, activoEnMes(f, mes, ctx)]))
  for (const f of fondos) {
    const m = fondoMontoMes(f, mes, ctx.fondosMeses, ctx.aislarDesde)
    const cupo = activo.get(f.id) ? (toBaseCents(m.monto, f.moneda, ctx.base, ctx.rates) ?? 0) : 0
    porFondo.set(f.id, { cupo, imputado: 0, count: 0, enviado: 0, recibido: 0, manual: 0, destinos: [] })
  }
  const porGasto = new Map<string, Imputacion>()
  let sinFondoC = 0, sinFondoN = 0, conflictos = 0, incompatibles = 0
  const delMes = gastos.filter(g => g.estado !== 'Anulado' && g.fecha.startsWith(mes)).sort(ordenGasto)
  const poner = (imp: Imputacion, fondoId: string, cents: number, tipo: TipoParte) => {
    if (cents <= 0) return
    const ex = imp.partes.find(p => p.fondoId === fondoId && p.tipo === tipo)
    if (ex) ex.cents += cents; else imp.partes.push({ fondoId, cents, tipo })
    const c = porFondo.get(fondoId)!
    c.imputado += cents
    if (tipo === 'manual') c.manual += cents
  }
  const cerrar = (imp: Imputacion) => {
    for (const id of new Set(imp.partes.map(p => p.fondoId))) porFondo.get(id)!.count++
    if (imp.sinFondo > 0) { sinFondoC += imp.sinFondo; sinFondoN++ }
    porGasto.set(imp.gastoId, imp)
  }
  const pendientes: { g: Gasto; cents: number; conflicto?: string }[] = []
  // 1) Manuales válidas primero (prioridad absoluta, aunque dejen un fondo en negativo).
  for (const g of delMes) {
    const cents = toBaseCents(g.monto, g.moneda, ctx.base, ctx.rates)
    if (cents === null) continue   // sin tipo de cambio: el motor de agregados ya lo excluye e informa
    const manual = ctx.asignaciones?.[g.id.toLowerCase()]
    if (!manual?.length) { pendientes.push({ g, cents }); continue }
    const error = validarAsignacion(g, manual, fondos, ctx)
    if (error) { conflictos++; pendientes.push({ g, cents, conflicto: error }); continue }
    const imp: Imputacion = { gastoId: g.id, total: cents, partes: [], sinFondo: 0, excedente: 0, origen: [], destino: [], manual: true }
    const montos = repartir(cents, manual.map(p => Math.round(p.monto * 100)))
    manual.forEach((p, i) => poner(imp, p.fondoId, montos[i], 'manual'))
    cerrar(imp)
  }
  // 2) Automáticas en orden estable.
  for (const { g, cents, conflicto } of pendientes) {
    const imp: Imputacion = { gastoId: g.id, total: cents, partes: [], sinFondo: 0, excedente: 0, origen: [], destino: [], manual: false, ...(conflicto ? { conflicto } : {}) }
    // Un gasto anterior a una restricción de medio que la viola no se imputa a ningún fondo: queda marcado para revisión
    // (nunca se reclasifica solo). Uno sin fondos elegibles queda sin fondo asignable.
    const incompatible = !validarMedioGasto(g, fondos).ok
    const el = incompatible ? [] : elegibles(g, mes, fondos, f => !!activo.get(f.id) && porId.has(f.id))
    if (!el.length) {
      imp.sinFondo = cents
      if (incompatible) { imp.incompatible = true; incompatibles++ }
      cerrar(imp)
      continue
    }
    const nivel = (e: Elegible) => `${Number(e.dedicado)}|${e.esp}`
    const principal = nivel(el[0])
    imp.origen = el.filter(e => nivel(e) === principal).map(e => e.f.id)
    let resto = cents
    for (const e of el) {
      if (resto <= 0) break
      const c = porFondo.get(e.f.id)!
      const toma = Math.min(resto, Math.max(0, c.cupo - c.imputado))
      if (toma <= 0) continue
      poner(imp, e.f.id, toma, nivel(e) === principal ? 'automatica' : 'desborde')
      resto -= toma
    }
    if (resto > 0) {
      const destino = el.find(e => e.respaldo) ?? el[0]
      poner(imp, destino.f.id, resto, 'sobregiro')
    }
    imp.excedente = imp.partes.filter(p => !imp.origen.includes(p.fondoId)).reduce((s, p) => s + p.cents, 0)
    if (imp.excedente > 0) {
      imp.destino = [...new Set(imp.partes.filter(p => !imp.origen.includes(p.fondoId)).map(p => p.fondoId))]
      // El desborde se atribuye al último fondo del nivel principal (el que se agotó al final); cada receptor suma lo recibido.
      const ult = porFondo.get(imp.origen[imp.origen.length - 1])!
      ult.enviado += imp.excedente
      for (const d of imp.destino) if (!ult.destinos.includes(d)) ult.destinos.push(d)
      for (const p of imp.partes) if (!imp.origen.includes(p.fondoId)) porFondo.get(p.fondoId)!.recibido += p.cents
    }
    cerrar(imp)
  }
  return { mes, porFondo, porGasto, sinFondo: { cents: sinFondoC, count: sinFondoN }, conflictos, incompatibles }
}

/** Imputaciones de todos los meses que tocan los gastos dados (para la tabla de Gastos y el detalle de un gasto). */
export function imputacionesDe(gastos: Gasto[], fondos: Fondo[], ctx: CtxReparto, meses?: string[]): Map<string, Imputacion> {
  const lista = meses ?? [...new Set(gastos.map(g => g.fecha.slice(0, 7)))]
  const porMes = new Map<string, Gasto[]>()
  for (const g of gastos) { const m = g.fecha.slice(0, 7); if (lista.includes(m)) (porMes.get(m) ?? porMes.set(m, []).get(m)!).push(g) }
  const out = new Map<string, Imputacion>()
  for (const [m, gs] of porMes) for (const [id, imp] of asignarMes(m, gs, fondos, ctx).porGasto) out.set(id, imp)
  return out
}

/* ---------------------------------- Textos ---------------------------------- */

export function describirCobertura(r: ReglaFondo): string {
  if (r.cobertura === 'todos') return 'Todos los gastos'
  const ruta = (x: Ruta) => [x.ambito || 'Todos los ámbitos', x.categoria, x.subcategoria].filter(Boolean).join(' › ')
  const xs = r.rutas.map(ruta)
  return xs.length <= 2 ? xs.join(' · ') : `${xs.slice(0, 2).join(' · ')} y ${xs.length - 2} más`
}
export function describirMedios(r: ReglaFondo): string {
  if (r.medios === 'todos') return 'Todos los medios'
  return r.medios === 'solo' ? `Solo ${r.listaMedios.join(', ')}` : `Todos excepto ${r.listaMedios.join(', ')}`
}

/* ---------------------------------- Explicaciones (Gastos, Presupuestos, avisos) ---------------------------------- */

export const TIPO_PARTE_TXT: Record<TipoParte, string> = { manual: 'Asignación manual', automatica: 'Automática', desborde: 'Excedente recibido', sobregiro: 'Sobregiro' }

const lista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)

/** Explicación de una imputación ya hecha (detalle del gasto). */
export function explicarImputacion(imp: Imputacion, nombre: (id: string) => string, money: (c: number) => string): string {
  if (imp.incompatible) return 'El medio de pago no está permitido para esta clasificación según tus presupuestos: el gasto no se imputa a ningún fondo. Corrige el medio o la clasificación.'
  if (imp.sinFondo === imp.total) return 'Ningún fondo activo cubre esta clasificación con este medio de pago: el gasto queda sin fondo asignable y sigue contando en el gasto del período.'
  if (imp.manual) return `Asignación manual: ${lista(imp.partes.map(p => `${nombre(p.fondoId)} ${money(p.cents)}`))}.`
  const base = imp.conflicto ? `La asignación manual guardada ya no es válida (${imp.conflicto}) y se usó la automática. ` : ''
  if (!imp.excedente) {
    const sob = imp.partes.filter(p => p.tipo === 'sobregiro')
    return base + (sob.length ? `${lista(sob.map(p => nombre(p.fondoId)))} no tenía saldo suficiente y quedó sobregirado en ${money(sob.reduce((s, p) => s + p.cents, 0))}.`
      : `Imputado automáticamente a ${lista([...new Set(imp.partes.map(p => nombre(p.fondoId)))])}.`)
  }
  const enOrigen = imp.partes.filter(p => imp.origen.includes(p.fondoId)).reduce((s, p) => s + p.cents, 0)
  const origen = lista(imp.origen.map(nombre)), destino = lista(imp.destino.map(nombre))
  return base + (enOrigen
    ? `${imp.origen.length > 1 ? `Los fondos ${origen} tenían` : `El fondo ${origen} tenía`} ${money(enOrigen)} disponibles. Los ${money(imp.excedente)} restantes fueron asignados automáticamente a ${destino}.`
    : `${origen} ya no ${imp.origen.length > 1 ? 'tenían' : 'tenía'} saldo: los ${money(imp.excedente)} fueron asignados automáticamente a ${destino}.`)
}

/** Avisos ANTES de guardar (no bloquean): desborde a otro fondo y saldos que quedarían negativos. */
export function avisosPrevios(imp: Imputacion, porFondo: Map<string, CuentaFondo>, nombre: (id: string) => string, money: (c: number) => string): string[] {
  const out: string[] = []
  if (imp.excedente > 0) out.push(`El gasto supera el presupuesto disponible de ${lista(imp.origen.map(nombre))}. Se asignarán ${money(imp.excedente)} a ${lista(imp.destino.map(nombre))}.`)
  for (const id of new Set(imp.partes.map(p => p.fondoId))) {
    const c = porFondo.get(id)
    if (c && c.cupo - c.imputado < 0 && imp.partes.some(p => p.fondoId === id && (p.tipo === 'sobregiro' || p.tipo === 'manual'))) out.push(`${nombre(id)} excedido en ${money(c.imputado - c.cupo)}.`)
  }
  if (imp.sinFondo > 0 && !imp.incompatible) out.push('Ningún fondo activo cubre este gasto: quedará sin fondo asignable (sigue contando en el gasto del período).')
  return out
}

/** Resumen para el aviso DESPUÉS de que el backend confirmó el guardado. */
export const resumenDistribucion = (imp: Imputacion, nombre: (id: string) => string, money: (c: number) => string): string => {
  if (!imp.partes.length) return 'Sin fondo asignable.'
  const m = new Map<string, number>()
  for (const p of imp.partes) m.set(p.fondoId, (m.get(p.fondoId) ?? 0) + p.cents)
  return `Distribución: ${[...m].map(([id, c]) => `${nombre(id)} ${money(c)}`).join(' · ')}.`
}
