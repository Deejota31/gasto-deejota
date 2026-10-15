import { aggregate, aislaDesde } from './engine'
import { formatMoney, ratesFromConfig } from './money'
import { formatDate } from './dates'
import type { AppData, CausaConc, ConcFila, EstadoConc, Filters } from './types'

/**
 * Conciliación de saldos (v1.22) — lógica pura, sin interfaz ni escrituras.
 *
 *  - Saldo presupuestario calculado = lo que dice el motor existente (fuentes efectivas del mes − gastos activos hasta la
 *    fecha de corte). No se reimplementa ninguna regla financiera: se llama a `aggregate` con el período [1 del mes, corte].
 *  - Saldo real verificado = lo escribe el usuario; jamás se deduce de fuentes ni gastos.
 *  - Diferencia = real − calculado. Guardarla no crea ingresos, gastos ni ajustes.
 *  - Un grupo de fondos es un conjunto de FUENTES. El calculado de un grupo es la suma del disponible que el motor ya atribuye
 *    a cada una de sus fuentes (atribución verificable por medio de pago; no se inventa ninguna distribución). Una fuente
 *    solo puede estar en un grupo activo: nada se suma dos veces. Yape/Plin no son cuentas: no tienen saldo propio.
 */

export const EPS = 0.005
export const GRUPO_TOTAL_ID = 'total'
export const GRUPO_TOTAL_NOMBRE = 'Dinero total'

export const ESTADO_TXT: Record<EstadoConc, string> = {
  pendiente: 'Pendiente', en_revision: 'En revisión', conciliada: 'Conciliada', cerrada_justificada: 'Cerrada con diferencia justificada',
}
export const CAUSAS: { value: CausaConc; label: string }[] = [
  { value: 'gasto_pendiente', label: 'Gasto pendiente de registrar' },
  { value: 'ingreso_pendiente', label: 'Ingreso pendiente de registrar' },
  { value: 'saldo_anterior', label: 'Saldo anterior' },
  { value: 'comision', label: 'Comisión' },
  { value: 'reembolso', label: 'Reembolso' },
  { value: 'no_identificada', label: 'Diferencia no identificada' },
  { value: 'otro', label: 'Otro' },
]
export const causaTxt = (c: string) => CAUSAS.find(x => x.value === c)?.label ?? ''

export const redondear2 = (n: number) => Math.round(n * 100) / 100
export type Signo = 'cero' | 'positiva' | 'negativa'
export const signoDe = (d: number): Signo => Math.abs(d) < EPS ? 'cero' : d > 0 ? 'positiva' : 'negativa'
/** Estado visual de una diferencia (cero = conciliado). */
export const visualDe = (d: number): 'conciliado' | 'positiva' | 'negativa' => { const x = signoDe(d); return x === 'cero' ? 'conciliado' : x }
/** Porcentaje de la diferencia sobre el calculado; null cuando el calculado es ~0 (no tiene sentido matemático). */
export const porcentajeDif = (dif: number, calculado: number): number | null => Math.abs(calculado) < 1 ? null : Math.round((dif / Math.abs(calculado)) * 1000) / 10
export const montoTxt = (n: number, moneda: string) => formatMoney(Math.round(n * 100), moneda)
export const difTxt = (n: number, moneda: string) => `${n > EPS ? '+' : n < -EPS ? '−' : ''}${montoTxt(Math.abs(n), moneda)}`

/* ---------------- Zona horaria (America/Lima por defecto): nunca se mezcla con UTC ---------------- */

function offsetMin(ts: number, tz: string): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ts)).reduce<Record<string, number>>((a, x) => { if (x.type !== 'literal') a[x.type] = Number(x.value); return a }, {})
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000) / 60000
}
/** Fecha (AAAA-MM-DD) y hora (HH:mm) locales → instante ISO UTC. */
export function localAIso(fecha: string, hora: string, tz: string): string {
  const [y, m, d] = fecha.split('-').map(Number), [h, mi] = hora.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const o1 = offsetMin(guess, tz)
  const t = guess - o1 * 60000
  return new Date(guess - offsetMin(t, tz) * 60000).toISOString()
}
const partes = (iso: string, tz: string) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(iso)).reduce<Record<string, string>>((a, x) => { if (x.type !== 'literal') a[x.type] = x.value; return a }, {})
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` }
}
export const fechaEnTz = (iso: string, tz: string) => partes(iso, tz).fecha
export const horaEnTz = (iso: string, tz: string) => partes(iso, tz).hora
export const cortePersonas = (iso: string, tz: string, formato = 'dd/MM/yyyy') => `${formatDate(fechaEnTz(iso, tz), formato)} ${horaEnTz(iso, tz)}`

/* ---------------- Grupos de fondos ---------------- */

export interface GrupoFondos { id: string; nombre: string; fuenteIds: string[] }

/** La definición más reciente de cada grupo manda; los archivados desaparecen. El historial de filas nunca se toca. */
export function gruposVigentes(rows: ConcFila[] | undefined): GrupoFondos[] {
  const ult = new Map<string, ConcFila>()
  for (const r of rows ?? []) if (r.tipo === 'grupo') ult.set(r.grupoId, r)
  return [...ult.values()].filter(r => r.estado === 'activo')
    .map(r => ({ id: r.grupoId, nombre: r.grupo, fuenteIds: r.referencia.split(',').map(x => x.trim()).filter(Boolean) }))
}

/** Grupos que se concilian: los definidos; sin ninguno, el total (un solo saldo). */
export const gruposDeTrabajo = (rows: ConcFila[] | undefined): GrupoFondos[] => {
  const g = gruposVigentes(rows)
  return g.length ? g : [{ id: GRUPO_TOTAL_ID, nombre: GRUPO_TOTAL_NOMBRE, fuenteIds: [] }]
}

/* ---------------- Verificaciones e historial ---------------- */

export interface Verificacion extends ConcFila {
  estadoEfectivo: EstadoConc
  causaEfectiva: string
  /** Última explicación escrita (seguimiento) o la de la verificación. */
  notaEfectiva: string
  /** Última vez que se tocó (verificación o seguimiento). */
  actualizadoEn: string
  /** ID de la verificación que la corrige; la corregida se conserva en el historial. */
  corregidaPor?: string
}

/** Verificaciones con su estado vigente, de la más reciente a la más antigua. Los cambios posteriores en gastos NO las modifican. */
export function verificaciones(rows: ConcFila[] | undefined): Verificacion[] {
  const lista = rows ?? []
  const seg = new Map<string, ConcFila>()
  const corr = new Map<string, string>()
  for (const r of lista) {
    if (r.tipo === 'seguimiento') seg.set(r.conciliacionId, r)
    if (r.tipo === 'verificacion' && r.reemplazaA) corr.set(r.reemplazaA, r.id)
  }
  // Orden: más reciente primero; a igual instante gana la que se agregó después a la hoja (la hoja es solo de agregar).
  return lista.map((r, i) => ({ r, i })).filter(x => x.r.tipo === 'verificacion')
    .sort((x, y) => y.r.creadoEn.localeCompare(x.r.creadoEn) || y.i - x.i)
    .map(({ r }) => {
      const s = seg.get(r.id)
      const cero = Math.abs(r.diferencia ?? 0) < EPS
      return {
        ...r,
        estadoEfectivo: (cero ? 'conciliada' : (s?.estado as EstadoConc) || 'pendiente') as EstadoConc,
        causaEfectiva: s?.causa ?? '', notaEfectiva: s?.observacion || r.observacion, actualizadoEn: s?.creadoEn ?? r.creadoEn, corregidaPor: corr.get(r.id),
      }
    })
}

/** La verificación vigente (no corregida) más reciente de un grupo en un período. */
export const vigentePorGrupo = (vs: Verificacion[], periodo: string, grupoId: string): Verificacion | undefined =>
  vs.find(v => v.periodo === periodo && v.grupoId === grupoId && !v.corregidaPor)

/* ---------------- Saldo presupuestario calculado ---------------- */

export interface FuenteDetalle { id: string; nombre: string; aporta: number; gastado: number; disponible: number; aplicada: boolean; activa: boolean }
export interface SaldoCalculado {
  moneda: string
  periodo: string
  /** AAAA-MM-DD hasta el que se cuentan los gastos (corte DIARIO: la hora solo acompaña al saldo real). */
  corteFecha: string
  /** false = no hay fuentes efectivas / presupuesto: no se inventa ningún importe. */
  calculable: boolean
  motivo?: string
  /** Disponible presupuestario total (P − gastos hasta el corte). */
  total: number | null
  /** Dinero reservado en cajas (reserva, no gasto y no cuenta bancaria). */
  reservado: number
  /** Disponible libre no reservado (saldo libre). */
  libreNoReservado: number | null
  porGrupo: Record<string, number | null>
  /** Parte del total que no pertenece a ningún grupo (gastos con fuente inactiva / sin fuente, fuentes sin grupo). */
  sinAtribuir: number | null
  fuentes: FuenteDetalle[]
  advertencias: string[]
  /** Huella de los datos usados (nº de movimientos, gasto, presupuesto): informativa, para explicar un cambio. */
  referencia: string
}

export function contextoMotor(data: AppData, today: string) {
  return {
    base: data.config.moneda || 'PEN', rates: ratesFromConfig(data.config), today, cajas: data.cajas, presupuestos: data.presupuestos,
    fuentes: data.fuentes ?? [], fuentesMeses: data.fuentesMeses ?? [], aislarDesde: aislaDesde(data.config),
  }
}

const aDec = (cents: number) => redondear2(cents / 100)

export function calcularSaldos(data: AppData, periodo: string, corteFecha: string, today: string, grupos: GrupoFondos[]): SaldoCalculado {
  const f: Filters = { preset: 'custom', desde: `${periodo}-01`, hasta: corteFecha, ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
  const ctx = contextoMotor(data, today)
  const a = aggregate(data.gastos, f, ctx)
  const c = a.cajas
  const lista = c.fuentes.lista
  const fuentes: FuenteDetalle[] = lista.map(r => ({
    id: r.fuente.id, nombre: r.fuente.nombre, aporta: aDec(r.aporta), gastado: aDec(r.gastado), disponible: aDec(r.disponible),
    aplicada: r.aplicada, activa: r.fuente.activo !== false,
  }))
  const hayFuentes = c.origen === 'fuentes' ? lista.some(r => r.aplicada && r.fuente.activo !== false) : c.presupuesto > 0
  const advertencias: string[] = []
  if (a.excluidosSinTipoCambio > 0) advertencias.push(`${a.excluidosSinTipoCambio} movimiento(s) en otra moneda no se suman porque falta su tipo de cambio.`)
  if (c.origen === 'fuentes' && c.fuentes.gastadoSinFuente > 0) advertencias.push('Hay gastos sin fuente válida: descuentan del total pero no de ningún grupo.')
  if (c.origen === 'fuentes' && c.fuentes.gastadoInactivas > 0) advertencias.push('Hay gastos pagados con el medio de una fuente inactiva: descuentan del total pero no de ningún grupo.')
  const referencia = `${a.count}|${a.totalPeriodo}|${c.presupuesto}`
  const base = { moneda: ctx.base, periodo, corteFecha, fuentes, advertencias, referencia, reservado: aDec(c.reservado) }
  if (!hayFuentes) {
    return { ...base, calculable: false, motivo: 'Este período no tiene fuentes de dinero aplicadas ni presupuesto: no hay con qué calcular un saldo.', total: null, libreNoReservado: null, porGrupo: {}, sinAtribuir: null }
  }
  const total = aDec(c.disponible)
  const porGrupo: Record<string, number | null> = { [GRUPO_TOTAL_ID]: total }
  let suma = 0, algun = false
  for (const g of grupos) {
    if (g.id === GRUPO_TOTAL_ID) continue
    if (c.origen !== 'fuentes') { porGrupo[g.id] = null; continue }   // sin fuentes no hay con qué atribuir a un grupo
    const miembros = lista.filter(r => g.fuenteIds.includes(r.fuente.id) && r.aplicada && r.fuente.activo !== false)
    if (!miembros.length) { porGrupo[g.id] = null; continue }
    const v = redondear2(miembros.reduce((s, r) => s + aDec(r.disponible), 0))
    porGrupo[g.id] = v; suma += v; algun = true
  }
  const conGrupos = grupos.some(g => g.id !== GRUPO_TOTAL_ID)
  return { ...base, calculable: true, total, libreNoReservado: aDec(c.saldoLibre), porGrupo, sinAtribuir: conGrupos && algun ? redondear2(total - suma) : null }
}

/** ¿Los datos cambiaron desde la verificación? Compara su foto con el cálculo de hoy para el MISMO período, corte y grupo. */
export function estaDesactualizada(v: Verificacion, actual: number | null | undefined): boolean {
  return v.calculado !== null && actual !== null && actual !== undefined && Math.abs(actual - v.calculado) >= EPS
}

/* ---------------- Estado visual de un indicador ---------------- */

export type EstadoVisual = 'sin_verificar' | 'insuficiente' | 'conciliado' | 'positiva' | 'negativa' | 'pendiente' | 'desactualizada'
export const ESTADO_VISUAL_TXT: Record<EstadoVisual, string> = {
  sin_verificar: 'Pendiente de verificación', insuficiente: 'Información insuficiente', conciliado: 'Conciliado',
  positiva: 'Diferencia positiva', negativa: 'Diferencia negativa', pendiente: 'Pendiente de verificación', desactualizada: 'Datos desactualizados',
}

/* ---------------- Exportación ---------------- */

export function historialCsv(vs: Verificacion[], tz: string, formato: string): string {
  const cell = (v: string | number) => {
    let s = String(v)
    if (/^[=+\-@]/.test(s) && typeof v === 'string') s = `'${s}`   // sin inyección de fórmulas
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const cab = ['Fecha de corte', 'Período', 'Grupo', 'Moneda', 'Saldo presupuestario', 'Saldo real', 'Diferencia', 'Estado', 'Causa', 'Observaciones', 'Corregida por', 'Registrada', 'Última actualización']
  const filas = vs.map(v => [cortePersonas(v.corte, tz, formato), v.periodo, v.grupo, v.moneda, v.calculado ?? '', v.real ?? '', v.diferencia ?? '', ESTADO_TXT[v.estadoEfectivo],
    causaTxt(v.causaEfectiva), v.notaEfectiva, v.corregidaPor ?? '', v.creadoEn, v.actualizadoEn])
  return '﻿' + [cab.join(','), ...filas.map(r => r.map(cell).join(','))].join('\n')
}
