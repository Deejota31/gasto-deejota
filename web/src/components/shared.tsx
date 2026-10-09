import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, CreditCard, FilterX, Layers, Search, Shapes, Tag, X } from 'lucide-react'
import { monthLabel, monthEnd, presetRange, rangeLabel, shiftMonth, singleMonth } from '../lib/dates'
import { subKey } from '../lib/engine'
import { ambitoLook, categoriaLook, medioLook, sortMedios, type Look } from '../lib/visual'
import type { CatalogoItem, Filters, PeriodPreset } from '../lib/types'
import { normName, otrosAlFinal } from '../lib/orden'
import { TIPOS_GASTO } from '../lib/types'
import { inputCls, useDismiss } from './ui'

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

export interface Option { value: string; label: string; group?: string; look?: Look }

/** Selector múltiple con búsqueda, iconos y casillas. Sin selección = todas. */
export function MultiSelect({ label, icon, options, value, onChange, allLabel }: {
  label: string; icon: ReactNode; options: Option[]; value: string[]; onChange: (v: string[]) => void; allLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const close = useCallback(() => { setOpen(false); setQ('') }, [])
  const ref = useDismiss(open, close)
  const term = q.trim().toLowerCase()
  const shown = options.filter(o => !term || `${o.label} ${o.group ?? ''}`.toLowerCase().includes(term))
  const groups = [...new Set(shown.map(o => o.group ?? ''))]
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  const summary = !value.length ? allLabel : value.length === 1 ? (options.find(o => o.value === value[0])?.label ?? value[0]) : `${value.length} seleccionadas`

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}
        className={`flex h-10 w-full items-center gap-2 rounded-xl border px-3 text-left text-sm transition ${value.length ? 'border-navy/40 bg-primary-soft text-navy' : 'border-line bg-card text-ink hover:border-navy/30'}`}>
        <span className="shrink-0 text-muted [&>svg]:size-4">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] leading-none font-medium tracking-wide text-muted uppercase">{label}</span>
          <span className="block truncate text-[13px] leading-tight font-medium">{summary}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-11 left-0 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-card p-2 shadow-xl">
          <div className="flex items-center justify-between px-2 pt-1 pb-2">
            <p className="text-sm font-semibold">{label}</p>
            <span className="text-[11px] text-muted">Selecciona varias</span>
          </div>
          {options.length > 8 && (
            <label className="relative mb-2 block">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
              <input autoFocus aria-label={`Buscar ${label.toLowerCase()}`} className={`${inputCls} pl-8`} placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} />
            </label>
          )}
          <label className={`mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium ${!value.length ? 'bg-primary-soft text-navy' : 'hover:bg-bg'}`}>
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!value.length} onChange={() => onChange([])} />
            {allLabel}
          </label>
          <div role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-72 overflow-y-auto">
            {!shown.length && <p className="px-2 py-4 text-center text-xs text-muted">Sin resultados.</p>}
            {groups.map(gname => (
              <div key={gname || 'all'}>
                {gname && <p className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-muted uppercase">{gname}</p>}
                <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                  {shown.filter(o => (o.group ?? '') === gname).map(o => {
                    const on = value.includes(o.value)
                    return (
                      <label key={o.value} role="option" aria-selected={on}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition ${on ? 'bg-primary-soft text-navy' : 'text-ink hover:bg-bg'}`}>
                        <input type="checkbox" className="size-4 shrink-0 accent-[var(--primary)]" checked={on} onChange={() => toggle(o.value)} />
                        {o.look && <o.look.Icon className="size-3.5 shrink-0" style={{ color: o.look.color }} />}
                        <span className="truncate">{o.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="px-2 pt-2 text-[11px] text-muted">Sin selección se muestran todas.</p>
        </div>
      )}
    </div>
  )
}

const PRESETS: { id: Exclude<PeriodPreset, 'custom'>; label: string }[] = [
  { id: 'mes', label: 'Este mes' }, { id: 'mes-anterior', label: 'Mes anterior' }, { id: '3m', label: 'Últimos 3 meses' },
  { id: '6m', label: 'Últimos 6 meses' }, { id: 'anio', label: 'Este año' },
]

/** Período: atajos, navegación por mes y rango personalizado. */
export function PeriodPicker({ value, today, onChange }: { value: Filters; today: string; onChange: (p: Pick<Filters, 'preset' | 'desde' | 'hasta'>) => void }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismiss(open, close)
  const month = singleMonth(value.desde, value.hasta)
  const [desde, setDesde] = useState(value.desde)
  const [hasta, setHasta] = useState(value.hasta)
  const goMonth = (p: string) => onChange({ preset: p === today.slice(0, 7) ? 'mes' : 'custom', desde: `${p}-01`, hasta: monthEnd(p) })

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <button type="button" aria-label="Mes anterior" disabled={!month} onClick={() => month && goMonth(shiftMonth(month, -1))}
        className="grid h-10 w-8 place-items-center rounded-xl border border-line bg-card text-muted hover:text-ink disabled:opacity-40"><ChevronLeft className="size-4" /></button>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label="Período"
        onClick={() => { setDesde(value.desde); setHasta(value.hasta); setOpen(!open) }}
        className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-card px-3 text-left text-sm hover:border-navy/30">
        <CalendarRange className="size-4 shrink-0 text-navy" />
        <span className="min-w-0">
          <span className="block truncate text-[10px] leading-none font-medium tracking-wide text-muted uppercase">Período · {PRESETS.find(p => p.id === value.preset)?.label ?? 'Personalizado'}</span>
          <span className="block truncate text-[13px] leading-tight font-medium">{rangeLabel(value)}</span>
        </span>
      </button>
      <button type="button" aria-label="Mes siguiente" disabled={!month} onClick={() => month && goMonth(shiftMonth(month, 1))}
        className="grid h-10 w-8 place-items-center rounded-xl border border-line bg-card text-muted hover:text-ink disabled:opacity-40"><ChevronRight className="size-4" /></button>
      {open && (
        <div role="dialog" aria-label="Elegir período" className="absolute top-11 left-0 z-40 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-line bg-card p-3 shadow-xl">
          <div className="grid grid-cols-2 gap-1">
            {PRESETS.map(p => (
              <button key={p.id} type="button" onClick={() => { onChange({ preset: p.id, ...presetRange(p.id, today) }); setOpen(false) }}
                className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] ${value.preset === p.id ? 'bg-primary-soft font-medium text-navy' : 'hover:bg-bg'}`}>
                {p.label}{value.preset === p.id && <Check className="size-3.5" />}
              </button>
            ))}
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-2 text-xs font-semibold">Personalizado</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted">Desde<input type="date" className={inputCls} value={desde} max={hasta} onChange={e => setDesde(e.target.value)} /></label>
              <label className="text-[11px] text-muted">Hasta<input type="date" className={inputCls} value={hasta} min={desde} onChange={e => setHasta(e.target.value)} /></label>
            </div>
            <button type="button" disabled={!desde || !hasta || desde > hasta}
              onClick={() => { onChange({ preset: 'custom', desde, hasta }); setOpen(false) }}
              className="mt-2 w-full rounded-xl bg-navy py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-[#0E1525]">Aplicar rango</button>
          </div>
        </div>
      )}
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
    ...filters.subcategorias.map(v => ({ key: `s${v}`, label: v, remove: () => setFilters({ ...filters, subcategorias: filters.subcategorias.filter(x => x !== v) }) })),
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
          options={opts.subcategorias.map(s => ({ value: s.key, label: histSubs.has(s.key) ? `${s.subcategoria} (histórica)` : s.subcategoria, group: s.categoria }))}
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
