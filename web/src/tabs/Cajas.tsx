import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useAgregado } from '../lib/useAgregado'
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, CircleDashed, Layers, LayoutGrid, List, Lock, MoreHorizontal, Pencil, Plus, Power, Search,
  Shapes, SlidersHorizontal, Tag, Trash2, Wallet, CreditCard, Info,
} from 'lucide-react'
import { cajaActiva, cajaMatches, ESPECIFICIDAD, prioridadCajas, type CajasResumen, type SubcajaResumen } from '../lib/engine'
import { formatMoney } from '../lib/money'
import { formatDate, monthLabel, rangeLabel, singleMonth } from '../lib/dates'
import type { AppStore } from '../lib/store'
import type { Caja, CatalogoItem, Filters, FiltroCampo } from '../lib/types'
import { normName, otrosAlFinal } from '../lib/orden'
import { sortMedios } from '../lib/visual'
import { PeriodPicker } from '../components/shared'
import { CajaModal, cajaIcon } from '../components/cajas'
import { FuentesSeccion } from '../components/fuentes'
import { Button, ErrorBox, Field, InfoTooltip, inputCls, Modal, Segmented, SelectField, Skeleton, Switch, useDismiss } from '../components/ui'

type Alcance = Exclude<FiltroCampo, 'Todos'>
const ALCANCES: { value: Alcance; label: string; Icon: typeof Tag }[] = [
  { value: 'Ámbito', label: 'Ámbito', Icon: Layers },
  { value: 'Categoría', label: 'Categoría', Icon: Shapes },
  { value: 'Subcategoría', label: 'Subcategoría', Icon: Tag },
  { value: 'Medio de pago', label: 'Medio de pago', Icon: CreditCard },
]
const alcanceIcon = (c: FiltroCampo) => ALCANCES.find(a => a.value === c)?.Icon ?? Wallet
type Orden = 'manual' | 'nombre' | 'monto' | 'mas' | 'menos' | 'uso'
const COLORES = ['#4F7BE8', '#16A085', '#E8664F', '#8B7CF6', '#EC4899', '#F59E0B', '#0EA5E9', '#64748B', '#84CC16', '#E25563']
const TONO = {
  ok: { fg: '#0F8A6B', bg: '#E7F7F2' }, atencion: { fg: '#B7791F', bg: '#FFF6DB' }, alerta: { fg: '#C0362C', bg: '#FDECEC' },
  info: { fg: '#4F6FC8', bg: '#EEF3FF' }, neutro: { fg: '#64748B', bg: 'var(--bg)' },
}
const pctTxt = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es-PE', { maximumFractionDigits: 1 })}%`)

interface Item { caja: Caja; r: SubcajaResumen | null }

/**
 * Pestaña Cajas y presupuestos. La caja general manda: las subcajas son reservas dentro de ella (no suman), cada gasto
 * cae en UNA sola subcaja (la más específica) o en "fuera de subcajas". Reutiliza el mismo motor que el Dashboard.
 */
export default function Cajas({ store, filters, setFilters, today }: { store: AppStore; filters: Filters; setFilters: (f: Filters) => void; today: string }) {
  const data = store.data
  const base = data?.config.moneda || 'PEN'
  const money = useCallback((c: number) => formatMoney(c, base), [base])
  const cajas = data?.cajas
  // Mismo motor y mismo contexto (fuentes, cajas, ajustes) en Dashboard, Cajas y Salud financiera.
  const a = useAgregado(data, filters, today)
  const mes = singleMonth(filters.desde, filters.hasta)
  const [q, setQ] = useState('')
  const [alcance, setAlcance] = useState<'todos' | Alcance>('todos')
  const [estado, setEstado] = useState<'activas' | 'inactivas' | 'todas'>('todas')
  const [orden, setOrden] = useState<Orden>('manual')
  const [vista, setVista] = useState<'grid' | 'lista'>('grid')
  const [form, setForm] = useState<{ caja: Caja | null } | null>(null)
  const [borrar, setBorrar] = useState<Caja | null>(null)
  const [ajustar, setAjustar] = useState<{ caja: Caja; asignado: number } | null>(null)
  const catalogo = useMemo(() => data?.catalogo ?? [], [data?.catalogo])

  // Solapamientos: qué subcajas activas comparten algún gasto posible (según el catálogo y los medios) y cuál gana.
  const solapes = useMemo(() => calcularSolapes(cajas ?? [], catalogo, (data?.medios ?? []).map(m => m.nombre)), [cajas, catalogo, data?.medios])

  if (!data || !a) return <Skeleton className="h-96" />
  const c = a.cajas
  const items: Item[] = [
    ...c.subcajas.map(r => ({ caja: r.caja, r })),
    ...c.inactivas.map(caja => ({ caja, r: null })),
  ]
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
  const manual = [...items].sort((x, y) => x.caja.orden - y.caja.orden).map(i => i.caja.id)
  const puedeOrdenar = orden === 'manual' && !filtrando

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
    store.track(`caja:${caja.id}`, { pending: on ? 'Activando caja…' : 'Desactivando caja…', ok: `${caja.nombre} ${on ? 'activada' : 'desactivada'}.`, error: `No se pudo ${on ? 'activar' : 'desactivar'} ${caja.nombre}.` },
      () => store.actions.saveCaja({ ...caja, activo: on }))
  }

  return (
    <div className="space-y-4">
      <Cabecera c={c} money={money} filters={filters} setFilters={setFilters} today={today} n={items.length} />
      <FuentesSeccion store={store} c={c} mes={mes} money={money} periodo={mes ? monthLabel(mes, true) : rangeLabel(filters)} hoyMes={today.slice(0, 7)} />
      <CajaGeneral c={c} money={money} periodo={rangeLabel(filters)} onAjustar={() => c.general && setAjustar({ caja: c.general, asignado: c.presupuesto })} />

      <section className="rounded-3xl border border-line bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_8px_24px_rgb(15_23_42/0.04)] sm:p-5" aria-label="Reservas y subcajas">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">Reservas / subcajas <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-semibold text-muted">{items.length}</span>
              <InfoTooltip title="Cómo se reparten los gastos" align="left">
                <p>Cada gasto cae en una sola subcaja: la de alcance más específico. Prioridad: <b>Subcategoría &gt; Categoría &gt; Ámbito &gt; Medio de pago</b>. A igual nivel, gana la primera en tu orden manual.</p>
                <p>Ejemplo: con “Familia” (ámbito) y “Bebé” (categoría), un gasto de Bebé va a Bebé. Lo que no cae en ninguna va a “gastado fuera de subcajas”.</p>
                <p>Una caja inactiva no reserva dinero ni toma gastos. Eliminar una caja no borra ningún gasto.</p>
              </InfoTooltip>
            </h2>
            <p className="text-xs text-muted">Apartan parte del presupuesto consolidado por ámbito, categoría, subcategoría o medio de pago. No suman dinero.</p>
          </div>
          <Button onClick={() => setForm({ caja: null })}><Plus className="size-4" /> Nueva subcaja</Button>
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
            {([['grid', LayoutGrid, 'Tarjetas'], ['lista', List, 'Lista']] as const).map(([v, Icon, l]) => (
              <button key={v} type="button" role="radio" aria-checked={vista === v} aria-label={l} title={l} onClick={() => setVista(v)}
                className={`grid size-9 place-items-center rounded-lg transition ${vista === v ? 'bg-primary-soft text-navy' : 'text-muted hover:bg-bg'}`}><Icon className="size-4" /></button>
            ))}
          </div>
        </div>
        {!puedeOrdenar && items.length > 1 && <p className="-mt-2 mb-3 text-[11px] text-muted">Para reordenar, usa “Orden manual” y quita la búsqueda y los filtros.</p>}

        {!items.length ? (
          <Vacio icon={Wallet} titulo="Aún no tienes subcajas" accion={<Button onClick={() => setForm({ caja: null })}><Plus className="size-4" /> Crear mi primera caja</Button>}>
            Aparta dinero de tu presupuesto para Auto, Salud, Streaming o lo que quieras: cada caja junta sola los gastos de su alcance.
          </Vacio>
        ) : !visibles.length ? (
          <Vacio icon={Search} titulo="Ninguna caja coincide" accion={<Button variant="outline" onClick={() => { setQ(''); setAlcance('todos'); setEstado('todas') }}>Limpiar filtros</Button>}>
            Prueba con otra palabra, alcance o estado.
          </Vacio>
        ) : vista === 'grid' ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Lista de cajas">
            {visibles.map(i => (
              <TarjetaCaja key={i.caja.id} i={i} money={money} solapes={solapes.get(i.caja.id)} busy={store.pending.has(`caja:${i.caja.id}`)}
                acciones={<Acciones caja={i.caja} puedeOrdenar={puedeOrdenar} first={manual[0] === i.caja.id} last={manual.at(-1) === i.caja.id}
                  onEdit={() => setForm({ caja: i.caja })} onUp={() => mover(i.caja.id, -1)} onDown={() => mover(i.caja.id, 1)}
                  onToggle={() => activar(i.caja)} onDelete={() => setBorrar(i.caja)} />}
                onAjustar={() => i.r && setAjustar({ caja: i.caja, asignado: i.r.asignado })} />
            ))}
          </ul>
        ) : (
          <ListaCajas items={visibles} money={money} solapes={solapes} pending={store.pending}
            acciones={i => <Acciones caja={i.caja} puedeOrdenar={puedeOrdenar} first={manual[0] === i.caja.id} last={manual.at(-1) === i.caja.id}
              onEdit={() => setForm({ caja: i.caja })} onUp={() => mover(i.caja.id, -1)} onDown={() => mover(i.caja.id, 1)}
              onToggle={() => activar(i.caja)} onDelete={() => setBorrar(i.caja)} />} />
        )}
      </section>

      {form && <CajaForm store={store} caja={form.caja} cajas={data.cajas} catalogo={catalogo} medios={sortMedios(data.medios.map(m => m.nombre))} onClose={() => setForm(null)} />}
      {borrar && <BorrarCaja store={store} caja={borrar} onClose={() => setBorrar(null)} />}
      {ajustar && <CajaModal store={store} target={ajustar} cajas={c} mes={mes} money={money} onClose={() => setAjustar(null)} />}
    </div>
  )
}

/* ============================== Cabecera y caja general ============================== */

function Cabecera({ c, money, filters, setFilters, today, n }: {
  c: CajasResumen; money: (n: number) => string; filters: Filters; setFilters: (f: Filters) => void; today: string; n: number
}) {
  const nf = c.fuentes.lista.length
  return (
    <div className="relative overflow-hidden rounded-3xl border border-line p-5 sm:p-6"
      style={{ background: 'radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, #F59E0B 12%, var(--card)) 0%, var(--card) 45%), radial-gradient(90% 120% at 100% 100%, color-mix(in srgb, #4F7BE8 12%, var(--card)) 0%, transparent 60%)' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-card text-[#B7791F] shadow-sm ring-1 ring-line"><Wallet className="size-6" /></span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-ink">Cajas y presupuestos</h1>
            <p className="mt-0.5 text-sm text-muted">Tus fuentes de dinero forman el presupuesto consolidado; las subcajas reservan partes de él.</p>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-72"><PeriodPicker value={filters} today={today} onChange={p => setFilters({ ...filters, ...p })} /></div>
        <span className="text-[11px] text-muted">{formatDate(filters.desde)} – {formatDate(filters.hasta)} · {nf} fuente{nf === 1 ? '' : 's'} · {n} subcaja{n === 1 ? '' : 's'}</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="cajas-resumen">
        <Mini label="Presupuesto consolidado" value={c.presupuesto || c.origen === 'fuentes' ? money(c.presupuesto) : 'Sin definir'} />
        <Mini label="Reservado en subcajas" value={money(c.reservado)} tone="#6D5DD3" />
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

function CajaGeneral({ c, money, periodo, onAjustar }: { c: CajasResumen; money: (n: number) => string; periodo: string; onAjustar: () => void }) {
  const P = c.presupuesto
  const seg = (v: number) => `${P ? Math.max(0, Math.min(100, (v / P) * 100)) : 0}%`
  const reservaRestante = Math.max(0, c.reservado - c.gastadoSubcajas + c.excesoSubcajas)
  const tono = c.pct === null ? TONO.neutro : c.pct >= 100 ? TONO.alerta : c.pct >= 70 ? TONO.atencion : TONO.ok
  const fuentes = c.origen === 'fuentes'
  const def = P > 0 || fuentes
  const gastado = c.gastadoSubcajas + c.gastadoLibre
  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04),0_8px_24px_rgb(15_23_42/0.05)]" aria-label="Presupuesto consolidado" data-testid="caja-general">
      <div className="flex flex-wrap items-center gap-3 bg-[linear-gradient(120deg,#294690,#4F6FC8)] px-5 py-4 text-white">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/15"><Lock className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">Presupuesto consolidado</p>
          <p className="truncate text-xs text-white/75">{fuentes
            ? `Suma de ${c.fuentes.activas} fuente${c.fuentes.activas === 1 ? '' : 's'} activa${c.fuentes.activas === 1 ? '' : 's'}`
            : `Desde ${c.general?.nombre ?? 'la caja general'}`} · {periodo}. Las subcajas son parte de este dinero, no se suman.</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-white/75">Saldo libre actual</p>
          <p className="tabular text-2xl font-bold" data-testid="saldo-libre">{def ? money(c.saldoLibre) : 'Sin definir'}</p>
        </div>
        {c.general && !fuentes && <button type="button" onClick={onAjustar} className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 px-3 py-2 text-xs font-medium hover:bg-white/10"><Pencil className="size-3.5" /> Ajustar presupuesto</button>}
      </div>
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4" data-testid="consolidado">
        {([
          [fuentes ? 'Total fuentes' : 'Presupuesto', def ? money(P) : '—', undefined, fuentes ? 'Suma de lo que aportan las fuentes activas en el período.' : 'Monto total de la caja general en el período (suma los meses si abarca varios).'],
          ['Total gastado', money(gastado), '#E8664F', 'Todos los gastos activos del período, cada uno una sola vez.'],
          ['Disponible', def ? money(c.disponible) : '—', c.disponible < 0 ? TONO.alerta.fg : TONO.ok.fg, 'Presupuesto consolidado − total gastado.'],
          ['Reservado en subcajas', money(c.reservado), '#6D5DD3', 'Suma de lo asignado a las subcajas activas.'],
          ['Libre inicial', def ? money(c.libreInicial) : '—', undefined, 'Presupuesto − reservado: lo que no apartaste para ninguna subcaja.'],
          ['Gastado fuera de subcajas', money(c.gastadoLibre), '#E8664F', 'Gastos que no pertenecen a ninguna subcaja activa.'],
          ['Saldo libre actual', def ? money(c.saldoLibre) : '—', c.saldoLibre < 0 ? TONO.alerta.fg : TONO.ok.fg, 'Libre inicial − gastado fuera de subcajas − excesos de subcajas.'],
          ['Consumido', c.pct === null ? '—' : `${c.pct}%`, tono.fg, 'Todo lo gastado del período ÷ presupuesto.'],
        ] as const).map(([l, v, color, ayuda]) => (
          <div key={l} className="bg-card px-4 py-3" title={ayuda} data-testid={`cons-${l.toLowerCase().replace(/\s+/g, '-')}`}>
            <p className="text-[11px] text-muted">{l}</p>
            <p className="tabular text-sm font-bold" style={{ color: color ?? 'var(--ink)' }}>{v}</p>
          </div>
        ))}
      </div>
      {P > 0 && (
        <div className="px-5 py-4">
          <div className="flex h-3.5 overflow-hidden rounded-full bg-bg" role="img"
            aria-label={`Gastado fuera de subcajas ${money(c.gastadoLibre)}, gastado en subcajas ${money(c.gastadoSubcajas)}, reservas sin usar ${money(reservaRestante)}`}>
            <span className="bar-grow h-full bg-coral" style={{ width: seg(c.gastadoLibre) }} />
            <span className="bar-grow h-full bg-morado" style={{ width: seg(c.gastadoSubcajas) }} />
            <span className="bar-grow h-full bg-morado/25" style={{ width: seg(reservaRestante) }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-coral" /> Gastado fuera <b className="tabular text-ink">{money(c.gastadoLibre)}</b></span>
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-morado" /> Gastado en subcajas <b className="tabular text-ink">{money(c.gastadoSubcajas)}</b></span>
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-morado/25" /> Reservado sin usar <b className="tabular text-ink">{money(reservaRestante)}</b></span>
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-bg ring-1 ring-line" /> Libre</span>
          </div>
          {c.sobreasignado && <p className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }}><AlertTriangle className="size-4" /> Las reservas de subcajas ({money(c.reservado)}) superan el presupuesto consolidado.</p>}
        </div>
      )}
    </section>
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

function TarjetaCaja({ i, money, solapes, busy, acciones, onAjustar }: {
  i: Item; money: (n: number) => string; solapes?: string[]; busy: boolean; acciones: ReactNode; onAjustar: () => void
}) {
  const { caja, r } = i
  const color = caja.color || '#4F7BE8'
  const Icon = cajaIcon(caja)
  const AIcon = alcanceIcon(caja.filtroCampo)
  const e = estadoDe(i, money)
  const activa = cajaActiva(caja) && !!r
  return (
    <li className={`group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgb(15_23_42/0.07)] ${activa ? '' : 'opacity-75'}`}
      data-testid="caja" style={{ boxShadow: r?.excedido ? `inset 0 0 0 1.5px ${TONO.alerta.fg}55` : undefined }}>
      <span className="h-1.5" style={{ background: activa ? `linear-gradient(90deg, ${color}, ${color}99)` : 'var(--line)' }} aria-hidden />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
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

function ListaCajas({ items, money, solapes, pending, acciones }: {
  items: Item[]; money: (n: number) => string; solapes: Map<string, string[]>; pending: ReadonlySet<string>; acciones: (i: Item) => ReactNode
}) {
  return (
    <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line" aria-label="Lista de cajas">
      {items.map(i => {
        const { caja, r } = i
        const color = caja.color || '#4F7BE8'
        const Icon = cajaIcon(caja)
        const e = estadoDe(i, money)
        return (
          <li key={caja.id} data-testid="caja" className={`grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition hover:bg-bg/60 sm:grid-cols-[2.5rem_minmax(0,1.4fr)_minmax(0,1fr)_7rem_auto] ${cajaActiva(caja) ? '' : 'opacity-70'}`}>
            <span className="grid size-10 place-items-center rounded-xl" style={{ background: `${color}1A`, color }}><Icon className="size-4" /></span>
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-sm font-semibold">{caja.nombre}
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: e.tono.fg, background: e.tono.bg }}>{e.txt}</span>
                {pending.has(`caja:${caja.id}`) && <span className="text-[10px] font-normal text-muted">Guardando…</span>}</p>
              <p className="truncate text-[11px] text-muted">{alcanceTxt(caja)}{solapes.get(caja.id)?.length ? ` · comparte con ${resumirNombres(solapes.get(caja.id)!)}` : ''}</p>
            </div>
            <div className="order-last col-span-3 sm:order-none sm:col-span-1">
              {r ? (<>
                <span className="block h-1.5 overflow-hidden rounded-full bg-bg"><span className="bar-grow block h-full rounded-full" style={{ width: `${Math.min(r.pct ?? 0, 100)}%`, background: r.excedido ? TONO.alerta.fg : color }} /></span>
                <span className="tabular mt-1 block text-[11px] text-muted">{money(r.gastado)} de {r.asignado ? money(r.asignado) : '—'}</span>
              </>) : <span className="text-[11px] text-muted">Inactiva</span>}
            </div>
            <span className="tabular hidden text-right text-sm font-bold sm:block" style={{ color: r && r.disponible < 0 ? TONO.alerta.fg : 'var(--ink)' }}>{r?.asignado ? money(r.disponible) : '—'}</span>
            {acciones(i)}
          </li>
        )
      })}
    </ul>
  )
}

function Acciones({ caja, puedeOrdenar, first, last, onEdit, onUp, onDown, onToggle, onDelete }: {
  caja: Caja; puedeOrdenar: boolean; first: boolean; last: boolean; onEdit: () => void; onUp: () => void; onDown: () => void; onToggle: () => void; onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismiss(open, close)
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-bg disabled:opacity-40'
  const run = (fn: () => void) => () => { setOpen(false); fn() }
  return (
    <div ref={ref} className="relative flex shrink-0 items-center gap-1">
      <button type="button" aria-label={`Editar ${caja.nombre}`} onClick={onEdit} className="grid size-9 place-items-center rounded-xl text-muted transition hover:bg-bg hover:text-navy"><Pencil className="size-4" /></button>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Más acciones de ${caja.nombre}`} onClick={() => setOpen(o => !o)}
        className="grid size-9 place-items-center rounded-xl text-muted transition hover:bg-bg"><MoreHorizontal className="size-4" /></button>
      {open && (
        <div role="menu" className="absolute top-10 right-0 z-30 w-48 rounded-xl border border-line bg-card p-1 shadow-xl">
          <button role="menuitem" type="button" className={item} disabled={!puedeOrdenar || first} onClick={run(onUp)}><ArrowUp className="size-3.5 text-muted" /> Subir</button>
          <button role="menuitem" type="button" className={item} disabled={!puedeOrdenar || last} onClick={run(onDown)}><ArrowDown className="size-3.5 text-muted" /> Bajar</button>
          <button role="menuitem" type="button" className={item} onClick={run(onToggle)}><Power className="size-3.5 text-muted" /> {cajaActiva(caja) ? 'Desactivar' : 'Activar'}</button>
          <button role="menuitem" type="button" className={`${item} text-[#D2463C]`} onClick={run(onDelete)}><Trash2 className="size-3.5" /> Eliminar</button>
        </div>
      )}
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

function opcionesValor(campo: Alcance, catalogo: CatalogoItem[], medios: string[]): string[] {
  const vig = catalogo.filter(c => c.activo !== false)
  if (campo === 'Ámbito') return [...new Set(vig.map(c => c.ambito))]
  if (campo === 'Categoría') return otrosAlFinal([...new Set(vig.filter(c => c.categoria).map(c => c.categoria))].sort((a, b) => a.localeCompare(b)))
  if (campo === 'Subcategoría') return [...new Set(vig.filter(c => c.subcategoria).map(c => `${c.categoria} › ${c.subcategoria}`))].sort((a, b) => a.localeCompare(b))
  return medios
}

function CajaForm({ store, caja, cajas, catalogo, medios, onClose }: {
  store: AppStore; caja: Caja | null; cajas: Caja[]; catalogo: CatalogoItem[]; medios: string[]; onClose: () => void
}) {
  const editar = !!caja
  const [id] = useState(() => caja?.id ?? `caja-${crypto.randomUUID().slice(0, 8)}`)
  const [nombre, setNombre] = useState(caja?.nombre ?? '')
  const [color, setColor] = useState(caja?.color || COLORES[cajas.length % COLORES.length])
  const [monto, setMonto] = useState(caja ? String(caja.presupuesto) : '')
  const [campo, setCampo] = useState<Alcance>(caja && caja.filtroCampo !== 'Todos' ? caja.filtroCampo : 'Categoría')
  const [valor, setValor] = useState(caja?.filtroValor ?? '')
  const [descripcion, setDescripcion] = useState(caja?.descripcion ?? '')
  const [activo, setActivo] = useState(caja ? cajaActiva(caja) : true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const opciones = useMemo(() => {
    const xs = opcionesValor(campo, catalogo, medios)
    return valor && !xs.includes(valor) ? [valor, ...xs] : xs
  }, [campo, catalogo, medios, valor])
  const otras = cajas.filter(x => x.id !== id && x.filtroCampo !== 'Todos')
  const borrador: Caja = { id, nombre: nombre.trim() || 'Nueva caja', presupuesto: Number(monto) || 0, filtroCampo: campo, filtroValor: valor, color, orden: caja?.orden ?? 0, activo, descripcion }
  const solapes = valor && activo ? calcularSolapes([borrador, ...otras.filter(cajaActiva)], catalogo, medios).get(id) ?? [] : []
  const gana = (otro: string) => {
    const o = otras.find(x => x.nombre === otro)!
    const d = ESPECIFICIDAD[campo] - ESPECIFICIDAD[o.filtroCampo]
    return d > 0 ? 'esta caja' : d < 0 ? o.nombre : (borrador.orden || Infinity) <= o.orden ? 'esta caja' : o.nombre
  }

  function save() {
    const errs: Record<string, string> = {}
    const m = monto.trim()
    if (!nombre.trim()) errs.nombre = 'Escribe un nombre'
    if (!/^\d{1,9}([.,]\d{1,2})?$/.test(m) || Number(m.replace(',', '.')) < 0) errs.monto = 'Monto mayor o igual a 0, hasta 2 decimales'
    if (!valor) errs.valor = `Elige ${campo === 'Medio de pago' ? 'un medio de pago' : `un${campo === 'Categoría' || campo === 'Subcategoría' ? 'a' : ''} ${campo.toLowerCase()}`}`
    const dup = activo && otras.find(x => cajaActiva(x) && x.filtroCampo === campo && normName(x.filtroValor) === normName(valor))
    if (dup) errs.valor = `La caja “${dup.nombre}” ya usa ${campo} = ${valor}. Cambia el alcance o desactiva una de las dos.`
    setErrors(errs)
    if (Object.keys(errs).length) return
    const orden = caja?.orden ?? Math.max(1, ...cajas.map(x => x.orden)) + 1
    const data: Caja = { ...borrador, nombre: nombre.trim(), presupuesto: Math.round(Number(m.replace(',', '.')) * 100) / 100, orden, descripcion: descripcion.trim() }
    const ok = store.track(`caja:${id}`, editar
      ? { pending: `Guardando ${data.nombre}…`, ok: `${data.nombre} actualizada correctamente.`, error: `No se pudo actualizar ${data.nombre}.` }
      : { pending: `Creando ${data.nombre}…`, ok: `${data.nombre} creada correctamente.`, error: `No se pudo crear ${data.nombre}.` },
    () => store.actions.saveCaja(data))
    if (ok) onClose()
  }

  return (
    <Modal open onClose={onClose} size="md" title={editar ? `Editar ${caja!.nombre}` : 'Nueva caja'} icon={<Wallet className="size-5" />}
      subtitle="Una reserva dentro de tu presupuesto consolidado que junta sola los gastos de su alcance."
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save}>{editar ? 'Guardar cambios' : 'Crear caja'}</Button></>}>
      <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); save() }}>
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: `${color}14`, boxShadow: `inset 0 0 0 1px ${color}33` }}>
          {(() => { const I = cajaIcon(borrador); return <span className="grid size-11 place-items-center rounded-2xl bg-card" style={{ color }}><I className="size-5" /></span> })()}
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{borrador.nombre}</p><p className="truncate text-[11px] text-muted">{valor ? `${campo} · ${valor}` : 'Elige el alcance'}</p></div>
        </div>
        <Field label="Nombre" error={errors.nombre} htmlFor="caja-nombre">
          <input id="caja-nombre" className={inputCls} maxLength={40} placeholder="Ej. Caja Salud" value={nombre} onChange={e => setNombre(e.target.value)} />
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Color</p>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Color">
            {COLORES.map(c => (
              <button key={c} type="button" role="radio" aria-checked={color.toLowerCase() === c.toLowerCase()} aria-label={`Color ${c}`} onClick={() => setColor(c)}
                className="size-8 rounded-full ring-offset-2 ring-offset-card transition hover:scale-110" style={{ background: c, boxShadow: color.toLowerCase() === c.toLowerCase() ? `0 0 0 2px var(--card), 0 0 0 4px ${c}` : undefined }} />
            ))}
            <input type="color" aria-label="Otro color" value={color} onChange={e => setColor(e.target.value)} className="size-8 cursor-pointer rounded-full border border-line bg-card p-0.5" />
          </div>
        </div>
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
          <SelectField id="caja-valor" value={valor} onChange={setValor} invalid={!!errors.valor}>
            <option value="">Elige…</option>
            {opciones.map(o => <option key={o} value={o}>{o}</option>)}
          </SelectField>
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
          <input id="caja-desc" className={inputCls} maxLength={200} placeholder="Ej. Médico, farmacia y exámenes" value={descripcion} onChange={e => setDescripcion(e.target.value)} />
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

function BorrarCaja({ store, caja, onClose }: { store: AppStore; caja: Caja; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="sm" title="Eliminar caja" icon={<Trash2 className="size-5" />}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" onClick={() => {
          store.track(`caja:${caja.id}`, { pending: `Eliminando ${caja.nombre}…`, ok: `${caja.nombre} eliminada. Ningún gasto se borró.`, error: `No se pudo eliminar ${caja.nombre}.` },
            () => store.actions.deleteCaja(caja.id))
          onClose()
        }}><Trash2 className="size-4" /> Eliminar</Button></>}>
      <div className="space-y-2 text-sm">
        <p className="font-semibold">¿Eliminar “{caja.nombre}”?</p>
        <p className="text-muted">No se borra ningún gasto ni la caja general. Sus gastos pasarán a “gastado fuera de subcajas” (o a otra caja que coincida) y su reserva vuelve al libre de la caja general.</p>
        <p className="text-xs text-muted">Si solo quieres pausarla, desactívala desde el menú ⋯.</p>
      </div>
    </Modal>
  )
}
