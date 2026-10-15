import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CircleHelp, Clock, ArrowUpRight, ArrowDownRight, Hourglass } from 'lucide-react'
import { ESTADO_VISUAL_TXT, type EstadoVisual } from '../../lib/conciliacion'

/** Colores semánticos del Design System. Una diferencia positiva NO es "buena": usa el tono informativo, no el verde. */
export const TONO_VISUAL: Record<EstadoVisual, { cls: string; Icon: typeof CheckCircle2 }> = {
  conciliado: { cls: 'bg-success-soft text-success', Icon: CheckCircle2 },
  positiva: { cls: 'bg-info-soft text-info', Icon: ArrowUpRight },
  negativa: { cls: 'bg-danger-soft text-danger', Icon: ArrowDownRight },
  pendiente: { cls: 'bg-warning-soft text-warning', Icon: Clock },
  desactualizada: { cls: 'bg-warning-soft text-warning', Icon: AlertTriangle },
  sin_verificar: { cls: 'bg-bg text-muted', Icon: Hourglass },
  insuficiente: { cls: 'bg-bg text-muted', Icon: CircleHelp },
}

export function Chip({ estado, texto, testid }: { estado: EstadoVisual; texto?: ReactNode; testid?: string }) {
  const { cls, Icon } = TONO_VISUAL[estado]
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`} data-testid={testid} data-estado={estado}>
      <Icon className="size-3" aria-hidden />{texto ?? ESTADO_VISUAL_TXT[estado]}
    </span>
  )
}

/** Mes AAAA-MM de los últimos `n` meses (incluido el actual) más los extra, del más nuevo al más antiguo. */
export function mesesDisponibles(hoyMes: string, n: number, extra: string[]): string[] {
  const out = new Set<string>(extra)
  const [y, m] = hoyMes.split('-').map(Number)
  for (let i = 0; i < n; i++) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`) }
  return [...out].sort().reverse()
}

/** "123,45" o "123.45" → 123.45; null si no es un importe válido (máx. 2 decimales, sin negativos). */
export function parseMonto(txt: string): number | null {
  const s = txt.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null
  return Number(s)
}
