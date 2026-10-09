import { useMemo, useState, type ReactNode } from 'react'
import {
  Activity, AlertTriangle, Baby, Calculator, CalendarDays, Car, CircleDollarSign, Cloud, GitFork, Hash, Layers, Lock, Pencil,
  Percent, PieChart as PieIcon, PiggyBank, Plus, Shapes, Tag, Target, TrendingUp, Trophy, Wallet,
} from 'lucide-react'
import { aggregate, subKey, type CajasResumen, type SubcajaResumen } from '../lib/engine'
import { formatMoney, ratesFromConfig } from '../lib/money'
import { formatDate, monthLabel, rangeLabel, singleMonth } from '../lib/dates'
import type { AppStore } from '../lib/store'
import type { Caja, Filters } from '../lib/types'
import { categoriaLook, medioLook } from '../lib/visual'
import { AcumuladoChart, AmbitoDonut, BarList, FrecuenciaChart, Jerarquia, SankeyChart, SubLabel } from '../components/charts'
import { Button, Card, ErrorBox, Field, IconButton, InfoTooltip, inputCls, Modal, Skeleton, Switch } from '../components/ui'
import { FilterBar } from '../components/shared'

const toggle = (xs: string[], v: string) => (xs.includes(v) ? xs.filter(x => x !== v) : [...xs, v])

const cajaIcon = (c: Caja) => {
  const k = `${c.id} ${c.filtroValor}`.toLowerCase()
  return k.includes('auto') ? Car : k.includes('beb') ? Baby : k.includes('nube') ? Cloud : Wallet
}

export default function Dashboard({ store, filters, setFilters, today, onNuevoGasto }: {
  store: AppStore; filters: Filters; setFilters: (f: Filters) => void; today: string; onNuevoGasto: () => void
}) {
  const [tab, setTab] = useState<'jerarquia' | 'sankey' | 'frecuencia' | 'medios'>('jerarquia')
  const [editCaja, setEditCaja] = useState<{ caja: Caja; asignado: number } | null>(null)
  const data = store.data
  const base = data?.config.moneda || 'PEN'
  const catalogo = useMemo(() => data?.catalogo ?? [], [data?.catalogo])
  const medios = (data?.medios ?? []).filter(m => m.activo).map(m => m.nombre)

  // Una sola agregación por combinación de filtros; KPIs, cajas y gráficos reutilizan este resultado.
  const a = useMemo(() => data && aggregate(data.gastos, filters, {
    base, rates: ratesFromConfig(data.config), today, cajas: data.cajas, presupuestos: data.presupuestos,
  }), [data, filters, base, today])

  const money = (c: number) => formatMoney(c, base)
  const mes = singleMonth(filters.desde, filters.hasta)
  const periodoTxt = mes ? monthLabel(mes, true) : 'el período elegido'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Resumen</h1>
          <p className="truncate text-xs text-muted first-letter:uppercase">{mes ? monthLabel(mes, true) : rangeLabel(filters)}</p>
        </div>
        {/* Abre el mismo formulario de la pestaña Gastos (un solo modal en toda la app). */}
        <Button onClick={onNuevoGasto} disabled={!data} className="shrink-0"><Plus className="size-4" /> Nuevo gasto</Button>
      </div>
      <FilterBar filters={filters} setFilters={setFilters} catalogo={catalogo} medios={medios} today={today} gastos={store.data?.gastos} />

      {store.error && !data && <ErrorBox message={store.error} onRetry={store.refresh} />}

      {!a ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <>
          {a.excluidosSinTipoCambio > 0 && (
            <ErrorBox tone="warning" message={`${a.excluidosSinTipoCambio} movimiento(s) en otra moneda no se suman porque falta su tipo de cambio en Configuración.`} />
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi tone="blue" icon={<Wallet />} label="Caja mensual" value={a.cajas.presupuesto ? money(a.cajas.presupuesto) : 'Sin definir'}
              hint={a.cajas.presupuesto ? `Reservado ${money(a.cajas.reservado)}` : 'Defínela en la caja general'}
              info={<><p>Presupuesto total de la caja general para {periodoTxt}. Si el período abarca varios meses, suma el presupuesto de cada mes.</p><p>Las subcajas (Auto, Bebé, Plan Nube) son reservas dentro de este monto, no dinero adicional.</p></>} />
            <Kpi tone="coral" icon={<TrendingUp />} label="Total gastado" value={money(a.total)}
              hint={a.filtrado ? `De ${money(a.totalPeriodo)} en el período` : `${a.count} movimientos`}
              info={<><p>Suma de los gastos activos del período con todos los filtros aplicados. Los eliminados no cuentan.</p><p>Montos en otra moneda se convierten con el tipo de cambio de Configuración.</p></>} />
            <Kpi tone={a.cajas.disponible < 0 ? 'red' : 'green'} icon={<PiggyBank />} label="Disponible" value={a.cajas.presupuesto ? money(a.cajas.disponible) : '—'}
              hint={a.cajas.presupuesto ? `Saldo libre ${money(a.cajas.saldoLibre)}` : undefined} tag={a.filtrado ? 'Período completo' : undefined}
              info={<><p>Disponible = Caja mensual − todo lo gastado en el período (en subcajas y fuera de ellas).</p><p>Saldo libre = lo que queda fuera de las reservas de subcajas. No cambia con los filtros de categoría, ámbito o medio, porque el presupuesto es del período completo.</p></>} />
            <Kpi tone="violet" icon={<Percent />} label="Consumido" value={a.cajas.pct === null ? '—' : `${a.cajas.pct}%`} progress={a.cajas.pct}
              tag={a.filtrado ? 'Período completo' : undefined}
              info={<p>Porcentaje de la caja mensual ya gastado: gasto del período ÷ caja mensual × 100. Pasa de 100% si te excedes.</p>} />
            <Kpi tone="sky" icon={<CalendarDays />} label="Promedio diario" value={money(a.promedioDiario)}
              hint={a.estado === 'futuro' ? 'El período aún no comienza' : `${a.diasPeriodo} días ${a.estado === 'en-curso' ? 'transcurridos' : 'del período'}`}
              info={<p>Total gastado ÷ días. Si el período está en curso, cuenta solo los días hasta hoy; si ya terminó, todos sus días.</p>} />
            <Kpi tone="sky" icon={<Calculator />} label="Promedio por movimiento" value={money(a.promedioMovimiento)} hint="Ticket promedio"
              info={<p>Total gastado ÷ cantidad de movimientos activos con los filtros elegidos.</p>} />
            <Kpi tone="coral" icon={<Trophy />} label="Mayor gasto" value={a.max ? money(a.maxCents) : '—'}
              hint={a.max ? `${a.max.descripcion || a.max.subcategoria || a.max.categoria} · ${formatDate(a.max.fecha, data!.config.formato_fecha)}` : undefined}
              info={<p>El movimiento individual más alto del período con los filtros elegidos.</p>} />
            <Kpi tone="blue" icon={<Hash />} label="Movimientos" value={String(a.count)}
              hint={a.count ? `${new Set(data!.gastos.filter(g => g.estado === 'Activo' && g.fecha >= filters.desde && g.fecha <= filters.hasta).map(g => g.fecha)).size} días con gastos` : undefined}
              info={<p>Cantidad de gastos activos que cumplen los filtros.</p>} />
          </div>

          <Cajas c={a.cajas} money={money} onEdit={(caja, asignado) => setEditCaja({ caja, asignado })} periodo={periodoTxt} />

          <Card title={`Gasto acumulado — ${periodoTxt}`} icon={<Activity className="size-4 text-navy" />}
            info={{ title: 'Gasto acumulado', body: <>
              <p>Cómo evoluciona tu gasto a lo largo del período. La línea azul es el gasto real acumulado día a día.</p>
              <p>La línea punteada gris (ritmo ideal) reparte la caja mensual de forma pareja hasta el último día: si la azul va por encima, gastas más rápido de lo planeado.</p>
              <p>La línea coral (proyección) solo aparece en un período en curso: extiende tu promedio diario actual hasta el cierre.</p>
              <p>Abajo, el gasto de cada día. Aplican todos los filtros.</p></> }}>
            <AcumuladoChart a={a} currency={base} dateFormat={data!.config.formato_fecha} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Distribución por ámbito" icon={<PieIcon className="size-4 text-morado" />}
              info={{ title: 'Distribución por ámbito', body: <>
                <p>Qué parte de tu gasto corresponde a Personal, Trabajo, Pareja, Familia y Amigos, con los filtros elegidos.</p>
                <p>Pasa el cursor (o toca) un sector para ver monto, porcentaje y movimientos. Haz clic para filtrar todo el dashboard por ese ámbito; otro clic lo quita.</p></> }}>
              <AmbitoDonut items={a.porAmbito} catalogo={catalogo} currency={base} total={a.total} selected={filters.ambitos}
                onToggle={v => setFilters({ ...filters, ambitos: toggle(filters.ambitos, v) })} />
            </Card>
            <Card title="Top 5 categorías" icon={<Shapes className="size-4 text-coral" />}
              info={{ title: 'Top 5 categorías', body: <>
                <p>Las 5 categorías en las que más gastaste en el período, de mayor a menor (si hay menos de 5 con gastos, solo esas). Muestra monto, porcentaje sobre el total filtrado y cantidad de movimientos.</p>
                <p>Haz clic en una barra para filtrar por esa categoría.</p></> }}>
              <BarList ariaLabel="Top 5 categorías" items={a.porCategoria.slice(0, 5)} total={a.total} currency={base}
                lookFor={it => categoriaLook(it.name, catalogo)} selected={it => filters.categorias.includes(it.name)}
                onToggle={it => setFilters({ ...filters, categorias: toggle(filters.categorias, it.name) })} />
            </Card>
          </div>

          <Card title="Top 10 subcategorías" icon={<Tag className="size-4 text-turquesa" />}
            info={{ title: 'Top 10 subcategorías', body: <>
              <p>Las 10 subcategorías con más gasto, de mayor a menor. Cada una se identifica por categoría + subcategoría, así "Otros" de Alimentación y "Otros" de Auto no se mezclan.</p>
              <p>Haz clic para filtrar el dashboard y la tabla de gastos por esa subcategoría.</p></> }}>
            <BarList ariaLabel="Top 10 subcategorías" items={a.porSubcategoria} total={a.total} currency={base}
              lookFor={it => categoriaLook(it.categoria, catalogo)} selected={it => filters.subcategorias.includes(it.key)}
              onToggle={it => setFilters({ ...filters, subcategorias: toggle(filters.subcategorias, subKey(it.categoria, it.subcategoria === 'Sin subcategoría' ? '' : it.subcategoria)) })}
              renderLabel={it => <SubLabel it={it} />} />
          </Card>

          <Card title="Análisis detallado" icon={<Layers className="size-4 text-morado" />}
            info={{ title: 'Análisis detallado', body: <>
              <p><b>Jerarquía:</b> desglose ámbito → categoría → subcategoría.</p>
              <p><b>Flujo de medios de pago:</b> desde qué medio sale el dinero y hacia qué ámbito va. El grosor es el monto.</p>
              <p><b>Frecuencia vs monto:</b> cada punto es una categoría; a la derecha, muchas compras; arriba, mucho dinero. Clic para filtrar.</p>
              <p><b>Por medio de pago:</b> cuánto pagaste con cada medio. Clic para filtrar.</p></> }}>
            <div role="tablist" aria-label="Vistas del análisis" className="mb-4 flex flex-wrap gap-1 rounded-xl bg-bg p-1">
              {([['jerarquia', 'Jerarquía', GitFork], ['sankey', 'Flujo de medios de pago', CircleDollarSign], ['frecuencia', 'Frecuencia vs monto', Target], ['medios', 'Por medio de pago', Wallet]] as const).map(([id, label, Icon]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${tab === id ? 'bg-card text-navy shadow-sm' : 'text-muted hover:text-ink'}`}>
                  <Icon className="size-3.5" />{label}
                </button>
              ))}
            </div>
            {tab === 'jerarquia' && <Jerarquia a={a} currency={base} catalogo={catalogo} />}
            {tab === 'sankey' && <SankeyChart a={a} currency={base} catalogo={catalogo} />}
            {tab === 'frecuencia' && <FrecuenciaChart a={a} currency={base} catalogo={catalogo} onPick={c => setFilters({ ...filters, categorias: toggle(filters.categorias, c) })} />}
            {tab === 'medios' && <BarList ariaLabel="Gasto por medio de pago" items={a.porMedio} total={a.total} currency={base} lookFor={it => medioLook(it.name)}
              selected={it => filters.medios.includes(it.name)} onToggle={it => setFilters({ ...filters, medios: toggle(filters.medios, it.name) })} />}
          </Card>
        </>
      )}

      {editCaja && a && <CajaModal store={store} target={editCaja} cajas={a.cajas} mes={mes} money={money} onClose={() => setEditCaja(null)} />}
    </div>
  )
}

const TONES: Record<string, { tile: string; bar: string }> = {
  blue: { tile: 'bg-primary-soft text-navy', bar: 'bg-navy' },
  coral: { tile: 'bg-coral-soft text-coral', bar: 'bg-coral' },
  green: { tile: 'bg-verde-soft text-verde', bar: 'bg-verde' },
  red: { tile: 'bg-coral-soft text-[#D2463C]', bar: 'bg-[#D2463C]' },
  violet: { tile: 'bg-morado-soft text-morado', bar: 'bg-morado' },
  sky: { tile: 'bg-celeste-soft text-celeste', bar: 'bg-celeste' },
}

function Kpi({ icon, label, value, hint, info, tone, progress, tag }: { icon: ReactNode; label: string; value: string; hint?: string; info: ReactNode; tone: string; progress?: number | null; tag?: string }) {
  const t = TONES[tone]
  return (
    <div className="relative flex flex-col gap-2 rounded-2xl border border-line bg-card p-3.5 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_16px_rgb(15_23_42/0.04)] transition hover:-translate-y-0.5 hover:shadow-md sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <span className={`grid size-9 place-items-center rounded-xl [&>svg]:size-4.5 ${t.tile}`}>{icon}</span>
        <InfoTooltip title={label}>{info}</InfoTooltip>
      </div>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted">{label}{tag && <span className="rounded-full bg-bg px-1.5 py-px text-[10px]">{tag}</span>}</p>
        <p className={`tabular truncate text-lg font-bold tracking-tight sm:text-xl ${tone === 'red' ? 'text-[#D2463C]' : 'text-ink'}`}>{value}</p>
        {hint && <p className="truncate text-[11px] text-muted" title={hint}>{hint}</p>}
      </div>
      {progress != null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-bg" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <div className={`bar-grow h-full rounded-full ${progress > 100 ? 'bg-[#D2463C]' : t.bar}`} style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      )}
    </div>
  )
}

const CAJA_STYLE: Record<string, { bg: string; fg: string }> = {
  auto: { bg: 'linear-gradient(135deg, #F1F5F9, #E2E8F0)', fg: '#475569' },
  bebe: { bg: 'linear-gradient(135deg, #FDF0F6, #FCE1EE)', fg: '#C2457F' },
  nube: { bg: 'linear-gradient(135deg, #F4F1FF, #E9E3FF)', fg: '#6D5BD0' },
}
const styleFor = (c: Caja) => {
  const k = `${c.id} ${c.filtroValor}`.toLowerCase()
  return k.includes('auto') ? CAJA_STYLE.auto : k.includes('beb') ? CAJA_STYLE.bebe : k.includes('nube') ? CAJA_STYLE.nube : { bg: `linear-gradient(135deg, ${c.color}14, ${c.color}29)`, fg: c.color }
}

function Cajas({ c, money, onEdit, periodo }: { c: CajasResumen; money: (n: number) => string; onEdit: (c: Caja, asignado: number) => void; periodo: string }) {
  const P = c.presupuesto
  const seg = (v: number) => `${P ? Math.max(0, Math.min(100, (v / P) * 100)) : 0}%`
  const reservaRestante = Math.max(0, c.reservado - c.gastadoSubcajas + c.excesoSubcajas)
  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_16px_rgb(15_23_42/0.04)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-[linear-gradient(120deg,#294690,#4F6FC8)] px-4 py-3 text-white">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/15"><Wallet className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{c.general?.nombre ?? 'Caja general'}</p>
            <p className="truncate text-xs text-white/75">Presupuesto principal · {periodo}</p>
          </div>
          <div className="order-last w-full text-left sm:order-none sm:w-auto sm:text-right">
            <p className="text-[11px] text-white/75">Disponible global</p>
            <p className="tabular text-xl font-bold">{P ? money(c.disponible) : 'Sin definir'}</p>
          </div>
          <div className="flex items-center gap-1">
            {c.general && <button type="button" onClick={() => onEdit(c.general!, P)} className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 px-3 py-1.5 text-xs font-medium whitespace-nowrap hover:bg-white/10"><Pencil className="size-3.5" /> Ajustar caja</button>}
            <InfoBadge />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-5">
          {[
            ['Presupuesto (P)', P ? money(P) : '—', ''],
            ['Reservado en subcajas', money(c.reservado), 'text-morado'],
            ['Libre inicial (P − R)', P ? money(c.libreInicial) : '—', ''],
            ['Gastado fuera de subcajas', money(c.gastadoLibre), 'text-coral'],
            ['Saldo libre actual', P ? money(c.saldoLibre) : '—', c.saldoLibre < 0 ? 'text-[#D2463C]' : 'text-verde'],
          ].map(([l, v, cls], i) => (
            <div key={l} className={`bg-card px-4 py-3 ${i === 4 ? 'col-span-2 sm:col-span-1' : ''}`}>
              <p className="text-[11px] text-muted">{l}</p>
              <p className={`tabular text-sm font-semibold ${cls || 'text-ink'}`}>{v}</p>
            </div>
          ))}
        </div>
        {P > 0 && (
          <div className="px-4 py-3">
            <div className="flex h-3 overflow-hidden rounded-full bg-bg" role="img"
              aria-label={`Gastado libre ${money(c.gastadoLibre)}, gastado en subcajas ${money(c.gastadoSubcajas)}, reservas sin usar ${money(reservaRestante)}`}>
              <span className="bar-grow h-full bg-coral" style={{ width: seg(c.gastadoLibre) }} />
              <span className="bar-grow h-full bg-morado" style={{ width: seg(c.gastadoSubcajas) }} />
              <span className="bar-grow h-full bg-morado/25" style={{ width: seg(reservaRestante) }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
              <span className="flex items-center gap-1"><i className="size-2 rounded-full bg-coral" /> Gastado libre</span>
              <span className="flex items-center gap-1"><i className="size-2 rounded-full bg-morado" /> Gastado en subcajas</span>
              <span className="flex items-center gap-1"><i className="size-2 rounded-full bg-morado/25" /> Reservado sin usar</span>
              <span className="flex items-center gap-1"><i className="size-2 rounded-full bg-bg ring-1 ring-line" /> Libre</span>
              <span className="ml-auto font-medium text-ink">{c.pct ?? 0}% consumido</span>
            </div>
            {c.sobreasignado && <p className="mt-2 flex items-center gap-1.5 text-xs text-[#B4541A]"><AlertTriangle className="size-3.5" /> Las reservas de subcajas superan el presupuesto general.</p>}
          </div>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {c.subcajas.map(s => <Subcaja key={s.caja.id} s={s} money={money} onEdit={() => onEdit(s.caja, s.asignado)} />)}
      </div>
    </div>
  )
}

function InfoBadge() {
  return (
    <span className="rounded-full bg-white/15 text-white [&_button]:text-white [&_button:hover]:bg-white/20">
      <InfoTooltip title="Cómo funcionan las cajas">
        <p>La caja general (P) es tu presupuesto total. Auto, Bebé y Plan Nube son reservas (R) apartadas de ese mismo dinero: no se suman.</p>
        <p>Un gasto de una subcaja baja esa reserva y el disponible global, pero no el saldo libre (ya estaba reservado). Un gasto sin subcaja baja el saldo libre.</p>
        <p>Si una subcaja se excede, el exceso sale del saldo libre. Fórmulas: libre inicial = P − R; saldo libre = P − R − gasto libre − exceso; disponible global = P − todo lo gastado.</p>
      </InfoTooltip>
    </span>
  )
}

function Subcaja({ s, money, onEdit }: { s: SubcajaResumen; money: (n: number) => string; onEdit: () => void }) {
  const st = styleFor(s.caja)
  const Icon = cajaIcon(s.caja)
  return (
    <section className="rounded-2xl border border-line p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)] dark:!bg-card" style={{ background: st.bg }}>
      <div className="flex items-center gap-2.5">
        <span className="grid size-10 place-items-center rounded-xl bg-white/70 dark:bg-white/10" style={{ color: st.fg }}><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{s.caja.nombre}</p>
          <p className="flex items-center gap-1 text-[11px] text-muted"><Lock className="size-3" /> Reserva de la caja general · {s.caja.filtroCampo} {s.caja.filtroValor}</p>
        </div>
        <IconButton label={`Ajustar ${s.caja.nombre}`} onClick={onEdit} className="bg-white/60 dark:bg-white/10"><Pencil className="size-3.5" /></IconButton>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted">
        <div><dt>Asignado</dt><dd className="tabular text-sm font-semibold text-ink">{s.asignado ? money(s.asignado) : '—'}</dd></div>
        <div><dt>Gastado</dt><dd className="tabular text-sm font-semibold text-ink">{money(s.gastado)}</dd></div>
        <div><dt>Disponible</dt><dd className={`tabular text-sm font-semibold ${s.disponible < 0 ? 'text-[#D2463C]' : 'text-ink'}`}>{s.asignado ? money(s.disponible) : '—'}</dd></div>
      </dl>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-white/10" role="progressbar" aria-valuenow={s.pct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`Consumido ${s.caja.nombre}`}>
        <div className="bar-grow h-full rounded-full" style={{ width: `${Math.min(s.pct ?? 0, 100)}%`, background: s.excedido ? '#D2463C' : st.fg }} />
      </div>
      <p className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
        <span>{s.asignado ? (s.excedido ? <span className="font-medium text-[#D2463C]">Excedida en {money(-s.disponible)}</span> : 'Dentro del presupuesto') : 'Sin asignación'}</span>
        <span className="font-medium text-ink">{s.pct === null ? '—' : `${s.pct}%`}</span>
      </p>
    </section>
  )
}

function CajaModal({ store, target, cajas, mes, money, onClose }: {
  store: AppStore; target: { caja: Caja; asignado: number }; cajas: CajasResumen; mes: string | null; money: (n: number) => string; onClose: () => void
}) {
  const esGeneral = target.caja.filtroCampo === 'Todos'
  const [monto, setMonto] = useState(String(target.asignado / 100))
  const [soloMes, setSoloMes] = useState(false)
  const [error, setError] = useState('')
  const n = Number(monto)
  const cents = Math.round(n * 100)
  const otrasReservas = cajas.reservado - (esGeneral ? 0 : target.asignado)
  const aviso = !Number.isFinite(n) ? '' : esGeneral
    ? cents < cajas.reservado ? `Las reservas de subcajas (${money(cajas.reservado)}) superarían este presupuesto.` : ''
    : otrasReservas + cents > cajas.presupuesto ? `Con este monto las reservas sumarían ${money(otrasReservas + cents)}, más que la caja general (${money(cajas.presupuesto)}).` : ''

  // No bloquea: valida, cierra y la escritura sigue en segundo plano con su notificación de resultado.
  function save() {
    if (!/^\d+(\.\d{1,2})?$/.test(monto.trim()) || n < 0) return setError('Ingresa un monto válido (hasta 2 decimales, sin negativos).')
    const ok = store.track(`caja:${target.caja.id}`, { pending: `Guardando ${target.caja.nombre}…`, ok: `${target.caja.nombre} actualizada correctamente.`, error: `No se pudo guardar ${target.caja.nombre}.` },
      () => soloMes && mes ? store.actions.savePresupuesto({ periodo: mes, cajaId: target.caja.id, monto: n }) : store.actions.saveCaja({ ...target.caja, presupuesto: n }))
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`Ajustar ${target.caja.nombre}`} icon={<Wallet className="size-5" />}
      subtitle={esGeneral ? 'Presupuesto mensual total' : 'Reserva mensual dentro de la caja general'}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save}>Guardar</Button></>}>
      <div className="space-y-3">
        <Field label={esGeneral ? 'Presupuesto mensual' : 'Monto asignado'} htmlFor="caja-monto">
          <div className="relative">
            <span className="pointer-events-none absolute top-2 left-3 text-sm font-semibold text-muted">S/</span>
            <input id="caja-monto" className={`${inputCls} tabular pl-9 text-base font-semibold`} inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} />
          </div>
        </Field>
        <Switch checked={soloMes} onChange={setSoloMes} label={mes ? `Solo para ${monthLabel(mes, true)}` : 'Solo este mes (elige un mes en el período)'} />
        {!mes && soloMes && <p className="text-xs text-muted">Para un ajuste puntual, primero elige un único mes en el filtro de período.</p>}
        {!esGeneral && <p className="text-xs text-muted">Incluye gastos con {target.caja.filtroCampo} = “{target.caja.filtroValor}”. Asignar dinero aquí no crea ningún gasto.</p>}
        {aviso && <ErrorBox tone="warning" message={aviso} />}
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  )
}
