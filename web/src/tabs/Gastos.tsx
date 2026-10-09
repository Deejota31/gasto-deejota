import { useMemo, useState } from 'react'
import { ArrowUpDown, Ban, Download, Pencil, Plus, RefreshCw, Repeat, RotateCcw, Search } from 'lucide-react'
import type { AppStore } from '../lib/store'
import type { Gasto } from '../lib/types'
import { formatDate, todayIn } from '../lib/dates'
import { formatMoney, toCents } from '../lib/money'
import GastoModal from '../components/GastoModal'
import { Button, Card, Empty, ErrorBox, inputCls, Modal, Select, Skeleton } from '../components/ui'
import { catalogOptions, MonthNav } from '../components/shared'

type SortKey = 'fecha' | 'monto' | 'descripcion' | 'categoria'
const PAGE = 25

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

export default function Gastos({ store, notify }: { store: AppStore; notify: (m: string) => void }) {
  const cfg = store.data?.config ?? {}
  const [periodo, setPeriodo] = useState(() => todayIn(cfg.zona_horaria || 'America/Lima').slice(0, 7))
  const [q, setQ] = useState('')
  const [ambito, setAmbito] = useState('')
  const [categoria, setCategoria] = useState('')
  const [medio, setMedio] = useState('')
  const [estado, setEstado] = useState<'Activo' | 'Anulado' | ''>('Activo')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'fecha', dir: -1 })
  const [page, setPage] = useState(0)
  const [modal, setModal] = useState<{ gasto: Gasto | null; key: number } | null>(null)
  const [confirm, setConfirm] = useState<Gasto | null>(null)
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')

  const opts = catalogOptions(store, ambito, '')
  const medios = (store.data?.medios ?? []).map(m => m.nombre)

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = (store.data?.gastos ?? []).filter(g =>
      g.fecha.startsWith(periodo) && (!estado || g.estado === estado) && (!ambito || g.ambito === ambito) &&
      (!categoria || g.categoria === categoria) && (!medio || g.medioPago === medio) &&
      (!term || `${g.descripcion} ${g.categoria} ${g.subcategoria} ${g.medioPago} ${g.ambito}`.toLowerCase().includes(term)))
    const val = (g: Gasto) => sort.key === 'monto' ? toCents(g.monto) : sort.key === 'categoria' ? `${g.categoria} ${g.subcategoria}` : g[sort.key]
    return list.sort((a, b) => {
      const x = val(a), y = val(b)
      return (x < y ? -1 : x > y ? 1 : a.creadoEn.localeCompare(b.creadoEn)) * sort.dir
    })
  }, [store.data, periodo, q, estado, ambito, categoria, medio, sort])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const current = Math.min(page, pages - 1)
  const visible = rows.slice(current * PAGE, current * PAGE + PAGE)
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(0) }

  function toggleSort(key: SortKey) {
    setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'fecha' || key === 'monto' ? -1 : 1 }))
  }

  async function changeEstado(g: Gasto, next: 'Activo' | 'Anulado') {
    setBusy(g.id)
    setActionError('')
    try {
      await store.actions.setEstado(g, next)
      notify(next === 'Anulado' ? 'Gasto anulado (puedes restaurarlo)' : 'Gasto restaurado')
    } catch (e) { setActionError((e as Error).message) } finally { setBusy(''); setConfirm(null) }
  }

  function exportCsv() {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `gastos-${periodo}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const Th = ({ k, children, right }: { k?: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th scope="col" className={`px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`} aria-sort={k && sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      {k ? <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => toggleSort(k)}>{children}<ArrowUpDown className="size-3" /></button> : children}
    </th>
  )

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <MonthNav value={periodo} onChange={resetPage(setPeriodo)} />
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => store.refresh()} loading={store.loading}><RefreshCw className="size-4" /> Actualizar</Button>
            <Button variant="outline" onClick={exportCsv} disabled={!rows.length}><Download className="size-4" /> CSV</Button>
            <Button onClick={() => setModal({ gasto: null, key: Date.now() })} disabled={!store.data}><Plus className="size-4" /> Nuevo gasto</Button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="relative lg:col-span-1">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted" aria-hidden />
            <input aria-label="Buscar" placeholder="Buscar…" className={`${inputCls} pl-8`} value={q} onChange={e => { setQ(e.target.value); setPage(0) }} />
          </label>
          <Select label="Ámbito" value={ambito} onChange={resetPage((v: string) => { setAmbito(v); setCategoria('') })} options={opts.ambitos} placeholder="Todos los ámbitos" />
          <Select label="Categoría" value={categoria} onChange={resetPage(setCategoria)} options={opts.categorias} placeholder="Todas las categorías" />
          <Select label="Medio de pago" value={medio} onChange={resetPage(setMedio)} options={medios} placeholder="Todos los medios" />
          <Select label="Estado" value={estado} onChange={resetPage((v: string) => setEstado(v as typeof estado))} options={['Activo', 'Anulado']} placeholder="Todos los estados" />
        </div>
      </Card>

      {store.error && <ErrorBox message={store.error} onRetry={store.refresh} />}
      {actionError && <ErrorBox message={actionError} />}

      <Card>
        {!store.data ? <Skeleton className="h-64" /> : !rows.length ? <Empty>No hay gastos con estos filtros.</Empty> : (
          <>
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <Th k="fecha">Fecha</Th><Th k="descripcion">Descripción</Th><Th k="categoria">Categoría / Subcategoría</Th>
                    <Th>Ámbito</Th><Th>Medio de pago</Th><Th>Moneda</Th><Th k="monto" right>Monto</Th><Th right>Acciones</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(g => (
                    <tr key={g.id} className={`border-b border-line/60 last:border-0 hover:bg-bg/60 ${g.estado === 'Anulado' ? 'text-muted line-through decoration-muted/50' : ''}`}>
                      <td className="tabular px-3 py-2 whitespace-nowrap">{formatDate(g.fecha, cfg.formato_fecha)}</td>
                      <td className="max-w-56 truncate px-3 py-2" title={g.descripcion}>
                        {g.descripcion || <span className="text-muted">—</span>}
                        {g.esRecurrente && <Repeat className="ml-1 inline size-3 text-turquesa" aria-label="Recurrente" />}
                      </td>
                      <td className="px-3 py-2"><span className="font-medium">{g.categoria}</span>{g.subcategoria && <span className="text-muted"> / {g.subcategoria}</span>}</td>
                      <td className="px-3 py-2"><span className="rounded-full bg-bg px-2 py-0.5 text-xs">{g.ambito}</span></td>
                      <td className="px-3 py-2">{g.medioPago}</td>
                      <td className="px-3 py-2">{g.moneda}</td>
                      <td className="tabular px-3 py-2 text-right font-semibold whitespace-nowrap">{formatMoney(toCents(g.monto), g.moneda)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {g.estado === 'Activo' ? (
                          <>
                            <Button variant="ghost" aria-label="Editar" onClick={() => setModal({ gasto: g, key: Date.now() })}><Pencil className="size-3.5" /></Button>
                            <Button variant="ghost" aria-label="Anular" onClick={() => setConfirm(g)}><Ban className="size-3.5" /></Button>
                          </>
                        ) : (
                          <Button variant="ghost" aria-label="Restaurar" loading={busy === g.id} onClick={() => changeEstado(g, 'Activo')}><RotateCcw className="size-3.5" /> Restaurar</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted">
              <span>{rows.length} movimiento(s)</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}>Anterior</Button>
                <span>{current + 1} / {pages}</span>
                <Button variant="outline" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Siguiente</Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {modal && <GastoModal key={modal.key} store={store} gasto={modal.gasto} open onClose={() => setModal(null)} onSaved={notify} />}

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Anular gasto">
        <p className="text-sm">¿Anular “{confirm?.descripcion || confirm?.categoria}”? Dejará de contar en los cálculos. Podrás restaurarlo después.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirm(null)}>Cancelar</Button>
          <Button variant="danger" loading={!!busy} onClick={() => confirm && changeEstado(confirm, 'Anulado')}>Anular</Button>
        </div>
      </Modal>
    </div>
  )
}
