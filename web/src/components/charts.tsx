import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Sankey,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import { formatMoney } from '../lib/money'
import { monthLabel } from '../lib/dates'
import type { Aggregates, Item } from '../lib/engine'
import { Empty } from './ui'
import { colorFor } from './shared'

const axis = { stroke: 'var(--muted)', fontSize: 11, tickLine: false, axisLine: false }
const grid = <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
const tooltipStyle = { contentStyle: { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12, color: 'var(--ink)' }, cursor: { fill: 'var(--line)', opacity: 0.4 } }

function compact(cents: number, currency: string) {
  const v = cents / 100
  const sym = currency === 'PEN' ? 'S/' : `${currency} `
  return Math.abs(v) >= 1000 ? `${sym}${(v / 1000).toFixed(1)}k` : `${sym}${v.toFixed(0)}`
}

export function AcumuladoChart({ a, currency }: { a: Aggregates; currency: string }) {
  if (!a.count) return <Empty>Sin movimientos en el periodo.</Empty>
  const fmt = (v: unknown) => (typeof v === 'number' ? formatMoney(v, currency) : '—')
  return (
    <div className="space-y-3">
      <div className="h-64" role="img" aria-label="Gasto acumulado del mes frente al ritmo ideal y la proyección">
        <ResponsiveContainer>
          <ComposedChart data={a.dias} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {grid}
            <XAxis dataKey="day" {...axis} />
            <YAxis {...axis} width={64} tickFormatter={v => compact(v, currency)} />
            <Tooltip {...tooltipStyle} formatter={fmt} labelFormatter={d => `Día ${d}`} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
            <Line name="Gasto real acumulado" dataKey="acumulado" stroke="var(--s1)" strokeWidth={2} dot={false} connectNulls={false} />
            <Line name="Ritmo ideal" dataKey="ideal" stroke="var(--muted)" strokeWidth={2} strokeDasharray="2 4" dot={false} />
            <Line name="Proyección de cierre" dataKey="proyeccion" stroke="var(--s2)" strokeWidth={2} strokeDasharray="6 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="h-28" role="img" aria-label="Gasto diario">
        <ResponsiveContainer>
          <BarChart data={a.dias} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="day" {...axis} />
            <YAxis {...axis} width={64} tickFormatter={v => compact(v, currency)} />
            <Tooltip {...tooltipStyle} formatter={fmt} labelFormatter={d => `Día ${d}`} />
            <Bar name="Gasto diario" dataKey="diario" fill="var(--s3)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function MesesChart({ a, currency }: { a: Aggregates; currency: string }) {
  const data = a.meses.map(m => ({ ...m, label: monthLabel(m.periodo), sinDatos: m.cents === null }))
  return (
    <div className="h-64" role="img" aria-label="Comparación de los últimos seis meses">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
          {grid}
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={64} tickFormatter={v => compact(v, currency)} />
          <Tooltip {...tooltipStyle} formatter={v => (typeof v === 'number' ? formatMoney(v, currency) : 'Sin datos')} />
          <Bar name="Total del mes" dataKey="cents" radius={[4, 4, 0, 0]}
            label={({ x, y, width, index }: { x?: number | string; y?: number | string; width?: number | string; index?: number }) =>
              index !== undefined && data[index].sinDatos ? <text x={Number(x ?? 0) + Number(width ?? 0) / 2} y={Number(y ?? 0) - 4} textAnchor="middle" fontSize={10} fill="var(--muted)">sin datos</text> : <g />}>
            {data.map((m, i) => <Cell key={m.periodo} fill="var(--s1)" fillOpacity={i === data.length - 1 ? 1 : 0.55} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function AmbitoDonut({ items, order, currency, selected, onSelect, total }: { items: Item[]; order: string[]; currency: string; selected: string; onSelect: (v: string) => void; total: number }) {
  if (!items.length) return <Empty>Sin datos.</Empty>
  return (
    <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto]">
      <div className="h-52" role="img" aria-label="Distribución por ámbito">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={items} dataKey="cents" nameKey="name" innerRadius="58%" outerRadius="90%" paddingAngle={1} stroke="var(--card)" strokeWidth={2}
              onClick={(d: { name?: string }) => d.name && onSelect(selected === d.name ? '' : d.name)} cursor="pointer">
              {items.map(it => <Cell key={it.name} fill={colorFor(it.name, order)} fillOpacity={!selected || selected === it.name ? 1 : 0.3} />)}
            </Pie>
            <Tooltip {...tooltipStyle} formatter={v => formatMoney(Number(v), currency)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1 text-sm">
        {items.map(it => (
          <li key={it.name}>
            <button onClick={() => onSelect(selected === it.name ? '' : it.name)} aria-pressed={selected === it.name}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-bg ${selected && selected !== it.name ? 'opacity-50' : ''}`}>
              <span className="size-2.5 rounded-full" style={{ background: colorFor(it.name, order) }} />
              <span className="flex-1 text-ink">{it.name}</span>
              <span className="tabular text-muted">{total ? Math.round((it.cents / total) * 1000) / 10 : 0}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function HBars({ items, currency, color = 'var(--s1)', label }: { items: Item[]; currency: string; color?: string; label: string }) {
  if (!items.length) return <Empty>Sin datos.</Empty>
  const short = (s: string) => (s.length > 26 ? `${s.slice(0, 25)}…` : s)
  return (
    <div style={{ height: Math.max(120, items.length * 30 + 20) }} role="img" aria-label={label}>
      <ResponsiveContainer>
        <BarChart data={items} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" {...axis} width={170} tickFormatter={short} tick={{ fontSize: 11, fill: 'var(--muted)', width: 400 }} />
          <Tooltip {...tooltipStyle} formatter={v => formatMoney(Number(v), currency)} />
          <Bar name="Monto" dataKey="cents" fill={color} radius={[0, 4, 4, 0]} barSize={16}
            label={{ position: 'right', fontSize: 11, fill: 'var(--muted)', formatter: (v: unknown) => compact(Number(v), currency) }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function SankeyChart({ a, currency }: { a: Aggregates; currency: string }) {
  if (!a.sankey.links.length) return <Empty>Sin datos.</Empty>
  return (
    <div className="h-80" role="img" aria-label="Flujo de medios de pago a ámbitos">
      <ResponsiveContainer>
        <Sankey data={a.sankey} nodePadding={18} nodeWidth={10} margin={{ top: 8, right: 110, left: 8, bottom: 8 }}
          link={{ stroke: 'var(--s1)', strokeOpacity: 0.25 }}
          node={({ x, y, width, height, payload }: { x: number; y: number; width: number; height: number; payload: { name: string } }) => (
            <g>
              <rect x={x} y={y} width={width} height={height} fill="var(--navy, #1e3a8a)" rx={2} />
              <text x={x + width + 6} y={y + height / 2} dominantBaseline="middle" fontSize={11} fill="var(--ink)">{payload.name}</text>
            </g>
          )}>
          <Tooltip {...tooltipStyle} formatter={v => formatMoney(Number(v), currency)} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  )
}

export function FrecuenciaChart({ a, currency }: { a: Aggregates; currency: string }) {
  if (!a.frecuencia.length) return <Empty>Sin datos.</Empty>
  return (
    <div className="h-72" role="img" aria-label="Frecuencia frente a monto por categoría">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis type="number" dataKey="count" name="Movimientos" {...axis} allowDecimals={false} />
          <YAxis type="number" dataKey="cents" name="Monto" {...axis} width={64} tickFormatter={v => compact(v, currency)} />
          <ZAxis range={[80, 80]} />
          <Tooltip {...tooltipStyle} cursor={{ strokeDasharray: '3 3' }}
            content={({ payload }) => {
              const p = payload?.[0]?.payload as { name: string; count: number; cents: number } | undefined
              return p ? <div className="rounded-lg border border-line bg-card px-2 py-1 text-xs"><b>{p.name}</b><br />{p.count} movimientos · {formatMoney(p.cents, currency)}</div> : null
            }} />
          <Scatter data={a.frecuencia} fill="var(--s1)" stroke="var(--card)" strokeWidth={2} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

export function Jerarquia({ a, currency }: { a: Aggregates; currency: string }) {
  if (!a.jerarquia.length) return <Empty>Sin datos.</Empty>
  const pct = (c: number) => (a.total ? `${Math.round((c / a.total) * 1000) / 10}%` : '0%')
  return (
    <div className="space-y-2 text-sm">
      {a.jerarquia.map(amb => (
        <details key={amb.name} className="rounded-lg border border-line" open={a.jerarquia.length === 1}>
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 font-medium">
            <span>{amb.name}</span>
            <span className="tabular text-muted">{formatMoney(amb.cents, currency)} · {pct(amb.cents)}</span>
          </summary>
          <ul className="space-y-1 px-3 pb-2">
            {amb.children.map(cat => (
              <li key={cat.name}>
                <div className="flex justify-between"><span className="text-ink">{cat.name}</span><span className="tabular text-muted">{formatMoney(cat.cents, currency)}</span></div>
                <ul className="ml-3 border-l border-line pl-3 text-xs text-muted">
                  {cat.children.map(s => <li key={s.name} className="flex justify-between"><span>{s.name}</span><span className="tabular">{formatMoney(s.cents, currency)}</span></li>)}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  )
}
