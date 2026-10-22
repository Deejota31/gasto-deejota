// Planificación mensual: qué fondos puede preparar el usuario para un mes y qué había en el mes anterior.
// Solo lectura sobre los datos ya cargados: nada de aquí escribe; las escrituras van por `aplicarFondosMes`.
import { aislaDesde, fondoMontoMes } from './engine'
import { mesAnterior, recordatoriosPendientes, type Recordatorio } from './plan'
import { toCents } from './money'
import type { AppData, Fondo, PlantillaFin } from './types'

/** Origen de una operación lanzada desde «Prepara tu mes»: el módulo hijo avisa al asistente cuando el backend confirmó, o cuando se cerró sin aplicar. */
export interface ContextoPlan {
  mes: string; onAplicado: (r: { mes: string; n: number }) => void; onCerrar: () => void
  /** El módulo hijo lanzó el guardado en segundo plano y se cierra: el asistente recupera el control y muestra la etapa «En progreso». */
  onIniciado?: () => void
  /** El guardado en segundo plano falló (nada quedó aplicado): el asistente muestra la etapa en Error con «Reintentar». */
  onFallo?: (mensaje: string, reintentar?: () => void) => void
}
export interface Candidato {
  id: string; nombre: string; moneda: string
  /** ¿Ya está aplicado al mes? (no se puede "desaplicar" desde aquí ni se sobrescribe sin que el usuario edite el monto) */
  aplicada: boolean
  /** Monto vigente en el mes si está aplicado; si no, el sugerido (mes anterior o importe habitual). */
  monto: number
  /** Monto aplicado en el mes anterior (null = no estaba aplicado allí). */
  previo: number | null
}

/** Fondos mensuales activos que se pueden preparar para el mes, con lo que tenían el mes anterior. */
export function candidatos(data: AppData, mes: string): Candidato[] {
  const aisl = aislaDesde(data.config), prev = mesAnterior(mes), meses = data.fondosMeses ?? []
  return (data.fondos ?? []).filter(f => f.activo && f.recurrencia !== 'unica').sort((a, b) => a.orden - b.orden).map(f => {
    const act = fondoMontoMes(f, mes, meses, aisl), p = fondoMontoMes(f, prev, meses, aisl)
    const previo = p.aplicada && p.monto > 0 ? p.monto : null
    return { id: f.id, nombre: f.nombre, moneda: f.moneda, aplicada: act.aplicada, monto: act.aplicada ? act.monto : (previo ?? f.monto), previo }
  })
}

export interface ResumenMes { mes: string; fondos: number; gastos: number; fondosTotal: number }
/** Cuántos fondos tiene aplicados un mes y cuántos gastos reales tiene registrados. */
export function resumenMes(data: AppData, mes: string): ResumenMes {
  const f = candidatos(data, mes)
  return { mes, fondos: f.filter(x => x.aplicada).length, gastos: data.gastos.filter(g => g.fecha.startsWith(mes)).length, fondosTotal: f.length }
}

/** Recordatorios vigentes hoy. Los meses anteriores al corte de aislamiento no se planifican (siguen el comportamiento histórico). */
export function recordatoriosVigentes(data: AppData, hoy: string): Recordatorio[] {
  const aisl = aislaDesde(data.config)
  return recordatoriosPendientes(data.config, hoy).filter(r => r.mes >= aisl)
}


/* ===================== Estado real de una plantilla en un mes (v1.20) =====================
 * "Aplicada" NO es lo mismo que "la plantilla existe". Se distinguen cuatro cosas, siempre a partir de los datos releídos:
 *   - la plantilla (definición) · el fondo base · la aplicación del mes · la marca guardada en Estados.
 * El estado que se muestra sale de la aplicación real del mes, nunca solo de la marca ni de una selección local.
 */
export type EstadoPlantillaMes = 'pendiente' | 'aplicada' | 'historica' | 'omitida'

/** Mismo ID estable que usa el backend al crear el fondo de una plantilla (pfIdSeguro_, ≤60). */
export function idEntidadPlantilla(p: Pick<PlantillaFin, 'id' | 'tipo'>): string {
  const limpio = String(p.id).replace(/[^A-Za-z0-9_-]/g, '')
  const s = 'f-' + limpio
  return s.length <= 60 ? s : ('f-' + limpio.replace(/^pf-/, '')).slice(0, 60)
}

export function entidadDePlantilla(p: PlantillaFin, data: Pick<AppData, 'fondos'>): Fondo | undefined {
  const ids = [p.origenId, idEntidadPlantilla(p)].filter(Boolean)
  return (data.fondos ?? []).find(f => ids.includes(f.id))
}

/** Importe y aplicación del fondo en el mes (null = no hay fondo). */
function aplicacionEnMes(p: PlantillaFin, data: AppData, mes: string): { entidad: Fondo; aplicada: boolean; centavos: number } | null {
  const ent = entidadDePlantilla(p, data)
  if (!ent) return null
  const r = fondoMontoMes(ent, mes, data.fondosMeses ?? [], aislaDesde(data.config))
  return { entidad: ent, aplicada: r.aplicada, centavos: toCents(r.monto) }
}

export function estadoRealPlantilla(p: PlantillaFin, mes: string, data: AppData): EstadoPlantillaMes {
  if (p.estados[mes]?.e === 'omitida') return 'omitida'
  const ap = aplicacionEnMes(p, data, mes)
  if (!ap) return 'pendiente'
  if (mes < aislaDesde(data.config)) return p.estados[mes]?.e === 'aplicada' ? 'aplicada' : 'historica'
  return ap.aplicada ? 'aplicada' : 'pendiente'
}

export type OperacionPlantilla = 'crear' | 'actualizar' | 'sin_cambios'
export const ETIQUETA_OPERACION: Record<OperacionPlantilla | 'omitir', string> = {
  crear: 'Crear aplicación mensual', actualizar: 'Actualizar aplicación existente', sin_cambios: 'Sin cambios', omitir: 'Omitir',
}
/** Qué haría realmente "Aplicar" con este importe (en el mes y con los datos actuales). */
export function operacionPlantilla(p: PlantillaFin, mes: string, monto: number, data: AppData): { op: OperacionPlantilla; actual: number | null; entidadExiste: boolean } {
  const ap = aplicacionEnMes(p, data, mes)
  if (!ap) return { op: 'crear', actual: null, entidadExiste: false }
  if (!ap.aplicada) return { op: 'crear', actual: null, entidadExiste: true }
  return { op: ap.centavos === toCents(monto) ? 'sin_cambios' : 'actualizar', actual: ap.centavos, entidadExiste: true }
}

/**
 * Verificación posterior a aplicar: con los datos RELEÍDOS de Sheets comprueba que cada plantilla pedida quedó con su fondo
 * y su importe en el mes. Devuelve los problemas (vacío = confirmado). Nunca declara éxito por haber pulsado un botón.
 */
export function verificarPlantillasAplicadas(data: AppData, pedidas: { plantilla: PlantillaFin; monto: number }[], mes: string): string[] {
  const problemas: string[] = []
  for (const { plantilla: p, monto } of pedidas) {
    const ap = aplicacionEnMes(p, data, mes)
    if (!ap) problemas.push(`“${p.nombre}”: no se encontró el fondo en la hoja.`)
    else if (!ap.aplicada) problemas.push(`“${p.nombre}”: no quedó aplicada a ${mes}.`)
    else if (ap.centavos !== toCents(monto)) problemas.push(`“${p.nombre}”: el importe guardado no coincide con el pedido.`)
  }
  return problemas
}

/** Igual que la anterior pero para fondos elegidos directamente en el asistente (por ID de fondo). */
export function verificarFondosAplicados(data: AppData, mes: string, items: { id: string; monto: number }[]): string[] {
  const cands = candidatos(data, mes), problemas: string[] = []
  for (const it of items) {
    const c = cands.find(x => x.id === it.id)
    if (!c) problemas.push(`No se encontró el fondo ${it.id} en la hoja.`)
    else if (!c.aplicada) problemas.push(`“${c.nombre}” no quedó aplicado a ${mes}.`)
    else if (toCents(c.monto) !== toCents(it.monto)) problemas.push(`“${c.nombre}”: el importe guardado no coincide con el pedido.`)
  }
  return problemas
}

/** Datos reales del período para el Resumen final: solo lo que está confirmado en los datos. */
export interface ResumenReal {
  fondos: { n: number; totales: Record<string, number> }
  gastos: { n: number; totales: Record<string, number> }
}
export function resumenReal(data: AppData, mes: string): ResumenReal {
  const f = candidatos(data, mes).filter(x => x.aplicada)
  const fondos: Record<string, number> = {}
  for (const x of f) fondos[x.moneda] = (fondos[x.moneda] ?? 0) + toCents(x.monto)
  const gs = data.gastos.filter(g => g.fecha.startsWith(mes) && g.estado === 'Activo')
  const gastos: Record<string, number> = {}
  for (const g of gs) gastos[g.moneda] = (gastos[g.moneda] ?? 0) + toCents(g.monto)
  return { fondos: { n: f.length, totales: fondos }, gastos: { n: gs.length, totales: gastos } }
}
