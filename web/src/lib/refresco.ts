/** Actualización automática de datos. Se elige en Configuración y se guarda en la hoja (CONFIG → refresco_segundos). */
export const REFRESCO_OPCIONES: { segundos: number; label: string }[] = [
  { segundos: 0, label: 'Desactivada' }, { segundos: 30, label: 'Cada 30 segundos' }, { segundos: 60, label: 'Cada 1 minuto' },
  { segundos: 120, label: 'Cada 2 minutos' }, { segundos: 300, label: 'Cada 5 minutos' }, { segundos: 600, label: 'Cada 10 minutos' },
  { segundos: 900, label: 'Cada 15 minutos' }, { segundos: 1800, label: 'Cada 30 minutos' },
]
export const REFRESCO_PREDETERMINADO = 300

/** Segundos configurados (0 = desactivada). Un valor ausente o inválido usa el predeterminado. */
export function refrescoSegundos(v: string | undefined): number {
  if (v === undefined || v.trim() === '') return REFRESCO_PREDETERMINADO
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : REFRESCO_PREDETERMINADO
}
