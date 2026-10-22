import { useCallback } from 'react'
import { PiggyBank } from 'lucide-react'
import { useAgregado } from '../lib/useAgregado'
import type { PresupuestoResumen } from '../lib/engine'
import { formatMoney } from '../lib/money'
import { formatDate, monthLabel, rangeLabel, singleMonth } from '../lib/dates'
import type { AppStore } from '../lib/store'
import type { Filters } from '../lib/types'
import { PeriodPicker } from '../components/shared'
import { FondosSeccion, type AccionesFondos } from '../components/fondos'
import { BarraPlan, type PlanificacionApi } from '../components/Planificacion'
import { usePlantillasFin } from '../components/PlantillasFin'
import { BotonMensual, BotonNuevo, Skeleton } from '../components/ui'

/**
 * Pestaña Presupuestos (v1.28, antes "Cajas"). Los fondos del presupuesto son la única estructura: suman el presupuesto
 * consolidado y reparten los gastos según sus reglas. Reutiliza el mismo motor que el Dashboard y Salud financiera.
 */
export default function Presupuestos({ store, filters, setFilters, today, plan }: { plan: PlanificacionApi; store: AppStore; filters: Filters; setFilters: (f: Filters) => void; today: string }) {
  const data = store.data
  const base = data?.config.moneda || 'PEN'
  const money = useCallback((c: number) => formatMoney(c, base), [base])
  const a = useAgregado(data, filters, today)
  const mes = singleMonth(filters.desde, filters.hasta)
  const plantillas = usePlantillasFin(store, today.slice(0, 7))
  if (!data || !a) return <Skeleton className="h-96" />
  const p = a.presupuesto
  const periodo = mes ? monthLabel(mes, true) : rangeLabel(filters)
  return (
    <div className="space-y-4">
      <FondosSeccion plan={plan} plantillas={plantillas} store={store} p={p} filters={filters} mes={mes} money={money} periodo={periodo} hoyMes={today.slice(0, 7)}
        cabecera={acc => (
          <>
            <Cabecera p={p} money={money} filters={filters} setFilters={setFilters} today={today} acciones={acc} />
            {mes && <BarraPlan store={store} hoy={today} mes={mes} plan={plan} />}
          </>
        )} />
      {plantillas.nodo}
    </div>
  )
}

function Cabecera({ p, money, filters, setFilters, today, acciones }: {
  p: PresupuestoResumen; money: (n: number) => string; filters: Filters; setFilters: (f: Filters) => void; today: string; acciones: AccionesFondos
}) {
  const n = p.fondos.length
  const exceso = p.exceso > 0
  return (
    <div className="relative overflow-hidden rounded-3xl border border-line p-5 sm:p-6"
      style={{ background: 'radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, #10B981 12%, var(--card)) 0%, var(--card) 45%), radial-gradient(90% 120% at 100% 100%, color-mix(in srgb, #4F7BE8 12%, var(--card)) 0%, transparent 60%)' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-card text-success shadow-sm ring-1 ring-line"><PiggyBank className="size-6" /></span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-ink">Presupuestos</h1>
            <p className="mt-0.5 text-sm text-muted">Administra tus fondos y controla cómo se distribuyen tus gastos</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <BotonNuevo onClick={acciones.nuevo}>Nuevo fondo</BotonNuevo>
          <BotonMensual onClick={acciones.mensuales}>Fondos mensuales</BotonMensual>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-72"><PeriodPicker value={filters} today={today} onChange={x => setFilters({ ...filters, ...x })} /></div>
        <span className="text-[11px] text-muted">{formatDate(filters.desde)} – {formatDate(filters.hasta)} · {n} fondo{n === 1 ? '' : 's'}</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="presupuestos-resumen">
        <Mini label="Presupuesto consolidado" value={money(p.presupuesto)} />
        <Mini label="Gastado" value={money(p.gastadoPeriodo)} tone="#E8664F" />
        <Mini label={exceso ? 'Excedido' : 'Disponible'} value={money(exceso ? p.exceso : p.disponible)} tone={exceso ? 'var(--danger)' : 'var(--success)'} />
        <Mini label="Sin fondo asignable" value={p.sinFondo.count ? `${money(p.sinFondo.cents)} · ${p.sinFondo.count}` : money(0)} tone={p.sinFondo.count ? 'var(--warning)' : undefined} />
      </dl>
    </div>
  )
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-card/80 px-3 py-2.5 ring-1 ring-line">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="tabular truncate text-base font-bold" style={tone ? { color: tone } : undefined}>{value}</dd>
    </div>
  )
}
