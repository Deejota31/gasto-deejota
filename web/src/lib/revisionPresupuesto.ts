import { aggregate, aislaDesde } from './engine'
import { addDays, daysInMonth, monthEnd } from './dates'
import { ratesFromConfig } from './money'
import type { AppData, EstadoRevisionPres, Filters, RevisionPres } from './types'

/**
 * Revisión del presupuesto (v1.26): ayuda a comprobar que el PERÍODO está completo y es coherente, solo con datos del presupuesto
 * (fondos, reservas y gastos registrados). No usa saldos de banco, ingresos ni patrimonio, y nunca inventa importes: lo que falta por
 * registrar se anota como texto y se regulariza creando un gasto normal (con el antiduplicado habitual).
 */
export const ESTADO_REV_TXT: Record<EstadoRevisionPres, string> = {
  pendiente: 'Pendiente de revisión',
  completo: 'Período completo',
  con_gastos_anteriores: 'Con gastos anteriores por registrar',
  revisado_con_observaciones: 'Revisado con observaciones',
}
export const ESTADO_REV_AYUDA: Record<EstadoRevisionPres, string> = {
  pendiente: 'Aún no confirmaste que el período tenga todos sus gastos.',
  completo: 'Confirmaste que todos los gastos del período están registrados.',
  con_gastos_anteriores: 'Dejaste anotado que faltan gastos de este período por registrar.',
  revisado_con_observaciones: 'Revisaste el período y dejaste una observación.',
}

export type Severidad = 'ok' | 'aviso' | 'alerta'
export interface Chequeo { id: string; severidad: Severidad; titulo: string; detalle: string }

/** La revisión vigente de un período es la última registrada (la hoja solo agrega). */
export function vigente(revisiones: readonly RevisionPres[] | undefined, periodo: string): RevisionPres | null {
  let v: RevisionPres | null = null
  for (const r of revisiones ?? []) if (r.periodo === periodo && (!v || r.creadoEn >= v.creadoEn)) v = r
  return v
}

export function historial(revisiones: readonly RevisionPres[] | undefined, periodo: string): RevisionPres[] {
  return (revisiones ?? []).filter(r => r.periodo === periodo).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
}

export function estadoDe(revisiones: readonly RevisionPres[] | undefined, periodo: string): EstadoRevisionPres {
  return vigente(revisiones, periodo)?.estado ?? 'pendiente'
}

export interface ResultadoRevision {
  periodo: string
  /** Si el período aún no terminó, la revisión es parcial (hasta hoy). */
  enCurso: boolean
  chequeos: Chequeo[]
  alertas: number
  avisos: number
  /** Días del período (hasta hoy) sin ningún movimiento: pista de gastos olvidados, sin importes. */
  diasSinMovimientos: string[]
  movimientos: number
}

/** Chequeos de consistencia del período. Solo lee; no escribe nada. */
export function revisarPeriodo(data: AppData, periodo: string, today: string): ResultadoRevision {
  const hasta = monthEnd(periodo)
  const filtros: Filters = { preset: 'custom', desde: `${periodo}-01`, hasta, ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
  const a = aggregate(data.gastos, filtros, {
    base: data.config.moneda || 'PEN', rates: ratesFromConfig(data.config), today, cajas: data.cajas, presupuestos: data.presupuestos,
    fondos: data.fondos ?? [], fondosMeses: data.fondosMeses ?? [], aislarDesde: aislaDesde(data.config),
  })
  const c = a.cajas
  const chequeos: Chequeo[] = []
  const add = (id: string, severidad: Severidad, titulo: string, detalle: string) => chequeos.push({ id, severidad, titulo, detalle })

  if (!c || !c.presupuesto) add('sin-presupuesto', 'alerta', 'El período no tiene presupuesto', 'Ningún fondo activo suma en este período. Aplica o crea un fondo para medir el consumo.')
  if (c?.sobreasignado) add('reservas-exceden', 'alerta', 'Las reservas superan el presupuesto', 'Las cajas reservan más dinero del que aportan los fondos del período.')
  if (c && c.fondos.countSinFondo > 0) add('sin-fondo', 'aviso', 'Gastos sin fondo al cual atribuirse', `${c.fondos.countSinFondo} gasto(s) no tienen un fondo activo; igual descuentan del presupuesto consolidado.`)
  if (c && c.fondos.countInactivas > 0) add('fondo-inactivo', 'aviso', 'Gastos de fondos inactivos', `${c.fondos.countInactivas} gasto(s) se pagaron con el medio de un fondo inactivo; siguen descontando del presupuesto.`)
  if (c && c.presupuesto > 0 && c.gastadoPeriodo > c.presupuesto) add('excedido', 'aviso', 'Gasto por encima del presupuesto', 'Lo gastado en el período supera el presupuesto consolidado.')

  const ultimo = today < hasta && today >= `${periodo}-01` ? today : hasta
  const conMov = new Set(data.gastos.filter(g => g.estado === 'Activo' && g.fecha.startsWith(periodo)).map(g => g.fecha))
  const dias: string[] = []
  if (ultimo >= `${periodo}-01`) for (let d = `${periodo}-01`; d <= ultimo && dias.length < 40; d = addDays(d, 1)) if (!conMov.has(d)) dias.push(d)
  const total = today < `${periodo}-01` ? 0 : Math.min(daysInMonth(periodo), Number(ultimo.slice(8)))
  if (total > 0 && dias.length >= Math.max(3, Math.ceil(total / 2))) add('dias-vacios', 'aviso', 'Muchos días sin movimientos', `${dias.length} de ${total} días no tienen gastos registrados: confirma que no olvidaste anotar alguno.`)

  const movimientos = data.gastos.filter(g => g.estado === 'Activo' && g.fecha.startsWith(periodo)).length
  if (!chequeos.length) add('todo-en-orden', 'ok', 'Sin observaciones del presupuesto', 'Fondos, reservas y gastos del período son coherentes entre sí.')
  return {
    periodo, enCurso: today <= hasta && today >= `${periodo}-01`, chequeos,
    alertas: chequeos.filter(x => x.severidad === 'alerta').length, avisos: chequeos.filter(x => x.severidad === 'aviso').length,
    diasSinMovimientos: dias, movimientos,
  }
}
