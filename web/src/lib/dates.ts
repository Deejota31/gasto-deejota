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

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export function monthLabel(periodo: string, long = false): string {
  const [y, m] = periodo.split('-').map(Number)
  if (long) {
    const name = new Intl.DateTimeFormat('es-PE', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`
  }
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`
}

/** Muestra AAAA-MM-DD según el formato configurado (dd/MM/yyyy, MM/dd/yyyy o yyyy-MM-dd). */
export function formatDate(iso: string, format = 'dd/MM/yyyy'): string {
  const [y, m, d] = iso.split('-')
  if (!d) return iso
  return format.replace('yyyy', y).replace('MM', m).replace('dd', d)
}
