import { useMemo, useState } from 'react'
import { Activity, Baby, Calculator, CalendarDays, Car, Cloud, FilterX, Hash, Layers, Pencil, Percent, PiggyBank, TrendingUp, Trophy, Wallet } from 'lucide-react'
import { aggregate, type CajaResumen } from '../lib/engine'
import { formatMoney, ratesFromConfig } from '../lib/money'
import { monthLabel, todayIn } from '../lib/dates'
import type { AppStore } from '../lib/store'
import type { Caja, Filters } from '../lib/types'
import { TIPOS_GASTO } from '../lib/types'
import { AcumuladoChart, AmbitoDonut, FrecuenciaChart, HBars, Jerarquia, MesesChart, SankeyChart } from '../components/charts'
import { Button, Card, ErrorBox, Field, inputCls, Modal, Select, Skeleton } from '../components/ui'
import { catalogOptions, emptyFilters, MonthNav } from '../components/shared'

const cajaIcon = (c: Caja) => c.id === 'auto' ? <Car className="size-4" /> : c.id === 'bebe' ? <Baby className="size-4" /> : c.id === 'plan-nube' ? <Cloud className="size-4" /> : <Wallet className="size-4" />

export default function Dashboard({ store }: { store: AppStore }) {
  const tz = store.data?.config.zona_horaria || 'America/Lima'
  const today = todayIn(tz)
  const [filters, setFilters] = useState<Filters>(() => emptyFilters(today.slice(0, 7)))
  const [tab, setTab] = useState<'jerarquia' | 'sankey' | 'frecuencia' | 'medios'>('jerarquia')
  const [editCaja, setEditCaja] = useState<CajaResumen | null>(null)
  const base = store.data?.config.moneda || 'PEN'
  const set = (patch: Partial<Filters>) => setFilters(f => ({ ...f, ...patch }))

  const opts = catalogOptions(store, filters.ambito, filters.categoria)
  const medios = (store.data?.medios ?? []).filter(m => m.activo).map(m => m.nombre)
  const ambitoOrder = catalogOptions(store, '', '').ambitos

  // Una sola agregación por combinación de filtros; todos los KPIs y gráficos la reutilizan.
  const a = useMemo(() => store.data && aggregate(store.data.gastos, filters, {
    base, rates: ratesFromConfig(store.data.config), today, cajas: store.data.cajas, presupuestos: store.data.presupuestos,
  }), [store.data, filters, base, today])

  const money = (c: number) => formatMoney(c, base)
  const hasDims = filters.ambito || filters.categoria || filters.subcategoria || filters.medioPago || filters.tipoGasto

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Periodo"><MonthNav value={filters.periodo} onChange={periodo => set({ periodo })} /></Field>
          <Field label="Ámbito"><Select label="Ámbito" value={filters.ambito} onChange={ambito => set({ ambito, categoria: '', subcategoria: '' })} options={opts.ambitos} placeholder="Todos" /></Field>
          <Field label="Categoría"><Select label="Categoría" value={filters.categoria} onChange={categoria => set({ categoria, subcategoria: '' })} options={opts.categorias} placeholder="Todas" /></Field>
          <Field label="Subcategoría"><Select label="Subcategoría" value={filters.subcategoria} onChange={subcategoria => set({ subcategoria })} options={opts.subcategorias} placeholder="Todas" /></Field>
          <Field label="Medio de pago"><Select label="Medio de pago" value={filters.medioPago} onChange={medioPago => set({ medioPago })} options={medios} placeholder="Todos" /></Field>
          <Field label="Tipo de gasto"><Select label="Tipo de gasto" value={filters.tipoGasto} onChange={tipoGasto => set({ tipoGasto })} options={[...TIPOS_GASTO]} placeholder="Todos" /></Field>
          <Button variant="ghost" onClick={() => setFilters(emptyFilters(today.slice(0, 7)))} disabled={!hasDims && filters.periodo === today.slice(0, 7)}>
            <FilterX className="size-4" /> Restablecer
          </Button>
        </div>
      </Card>

      {store.error && !store.data && <ErrorBox message={store.error} onRetry={store.refresh} />}

      {!a ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} />)}</div>
      ) : (
        <>
          {a.excluidosSinTipoCambio > 0 && (
            <ErrorBox message={`${a.excluidosSinTipoCambio} movimiento(s) en otra moneda no se incluyen porque falta su tipo de cambio en Configuración.`} />
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi icon={<Wallet />} label="Caja mensual" value={a.cajaMensual ? money(a.cajaMensual) : 'Sin presupuesto'} tone="navy" />
            <Kpi icon={<TrendingUp />} label="Total gastado" value={money(a.total)} tone="turquesa" />
            <Kpi icon={<PiggyBank />} label="Disponible" value={a.cajaMensual ? money(a.disponible) : '—'} tone={a.disponible < 0 ? 'red' : 'lima'} />
            <Kpi icon={<Percent />} label="Consumido" value={a.consumidoPct === null ? '—' : `${a.consumidoPct}%`} tone="morado" />
            <Kpi icon={<CalendarDays />} label="Promedio diario" value={money(a.promedioDiario)} hint={a.diasPeriodo ? `${a.diasPeriodo} días` : 'Mes futuro'} />
            <Kpi icon={<Calculator />} label="Promedio por movimiento" value={money(a.promedioMovimiento)} />
            <Kpi icon={<Trophy />} label="Mayor gasto" value={a.max ? money(a.maxCents) : '—'} hint={a.max ? (a.max.descripcion || a.max.categoria) : undefined} />
            <Kpi icon={<Hash />} label="Movimientos" value={String(a.count)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {a.cajas.map(c => (
              <Card key={c.caja.id} title={c.caja.nombre} icon={<span style={{ color: c.caja.color }}>{cajaIcon(c.caja)}</span>}
                action={<Button variant="ghost" aria-label={`Ajustar ${c.caja.nombre}`} onClick={() => setEditCaja(c)}><Pencil className="size-3.5" /></Button>}>
                <dl className="grid grid-cols-3 gap-x-2 gap-y-1 text-xs text-muted">
                  <div><dt>Presupuesto</dt><dd className="tabular text-[13px] font-semibold whitespace-nowrap text-ink">{c.presupuesto ? money(c.presupuesto) : '—'}</dd></div>
                  <div><dt>Gastado</dt><dd className="tabular text-[13px] font-semibold whitespace-nowrap text-ink">{money(c.gastado)}</dd></div>
                  <div><dt>Disponible</dt><dd className={`tabular text-[13px] font-semibold whitespace-nowrap ${c.disponible < 0 ? 'text-red-600' : 'text-ink'}`}>{c.presupuesto ? money(c.disponible) : '—'}</dd></div>
                </dl>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.pct ?? 0} aria-label={`Consumido ${c.caja.nombre}`}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(c.pct ?? 0, 100)}%`, background: (c.pct ?? 0) > 100 ? '#dc2626' : c.caja.color }} />
                </div>
                <p className="mt-1 text-right text-xs text-muted">{c.pct === null ? 'Presupuesto no configurado' : `${c.pct}% consumido`}</p>
              </Card>
            ))}
          </div>
          <p className="-mt-2 text-xs text-muted">Las cajas usan solo el periodo; Auto, Bebé y Plan Nube son partes de la caja general, no gastos adicionales.</p>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title={`Gasto acumulado — ${monthLabel(filters.periodo, true)}`} icon={<Activity className="size-4 text-turquesa" />} className="lg:col-span-2">
              <AcumuladoChart a={a} currency={base} />
            </Card>
            <Card title="Últimos 6 meses" icon={<CalendarDays className="size-4 text-turquesa" />}>
              <MesesChart a={a} currency={base} />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Distribución por ámbito" action={filters.ambito && <Button variant="ghost" onClick={() => set({ ambito: '', categoria: '', subcategoria: '' })}>Quitar filtro</Button>}>
              <AmbitoDonut items={a.porAmbito} order={ambitoOrder} currency={base}
                selected={filters.ambito} total={a.total} onSelect={ambito => set({ ambito, categoria: '', subcategoria: '' })} />
            </Card>
            <Card title="Top categorías"><HBars items={a.porCategoria.slice(0, 8)} currency={base} label="Top categorías" /></Card>
          </div>
          <Card title="Top 10 subcategorías"><HBars items={a.porSubcategoria} currency={base} color="var(--s3)" label="Top subcategorías" /></Card>

          <Card title="Análisis detallado" icon={<Layers className="size-4 text-morado" />}>
            <div role="tablist" className="mb-3 flex flex-wrap gap-1">
              {([['jerarquia', 'Ámbito → categoría → subcategoría'], ['sankey', 'Flujo de medios de pago'], ['frecuencia', 'Frecuencia vs monto'], ['medios', 'Por medio de pago']] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${tab === id ? 'bg-navy text-white' : 'text-muted hover:bg-bg'}`}>{label}</button>
              ))}
            </div>
            {tab === 'jerarquia' && <Jerarquia a={a} currency={base} />}
            {tab === 'sankey' && <SankeyChart a={a} currency={base} />}
            {tab === 'frecuencia' && <FrecuenciaChart a={a} currency={base} />}
            {tab === 'medios' && <HBars items={a.porMedio} currency={base} color="var(--s7)" label="Distribución por medio de pago" />}
          </Card>
        </>
      )}

      <CajaModal store={store} resumen={editCaja} periodo={filters.periodo} onClose={() => setEditCaja(null)} />
    </div>
  )
}

const tones: Record<string, string> = {
  navy: 'bg-navy/10 text-navy dark:text-blue-300', turquesa: 'bg-turquesa/10 text-turquesa', lima: 'bg-lima/10 text-lima',
  morado: 'bg-morado/10 text-morado', red: 'bg-red-500/10 text-red-600', default: 'bg-bg text-muted',
}

function Kpi({ icon, label, value, hint, tone = 'default' }: { icon: React.ReactElement; label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3 shadow-sm">
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl [&>svg]:size-4.5 ${tones[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="tabular truncate text-base font-semibold text-ink">{value}</p>
        {hint && <p className="truncate text-[11px] text-muted" title={hint}>{hint}</p>}
      </div>
    </div>
  )
}

function CajaModal({ store, resumen, periodo, onClose }: { store: AppStore; resumen: CajaResumen | null; periodo: string; onClose: () => void }) {
  const [monto, setMonto] = useState('')
  const [soloMes, setSoloMes] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lastId, setLastId] = useState('')
  if (resumen && resumen.caja.id !== lastId) {
    setLastId(resumen.caja.id)
    setMonto(String(resumen.presupuesto / 100))
    setSoloMes(false)
    setError('')
  }
  async function save() {
    const n = Number(monto)
    if (!Number.isFinite(n) || n < 0) return setError('Ingresa un monto válido.')
    setSaving(true)
    try {
      if (soloMes) await store.actions.savePresupuesto({ periodo, cajaId: resumen!.caja.id, monto: n })
      else await store.actions.saveCaja({ ...resumen!.caja, presupuesto: n })
      setLastId('')
      onClose()
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  return (
    <Modal open={!!resumen} onClose={() => { setLastId(''); onClose() }} title={`Ajustar ${resumen?.caja.nombre ?? ''}`}>
      <div className="space-y-3">
        <Field label="Presupuesto mensual"><input className={inputCls} type="number" min="0" step="0.01" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={soloMes} onChange={e => setSoloMes(e.target.checked)} /> Solo para {monthLabel(periodo, true)}</label>
        {resumen && resumen.caja.filtroCampo !== 'Todos' && <p className="text-xs text-muted">Incluye gastos con {resumen.caja.filtroCampo} = “{resumen.caja.filtroValor}”. Cámbialo en Configuración.</p>}
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={save}>Guardar</Button></div>
      </div>
    </Modal>
  )
}
