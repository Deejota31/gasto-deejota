import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react'
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, useXAxisInverseDataSnapScale,
} from 'recharts'
import { CalendarDays, ChartNoAxesColumn, MousePointerClick, X } from 'lucide-react'
import { formatMoney } from '../lib/money'
import { formatDate } from '../lib/dates'
import type { Aggregates, DayPoint, Item } from '../lib/engine'
import { ambitoLook, categoriaLook, medioLook, subcategoriaLook, type Look } from '../lib/visual'
import { movimientosPorDia, type MovDia } from '../lib/diario'
import type { CatalogoItem, Filters, Gasto } from '../lib/types'
import { Empty } from './ui'

const axis = { stroke: 'var(--muted)', fontSize: 11, tickLine: false, axisLine: false }

export function compact(cents: number, currency: string) {
  const v = cents / 100
  const sym = currency === 'PEN' ? 'S/' : `${currency} `
  return Math.abs(v) >= 1000 ? `${sym}${(v / 1000).toFixed(1)}k` : `${sym}${v.toFixed(0)}`
}

export const pct = (part: number, total: number) => (total ? `${(Math.round((part / total) * 1000) / 10).toLocaleString('es-PE')}%` : '0%')

export function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string; dashed?: boolean }[] }) {
  return (
    <div className="min-w-44 rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-ink">{title}</p>
      {rows.map(r => (
        <p key={r.label} className="flex items-center justify-between gap-4 text-muted">
          <span className="flex items-center gap-1.5">
            {r.color && <span className="inline-block h-0.5 w-3 rounded" style={{ background: r.color, opacity: r.dashed ? 0.7 : 1 }} />}
            {r.label}
          </span>
          <b className="tabular text-ink">{r.value}</b>
        </p>
      ))}
    </div>
  )
}

const empty = <Empty icon={<ChartNoAxesColumn className="size-5" />} title="Sin movimientos">No hay gastos con los filtros elegidos.</Empty>

const C_REAL = '#4F7BE8'
const C_PROY = '#E8664F'
const C_IDEAL = '#8B97AD'
const C_DIARIO = '#16A085'

/**
 * Explorador de gasto: acumulado (real, ritmo ideal, proyección) y gasto diario comparten UN SOLO día seleccionado.
 * Clic/toque en cualquiera de los dos gráficos (o ← → en el teclado) selecciona el día; el panel de abajo lista sus
 * movimientos reales. La selección es local: no cambia el período, los filtros ni ningún total del Dashboard.
 * Todo sale de datos ya cargados (`gastos`) y de la serie del motor (`a.dias`): sin consultas ni reagregaciones.
 */
export function AcumuladoChart({ a, currency, dateFormat, gastos = [], filters, rates = {}, catalogo = [] }: {
  a: Aggregates; currency: string; dateFormat?: string; gastos?: Gasto[]; filters?: Filters; rates?: Record<string, number>; catalogo?: CatalogoItem[]
}) {
  const rango = `${a.dias[0]?.date ?? ''}|${a.dias.at(-1)?.date ?? ''}`
  // La selección recuerda el rango en que se hizo: al cambiar el período principal deja de aplicar (se restablece sola).
  const [sel, setSel] = useState<{ rango: string; date: string } | null>(null)
  const idxSel = sel && sel.rango === rango ? a.dias.findIndex(d => d.date === sel.date) : -1
  const dia = idxSel >= 0 ? a.dias[idxSel] : null
  const select = (date: string | null) => setSel(date ? { rango, date } : null)
  const toggle = (date: string) => select(dia?.date === date ? null : date)

  const porDia = useMemo(() => (filters ? movimientosPorDia(gastos, filters, currency, rates) : new Map()), [gastos, filters, currency, rates])
  const etiqueta = useMemo(() => new Map(a.dias.map(d => [d.date, d.label])), [a.dias])
  const porFecha = useMemo(() => new Map(a.dias.map(d => [d.date, d])), [a.dias])
  const inversaLinea = useRef<((x: number) => unknown) | undefined>(undefined)
  const inversaBarra = useRef<((x: number) => unknown) | undefined>(undefined)
  const ultimoReal = useMemo(() => a.dias.reduce((m, d, i) => (d.acumulado !== null ? i : m), -1), [a.dias])

  if (!a.count && a.estado !== 'futuro') return empty
  const fmt = (v: number | null) => (v === null ? '—' : formatMoney(v, currency))
  const tickX = (d: string) => etiqueta.get(d) ?? d

  const tipLinea = ({ active, label }: { active?: boolean; label?: string | number }) => {
    const d = active ? porFecha.get(String(label)) : undefined
    if (!d) return null
    const real = d.acumulado !== null
    const dif = real && d.ideal !== null ? d.acumulado! - d.ideal : null
    return <TipBox title={formatDate(d.date, dateFormat)} rows={[
      ...(real ? [{ label: 'Acumulado hasta este día', value: fmt(d.acumulado), color: C_REAL }] : []),
      ...(real ? [{ label: 'Gasto de este día', value: fmt(d.diario) }] : [{ label: 'Proyección (sin movimientos reales)', value: '' }]),
      ...(d.proyeccion !== null ? [{ label: 'Proyección de cierre', value: fmt(d.proyeccion), color: C_PROY, dashed: true }] : []),
      ...(d.ideal !== null ? [{ label: 'Ritmo ideal acumulado', value: fmt(d.ideal), color: C_IDEAL, dashed: true }] : []),
      ...(dif !== null ? [{ label: dif > 0 ? 'Por encima del ideal' : dif < 0 ? 'Por debajo del ideal' : 'Igual al ideal', value: fmt(Math.abs(dif)) }] : []),
    ]} />
  }
  const tipBarra = ({ active, label }: { active?: boolean; label?: string | number }) => {
    const d = active ? porFecha.get(String(label)) : undefined
    if (!d) return null
    const n = porDia.get(d.date)?.length ?? 0
    return <TipBox title={formatDate(d.date, dateFormat)} rows={[
      { label: 'Gasto diario', value: fmt(d.diario), color: C_DIARIO },
      { label: 'Movimientos', value: d.acumulado === null ? 'Sin datos reales' : String(n) },
      ...(d.acumulado !== null ? [{ label: 'Del gasto del período', value: pct(d.diario, a.total) }] : []),
    ]} />
  }

  // Clic o toque en cualquier punto de la columna de un día (también días sin gasto, donde la barra mide 0).
  // El día se calcula con la posición real del puntero: el estado interno del gráfico se actualiza con retardo y un clic
  // inmediato (táctil o muy rápido) podría leer el día anterior.
  const alClic = (inversa: MutableRefObject<((x: number) => unknown) | undefined>) => (st: { activeTooltipIndex?: number | string | null; activeIndex?: number | string | null } | undefined, e?: { clientX: number; currentTarget: EventTarget | null }) => {
    const caja = (e?.currentTarget as HTMLElement | null)?.getBoundingClientRect?.()
    const porPuntero = caja && e && inversa.current ? inversa.current(e.clientX - caja.left) : undefined
    const fecha = typeof porPuntero === 'string' && porFecha.has(porPuntero) ? porPuntero : a.dias[Number(st?.activeTooltipIndex ?? st?.activeIndex)]?.date
    if (fecha) toggle(fecha)
  }
  // Teclado: ← → cambian de día, Inicio/Fin saltan a los extremos, Esc limpia.
  const alTeclado = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!a.dias.length) return
    const ultimo = a.dias.length - 1
    let i = idxSel
    if (e.key === 'Escape') { if (dia) { e.preventDefault(); select(null) } return }
    if (e.key === 'ArrowRight') i = i < 0 ? Math.max(0, ultimoReal) : Math.min(ultimo, i + 1)
    else if (e.key === 'ArrowLeft') i = i < 0 ? Math.max(0, ultimoReal) : Math.max(0, i - 1)
    else if (e.key === 'Home') i = 0
    else if (e.key === 'End') i = ultimo
    else return
    e.preventDefault()
    select(a.dias[i].date)
  }

  const last = a.dias.filter(d => d.acumulado !== null).at(-1)
  const proj = a.dias.at(-1)?.proyeccion ?? null
  const dimOtros = dia ? 0.4 : 1
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-primary-soft px-2.5 py-1 font-medium text-navy">Real: <b className="tabular">{fmt(last?.acumulado ?? 0)}</b></span>
        {proj !== null && <span className="rounded-full bg-coral-soft px-2.5 py-1 font-medium text-coral">Cierre proyectado: <b className="tabular">{fmt(proj)}</b></span>}
        {a.dias.at(-1)?.ideal != null && <span className="rounded-full bg-bg px-2.5 py-1 font-medium text-muted">Presupuesto: <b className="tabular">{fmt(a.dias.at(-1)!.ideal)}</b></span>}
        {a.estado === 'futuro' && <span className="rounded-full bg-bg px-2.5 py-1 text-muted">El período aún no comienza</span>}
        {dia && (
          <button type="button" onClick={() => select(null)} data-testid="limpiar-seleccion"
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-line bg-card px-2.5 py-1 font-medium text-ink transition hover:bg-bg focus-visible:outline-2 focus-visible:outline-navy">
            <X className="size-3" aria-hidden /> Limpiar selección
          </button>
        )}
      </div>

      <div tabIndex={0} role="group" onKeyDown={alTeclado} data-testid="explorador-gasto"
        aria-label="Gasto acumulado y gasto diario. Flechas izquierda y derecha cambian de día, Inicio y Fin van a los extremos, Escape limpia la selección."
        className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-navy/40 [&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none">
        <div className="h-72" role="img" aria-label="Gasto acumulado frente al ritmo ideal y la proyección de cierre. Haz clic en un día para ver sus movimientos.">
          <ResponsiveContainer>
            <ComposedChart data={a.dias} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} onClick={alClic(inversaLinea)} style={{ cursor: 'pointer' }}>
              <defs>
                <linearGradient id="gReal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C_REAL} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={C_REAL} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <Sonda destino={inversaLinea} />
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" {...axis} minTickGap={12} tickFormatter={tickX} />
              <YAxis {...axis} width={64} tickFormatter={v => compact(v, currency)} />
              <Tooltip content={tipLinea} cursor={{ stroke: 'var(--line)', strokeWidth: 1 }} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Area name="Gasto real acumulado" dataKey="acumulado" stroke={C_REAL} strokeWidth={2.5} fill="url(#gReal)"
                dot={(p: { cx?: number; cy?: number; index?: number; payload?: { diario: number; acumulado: number | null; date: string } }) => {
                  const ok = p.payload && p.payload.diario > 0 && p.payload.acumulado !== null && p.payload.date !== dia?.date
                  return ok ? <circle key={p.index} cx={p.cx} cy={p.cy} r={3} fill={C_REAL} stroke="var(--card)" strokeWidth={1} opacity={dia ? 0.5 : 1} /> : <g key={p.index} />
                }}
                activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }} connectNulls={false} isAnimationActive />
              <Line name="Proyección de cierre" dataKey="proyeccion" stroke={C_PROY} strokeWidth={2} strokeDasharray="6 5" dot={false} activeDot={{ r: 4 }} />
              <Line name="Ritmo ideal" dataKey="ideal" stroke={C_IDEAL} strokeWidth={1.75} strokeDasharray="2 5" dot={false} activeDot={false} />
              {dia && <ReferenceLine x={dia.date} stroke="var(--color-navy)" strokeWidth={1.5} strokeOpacity={0.7} ifOverflow="visible" />}
              {dia && (dia.acumulado ?? dia.proyeccion ?? dia.ideal) !== null && (
                <ReferenceDot x={dia.date} y={(dia.acumulado ?? dia.proyeccion ?? dia.ideal)!} r={dia.acumulado !== null ? 7 : 6} ifOverflow="visible"
                  fill={dia.acumulado !== null ? C_REAL : 'var(--card)'} stroke={dia.acumulado !== null ? 'var(--card)' : C_PROY} strokeWidth={2.5} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink"><span className="size-2 rounded-sm" style={{ background: C_DIARIO }} /> Gasto diario</p>
          <div className="h-28" role="img" aria-label="Gasto de cada día del período. Haz clic en una barra para ver sus movimientos.">
            <ResponsiveContainer>
              <BarChart data={a.dias} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} onClick={alClic(inversaBarra)} style={{ cursor: 'pointer' }}>
                <Sonda destino={inversaBarra} />
                <XAxis dataKey="date" {...axis} minTickGap={12} tickFormatter={tickX} />
                <YAxis {...axis} width={64} tickFormatter={v => compact(v, currency)} />
                <Tooltip content={tipBarra} cursor={{ fill: 'var(--line)', opacity: 0.4 }} />
                <Bar name="Gasto diario" dataKey="diario" fill={C_DIARIO} radius={[4, 4, 0, 0]} maxBarSize={18} activeBar={{ fill: '#0E7C66' }}>
                  {a.dias.map(d => (
                    <Cell key={d.date} fill={d.date === dia?.date ? '#0B6B58' : C_DIARIO} fillOpacity={d.date === dia?.date ? 1 : dimOtros}
                      stroke={d.date === dia?.date ? 'var(--color-navy)' : undefined} strokeWidth={d.date === dia?.date ? 2 : 0} />
                  ))}
                </Bar>
                {dia && <ReferenceLine x={dia.date} stroke="var(--color-navy)" strokeWidth={1.5} strokeOpacity={0.5} ifOverflow="visible" />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-3" aria-live="polite" data-testid="detalle-dia-region">
        {dia
          ? <DetalleDia dia={dia} movs={porDia.get(dia.date) ?? []} currency={currency} dateFormat={dateFormat} catalogo={catalogo} total={a.total} />
          : (
            <p className="flex items-center gap-2 rounded-xl bg-bg px-3 py-2.5 text-xs text-muted" data-testid="detalle-dia-ayuda">
              <MousePointerClick className="size-4 shrink-0" aria-hidden /> Toca un día en cualquiera de los dos gráficos para ver sus movimientos.
            </p>
          )}
      </div>
    </div>
  )
}

/** Expone al explorador la conversión «posición del puntero → día» del eje X del gráfico en que se hizo clic. */
function Sonda({ destino }: { destino: MutableRefObject<((x: number) => unknown) | undefined> }) {
  const inversa = useXAxisInverseDataSnapScale()
  useEffect(() => { destino.current = inversa as unknown as (x: number) => unknown }, [destino, inversa])
  return null
}

/** Detalle compacto del día seleccionado: cifras del día y lista de movimientos reales con scroll interno. */
function DetalleDia({ dia, movs, currency, dateFormat, catalogo, total }: {
  dia: DayPoint; movs: MovDia[]; currency: string; dateFormat?: string; catalogo: CatalogoItem[]; total: number
}) {
  const real = dia.acumulado !== null
  const fecha = new Date(`${dia.date}T00:00:00`)
  const semana = Number.isNaN(fecha.getTime()) ? '' : fecha.toLocaleDateString('es-PE', { weekday: 'long' })
  const categorias = [...movs.reduce((m, x) => m.set(x.g.categoria, (m.get(x.g.categoria) ?? 0) + 1), new Map<string, number>())]
  const m = (c: number | null) => (c === null ? '—' : formatMoney(c, currency))
  return (
    <section className="fade-in rounded-xl border border-line bg-bg/60 p-3" aria-label={`Detalle del ${formatDate(dia.date, dateFormat)}`} data-testid="detalle-dia" data-fecha={dia.date}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <CalendarDays className="size-4 text-navy" aria-hidden />
        <h3 className="text-sm font-semibold text-ink" data-testid="detalle-dia-fecha"><span className="first-letter:uppercase">{semana}</span> {formatDate(dia.date, dateFormat)}</h3>
        {!real && <span className="rounded-full bg-coral-soft px-2 py-0.5 text-[11px] font-medium text-coral" data-testid="detalle-dia-proyeccion">Proyección · sin movimientos reales</span>}
        {real && !movs.length && <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] font-medium text-muted">Sin gastos</span>}
      </div>
      {real ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-4">
          <Dato t="Gasto del día" v={m(dia.diario)} testid="detalle-dia-gasto" />
          <Dato t="Acumulado hasta ese día" v={m(dia.acumulado)} testid="detalle-dia-acumulado" />
          <Dato t="Movimientos" v={String(movs.length)} testid="detalle-dia-cantidad" />
          <Dato t="Del gasto del período" v={pct(dia.diario, total)} />
        </dl>
      ) : (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-4">
          {dia.proyeccion !== null && <Dato t="Proyección acumulada" v={m(dia.proyeccion)} />}
          {dia.ideal !== null && <Dato t="Ritmo ideal acumulado" v={m(dia.ideal)} />}
        </dl>
      )}
      {real && categorias.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Categorías del día" data-testid="detalle-dia-categorias">
          {categorias.map(([c, n]) => {
            const look = categoriaLook(c, catalogo)
            return (
              <li key={c} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: look.color, background: `color-mix(in srgb, ${look.color} 13%, transparent)` }}>
                <look.Icon className="size-3" aria-hidden /> {c}{n > 1 ? ` · ${n}` : ''}
              </li>
            )
          })}
        </ul>
      )}
      {real && !movs.length && <p className="mt-2 text-xs text-muted" data-testid="detalle-dia-vacio">No registraste gastos este día.</p>}
      {movs.length > 0 && (
        <ul className="mt-2 max-h-52 divide-y divide-line overflow-y-auto overscroll-contain rounded-lg border border-line bg-card" aria-label="Movimientos del día" data-testid="detalle-dia-lista">
          {movs.map(({ g, cents }, i) => {
            const cat = subcategoriaLook(g.subcategoria, g.categoria, catalogo)
            const amb = ambitoLook(g.ambito, catalogo)
            const med = medioLook(g.medioPago)
            return (
              <li key={g.id ?? i} className="flex items-start gap-2.5 px-2.5 py-2" data-testid="detalle-dia-mov">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg" style={{ color: cat.color, background: `color-mix(in srgb, ${cat.color} 14%, transparent)` }}>
                  <cat.Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink" title={g.descripcion}>{g.descripcion || g.subcategoria || g.categoria}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                    <span className="inline-flex items-center gap-1" style={{ color: amb.color }}><amb.Icon className="size-3" aria-hidden />{g.ambito}</span>
                    <span>{g.categoria}{g.subcategoria ? ` › ${g.subcategoria}` : ''}</span>
                    <span className="inline-flex items-center gap-1"><med.Icon className="size-3" style={{ color: med.color }} aria-hidden />{g.medioPago}</span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular text-[13px] font-semibold text-ink">{formatMoney(cents, currency)}</p>
                  {g.moneda !== currency && <p className="tabular text-[10px] text-muted">{formatMoney(Math.round(g.monto * 100), g.moneda)}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Dato({ t, v, testid }: { t: string; v: string; testid?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-muted">{t}</dt>
      <dd className="tabular truncate text-[13px] font-semibold text-ink" data-testid={testid}>{v}</dd>
    </div>
  )
}

/** Dona por ámbito con total al centro. Clic en un sector o en la leyenda filtra por ese ámbito. */
export function AmbitoDonut({ items, catalogo, currency, selected, onToggle, total }: {
  items: Item[]; catalogo: CatalogoItem[]; currency: string; selected: string[]; onToggle: (v: string) => void; total: number
}) {
  const [hover, setHover] = useState<string | null>(null)
  if (!items.length) return empty
  const dim = (n: string) => (hover ? hover !== n : selected.length > 0 && !selected.includes(n))
  const focus = items.find(i => i.name === hover)
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="relative h-56" role="img" aria-label="Distribución del gasto por ámbito">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={items} dataKey="cents" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} cornerRadius={6}
              stroke="var(--card)" strokeWidth={2} cursor="pointer" isAnimationActive
              onMouseEnter={(d: { name?: string }) => setHover(d.name ?? null)} onMouseLeave={() => setHover(null)}
              onClick={(d: { name?: string }) => d.name && onToggle(d.name)}>
              {items.map(it => <Cell key={it.name} fill={ambitoLook(it.name, catalogo).color} fillOpacity={dim(it.name) ? 0.25 : 1} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[11px] text-muted">{focus ? focus.name : 'Total'}</p>
            <p className="tabular text-lg font-semibold text-ink">{compact(focus ? focus.cents : total, currency)}</p>
            <p className="text-[11px] text-muted">{focus ? `${pct(focus.cents, total)} · ${focus.count} mov.` : `${items.reduce((s, i) => s + i.count, 0)} movimientos`}</p>
          </div>
        </div>
      </div>
      <ul className="space-y-1">
        {items.map(it => {
          const look = ambitoLook(it.name, catalogo)
          const on = selected.includes(it.name)
          return (
            <li key={it.name}>
              <button type="button" onClick={() => onToggle(it.name)} aria-pressed={on}
                onMouseEnter={() => setHover(it.name)} onMouseLeave={() => setHover(null)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-bg ${dim(it.name) ? 'opacity-50' : ''} ${on ? 'ring-1 ring-navy/30' : ''}`}>
                <span className="grid size-7 place-items-center rounded-lg" style={{ background: `${look.color}1F`, color: look.color }}><look.Icon className="size-3.5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{it.name}</span>
                  <span className="block text-[11px] text-muted">{it.count} movimiento{it.count === 1 ? '' : 's'}</span>
                </span>
                <span className="text-right">
                  <span className="tabular block text-sm font-semibold text-ink">{formatMoney(it.cents, currency)}</span>
                  <span className="tabular block text-[11px] text-muted">{pct(it.cents, total)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Barras horizontales con color e icono por entidad. Clic = filtrar; segundo clic = quitar filtro. */
export function BarList<T extends Item>({ items, total, currency, lookFor, selected, onToggle, renderLabel, ariaLabel }: {
  items: T[]; total: number; currency: string; lookFor: (it: T) => Look; selected: (it: T) => boolean; onToggle: (it: T) => void
  renderLabel?: (it: T) => React.ReactNode; ariaLabel: string
}) {
  if (!items.length) return empty
  const max = Math.max(...items.map(i => i.cents))
  const anySel = items.some(selected)
  return (
    <ul className="space-y-2" aria-label={ariaLabel}>
      {items.map(it => {
        const look = lookFor(it)
        const on = selected(it)
        return (
          <li key={it.name}>
            <button type="button" onClick={() => onToggle(it)} aria-pressed={on}
              title={`${it.name}: ${formatMoney(it.cents, currency)} · ${pct(it.cents, total)} · ${it.count} movimiento(s)`}
              className={`group grid w-full grid-cols-[minmax(0,10rem)_1fr] items-center gap-3 rounded-xl px-1.5 py-1 text-left transition hover:bg-bg sm:grid-cols-[minmax(0,13rem)_1fr] ${anySel && !on ? 'opacity-50' : ''}`}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: `${look.color}1F`, color: look.color }}><look.Icon className="size-3.5" /></span>
                <span className="min-w-0 truncate text-[13px] font-medium text-ink">{renderLabel ? renderLabel(it) : it.name}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="h-3 flex-1 overflow-hidden rounded-full bg-bg">
                  <span className="bar-grow block h-full rounded-full" style={{ width: `${Math.max(2, (it.cents / max) * 100)}%`, background: `linear-gradient(90deg, ${look.color}B3, ${look.color})` }} />
                </span>
                <span className="w-24 shrink-0 text-right sm:w-32">
                  <span className="tabular block text-[13px] font-semibold text-ink">{formatMoney(it.cents, currency)}</span>
                  <span className="tabular block text-[11px] text-muted">{pct(it.cents, total)} · {it.count} mov.</span>
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

