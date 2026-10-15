// Planificación mensual: qué fuentes/subcajas puede preparar el usuario para un mes y qué había en el mes anterior.
// Solo lectura sobre los datos ya cargados: nada de aquí escribe; las escrituras van por `aplicarEntidadesMes`.
import { aislaDesde, budgetCents, cajaActiva, cajaAplicada, fuenteMontoMes } from './engine'
import { mesAnterior, recordatoriosPendientes, type Recordatorio } from './plan'
import type { AppData } from './types'

export type TipoEntidad = 'fuente' | 'subcaja'
export interface Candidato {
  id: string; nombre: string; moneda: string
  /** ¿Ya está aplicada al mes? (no se puede "desaplicar" desde aquí ni se sobrescribe sin que el usuario edite el monto) */
  aplicada: boolean
  /** Monto vigente en el mes si está aplicada; si no, el sugerido (mes anterior o importe habitual). */
  monto: number
  /** Monto aplicado en el mes anterior (null = no estaba aplicada allí). */
  previo: number | null
}

const c2 = (cents: number) => Math.round(cents) / 100

export function candidatos(data: AppData, tipo: TipoEntidad, mes: string): Candidato[] {
  const aisl = aislaDesde(data.config), prev = mesAnterior(mes), meses = data.fuentesMeses ?? []
  if (tipo === 'fuente') {
    return (data.fuentes ?? []).filter(f => f.activo && f.recurrencia !== 'unica').sort((a, b) => a.orden - b.orden).map(f => {
      const act = fuenteMontoMes(f, mes, meses, aisl), p = fuenteMontoMes(f, prev, meses, aisl)
      const previo = p.aplicada && p.monto > 0 ? p.monto : null
      return { id: f.id, nombre: f.nombre, moneda: f.moneda, aplicada: act.aplicada, monto: act.aplicada ? act.monto : (previo ?? f.monto), previo }
    })
  }
  return data.cajas.filter(c => c.filtroCampo !== 'Todos' && cajaActiva(c)).sort((a, b) => a.orden - b.orden).map(c => {
    const aplicada = cajaAplicada(c, mes, data.presupuestos, aisl), pAp = cajaAplicada(c, prev, data.presupuestos, aisl)
    const previo = pAp ? c2(budgetCents(c, prev, data.presupuestos, aisl)) : null
    return { id: c.id, nombre: c.nombre, moneda: data.config.moneda || 'PEN', aplicada, monto: aplicada ? c2(budgetCents(c, mes, data.presupuestos, aisl)) : (previo ?? c.presupuesto), previo }
  })
}

export interface ResumenMes { mes: string; fuentes: number; subcajas: number; gastos: number; cajasTotal: number; fuentesTotal: number }
/** Cuántas fuentes/subcajas tiene aplicadas un mes y cuántos gastos reales tiene registrados. */
export function resumenMes(data: AppData, mes: string): ResumenMes {
  const f = candidatos(data, 'fuente', mes), s = candidatos(data, 'subcaja', mes)
  return {
    mes, fuentes: f.filter(x => x.aplicada).length, subcajas: s.filter(x => x.aplicada).length,
    gastos: data.gastos.filter(g => g.fecha.startsWith(mes)).length, fuentesTotal: f.length, cajasTotal: s.length,
  }
}

/** Recordatorios vigentes hoy. Los meses anteriores al corte de aislamiento no se planifican (siguen el comportamiento histórico). */
export function recordatoriosVigentes(data: AppData, hoy: string): Recordatorio[] {
  const aisl = aislaDesde(data.config)
  return recordatoriosPendientes(data.config, hoy).filter(r => r.mes >= aisl)
}
