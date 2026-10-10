import type { ReactNode } from 'react'
import { AlertTriangle, Lock } from 'lucide-react'
import type { CajasResumen } from '../lib/engine'
import { InfoTooltip } from './ui'

/**
 * Bloque único de "Presupuesto consolidado" para Dashboard y Cajas: mismas cifras, mismos nombres y mismo orden.
 * No calcula nada: todo sale de `aggregate().cajas`. El presupuesto usa el período completo (sin filtros de
 * categoría, ámbito o medio), por eso su "Gastado del período" puede diferir del KPI "Total gastado" con filtros.
 */
export const ESTADO = { ok: '#0F8A6B', atencion: '#B7791F', alerta: '#C0362C' }

export function PresupuestoConsolidado({ c, money, periodo, accion }: { c: CajasResumen; money: (n: number) => string; periodo: string; accion?: ReactNode }) {
  const P = c.presupuesto
  const def = P > 0 || c.origen === 'fuentes'
  const seg = (v: number) => `${P ? Math.max(0, Math.min(100, (v / P) * 100)) : 0}%`
  const tono = c.pct === null ? 'var(--ink)' : c.pct >= 100 ? ESTADO.alerta : c.pct >= 70 ? ESTADO.atencion : ESTADO.ok
  const origen = c.origen === 'fuentes'
    ? `${c.fuentes.activas} fuente${c.fuentes.activas === 1 ? '' : 's'} activa${c.fuentes.activas === 1 ? '' : 's'}`
    : `Desde ${c.general?.nombre ?? 'la caja general'}`
  const v = (n: number) => (def ? money(n) : '—')
  const celdas: [string, string, string | undefined, string][] = [
    ['Presupuesto consolidado', v(P), undefined, c.origen === 'fuentes' ? 'Suma de lo que aportan las fuentes activas en el período.' : 'Presupuesto de la caja general en el período (suma los meses si abarca varios).'],
    ['Gastado del período', money(c.gastadoPeriodo), '#E8664F', 'Todos los gastos activos del período, cada uno una sola vez. No aplica filtros de ámbito, categoría o medio.'],
    ['Disponible consolidado', v(c.disponible), c.disponible < 0 ? ESTADO.alerta : ESTADO.ok, 'Presupuesto consolidado − gastado del período.'],
    ['Reservado en subcajas', money(c.reservado), '#6D5DD3', 'Suma de lo asignado a las subcajas activas. No es dinero adicional.'],
    ['Libre inicial', v(c.libreInicial), c.libreInicial < 0 ? ESTADO.alerta : undefined, 'Presupuesto consolidado − reservado.'],
    ['Gastado fuera de reservas', money(c.gastadoLibre), '#E8664F', 'Gastos que no caen en ninguna subcaja activa.'],
    ['Saldo libre actual', v(c.saldoLibre), c.saldoLibre < 0 ? ESTADO.alerta : ESTADO.ok, 'Libre inicial − gastado fuera de reservas − excesos de subcajas.'],
    ['Consumido', c.pct === null ? '—' : `${c.pct}%`, tono, 'Gastado del período ÷ presupuesto consolidado.'],
  ]
  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04),0_8px_24px_rgb(15_23_42/0.05)]" aria-label="Presupuesto consolidado" data-testid="caja-general">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-[linear-gradient(120deg,#294690,#4F6FC8)] px-4 py-3.5 text-white sm:px-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/15"><Lock className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-base font-semibold">Presupuesto consolidado
            <span className="rounded-full bg-white/15 [&_button]:text-white [&_button:hover]:bg-white/20">
              <InfoTooltip title="Cómo se calcula" align="left">
                <p>Presupuesto consolidado = suma de lo que aportan las fuentes activas del período (sin fuentes: la caja general).</p>
                <p>Las subcajas reservan parte de ese dinero: no se suman. Cada gasto cuenta una sola vez y cae como máximo en una subcaja.</p>
                <p>Disponible consolidado = presupuesto − gastado. Saldo libre = libre inicial − gastado fuera de reservas − excesos. Siempre se cumple: disponible = saldo libre + reservas sin usar.</p>
              </InfoTooltip>
            </span>
          </p>
          <p className="truncate text-xs text-white/75" data-testid="consolidado-subtitulo">{origen} · {periodo}</p>
        </div>
        <div className="order-last flex w-full items-end justify-between gap-4 sm:order-none sm:w-auto sm:justify-end">
          <div className="text-left sm:text-right">
            <p className="text-[11px] text-white/75">Disponible consolidado</p>
            <p className="tabular text-2xl font-bold" data-testid="disponible-consolidado">{v(c.disponible)}</p>
          </div>
        </div>
        {accion}
      </div>
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4" data-testid="consolidado">
        {celdas.map(([l, val, color, ayuda]) => (
          <div key={l} className="bg-card px-4 py-2.5" title={ayuda} data-testid={`cons-${l.toLowerCase().replace(/\s+/g, '-')}`}>
            <p className="text-[11px] text-muted">{l}</p>
            <p className="tabular text-sm font-bold" style={{ color: color ?? 'var(--ink)' }}>{val}</p>
          </div>
        ))}
      </div>
      {P > 0 && (
        <div className="px-4 py-3 sm:px-5">
          <div className="flex h-3 overflow-hidden rounded-full bg-bg" role="img"
            aria-label={`Gastado fuera de reservas ${money(c.gastadoLibre)}, gastado en subcajas ${money(c.gastadoSubcajas)}, reservas sin usar ${money(c.reservasSinUsar)}`}>
            <span className="bar-grow h-full bg-coral" style={{ width: seg(c.gastadoLibre) }} />
            <span className="bar-grow h-full bg-morado" style={{ width: seg(c.gastadoSubcajas) }} />
            <span className="bar-grow h-full bg-morado/25" style={{ width: seg(c.reservasSinUsar) }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-coral" /> Gastado fuera <b className="tabular text-ink">{money(c.gastadoLibre)}</b></span>
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-morado" /> En subcajas <b className="tabular text-ink">{money(c.gastadoSubcajas)}</b></span>
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-morado/25" /> Reservas sin usar <b className="tabular text-ink">{money(c.reservasSinUsar)}</b></span>
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-bg ring-1 ring-line" /> Libre</span>
          </div>
          {c.sobreasignado && <p className="mt-2 flex items-center gap-1.5 text-xs font-medium" style={{ color: ESTADO.atencion }}><AlertTriangle className="size-3.5" /> Las reservas ({money(c.reservado)}) superan el presupuesto consolidado.</p>}
        </div>
      )}
    </section>
  )
}
