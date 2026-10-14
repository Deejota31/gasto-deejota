import { addDays, daysInMonth, shiftMonth } from './dates'

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
/** La semana empieza en lunes. */
export const DIAS_CORTOS = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do']

/** Día de la semana de una fecha AAAA-MM-DD con la semana empezando en lunes (0 = lunes). Solo aritmética UTC: sin desfases por zona horaria. */
export function diaSemana(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
}

export interface Celda { iso: string; dia: number; enMes: boolean }

/** Cuadrícula de 6 semanas × 7 días (lunes a domingo) que cubre el mes AAAA-MM. */
export function cuadriculaDelMes(periodo: string): Celda[] {
  const primero = `${periodo}-01`
  const inicio = addDays(primero, -diaSemana(primero))
  return Array.from({ length: 42 }, (_, i) => {
    const iso = addDays(inicio, i)
    return { iso, dia: Number(iso.slice(8, 10)), enMes: iso.startsWith(periodo) }
  })
}

/** Mueve una fecha `n` meses conservando el día (o el último del mes si no existe). */
export function moverMeses(iso: string, n: number): string {
  const p = shiftMonth(iso.slice(0, 7), n)
  return `${p}-${String(Math.min(Number(iso.slice(8, 10)), daysInMonth(p))).padStart(2, '0')}`
}

export const nombreMes = (periodo: string) => `${MESES[Number(periodo.slice(5, 7)) - 1]} ${periodo.slice(0, 4)}`

/** "14 de octubre de 2026" para lectores de pantalla. */
export function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} de ${MESES[m - 1].toLowerCase()} de ${y}`
}

/** Limita una fecha a [min, max] (cualquiera puede faltar). */
export const acotar = (iso: string, min?: string, max?: string) => (min && iso < min ? min : max && iso > max ? max : iso)
