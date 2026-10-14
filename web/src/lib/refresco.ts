/** Actualización automática de datos. Se elige en Configuración y se guarda en la hoja (CONFIG → refresco_segundos). */
export const REFRESCO_OPCIONES: { segundos: number; label: string; desc: string }[] = [
  { segundos: 0, label: 'Desactivada', desc: 'Solo actualizas tú, con el botón' },
  { segundos: 30, label: 'Cada 30 segundos', desc: 'Para varios dispositivos a la vez' },
  { segundos: 60, label: 'Cada 1 minuto', desc: 'Casi en tiempo real' },
  { segundos: 300, label: 'Cada 5 minutos', desc: 'Recomendado' },
  { segundos: 600, label: 'Cada 10 minutos', desc: 'Menos lecturas a tu hoja' },
]
export const REFRESCO_PREDETERMINADO = 300

/**
 * Segundos configurados (0 = desactivada). Un valor ausente usa el predeterminado; un valor guardado que ya no es una
 * opción permitida (p. ej. 120, 900 o 1800 de versiones anteriores) se trata como Desactivada. No se reescribe en la hoja
 * al cargar: se normaliza cuando la persona elige otra opción.
 */
export function refrescoSegundos(v: string | undefined): number {
  if (v === undefined || v.trim() === '') return REFRESCO_PREDETERMINADO
  const n = Number(v)
  return REFRESCO_OPCIONES.some(o => o.segundos === n) ? n : 0
}
