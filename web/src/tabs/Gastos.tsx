import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowLeft, CalendarDays, ChevronDown, ChevronUp, GripVertical, ListOrdered, ArrowUp, ArrowUpDown, Copy, Download, Loader2, Pencil, Plus, Receipt, RefreshCw, Repeat, Search, Trash2, Undo2 } from 'lucide-react'
import type { AppStore } from '../lib/store'
import type { Filters, Gasto } from '../lib/types'
import { formatDate } from '../lib/dates'
import { formatMoney, toCents } from '../lib/money'
import { hasDimFilters, matchesDims } from '../lib/engine'
import { ambitoLook, categoriaLook, medioLook } from '../lib/visual'
import type { ModalMode } from '../components/GastoModal'
import { Pagination, SwipeRow } from '../components/table'
import { Button, Empty, ErrorBox, IconButton, inputCls, Modal, Pill, Segmented, Skeleton } from '../components/ui'
import { FilterBar } from '../components/shared'

const ID_AVISO = {
  duplicado: 'Otro movimiento tiene el mismo ID. Ejecuta repararIds en Apps Script para poder editarlo.',
  invalido: 'El ID tiene caracteres no válidos. Ejecuta repararIds en Apps Script para poder editarlo.',
}

type SortKey = 'fecha' | 'monto' | 'descripcion' | 'categoria' | 'personalizado'
type EstadoFiltro = 'Activo' | 'Anulado' | 'todos'

const CSV_COLS: [string, (g: Gasto) => string | number | boolean][] = [
  ['Fecha', g => g.fecha], ['Monto', g => g.monto], ['Moneda', g => g.moneda], ['Categoría', g => g.categoria],
  ['Subcategoría', g => g.subcategoria], ['Descripción', g => g.descripcion], ['Medio de pago', g => g.medioPago],
  ['Tipo de gasto', g => g.tipoGasto], ['Ámbito', g => g.ambito], ['Es recurrente', g => g.esRecurrente],
  ['Estado', g => g.estado], ['ID', g => g.id],
]

export function toCsv(rows: Gasto[]): string {
  const cell = (v: string | number | boolean) => {
    let s = String(v)
    if (/^[=+\-@]/.test(s) && typeof v === 'string') s = `'${s}` // evita inyección de fórmulas al abrir en Excel/Sheets
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + [CSV_COLS.map(c => c[0]).join(','), ...rows.map(g => CSV_COLS.map(([, f]) => cell(f(g))).join(','))].join('\n')
}

export function downloadCsv(rows: Gasto[], name: string) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

export default function Gastos({ store, openGasto, filters, setFilters, today, onGastosMensuales, foco, onVolverFoco }: {
  store: AppStore; openGasto: (mode: ModalMode, gasto: Gasto | null) => void; filters: Filters; setFilters: (f: Filters) => void; today: string
  onGastosMensuales: () => void
  /** Movimiento a revisar que llega desde Salud financiera: se resalta y se puede volver. */
  foco?: { id: string } | null; onVolverFoco?: () => void
}) {
  const cfg = store.data?.config ?? {}
  const catalogo = useMemo(() => store.data?.catalogo ?? [], [store.data?.catalogo])
  const [qInput, setQInput] = useState('')
  const q = useDebounced(qInput)
  const [estado, setEstado] = useState<EstadoFiltro>('Activo')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'fecha', dir: -1 })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [confirm, setConfirm] = useState<Gasto | null>(null)
  // Un gasto con una escritura en curso muestra "Guardando…" y no admite otra acción hasta que el backend responda.
  const isBusy = (g: Gasto) => store.pending.has(`gasto:${g.id}`) || store.pending.has(`estado:${g.id}`)
  const medios = (store.data?.medios ?? []).map(m => m.nombre)

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = (store.data?.gastos ?? []).filter(g =>
      g.fecha >= filters.desde && g.fecha <= filters.hasta && (estado === 'todos' || g.estado === estado) && matchesDims(g, filters) &&
      (!term || `${g.descripcion} ${g.categoria} ${g.subcategoria} ${g.medioPago} ${g.ambito} ${g.monto}`.toLowerCase().includes(term)))
    if (sort.key === 'personalizado') {
      // Orden personalizado: los que tienen posición guardada, por esa posición; los nuevos (sin posición) arriba,
      // del más reciente al más antiguo. Así un gasto nuevo nunca reordena los anteriores.
      const pos = (g: Gasto) => store.ordenGastos.get(g.id.toLowerCase())
      return list.sort((a, b) => {
        const pa = pos(a), pb = pos(b)
        if (pa === undefined || pb === undefined) return (pa === undefined ? 0 : 1) - (pb === undefined ? 0 : 1) || b.creadoEn.localeCompare(a.creadoEn) || a.id.localeCompare(b.id)
        return pa - pb || b.creadoEn.localeCompare(a.creadoEn)
      })
    }
    const key = sort.key
    const val = (g: Gasto) => key === 'monto' ? toCents(g.monto) : key === 'categoria' ? `${g.categoria} ${g.subcategoria}` : g[key]
    // Orden estable: a igualdad, el registro más reciente primero.
    return list.sort((a, b) => {
      const x = val(a), y = val(b)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || b.creadoEn.localeCompare(a.creadoEn) || a.id.localeCompare(b.id)
    })
  }, [store.data, store.ordenGastos, filters, q, estado, sort])

  // Al cambiar filtros, búsqueda, orden o tamaño, volver a la primera página.
  useEffect(() => { setPage(0) }, [filters, q, estado, sort, pageSize])
  // Localizar el movimiento a revisar: ir a su página y desplazarlo a la vista (sin cambiar el período ni los filtros).
  const focoIdx = foco ? rows.findIndex(g => g.id === foco.id) : -1
  useEffect(() => {
    if (focoIdx < 0) return
    setPage(Math.floor(focoIdx / pageSize))
    const t = setTimeout(() => document.querySelector(`[data-foco="true"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120)
    return () => clearTimeout(t)
  }, [focoIdx, pageSize])
  const gastoFoco = foco ? store.data?.gastos.find(g => g.id === foco.id) : undefined
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages - 1)
  const visible = rows.slice(current * pageSize, current * pageSize + pageSize)
  const totalCents = rows.reduce((s, g) => s + (g.moneda === (cfg.moneda || 'PEN') ? toCents(g.monto) : 0), 0)

  // Reordenar solo con el conjunto completo a la vista: orden personalizado, sin búsqueda ni filtros de
  // clasificación/medio, solo activos y todo en una página. Así nunca se mueve algo que no estás viendo.
  const personal = sort.key === 'personalizado'
  const bloqueo = !personal ? '' : q.trim() || hasDimFilters(filters) ? 'Quita la búsqueda y los filtros de ámbito, categoría o medio para reordenar.'
    : estado !== 'Activo' ? 'Muestra solo “Activos” para reordenar.' : rows.length > pageSize ? `Muestra ${rows.length > 50 ? 'menos movimientos (elige un período más corto)' : 'todos en una página (Por página: 50)'} para reordenar.`
    : rows.some(g => g.problemaId) ? 'Hay movimientos con “ID por reparar” en este período: repáralos (función repararIds en Apps Script) para poder reordenar.' : ''
  const puedeOrdenar = personal && !bloqueo && rows.length > 1
  const [drag, setDrag] = useState<{ from: string; over: string | null } | null>(null)
  function mover(id: string, destino: string | null, delta = 0) {
    const ids = rows.map(g => g.id)
    const from = ids.indexOf(id)
    const to = destino ? ids.indexOf(destino) : from + delta
    if (from < 0 || to < 0 || to >= ids.length || to === from) return
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    store.reorderGastos(ids)
  }

  const toggleSort = (key: SortKey) => setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'fecha' || key === 'monto' ? -1 : 1 }))

  // No bloquea: cierra la confirmación, la escritura sigue en segundo plano y el resultado llega como notificación.
  function changeEstado(g: Gasto, next: 'Activo' | 'Anulado') {
    setConfirm(null)
    store.track(`estado:${g.id}`, next === 'Anulado'
      ? { pending: 'Eliminando gasto…', ok: 'Gasto eliminado correctamente. Puedes restaurarlo desde "Eliminados".', error: 'No se pudo eliminar el gasto.' }
      : { pending: 'Restaurando gasto…', ok: 'Gasto restaurado correctamente.', error: 'No se pudo restaurar el gasto.' },
    () => store.actions.setEstado(g, next))
  }

  const open = openGasto
  const SortTh = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => {
    const Icon = sort.key !== k ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown
    return (
      <th scope="col" className={`px-3 py-2.5 font-medium ${right ? 'text-right' : 'text-left'}`} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
        <button className={`inline-flex items-center gap-1 hover:text-ink ${sort.key === k ? 'text-navy' : ''}`} onClick={() => toggleSort(k)}>{children}<Icon className="size-3" /></button>
      </th>
    )
  }

  const actionsFor = (g: Gasto, compact = false) => isBusy(g) ? (
    <span className="inline-flex items-center gap-1.5 px-2 text-xs text-muted"><Loader2 className="size-3.5 animate-spin" /> Guardando…</span>
  ) : g.problemaId ? (
    <span className="inline-flex items-center gap-1 rounded-lg bg-[#FEF3C7] px-2 py-1 text-[11px] font-medium text-[#92400E]" title={ID_AVISO[g.problemaId]}><AlertTriangle className="size-3.5" /> ID por reparar</span>
  ) : g.estado === 'Activo' ? (
    <>
      <IconButton label="Editar" tone="primary" onClick={() => open('edit', g)}><Pencil className="size-4" /></IconButton>
      <IconButton label="Clonar" tone="primary" onClick={() => open('clone', g)}><Copy className="size-4" /></IconButton>
      <IconButton label="Eliminar" tone="danger" onClick={() => setConfirm(g)}><Trash2 className="size-4" /></IconButton>
    </>
  ) : (
    <Button variant="soft" className={compact ? 'px-2 py-1 text-xs' : ''} onClick={() => changeEstado(g, 'Activo')}><Undo2 className="size-3.5" /> Restaurar</Button>
  )

  const conProblema = (store.data?.gastos ?? []).filter(g => g.problemaId).length

  return (
    <div className="space-y-4">
      {conProblema > 0 && (
        <ErrorBox tone="warning" message={<>
          <b>{conProblema} movimiento(s) tienen un ID repetido o inválido</b> (por ejemplo, editado a mano en la hoja). Se muestran y suman normal,
          pero no se pueden editar ni eliminar desde la app hasta repararlos: con un ID repetido, editar uno cambiaría el otro.
          Arréglalo ejecutando <b>repararIds</b> en Apps Script (crea un respaldo y solo cambia esos IDs).
        </>} />
      )}
      <FilterBar filters={filters} setFilters={setFilters} catalogo={catalogo} medios={medios} today={today} gastos={store.data?.gastos}
        extra={<>
          <label className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" aria-hidden />
            <input aria-label="Buscar gastos" placeholder="Buscar por descripción, categoría, medio o monto…" className={`${inputCls} h-10 pl-9`} value={qInput} onChange={e => setQInput(e.target.value)} />
          </label>
          <Segmented label="Estado" value={estado} onChange={setEstado}
            options={[{ value: 'Activo', label: 'Activos' }, { value: 'Anulado', label: 'Eliminados' }, { value: 'todos', label: 'Todos' }]} />
        </>} />

      {store.error && <ErrorBox message={store.error} onRetry={store.refresh} />}

      <section className="rounded-2xl border border-line bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_16px_rgb(15_23_42/0.04)]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h2 className="text-sm font-semibold">Movimientos</h2>
            <p className="text-xs text-muted">{rows.length} registro(s) · total <b className="tabular text-ink">{formatMoney(totalCents, cfg.moneda || 'PEN')}</b></p>
          </div>
          <Button variant="outline" onClick={() => store.refresh()} loading={store.loading}><RefreshCw className="size-4" /> <span className="hidden sm:inline">Actualizar</span></Button>
          <Button variant="outline" onClick={() => downloadCsv(rows, `gastos-${filters.desde}_${filters.hasta}.csv`)} disabled={!rows.length}><Download className="size-4" /> CSV</Button>
          <Button variant={personal ? 'soft' : 'outline'} onClick={() => setSort(personal ? { key: 'fecha', dir: -1 } : { key: 'personalizado', dir: 1 })} aria-pressed={personal} aria-label="Orden personalizado"
            title="Ordena la tabla a tu manera arrastrando las filas"><ListOrdered className="size-4" /> <span className="hidden sm:inline">Orden personalizado</span></Button>
          <Button onClick={() => open('create', null)} disabled={!store.data}><Plus className="size-4" /> Nuevo gasto</Button>
          <Button variant="soft" onClick={onGastosMensuales} disabled={!store.data}><CalendarDays className="size-4" /> Gastos mensuales</Button>
        </div>
        {foco && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary-soft px-3 py-2 text-xs text-navy" role="status" data-testid="foco-banner">
            <span>Revisando un movimiento desde Salud financiera{gastoFoco ? `: ${gastoFoco.descripcion || gastoFoco.subcategoria} (${gastoFoco.fecha})` : ''}.
              {focoIdx < 0 && ' No aparece con el período, filtros o búsqueda actuales.'}</span>
            <span className="flex gap-2">
              {gastoFoco && !gastoFoco.problemaId && <Button variant="outline" className="h-8 px-2.5 text-xs" onClick={() => open('edit', gastoFoco)}><Pencil className="size-3.5" /> Abrir formulario</Button>}
              {onVolverFoco && <Button className="h-8 px-2.5 text-xs" onClick={onVolverFoco}><ArrowLeft className="size-3.5" /> Volver a Salud financiera</Button>}
            </span>
          </div>
        )}
        {personal && (
          <p className={`mb-3 rounded-xl px-3 py-2 text-xs ${bloqueo ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-primary-soft text-navy'}`}>
            {bloqueo || 'Orden personalizado: arrastra ⋮⋮ (o usa ↑ ↓) para mover un movimiento. Se guarda al soltar; no cambia fechas ni montos, ni el orden de tu hoja.'}
          </p>
        )}

        {!store.data ? <Skeleton className="h-64" /> : !rows.length ? (
          <Empty icon={<Receipt className="size-5" />} title="No hay gastos con estos filtros">Prueba otro período, quita filtros o registra un nuevo gasto.</Empty>
        ) : (
          <>
            {/* Escritorio / tablet: tabla con scroll horizontal propio */}
            <div className="scroll-hint -mx-4 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="text-[11px] tracking-wide text-muted uppercase">
                  <tr className="border-y border-line bg-bg/60">
                    {personal && <th scope="col" className="w-8 px-1"><span className="sr-only">Mover</span></th>}
                    <SortTh k="fecha">Fecha</SortTh><SortTh k="descripcion">Descripción</SortTh><SortTh k="categoria">Categoría / Subcategoría</SortTh>
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">Ámbito</th>
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">Medio de pago</th>
                    <SortTh k="monto" right>Monto</SortTh>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(g => {
                    const al = ambitoLook(g.ambito, catalogo), cl = categoriaLook(g.categoria, catalogo, g.ambito), ml = medioLook(g.medioPago)
                    const off = g.estado === 'Anulado'
                    return (
                      <tr key={g.uid ?? g.id} data-id={g.id} data-foco={foco?.id === g.id || undefined}
                        draggable={puedeOrdenar && drag?.from === g.id}
                        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', g.id) }}
                        onDragOver={e => { if (drag) { e.preventDefault(); if (drag.over !== g.id) setDrag({ ...drag, over: g.id }) } }}
                        onDrop={e => { e.preventDefault(); if (drag && drag.from !== g.id) mover(drag.from, g.id); setDrag(null) }}
                        onDragEnd={() => setDrag(null)}
                        className={`border-b border-line/70 transition last:border-0 hover:bg-bg/60 ${foco?.id === g.id ? 'bg-primary-soft/70 outline-2 -outline-offset-2 outline-navy/50' : ''} ${off ? 'opacity-60' : ''} ${drag?.over === g.id && drag.from !== g.id ? 'shadow-[inset_0_2px_0_var(--color-navy)]' : ''} ${drag?.from === g.id ? 'opacity-50' : ''}`}>
                        {personal && (
                          <td className="px-1">
                            <button type="button" aria-label={`Arrastrar ${g.descripcion || g.subcategoria}`} disabled={!puedeOrdenar}
                              onPointerDown={() => puedeOrdenar && setDrag({ from: g.id, over: null })} onPointerUp={() => setDrag(d => (d && !d.over ? null : d))}
                              className="grid h-8 w-6 cursor-grab place-items-center rounded text-muted hover:bg-bg disabled:cursor-not-allowed disabled:opacity-30"><GripVertical className="size-4" /></button>
                          </td>
                        )}
                        <td className="tabular px-3 py-2.5 whitespace-nowrap text-muted">{formatDate(g.fecha, cfg.formato_fecha)}</td>
                        <td className="max-w-60 px-3 py-2.5">
                          <p className={`truncate font-medium ${off ? 'line-through' : ''}`} title={g.descripcion}>{g.descripcion || <span className="font-normal text-muted">Sin descripción</span>}</p>
                          <p className="flex items-center gap-2 text-[11px] text-muted">{g.tipoGasto}{g.esRecurrente && <span className="inline-flex items-center gap-0.5 text-turquesa"><Repeat className="size-3" /> Recurrente</span>}{off && <span className="text-coral">Eliminado</span>}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: `${cl.color}1F`, color: cl.color }}><cl.Icon className="size-4" /></span>
                            <span className="min-w-0 leading-tight"><span className="block truncate font-medium">{g.categoria}</span><span className="block truncate text-xs text-muted">{g.subcategoria || '—'}</span></span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5"><Pill color={al.color} Icon={al.Icon}>{g.ambito}</Pill></td>
                        <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5 text-[13px]"><ml.Icon className="size-4" style={{ color: ml.color }} />{g.medioPago}</span></td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <span className={`tabular text-[15px] font-bold ${off ? 'line-through' : 'text-ink'}`}>{formatMoney(toCents(g.monto), g.moneda)}</span>
                          {g.moneda !== (cfg.moneda || 'PEN') && <span className="block text-[10px] text-muted">{g.moneda}</span>}
                        </td>
                        <td className="px-3 py-2.5"><div className="flex justify-end gap-0.5">{actionsFor(g)}</div></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Móvil: tarjetas; desliza a la izquierda para Editar, Clonar o Eliminar */}
            <ul className="space-y-2 md:hidden" aria-label="Movimientos">
              {visible.map(g => {
                const al = ambitoLook(g.ambito, catalogo), cl = categoriaLook(g.categoria, catalogo, g.ambito), ml = medioLook(g.medioPago)
                const off = g.estado === 'Anulado'
                return (
                  <li key={g.uid ?? g.id} data-foco={foco?.id === g.id || undefined} className={`relative rounded-2xl border ${foco?.id === g.id ? 'border-navy/60 ring-2 ring-navy/30' : 'border-line'}`}>
                    {/* Móvil: subir/bajar en lugar de arrastrar (mismas reglas y la misma petición única) */}
                    {puedeOrdenar && (
                      <div className="absolute top-1/2 left-1 z-10 flex -translate-y-1/2 flex-col">
                        <button type="button" aria-label={`Subir ${g.descripcion}`} disabled={rows[0]?.id === g.id} onClick={() => mover(g.id, null, -1)} className="rounded p-0.5 text-muted disabled:opacity-30"><ChevronUp className="size-4" /></button>
                        <button type="button" aria-label={`Bajar ${g.descripcion}`} disabled={rows[rows.length - 1]?.id === g.id} onClick={() => mover(g.id, null, 1)} className="rounded p-0.5 text-muted disabled:opacity-30"><ChevronDown className="size-4" /></button>
                      </div>
                    )}
                    <SwipeRow width={off ? 120 : 168} actions={g.problemaId ? (
                      <span className="flex flex-1 items-center justify-center gap-1 bg-[#FEF3C7] px-2 text-center text-[11px] text-[#92400E]"><AlertTriangle className="size-4 shrink-0" />ID por reparar</span>
                    ) : isBusy(g) ? (
                      <span className="flex flex-1 items-center justify-center gap-1.5 bg-bg text-xs text-muted"><Loader2 className="size-4 animate-spin" />Guardando…</span>
                    ) : off ? (
                      <button type="button" onClick={() => changeEstado(g, 'Activo')} className="flex flex-1 flex-col items-center justify-center gap-1 bg-primary-soft text-xs font-medium text-navy"><Undo2 className="size-4" />Restaurar</button>
                    ) : (<>
                      <button type="button" onClick={() => open('edit', g)} className="flex flex-1 flex-col items-center justify-center gap-1 bg-primary-soft text-xs font-medium text-navy"><Pencil className="size-4" />Editar</button>
                      <button type="button" onClick={() => open('clone', g)} className="flex flex-1 flex-col items-center justify-center gap-1 bg-morado-soft text-xs font-medium text-morado"><Copy className="size-4" />Clonar</button>
                      <button type="button" onClick={() => setConfirm(g)} className="flex flex-1 flex-col items-center justify-center gap-1 bg-coral-soft text-xs font-medium text-coral"><Trash2 className="size-4" />Eliminar</button>
                    </>)}>
                      <div className={`flex items-center gap-3 p-3 ${puedeOrdenar ? 'pl-8' : ''} ${off ? 'opacity-60' : ''}`}>
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: `${cl.color}1F`, color: cl.color }}><cl.Icon className="size-5" /></span>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm font-semibold ${off ? 'line-through' : ''}`}>{g.descripcion || g.subcategoria || g.categoria}</p>
                          <p className="truncate text-xs text-muted">{g.categoria}{g.subcategoria && ` · ${g.subcategoria}`}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Pill size="xs" color={al.color} Icon={al.Icon}>{g.ambito}</Pill>
                            <Pill size="xs" color={ml.color} Icon={ml.Icon}>{g.medioPago}</Pill>
                            {g.esRecurrente && <Repeat className="size-3 text-turquesa" aria-label="Recurrente" />}
                            {isBusy(g) && <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Loader2 className="size-3 animate-spin" />Guardando…</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`tabular text-base font-bold ${off ? 'line-through' : ''}`}>{formatMoney(toCents(g.monto), g.moneda)}</p>
                          <p className="tabular text-[11px] text-muted">{formatDate(g.fecha, cfg.formato_fecha)}</p>
                        </div>
                      </div>
                    </SwipeRow>
                  </li>
                )
              })}
            </ul>
            <p className="mt-2 text-center text-[11px] text-muted md:hidden">Desliza un gasto a la izquierda para ver sus acciones.</p>

            <div className="mt-3">
              <Pagination page={current} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={setPageSize} />
            </div>
          </>
        )}
      </section>


      <Modal open={!!confirm} onClose={() => setConfirm(null)} size="sm" title="Eliminar gasto" icon={<Trash2 className="size-5" />}
        footer={<><Button variant="outline" onClick={() => setConfirm(null)}>Cancelar</Button><Button variant="danger" onClick={() => confirm && changeEstado(confirm, 'Anulado')}>Eliminar</Button></>}>
        {confirm && (
          <div className="space-y-2 text-sm">
            <div className="rounded-xl border border-line bg-bg/50 p-3">
              <p className="font-semibold">{confirm.descripcion || `${confirm.categoria} · ${confirm.subcategoria}`}</p>
              <p className="text-xs text-muted">{formatDate(confirm.fecha, cfg.formato_fecha)} · {confirm.ambito} · {confirm.medioPago}</p>
              <p className="tabular mt-1 text-lg font-bold">{formatMoney(toCents(confirm.monto), confirm.moneda)}</p>
            </div>
            <p className="text-muted">Dejará de contar en totales, gráficos y cajas. No se borra de la hoja: queda en <b>Eliminados</b> y puedes restaurarlo cuando quieras.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
