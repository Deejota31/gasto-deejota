// "Gastos mensuales": plantillas de gastos frecuentes en una tabla compacta.
// - Edición rápida de monto, moneda y medio SOLO para el lote en preparación (la plantilla no cambia).
// - Selección de una, algunas o todas; resumen fijo con totales por moneda; registro en UNA petición.
// - Orden manual global (arrastrar o Subir/Bajar) que también define el orden de inserción del lote.
// Una plantilla no es un movimiento: no suma en KPIs, cajas ni gráficos.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CalendarDays, ChevronDown, ChevronUp, Copy, GripVertical, ListChecks,
  Loader2, MoreHorizontal, Pencil, Plus, Repeat, Save, Search, Send, Trash2, Zap,
} from 'lucide-react'
import type { AppStore } from '../lib/store'
import type { GastoInput, PlantillaInput } from '../lib/api'
import type { Plantilla } from '../lib/types'
import { normName } from '../lib/orden'
import { categoriaLook, medioLook, sortMedios } from '../lib/visual'
import { formatearDescripcion } from '../lib/texto'
import { formatMoney, toCents } from '../lib/money'
import { todayIn } from '../lib/dates'
import { showToast } from '../lib/toast'
import { autocompletar, ClasificacionPicker, clasificacionVigente, type Clasif } from './Clasificacion'
import type { GastoPreset } from './GastoModal'
import { Button, DateField, Empty, ErrorBox, Field, inputCls, Modal, SelectField, Skeleton, Switch, useDismiss } from './ui'

export interface PlantillaDraft extends Clasif {
  id: string; descripcion: string; monto: number | null; moneda: string; medioPago: string; esCompromiso?: boolean; existente: boolean; afterId?: string
}
type View = { kind: 'list' } | { kind: 'form'; plantilla: Plantilla | null; draft?: PlantillaDraft; cloneOf?: Plantilla } | { kind: 'delete'; plantilla: Plantilla }

const nuevoId = () => `pl-${crypto.randomUUID()}`
const AMOUNT = /^\d{1,9}([.,]\d{1,2})?$/
const simbolo = (m: string) => (m === 'PEN' ? 'S/' : m === 'USD' ? 'US$' : m)
const montoTxt = (n: number | null) => (n === null ? '' : n.toFixed(2))

export default function PlantillasModal({ store, onClose, onUse, draft, onReopen }: {
  store: AppStore; onClose: () => void; onUse: (p: GastoPreset) => void
  /** Reabrir tras un error al guardar una plantilla: vuelve al formulario con lo que habías escrito. */
  draft?: PlantillaDraft; onReopen: (d: PlantillaDraft) => void
}) {
  const [view, setView] = useState<View>(() => (draft ? { kind: 'form', plantilla: null, draft } : { kind: 'list' }))
  const { items, error, loaded } = store.plantillas
  const { loadPlantillas } = store

  // Solo lee la hoja de plantillas, y solo la primera vez: al reabrir se usan las que ya están en memoria.
  useEffect(() => { void loadPlantillas() }, [loadPlantillas])

  if (view.kind === 'form') {
    const title = view.cloneOf ? 'Clonar plantilla' : (view.plantilla || view.draft?.existente) ? 'Editar plantilla' : 'Nueva plantilla'
    return (
      <Modal open onClose={onClose} size="lg" title={title} icon={<CalendarDays className="size-5" />}
        subtitle={view.cloneOf ? `Se creará una plantilla nueva a partir de “${view.cloneOf.descripcion}”. La original no cambia.` : 'Plantilla de gasto frecuente'}>
        <PlantillaForm store={store} plantilla={view.plantilla} draft={view.draft} cloneOf={view.cloneOf} items={items}
          onDone={() => setView({ kind: 'list' })} onReopen={onReopen} />
      </Modal>
    )
  }
  if (view.kind === 'delete') {
    const p = view.plantilla
    return (
      <Modal open onClose={onClose} size="sm" title="Eliminar plantilla" icon={<Trash2 className="size-5" />}>
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-bg/50 p-3">
            <p className="font-semibold">¿Eliminar la plantilla “{p.descripcion}”?</p>
            <p className="mt-1 text-sm text-muted">Esta acción eliminará únicamente la plantilla. Los gastos registrados anteriormente no se modificarán.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setView({ kind: 'list' })}>Cancelar</Button>
            <Button variant="danger" onClick={() => {
              store.track(`plantilla:${p.id}`, { pending: 'Eliminando plantilla…', ok: 'Plantilla eliminada correctamente.', error: 'No se pudo eliminar la plantilla.' },
                async () => {
                  await store.plantillaActions.remove(p.id)
                  store.setLote(l => ({ ...l, seleccion: l.seleccion.filter(x => x !== p.id) }))
                })
              setView({ kind: 'list' })
            }}><Trash2 className="size-4" /> Eliminar</Button>
          </div>
        </div>
      </Modal>
    )
  }
  return <Lista store={store} items={items} loaded={loaded} error={error} onClose={onClose} onUse={onUse} setView={setView} />
}

/* ============================== Lista + lote ============================== */

function Lista({ store, items, loaded, error, onClose, onUse, setView }: {
  store: AppStore; items: Plantilla[]; loaded: boolean; error: string | null; onClose: () => void; onUse: (p: GastoPreset) => void; setView: (v: View) => void
}) {
  const { lote, setLote } = store
  const cfg = store.data?.config ?? {}
  const catalogo = useMemo(() => store.data?.catalogo ?? [], [store.data?.catalogo])
  const hoy = todayIn(cfg.zona_horaria || 'America/Lima')
  const monedas = (cfg.monedas || 'PEN,USD').split(',').map(s => s.trim()).filter(Boolean)
  const medios = sortMedios((store.data?.medios ?? []).filter(m => m.activo).map(m => m.nombre))
  const [q, setQ] = useState('')
  const [ambito, setAmbito] = useState('')
  const [detalle, setDetalle] = useState(false)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [drag, setDrag] = useState<{ from: string; over: string | null } | null>(null)
  const loteKey = `lote:${lote.loteId}`
  const enviando = store.pending.has(loteKey)

  const fila = useCallback((p: Plantilla) => {
    const v = lote.valores[p.id] ?? {}
    return { monto: v.monto ?? montoTxt(p.monto), moneda: v.moneda ?? (p.moneda || 'PEN'), medioPago: v.medioPago ?? p.medioPago }
  }, [lote.valores])
  const setValor = (id: string, patch: Partial<{ monto: string; moneda: string; medioPago: string }>) =>
    setLote(l => ({ ...l, valores: { ...l.valores, [id]: { ...l.valores[id], ...patch } } }))

  const term = normName(q)
  const filtrando = !!term || !!ambito
  const visibles = items.filter(p => (!ambito || p.ambito === ambito) && (!term || normName(`${p.descripcion} ${p.ambito} ${p.categoria} ${p.subcategoria}`).includes(term)))
  const ambitos = [...new Set(items.map(p => p.ambito))]
  const sel = new Set(lote.seleccion)
  // Orden de inserción = orden global de la lista (no el orden en que marcaste las casillas).
  const elegidas = items.filter(p => sel.has(p.id))

  // Resumen en céntimos por moneda (sin mezclar PEN y USD); un monto inválido no suma.
  const totales = new Map<string, number>()
  for (const p of elegidas) {
    const f = fila(p)
    const n = Number(f.monto.replace(',', '.'))
    if (AMOUNT.test(f.monto.trim()) && n > 0) totales.set(f.moneda, (totales.get(f.moneda) ?? 0) + toCents(n))
  }

  const vigente = (p: Plantilla) => clasificacionVigente(catalogo, p)
  const medioOk = (m: string) => !m || medios.includes(m)
  // Se evalúa con el medio elegido en la fila: si el de la plantilla está inactivo, basta con elegir otro para usarla.
  const revision = (p: Plantilla) => { const m = fila(p).medioPago; return !vigente(p) ? 'Su clasificación ya no está disponible' : !medioOk(m) ? `El medio “${m}” ya no está activo: elige otro` : '' }

  function toggle(id: string) {
    setLote(l => ({ ...l, seleccion: l.seleccion.includes(id) ? l.seleccion.filter(x => x !== id) : [...l.seleccion, id] }))
    setErrores(e => { const n = { ...e }; delete n[id]; delete n._lote; return n })
  }
  // Las filas que requieren revisión no se seleccionan en bloque.
  const seleccionar = (ps: Plantilla[]) => setLote(l => ({ ...l, seleccion: [...new Set([...l.seleccion, ...ps.filter(p => !revision(p)).map(p => p.id)])] }))

  function mover(id: string, destino: string | null, delta = 0) {
    const ids = items.map(p => p.id)
    const from = ids.indexOf(id)
    let to = destino ? ids.indexOf(destino) : from + delta
    if (from < 0 || to < 0 || to >= ids.length || to === from) return
    ids.splice(from, 1)
    ids.splice(to, 0, id) // la fila ocupa la posición de destino y desplaza al resto
    store.plantillaActions.reorder(ids)
  }

  function registrar() {
    const errs: Record<string, string> = {}
    const fecha = lote.fecha || hoy
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return setErrores({ _fecha: 'Elige una fecha válida' })
    const gastoIds = { ...lote.gastoIds }
    const gastos: GastoInput[] = []
    for (const p of elegidas) {
      const f = fila(p)
      const n = Number(f.monto.replace(',', '.'))
      if (!vigente(p)) errs[p.id] = 'Clasificación no disponible: edita la plantilla'
      else if (!formatearDescripcion(p.descripcion)) errs[p.id] = 'Falta la descripción'
      else if (!AMOUNT.test(f.monto.trim()) || !(n > 0)) errs[p.id] = 'Ingresa un monto mayor a 0'
      else if (!monedas.includes(f.moneda)) errs[p.id] = 'Moneda no permitida'
      else if (!f.medioPago || !medios.includes(f.medioPago)) errs[p.id] = 'Elige un medio de pago activo'
      gastoIds[p.id] ??= crypto.randomUUID() // fijo por plantilla mientras el lote no se confirme
      gastos.push({ id: gastoIds[p.id], fecha, monto: n, moneda: f.moneda, ambito: p.ambito, categoria: p.categoria, subcategoria: p.subcategoria,
        descripcion: formatearDescripcion(p.descripcion), medioPago: f.medioPago, tipoGasto: 'Variable', esRecurrente: false, comprobanteUrl: '',
        plantillaId: p.id }) // vínculo: si la plantilla es un compromiso, este gasto cuenta como su pago
    }
    // Errores en filas ocultas por la búsqueda o el filtro: se quitan los filtros para que se vean.
    const ocultos = elegidas.filter(p => errs[p.id] && !visibles.includes(p)).length
    if (ocultos) { setQ(''); setAmbito('') }
    const nErr = elegidas.filter(p => errs[p.id]).length
    setErrores(nErr ? { ...errs, _lote: `${nErr} gasto${nErr === 1 ? '' : 's'} por corregir (marcado${nErr === 1 ? '' : 's'} en rojo)${ocultos ? '. Se quitaron la búsqueda y el filtro para mostrarlos.' : '.'}` } : errs)
    if (nErr || !gastos.length) return
    setLote(l => ({ ...l, gastoIds }))
    const loteId = lote.loteId
    const usadas = elegidas.map(p => p.id)
    const n = gastos.length
    store.track(`lote:${loteId}`,
      { pending: `Registrando ${n} gasto${n === 1 ? '' : 's'}…`, ok: `Se registraron correctamente ${n} gasto${n === 1 ? '' : 's'}.`,
        error: 'No se pudo confirmar el registro de los gastos. Puedes reintentar sin riesgo de duplicarlos.' },
      async () => {
        const r = await store.registrarLote(loteId, gastos)
        if (r.yaExistian > 0) showToast('info', `${r.yaExistian} de ${r.solicitados} ya estaban registrados de un intento anterior: no se duplicaron ni se modificaron.`)
        // Confirmado: se limpia solo lo registrado. Las plantillas y sus valores predeterminados no cambian.
        setLote(l => {
          const valores = { ...l.valores }, ids = { ...l.gastoIds }
          usadas.forEach(id => { delete valores[id]; delete ids[id] })
          return { ...l, seleccion: l.seleccion.filter(id => !usadas.includes(id)), valores, gastoIds: ids, loteId: store.nuevoLote().loteId }
        })
      })
  }

  const n = elegidas.length
  const puedeOrdenar = !filtrando && items.length > 1

  return (
    <Modal open onClose={onClose} size="xl" title="Gastos mensuales" subtitle="Prepara y registra tus gastos frecuentes" icon={<CalendarDays className="size-5" />}
      footer={
        <div className="w-full space-y-2">
          {detalle && n > 0 && (
            <ol className="max-h-36 space-y-0.5 overflow-y-auto rounded-xl border border-line bg-card p-2 text-xs" aria-label="Detalle del lote">
              {elegidas.map((p, i) => {
                const f = fila(p)
                const v = Number(f.monto.replace(',', '.'))
                return (
                  <li key={p.id} className="flex justify-between gap-3">
                    <span className="truncate"><span className="tabular text-muted">{i + 1}.</span> {p.descripcion}</span>
                    <span className="tabular shrink-0 font-medium">{v > 0 ? formatMoney(toCents(v), f.moneda) : '—'}</span>
                  </li>
                )
              })}
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
              {errores._lote && <p className="text-xs font-medium text-[#D2463C]" role="alert">{errores._lote}</p>}
              <p className="text-xs text-muted" aria-live="polite"><b className="text-ink">{n}</b> gasto{n === 1 ? '' : 's'} seleccionado{n === 1 ? '' : 's'}</p>
              <p className="tabular flex flex-wrap gap-x-3 text-base font-bold text-ink" data-testid="totales">
                {totales.size ? [...totales].map(([m, c]) => <span key={m} className="whitespace-nowrap">Total {m}: {formatMoney(c, m)}</span>) : <span className="font-medium text-muted">Total: —</span>}
              </p>
            </div>
            <Button variant="ghost" className="px-2 text-xs" disabled={!n} onClick={() => setDetalle(d => !d)} aria-expanded={detalle}>
              {detalle ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />} {detalle ? 'Ocultar detalle' : 'Ver detalle'}
            </Button>
            <Button onClick={registrar} disabled={!n || enviando} className="ml-auto">
              {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Registrar {n} gasto{n === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      }>
      <div className="space-y-3">
        {/* Cabecera: fecha del lote + nueva plantilla */}
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Field label="Fecha de registro" htmlFor="lote-fecha" error={errores._fecha}>
            <div className="w-44"><DateField id="lote-fecha" value={lote.fecha || hoy} onChange={fecha => setLote(l => ({ ...l, fecha }))} format={store.data?.config.formato_fecha} /></div>
          </Field>
          <Button variant="soft" onClick={() => setView({ kind: 'form', plantilla: null })} disabled={!store.data || !loaded}><Plus className="size-4" /> Nueva plantilla</Button>
        </div>
        {/* Búsqueda y filtro */}
        <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
          <label className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" />
            <input aria-label="Buscar plantilla" className={`${inputCls} pl-9`} placeholder="Buscar por nombre, ámbito, categoría o subcategoría…" value={q} onChange={e => setQ(e.target.value)} />
          </label>
          <select aria-label="Filtrar por ámbito" className={inputCls} value={ambito} onChange={e => setAmbito(e.target.value)}>
            <option value="">Todos los ámbitos</option>
            {ambitos.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
        {/* Selección */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <ListChecks className="size-4 text-muted" />
          <button type="button" className="rounded-lg px-2 py-1 font-medium text-navy hover:bg-primary-soft" onClick={() => seleccionar(items)}>Seleccionar todas ({items.filter(p => !revision(p)).length})</button>
          {filtrando && <button type="button" className="rounded-lg px-2 py-1 font-medium text-navy hover:bg-primary-soft" onClick={() => seleccionar(visibles)}>Seleccionar visibles ({visibles.filter(p => !revision(p)).length})</button>}
          <button type="button" className="rounded-lg px-2 py-1 font-medium text-muted hover:bg-bg disabled:opacity-40" disabled={!n} onClick={() => { setLote(l => ({ ...l, seleccion: [] })); setErrores({}) }}>Limpiar selección</button>
          <span className="ml-auto text-[11px] text-muted">{puedeOrdenar ? 'Arrastra ⋮⋮ para ordenar: ese orden se usa al registrar.' : filtrando ? 'Quita la búsqueda y el filtro para reordenar.' : ''}</span>
        </div>

        {error && !loaded && <ErrorBox message={`No se pudieron cargar las plantillas. ${error}`} onRetry={() => void store.loadPlantillas(true)} />}
        {!loaded && !error ? <div className="space-y-1.5">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
          : !items.length ? (
            <Empty icon={<Zap className="size-5" />} title="Aún no tienes plantillas">
              Guarda un gasto frecuente (Luz, Internet, ChatGPT…) con su monto y medio de pago, y regístralo cada mes en segundos.
            </Empty>
          ) : !visibles.length ? <Empty icon={<Search className="size-5" />} title="Sin coincidencias">Prueba con otra palabra o ámbito.</Empty> : (
            <div className="rounded-xl border border-line">
              {/* Encabezado de columnas (escritorio) */}
              <div className="hidden grid-cols-[1.5rem_1.5rem_minmax(0,1fr)_8.5rem_5rem_8.5rem_7rem] items-center gap-2 border-b border-line bg-bg/60 px-2 py-1.5 text-[10px] font-semibold tracking-wide text-muted uppercase md:grid">
                <span /><span /><span>Plantilla</span><span>Monto</span><span>Moneda</span><span>Pago</span><span className="text-right">Acciones</span>
              </div>
              <ul aria-label="Plantillas" className="divide-y divide-line/70">
                {visibles.map(p => {
                  const f = fila(p)
                  const l = categoriaLook(p.categoria, catalogo, p.ambito)
                  const on = sel.has(p.id)
                  const rev = revision(p)
                  const busy = store.pending.has(`plantilla:${p.id}`)
                  const editado = !!lote.valores[p.id]
                  const idx = items.indexOf(p)
                  return (
                    <li key={p.id} data-id={p.id}
                      draggable={puedeOrdenar && drag?.from === p.id}
                      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id) }}
                      onDragOver={e => { if (drag) { e.preventDefault(); if (drag.over !== p.id) setDrag({ ...drag, over: p.id }) } }}
                      onDrop={e => { e.preventDefault(); if (drag && drag.from !== p.id) mover(drag.from, p.id); setDrag(null) }}
                      onDragEnd={() => setDrag(null)}
                      className={`grid grid-cols-[1.5rem_1.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2 px-2 py-2.5 md:gap-y-1.5 md:py-2 transition md:grid-cols-[1.5rem_1.5rem_minmax(0,1fr)_8.5rem_5rem_8.5rem_7rem] ${on ? 'bg-primary-soft/50' : 'hover:bg-bg/60'} ${drag?.over === p.id && drag.from !== p.id ? 'shadow-[inset_0_2px_0_var(--color-navy)]' : ''} ${drag?.from === p.id ? 'opacity-50' : ''}`}>
                      <button type="button" aria-label={`Arrastrar ${p.descripcion}`} disabled={!puedeOrdenar} title={puedeOrdenar ? 'Arrastra para cambiar el orden' : 'Quita la búsqueda y el filtro para reordenar'}
                        onPointerDown={() => puedeOrdenar && setDrag({ from: p.id, over: null })} onPointerUp={() => setDrag(d => (d && !d.over ? null : d))}
                        className="grid h-7 cursor-grab place-items-center rounded text-muted hover:bg-bg disabled:cursor-not-allowed disabled:opacity-30">
                        <GripVertical className="size-4" />
                      </button>
                      <input type="checkbox" aria-label={`Seleccionar ${p.descripcion}`} checked={on} onChange={() => toggle(p.id)} disabled={!!rev && !on}
                        className="size-4 accent-[var(--color-navy)]" />
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: `${l.color}1F`, color: l.color }}><l.Icon className="size-3.5" /></span>
                        <div className="min-w-0">
                          <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold"><span className="truncate">{p.descripcion}</span>
                            {p.esCompromiso && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#E7F7F2] px-1.5 py-0.5 text-[10px] font-semibold text-[#0F7A5F] dark:bg-[#0F7A5F]/25 dark:text-[#6EE7C5]" title="Cuenta en Compromisos mensuales"><Repeat className="size-2.5" /> Compromiso</span>}</p>
                          <p className="truncate text-[11px] text-muted">{p.ambito} · {p.categoria}{p.subcategoria !== p.descripcion ? ` · ${p.subcategoria}` : ''}</p>
                          {rev && <p className="flex items-center gap-1 text-[11px] font-medium text-[#92400E]"><AlertTriangle className="size-3" /> Requiere revisión: {rev}</p>}
                          {errores[p.id] && <p className="text-[11px] font-medium text-[#D2463C]" role="alert">{errores[p.id]}</p>}
                        </div>
                      </div>
                      {/* Edición rápida: valores temporales del lote, no cambian la plantilla */}
                      <div className="col-span-3 grid grid-cols-[minmax(0,1fr)_4.75rem_minmax(0,1fr)] items-center gap-1.5 md:contents">
                        <label className="relative block">
                          <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-muted">{simbolo(f.moneda)}</span>
                          <input aria-label={`Monto de ${p.descripcion}`} inputMode="decimal" value={f.monto} placeholder="0.00" onChange={e => setValor(p.id, { monto: e.target.value.replace(/[^\d.,]/g, '') })}
                            className={`tabular h-10 w-full rounded-lg border bg-card pr-2 pl-8 text-right text-base outline-none focus:border-navy md:h-8 md:text-sm ${errores[p.id] ? 'border-[#D2463C]' : editado ? 'border-navy/50' : 'border-line'}`} />
                        </label>
                        <select aria-label={`Moneda de ${p.descripcion}`} value={f.moneda} onChange={e => setValor(p.id, { moneda: e.target.value })}
                          className="h-10 rounded-lg border border-line bg-card px-1.5 text-base outline-none focus:border-navy md:h-8 md:text-xs">
                          {[...new Set([...monedas, f.moneda])].map(m => <option key={m}>{m}</option>)}
                        </select>
                        <select aria-label={`Medio de pago de ${p.descripcion}`} value={f.medioPago} onChange={e => setValor(p.id, { medioPago: e.target.value })}
                          className="h-10 min-w-0 rounded-lg border border-line bg-card px-1.5 text-base outline-none focus:border-navy md:h-8 md:text-xs" style={f.medioPago ? { color: medioLook(f.medioPago).color } : undefined}>
                          <option value="">Medio…</option>
                          {[...new Set([...medios, ...(f.medioPago ? [f.medioPago] : [])])].map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      {/* Acciones: en móvil, grupo centrado en su propia fila; en escritorio, compactas a la derecha. */}
                      <div className="col-span-3 flex items-center justify-center gap-2 md:col-span-1 md:justify-end md:gap-1" data-testid="acciones-plantilla">
                        {busy ? <Loader2 className="size-4 animate-spin text-muted" /> : <>
                          <Button className="h-10 px-4 text-sm md:h-8 md:px-2.5 md:text-xs" disabled={!!rev} aria-label={`Usar plantilla ${p.descripcion}`} title="Abrir Nuevo gasto con estos datos"
                            onClick={() => onUse({ ambito: p.ambito, categoria: p.categoria, subcategoria: p.subcategoria, descripcion: p.descripcion,
                              monto: Number(f.monto.replace(',', '.')) || null, moneda: f.moneda, medioPago: medioOk(f.medioPago) ? f.medioPago : '',
                              plantillaId: p.id, plantillaNombre: p.descripcion })}>Usar</Button>
                          <Button variant="outline" className="h-10 px-3 text-sm md:hidden" aria-label={`Editar plantilla ${p.descripcion}`}
                            onClick={() => setView({ kind: 'form', plantilla: p })}><Pencil className="size-4" /><span className="max-[359px]:sr-only">Editar</span></Button>
                          <button type="button" aria-label={`Eliminar plantilla ${p.descripcion}`} onClick={() => setView({ kind: 'delete', plantilla: p })}
                            className="grid size-10 place-items-center rounded-xl border border-line text-[#D2463C] transition hover:bg-[#FDECEC] focus-visible:ring-2 focus-visible:ring-[#D2463C]/40 outline-none md:hidden"><Trash2 className="size-4" /></button>
                          <RowMenu label={p.descripcion} canMove={puedeOrdenar} first={idx === 0} last={idx === items.length - 1}
                            onEdit={() => setView({ kind: 'form', plantilla: p })} onClone={() => setView({ kind: 'form', plantilla: null, cloneOf: p })}
                            onDelete={() => setView({ kind: 'delete', plantilla: p })} onUp={() => mover(p.id, null, -1)} onDown={() => mover(p.id, null, 1)} />
                        </>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        <p className="text-[11px] text-muted">Cambiar monto, moneda o medio aquí solo afecta este registro: la plantilla conserva sus valores para el próximo mes (edítala para cambiarlos). Las plantillas no suman en el dashboard.</p>
      </div>
    </Modal>
  )
}

function RowMenu({ label, canMove, first, last, onEdit, onClone, onDelete, onUp, onDown }: {
  label: string; canMove: boolean; first: boolean; last: boolean; onEdit: () => void; onClone: () => void; onDelete: () => void; onUp: () => void; onDown: () => void
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismiss(open, close)
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-bg disabled:opacity-40'
  const run = (fn: () => void) => () => { setOpen(false); fn() }
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Más acciones de ${label}`} onClick={() => setOpen(o => !o)}
        className="grid size-10 place-items-center rounded-xl border border-line text-muted hover:bg-bg md:size-8 md:rounded-lg"><MoreHorizontal className="size-4" /></button>
      {open && (
        <div role="menu" className="absolute top-11 right-0 z-30 w-44 md:top-9 rounded-xl border border-line bg-card p-1 shadow-xl">
          <button role="menuitem" type="button" className={item} onClick={run(onEdit)}><Pencil className="size-3.5 text-muted" /> Editar</button>
          <button role="menuitem" type="button" className={item} onClick={run(onClone)}><Copy className="size-3.5 text-muted" /> Clonar</button>
          <button role="menuitem" type="button" className={item} disabled={!canMove || first} onClick={run(onUp)}><ArrowUp className="size-3.5 text-muted" /> Subir</button>
          <button role="menuitem" type="button" className={item} disabled={!canMove || last} onClick={run(onDown)}><ArrowDown className="size-3.5 text-muted" /> Bajar</button>
          <button role="menuitem" type="button" className={`${item} text-[#D2463C]`} onClick={run(onDelete)}><Trash2 className="size-3.5" /> Eliminar</button>
        </div>
      )}
    </div>
  )
}

/* ============================== Formulario (nueva / editar / clonar) ============================== */

function PlantillaForm({ store, plantilla, draft, cloneOf, items, onDone, onReopen }: {
  store: AppStore; plantilla: Plantilla | null; draft?: PlantillaDraft; cloneOf?: Plantilla; items: Plantilla[]; onDone: () => void; onReopen: (d: PlantillaDraft) => void
}) {
  const cfg = store.data?.config ?? {}
  const catalogo = store.data?.catalogo ?? []
  const monedas = (cfg.monedas || 'PEN,USD').split(',').map(s => s.trim()).filter(Boolean)
  const medios = sortMedios((store.data?.medios ?? []).filter(m => m.activo).map(m => m.nombre))
  const base = draft ?? plantilla ?? cloneOf
  const existente = draft ? draft.existente : !!plantilla
  const afterId = draft?.afterId ?? cloneOf?.id
  const [v, setV] = useState<Clasif>(() => base ? { ambito: base.ambito, categoria: base.categoria, subcategoria: base.subcategoria } : { ambito: 'Personal', categoria: '', subcategoria: '' })
  const [descripcion, setDescripcion] = useState(base?.descripcion ?? '')
  const [descAuto, setDescAuto] = useState<string | null>(base ? null : '')
  const [monto, setMonto] = useState(montoTxt(base?.monto ?? null))
  const [moneda, setMoneda] = useState(base?.moneda || cfg.moneda || 'PEN')
  const [medioPago, setMedioPago] = useState(base?.medioPago ?? '')
  const [esCompromiso, setEsCompromiso] = useState(base?.esCompromiso ?? false)
  // ID generado una sola vez al abrir: si la escritura falla y reintentas, el backend no duplica la plantilla.
  const [id] = useState(() => draft?.id ?? plantilla?.id ?? nuevoId())
  const [errors, setErrors] = useState<Record<string, string>>({})

  function change(next: Clasif) {
    if (next.subcategoria && next.subcategoria !== v.subcategoria) {
      const r = autocompletar(descripcion, descAuto, next.subcategoria)
      setDescripcion(r.descripcion)
      setDescAuto(r.auto)
    }
    setV(next)
  }

  function save() {
    const desc = formatearDescripcion(descripcion)
    const errs: Record<string, string> = {}
    if (!v.ambito) errs.ambito = 'Elige un ámbito'
    if (!v.categoria) errs.categoria = 'Elige una categoría'
    if (!v.subcategoria) errs.subcategoria = 'Elige una subcategoría'
    if (!desc) errs.descripcion = 'Escribe una descripción'
    if (!errs.subcategoria && !clasificacionVigente(catalogo, v)) errs.subcategoria = 'Esa clasificación ya no está disponible: elige una vigente'
    const m = monto.trim()
    if (m && (!AMOUNT.test(m) || Number(m.replace(',', '.')) < 0)) errs.monto = 'Monto no válido (sin negativos, hasta 2 decimales)'
    const data: PlantillaInput = { id, ambito: v.ambito, categoria: v.categoria, subcategoria: v.subcategoria, descripcion: desc,
      monto: m ? Math.round(Number(m.replace(',', '.')) * 100) / 100 : null, moneda, medioPago, esCompromiso }
    const key = (x: PlantillaInput) => [x.ambito, x.categoria, x.subcategoria, x.descripcion, x.moneda || 'PEN', x.medioPago].map(normName).join('|') + `|${x.monto === null ? '' : toCents(x.monto)}`
    if (!Object.keys(errs).length && items.some(p => p.id !== id && key(p) === key(data))) errs.descripcion = 'La plantilla ya existe. Modifica al menos uno de sus valores para guardar una copia.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    // No bloquea: el formulario se cierra en cuanto la operación queda registrada y puedes seguir navegando.
    // El éxito solo se anuncia cuando Apps Script confirma; si falla, la notificación permite reintentar (mismo ID:
    // no duplica) o reabrir el formulario con lo que escribiste. Una segunda operación sobre la MISMA plantilla
    // mientras la primera sigue en curso se rechaza; plantillas distintas pueden guardarse a la vez.
    const tipo = existente ? 'update' : cloneOf ? 'clone' : 'create'
    const msg = {
      create: { pending: 'Guardando plantilla…', ok: 'Plantilla creada correctamente.', error: 'No se pudo crear la plantilla.' },
      update: { pending: 'Guardando plantilla…', ok: 'Plantilla actualizada correctamente.', error: 'No se pudo actualizar la plantilla.' },
      clone: { pending: 'Guardando plantilla…', ok: 'Plantilla clonada correctamente.', error: 'No se pudo clonar la plantilla.' },
    }[tipo]
    const ok = store.track(`plantilla:${id}`, msg,
      () => store.plantillaActions.save(data, existente ? 'update' : 'create', existente ? undefined : afterId),
      { onErrorActions: [{ label: 'Reabrir formulario', run: () => onReopen({ ...data, existente, afterId }) }] })
    if (ok) onDone()
  }

  return (
    <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); save() }}>
      {cloneOf && <p className="rounded-xl bg-primary-soft px-3 py-2 text-xs text-navy">Estás creando una <b>plantilla nueva</b> (copia de “{cloneOf.descripcion}”). Cambia al menos un valor; se ubicará justo después de la original.</p>}
      <ClasificacionPicker catalogo={catalogo} value={v} onChange={change} errors={errors} keepCurrent={!!base} />
      <Field label="Descripción" error={errors.descripcion} htmlFor="plantilla-desc" hint="Se completa con la subcategoría; puedes cambiarla.">
        <input id="plantilla-desc" className={inputCls} maxLength={200} value={descripcion} placeholder="Ej. ChatGPT Plus"
          onChange={e => setDescripcion(e.target.value)} onBlur={() => { const f = formatearDescripcion(descripcion); if (descripcion === descAuto) setDescAuto(f); setDescripcion(f) }} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <Field label="Monto predeterminado" error={errors.monto} htmlFor="plantilla-monto" hint="Opcional. Podrás cambiarlo cada mes al registrar.">
          <span className="relative block">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">{simbolo(moneda)}</span>
            <input id="plantilla-monto" className={`${inputCls} tabular h-11 pl-10`} inputMode="decimal" placeholder="0.00" value={monto} onChange={e => setMonto(e.target.value.replace(/[^\d.,]/g, ''))} />
          </span>
        </Field>
        <Field label="Moneda" htmlFor="plantilla-moneda">
          <SelectField id="plantilla-moneda" value={moneda} onChange={setMoneda}>
            {[...new Set([...monedas, moneda])].map(x => <option key={x}>{x}</option>)}
          </SelectField>
        </Field>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">Medio de pago predeterminado</p>
        <div role="radiogroup" aria-label="Medio de pago predeterminado" className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {[...new Set([...medios, ...(medioPago ? [medioPago] : [])])].map(x => {
            const l = medioLook(x)
            const on = medioPago === x
            return (
              <button key={x} type="button" role="radio" aria-checked={on} onClick={() => setMedioPago(on ? '' : x)}
                className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-xs font-medium transition ${on ? 'shadow-sm' : 'border-line hover:bg-bg'}`}
                style={on ? { background: `${l.color}1A`, borderColor: l.color, color: l.color } : undefined}>
                <l.Icon className="size-4" style={{ color: l.color }} />{x}
              </button>
            )
          })}
        </div>
      </div>
      <div className="rounded-xl border border-line p-3">
        <Switch checked={esCompromiso} onChange={setEsCompromiso} label="Es un compromiso mensual" />
        <p className="mt-1 text-[11px] text-muted">Actívalo para pagos que haces cada mes (luz, internet, apoyo familiar…). Se reservan en “Compromisos” de Salud financiera y se dan por cubiertos solo con gastos registrados desde esta plantilla o asociados a ella.</p>
      </div>
      <div className="flex justify-between gap-2 border-t border-line pt-3">
        <Button type="button" variant="outline" onClick={onDone}><ArrowLeft className="size-4" /> Volver</Button>
        <Button type="submit"><Save className="size-4" /> {existente ? 'Guardar cambios' : cloneOf ? 'Guardar copia' : 'Guardar plantilla'}</Button>
      </div>
    </form>
  )
}
