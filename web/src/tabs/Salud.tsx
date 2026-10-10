import { useMemo } from 'react'
import { useAgregado } from '../lib/useAgregado'
import { HeartPulse, SlidersHorizontal } from 'lucide-react'
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
  const catalogo = useMemo(() => data?.catalogo ?? [], [data?.catalogo])
  const medios = (data?.medios ?? []).filter(m => m.activo).map(m => m.nombre)
  const gastos = data?.gastos
  // Mismo motor y mismo contexto (fuentes, cajas, ajustes) en Dashboard, Cajas y Salud financiera.
  const a = useAgregado(data, filters, today)
  const activos = [...filters.ambitos, ...filters.categorias, ...filters.subcategorias.map(x => x.split(' › ').at(-1) ?? x), ...filters.medios, ...filters.tipos]

  return (
    <div className="space-y-4">
      {/* Cabecera del módulo: título, propósito, período y filtros activos */}
      <div className="relative overflow-hidden rounded-3xl border border-line p-5 sm:p-6"
        style={{ background: 'radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, #E8664F 12%, var(--card)) 0%, var(--card) 45%), radial-gradient(90% 120% at 100% 100%, color-mix(in srgb, #8B7CF6 12%, var(--card)) 0%, transparent 60%)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-card text-coral shadow-sm ring-1 ring-line"><HeartPulse className="size-6" /></span>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink">Salud financiera
                <InfoTooltip title="Salud financiera" align="left">
                  <p>Responde tres preguntas: cuánto puedes gastar todavía, qué gastos están aumentando y cuánto necesitas reservar para tus compromisos. Además evalúa la calidad de tus datos.</p>
                  <p>Usa los datos ya cargados y el mismo filtro de período del Dashboard y Gastos: no hace consultas adicionales a tu hoja y nunca modifica movimientos.</p>
                </InfoTooltip>
              </h1>
              <p className="mt-0.5 text-sm text-muted">Controla tu presupuesto, revisa la calidad de tus datos y detecta oportunidades de ahorro.</p>
            </div>
          </div>
        </div>
        {activos.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="flex items-center gap-1 font-medium text-muted"><SlidersHorizontal className="size-3.5" /> Filtros:</span>
            {activos.slice(0, 6).map(x => <span key={x} className="rounded-full bg-card px-2 py-0.5 font-medium text-ink ring-1 ring-line">{x}</span>)}
            {activos.length > 6 && <span className="text-muted">+{activos.length - 6}</span>}
          </div>
        )}
      </div>
      <FilterBar filters={filters} setFilters={setFilters} catalogo={catalogo} medios={medios} today={today} gastos={gastos} />
      {store.error && !data && <ErrorBox message={store.error} onRetry={store.refresh} />}
      {!a ? <Skeleton className="h-96" /> : (
        <SaludFinanciera store={store} a={a} filters={filters} today={today} onRevisarGasto={onRevisarGasto} onGastosMensuales={onGastosMensuales} />
      )}
    </div>
  )
}
