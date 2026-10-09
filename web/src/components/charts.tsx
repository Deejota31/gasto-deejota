import { useState } from 'react'
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Sankey,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import { ChartNoAxesColumn } from 'lucide-react'
import { formatMoney } from '../lib/money'
import { formatDate } from '../lib/dates'
import type { Aggregates, Item, SubItem } from '../lib/engine'
import { ambitoLook, categoriaLook, medioLook, type Look } from '../lib/visual'
import type { CatalogoItem } from '../lib/types'
import { Empty } from './ui'

const axis = { stroke: 'var(--muted)', fontSize: 11, tickLine: false, axisLine: false }

function compact(cents: number, currency: string) {
  const v = cents / 100
  const sym = currency === 'PEN' ? 'S/' : `${currency} `
  return Math.abs(v) >= 1000 ? `${sym}${(v / 1000).toFixed(1)}k` : `${sym}${v.toFixed(0)}`
}

const pct = (part: number, total: number) => (total ? `${(Math.round((part / total) * 1000) / 10).toLocaleString('es-PE')}%` : '0%')

function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string; dashed?: boolean }[] }) {
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

/** Gasto acumulado (real, ritmo ideal, proyección) y debajo el gasto diario, en un panel propio. */
export function AcumuladoChart({ a, currency, dateFormat }: { a: Aggregates; currency: string; dateFormat?: string }) {
  if (!a.count && a.estado !== 'futuro') return empty
  const fmt = (v: number | null) => (v === null ? '—' : formatMoney(v, currency))
  const byLabel = new Map(a.dias.map(d => [d.label, d]))
  const tip = ({ active, label }: { active?: boolean; label?: string | number }) => {
    const d = active ? byLabel.get(String(label)) : undefined
    if (!d) return null
    return <TipBox title={formatDate(d.date, dateFormat)} rows={[
      ...(d.acumulado !== null ? [{ label: 'Gasto real acumulado', value: fmt(d.acumulado), color: '#4F7BE8' }] : []),
      ...(d.proyeccion !== null ? [{ label: 'Proyección de cierre', value: fmt(d.proyeccion), color: '#E8664F', dashed: true }] : []),
      ...(d.ideal !== null ? [{ label: 'Ritmo ideal', value: fmt(d.ideal), color: '#8B97AD', dashed: true }] : []),
      { label: 'Gasto del día', value: fmt(d.diario) },
    ]} />
  }
  const last = a.dias.filter(d => d.acumulado !== null).at(-1)
  const proj = a.dias.at(-1)?.proyeccion ?? null
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-primary-soft px-2.5 py-1 font-medium text-navy">Real: <b className="tabular">{fmt(last?.acumulado ?? 0)}</b></span>
        {proj !== null && <span className="rounded-full bg-coral-soft px-2.5 py-1 font-medium text-coral">Cierre proyectado: <b className="tabular">{fmt(proj)}</b></span>}
        {a.dias.at(-1)?.ideal != null && <span className="rounded-full bg-bg px-2.5 py-1 font-medium text-muted">Presupuesto: <b className="tabular">{fmt(a.dias.at(-1)!.ideal)}</b></span>}
        {a.estado === 'futuro' && <span className="rounded-full bg-bg px-2.5 py-1 text-muted">El período aún no comienza</span>}
      </div>
      <div className="h-72" role="img" aria-label="Gasto acumulado frente al ritmo ideal y la proyección de cierre">
        <ResponsiveContainer>
          <ComposedChart data={a.dias} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gReal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4F7BE8" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#4F7BE8" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" {...axis} minTickGap={12} />
            <YAxis {...axis} width={64} tickFormatter={v => compact(v, currency)} />
            <Tooltip content={tip} cursor={{ stroke: 'var(--line)', strokeWidth: 1 }} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
            <Area name="Gasto real acumulado" dataKey="acumulado" stroke="#4F7BE8" strokeWidth={2.5} fill="url(#gReal)" dot={false}
              activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }} connectNulls={false} isAnimationActive />
            <Line name="Proyección de cierre" dataKey="proyeccion" stroke="#E8664F" strokeWidth={2} strokeDasharray="6 5" dot={false} activeDot={{ r: 4 }} />
            <Line name="Ritmo ideal" dataKey="ideal" stroke="#8B97AD" strokeWidth={1.75} strokeDasharray="2 5" dot={false} activeDot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink"><span className="size-2 rounded-sm bg-[#16A085]" /> Gasto diario</p>
        <div className="h-28" role="img" aria-label="Gasto de cada día del período">
          <ResponsiveContainer>
            <BarChart data={a.dias} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" {...axis} minTickGap={12} />
              <YAxis {...axis} width={64} tickFormatter={v => compact(v, currency)} />
              <Tooltip content={tip} cursor={{ fill: 'var(--line)', opacity: 0.4 }} />
              <Bar name="Gasto diario" dataKey="diario" fill="#16A085" radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
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

export function SubLabel({ it }: { it: SubItem }) {
  return <span className="flex min-w-0 flex-col leading-tight"><span className="truncate">{it.subcategoria}</span><span className="truncate text-[11px] font-normal text-muted">{it.categoria}</span></span>
}

export function SankeyChart({ a, currency, catalogo }: { a: Aggregates; currency: string; catalogo: CatalogoItem[] }) {
  if (!a.sankey.links.length) return empty
  const nMedios = new Set(a.sankey.links.map(l => l.source)).size
  const colorOf = (i: number, name: string) => (i < nMedios ? medioLook(name).color : ambitoLook(name, catalogo).color)
  return (
    <div className="h-80" role="img" aria-label="Flujo del gasto desde cada medio de pago hacia cada ámbito">
      <ResponsiveContainer>
        <Sankey data={a.sankey} nodePadding={18} nodeWidth={12} margin={{ top: 8, right: 120, left: 8, bottom: 8 }}
          link={{ stroke: '#8B97AD', strokeOpacity: 0.28 }}
          node={({ x, y, width, height, index, payload }: { x: number; y: number; width: number; height: number; index: number; payload: { name: string; value?: number } }) => (
            <g>
              <rect x={x} y={y} width={width} height={height} fill={colorOf(index, payload.name)} rx={3} />
              <text x={x + width + 6} y={y + height / 2 - 6} dominantBaseline="middle" fontSize={11} fontWeight={600} fill="var(--ink)">{payload.name}</text>
              <text x={x + width + 6} y={y + height / 2 + 8} dominantBaseline="middle" fontSize={10} fill="var(--muted)">{compact(payload.value ?? 0, currency)}</text>
            </g>
          )}>
          <Tooltip content={({ payload }) => {
            const p = payload?.[0]?.payload as { source?: { name: string }; target?: { name: string }; value?: number; name?: string } | undefined
            if (!p) return null
            return <TipBox title={p.source ? `${p.source.name} → ${p.target?.name}` : (p.name ?? '')} rows={[{ label: 'Monto', value: formatMoney(Number(p.value ?? payload?.[0]?.value ?? 0), currency) }]} />
          }} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  )
}

export function FrecuenciaChart({ a, currency, catalogo, onPick }: { a: Aggregates; currency: string; catalogo: CatalogoItem[]; onPick: (cat: string) => void }) {
  if (!a.frecuencia.length) return empty
  return (
    <div className="h-72" role="img" aria-label="Cantidad de movimientos frente a monto total por categoría">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis type="number" dataKey="count" name="Movimientos" {...axis} allowDecimals={false} label={{ value: 'Movimientos', position: 'insideBottom', offset: -4, fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis type="number" dataKey="cents" name="Monto" {...axis} width={64} tickFormatter={v => compact(v, currency)} />
          <ZAxis range={[140, 140]} />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => {
            const p = payload?.[0]?.payload as { name: string; count: number; cents: number } | undefined
            return p ? <TipBox title={p.name} rows={[{ label: 'Movimientos', value: String(p.count) }, { label: 'Monto', value: formatMoney(p.cents, currency) }, { label: 'Promedio', value: formatMoney(Math.round(p.cents / p.count), currency) }]} /> : null
          }} />
          <Scatter data={a.frecuencia} cursor="pointer" onClick={d => { const n = (d as unknown as { payload?: { name?: string }; name?: string }).payload?.name ?? (d as unknown as { name?: string }).name; if (n) onPick(n) }}>
            {a.frecuencia.map(f => <Cell key={f.name} fill={categoriaLook(f.name, catalogo).color} stroke="var(--card)" strokeWidth={2} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

export function Jerarquia({ a, currency, catalogo }: { a: Aggregates; currency: string; catalogo: CatalogoItem[] }) {
  if (!a.jerarquia.length) return empty
  return (
    <div className="space-y-2 text-sm">
      {a.jerarquia.map(amb => {
        const look = ambitoLook(amb.name, catalogo)
        return (
          <details key={amb.name} className="group rounded-xl border border-line" open={a.jerarquia.length === 1}>
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 font-medium">
              <span className="grid size-7 place-items-center rounded-lg" style={{ background: `${look.color}1F`, color: look.color }}><look.Icon className="size-3.5" /></span>
              <span className="flex-1">{amb.name}</span>
              <span className="tabular text-muted">{formatMoney(amb.cents, currency)} · {pct(amb.cents, a.total)}</span>
            </summary>
            <ul className="space-y-2 px-3 pb-3">
              {amb.children.map(cat => {
                const cl = categoriaLook(cat.name, catalogo, amb.name)
                return (
                  <li key={cat.name}>
                    <div className="flex items-center gap-2">
                      <cl.Icon className="size-3.5" style={{ color: cl.color }} />
                      <span className="flex-1 font-medium text-ink">{cat.name}</span>
                      <span className="tabular text-muted">{formatMoney(cat.cents, currency)}</span>
                    </div>
                    <ul className="mt-1 ml-1.5 space-y-0.5 border-l-2 pl-3 text-xs text-muted" style={{ borderColor: `${cl.color}55` }}>
                      {cat.children.map(s => <li key={s.name} className="flex justify-between"><span>{s.name}</span><span className="tabular">{formatMoney(s.cents, currency)}</span></li>)}
                    </ul>
                  </li>
                )
              })}
            </ul>
          </details>
        )
      })}
    </div>
  )
}
