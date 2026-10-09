import type { Filters, PeriodPreset } from './types'

export const DEFAULT_TZ = 'America/Lima'

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria indicada. */
export function todayIn(tz = DEFAULT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function daysInMonth(periodo: string): number {
  const [y, m] = periodo.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function shiftMonth(periodo: string, delta: number): string {
  const [y, m] = periodo.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

/** Suma días a una fecha AAAA-MM-DD (en UTC, sin efectos de horario de verano). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Días entre dos fechas, ambas incluidas. */
export function daysBetween(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1
}

export const monthEnd = (periodo: string) => `${periodo}-${String(daysInMonth(periodo)).padStart(2, '0')}`

/** Meses (AAAA-MM) que toca el rango. */
export function monthsInRange(desde: string, hasta: string): string[] {
  const out: string[] = []
  for (let p = desde.slice(0, 7); p <= hasta.slice(0, 7); p = shiftMonth(p, 1)) out.push(p)
  return out
}

/** Rango de fechas de cada preset, relativo a hoy. */
export function presetRange(preset: Exclude<PeriodPreset, 'custom'>, today: string): { desde: string; hasta: string } {
  const mes = today.slice(0, 7)
  switch (preset) {
    case 'mes': return { desde: `${mes}-01`, hasta: monthEnd(mes) }
    case 'mes-anterior': { const p = shiftMonth(mes, -1); return { desde: `${p}-01`, hasta: monthEnd(p) } }
    case '3m': return { desde: `${shiftMonth(mes, -2)}-01`, hasta: monthEnd(mes) }
    case '6m': return { desde: `${shiftMonth(mes, -5)}-01`, hasta: monthEnd(mes) }
    case 'anio': return { desde: `${today.slice(0, 4)}-01-01`, hasta: `${today.slice(0, 4)}-12-31` }
  }
}

/** Si el rango es exactamente un mes calendario, devuelve ese mes (AAAA-MM). */
export function singleMonth(desde: string, hasta: string): string | null {
  const p = desde.slice(0, 7)
  return desde === `${p}-01` && hasta === monthEnd(p) ? p : null
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export function monthLabel(periodo: string, long = false): string {
  const [y, m] = periodo.split('-').map(Number)
  if (long) {
    const name = new Intl.DateTimeFormat('es-PE', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`
  }
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`
}

/** Etiqueta corta del período elegido ("Octubre 2026", "01 ago – 31 oct 2026"). */
export function rangeLabel(f: Pick<Filters, 'desde' | 'hasta'>): string {
  const m = singleMonth(f.desde, f.hasta)
  if (m) return monthLabel(m, true)
  const short = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`
  return `${short(f.desde)} – ${short(f.hasta)} ${f.hasta.slice(0, 4)}`
}

/** Muestra AAAA-MM-DD según el formato configurado (dd/MM/yyyy, MM/dd/yyyy o yyyy-MM-dd). */
export function formatDate(iso: string, format = 'dd/MM/yyyy'): string {
  const [y, m, d] = iso.split('-')
  if (!d) return iso
  return format.replace('yyyy', y).replace('MM', m).replace('dd', d)
}
