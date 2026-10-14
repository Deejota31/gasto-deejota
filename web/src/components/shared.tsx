import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, CreditCard, FilterX, Layers, Search, Shapes, Tag, X } from 'lucide-react'
import { formatDate, monthLabel, monthEnd, presetRange, rangeLabel, shiftMonth, singleMonth } from '../lib/dates'
import { subKey } from '../lib/engine'
import { ambitoLook, categoriaLook, medioLook, sortMedios, subcategoriaLook, type Look } from '../lib/visual'
import type { CatalogoItem, Filters, PeriodPreset } from '../lib/types'
import { normName, otrosAlFinal } from '../lib/orden'
import { TIPOS_GASTO } from '../lib/types'
import { Checkbox, inputCls } from './ui'
import { Calendario } from './DatePicker'
import { usePopover } from './Combobox'

export function emptyFilters(today: string): Filters {
  return { preset: 'mes', ...presetRange('mes', today), ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
}

/**
 * Opciones del catálogo, dependientes: ámbitos → categorías → subcategorías. Usa el catálogo ya ordenado
 * (sortCatalogo) y aplica "Otros" al final también al mezclar varios ámbitos.
 * `historicos`: valores que aparecen en gastos pero ya no están activos; se agregan para poder filtrarlos.
 */
/** Filas ofrecidas para gastos nuevos: activas y sin una categoría o ámbito desactivado por encima. */
function vigentes(catalogo: CatalogoItem[]): CatalogoItem[] {
  const off = new Set(catalogo.filter(c => !c.activo && !c.subcategoria).map(c => `${c.ambito}|${c.categoria}`))
  return catalogo.filter(c => c.activo && !off.has(`${c.ambito}|${c.categoria}`) && !off.has(`${c.ambito}|`))
}

export function catalogOptions(catalogo: CatalogoItem[], ambitos: string[], categorias: string[], historicos: Pick<CatalogoItem, 'ambito' | 'categoria' | 'subcategoria'>[] = []) {
  const act: Pick<CatalogoItem, 'ambito' | 'categoria' | 'subcategoria'>[] = vigentes(catalogo)
  const all = [...act, ...historicos]
  const uniq = (xs: string[]) => otrosAlFinal([...new Set(xs.filter(Boolean))])
  const inAmb = all.filter(c => !ambitos.length || ambitos.includes(c.ambito))
  const cats = uniq(inAmb.map(c => c.categoria))
  const subs = new Map<string, { key: string; categoria: string; subcategoria: string }>()
  for (const c of inAmb) {
    if (!c.subcategoria || (categorias.length && !categorias.includes(c.categoria))) continue
    const key = subKey(c.categoria, c.subcategoria)
    if (!subs.has(key)) subs.set(key, { key, categoria: c.categoria, subcategoria: c.subcategoria })
  }
  // Agrupadas por categoría (en el orden de categorías) y "Otros" al final de cada grupo.
  const byCat = (c: string) => otrosAlFinal([...subs.values()].filter(s => s.categoria === c), s => s.subcategoria)
  const extraCats = [...new Set([...subs.values()].map(s => s.categoria))].filter(c => !cats.includes(c))
  return { ambitos: uniq(all.map(c => c.ambito)), categorias: cats, subcategorias: [...cats, ...extraCats].flatMap(byCat) }
}

/** Combinaciones ámbito/categoría/subcategoría usadas en gastos que ya no están activas en el catálogo. */
export function historicos(catalogo: CatalogoItem[], gastos: { ambito: string; categoria: string; subcategoria: string }[]) {
  const k = (a: string, c: string, s: string) => `${normName(a)}|${normName(c)}|${normName(s)}`
  const ofrecidas = new Set(vigentes(catalogo).map(c => k(c.ambito, c.categoria, c.subcategoria)))
  const out = new Map<string, { ambito: string; categoria: string; subcategoria: string }>()
  for (const g of gastos) {
    const key = k(g.ambito, g.categoria, g.subcategoria)
    if (!ofrecidas.has(key) && !out.has(key)) out.set(key, { ambito: g.ambito, categoria: g.categoria, subcategoria: g.subcategoria })
  }
  return [...out.values()]
}

export interface Option { value: string; label: string; group?: string; groupLook?: Look; look?: Look }

/**
 * Selector múltiple con búsqueda, iconos y colores del catálogo, y casillas. Sin selección = todas.
 * El panel se pinta fuera del contenedor (nunca se corta ni se sale de la pantalla) y se maneja con teclado.
 */
export function MultiSelect({ label, icon, options, value, onChange, allLabel }: {
  label: string; icon: ReactNode; options: Option[]; value: string[]; onChange: (v: string[]) => void; allLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const { pos, host } = usePopover(open, btn, { minWidth: 288, maxWidth: 400, maxHeight: 440 })
  const close = useCallback((foco = true) => { setOpen(false); setQ(''); if (foco) btn.current?.focus() }, [])
  useEffect(() => {
    if (!open) return
    const fuera = (e: PointerEvent) => { const n = e.target as Node; if (!panel.current?.contains(n) && !btn.current?.contains(n)) close(false) }
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [open, close])
  const term = q.trim().toLowerCase()
  const shown = options.filter(o => !term || `${o.label} ${o.group ?? ''}`.toLowerCase().includes(term))
  const groups = [...new Set(shown.map(o => o.group ?? ''))]
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  const first = value[0] ? options.find(o => o.value === value[0]) : undefined
  const summary = !value.length ? allLabel : value.length === 1 ? (first?.label ?? value[0]) : `${value.length} seleccionadas`
  const SummaryIcon = value.length === 1 ? first?.look?.Icon : undefined
  // ↑ ↓ mueven el foco entre las casillas del panel.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const xs = [...(panel.current?.querySelectorAll<HTMLElement>('input.cb, input[type=search], input[data-buscar]') ?? [])]
    const i = xs.indexOf(document.activeElement as HTMLElement)
    if (!xs.length) return
    e.preventDefault()
    xs[Math.max(0, Math.min(xs.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus()
  }

  return (
    <div className="relative">
      <button ref={btn} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => (open ? close(false) : setOpen(true))}
        className={`flex h-10 w-full items-center gap-2 rounded-xl border px-3 text-left text-sm transition ${value.length ? 'border-navy/40 bg-primary-soft text-navy' : 'border-line bg-card text-ink hover:border-navy/30'}`}>
        <span className="shrink-0 text-muted [&>svg]:size-4">{SummaryIcon ? <SummaryIcon style={{ color: first?.look?.color }} /> : icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] leading-none font-medium tracking-wide text-muted uppercase">{label}</span>
          <span className="block truncate text-[13px] leading-tight font-medium" title={summary}>{summary}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div ref={panel} onKeyDown={onKey}
          style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
          className="fade-in z-[300] flex flex-col rounded-2xl border border-line bg-card p-2 text-ink shadow-xl ring-1 ring-black/5">
          <div className="flex items-center justify-between px-2 pt-1 pb-2">
            <p className="text-sm font-semibold">{label}</p>
            <span className="text-[11px] text-muted">{value.length ? `${value.length} seleccionada${value.length === 1 ? '' : 's'}` : 'Selecciona varias'}</span>
          </div>
          {options.length > 8 && (
            <label className="relative mb-2 block">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
              <input autoFocus data-buscar aria-label={`Buscar ${label.toLowerCase()}`} className={`${inputCls} pl-8`} placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} />
            </label>
          )}
          <label className={`mb-1 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium transition ${!value.length ? 'bg-primary-soft text-navy' : 'hover:bg-bg'}`}>
            <Checkbox label={allLabel} checked={!value.length} onChange={() => onChange([])} />
            {allLabel}
          </label>
          <div role="listbox" aria-multiselectable="true" aria-label={label} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {!shown.length && <p className="px-2 py-4 text-center text-xs text-muted">Sin resultados.</p>}
            {groups.map(gname => {
              const g = shown.find(o => (o.group ?? '') === gname)
              return (
                <div key={gname || 'all'}>
                  {gname && <p className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wide uppercase" style={{ color: g?.groupLook?.color ?? 'var(--muted)' }}>
                    {g?.groupLook && <g.groupLook.Icon className="size-3" />}{gname}</p>}
                  <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                    {shown.filter(o => (o.group ?? '') === gname).map(o => {
                      const on = value.includes(o.value)
                      const c = o.look?.color
                      return (
                        <label key={o.value} role="option" aria-selected={on} aria-label={o.label} title={o.label}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition ${on ? 'font-semibold' : 'text-ink hover:bg-bg'}`}
                          style={on ? { background: c ? `${c}1A` : 'var(--primary-soft)', color: c ?? 'var(--primary)' } : undefined}>
                          <Checkbox label={o.label} checked={on} onChange={() => toggle(o.value)} color={c} />
                          {o.look && <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: `${o.look.color}1F`, color: o.look.color }}><o.look.Icon className="size-3.5" /></span>}
                          <span className="truncate">{o.label}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="px-2 pt-2 text-[11px] text-muted">Sin selección se muestran todas.</p>
        </div>, host())}
    </div>
  )
}

const PRESETS: { id: Exclude<PeriodPreset, 'custom'>; label: string }[] = [
  { id: 'mes', label: 'Este mes' }, { id: 'mes-anterior', label: 'Mes anterior' }, { id: '3m', label: 'Últimos 3 meses' },
  { id: '6m', label: 'Últimos 6 meses' }, { id: 'anio', label: 'Este año' },
]

/** Período: atajos, navegación por mes y rango personalizado con calendario (portal: nunca se corta ni sale de pantalla). */
export function PeriodPicker({ value, today, onChange }: { value: Filters; today: string; onChange: (p: Pick<Filters, 'preset' | 'desde' | 'hasta'>) => void }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const { pos, host } = usePopover(open, btn, { minWidth: 304, maxWidth: 360, maxHeight: 620 })
  const close = useCallback((foco = true) => { setOpen(false); if (foco) btn.current?.focus() }, [])
  useEffect(() => {
    if (!open) return
    const fuera = (e: PointerEvent) => { const n = e.target as Node; if (!panel.current?.contains(n) && !btn.current?.contains(n)) close(false) }
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [open, close])
  const month = singleMonth(value.desde, value.hasta)
  const [desde, setDesde] = useState(value.desde)
  const [hasta, setHasta] = useState(value.hasta)
  const goMonth = (p: string) => onChange({ preset: p === today.slice(0, 7) ? 'mes' : 'custom', desde: `${p}-01`, hasta: monthEnd(p) })

  return (
    <div className="relative flex items-center gap-1">
      <button type="button" aria-label="Mes anterior" disabled={!month} onClick={() => month && goMonth(shiftMonth(month, -1))}
        className="grid h-10 w-8 place-items-center rounded-xl border border-line bg-card text-muted hover:text-ink disabled:opacity-40"><ChevronLeft className="size-4" /></button>
      <button ref={btn} type="button" aria-haspopup="dialog" aria-expanded={open} aria-label="Período"
        onClick={() => { setDesde(value.desde); setHasta(value.hasta); setOpen(o => !o) }}
        className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-card px-3 text-left text-sm hover:border-navy/30">
        <CalendarRange className="size-4 shrink-0 text-navy" />
        <span className="min-w-0">
          <span className="block truncate text-[10px] leading-none font-medium tracking-wide text-muted uppercase">Período · {PRESETS.find(p => p.id === value.preset)?.label ?? 'Personalizado'}</span>
          <span className="block truncate text-[13px] leading-tight font-medium">{rangeLabel(value)}</span>
        </span>
      </button>
      <button type="button" aria-label="Mes siguiente" disabled={!month} onClick={() => month && goMonth(shiftMonth(month, 1))}
        className="grid h-10 w-8 place-items-center rounded-xl border border-line bg-card text-muted hover:text-ink disabled:opacity-40"><ChevronRight className="size-4" /></button>
      {open && pos && createPortal(
        <div ref={panel} role="dialog" aria-label="Elegir período"
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }}
          style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, maxHeight: pos.maxHeight, width: 'max-content', maxWidth: 'calc(100vw - 16px)' }}
          className="fade-in z-[300] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-card p-3 text-ink shadow-xl ring-1 ring-black/5">
          <div className="grid grid-cols-2 gap-1">
            {PRESETS.map(p => (
              <button key={p.id} type="button" onClick={() => { onChange({ preset: p.id, ...presetRange(p.id, today) }); close() }}
                className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] ${value.preset === p.id ? 'bg-primary-soft font-medium text-navy' : 'hover:bg-bg'}`}>
                {p.label}{value.preset === p.id && <Check className="size-3.5" />}
              </button>
            ))}
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-1 text-xs font-semibold">Personalizado</p>
            <p className="mb-2 text-[11px] text-muted tabular" data-testid="rango-elegido">{desde ? formatDate(desde) : '—'} → {hasta ? formatDate(hasta) : '—'}</p>
            <Calendario modo="rango" desde={desde} hasta={hasta} today={today} onRango={(a, b) => { setDesde(a); setHasta(b) }} />
            <button type="button" disabled={!desde || !hasta || desde > hasta}
              onClick={() => { onChange({ preset: 'custom', desde, hasta }); close() }}
              className="mt-2 w-full rounded-xl bg-navy py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-[#0E1525]">Aplicar rango</button>
          </div>
        </div>, host())}
    </div>
  )
}

/** Barra de filtros compartida por Dashboard y Gastos. `extra` agrega controles propios de cada pestaña. */
const NO_GASTOS: { ambito: string; categoria: string; subcategoria: string }[] = []

export function FilterBar({ filters, setFilters, catalogo, medios, today, extra, extraChips, gastos = NO_GASTOS }: {
  filters: Filters; setFilters: (f: Filters) => void; catalogo: CatalogoItem[]; medios: string[]; today: string; extra?: ReactNode; extraChips?: ReactNode
  gastos?: { ambito: string; categoria: string; subcategoria: string }[]
}) {
  const hist = useMemo(() => historicos(catalogo, gastos), [catalogo, gastos])
  // Subcategorías que solo existen en gastos antiguos: se marcan como "histórica" en el filtro.
  const histSubs = useMemo(() => {
    const ofrecidas = new Set(vigentes(catalogo).filter(c => c.subcategoria).map(c => subKey(c.categoria, c.subcategoria)))
    return new Set(hist.map(h => subKey(h.categoria, h.subcategoria)).filter(k => !ofrecidas.has(k)))
  }, [catalogo, hist])
  const opts = useMemo(() => catalogOptions(catalogo, filters.ambitos, filters.categorias, hist), [catalogo, filters.ambitos, filters.categorias, hist])

  // Al cambiar una selección se descartan las que dejaron de ser compatibles, y se conservan las válidas.
  function apply(next: Filters) {
    const o = catalogOptions(catalogo, next.ambitos, next.categorias, hist)
    const categorias = next.categorias.filter(c => o.categorias.includes(c))
    const o2 = catalogOptions(catalogo, next.ambitos, categorias, hist)
    setFilters({ ...next, categorias, subcategorias: next.subcategorias.filter(s => o2.subcategorias.some(x => x.key === s)) })
  }

  const chips: { key: string; label: string; look?: Look; remove: () => void }[] = [
    ...filters.ambitos.map(v => ({ key: `a${v}`, label: v, look: ambitoLook(v, catalogo), remove: () => apply({ ...filters, ambitos: filters.ambitos.filter(x => x !== v) }) })),
    ...filters.categorias.map(v => ({ key: `c${v}`, label: v, look: categoriaLook(v, catalogo), remove: () => apply({ ...filters, categorias: filters.categorias.filter(x => x !== v) }) })),
    ...filters.subcategorias.map(v => { const o = opts.subcategorias.find(x => x.key === v); return { key: `s${v}`, label: o?.subcategoria ?? v, look: o ? subcategoriaLook(o.subcategoria, o.categoria, catalogo) : undefined, remove: () => setFilters({ ...filters, subcategorias: filters.subcategorias.filter(x => x !== v) }) } }),
    ...filters.medios.map(v => ({ key: `m${v}`, label: v, look: medioLook(v), remove: () => setFilters({ ...filters, medios: filters.medios.filter(x => x !== v) }) })),
    ...filters.tipos.map(v => ({ key: `t${v}`, label: v, remove: () => setFilters({ ...filters, tipos: filters.tipos.filter(x => x !== v) }) })),
  ]
  const dirty = chips.length > 0 || filters.preset !== 'mes'

  return (
    <div className="rounded-2xl border border-line bg-card p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(15rem,1.3fr)_repeat(5,minmax(0,1fr))]">
        <PeriodPicker value={filters} today={today} onChange={p => setFilters({ ...filters, ...p })} />
        <MultiSelect label="Ámbito" icon={<Layers />} allLabel="Todos los ámbitos" value={filters.ambitos}
          options={opts.ambitos.map(a => ({ value: a, label: a, look: ambitoLook(a, catalogo) }))}
          onChange={ambitos => apply({ ...filters, ambitos })} />
        <MultiSelect label="Categoría" icon={<Shapes />} allLabel="Todas las categorías" value={filters.categorias}
          options={opts.categorias.map(c => ({ value: c, label: c, look: categoriaLook(c, catalogo) }))}
          onChange={categorias => apply({ ...filters, categorias })} />
        <MultiSelect label="Subcategoría" icon={<Tag />} allLabel="Todas las subcategorías" value={filters.subcategorias}
          options={opts.subcategorias.map(s => ({ value: s.key, label: histSubs.has(s.key) ? `${s.subcategoria} (histórica)` : s.subcategoria, group: s.categoria,
            groupLook: categoriaLook(s.categoria, catalogo), look: subcategoriaLook(s.subcategoria, s.categoria, catalogo) }))}
          onChange={subcategorias => setFilters({ ...filters, subcategorias })} />
        <MultiSelect label="Medio de pago" icon={<CreditCard />} allLabel="Todos los medios" value={filters.medios}
          options={sortMedios(medios).map(m => ({ value: m, label: m, look: medioLook(m) }))}
          onChange={m => setFilters({ ...filters, medios: m })} />
        <MultiSelect label="Tipo de gasto" icon={<Layers />} allLabel="Todos los tipos" value={filters.tipos}
          options={TIPOS_GASTO.map(t => ({ value: t, label: t }))}
          onChange={tipos => setFilters({ ...filters, tipos })} />
      </div>
      {extra && <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">{extra}</div>}
      {(dirty || extraChips) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {filters.preset !== 'mes' && <span className="rounded-full bg-bg px-2.5 py-1 text-xs text-muted">{rangeLabel(filters)}</span>}
          {chips.map(c => (
            <button key={c.key} type="button" onClick={c.remove} aria-label={`Quitar filtro ${c.label}`}
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition hover:brightness-95"
              style={c.look ? { background: `${c.look.color}14`, color: c.look.color, borderColor: `${c.look.color}33` } : undefined}>
              {c.look && <c.look.Icon className="size-3.5" />}{c.label}<X className="size-3" />
            </button>
          ))}
          {extraChips}
          <button type="button" onClick={() => setFilters(emptyFilters(today))}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted hover:bg-bg hover:text-ink">
            <FilterX className="size-3.5" /> Limpiar filtros
          </button>
        </div>
      )}
    </div>
  )
}

export const periodTitle = (f: Filters) => rangeLabel(f)
export { monthLabel }
