import { aggregate, aislaDesde } from './engine'
import { addDays, monthEnd } from './dates'
import { ratesFromConfig } from './money'
import type { AppData, EstadoRevisionPres, Filters, RevisionPres } from './types'

/**
 * Revisión del presupuesto (v1.26): ayuda a comprobar que el PERÍODO está completo y es coherente, solo con datos del presupuesto
 * (fondos y gastos registrados). No usa saldos de banco, ingresos ni patrimonio, y nunca inventa importes: lo que falta por
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
/** `importe` y `items[].importe` están en céntimos de la moneda base. `items` es el detalle que se despliega (p. ej. cada fondo sobregirado). */
export interface ItemChequeo { nombre: string; importe: number }
export interface Chequeo { id: string; severidad: Severidad; titulo: string; detalle: string; importe?: number; items?: ItemChequeo[] }

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
  /** Días del período ya transcurridos (sin contar hoy): la base para leer cuántos días no tienen gastos. */
  diasTranscurridos: number
  movimientos: number
}

/** Chequeos de consistencia del período. Solo lee; no escribe nada. */
export function revisarPeriodo(data: AppData, periodo: string, today: string): ResultadoRevision {
  const hasta = monthEnd(periodo)
  const filtros: Filters = { preset: 'custom', desde: `${periodo}-01`, hasta, ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
  const a = aggregate(data.gastos, filtros, {
    base: data.config.moneda || 'PEN', rates: ratesFromConfig(data.config), today,
    fondos: data.fondos ?? [], fondosMeses: data.fondosMeses ?? [], asignaciones: data.asignaciones, aislarDesde: aislaDesde(data.config),
  })
  const c = a.presupuesto
  const chequeos: Chequeo[] = []
  const add = (id: string, severidad: Severidad, titulo: string, detalle: string, extra: Pick<Chequeo, 'importe' | 'items'> = {}) => chequeos.push({ id, severidad, titulo, detalle, ...extra })

  if (!c.presupuesto) add('sin-presupuesto', 'alerta', 'El período no tiene presupuesto', 'Ningún fondo activo suma en este período. Aplica o crea un fondo para medir el consumo.')
  if (c.incompatibles > 0) add('medio-restringido', 'alerta', 'Gastos con un medio restringido', `${c.incompatibles} gasto(s) usan un medio fuera de la cobertura que le configuraste (registrados antes de la regla). Corrige su clasificación o su medio.`)
  if (c.conflictos > 0) add('asignacion-conflicto', 'aviso', 'Asignaciones manuales por revisar', `${c.conflictos} asignación(es) manual(es) ya no son válidas (cambió el gasto o una regla); esos gastos usan la asignación automática hasta que las revises.`)
  if (c.sinFondo.count > 0) add('sin-fondo', 'aviso', 'Gastos sin fondo asignable', `${c.sinFondo.count} gasto(s) no los cubre ningún fondo activo; igual descuentan del presupuesto consolidado.`, { importe: c.sinFondo.cents })

  // Un excedente es una señal del presupuesto, no un error de datos. Si los fondos sobregirados explican exactamente lo que excede el
  // consolidado, es UNA sola alerta (con el detalle por fondo); si no coinciden, son dos alertas distintas.
  const sobre: ItemChequeo[] = c.fondos.filter(r => r.estado === 'sobregirado').map(r => ({ nombre: r.fondo.nombre, importe: Math.max(0, r.gastado - r.aporta) }))
  const sumaSobre = sobre.reduce((x, i) => x + i.importe, 0)
  const excede = c.presupuesto > 0 && c.gastadoPeriodo > c.presupuesto
  if (excede && sobre.length && sumaSobre === c.exceso)
    add('excedido', 'aviso', 'Gasto por encima del presupuesto', `Lo gastado supera el presupuesto del período; ${sobre.length === 1 ? 'el fondo indicado concentra' : 'los fondos indicados concentran'} ese exceso.`, { importe: c.exceso, items: sobre })
  else {
    if (sobre.length) add('sobregiro', 'aviso', sobre.length === 1 ? `Fondo sobregirado: ${sobre[0].nombre}` : `${sobre.length} fondos sobregirados`,
      'Tienen imputado más de lo que aporta cada fondo; el resto del presupuesto no se ve afectado.', { importe: sumaSobre, items: sobre })
    if (excede) add('excedido', 'aviso', 'Gasto por encima del presupuesto', 'Lo gastado en el período supera el presupuesto consolidado.', { importe: c.exceso })
  }

  // Días sin movimientos: solo fechas ya transcurridas (el día de hoy y los futuros no cuentan). Es información, no una irregularidad:
  // no todos los días tienen gastos, así que no genera alertas ni suma a las observaciones.
  const inicio = `${periodo}-01`
  const ultimo = today < inicio ? '' : today <= hasta ? addDays(today, -1) : hasta
  const conMov = new Set(data.gastos.filter(g => g.estado === 'Activo' && g.fecha.startsWith(periodo)).map(g => g.fecha))
  const dias: string[] = []
  if (ultimo >= inicio) for (let d = inicio; d <= ultimo; d = addDays(d, 1)) if (!conMov.has(d)) dias.push(d)

  const movimientos = data.gastos.filter(g => g.estado === 'Activo' && g.fecha.startsWith(periodo)).length
  if (!chequeos.length) add('todo-en-orden', 'ok', 'Sin observaciones del presupuesto', 'Fondos y gastos del período son coherentes entre sí.')
  return {
    periodo, enCurso: today <= hasta && today >= `${periodo}-01`, chequeos,
    alertas: chequeos.filter(x => x.severidad === 'alerta').length, avisos: chequeos.filter(x => x.severidad === 'aviso').length,
    diasSinMovimientos: dias, diasTranscurridos: ultimo >= inicio ? Number(ultimo.slice(8)) : 0, movimientos,
  }
}
