import { useMemo, useState, type ReactNode } from 'react'
import { useAgregado } from '../lib/useAgregado'
import {
  Activity, Calculator, CalendarDays, Hash, Layers, Pencil,
  Percent, PieChart as PieIcon, PiggyBank, Plus, Shapes, TrendingUp, Trophy, Wallet,
} from 'lucide-react'
import { subKey } from '../lib/engine'
import { formatMoney } from '../lib/money'
import { formatDate, monthLabel, rangeLabel, singleMonth } from '../lib/dates'
import type { AppStore } from '../lib/store'
import type { Caja, Filters } from '../lib/types'
import { categoriaLook, subcategoriaLook } from '../lib/visual'
import { AcumuladoChart, AmbitoDonut, BarList } from '../components/charts'
import { AnalisisDetallado } from '../components/analisis'
import { Button, Card, ErrorBox, InfoTooltip, Segmented, Skeleton } from '../components/ui'
import { FilterBar } from '../components/shared'
import { CajaModal } from '../components/cajas'
import { PresupuestoConsolidado } from '../components/PresupuestoConsolidado'
import { ResumenCajas } from '../components/ResumenCajas'

const toggle = (xs: string[], v: string) => (xs.includes(v) ? xs.filter(x => x !== v) : [...xs, v])

export default function Dashboard({ store, filters, setFilters, today, onNuevoGasto, onGastosMensuales, onIrCajas }: {
  store: AppStore; filters: Filters; setFilters: (f: Filters) => void; today: string; onNuevoGasto: () => void; onGastosMensuales: () => void
  onIrCajas?: () => void
}) {
  const [editCaja, setEditCaja] = useState<{ caja: Caja; asignado: number } | null>(null)
  const [ranking, setRanking] = useState(rankingSesion)
  const data = store.data
  const base = data?.config.moneda || 'PEN'
  const catalogo = useMemo(() => data?.catalogo ?? [], [data?.catalogo])
  const medios = (data?.medios ?? []).filter(m => m.activo).map(m => m.nombre)

  // Una sola agregación por combinación de filtros; KPIs, cajas y gráficos reutilizan este resultado.
  // Dependencias explícitas: un cambio en vínculos o revisiones (Salud financiera) no recalcula el dashboard.
  // Mismo motor y mismo contexto (fuentes, cajas, ajustes) en Dashboard, Cajas y Salud financiera.
  const a = useAgregado(data, filters, today)

  const money = (c: number) => formatMoney(c, base)
  const mes = singleMonth(filters.desde, filters.hasta)
  const periodoTxt = mes ? monthLabel(mes, true) : 'el período elegido'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Resumen</h1>
          <p className="truncate text-xs text-muted first-letter:uppercase">{mes ? monthLabel(mes, true) : rangeLabel(filters)}</p>
        </div>
        {/* Abre el mismo formulario de la pestaña Gastos (un solo modal en toda la app). */}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onNuevoGasto} disabled={!data}><Plus className="size-4" /> Nuevo gasto</Button>
          {/* Plantillas rápidas de gastos frecuentes: solo lee su propia hoja, no el histórico. */}
          <Button variant="soft" onClick={onGastosMensuales} disabled={!data}><CalendarDays className="size-4" /> Gastos mensuales</Button>
        </div>
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
            <Kpi tone="blue" icon={<Wallet />} label={a.cajas.origen === 'fuentes' ? 'Presupuesto' : 'Caja mensual'} value={a.cajas.presupuesto || a.cajas.origen === 'fuentes' ? money(a.cajas.presupuesto) : 'Sin definir'}
              hint={a.cajas.origen === 'fuentes' ? `${a.cajas.fuentes.activas} fuente${a.cajas.fuentes.activas === 1 ? '' : 's'} · reservado ${money(a.cajas.reservado)}` : a.cajas.presupuesto ? `Reservado ${money(a.cajas.reservado)}` : 'Defínela en Cajas'}
              info={a.cajas.origen === 'fuentes'
                ? <><p>Presupuesto consolidado de {periodoTxt}: la suma de lo que aportan tus fuentes activas (General, Sodexo, extras…). Si el período abarca varios meses, suma cada mes.</p><p>Las subcajas son reservas dentro de este monto, no dinero adicional.</p></>
                : <><p>Presupuesto total de la caja general para {periodoTxt}. Si el período abarca varios meses, suma el presupuesto de cada mes.</p><p>Las subcajas (Auto, Bebé, Plan Nube) son reservas dentro de este monto, no dinero adicional.</p></>} />
            <Kpi tone="coral" icon={<TrendingUp />} label="Total gastado" value={money(a.total)}
              hint={a.filtrado ? `De ${money(a.totalPeriodo)} en el período` : `${a.count} movimientos`}
              info={<><p>Suma de los gastos activos del período con todos los filtros aplicados. Los eliminados no cuentan.</p><p>Montos en otra moneda se convierten con el tipo de cambio de Configuración.</p></>} />
            <Kpi tone={a.cajas.disponible < 0 ? 'red' : 'green'} icon={<PiggyBank />} label="Disponible" value={a.cajas.presupuesto || a.cajas.origen === 'fuentes' ? money(a.cajas.disponible) : '—'}
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

          <PresupuestoConsolidado c={a.cajas} money={money} periodo={mes ? monthLabel(mes, true) : rangeLabel(filters)}
            accion={a.cajas.origen !== 'fuentes' && a.cajas.general
              ? <button type="button" onClick={() => setEditCaja({ caja: a.cajas.general!, asignado: a.cajas.presupuesto })} className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 px-3 py-1.5 text-xs font-medium whitespace-nowrap hover:bg-white/10"><Pencil className="size-3.5" /> Ajustar caja</button>
              : undefined} />
          <ResumenCajas c={a.cajas} money={money} onIrCajas={onIrCajas} />

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
            <Card title={ranking === 'categorias' ? 'Top 5 categorías' : 'Top 5 subcategorías'} icon={<Shapes className="size-4 text-coral" />}
              action={<Segmented label="Ranking" value={ranking} onChange={v => { rankingSesion = v; setRanking(v) }}
                options={[{ value: 'categorias', label: 'Categorías' }, { value: 'subcategorias', label: 'Subcategorías' }]} />}
              info={{ title: 'Top 5', body: <>
                <p>Las 5 categorías o subcategorías con más gasto en el período y con los filtros elegidos, de mayor a menor. Muestra monto, porcentaje sobre el total filtrado y movimientos. Si hay menos de 5 con gastos, solo esas.</p>
                <p>Cada subcategoría se identifica por ámbito + categoría + subcategoría: “Otros” de Alimentación y “Otros” de Auto no se mezclan.</p>
                <p>Haz clic en una barra para filtrar por ella.</p></> }}>
              {ranking === 'categorias'
                ? <BarList ariaLabel="Top 5 categorías" items={a.porCategoria.slice(0, 5)} total={a.total} currency={base}
                    lookFor={it => categoriaLook(it.name, catalogo)} selected={it => filters.categorias.includes(it.name)}
                    onToggle={it => setFilters({ ...filters, categorias: toggle(filters.categorias, it.name) })} />
                : <BarList ariaLabel="Top 5 subcategorías" items={a.rankingSubcategorias.slice(0, 5)} total={a.total} currency={base}
                    lookFor={it => subcategoriaLook(it.subcategoria, it.categoria, catalogo, it.ambito)} selected={it => filters.subcategorias.includes(it.key)}
                    onToggle={it => setFilters({ ...filters, subcategorias: toggle(filters.subcategorias, subKey(it.categoria, it.subcategoria === 'Sin subcategoría' ? '' : it.subcategoria)) })}
                    renderLabel={it => <span className="flex min-w-0 flex-col leading-tight"><span className="truncate">{it.subcategoria}</span><span className="truncate text-[11px] font-normal text-muted">{it.ambito} › {it.categoria}</span></span>} />}
            </Card>
          </div>

          <Card title="Análisis detallado" icon={<Layers className="size-4 text-morado" />}
            info={{ title: 'Análisis detallado', body: <>
              <p>Usa los mismos filtros y período del dashboard; no hace consultas adicionales.</p>
              <p><b>Jerarquía:</b> ámbito → categoría → subcategoría, con barras de peso relativo. Clic en un ámbito para expandir o contraer.</p>
              <p><b>Flujo de medios de pago:</b> desde qué medio sale el dinero y hacia qué ámbito va; el grosor es el monto. Pasa el mouse sobre un medio, un ámbito o una conexión para resaltarlo.</p>
              <p><b>Frecuencia vs monto:</b> cada burbuja es una categoría; a la derecha, muchas compras; arriba, mucho dinero; el tamaño es el monto. Clic para filtrar.</p></> }}>
            <AnalisisDetallado a={a} currency={base} catalogo={catalogo}
              periodo={{ nombre: mes ? monthLabel(mes, true) : rangeLabel(filters), desde: filters.desde, hasta: filters.hasta, dateFormat: data!.config.formato_fecha }}
              filtros={[...filters.ambitos, ...filters.categorias, ...filters.subcategorias, ...filters.medios, ...filters.tipos]}
              onPickCategoria={c => setFilters({ ...filters, categorias: toggle(filters.categorias, c) })} />
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

// Opción del ranking recordada durante la sesión (al cambiar filtros, datos o de pestaña).
let rankingSesion: 'categorias' | 'subcategorias' = 'categorias'
