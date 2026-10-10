import { useMemo } from 'react'
import { CalendarDays, HeartPulse } from 'lucide-react'
import { aggregate } from '../lib/engine'
import { ratesFromConfig } from '../lib/money'
import { formatDate, rangeLabel } from '../lib/dates'
import type { AppStore } from '../lib/store'
import type { Filters, Gasto } from '../lib/types'
import SaludFinanciera from '../components/SaludFinanciera'
import { FilterBar } from '../components/shared'
import { ErrorBox, InfoTooltip, Skeleton } from '../components/ui'

/**
 * Pestaña Salud financiera. Usa los mismos datos en memoria y el mismo filtro global que Dashboard y Gastos
 * (no hay estados duplicados ni lecturas nuevas). Sus cálculos solo corren mientras esta pestaña está abierta.
 */
export default function Salud({ store, filters, setFilters, today, onRevisarGasto, onGastosMensuales }: {
  store: AppStore; filters: Filters; setFilters: (f: Filters) => void; today: string
  onRevisarGasto: (g: Gasto) => void; onGastosMensuales: () => void
}) {
  const data = store.data
  const base = data?.config.moneda || 'PEN'
  const catalogo = useMemo(() => data?.catalogo ?? [], [data?.catalogo])
  const medios = (data?.medios ?? []).filter(m => m.activo).map(m => m.nombre)
  const gastos = data?.gastos, config = data?.config, cajas = data?.cajas, presupuestos = data?.presupuestos
  // Mismo motor que el Dashboard (presupuesto, cajas y ajustes mensuales); aquí solo se calcula al abrir la pestaña.
  const a = useMemo(() => gastos && config && cajas && presupuestos ? aggregate(gastos, filters, {
    base, rates: ratesFromConfig(config), today, cajas, presupuestos,
  }) : null, [gastos, config, cajas, presupuestos, filters, base, today])
  const fmt = config?.formato_fecha

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-ink"><HeartPulse className="size-5 text-coral" /> Salud financiera
            <InfoTooltip title="Salud financiera" align="left">
              <p>Responde tres preguntas: cuánto puedes gastar todavía, qué gastos están aumentando y cuánto necesitas reservar para tus compromisos. Además evalúa la calidad de tus datos.</p>
              <p>Usa los datos ya cargados y el mismo filtro de período del Dashboard y Gastos: no hace consultas adicionales a tu hoja y nunca modifica movimientos.</p>
            </InfoTooltip>
          </h1>
          <p className="text-xs text-muted">Analiza la calidad de tus datos, controla tu presupuesto y descubre oportunidades de ahorro.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-navy" data-testid="salud-periodo">
          <CalendarDays className="size-3.5" /> <span className="first-letter:uppercase">{rangeLabel(filters)}</span>
          <span className="hidden text-muted sm:inline">· {formatDate(filters.desde, fmt)} – {formatDate(filters.hasta, fmt)}</span>
        </span>
      </div>
      <FilterBar filters={filters} setFilters={setFilters} catalogo={catalogo} medios={medios} today={today} gastos={gastos} />
      {store.error && !data && <ErrorBox message={store.error} onRetry={store.refresh} />}
      {!a ? <Skeleton className="h-96" /> : (
        <SaludFinanciera store={store} a={a} filters={filters} today={today} onRevisarGasto={onRevisarGasto} onGastosMensuales={onGastosMensuales} />
      )}
    </div>
  )
}
