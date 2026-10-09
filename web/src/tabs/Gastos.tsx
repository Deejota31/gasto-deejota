import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Download, Pencil, Plus, Receipt, RefreshCw, Repeat, Search, Trash2, Undo2 } from 'lucide-react'
import type { AppStore } from '../lib/store'
import type { Filters, Gasto } from '../lib/types'
import { formatDate } from '../lib/dates'
import { formatMoney, toCents } from '../lib/money'
import { matchesDims } from '../lib/engine'
import { ambitoLook, categoriaLook, medioLook } from '../lib/visual'
import GastoModal, { type ModalMode } from '../components/GastoModal'
import { Pagination, SwipeRow } from '../components/table'
import { Button, Empty, ErrorBox, IconButton, inputCls, Modal, Pill, Segmented, Skeleton } from '../components/ui'
import { FilterBar } from '../components/shared'

type SortKey = 'fecha' | 'monto' | 'descripcion' | 'categoria'
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

export default function Gastos({ store, notify, filters, setFilters, today }: {
  store: AppStore; notify: (m: string) => void; filters: Filters; setFilters: (f: Filters) => void; today: string
}) {
  const cfg = store.data?.config ?? {}
  const catalogo = useMemo(() => store.data?.catalogo ?? [], [store.data?.catalogo])
  const [qInput, setQInput] = useState('')
  const q = useDebounced(qInput)
  const [estado, setEstado] = useState<EstadoFiltro>('Activo')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'fecha', dir: -1 })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [modal, setModal] = useState<{ mode: ModalMode; gasto: Gasto | null; key: number } | null>(null)
  const [confirm, setConfirm] = useState<Gasto | null>(null)
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const medios = (store.data?.medios ?? []).map(m => m.nombre)

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = (store.data?.gastos ?? []).filter(g =>
      g.fecha >= filters.desde && g.fecha <= filters.hasta && (estado === 'todos' || g.estado === estado) && matchesDims(g, filters) &&
      (!term || `${g.descripcion} ${g.categoria} ${g.subcategoria} ${g.medioPago} ${g.ambito} ${g.monto}`.toLowerCase().includes(term)))
    const val = (g: Gasto) => sort.key === 'monto' ? toCents(g.monto) : sort.key === 'categoria' ? `${g.categoria} ${g.subcategoria}` : g[sort.key]
    // Orden estable: a igualdad, el registro más reciente primero.
    return list.sort((a, b) => {
      const x = val(a), y = val(b)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || b.creadoEn.localeCompare(a.creadoEn) || a.id.localeCompare(b.id)
    })
  }, [store.data, filters, q, estado, sort])

  // Al cambiar filtros, búsqueda, orden o tamaño, volver a la primera página.
  useEffect(() => { setPage(0) }, [filters, q, estado, sort, pageSize])
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages - 1)
  const visible = rows.slice(current * pageSize, current * pageSize + pageSize)
  const totalCents = rows.reduce((s, g) => s + (g.moneda === (cfg.moneda || 'PEN') ? toCents(g.monto) : 0), 0)

  const toggleSort = (key: SortKey) => setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'fecha' || key === 'monto' ? -1 : 1 }))

  async function changeEstado(g: Gasto, next: 'Activo' | 'Anulado') {
    setBusy(g.id)
    setActionError('')
    try {
      await store.actions.setEstado(g, next)
      notify(next === 'Anulado' ? 'Gasto eliminado. Puedes restaurarlo desde "Eliminados".' : 'Gasto restaurado')
      setConfirm(null)
    } catch (e) { setActionError((e as Error).message) } finally { setBusy('') }
  }

  const open = (mode: ModalMode, gasto: Gasto | null) => setModal({ mode, gasto, key: Date.now() })
  const SortTh = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => {
    const Icon = sort.key !== k ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown
    return (
      <th scope="col" className={`px-3 py-2.5 font-medium ${right ? 'text-right' : 'text-left'}`} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
        <button className={`inline-flex items-center gap-1 hover:text-ink ${sort.key === k ? 'text-navy' : ''}`} onClick={() => toggleSort(k)}>{children}<Icon className="size-3" /></button>
      </th>
    )
  }

  const actionsFor = (g: Gasto, compact = false) => g.estado === 'Activo' ? (
    <>
      <IconButton label="Editar" tone="primary" onClick={() => open('edit', g)}><Pencil className="size-4" /></IconButton>
      <IconButton label="Clonar" tone="primary" onClick={() => open('clone', g)}><Copy className="size-4" /></IconButton>
      <IconButton label="Eliminar" tone="danger" onClick={() => setConfirm(g)}><Trash2 className="size-4" /></IconButton>
    </>
  ) : (
    <Button variant="soft" className={compact ? 'px-2 py-1 text-xs' : ''} loading={busy === g.id} onClick={() => changeEstado(g, 'Activo')}><Undo2 className="size-3.5" /> Restaurar</Button>
  )

  return (
    <div className="space-y-4">
      <FilterBar filters={filters} setFilters={setFilters} catalogo={catalogo} medios={medios} today={today}
        extra={<>
          <label className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" aria-hidden />
            <input aria-label="Buscar gastos" placeholder="Buscar por descripción, categoría, medio o monto…" className={`${inputCls} h-10 pl-9`} value={qInput} onChange={e => setQInput(e.target.value)} />
          </label>
          <Segmented label="Estado" value={estado} onChange={setEstado}
            options={[{ value: 'Activo', label: 'Activos' }, { value: 'Anulado', label: 'Eliminados' }, { value: 'todos', label: 'Todos' }]} />
        </>} />

      {store.error && <ErrorBox message={store.error} onRetry={store.refresh} />}
      {actionError && <ErrorBox message={actionError} />}

      <section className="rounded-2xl border border-line bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_16px_rgb(15_23_42/0.04)]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h2 className="text-sm font-semibold">Movimientos</h2>
            <p className="text-xs text-muted">{rows.length} registro(s) · total <b className="tabular text-ink">{formatMoney(totalCents, cfg.moneda || 'PEN')}</b></p>
          </div>
          <Button variant="outline" onClick={() => store.refresh()} loading={store.loading}><RefreshCw className="size-4" /> <span className="hidden sm:inline">Actualizar</span></Button>
          <Button variant="outline" onClick={() => downloadCsv(rows, `gastos-${filters.desde}_${filters.hasta}.csv`)} disabled={!rows.length}><Download className="size-4" /> CSV</Button>
          <Button onClick={() => open('create', null)} disabled={!store.data}><Plus className="size-4" /> Nuevo gasto</Button>
        </div>

        {!store.data ? <Skeleton className="h-64" /> : !rows.length ? (
          <Empty icon={<Receipt className="size-5" />} title="No hay gastos con estos filtros">Prueba otro período, quita filtros o registra un nuevo gasto.</Empty>
        ) : (
          <>
            {/* Escritorio / tablet: tabla con scroll horizontal propio */}
            <div className="scroll-hint -mx-4 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="text-[11px] tracking-wide text-muted uppercase">
                  <tr className="border-y border-line bg-bg/60">
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
                      <tr key={g.id} className={`border-b border-line/70 transition last:border-0 hover:bg-bg/60 ${off ? 'opacity-60' : ''}`}>
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
                  <li key={g.id} className="rounded-2xl border border-line">
                    <SwipeRow width={off ? 120 : 168} actions={off ? (
                      <button type="button" onClick={() => changeEstado(g, 'Activo')} className="flex flex-1 flex-col items-center justify-center gap-1 bg-primary-soft text-xs font-medium text-navy"><Undo2 className="size-4" />Restaurar</button>
                    ) : (<>
                      <button type="button" onClick={() => open('edit', g)} className="flex flex-1 flex-col items-center justify-center gap-1 bg-primary-soft text-xs font-medium text-navy"><Pencil className="size-4" />Editar</button>
                      <button type="button" onClick={() => open('clone', g)} className="flex flex-1 flex-col items-center justify-center gap-1 bg-morado-soft text-xs font-medium text-morado"><Copy className="size-4" />Clonar</button>
                      <button type="button" onClick={() => setConfirm(g)} className="flex flex-1 flex-col items-center justify-center gap-1 bg-coral-soft text-xs font-medium text-coral"><Trash2 className="size-4" />Eliminar</button>
                    </>)}>
                      <div className={`flex items-center gap-3 p-3 ${off ? 'opacity-60' : ''}`}>
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: `${cl.color}1F`, color: cl.color }}><cl.Icon className="size-5" /></span>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm font-semibold ${off ? 'line-through' : ''}`}>{g.descripcion || g.subcategoria || g.categoria}</p>
                          <p className="truncate text-xs text-muted">{g.categoria}{g.subcategoria && ` · ${g.subcategoria}`}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Pill size="xs" color={al.color} Icon={al.Icon}>{g.ambito}</Pill>
                            <Pill size="xs" color={ml.color} Icon={ml.Icon}>{g.medioPago}</Pill>
                            {g.esRecurrente && <Repeat className="size-3 text-turquesa" aria-label="Recurrente" />}
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

      {modal && <GastoModal key={modal.key} store={store} mode={modal.mode} gasto={modal.gasto} onClose={() => setModal(null)} onSaved={notify} />}

      <Modal open={!!confirm} onClose={() => setConfirm(null)} size="sm" title="Eliminar gasto" icon={<Trash2 className="size-5" />}
        footer={<><Button variant="outline" onClick={() => setConfirm(null)}>Cancelar</Button><Button variant="danger" loading={!!busy} onClick={() => confirm && changeEstado(confirm, 'Anulado')}>Eliminar</Button></>}>
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
