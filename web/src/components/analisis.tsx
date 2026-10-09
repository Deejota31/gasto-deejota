import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { CalendarDays, CalendarRange, ChartNoAxesColumn, ChevronDown, ChevronsDownUp, ChevronsUpDown, CircleDollarSign, Flame, GitFork, Target } from 'lucide-react'
import type { Aggregates, FrecuenciaPunto, Item } from '../lib/engine'
import { formatMoney } from '../lib/money'
import { formatDate } from '../lib/dates'
import { ambitoLook, categoriaLook, medioLook } from '../lib/visual'
import type { CatalogoItem } from '../lib/types'
import { Empty } from './ui'
import { compact, pct, TipBox } from './charts'

/** Contexto temporal compartido por las tres vistas. */
export interface Periodo {
  /** "Octubre 2026" o "01 oct – 15 nov 2026". */
  nombre: string
  desde: string
  hasta: string
  dateFormat?: string
}

type Vista = 'jerarquia' | 'sankey' | 'frecuencia'
const VISTAS: readonly (readonly [Vista, string, string, typeof GitFork])[] = [
  ['jerarquia', 'Jerarquía', 'Jerarquía', GitFork],
  ['sankey', 'Flujo de medios de pago', 'Flujo', CircleDollarSign],
  ['frecuencia', 'Frecuencia vs monto', 'Frecuencia', Target],
]

export const SIN_DATOS = 'No hay datos suficientes para este análisis en el período seleccionado.'
const vacio = <Empty icon={<ChartNoAxesColumn className="size-5" />} title="Sin datos para analizar">{SIN_DATOS}</Empty>

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const listaY = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`)

// La vista elegida se recuerda durante la sesión (al cambiar de pestaña de la app y volver).
let vistaSesion: Vista = 'jerarquia'

/** Tarjeta completa del análisis detallado: encabezado con contexto, pestañas y la vista activa. */
export function AnalisisDetallado({ a, currency, catalogo, periodo, filtros, onPickCategoria }: {
  a: Aggregates; currency: string; catalogo: CatalogoItem[]; periodo: Periodo; filtros: string[]; onPickCategoria: (cat: string) => void
}) {
  const [vista, setVistaState] = useState<Vista>(vistaSesion)
  const setVista = (v: Vista) => { vistaSesion = v; setVistaState(v) }
  const rango = `${formatDate(periodo.desde, periodo.dateFormat)} – ${formatDate(periodo.hasta, periodo.dateFormat)}`
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  // Flechas izquierda/derecha entre pestañas (patrón WAI-ARIA tabs).
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const j = (i + d + VISTAS.length) % VISTAS.length
    setVista(VISTAS[j][0])
    tabs.current[j]?.focus()
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted" data-testid="analisis-contexto">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 font-medium text-navy first-letter:uppercase">
          <CalendarDays className="size-3.5" /> <span className="first-letter:uppercase">{periodo.nombre}</span>
        </span>
        <span className="tabular">{rango}</span>
        <span aria-hidden>·</span>
        <span>{plural(a.count, 'movimiento', 'movimientos')}</span>
        {a.resumen.monedas.length > 0 && <><span aria-hidden>·</span><span>{listaY(a.resumen.monedas)}</span></>}
        {a.resumen.monedas.some(m => m !== currency) && <span className="text-[11px]">(convertido a {currency})</span>}
        {filtros.length > 0 && (
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-bg px-2.5 py-1">
            Filtros: <b className="max-w-[16rem] truncate font-medium text-ink">{filtros.join(', ')}</b>
          </span>
        )}
      </div>

      <div role="tablist" aria-label="Vistas del análisis" className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-bg p-1">
        {VISTAS.map(([id, label, corto, Icon], i) => {
          const on = vista === id
          return (
            <button key={id} ref={el => { tabs.current[i] = el }} role="tab" id={`tab-${id}`} aria-label={label} aria-selected={on} aria-controls={`panel-${id}`}
              tabIndex={on ? 0 : -1} onClick={() => setVista(id)} onKeyDown={e => onKey(e, i)}
              className={`relative flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-navy/50 ${on ? 'bg-card text-navy shadow-sm ring-1 ring-line' : 'text-muted hover:bg-card/60 hover:text-ink'}`}>
              <Icon className={`size-4 shrink-0 ${on ? 'text-morado' : ''}`} />
              <span className="truncate sm:hidden">{corto}</span><span className="hidden truncate sm:inline">{label}</span>
              {on && <span className="absolute inset-x-4 -bottom-px h-0.5 rounded-full bg-morado" aria-hidden />}
            </button>
          )
        })}
      </div>

      <div key={vista} role="tabpanel" id={`panel-${vista}`} aria-labelledby={`tab-${vista}`} className="fade-in">
        {vista === 'jerarquia' && <Jerarquia a={a} currency={currency} catalogo={catalogo} periodo={periodo} />}
        {vista === 'sankey' && <FlujoMedios a={a} currency={currency} catalogo={catalogo} periodo={periodo} rango={rango} />}
        {vista === 'frecuencia' && <Frecuencia a={a} currency={currency} catalogo={catalogo} periodo={periodo} onPick={onPickCategoria} />}
      </div>
    </div>
  )
}

function Subtitulo({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-sm font-semibold text-ink first-letter:uppercase">{titulo}</p>
      {children && <p className="text-xs text-muted">{children}</p>}
    </div>
  )
}

function Barra({ value, max, color, className = 'h-1.5' }: { value: number; max: number; color: string; className?: string }) {
  return (
    <span className={`block overflow-hidden rounded-full bg-bg ${className}`}>
      <span className="bar-grow block h-full rounded-full" style={{ width: `${max ? Math.max(1.5, (value / max) * 100) : 0}%`, background: color }} />
    </span>
  )
}

// ───────────────────────────── Jerarquía ─────────────────────────────

// Ámbitos abiertos/cerrados durante la sesión. Si el usuario no tocó nada, se abre solo el más importante.
const abiertosSesion = new Map<string, boolean>()

export function Jerarquia({ a, currency, catalogo, periodo }: { a: Aggregates; currency: string; catalogo: CatalogoItem[]; periodo: Periodo }) {
  const [, rerender] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  if (!a.jerarquia.length) return vacio
  const abierto = (name: string, i: number) => abiertosSesion.get(name) ?? i === 0
  const set = (name: string, v: boolean) => { abiertosSesion.set(name, v); rerender(x => x + 1) }
  const todos = a.jerarquia.every((x, i) => abierto(x.name, i))
  const maxAmb = a.jerarquia[0].cents

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Subtitulo titulo={`Jerarquía del gasto — ${periodo.nombre}`}>Ámbito → categoría → subcategoría. El porcentaje de cada nivel es sobre su nivel superior.</Subtitulo>
        {a.jerarquia.length > 1 && (
          <button type="button" onClick={() => a.jerarquia.forEach(x => set(x.name, !todos))}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted transition hover:bg-bg hover:text-ink focus-visible:ring-2 focus-visible:ring-navy/40 outline-none">
            {todos ? <><ChevronsDownUp className="size-3.5" /> Contraer todo</> : <><ChevronsUpDown className="size-3.5" /> Expandir todo</>}
          </button>
        )}
      </div>
      <ul className="space-y-2.5 text-sm" aria-label="Jerarquía del gasto">
        {a.jerarquia.map((amb, i) => {
          const look = ambitoLook(amb.name, catalogo)
          const open = abierto(amb.name, i)
          const dim = hover !== null && hover !== amb.name
          const maxCat = amb.children[0]?.cents ?? 0
          return (
            <li key={amb.name} onMouseEnter={() => setHover(amb.name)} onMouseLeave={() => setHover(null)}
              className={`rounded-2xl border transition ${hover === amb.name ? 'border-transparent shadow-md' : 'border-line'} ${dim ? 'opacity-60' : ''}`}
              style={hover === amb.name ? { boxShadow: `0 0 0 1.5px ${look.color}66, 0 6px 18px rgb(15 23 42 / 0.06)` } : undefined}>
              <button type="button" aria-expanded={open} onClick={() => set(amb.name, !open)}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-navy/40">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: `${look.color}1F`, color: look.color }}><look.Icon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold text-ink">{amb.name}</span>
                    <span className="tabular shrink-0 font-semibold text-ink">{formatMoney(amb.cents, currency)}</span>
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <Barra value={amb.cents} max={maxAmb} color={look.color} className="h-2 flex-1" />
                    <span className="tabular w-12 shrink-0 text-right text-xs font-semibold" style={{ color: look.color }}>{pct(amb.cents, a.total)}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">{plural(amb.count, 'movimiento', 'movimientos')} · {plural(amb.children.length, 'categoría', 'categorías')}</span>
                </span>
                <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <ul className="space-y-1 border-t border-line px-2 pt-2 pb-2.5 sm:px-3">
                  {amb.children.map(cat => {
                    const cl = categoriaLook(cat.name, catalogo, amb.name)
                    const maxSub = cat.children[0]?.cents ?? 0
                    return (
                      <li key={cat.name} className="group rounded-xl px-2 py-1.5 transition hover:bg-bg">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: `${cl.color}1A`, color: cl.color }}><cl.Icon className="size-3.5" /></span>
                            <span className="truncate font-medium text-ink" title={cat.name}>{cat.name}</span>
                            <span className="shrink-0 text-[11px] text-muted">{cat.count} mov.</span>
                          </span>
                          <span className="text-right">
                            <span className="tabular font-semibold text-ink">{formatMoney(cat.cents, currency)}</span>
                            <span className="tabular ml-2 inline-block w-11 text-xs text-muted">{pct(cat.cents, amb.cents)}</span>
                          </span>
                          <span className="col-span-2 mt-1 pl-8"><Barra value={cat.cents} max={maxCat} color={`${cl.color}CC`} /></span>
                        </div>
                        <ul className="mt-1.5 ml-3 space-y-1 border-l-2 pl-4 text-xs" style={{ borderColor: `${cl.color}40` }}>
                          {cat.children.map(s => (
                            <li key={s.name} className="grid grid-cols-[minmax(0,1fr)_2.5rem_auto] items-center gap-2 text-muted sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
                              title={`${s.name}: ${formatMoney(s.cents, currency)} · ${pct(s.cents, cat.cents)} de ${cat.name} · ${s.count} mov.`}>
                              <span className="truncate group-hover:text-ink">{s.name} <span className="text-[10px]">· {s.count}</span></span>
                              <Barra value={s.cents} max={maxSub} color={`${cl.color}80`} className="h-1" />
                              <span className="tabular whitespace-nowrap text-right">{formatMoney(s.cents, currency)} <span className="inline-block w-10 text-[11px]">{pct(s.cents, cat.cents)}</span></span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ──────────────────────── Flujo de medios de pago ────────────────────────

/** Ancho del contenedor (callback ref: funciona aunque el elemento aparezca después del primer render). */
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, w, el] as const
}

type Foco = { tipo: 'medio' | 'ambito'; name: string } | { tipo: 'link'; medio: string; ambito: string } | null

interface NodoPos extends Item { x: number; y: number; h: number; color: string; tipo: 'medio' | 'ambito' }
interface LinkPos { medio: string; ambito: string; cents: number; count: number; y0: number; y1: number; t: number }

/** Disposición de un Sankey de dos columnas: nodos proporcionales al monto y enlaces apilados en el mismo orden. */
export function layoutSankey(s: Aggregates['sankey'], width: number, height: number, labelW: number, colorMedio: (n: string) => string, colorAmb: (n: string) => string) {
  const nodeW = 14, gap = 14
  const total = s.medios.reduce((x, m) => x + m.cents, 0)
  const n = Math.max(s.medios.length, s.ambitos.length)
  const usable = Math.max(40, height - gap * (n - 1))
  // Altura mínima para que nodos pequeños sigan siendo visibles y "tocables".
  const minH = 4
  const k = total ? usable / total : 0
  const col = (items: Item[], x: number, tipo: 'medio' | 'ambito', color: (n: string) => string): NodoPos[] => {
    const hs = items.map(it => Math.max(minH, it.cents * k))
    const used = hs.reduce((a, b) => a + b, 0) + gap * (items.length - 1)
    let y = Math.max(0, (height - used) / 2)
    return items.map((it, i) => { const p = { ...it, x, y, h: hs[i], color: color(it.name), tipo }; y += hs[i] + gap; return p })
  }
  const x0 = labelW, x1 = width - labelW - nodeW
  const medios = col(s.medios, x0, 'medio', colorMedio)
  const ambitos = col(s.ambitos, x1, 'ambito', colorAmb)
  const mi = new Map(medios.map(m => [m.name, m])), ai = new Map(ambitos.map(m => [m.name, m]))
  const offS = new Map<string, number>(), offT = new Map<string, number>()
  const ordenA = new Map(ambitos.map((x, i) => [x.name, i])), ordenM = new Map(medios.map((x, i) => [x.name, i]))
  // Enlaces ordenados por destino dentro de cada medio y por origen dentro de cada ámbito: menos cruces.
  const bySource = [...s.links].sort((p, q) => (ordenM.get(p.medio)! - ordenM.get(q.medio)!) || (ordenA.get(p.ambito)! - ordenA.get(q.ambito)!))
  const pos = new Map<string, LinkPos>()
  for (const l of bySource) {
    const m = mi.get(l.medio)!
    const t = m.cents ? (l.cents / m.cents) * m.h : 0
    const o = offS.get(l.medio) ?? 0
    offS.set(l.medio, o + t)
    pos.set(`${l.medio}\u0000${l.ambito}`, { ...l, y0: m.y + o + t / 2, y1: 0, t })
  }
  const byTarget = [...s.links].sort((p, q) => (ordenA.get(p.ambito)! - ordenA.get(q.ambito)!) || (ordenM.get(p.medio)! - ordenM.get(q.medio)!))
  for (const l of byTarget) {
    const a = ai.get(l.ambito)!
    const p = pos.get(`${l.medio}\u0000${l.ambito}`)!
    const t = a.cents ? (l.cents / a.cents) * a.h : 0
    const o = offT.get(l.ambito) ?? 0
    offT.set(l.ambito, o + t)
    p.y1 = a.y + o + t / 2
    p.t = Math.max(1, Math.min(p.t, t) || 1)
  }
  return { medios, ambitos, links: [...pos.values()], x0: x0 + nodeW, x1, nodeW, total }
}

function FlujoMedios({ a, currency, catalogo, periodo, rango }: { a: Aggregates; currency: string; catalogo: CatalogoItem[]; periodo: Periodo; rango: string }) {
  const [ref, width, el] = useWidth<HTMLDivElement>()
  const [foco, setFoco] = useState<Foco>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const s = a.sankey
  const n = Math.max(s.medios.length, s.ambitos.length)
  const height = Math.max(240, Math.min(460, n * 46))
  const narrow = width < 520
  const labelW = Math.round(Math.min(150, Math.max(92, width * 0.26)))
  const L = useMemo(() => width > 0 && s.links.length
    ? layoutSankey(s, width, height, labelW, m => medioLook(m).color, x => ambitoLook(x, catalogo).color)
    : null, [s, width, height, labelW, catalogo])

  // Si cambia el filtro y el elemento enfocado desaparece, limpiar el foco.
  useEffect(() => { setFoco(null); setTip(null) }, [s])

  if (!s.links.length) return vacio

  const relacionado = (l: { medio: string; ambito: string }) =>
    !foco ? null : foco.tipo === 'link' ? l.medio === foco.medio && l.ambito === foco.ambito
      : foco.tipo === 'medio' ? l.medio === foco.name : l.ambito === foco.name
  const nodoActivo = (nd: NodoPos) =>
    !foco ? null : foco.tipo === 'link' ? (nd.tipo === 'medio' ? nd.name === foco.medio : nd.name === foco.ambito)
      : foco.tipo === nd.tipo ? nd.name === foco.name
        : s.links.some(l => (foco.tipo === 'medio' ? l.medio === foco.name && l.ambito === nd.name : l.ambito === foco.name && l.medio === nd.name))

  const mover = (e: React.PointerEvent | React.MouseEvent) => {
    const r = el?.getBoundingClientRect()
    if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top })
  }
  const enfocar = (f: Foco, e?: React.PointerEvent | React.MouseEvent | React.FocusEvent, cx?: number, cy?: number) => {
    setFoco(f)
    if (e && 'clientX' in e) mover(e)
    else if (cx !== undefined && cy !== undefined) setTip({ x: cx, y: cy })
  }
  const salir = () => { setFoco(null); setTip(null) }

  const tipContent = (() => {
    if (!foco) return null
    if (foco.tipo === 'link') {
      const l = s.links.find(x => x.medio === foco.medio && x.ambito === foco.ambito)
      if (!l) return null
      const m = s.medios.find(x => x.name === l.medio)!, am = s.ambitos.find(x => x.name === l.ambito)!
      return <TipBox title={`${l.medio} → ${l.ambito}`} rows={[
        { label: 'Monto', value: formatMoney(l.cents, currency) },
        { label: 'Movimientos', value: String(l.count) },
        { label: `% de ${l.medio}`, value: pct(l.cents, m.cents) },
        { label: `% de ${l.ambito}`, value: pct(l.cents, am.cents) },
        { label: '% del total', value: pct(l.cents, a.total) },
      ]} />
    }
    const it = (foco.tipo === 'medio' ? s.medios : s.ambitos).find(x => x.name === foco.name)
    if (!it) return null
    const conex = s.links.filter(l => (foco.tipo === 'medio' ? l.medio : l.ambito) === foco.name).length
    return <TipBox title={`${foco.tipo === 'medio' ? 'Medio de pago' : 'Ámbito'}: ${it.name}`} rows={[
      { label: 'Monto total', value: formatMoney(it.cents, currency) },
      { label: 'Movimientos', value: String(it.count) },
      { label: '% del total', value: pct(it.cents, a.total) },
      { label: foco.tipo === 'medio' ? 'Ámbitos' : 'Medios de pago', value: String(conex) },
    ]} />
  })()

  const trunc = (t: string) => {
    const max = Math.max(6, Math.floor((labelW - 12) / 6.4))
    return t.length > max ? `${t.slice(0, max - 1)}…` : t
  }
  const r = a.resumen

  return (
    <div>
      <Subtitulo titulo={`Flujo de medios de pago — ${periodo.nombre}`}>
        Del {rango.replace(' – ', ' al ')} · {plural(a.count, 'movimiento', 'movimientos')} en el rango. Pasa el mouse (o toca) un medio, un ámbito o una conexión.
      </Subtitulo>
      <div ref={ref} className="relative select-none" onMouseLeave={salir}>
        {L && (
          <svg width={width} height={height} role="group" aria-label="Flujo del gasto desde cada medio de pago hacia cada ámbito" className="block overflow-visible">
            <defs>
              {L.links.map((l, i) => (
                <linearGradient key={i} id={`sk-${i}`} gradientUnits="userSpaceOnUse" x1={L.x0} x2={L.x1} y1={0} y2={0}>
                  <stop offset="0%" stopColor={medioLook(l.medio).color} />
                  <stop offset="100%" stopColor={ambitoLook(l.ambito, catalogo).color} />
                </linearGradient>
              ))}
            </defs>
            <g>
              {L.links.map((l, i) => {
                const rel = relacionado(l)
                const mx = (L.x0 + L.x1) / 2
                const d = `M${L.x0},${l.y0} C${mx},${l.y0} ${mx},${l.y1} ${L.x1},${l.y1}`
                return (
                  <path key={i} d={d} fill="none" stroke={`url(#sk-${i})`} strokeWidth={l.t}
                    strokeOpacity={rel === null ? 0.42 : rel ? 0.82 : 0.07}
                    style={{ transition: 'stroke-opacity .18s ease', cursor: 'pointer' }}
                    data-testid="sankey-link" aria-label={`${l.medio} hacia ${l.ambito}: ${formatMoney(l.cents, currency)}`}
                    onPointerEnter={e => enfocar({ tipo: 'link', medio: l.medio, ambito: l.ambito }, e)} onPointerMove={mover}
                    onClick={e => enfocar({ tipo: 'link', medio: l.medio, ambito: l.ambito }, e)} />
                )
              })}
            </g>
            {[...L.medios, ...L.ambitos].map(nd => {
              const act = nodoActivo(nd)
              const izq = nd.tipo === 'medio'
              const tx = izq ? nd.x - 8 : nd.x + L.nodeW + 8
              const cy = nd.y + nd.h / 2
              const f: Foco = { tipo: nd.tipo, name: nd.name }
              return (
                <g key={`${nd.tipo}-${nd.name}`} tabIndex={0} role="button" data-testid={`sankey-${nd.tipo}`}
                  aria-label={`${nd.name}: ${formatMoney(nd.cents, currency)}, ${pct(nd.cents, a.total)}, ${plural(nd.count, 'movimiento', 'movimientos')}`}
                  style={{ cursor: 'pointer', outline: 'none', opacity: act === false ? 0.35 : 1, transition: 'opacity .18s ease' }}
                  onPointerEnter={e => enfocar(f, e)} onPointerMove={mover} onClick={e => enfocar(f, e)}
                  onFocus={() => enfocar(f, undefined, izq ? nd.x + 30 : nd.x - 150, cy)} onBlur={salir}>
                  <rect x={nd.x - 6} y={nd.y - 4} width={L.nodeW + 12} height={nd.h + 8} fill="transparent" />
                  <rect x={nd.x} y={nd.y} width={L.nodeW} height={nd.h} rx={4} fill={nd.color}
                    stroke={act ? 'var(--ink)' : 'var(--card)'} strokeWidth={act ? 1.5 : 1} />
                  <text x={tx} y={cy - (nd.h >= 22 || !narrow ? 6 : 0)} textAnchor={izq ? 'end' : 'start'} dominantBaseline="middle"
                    fontSize={narrow ? 11 : 12} fontWeight={600} fill="var(--ink)">{trunc(nd.name)}</text>
                  {(nd.h >= 22 || !narrow) && (
                    <text x={tx} y={cy + 9} textAnchor={izq ? 'end' : 'start'} dominantBaseline="middle" fontSize={10.5} fill="var(--muted)" className="tabular">
                      {compact(nd.cents, currency)} · {pct(nd.cents, a.total)}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
        {!L && <div style={{ height }} />}
        {foco && tip && tipContent && (
          <div className="pointer-events-none absolute z-10" role="tooltip" data-testid="sankey-tooltip"
            style={{ left: tip.x > width / 2 ? tip.x - 14 : tip.x + 14, top: tip.y > height / 2 ? tip.y - 10 : tip.y + 14,
              transform: `translate(${tip.x > width / 2 ? '-100%' : '0'}, ${tip.y > height / 2 ? '-100%' : '0'})` }}>
            {tipContent}
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-between px-1 text-[10px] font-semibold tracking-wide text-muted uppercase" aria-hidden>
        <span>Medio de pago</span><span>Ámbito</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" data-testid="sankey-resumen">
        <Dato icon={<CalendarRange className="size-3.5" />} label="Primer movimiento" value={r.primerFecha ? formatDate(r.primerFecha, periodo.dateFormat) : '—'} />
        <Dato icon={<CalendarRange className="size-3.5" />} label="Último movimiento" value={r.ultimaFecha ? formatDate(r.ultimaFecha, periodo.dateFormat) : '—'} />
        <Dato icon={<Flame className="size-3.5" />} label="Día de mayor gasto" value={r.diaMax ? formatDate(r.diaMax.date, periodo.dateFormat) : '—'} sub={r.diaMax ? formatMoney(r.diaMax.cents, currency) : undefined} />
        <Dato icon={<CircleDollarSign className="size-3.5" />} label="Medio dominante" value={r.medioDominante?.name ?? '—'}
          sub={r.medioDominante ? `${pct(r.medioDominante.cents, a.total)} del gasto` : undefined} color={r.medioDominante ? medioLook(r.medioDominante.name).color : undefined} />
      </dl>
    </div>
  )
}

function Dato({ icon, label, value, sub, color }: { icon: ReactNode; label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl bg-bg px-3 py-2">
      <dt className="flex items-center gap-1 text-[11px] text-muted">{icon}{label}</dt>
      <dd className="tabular truncate font-semibold text-ink" style={color ? { color } : undefined}>{value}</dd>
      {sub && <dd className="tabular truncate text-[11px] text-muted">{sub}</dd>}
    </div>
  )
}

// ───────────────────────── Frecuencia vs monto ─────────────────────────

/** Techo "redondo" (1, 2, 2.5, 5 × 10ⁿ por tick) para que el eje Y muestre valores legibles. */
export function niceMax(v: number, ticks = 4): number {
  if (v <= 0) return 100
  const raw = v / ticks
  const p = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(x => x >= raw)!
  return step * ticks
}

type Punto = FrecuenciaPunto & { ambito: string; color: string; dx: number }

/** Separa horizontalmente (unos px) los puntos con la misma cantidad de movimientos y montos parecidos. */
export function jitter(ps: { count: number; cents: number }[], maxCents: number): number[] {
  const dx = new Array<number>(ps.length).fill(0)
  const byCount = new Map<number, number[]>()
  ps.forEach((p, i) => byCount.set(p.count, [...(byCount.get(p.count) ?? []), i]))
  for (const idx of byCount.values()) {
    idx.sort((i, j) => ps[i].cents - ps[j].cents)
    let run: number[] = []
    const flush = () => { run.forEach((i, k) => { dx[i] = (k - (run.length - 1) / 2) * 12 }); run = [] }
    for (const i of idx) {
      if (run.length && ps[i].cents - ps[run.at(-1)!].cents > maxCents * 0.06) flush()
      run.push(i)
    }
    flush()
  }
  return dx
}

function Frecuencia({ a, currency, catalogo, periodo, onPick }: { a: Aggregates; currency: string; catalogo: CatalogoItem[]; periodo: Periodo; onPick: (cat: string) => void }) {
  const [hover, setHover] = useState<string | null>(null)
  const [ref, width] = useWidth<HTMLDivElement>()
  const [grupoFijo, setGrupoFijo] = useState<string | null>(null)
  const [grupoHover, setGrupoHover] = useState<string | null>(null)
  const grupo = grupoHover ?? grupoFijo
  const puntos: Punto[] = useMemo(() => {
    const max = Math.max(1, ...a.frecuencia.map(p => p.cents))
    const dx = jitter(a.frecuencia, max)
    return a.frecuencia.map((p, i) => {
      const ambito = p.ambitos[0] ?? ''
      return { ...p, ambito, color: ambitoLook(ambito, catalogo).color, dx: dx[i] }
    })
  }, [a.frecuencia, catalogo])
  if (!puntos.length) return vacio

  const ambitos = [...new Set(puntos.map(p => p.ambito))]
  const maxCount = Math.max(...puntos.map(p => p.count))
  const avgCount = a.count / puntos.length
  const avgCents = a.total / puntos.length
  // Las 3 categorías con más gasto siempre llevan etiqueta; el resto, al pasar el mouse.
  const top = new Set(puntos.slice(0, 3).map(p => p.name))
  const activo = (p: Punto) => (hover ? hover === p.name : grupo ? p.ambito === grupo : true)

  return (
    <div>
      <Subtitulo titulo="Frecuencia vs monto por categoría">
        Periodo: <span className="first-letter:uppercase">{periodo.nombre}</span> · cada burbuja es una categoría; su tamaño es el monto. Derecha = compras frecuentes, arriba = más dinero. Clic para filtrar.
      </Subtitulo>
      <div ref={ref} className="h-80" role="img" aria-label="Cantidad de movimientos frente a monto total por categoría" data-testid="frecuencia">
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 18, right: 24, left: 4, bottom: 18 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="4 4" />
            <XAxis type="number" dataKey="count" name="Movimientos" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={{ stroke: 'var(--line)' }}
              allowDecimals={false} domain={[0, Math.max(2, maxCount + 1)]}
              label={{ value: 'Cantidad de movimientos', position: 'insideBottom', offset: -10, fontSize: 11, fill: 'var(--muted)' }} />
            <YAxis type="number" dataKey="cents" name="Monto" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} width={64}
              domain={[0, niceMax(Math.max(...puntos.map(p => p.cents)) * 1.12)]} tickCount={5} tickFormatter={v => compact(v, currency)} />
            <ZAxis type="number" dataKey="cents" range={width && width < 520 ? [140, 700] : [260, 1600]} />
            {puntos.length > 2 && <ReferenceLine x={avgCount} stroke="var(--muted)" strokeOpacity={0.5} strokeDasharray="3 4"
              label={{ value: 'prom. mov.', position: 'top', fontSize: 10, fill: 'var(--muted)' }} />}
            {puntos.length > 2 && <ReferenceLine y={avgCents} stroke="var(--muted)" strokeOpacity={0.5} strokeDasharray="3 4"
              label={{ value: 'monto prom.', position: 'insideBottomRight', fontSize: 10, fill: 'var(--muted)' }} />}
            <Tooltip cursor={{ strokeDasharray: '3 3', stroke: 'var(--line)' }} isAnimationActive={false} content={({ payload }) => {
              const p = payload?.[0]?.payload as Punto | undefined
              return p ? <TipBox title={p.name} rows={[
                { label: 'Ámbito', value: p.ambitos.join(', ') },
                { label: 'Movimientos', value: String(p.count) },
                { label: 'Monto total', value: formatMoney(p.cents, currency) },
                { label: '% del total', value: pct(p.cents, a.total) },
                { label: 'Promedio por mov.', value: formatMoney(Math.round(p.cents / p.count), currency) },
              ]} /> : null
            }} />
            <Scatter data={puntos} cursor="pointer" isAnimationActive
              onMouseEnter={(d: unknown) => setHover((d as { payload?: Punto }).payload?.name ?? null)} onMouseLeave={() => setHover(null)}
              onClick={(d: unknown) => { const nm = (d as { payload?: Punto }).payload?.name; if (nm) onPick(nm) }}
              shape={(props: unknown) => {
                const { cx = 0, cy = 0, size = 300, payload } = props as { cx?: number; cy?: number; size?: number; payload: Punto }
                const rr = Math.sqrt(size / Math.PI)
                const on = activo(payload)
                const lbl = hover === payload.name || (!hover && !grupo && top.has(payload.name)) || (grupo !== null && payload.ambito === grupo)
                const x = cx + payload.dx
                return (
                  <g style={{ transition: 'opacity .18s ease' }} opacity={on ? 1 : 0.25} data-testid="frecuencia-punto">
                    <circle cx={x} cy={cy} r={hover === payload.name ? rr + 3 : rr} fill={payload.color} fillOpacity={0.62}
                      stroke={payload.color} strokeWidth={hover === payload.name ? 3 : 1.75} />
                    <circle cx={x} cy={cy} r={2.2} fill="var(--card)" />
                    {lbl && (
                      <text x={x} y={cy - rr - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)"
                        stroke="var(--card)" strokeWidth={3} paintOrder="stroke">{payload.name}</text>
                    )}
                  </g>
                )
              }} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {ambitos.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Resaltar por ámbito">
          {ambitos.map(am => {
            const look = ambitoLook(am, catalogo)
            const on = grupoFijo === am
            return (
              <button key={am} type="button" aria-pressed={on} onClick={() => setGrupoFijo(on ? null : am)}
                onMouseEnter={() => setGrupoHover(am)} onMouseLeave={() => setGrupoHover(null)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-navy/40 ${on ? 'border-navy/30 bg-bg text-ink' : 'border-line text-muted hover:text-ink'}`}>
                <span className="size-2.5 rounded-full" style={{ background: look.color }} />{am}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
