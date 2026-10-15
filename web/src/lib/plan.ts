// Planificación mensual y recordatorios (v1.19). Todo vive en CONFIG (Google Sheets), sin hojas nuevas:
//   plan_activo        'true' | 'false'      recordatorios de planificación (por defecto activos)
//   plan_dia           '1'..'31'             día predeterminado
//   plan_dias_AAAA     '1:1,2:1,…' (12)      día:activo de cada mes del año (vacío = predeterminado)
//   plan_est_AAAA-MM   'c|110|2026-11-05'    estado · etapas (f,s,g: 0 pendiente, 1 hecha, 2 omitida) · pospuesto hasta
// Fechas siempre como texto AAAA-MM-DD en la zona horaria del usuario: nada de conversiones UTC.

export type EstadoPlan = 'pendiente' | 'en_progreso' | 'completada' | 'descartada'
export type Etapa = 'fuentes' | 'subcajas' | 'gastos'
export const ETAPAS: Etapa[] = ['fuentes', 'subcajas', 'gastos']
export type EstadoEtapa = 0 | 1 | 2   // pendiente · hecha · omitida
export interface PlanMes { mes: string; estado: EstadoPlan; etapas: Record<Etapa, EstadoEtapa>; posponerHasta: string }
export interface PlanConfig { activo: boolean; diaDefecto: number }

const CODIGO: Record<EstadoPlan, string> = { pendiente: 'p', en_progreso: 'e', completada: 'c', descartada: 'd' }
const DESDE_CODIGO = Object.fromEntries(Object.entries(CODIGO).map(([k, v]) => [v, k])) as Record<string, EstadoPlan>

export const MESES_NOMBRE = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const nombreMes = (mes: string) => `${MESES_NOMBRE[Number(mes.slice(5, 7)) - 1] ?? mes} ${mes.slice(0, 4)}`

/** Días reales del mes (febrero respeta años bisiestos). mes = AAAA-MM */
export function diasDelMes(mes: string): number {
  const y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7))
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
export const sumarMeses = (mes: string, n: number): string => {
  const y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7)) - 1 + n
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12
  return `${yy}-${String(mm + 1).padStart(2, '0')}`
}
export const mesAnterior = (mes: string) => sumarMeses(mes, -1)

export function leerPlanConfig(cfg: Record<string, string>): PlanConfig {
  const d = Number(cfg.plan_dia)
  return { activo: cfg.plan_activo !== 'false', diaDefecto: Number.isInteger(d) && d >= 1 && d <= 31 ? d : 1 }
}

/** Día y estado del recordatorio de un mes concreto: el de su año si existe; si no, el predeterminado (acotado al largo del mes). */
export function recordatorioDeMes(cfg: Record<string, string>, mes: string): { dia: number; activo: boolean; propio: boolean } {
  const { diaDefecto } = leerPlanConfig(cfg)
  const largo = diasDelMes(mes)
  const raw = (cfg[`plan_dias_${mes.slice(0, 4)}`] ?? '').split(',')[Number(mes.slice(5, 7)) - 1]
  if (raw) {
    const [d, a] = raw.split(':')
    const dia = Number(d)
    if (Number.isInteger(dia) && dia >= 1 && dia <= largo) return { dia, activo: a !== '0', propio: true }
  }
  return { dia: Math.min(diaDefecto, largo), activo: true, propio: false }
}
export const fechaRecordatorio = (cfg: Record<string, string>, mes: string) => `${mes}-${String(recordatorioDeMes(cfg, mes).dia).padStart(2, '0')}`

/** Serializa los 12 meses de un año. `meses` = 12 pares { dia, activo }. */
export const serializarAnio = (meses: { dia: number; activo: boolean }[]) => meses.map(m => `${m.dia}:${m.activo ? 1 : 0}`).join(',')
export function leerAnio(cfg: Record<string, string>, anio: number): { dia: number; activo: boolean }[] {
  return Array.from({ length: 12 }, (_, i) => { const r = recordatorioDeMes(cfg, `${anio}-${String(i + 1).padStart(2, '0')}`); return { dia: r.dia, activo: r.activo } })
}
/** Valida el día de cada mes; devuelve el primer error o null. */
export function validarAnio(anio: number, meses: { dia: number; activo: boolean }[]): string | null {
  for (let i = 0; i < 12; i++) {
    const largo = diasDelMes(`${anio}-${String(i + 1).padStart(2, '0')}`), d = meses[i]?.dia
    if (!Number.isInteger(d) || d < 1 || d > largo) return `${MESES_NOMBRE[i]} ${anio} solo tiene ${largo} días.`
  }
  return null
}

export function leerEstadoPlan(cfg: Record<string, string>, mes: string): PlanMes {
  const raw = cfg[`plan_est_${mes}`] ?? ''
  const [e, et, z] = raw.split('|')
  const dig = (i: number): EstadoEtapa => { const n = Number((et ?? '000')[i]); return n === 1 || n === 2 ? n : 0 }
  return { mes, estado: DESDE_CODIGO[e] ?? 'pendiente', etapas: { fuentes: dig(0), subcajas: dig(1), gastos: dig(2) }, posponerHasta: /^\d{4}-\d{2}-\d{2}$/.test(z ?? '') ? z : '' }
}
export const serializarEstadoPlan = (p: PlanMes) => `${CODIGO[p.estado]}|${p.etapas.fuentes}${p.etapas.subcajas}${p.etapas.gastos}|${p.posponerHasta}`

/** Estado derivado de las etapas: completada si ninguna queda pendiente; en progreso si alguna ya se hizo/omitió. */
export function estadoDesdeEtapas(etapas: Record<Etapa, EstadoEtapa>): EstadoPlan {
  const v = ETAPAS.map(e => etapas[e])
  if (v.every(x => x !== 0)) return 'completada'
  return v.some(x => x !== 0) ? 'en_progreso' : 'pendiente'
}

export interface Recordatorio { mes: string; fecha: string; plan: PlanMes; actual: boolean }
/**
 * Recordatorios que corresponde mostrar hoy: meses que ya llegaron a su fecha, siguen sin completarse ni descartarse y no están
 * pospuestos. Solo el mes actual y hasta 2 anteriores (nunca una avalancha de meses viejos). Nunca meses futuros.
 */
export function recordatoriosPendientes(cfg: Record<string, string>, hoy: string): Recordatorio[] {
  if (!leerPlanConfig(cfg).activo) return []
  const actual = hoy.slice(0, 7)
  const out: Recordatorio[] = []
  for (let i = 0; i <= 2; i++) {
    const mes = sumarMeses(actual, -i)
    const r = recordatorioDeMes(cfg, mes)
    if (!r.activo) continue
    const fecha = fechaRecordatorio(cfg, mes)
    if (hoy < fecha) continue
    const plan = leerEstadoPlan(cfg, mes)
    if (plan.estado === 'completada' || plan.estado === 'descartada') continue
    if (plan.posponerHasta && hoy < plan.posponerHasta) continue
    out.push({ mes, fecha, plan, actual: i === 0 })
  }
  return out
}

/** Próximas fechas programadas (a partir de hoy), para mostrarlas en Configuración. */
export function proximasFechas(cfg: Record<string, string>, hoy: string, n = 3): { mes: string; fecha: string }[] {
  if (!leerPlanConfig(cfg).activo) return []
  const out: { mes: string; fecha: string }[] = []
  for (let i = 0; i < 24 && out.length < n; i++) {
    const mes = sumarMeses(hoy.slice(0, 7), i)
    if (!recordatorioDeMes(cfg, mes).activo) continue
    const fecha = fechaRecordatorio(cfg, mes)
    if (fecha >= hoy && leerEstadoPlan(cfg, mes).estado !== 'completada') out.push({ mes, fecha })
  }
  return out
}
