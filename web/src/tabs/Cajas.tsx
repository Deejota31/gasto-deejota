import { formatearDescripcion } from '../lib/texto'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useAgregado } from '../lib/useAgregado'
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, CircleDashed, Copy, Layers, LayoutGrid, List, Pencil, Power, Search,
  Shapes, SlidersHorizontal, Tag, Trash2, Wallet, CreditCard, Info, FilePlus2,
} from 'lucide-react'
import { aislaDesde, cajaActiva, cajaMatches, ESPECIFICIDAD, prioridadCajas, type CajasResumen, type SubcajaResumen } from '../lib/engine'
import { formatMoney } from '../lib/money'
import { formatDate, monthLabel, rangeLabel, singleMonth } from '../lib/dates'
import type { AppStore } from '../lib/store'
import type { AppData, Caja, CatalogoItem, Filters, FiltroCampo } from '../lib/types'
import { normName } from '../lib/orden'
import { opcionesAlcanceCombo, opcionesValor } from '../lib/alcance'
import { cajaLook, COLORS, sortMedios } from '../lib/visual'
import { Combobox, type Opcion } from '../components/Combobox'
import { PeriodPicker } from '../components/shared'
import { CajaModal } from '../components/cajas'
import { FondosSeccion, Toggle } from '../components/fondos'
import { MonthPicker } from '../components/DatePicker'
import { BarraPlan, VacioMes, type PlanificacionApi } from '../components/Planificacion'
import { MenuAcciones, type AccionMenu } from '../components/MenuAcciones'
import { usePlantillasFin } from '../components/PlantillasFin'
import { SwipeFila, useEsMovil } from '../components/swipe'
import { AsaOrden, AvisoOrden, CLASE_ARRASTRE, useReorden } from '../components/reorden'
import { guardarPref, leerPref } from '../lib/prefs'
import { dependenciasCaja } from '../lib/dependencias'
import { BotonEditar, BotonMensual, BotonNuevo, Button, ErrorBox, Field, InfoTooltip, inputCls, Modal, Segmented, SelectField, Skeleton, Switch } from '../components/ui'

type Alcance = Exclude<FiltroCampo, 'Todos'>
const ALCANCES: { value: Alcance; label: string; Icon: typeof Tag }[] = [
  { value: 'Ámbito', label: 'Ámbito', Icon: Layers },
  { value: 'Categoría', label: 'Categoría', Icon: Shapes },
  { value: 'Subcategoría', label: 'Subcategoría', Icon: Tag },
  { value: 'Medio de pago', label: 'Medio de pago', Icon: CreditCard },
]
const alcanceIcon = (c: FiltroCampo) => ALCANCES.find(a => a.value === c)?.Icon ?? Wallet
type Orden = 'manual' | 'nombre' | 'monto' | 'mas' | 'menos' | 'uso'
const TONO = {
  ok: { fg: 'var(--success)', bg: 'var(--success-soft)' }, atencion: { fg: 'var(--warning)', bg: 'var(--warning-soft)' }, alerta: { fg: 'var(--danger)', bg: 'var(--danger-soft)' },
  info: { fg: '#4F6FC8', bg: '#EEF3FF' }, neutro: { fg: '#64748B', bg: 'var(--bg)' },
}
const pctTxt = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es-PE', { maximumFractionDigits: 1 })}%`)

interface Item { caja: Caja; r: SubcajaResumen | null }

/**
 * Pestaña Cajas y presupuestos. La caja general manda: las subcajas son reservas dentro de ella (no suman), cada gasto
 * cae en UNA sola subcaja (la más específica) o en "fuera de subcajas". Reutiliza el mismo motor que el Dashboard.
 */
export default function Cajas({ store, filters, setFilters, today, plan }: { plan: PlanificacionApi; store: AppStore; filters: Filters; setFilters: (f: Filters) => void; today: string }) {
  const data = store.data
  const base = data?.config.moneda || 'PEN'
  const money = useCallback((c: number) => formatMoney(c, base), [base])
  const cajas = data?.cajas
  // Mismo motor y mismo contexto (fondos, cajas, ajustes) en Dashboard, Cajas y Salud financiera.
  const a = useAgregado(data, filters, today)
  const mes = singleMonth(filters.desde, filters.hasta)
  const [q, setQ] = useState('')
  const [alcance, setAlcance] = useState<'todos' | Alcance>('todos')
  const [estado, setEstado] = useState<'activas' | 'inactivas' | 'todas'>('todas')
  const [orden, setOrden] = useState<Orden>('manual')
  const [vista, setVistaState] = useState<'grid' | 'lista'>(() => leerPref('deejota.vista.subcajas', ['grid', 'lista'] as const, 'lista'))
  const setVista = (v: 'grid' | 'lista') => { setVistaState(v); guardarPref('deejota.vista.subcajas', v) }
  const [form, setForm] = useState<{ caja: Caja | null; clonDe?: Caja | null } | null>(null)
  const plantillas = usePlantillasFin(store, today.slice(0, 7))
  const [borrar, setBorrar] = useState<Caja | null>(null)
  const [ajustar, setAjustar] = useState<{ caja: Caja; asignado: number } | null>(null)
  const catalogo = useMemo(() => data?.catalogo ?? [], [data?.catalogo])

  // Solapamientos: qué subcajas activas comparten algún gasto posible (según el catálogo y los medios) y cuál gana.
  const solapes = useMemo(() => calcularSolapes(cajas ?? [], catalogo, (data?.medios ?? []).map(m => m.nombre)), [cajas, catalogo, data?.medios])

  if (!data || !a) return <Skeleton className="h-96" />
  const c = a.cajas
  const items: Item[] = [
    ...c.subcajas.filter(r => r.aplicada).map(r => ({ caja: r.caja, r })),
    ...c.inactivas.map(caja => ({ caja, r: null })),
  ]
  const ocultas = c.subcajas.filter(r => !r.aplicada).length
  const sinCajas = c.subcajas.length === 0 && c.inactivas.length === 0   // no existe ninguna caja (distinto de «ninguna aplicada a este mes»)
  const mesVacio = !!mes && mes >= aislaDesde(data.config) && !c.subcajas.some(r => r.aplicada)
  const term = normName(q)
  const filtrando = !!term || alcance !== 'todos' || estado !== 'todas'
  const visibles = items
    .filter(i => (estado === 'todas' || (estado === 'activas') === cajaActiva(i.caja)))
    .filter(i => alcance === 'todos' || i.caja.filtroCampo === alcance)
    .filter(i => !term || normName(`${i.caja.nombre} ${i.caja.filtroValor} ${i.caja.descripcion ?? ''}`).includes(term))
    .sort((x, y) => {
      const g = (i: Item) => i.r?.gastado ?? 0, as = (i: Item) => i.r?.asignado ?? 0, u = (i: Item) => i.r?.pct ?? -1
      switch (orden) {
        case 'nombre': return x.caja.nombre.localeCompare(y.caja.nombre)
        case 'monto': return as(y) - as(x)
        case 'mas': return g(y) - g(x)
        case 'menos': return g(x) - g(y)
        case 'uso': return u(y) - u(x)
        default: return x.caja.orden - y.caja.orden
      }
    })
  const manual = [...items, ...c.subcajas.filter(r => !r.aplicada).map(r => ({ caja: r.caja, r }))].sort((x, y) => x.caja.orden - y.caja.orden).map(i => i.caja.id)
  const puedeOrdenar = orden === 'manual' && !filtrando && ocultas === 0

  const mover = (id: string, delta: number) => {
    const ids = [...manual]
    const i = ids.indexOf(id), j = i + delta
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    store.track('cajas:orden', { pending: 'Guardando el orden…', ok: 'Orden de cajas guardado.', error: 'No se pudo guardar el orden de las cajas. Se restauró el anterior.' },
      () => store.actions.reorderCajas(ids), { retry: false })
  }
  const activar = (caja: Caja) => {
    const on = !cajaActiva(caja)
    store.track(`caja:${caja.id}`, { pending: on ? 'Activando caja…' : 'Desactivando caja…', ok: `${caja.nombre} ${on ? 'activada: vuelve a reservar su monto' : 'desactivada: libera su reserva'}. No se creó ni se perdió dinero ni gastos.`, error: `No se pudo ${on ? 'activar' : 'desactivar'} ${caja.nombre}.` },
      () => store.actions.saveCaja({ ...caja, activo: on }))
  }

  return (
    <div className="space-y-4">
      <Cabecera c={c} money={money} filters={filters} setFilters={setFilters} today={today} n={items.length}
        onAjustar={c.general && c.origen !== 'fondos' ? () => setAjustar({ caja: c.general!, asignado: c.presupuesto }) : undefined} />
      {mes && <BarraPlan store={store} hoy={today} mes={mes} plan={plan} />}
      <FondosSeccion plan={plan} plantillas={plantillas} store={store} c={c} mes={mes} money={money} periodo={mes ? monthLabel(mes, true) : rangeLabel(filters)} hoyMes={today.slice(0, 7)} />

      <section className="rounded-3xl border border-line bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_8px_24px_rgb(15_23_42/0.04)] sm:p-5" aria-label="Reservas y cajas">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">Reservas / cajas <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-semibold text-muted">{items.length}</span>
              <InfoTooltip title="Cómo se reparten los gastos" align="left">
                <p>Cada gasto cae en una sola caja: la de alcance más específico. Prioridad: <b>Subcategoría &gt; Categoría &gt; Ámbito &gt; Medio de pago</b>. A igual nivel, gana la primera en tu orden manual.</p>
                <p>Ejemplo: con “Familia” (ámbito) y “Bebé” (categoría), un gasto de Bebé va a Bebé. Lo que no cae en ninguna va a “gastado fuera de cajas”.</p>
                <p>Una caja inactiva no reserva dinero ni toma gastos. Eliminar una caja no borra ningún gasto.</p>
              </InfoTooltip>
            </h2>
            <p className="text-xs text-muted">Apartan parte del presupuesto consolidado por ámbito, categoría, subcategoría o medio de pago. No suman dinero.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <BotonNuevo onClick={() => setForm({ caja: null })}>Nueva caja</BotonNuevo>
            <BotonMensual onClick={() => plantillas.abrir('subcaja')}>Cajas mensuales</BotonMensual>
          </div>
        </div>

        {/* Barra de búsqueda, filtros y orden: pensada para muchas cajas */}
        <div className="mb-4 grid gap-2 rounded-2xl bg-bg/70 p-2 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input aria-label="Buscar caja" className={`${inputCls} h-11 pl-9`} placeholder="Buscar caja por nombre o alcance…" value={q} onChange={e => setQ(e.target.value)} />
          </label>
          <div className="w-full lg:w-44"><SelectField label="Filtrar por alcance" value={alcance} onChange={v => setAlcance(v as typeof alcance)}>
            <option value="todos">Todos los alcances</option>{ALCANCES.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
          </SelectField></div>
          <div className="w-full lg:w-36"><SelectField label="Filtrar por estado" value={estado} onChange={v => setEstado(v as typeof estado)}>
            <option value="todas">Todas</option><option value="activas">Activas</option><option value="inactivas">Inactivas</option>
          </SelectField></div>
          <div className="w-full lg:w-44"><SelectField label="Ordenar cajas" value={orden} onChange={v => setOrden(v as Orden)}>
            <option value="manual">Orden manual</option><option value="nombre">Nombre</option><option value="monto">Monto asignado</option>
            <option value="mas">Más gastadas</option><option value="menos">Menos gastadas</option><option value="uso">% de uso</option>
          </SelectField></div>
          <div className="flex items-center gap-1 rounded-xl bg-card p-1 ring-1 ring-line" role="radiogroup" aria-label="Vista">
            {([['lista', List, 'Lista'], ['grid', LayoutGrid, 'Tarjetas']] as const).map(([v, Icon, l]) => (
              <button key={v} type="button" role="radio" aria-checked={vista === v} aria-label={l} title={l} onClick={() => setVista(v)}
                className={`grid size-9 place-items-center rounded-lg transition ${vista === v ? 'bg-primary-soft text-navy' : 'text-muted hover:bg-bg'}`}><Icon className="size-4" /></button>
            ))}
          </div>
        </div>
        {!puedeOrdenar && items.length > 1 && <p className="-mt-2 mb-3 text-[11px] text-muted">Para reordenar, usa “Orden manual” y quita la búsqueda y los filtros.</p>}

        {mesVacio && !sinCajas && <div className="mb-4"><VacioMes tipo="subcaja" mes={mes!} nOcultas={ocultas} onConfigurar={() => setForm({ caja: null })} onPlantillas={() => plantillas.abrir('subcaja')} onAnterior={() => plan.usarAnterior('subcaja', mes!)} /></div>}
        {mesVacio && !sinCajas && !items.length ? null : !items.length ? (
          <Vacio icon={Wallet} titulo="Aún no tienes cajas registradas. Añade una caja para empezar">
            Aparta dinero de tu presupuesto para Auto, Salud, Streaming o lo que quieras: cada caja junta sola los gastos de su alcance.
          </Vacio>
        ) : !visibles.length ? (
          <Vacio icon={Search} titulo="Ninguna caja coincide" accion={<Button variant="outline" onClick={() => { setQ(''); setAlcance('todos'); setEstado('todas') }}>Limpiar filtros</Button>}>
            Prueba con otra palabra, alcance o estado.
          </Vacio>
        ) : (
          <ListadoCajas visibles={visibles} manual={manual} puedeOrdenar={puedeOrdenar} vista={vista} catalogo={catalogo} money={money} solapes={solapes} store={store}
            motivo={orden !== 'manual' ? 'Usa “Orden manual” para reordenar' : 'Quita la búsqueda y los filtros para reordenar'}
            onToggle={i => activar(i.caja)} onMover={mover} onEdit={caja => setForm({ caja })} onClone={caja => setForm({ caja: null, clonDe: caja })} onDelete={setBorrar}
            onAjustar={i => i.r && setAjustar({ caja: i.caja, asignado: i.r.asignado })} onPlantilla={caja => plantillas.guardarComoPlantilla('subcaja', caja.id)}
            onCommit={ids => store.track('cajas:orden', { pending: 'Guardando el orden…', ok: 'Orden de cajas guardado.', error: 'No se pudo guardar el orden de las cajas. Se restauró el anterior.' },
              () => store.actions.reorderCajas(ids), { retry: false })} />
        )}
      </section>

      {form && <CajaForm mesSel={mes ?? today.slice(0, 7)} store={store} caja={form.caja} clonDe={form.clonDe ?? null} cajas={data.cajas} catalogo={catalogo} medios={sortMedios(data.medios.map(m => m.nombre))} onClose={() => setForm(null)} />}
      {borrar && <BorrarCaja store={store} caja={data.cajas.find(x => x.id === borrar.id) ?? borrar} data={data} onClose={() => setBorrar(null)} onDesactivar={() => { const x = borrar; setBorrar(null); if (cajaActiva(x)) activar(x) }} />}
      {plantillas.nodo}
      {ajustar && <CajaModal store={store} target={ajustar} cajas={c} mes={mes} money={money} onClose={() => setAjustar(null)} />}
    </div>
  )
}

/* ============================== Cabecera y caja general ============================== */

function Cabecera({ c, money, filters, setFilters, today, n, onAjustar }: {
  c: CajasResumen; money: (n: number) => string; filters: Filters; setFilters: (f: Filters) => void; today: string; n: number; onAjustar?: () => void
}) {
  const nf = c.fondos.lista.length
  return (
    <div className="relative overflow-hidden rounded-3xl border border-line p-5 sm:p-6"
      style={{ background: 'radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, #F59E0B 12%, var(--card)) 0%, var(--card) 45%), radial-gradient(90% 120% at 100% 100%, color-mix(in srgb, #4F7BE8 12%, var(--card)) 0%, transparent 60%)' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-card text-warning shadow-sm ring-1 ring-line"><Wallet className="size-6" /></span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-ink">Cajas y presupuestos</h1>
            <p className="mt-0.5 text-sm text-muted">Tus fondos del presupuesto forman el presupuesto consolidado; las cajas reservan partes de él.</p>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-72"><PeriodPicker value={filters} today={today} onChange={p => setFilters({ ...filters, ...p })} /></div>
        <span className="text-[11px] text-muted">{formatDate(filters.desde)} – {formatDate(filters.hasta)} · {nf} fondo{nf === 1 ? '' : 's'} · {n} caja{n === 1 ? '' : 's'}</span>
        {onAjustar && <button type="button" onClick={onAjustar} className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-medium text-ink hover:bg-bg"><Pencil className="size-3.5" /> Ajustar presupuesto</button>}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="cajas-resumen">
        <Mini label="Presupuesto consolidado" value={c.presupuesto || c.origen === 'fondos' ? money(c.presupuesto) : '—'} />
        <Mini label="Reservado en cajas" value={money(c.reservado)} tone="#6D5DD3" />
        <Mini label="Libre inicial" value={c.presupuesto ? money(c.libreInicial) : '—'} tone={c.libreInicial < 0 ? TONO.alerta.fg : undefined} />
        <Mini label="Gastado fuera de cajas" value={money(c.gastadoLibre)} tone="#E8664F" />
      </dl>
    </div>
  )
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-card/80 px-3 py-2.5 ring-1 ring-line">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="tabular truncate text-base font-bold" style={tone ? { color: tone } : undefined}>{value}</dd>
    </div>
  )
}

/* ============================== Subcajas ============================== */

function estadoDe(i: Item, money: (n: number) => string) {
  if (!cajaActiva(i.caja) || !i.r) return { txt: 'Inactiva', tono: TONO.neutro, Icon: Power }
  const r = i.r
  if (r.asignado > 0 && r.excedido) return { txt: `Excedida ${pctTxt(r.pct !== null ? Math.round((r.pct - 100) * 10) / 10 : null)}`, tono: TONO.alerta, Icon: AlertTriangle, extra: `Superó lo asignado en ${money(-r.disponible)}` }
  if (!r.count) return { txt: 'Sin movimientos', tono: TONO.info, Icon: CircleDashed }
  if (!r.asignado) return { txt: 'Sin presupuesto', tono: TONO.atencion, Icon: CircleDashed }
  if ((r.pct ?? 0) >= 90) return { txt: 'Cerca del límite', tono: TONO.atencion, Icon: AlertTriangle }
  return { txt: 'Al día', tono: TONO.ok, Icon: CheckCircle2 }
}

const resumirNombres = (xs: string[]) => (xs.length <= 3 ? xs.join(', ') : `${xs.slice(0, 3).join(', ')} y ${xs.length - 3} más`)
const alcanceTxt = (c: Caja) => `${c.filtroCampo} · ${c.filtroValor}`

function ListadoCajas({ visibles, manual, puedeOrdenar, vista, catalogo, money, solapes, store, motivo, onToggle, onMover, onEdit, onClone, onDelete, onAjustar, onCommit, onPlantilla }: {
  visibles: Item[]; manual: string[]; puedeOrdenar: boolean; vista: 'grid' | 'lista'; catalogo: CatalogoItem[]; money: (n: number) => string; solapes: Map<string, string[]>; store: AppStore; motivo: string
  onToggle: (i: Item) => void; onMover: (id: string, d: number) => void; onEdit: (c: Caja) => void; onClone: (c: Caja) => void; onDelete: (c: Caja) => void; onAjustar: (i: Item) => void; onCommit: (ids: string[]) => void; onPlantilla: (c: Caja) => void
}) {
  // Arrastrar solo en "Orden manual" y sin búsqueda ni filtros: el orden visible es entonces el orden global.
  const habilitado = puedeOrdenar && manual.length > 1
  const dnd = useReorden({ ids: manual, habilitado, onCommit, nombre: id => visibles.find(i => i.caja.id === id)?.caja.nombre ?? 'Caja' })
  const porId = new Map(visibles.map(i => [i.caja.id, i]))
  const items = (habilitado ? dnd.orden : visibles.map(i => i.caja.id)).map(id => porId.get(id)).filter((i): i is Item => !!i)
  const acc = (i: Item) => <Acciones caja={i.caja} puedeOrdenar={puedeOrdenar} first={manual[0] === i.caja.id} last={manual.at(-1) === i.caja.id}
    onEdit={() => onEdit(i.caja)} onUp={() => onMover(i.caja.id, -1)} onDown={() => onMover(i.caja.id, 1)} onClone={() => onClone(i.caja)} onDelete={() => onDelete(i.caja)} onPlantilla={() => onPlantilla(i.caja)} />
  const swipe = (i: Item): AccionMenu[] => [
    { key: 'edit', label: 'Editar', icon: <Pencil className="size-4" />, onClick: () => onEdit(i.caja) },
    { key: 'clone', label: 'Clonar', icon: <Copy className="size-4" />, onClick: () => onClone(i.caja) },
    { key: 'tpl', label: 'Plantilla', icon: <FilePlus2 className="size-4" />, onClick: () => onPlantilla(i.caja) },
    { key: 'delete', label: 'Eliminar', icon: <Trash2 className="size-4" />, onClick: () => onDelete(i.caja), danger: true },
  ]
  const asa = (i: Item) => <AsaOrden {...dnd.asa(i.caja.id)} habilitado={habilitado} motivo={motivo} />
  return (
    <>
      {vista === 'grid' ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Lista de cajas">
          {items.map(i => <TarjetaCaja key={i.caja.id} i={i} catalogo={catalogo} money={money} solapes={solapes.get(i.caja.id)} busy={store.pending.has(`caja:${i.caja.id}`)} onToggle={() => onToggle(i)}
            dnd={dnd.item(i.caja.id)} asa={asa(i)} acciones={acc(i)} onAjustar={() => onAjustar(i)} />)}
        </ul>
      ) : (
        <ListaCajas items={items} catalogo={catalogo} money={money} solapes={solapes} pending={store.pending} acciones={acc} swipe={swipe} asa={asa} dnd={id => dnd.item(id)} onToggle={onToggle} />
      )}
      <AvisoOrden texto={dnd.aviso} />
    </>
  )
}

type DndItem = { ref: (el: HTMLElement | null) => void; 'data-arrastrando'?: string }

function TarjetaCaja({ i, catalogo, money, solapes, busy, acciones, onAjustar, onToggle, dnd, asa }: {
  dnd: DndItem; asa: ReactNode; i: Item; catalogo: CatalogoItem[]; money: (n: number) => string; solapes?: string[]; busy: boolean; acciones: ReactNode; onAjustar: () => void; onToggle: () => void
}) {
  const { caja, r } = i
  const { Icon, color } = cajaLook(caja, catalogo)
  const AIcon = alcanceIcon(caja.filtroCampo)
  const e = estadoDe(i, money)
  const activa = cajaActiva(caja) && !!r
  return (
    <li {...dnd} className={`${CLASE_ARRASTRE} group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgb(15_23_42/0.07)] ${activa ? '' : 'opacity-75'}`}
      data-testid="caja" style={{ boxShadow: r?.excedido ? `inset 0 0 0 1.5px ${TONO.alerta.fg}55` : undefined }}>
      <span className="h-1.5" style={{ background: activa ? `linear-gradient(90deg, ${color}, ${color}99)` : 'var(--line)' }} aria-hidden />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          {asa}
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: `${color}1A`, color }}><Icon className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{caja.nombre}</p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted"><AIcon className="size-3 shrink-0" />{alcanceTxt(caja)}</p>
          </div>
          {acciones}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: e.tono.fg, background: e.tono.bg }} data-testid="estado-caja"><e.Icon className="size-3" />{e.txt}</span>
          {busy && <span className="text-[11px] text-muted">Guardando…</span>}
          <span className="ml-auto"><Toggle on={cajaActiva(caja)} onChange={onToggle} label={`${cajaActiva(caja) ? 'Desactivar' : 'Activar'} ${caja.nombre}`} disabled={busy} /></span>
        </div>
        {caja.descripcion && <p className="mt-2 line-clamp-2 text-xs text-muted">{caja.descripcion}</p>}
        {r ? (
          <>
            <dl className="tabular mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted">
              <div><dt>Asignado</dt><dd className="text-sm font-bold text-ink">{r.asignado ? money(r.asignado) : '—'}</dd></div>
              <div><dt>Gastado</dt><dd className="text-sm font-bold text-ink">{money(r.gastado)}</dd></div>
              <div><dt>Disponible</dt><dd className="text-sm font-bold" style={{ color: r.disponible < 0 ? TONO.alerta.fg : TONO.ok.fg }}>{r.asignado ? money(r.disponible) : '—'}</dd></div>
            </dl>
            <div className="mt-3 flex items-center gap-2">
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-bg" role="progressbar" aria-valuenow={r.pct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`Consumido ${caja.nombre}`}>
                <span className="bar-grow block h-full rounded-full" style={{ width: `${Math.min(r.pct ?? 0, 100)}%`, background: r.excedido ? TONO.alerta.fg : color }} />
              </span>
              <span className="tabular w-12 text-right text-xs font-bold" style={{ color: r.excedido ? TONO.alerta.fg : 'var(--ink)' }}>{pctTxt(r.pct)}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">{e.extra ?? `${r.count} movimiento${r.count === 1 ? '' : 's'} en el período`}</p>
          </>
        ) : <p className="mt-3 rounded-xl bg-bg px-3 py-2 text-xs text-muted">Inactiva: no reserva dinero ni toma gastos. Actívala desde el menú ⋯.</p>}
        {activa && (caja.filtroCampo === 'Medio de pago' || (solapes && solapes.length > 0)) && (
          <p className="mt-2 flex items-start gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px]" style={{ background: TONO.info.bg, color: TONO.info.fg }} data-testid="solape">
            <Info className="mt-0.5 size-3 shrink-0" />
            {caja.filtroCampo === 'Medio de pago'
              ? `Toma lo pagado con ${caja.filtroValor} que no caiga en una caja por ámbito, categoría o subcategoría.`
              : `Comparte gastos con ${resumirNombres(solapes!)}. Gana el alcance más específico.`}
          </p>
        )}
        {activa && (
          <div className="mt-auto flex justify-end pt-3">
            <Button variant="soft" className="h-9 px-3 text-xs" onClick={onAjustar} aria-label={`Ajustar ${caja.nombre}`}><Pencil className="size-3.5" /> Ajustar monto</Button>
          </div>
        )}
      </div>
    </li>
  )
}

function ListaCajas({ items, catalogo, money, solapes, pending, acciones, swipe, onToggle, asa, dnd }: {
  asa: (i: Item) => ReactNode; dnd: (id: string) => DndItem; items: Item[]; catalogo: CatalogoItem[]; money: (n: number) => string; solapes: Map<string, string[]>; pending: ReadonlySet<string>
  acciones: (i: Item) => ReactNode; swipe: (i: Item) => AccionMenu[]; onToggle: (i: Item) => void
}) {
  const movil = useEsMovil()
  return (
    <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line" aria-label="Lista de cajas">
      {items.map(i => {
        const { caja, r } = i
        const { Icon, color } = cajaLook(caja, catalogo)
        const e = estadoDe(i, money)
        return (
          <li key={caja.id} {...dnd(caja.id)} data-testid="caja" className={`${CLASE_ARRASTRE} border border-transparent transition hover:bg-bg/60`}>
            <SwipeFila nombre={caja.nombre} acciones={swipe(i)} activo={movil} testId="caja-fila">
              {/* Móvil: línea 1 = asa, icono, nombre, interruptor; línea 2 = progreso y montos. Escritorio: una sola fila. */}
              <div className="grid grid-cols-[2rem_2.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 px-2.5 py-2 sm:grid-cols-[2rem_2.5rem_minmax(0,1.4fr)_minmax(0,1fr)_6.5rem_auto_auto] sm:gap-x-3 sm:px-3 sm:py-2.5">
                {asa(i)}
                <span className="grid size-9 place-items-center rounded-xl sm:size-10" style={{ background: `${color}1A`, color }}><Icon className="size-4" /></span>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-semibold"><span className="truncate">{caja.nombre}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: e.tono.fg, background: e.tono.bg }} data-testid="estado-caja">{e.txt}</span>
                    {pending.has(`caja:${caja.id}`) && <span className="text-[10px] font-normal text-muted">Guardando…</span>}</p>
                  <p className="truncate text-[11px] text-muted">{alcanceTxt(caja)}{solapes.get(caja.id)?.length ? ` · comparte con ${resumirNombres(solapes.get(caja.id)!)}` : ''}</p>
                </div>
                <div className="col-start-3 col-end-5 row-start-2 min-w-0 sm:col-end-auto sm:row-start-1">
                  {r ? (<>
                    <span className="block h-1.5 overflow-hidden rounded-full bg-bg"><span className="bar-grow block h-full rounded-full" style={{ width: `${Math.min(r.pct ?? 0, 100)}%`, background: r.excedido ? TONO.alerta.fg : color }} /></span>
                    <span className="tabular mt-1 flex justify-between gap-2 text-[11px] text-muted"><span className="truncate">{money(r.gastado)} de {r.asignado ? money(r.asignado) : '—'}</span>
                      <b className="shrink-0 sm:hidden" style={{ color: r.disponible < 0 ? TONO.alerta.fg : TONO.ok.fg }}>{r.asignado ? `Disp. ${money(r.disponible)}` : ''}</b></span>
                  </>) : <span className="text-[11px] text-muted">Inactiva: no reserva dinero</span>}
                </div>
                <span className="tabular hidden text-right text-sm font-bold sm:block" style={{ color: r && r.disponible < 0 ? TONO.alerta.fg : 'var(--ink)' }}>{r?.asignado ? money(r.disponible) : '—'}</span>
                <Toggle on={cajaActiva(caja)} onChange={() => onToggle(i)} label={`${cajaActiva(caja) ? 'Desactivar' : 'Activar'} ${caja.nombre}`} disabled={pending.has(`caja:${caja.id}`)} />
                {!movil && acciones(i)}
              </div>
            </SwipeFila>
          </li>
        )
      })}
    </ul>
  )
}

function Acciones({ caja, puedeOrdenar, first, last, onEdit, onUp, onDown, onClone, onDelete, onPlantilla }: {
  caja: Caja; puedeOrdenar: boolean; first: boolean; last: boolean; onEdit: () => void; onUp: () => void; onDown: () => void; onClone: () => void; onDelete: () => void; onPlantilla: () => void
}) {
  const sinOrden = puedeOrdenar ? undefined : 'Usa “Orden manual” y quita la búsqueda y los filtros para reordenar'
  return (
    <div className="relative flex shrink-0 items-center gap-1">
      <BotonEditar label={`Editar ${caja.nombre}`} onClick={onEdit} />
      <MenuAcciones label={`Más acciones de ${caja.nombre}`} acciones={[
        { key: 'up', label: 'Subir', icon: <ArrowUp className="size-3.5" />, onClick: onUp, disabled: !puedeOrdenar || first, title: sinOrden },
        { key: 'down', label: 'Bajar', icon: <ArrowDown className="size-3.5" />, onClick: onDown, disabled: !puedeOrdenar || last, title: sinOrden },
        { key: 'clone', label: 'Clonar', icon: <Copy className="size-3.5" />, onClick: onClone },
        { key: 'tpl', label: 'Guardar como plantilla', icon: <FilePlus2 className="size-3.5" />, onClick: onPlantilla },
        { key: 'delete', label: 'Eliminar', icon: <Trash2 className="size-3.5" />, onClick: onDelete, danger: true },
      ]} />
    </div>
  )
}

function Vacio({ icon: Icon, titulo, children, accion }: { icon: typeof Wallet; titulo: string; children?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-2xl" style={{ background: TONO.info.bg, color: TONO.info.fg }}><Icon className="size-6" /></span>
      <p className="text-sm font-semibold text-ink">{titulo}</p>
      {children && <p className="max-w-md text-xs text-muted">{children}</p>}
      {accion && <div className="mt-1">{accion}</div>}
    </div>
  )
}

/* ============================== Solapamientos ============================== */

/**
 * Para cada subcaja activa por clasificación, las otras con las que comparte algún gasto posible según el catálogo.
 * Las cajas por medio de pago (p. ej. Sodexo) cruzan todas las clasificaciones y siempre pierden ante ellas: se
 * explican en su propia tarjeta en vez de marcar un solape en cada caja.
 */
export function calcularSolapes(cajas: Caja[], catalogo: CatalogoItem[], medios: string[]): Map<string, string[]> {
  const activas = prioridadCajas(cajas).filter(c => c.filtroCampo !== 'Medio de pago')
  const out = new Map<string, string[]>()
  if (activas.length < 2) return out
  const triples = catalogo.filter(c => c.subcategoria)
  const mediosAll = medios.length ? medios : ['']
  for (let x = 0; x < activas.length; x++) for (let y = x + 1; y < activas.length; y++) {
    const A = activas[x], B = activas[y]
    const comparte = triples.some(t => mediosAll.some(m => {
      const g = { ambito: t.ambito, categoria: t.categoria, subcategoria: t.subcategoria, medioPago: m }
      return cajaMatches(A, g) && cajaMatches(B, g)
    }))
    if (comparte) { out.set(A.id, [...(out.get(A.id) ?? []), B.nombre]); out.set(B.id, [...(out.get(B.id) ?? []), A.nombre]) }
  }
  return out
}

/* ============================== Crear / editar ============================== */

function CajaForm({ store, caja, clonDe = null, cajas, catalogo, medios, onClose, mesSel }: {
  mesSel: string; store: AppStore; caja: Caja | null; clonDe?: Caja | null; cajas: Caja[]; catalogo: CatalogoItem[]; medios: string[]; onClose: () => void
}) {
  const editar = !!caja
  const [id] = useState(() => caja?.id ?? `caja-${crypto.randomUUID().slice(0, 8)}`)
  // Clonar: copia alcance y descripción; el monto asignado NO se copia (empieza en 0, editable) y la copia nace inactiva:
  // así no reserva dinero ni compite por los mismos gastos hasta que el usuario la confirme.
  const origen = caja ?? clonDe
  const money = (c: number) => formatMoney(c, store.data?.config.moneda || 'PEN')
  const [nombre, setNombre] = useState(caja?.nombre ?? (clonDe ? `${clonDe.nombre.slice(0, 31)} (Copia)` : ''))
  const [monto, setMonto] = useState(caja ? String(caja.presupuesto) : clonDe ? '0' : '')
  const [campo, setCampo] = useState<Alcance>(origen && origen.filtroCampo !== 'Todos' ? origen.filtroCampo : 'Categoría')
  const [valor, setValor] = useState(origen?.filtroValor ?? '')
  const [descripcion, setDescripcion] = useState(origen?.descripcion ?? '')
  const [activo, setActivo] = useState(caja ? cajaActiva(caja) : clonDe ? false : true)
  const [mesAplic, setMesAplic] = useState(mesSel)
  const [intentado, setIntentado] = useState(false)   // tras el primer intento de guardar, cada campo se valida al cambiarlo
  const opciones = useMemo(() => {
    const xs = opcionesValor(campo, catalogo, medios)
    return valor && !xs.includes(valor) ? [valor, ...xs] : xs
  }, [campo, catalogo, medios, valor])
  // Opciones con el icono y color del catálogo; las subcategorías se agrupan por su categoría (que también se ve en el campo).
  const opcionesCombo = useMemo<Opcion[]>(() => opcionesAlcanceCombo(opciones, campo, catalogo), [opciones, campo, catalogo])
  const otras = cajas.filter(x => x.id !== id && x.filtroCampo !== 'Todos')
  // Automático: el de su alcance (medio de pago, ámbito, categoría o subcategoría). Elegir un icono o un color lo fija.
  const colorBase = caja?.color || COLORS[cajas.length % COLORS.length]
  const auto = valor ? cajaLook({ filtroCampo: campo, filtroValor: valor, color: colorBase, icono: '' }, catalogo) : { ...cajaLook({ filtroCampo: 'Todos', filtroValor: '', color: colorBase, icono: '' }), color: colorBase }
  const { Icon: IconoCaja, color } = auto // el aspecto es siempre automático (según el alcance)
  const borrador: Caja = { id, nombre: nombre.trim() || 'Nueva caja', presupuesto: Number(monto) || 0, filtroCampo: campo, filtroValor: valor, color, icono: '', orden: caja?.orden ?? 0, activo, descripcion }
  const solapes = valor && activo ? calcularSolapes([borrador, ...otras.filter(cajaActiva)], catalogo, medios).get(id) ?? [] : []
  const gana = (otro: string) => {
    const o = otras.find(x => x.nombre === otro)!
    const d = ESPECIFICIDAD[campo] - ESPECIFICIDAD[o.filtroCampo]
    return d > 0 ? 'esta caja' : d < 0 ? o.nombre : (borrador.orden || Infinity) <= o.orden ? 'esta caja' : o.nombre
  }

  // Validación pura sobre el estado actual: el mensaje sigue al alcance elegido y desaparece en cuanto el campo es válido.
  const m = monto.trim()
  const errs: Record<string, string> = {}
  if (!nombre.trim()) errs.nombre = 'Escribe un nombre'
  if (!/^\d{1,9}([.,]\d{1,2})?$/.test(m) || Number(m.replace(',', '.')) < 0) errs.monto = 'Monto mayor o igual a 0, hasta 2 decimales'
  if (!valor) errs.valor = `Elige ${campo === 'Medio de pago' ? 'un medio de pago' : `un${campo === 'Categoría' || campo === 'Subcategoría' ? 'a' : ''} ${campo.toLowerCase()}`}`
  const dup = activo && otras.find(x => cajaActiva(x) && x.filtroCampo === campo && normName(x.filtroValor) === normName(valor))
  if (dup) errs.valor = `La caja “${dup.nombre}” ya usa ${campo} = ${valor}. Cambia el alcance o desactiva una de las dos.`
  const errors = intentado ? errs : {}

  function save() {
    setIntentado(true)
    if (Object.keys(errs).length) return
    const orden = caja?.orden ?? Math.max(1, ...cajas.map(x => x.orden)) + 1
    const data: Caja = { ...borrador, nombre: nombre.trim(), presupuesto: Math.round(Number(m.replace(',', '.')) * 100) / 100, orden, descripcion: formatearDescripcion(descripcion) }
    const ok = store.track(`caja:${id}`, editar
      ? { pending: `Guardando ${data.nombre}…`, ok: `${data.nombre} actualizada correctamente.`, error: `No se pudo actualizar ${data.nombre}.` }
      : { pending: `Creando ${data.nombre}…`, ok: clonDe ? `${data.nombre} creada${activo ? '' : ' inactiva: no reserva dinero hasta que la actives'}.` : `${data.nombre} creada correctamente.`, error: `No se pudo crear ${data.nombre}.` },
    async () => {
      await store.actions.saveCaja(data)
      // v1.19: la subcaja nueva reserva dinero en el mes elegido (cada mes tiene sus propias subcajas aplicadas).
      if (!editar && activo && mesAplic >= aislaDesde(store.data?.config)) await store.actions.aplicarEntidadesMes('subcaja', mesAplic, [{ id, monto: data.presupuesto }])
    })
    if (ok) onClose()
  }

  return (
    <Modal open onClose={onClose} size="md" title={editar ? `Editar ${caja!.nombre}` : clonDe ? `Clonar ${clonDe.nombre}` : 'Nueva caja'} icon={<Wallet className="size-5" />}
      subtitle="Una reserva dentro de tu presupuesto consolidado que junta sola los gastos de su alcance."
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save}>{editar ? 'Guardar cambios' : clonDe ? 'Crear copia' : 'Crear caja'}</Button></>}>
      <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); save() }}>
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: `${color}14`, boxShadow: `inset 0 0 0 1px ${color}33` }}>
          <span className="grid size-11 place-items-center rounded-2xl bg-card" style={{ color }}><IconoCaja className="size-5" /></span>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{borrador.nombre}</p><p className="truncate text-[11px] text-muted">{valor ? `${campo} · ${valor}` : 'Elige el alcance'}</p></div>
        </div>
        {clonDe && (
          <ErrorBox tone="warning" message={activo
            ? `Al crearla, esta copia reservará ${money(Math.round((Number(monto.replace(',', '.')) || 0) * 100))} por mes del libre de tu presupuesto. Revisa el monto y el alcance.`
            : `Es una copia de “${clonDe.nombre}”: no copia gastos ni su monto asignado y nace inactiva, así que no reserva dinero hasta que la actives.`} />
        )}
        <Field label="Nombre" error={errors.nombre} htmlFor="caja-nombre">
          <input id="caja-nombre" className={inputCls} maxLength={40} placeholder="Ej. Caja Salud" value={nombre} onChange={e => setNombre(e.target.value)} />
        </Field>
        {!editar && (
          <Field label="Mes de aplicación" htmlFor="caja-mes" hint="Esta caja reserva su monto en el mes elegido; los demás meses se preparan aparte.">
            <MonthPicker id="caja-mes" label="Mes de aplicación" value={mesAplic} onChange={setMesAplic} />
          </Field>
        )}
        <Field label="Monto asignado por mes" error={errors.monto} htmlFor="caja-asignado" hint="Se descuenta del libre de la caja general. Para cambiar solo un mes usa “Ajustar monto”.">
          <span className="relative block">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">S/</span>
            <input id="caja-asignado" className={`${inputCls} tabular h-11 pl-9`} inputMode="decimal" placeholder="0.00" value={monto} onChange={e => setMonto(e.target.value.replace(/[^\d.,]/g, ''))} />
          </span>
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Alcance</p>
          <Segmented label="Alcance" value={campo} onChange={v => { setCampo(v); setValor('') }} options={ALCANCES.map(a => ({ value: a.value, label: a.label }))} />
          <p className="mt-1 text-[11px] text-muted">{campo === 'Medio de pago' ? 'Útil para Sodexo u otra tarjeta de uso exclusivo.' : 'Prioridad si se solapa: Subcategoría > Categoría > Ámbito > Medio de pago.'}</p>
        </div>
        <Field label={`Valor (${campo.toLowerCase()})`} error={errors.valor} htmlFor="caja-valor">
          <Combobox id="caja-valor" label={`Valor (${campo.toLowerCase()})`} value={valor} onChange={setValor} invalid={!!errors.valor} placeholder="Elige…" descEnTrigger searchable={opciones.length > 6} maxHeight={340}
            options={opcionesCombo} vacio="Sin opciones activas en el catálogo." />
        </Field>
        {solapes.length > 0 && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: TONO.info.bg, color: TONO.info.fg }} data-testid="aviso-solape">
            <p className="flex items-center gap-1.5 font-semibold"><SlidersHorizontal className="size-3.5" /> Se solapa con {solapes.join(', ')}</p>
            {(() => {
              const gano = solapes.filter(o => gana(o) === 'esta caja'), perdio = solapes.filter(o => gana(o) !== 'esta caja')
              return <ul className="mt-1 list-disc pl-5">
                {gano.length > 0 && <li>Frente a {resumirNombres(gano)}, los gastos que coincidan se cuentan en <b>esta caja</b> (es más específica).</li>}
                {perdio.length > 0 && <li>Frente a {resumirNombres(perdio)}, se cuentan en <b>{perdio.length === 1 ? perdio[0] : 'esas cajas'}</b>.</li>}
              </ul>
            })()}
          </div>
        )}
        <Field label="Descripción (opcional)" htmlFor="caja-desc">
          <input id="caja-desc" className={inputCls} maxLength={200} placeholder="Ej. Médico, farmacia y exámenes" value={descripcion} onChange={e => setDescripcion(e.target.value)} onBlur={() => setDescripcion(formatearDescripcion(descripcion))} />
        </Field>
        <div className="rounded-xl border border-line p-3">
          <Switch checked={activo} onChange={setActivo} label="Caja activa" />
          <p className="mt-1 text-[11px] text-muted">Una caja inactiva no reserva dinero ni toma gastos; puedes reactivarla cuando quieras.</p>
        </div>
        {editar && caja!.filtroCampo !== campo && <ErrorBox tone="warning" message="Cambiar el alcance no modifica ningún gasto: solo cambia cuáles cuenta esta caja." />}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}

function BorrarCaja({ store, caja, data, onClose, onDesactivar }: { store: AppStore; caja: Caja; data: AppData; onClose: () => void; onDesactivar: () => void }) {
  const deps = useMemo(() => dependenciasCaja(caja, data), [caja, data])
  // Una subcaja inactiva no toma ningún gasto (el motor la ignora): solo bloquea la activa con gastos de su alcance.
  const bloqueada = cajaActiva(caja) && deps.gastos > 0
  return (
    <Modal open onClose={onClose} size="sm" title={bloqueada ? `No se puede eliminar ${caja.nombre}` : 'Eliminar caja'} icon={<Trash2 className="size-5" />}
      footer={bloqueada
        ? <><Button variant="outline" onClick={onClose}>Cerrar</Button><Button onClick={onDesactivar}>Desactivar en su lugar</Button></>
        : <><Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" disabled={store.pending.has(`caja:${caja.id}`)} onClick={() => {
            const ok = store.track(`caja:${caja.id}`, { pending: `Eliminando ${caja.nombre}…`, ok: `${caja.nombre} eliminada. Ningún gasto se borró.`, error: `No se pudo eliminar ${caja.nombre}.` },
              () => store.actions.deleteCaja(caja.id))
            if (ok) onClose()
          }}><Trash2 className="size-4" /> Eliminar</Button></>}>
      <div className="space-y-2 text-sm" data-testid="eliminar-caja">
        <p className="font-semibold">“{caja.nombre}” · {alcanceTxt(caja)}</p>
        {bloqueada ? (
          <p className="rounded-xl px-3 py-2 text-xs" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }} data-testid="caja-con-gastos">
            Está activa y su alcance coincide con {deps.gastos} gasto(s) de tu historial. Para no perder el seguimiento no se elimina.
            Desactívala: libera su reserva al libre, conserva su configuración y los gastos y podrás eliminarla o reactivarla cuando quieras.
          </p>
        ) : (
          <p className="text-muted">{cajaActiva(caja) ? 'No coincide con ningún gasto.' : 'Está inactiva: no toma ningún gasto.'} Se eliminará la caja{deps.presupuestos ? ` y sus ${deps.presupuestos} ajuste(s) mensual(es)` : ''}; su reserva vuelve al libre de la caja general y ningún gasto se borra.</p>
        )}
      </div>
    </Modal>
  )
}
