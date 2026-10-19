import { useMemo, useState } from 'react'
import { useAgregado } from '../lib/useAgregado'
import {
  Activity, Calculator, CalendarDays, Hash, Layers, Pencil,
  PieChart as PieIcon, Shapes, Trophy,
  Receipt,
} from 'lucide-react'
import { aislaDesde, subKey } from '../lib/engine'
import type { PlanificacionApi } from '../components/Planificacion'
import { formatMoney, ratesFromConfig } from '../lib/money'
import { formatDate, monthLabel, rangeLabel, singleMonth } from '../lib/dates'
import type { AppStore } from '../lib/store'
import type { Caja, Filters } from '../lib/types'
import { categoriaLook, subcategoriaLook } from '../lib/visual'
import { AcumuladoChart, AmbitoDonut, BarList } from '../components/charts'
import { AnalisisDetallado } from '../components/analisis'
import { BotonMensual, BotonNuevo, Card, Empty, ErrorBox, Segmented, Skeleton } from '../components/ui'
import { FilterBar } from '../components/shared'
import { CajaModal } from '../components/cajas'
import { PresupuestoConsolidado } from '../components/PresupuestoConsolidado'
import { ResumenCajas } from '../components/ResumenCajas'

const toggle = (xs: string[], v: string) => (xs.includes(v) ? xs.filter(x => x !== v) : [...xs, v])

export default function Dashboard({ store, filters, setFilters, today, onNuevoGasto, onGastosMensuales, onIrCajas, plan }: {
  plan?: PlanificacionApi; store: AppStore; filters: Filters; setFilters: (f: Filters) => void; today: string; onNuevoGasto: () => void; onGastosMensuales: () => void
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
  const config = data?.config
  const rates = useMemo(() => ratesFromConfig(config ?? {}), [config])

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
          <BotonNuevo onClick={onNuevoGasto} disabled={!data}>Nuevo gasto</BotonNuevo>
          {/* Plantillas rápidas de gastos frecuentes: solo lee su propia hoja, no el histórico. */}
          <BotonMensual onClick={onGastosMensuales} disabled={!data}>Gastos mensuales</BotonMensual>
        </div>
      </div>
      <FilterBar filters={filters} setFilters={setFilters} catalogo={catalogo} medios={medios} today={today} gastos={store.data?.gastos} />

      {store.error && !data && <ErrorBox message={store.error} onRetry={store.refresh} />}

      {!a ? (
        <div className="space-y-4">
          <Skeleton className="h-80" />
        </div>
      ) : (
        <>
          {a.excluidosSinTipoCambio > 0 && (
            <ErrorBox tone="warning" message={`${a.excluidosSinTipoCambio} movimiento(s) en otra moneda no se suman porque falta su tipo de cambio en Configuración.`} />
          )}

          {/* v1.19: mes sin fuentes/cajas aplicadas. Los gastos reales se conservan; no se muestran % engañosos. */}
          {mes && data && mes >= aislaDesde(data.config) && plan && (() => {
            const sinF = a.cajas.origen === 'fuentes' && !a.cajas.fuentes.lista.some(r => r.aplicada)
            const sinS = a.cajas.subcajas.length > 0 && !a.cajas.subcajas.some(r => r.aplicada)
            if (!sinF && !sinS) return null
            return (
              <div className="space-y-2" data-testid="aviso-mes-sin-config">
                {sinF && <ErrorBox tone="warning" message="Todavía no has configurado fuentes de dinero para este mes." action={{ label: 'Preparar fuentes mensuales', onClick: () => plan.abrir(mes, 'fuentes') }} />}
                {sinS && <ErrorBox tone="warning" message="Todavía no has reservado presupuesto para este mes." action={{ label: 'Preparar cajas mensuales', onClick: () => plan.abrir(mes, 'subcajas') }} />}
              </div>
            )
          })()}

          {/* Todos los indicadores viven en el Presupuesto consolidado (los cuatro complementarios al final del bloque) */}
          <PresupuestoConsolidado c={a.cajas} money={money} periodo={mes ? monthLabel(mes, true) : rangeLabel(filters)}
            complementarios={[
              { etiqueta: 'Promedio diario', color: 'var(--color-celeste)', valor: money(a.promedioDiario), icono: <CalendarDays />,
                pista: a.estado === 'futuro' ? 'El período aún no comienza' : `${a.diasPeriodo} días ${a.estado === 'en-curso' ? 'transcurridos' : 'del período'}`,
                info: <p>Total gastado ÷ días. Si el período está en curso, cuenta solo los días hasta hoy; si ya terminó, todos sus días.</p> },
              { etiqueta: 'Promedio por movimiento', color: 'var(--color-celeste)', valor: money(a.promedioMovimiento), icono: <Calculator />, pista: 'Ticket promedio',
                info: <p>Total gastado ÷ cantidad de movimientos activos con los filtros elegidos.</p> },
              { etiqueta: 'Mayor gasto', color: 'var(--color-coral)', valor: a.max ? money(a.maxCents) : '—', icono: <Trophy />,
                pista: a.max ? `${a.max.descripcion || a.max.subcategoria || a.max.categoria} · ${formatDate(a.max.fecha, data!.config.formato_fecha)}` : undefined,
                info: <p>El movimiento individual más alto del período con los filtros elegidos.</p> },
              { etiqueta: 'Movimientos', color: 'var(--color-navy)', valor: String(a.count), icono: <Hash />,
                pista: a.count ? `${new Set(data!.gastos.filter(g => g.estado === 'Activo' && g.fecha >= filters.desde && g.fecha <= filters.hasta).map(g => g.fecha)).size} días con gastos` : undefined,
                info: <p>Cantidad de gastos activos que cumplen los filtros.</p> },
            ]}
            accion={a.cajas.origen !== 'fuentes' && a.cajas.general
              ? <button type="button" onClick={() => setEditCaja({ caja: a.cajas.general!, asignado: a.cajas.presupuesto })} className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 px-3 py-1.5 text-xs font-medium whitespace-nowrap hover:bg-white/10"><Pencil className="size-3.5" /> Ajustar caja</button>
              : undefined} />
          <ResumenCajas c={a.cajas} money={money} catalogo={store.data?.catalogo} onIrCajas={onIrCajas} />



          {data!.gastos.length === 0 ? (
            <Card><Empty icon={<Receipt className="size-5" />} title="Aún no hay gastos registrados">Cuando registres gastos verás aquí tus gráficos y análisis.</Empty></Card>
          ) : <>
          <Card title={`Gasto acumulado — ${periodoTxt}`} icon={<Activity className="size-4 text-navy" />}
            info={{ title: 'Gasto acumulado', body: <>
              <p>Cómo evoluciona tu gasto a lo largo del período. La línea azul es el gasto real acumulado día a día.</p>
              <p>La línea punteada gris (ritmo ideal) reparte la caja mensual de forma pareja hasta el último día: si la azul va por encima, gastas más rápido de lo planeado.</p>
              <p>La línea coral (proyección) solo aparece en un período en curso: extiende tu promedio diario actual hasta el cierre.</p>
              <p>Abajo, el gasto de cada día. Aplican todos los filtros.</p></> }}>
            <AcumuladoChart a={a} currency={base} dateFormat={data!.config.formato_fecha} gastos={data!.gastos} filters={filters} rates={rates} catalogo={catalogo} />
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
          </>}
        </>
      )}

      {editCaja && a && <CajaModal store={store} target={editCaja} cajas={a.cajas} mes={mes} money={money} onClose={() => setEditCaja(null)} />}
    </div>
  )
}

// Opción del ranking recordada durante la sesión (al cambiar filtros, datos o de pestaña).
let rankingSesion: 'categorias' | 'subcategorias' = 'categorias'
