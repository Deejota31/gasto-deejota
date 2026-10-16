import { useEffect, useState } from 'react'
import { DEFAULT_TZ, todayIn } from './dates'

const hoyEn = (tz: string, now = new Date()) => { try { return todayIn(tz, now) } catch { return todayIn(DEFAULT_TZ, now) } }

/** Milisegundos que faltan para la próxima medianoche en la zona `tz` (un día completo si es justo medianoche). */
export function msHastaMedianoche(tz: string, now = new Date()): number {
  let h = 0, m = 0, s = 0
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now)
    const v = (t: string) => Number(p.find(x => x.type === t)?.value ?? 0)
    h = v('hour'); m = v('minute'); s = v('second')
  } catch { return msHastaMedianoche(DEFAULT_TZ, now) }
  return 86_400_000 - ((h * 60 + m) * 60 + s) * 1000 - now.getMilliseconds()
}

/**
 * Fecha de hoy (AAAA-MM-DD) en la zona configurada, siempre al día: se recalcula a la medianoche (temporizador) y al volver a la
 * pestaña (visibilitychange/focus), porque el navegador duerme los temporizadores de las pestañas ocultas.
 */
export function useHoy(tz: string): string {
  const [hoy, setHoy] = useState(() => hoyEn(tz))
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const refrescar = () => setHoy(hoyEn(tz))
    const programar = () => { t = setTimeout(() => { refrescar(); programar() }, msHastaMedianoche(tz) + 500) }
    refrescar(); programar()
    const alVolver = () => { if (document.visibilityState !== 'hidden') { refrescar(); clearTimeout(t); programar() } }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', alVolver); window.removeEventListener('focus', alVolver) }
  }, [tz])
  return hoy
}
