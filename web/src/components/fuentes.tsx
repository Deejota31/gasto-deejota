import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, Banknote, BriefcaseBusiness, CalendarDays, CalendarRange, CircleDollarSign, Coins, CreditCard, Gift, HandCoins,
  Info, LayoutGrid, List, MoreHorizontal, Pencil, PiggyBank, Plus, Receipt, RotateCcw, Search, Sparkles, Star, Utensils, Wallet,
} from 'lucide-react'
import { fuenteMontoMes, type CajasResumen, type FuenteResumen } from '../lib/engine'
import { monthLabel } from '../lib/dates'
import { normName } from '../lib/orden'
import type { AppStore } from '../lib/store'
import type { Fuente, FuenteMes, Recurrencia } from '../lib/types'
import { Button, ErrorBox, Field, InfoTooltip, inputCls, Modal, Segmented, SelectField, Switch, useDismiss } from './ui'

/**
 * Fuentes de dinero (v1.8): General, Sodexo, Extra 1… Cada fuente activa suma su importe del mes al presupuesto
 * consolidado; desactivarla la conserva sin aportar. Todo pasa por el motor (`aggregate`): esta pantalla solo muestra
 * y edita, no calcula por su cuenta.
 */

const COLORES = ['#1E3A8A', '#16A085', '#84CC16', '#F59E0B', '#E8664F', '#8B7CF6', '#EC4899', '#0EA5E9', '#64748B', '#E25563']
const TONO = {
  ok: { fg: '#0F8A6B', bg: '#E7F7F2' }, atencion: { fg: '#B7791F', bg: '#FFF6DB' }, alerta: { fg: '#C0362C', bg: '#FDECEC' },
  info: { fg: '#4F6FC8', bg: '#EEF3FF' }, neutro: { fg: '#64748B', bg: 'var(--bg)' },
}
const ICONOS: [RegExp, typeof Wallet][] = [
  [/general|sueldo|salario|planilla/, Banknote], [/sodexo|aliment|vale/, Utensils], [/extra|adicional/, Sparkles], [/bono|bonific|aguinaldo|gratific|premio/, Gift],
  [/reembolso|devoluc/, RotateCcw], [/freelance|independiente|trabajo|comisi/, BriefcaseBusiness], [/ahorro|cts|interes|dividend/, PiggyBank],
  [/regalo/, HandCoins], [/venta|alquiler/, Receipt], [/tarjeta/, CreditCard],
]
export const fuenteIcon = (f: Pick<Fuente, 'nombre' | 'medioPago'>) => {
  const k = `${f.nombre} ${f.medioPago}`.toLowerCase()
  return ICONOS.find(([re]) => re.test(k))?.[1] ?? Coins
}
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const recurrenciaTxt = (f: Fuente) => f.recurrencia === 'unica' ? `Solo ${f.mes ? monthLabel(f.mes, true) : '—'}` : f.mes ? `Mensual desde ${monthLabel(f.mes, true)}` : 'Todos los meses'

export const FUENTE_GENERAL_ID = 'fuente-general'

export function FuentesSeccion({ store, c, mes, money, periodo, hoyMes }: {
  store: AppStore; c: CajasResumen; mes: string | null; money: (n: number) => string; periodo: string; hoyMes: string
}) {
  const data = store.data!
  const fuentes = c.fuentes.lista
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState<'todas' | 'activas' | 'inactivas'>('todas')
  const [vista, setVista] = useState<'grid' | 'lista'>('grid')
  const [verTodas, setVerTodas] = useState(false)
  const [form, setForm] = useState<{ fuente: Fuente | null; key: number } | null>(null)
  const [desactivar, setDesactivar] = useState<FuenteResumen | null>(null)
  const general = c.general
  const migrada = fuentes.some(r => r.fuente.id === FUENTE_GENERAL_ID)
  const puedeMigrar = !!general && general.presupuesto > 0 && !migrada && !fuentes.some(r => normName(r.fuente.nombre) === 'general')
  const muchas = fuentes.length > 4
  const term = normName(q)
  const visibles = fuentes
    .filter(r => estado === 'todas' || (estado === 'activas') === r.fuente.activo)
    .filter(r => !term || normName(`${r.fuente.nombre} ${r.fuente.medioPago}`).includes(term))
  const filtrando = !!term || estado !== 'todas'
  // Con muchas fuentes se ven las primeras 6 (o todas al buscar/filtrar o al pedirlo): la página no se vuelve eterna en el móvil.
  const LIMITE = 6
  const mostradas = filtrando || verTodas ? visibles : visibles.slice(0, LIMITE)
  const ids = fuentes.map(r => r.fuente.id)

  const abrir = (fuente: Fuente | null) => setForm({ fuente, key: Date.now() })
  const mover = (id: string, delta: number) => {
    const xs = [...ids]
    const i = xs.indexOf(id), j = i + delta
    if (i < 0 || j < 0 || j >= xs.length) return
    ;[xs[i], xs[j]] = [xs[j], xs[i]]
    store.track('fuentes:orden', { pending: 'Guardando el orden…', ok: 'Orden de fuentes guardado.', error: 'No se pudo guardar el orden de las fuentes. Se restauró el anterior.' },
      () => store.actions.reorderFuentes(xs), { retry: false })
  }
  const guardarEstado = (f: Fuente, on: boolean) => store.track(`fuente:${f.id}`,
    { pending: on ? `Activando ${f.nombre}…` : `Desactivando ${f.nombre}…`, ok: `${f.nombre} ${on ? 'activada: vuelve a sumar al presupuesto' : 'desactivada: ya no suma al presupuesto. No se borró nada'}.`, error: `No se pudo ${on ? 'activar' : 'desactivar'} ${f.nombre}.` },
    () => store.actions.saveFuente({ ...f, activo: on }))
  // Antes de apagar una fuente que aporta o tiene gastos atribuidos se muestra el impacto; encender es directo.
  const alternar = (r: FuenteResumen) => {
    if (r.fuente.activo && (r.aporta > 0 || r.count > 0)) setDesactivar(r)
    else guardarEstado(r.fuente, !r.fuente.activo)
  }
  const migrar = () => store.track('fuentes:migrar', { pending: 'Creando la fuente General desde la caja general (con respaldo previo)…', ok: 'Fuente General creada con el presupuesto y los ajustes mensuales de la caja general.', error: 'No se pudo crear la fuente General.' },
    () => store.actions.migrarGeneralAFuente())

  return (
    <section className="rounded-3xl border border-line bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_8px_24px_rgb(15_23_42/0.04)] sm:p-5" aria-label="Fuentes de dinero">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <span className="grid size-8 place-items-center rounded-xl" style={{ background: '#E7F7F2', color: '#0F8A6B' }}><CircleDollarSign className="size-4" /></span>
            Fuentes de dinero <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-semibold text-muted" data-testid="n-fuentes">{fuentes.length}</span>
            <InfoTooltip title="Cómo suman las fuentes" align="left">
              <p>El <b>presupuesto consolidado</b> es la suma de lo que aporta cada fuente <b>activa</b> en el período. Las reservas no suman: reparten ese mismo dinero.</p>
              <p>Una fuente mensual aporta todos los meses (desde su mes de aplicación); una de un solo mes, por ejemplo un ingreso extra, solo en ese mes y no se arrastra.</p>
              <p>Cambiar el importe de un mes no toca los demás. Desactivar no borra la fuente ni ningún gasto.</p>
              <p>Cada gasto se atribuye a una sola fuente: la que tiene asociado su medio de pago (p. ej. Sodexo) o, si no, la fuente principal.</p>
            </InfoTooltip>
          </h2>
          <p className="mt-0.5 text-xs text-muted">{c.origen === 'fuentes'
            ? `${c.fuentes.activas} activa${c.fuentes.activas === 1 ? '' : 's'} · aportan ${money(c.fuentes.total)} en ${periodo}`
            : 'Aún no tienes fuentes: el presupuesto sale de la caja general.'}</p>
        </div>
        <Button onClick={() => abrir(null)}><Plus className="size-4" /> Nueva fuente</Button>
      </div>

      {c.origen === 'caja-general' && (
        <div className="mb-4 rounded-2xl px-4 py-3 text-sm" style={{ background: TONO.info.bg, color: TONO.info.fg }} data-testid="sin-fuentes">
          <p className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0" />
            <span>Hoy tu presupuesto es el de la caja general{general && general.presupuesto > 0 ? ` (${money(Math.round(general.presupuesto * 100))} al mes)` : ''}. Con fuentes puedes separar de dónde viene el dinero (General, Sodexo, un extra…) y sumarlo por mes.</span></p>
          {puedeMigrar && <p className="mt-2 text-xs">Te recomendamos empezar creando la fuente <b>General</b> con ese importe y sus ajustes mensuales, así ningún mes cambia. Se hace un respaldo antes.</p>}
          <p className="mt-1 text-xs opacity-90">Sodexo no se convierte sola en fuente: si su dinero no está incluido en tu presupuesto general, créala tú; tu caja Sodexo seguirá como reserva.</p>
          {puedeMigrar && <div className="mt-2"><Button variant="soft" className="h-9 text-xs" disabled={store.pending.has('fuentes:migrar')} onClick={migrar}><Banknote className="size-3.5" /> Crear fuente General con {money(Math.round(general!.presupuesto * 100))}</Button></div>}
        </div>
      )}
      {c.origen === 'fuentes' && puedeMigrar && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-xs" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }} data-testid="aviso-general">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">El presupuesto ya es la suma de fuentes: la caja general ({money(Math.round(general!.presupuesto * 100))}/mes) dejó de sumar. Si ese dinero sigue siendo tuyo, pásalo a una fuente.</span>
          <Button variant="outline" className="h-8 text-xs" disabled={store.pending.has('fuentes:migrar')} onClick={migrar}>Crear fuente General</Button>
        </div>
      )}

      {muchas && (
        <div className="mb-3 grid gap-2 rounded-2xl bg-bg/70 p-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input aria-label="Buscar fuente" className={`${inputCls} h-11 pl-9`} placeholder="Buscar fuente…" value={q} onChange={e => setQ(e.target.value)} />
          </label>
          <div className="w-full sm:w-36"><SelectField label="Filtrar fuentes por estado" value={estado} onChange={v => setEstado(v as typeof estado)}>
            <option value="todas">Todas</option><option value="activas">Activas</option><option value="inactivas">Inactivas</option>
          </SelectField></div>
          <div className="flex items-center gap-1 rounded-xl bg-card p-1 ring-1 ring-line" role="radiogroup" aria-label="Vista de fuentes">
            {([['grid', LayoutGrid, 'Tarjetas'], ['lista', List, 'Lista']] as const).map(([v, Icon, l]) => (
              <button key={v} type="button" role="radio" aria-checked={vista === v} aria-label={l} title={l} onClick={() => setVista(v)}
                className={`grid size-9 place-items-center rounded-lg transition ${vista === v ? 'bg-primary-soft text-navy' : 'text-muted hover:bg-bg'}`}><Icon className="size-4" /></button>
            ))}
          </div>
        </div>
      )}

      {fuentes.length > 0 && !visibles.length ? (
        <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">Ninguna fuente coincide. <button className="font-semibold text-navy underline" onClick={() => { setQ(''); setEstado('todas') }}>Limpiar filtros</button></div>
      ) : fuentes.length > 0 && (vista === 'grid' || !muchas ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Lista de fuentes">
          {mostradas.map(r => <TarjetaFuente key={r.fuente.id} r={r} money={money} mes={mes} busy={store.pending.has(`fuente:${r.fuente.id}`)} onToggle={() => alternar(r)}
            acciones={<AccionesFuente f={r.fuente} puedeOrdenar={!filtrando} first={ids[0] === r.fuente.id} last={ids.at(-1) === r.fuente.id}
              onEdit={() => abrir(r.fuente)} onUp={() => mover(r.fuente.id, -1)} onDown={() => mover(r.fuente.id, 1)} />} />)}
        </ul>
      ) : (
        <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line" aria-label="Lista de fuentes">
          {mostradas.map(r => <FilaFuente key={r.fuente.id} r={r} money={money} busy={store.pending.has(`fuente:${r.fuente.id}`)} onToggle={() => alternar(r)}
            acciones={<AccionesFuente f={r.fuente} puedeOrdenar={!filtrando} first={ids[0] === r.fuente.id} last={ids.at(-1) === r.fuente.id}
              onEdit={() => abrir(r.fuente)} onUp={() => mover(r.fuente.id, -1)} onDown={() => mover(r.fuente.id, 1)} />} />)}
        </ul>
      ))}

      {!filtrando && visibles.length > LIMITE && (
        <div className="mt-3 flex justify-center">
          <Button variant="ghost" className="text-xs" onClick={() => setVerTodas(v => !v)}>{verTodas ? 'Mostrar menos' : `Ver las ${visibles.length} fuentes`}</Button>
        </div>
      )}
      {(c.fuentes.countInactivas > 0 || c.fuentes.countSinFuente > 0) && (
        <div className="mt-3 space-y-1 rounded-2xl px-4 py-3 text-xs" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }} data-testid="conciliacion-fuentes">
          <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" /> Conciliación de fuentes</p>
          {c.fuentes.countInactivas > 0 && <p>{c.fuentes.countInactivas} gasto(s) por {money(c.fuentes.gastadoInactivas)} se pagaron con el medio de una fuente inactiva. Siguen descontando del presupuesto consolidado y no se pasaron a otra fuente.</p>}
          {c.fuentes.countSinFuente > 0 && <p>{c.fuentes.countSinFuente} gasto(s) por {money(c.fuentes.gastadoSinFuente)} no tienen una fuente activa a la cual atribuirse (no hay fuente principal activa). También descuentan del presupuesto.</p>}
        </div>
      )}

      {form && <FuenteForm key={form.key} store={store} fuente={form.fuente} fuentes={fuentes.map(r => r.fuente)} meses={data.fuentesMeses ?? []} mes={mes} hoyMes={hoyMes}
        monedas={monedasDe(data.config)} medios={data.medios.map(m => m.nombre)} primera={c.origen === 'caja-general'} general={general ? Math.round(general.presupuesto * 100) : 0} money={money} onClose={() => setForm(null)} />}
      {desactivar && <DesactivarFuente r={desactivar} c={c} money={money} periodo={periodo} onClose={() => setDesactivar(null)}
        onConfirm={() => { guardarEstado(desactivar.fuente, false); setDesactivar(null) }} />}
    </section>
  )
}

export const monedasDe = (config: Record<string, string>) => [...new Set([config.moneda || 'PEN', ...String(config.monedas ?? '').split(',').map(x => x.trim()).filter(Boolean)])]

function estadoFuente(r: FuenteResumen) {
  if (!r.fuente.activo) return { txt: 'Inactiva', tono: TONO.neutro }
  if (r.sinTipoCambio) return { txt: 'Sin tipo de cambio', tono: TONO.alerta }
  if (!r.asignado) return { txt: 'Sin importe en el período', tono: TONO.neutro }
  if (r.aporta && r.gastado > r.aporta) return { txt: 'Excedida', tono: TONO.alerta }
  return { txt: 'Activa', tono: TONO.ok }
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={on ? 'Activa: suma al presupuesto' : 'Inactiva: no suma'} disabled={disabled} onClick={onChange}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-1 py-1 text-[11px] font-bold disabled:opacity-50">
      <span className={`relative h-5 w-9 rounded-full transition ${on ? 'bg-[#0F8A6B]' : 'bg-line'}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      <span className={on ? 'text-[#0F8A6B]' : 'text-muted'}>{on ? 'ON' : 'OFF'}</span>
    </button>
  )
}

function Badges({ r }: { r: FuenteResumen }) {
  const e = estadoFuente(r)
  const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold'
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={chip} style={{ color: e.tono.fg, background: e.tono.bg }} data-testid="estado-fuente">{e.txt}</span>
      {r.principal && <span className={chip} style={{ color: TONO.info.fg, background: TONO.info.bg }} title="Recibe los gastos que no tienen una fuente por medio de pago"><Star className="size-2.5" /> Principal</span>}
      {r.fuente.medioPago && <span className={chip} style={{ color: '#4D7C0F', background: '#F0F9E0' }} title={`Los gastos pagados con ${r.fuente.medioPago} se atribuyen a esta fuente`}><CreditCard className="size-2.5" /> {r.fuente.medioPago}</span>}
      {r.ajustado && <span className={chip} style={{ color: TONO.atencion.fg, background: TONO.atencion.bg }} title="Este período tiene un importe propio">Ajustado</span>}
    </span>
  )
}

function TarjetaFuente({ r, money, mes, busy, onToggle, acciones }: { r: FuenteResumen; money: (n: number) => string; mes: string | null; busy: boolean; onToggle: () => void; acciones: ReactNode }) {
  const f = r.fuente
  const Icon = fuenteIcon(f)
  const color = f.color || '#1E3A8A'
  const pct = r.pct ?? 0
  return (
    <li className={`relative flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgb(15_23_42/0.07)] ${f.activo ? '' : 'opacity-75'}`} data-testid="fuente">
      <span className="h-1.5" style={{ background: f.activo ? `linear-gradient(90deg, ${color}, ${color}99)` : 'var(--line)' }} aria-hidden />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: `${color}1A`, color }}><Icon className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink" data-testid="fuente-nombre">{f.nombre}</p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted">{f.recurrencia === 'unica' ? <CalendarDays className="size-3 shrink-0" /> : <CalendarRange className="size-3 shrink-0" />}{recurrenciaTxt(f)}{f.moneda !== 'PEN' ? ` · ${f.moneda}` : ''}</p>
          </div>
          {acciones}
        </div>
        <div className="mt-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] text-muted">{mes ? `Aporta en ${monthLabel(mes, true)}` : 'Aporta en el período'}</p>
            <p className={`tabular truncate text-xl font-bold ${f.activo ? 'text-ink' : 'text-muted line-through decoration-1'}`} data-testid="fuente-aporte">{money(r.asignado)}</p>
          </div>
          <Toggle on={f.activo} onChange={onToggle} label={`${f.activo ? 'Desactivar' : 'Activar'} ${f.nombre}`} disabled={busy} />
        </div>
        <div className="mt-2"><Badges r={r} /></div>
        {f.activo && r.aporta > 0 && (
          <>
            <div className="mt-3 flex items-center gap-2">
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-bg" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Usado de ${f.nombre}`}>
                <span className="bar-grow block h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: r.gastado > r.aporta ? TONO.alerta.fg : color }} />
              </span>
              <span className="tabular w-12 text-right text-xs font-bold">{r.pct === null ? '—' : `${r.pct}%`}</span>
            </div>
            <p className="tabular mt-1 text-[11px] text-muted">Gastado {money(r.gastado)} · disponible <b style={{ color: r.disponible < 0 ? TONO.alerta.fg : TONO.ok.fg }}>{money(r.disponible)}</b> · {r.count} mov.</p>
          </>
        )}
        {!f.activo && <p className="mt-3 rounded-xl bg-bg px-3 py-2 text-[11px] text-muted">Inactiva: queda guardada pero no suma al presupuesto.{r.count ? ` Sus ${r.count} gasto(s) siguen descontando (ver conciliación).` : ''}</p>}
        {busy && <p className="mt-2 text-[11px] text-muted">Guardando…</p>}
      </div>
    </li>
  )
}

function FilaFuente({ r, money, busy, onToggle, acciones }: { r: FuenteResumen; money: (n: number) => string; busy: boolean; onToggle: () => void; acciones: ReactNode }) {
  const f = r.fuente
  const Icon = fuenteIcon(f)
  const color = f.color || '#1E3A8A'
  return (
    <li data-testid="fuente" className={`grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition hover:bg-bg/60 sm:grid-cols-[2.5rem_minmax(0,1.4fr)_minmax(0,1fr)_7rem_auto_auto] ${f.activo ? '' : 'opacity-70'}`}>
      <span className="grid size-10 place-items-center rounded-xl" style={{ background: `${color}1A`, color }}><Icon className="size-4" /></span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold" data-testid="fuente-nombre">{f.nombre}{busy && <span className="ml-2 text-[10px] font-normal text-muted">Guardando…</span>}</p>
        <p className="truncate text-[11px] text-muted">{recurrenciaTxt(f)}</p>
      </div>
      <div className="order-last col-span-3 sm:order-none sm:col-span-1"><Badges r={r} /></div>
      <span className="tabular hidden text-right text-sm font-bold sm:block" data-testid="fuente-aporte">{money(r.asignado)}</span>
      <Toggle on={f.activo} onChange={onToggle} label={`${f.activo ? 'Desactivar' : 'Activar'} ${f.nombre}`} disabled={busy} />
      {acciones}
    </li>
  )
}

function AccionesFuente({ f, puedeOrdenar, first, last, onEdit, onUp, onDown }: {
  f: Fuente; puedeOrdenar: boolean; first: boolean; last: boolean; onEdit: () => void; onUp: () => void; onDown: () => void
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismiss(open, close)
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-bg disabled:opacity-40'
  const run = (fn: () => void) => () => { setOpen(false); fn() }
  return (
    <div ref={ref} className="relative flex shrink-0 items-center gap-1">
      <button type="button" aria-label={`Editar fuente ${f.nombre}`} title="Editar" onClick={onEdit} className="grid size-9 place-items-center rounded-xl text-muted transition hover:bg-bg hover:text-navy"><Pencil className="size-4" /></button>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Más acciones de la fuente ${f.nombre}`} onClick={() => setOpen(o => !o)}
        className="grid size-9 place-items-center rounded-xl text-muted transition hover:bg-bg"><MoreHorizontal className="size-4" /></button>
      {open && (
        <div role="menu" className="absolute top-10 right-0 z-30 w-44 rounded-xl border border-line bg-card p-1 shadow-xl">
          <button role="menuitem" type="button" className={item} disabled={!puedeOrdenar || first} onClick={run(onUp)}><ArrowUp className="size-3.5 text-muted" /> Subir</button>
          <button role="menuitem" type="button" className={item} disabled={!puedeOrdenar || last} onClick={run(onDown)}><ArrowDown className="size-3.5 text-muted" /> Bajar</button>
        </div>
      )}
    </div>
  )
}

function DesactivarFuente({ r, c, money, periodo, onClose, onConfirm }: { r: FuenteResumen; c: CajasResumen; money: (n: number) => string; periodo: string; onClose: () => void; onConfirm: () => void }) {
  const P2 = c.presupuesto - r.aporta
  const gastado = c.gastadoSubcajas + c.gastadoLibre
  return (
    <Modal open onClose={onClose} size="sm" title={`Desactivar ${r.fuente.nombre}`} icon={<AlertTriangle className="size-5" />}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={onConfirm}>Desactivar</Button></>}>
      <div className="space-y-3 text-sm" data-testid="impacto-desactivar">
        <p>En {periodo} el presupuesto consolidado pasará de <b className="tabular">{money(c.presupuesto)}</b> a <b className="tabular">{money(P2)}</b>, y el disponible de <b className="tabular">{money(c.presupuesto - gastado)}</b> a <b className="tabular">{money(P2 - gastado)}</b>.</p>
        {r.count > 0 && <p className="rounded-xl px-3 py-2 text-xs" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }}>
          {r.count} gasto(s) por {money(r.gastado)} están atribuidos a esta fuente. {r.fuente.medioPago
            ? `Los pagados con ${r.fuente.medioPago} seguirán descontando del presupuesto y se mostrarán en una conciliación aparte: no se pasan a otra fuente.`
            : 'Pasarán a la siguiente fuente principal activa (si no hay, se mostrarán como “sin fuente”). Siguen descontando del presupuesto.'}</p>}
        <p className="text-xs text-muted">No se borra la fuente, ni sus importes por mes, ni ningún gasto. Puedes reactivarla cuando quieras.</p>
      </div>
    </Modal>
  )
}

/* ============================== Crear / editar ============================== */

function FuenteForm({ store, fuente, fuentes, meses, mes, hoyMes, monedas, medios, primera, general, money, onClose }: {
  store: AppStore; fuente: Fuente | null; fuentes: Fuente[]; meses: FuenteMes[]; mes: string | null; hoyMes: string; monedas: string[]; medios: string[]
  primera: boolean; general: number; money: (n: number) => string; onClose: () => void
}) {
  const editar = !!fuente
  // ID fijo mientras el formulario está abierto: guardar dos veces (doble clic, reintento) actualiza la misma fuente.
  const [id] = useState(() => fuente?.id ?? `f-${crypto.randomUUID().slice(0, 12)}`)
  const mesRef = mes ?? hoyMes
  const [nombre, setNombre] = useState(fuente?.nombre ?? '')
  const [color, setColor] = useState(fuente?.color || COLORES[(fuentes.length + 1) % COLORES.length])
  const [moneda, setMoneda] = useState(fuente?.moneda ?? monedas[0] ?? 'PEN')
  const [recurrencia, setRecurrencia] = useState<Recurrencia>(fuente?.recurrencia ?? 'mensual')
  const [mesAplic, setMesAplic] = useState(fuente ? fuente.mes : mesRef)
  const [medio, setMedio] = useState(fuente?.medioPago ?? '')
  const [activo, setActivo] = useState(fuente?.activo ?? true)
  // Importe: al crear es el importe base; al editar es el del mes elegido (solo ese mes o desde ese mes).
  const actualMes = fuente && mes ? fuenteMontoMes(fuente, mes, meses) : null
  const [monto, setMonto] = useState(fuente ? String(actualMes ? actualMes.monto : fuente.monto) : '')
  const [modo, setModo] = useState<'solo' | 'desde'>('solo')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const tieneSolo = !!fuente && !!mes && meses.some(m => m.fuenteId === fuente.id && m.mes === mes && m.modo === 'solo')
  const esMesBase = !!fuente && fuente.recurrencia === 'unica' && recurrencia === 'unica' && mes === mesAplic
  const otras = fuentes.filter(f => f.id !== id)
  const Icon = fuenteIcon({ nombre: nombre || 'Fuente', medioPago: medio })
  const mediosOpc = useMemo(() => [...new Set([...(medio ? [medio] : []), ...medios])], [medio, medios])

  function save() {
    const errs: Record<string, string> = {}
    const m = monto.trim().replace(',', '.')
    if (!nombre.trim()) errs.nombre = 'Escribe un nombre'
    else if (otras.some(f => normName(f.nombre) === normName(nombre))) errs.nombre = 'Ya tienes una fuente con ese nombre'
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(m)) errs.monto = 'Monto mayor o igual a 0, hasta 2 decimales'
    if (!monedas.includes(moneda)) errs.moneda = 'Moneda no permitida'
    if (recurrencia === 'unica' && !MES_RE.test(mesAplic)) errs.mes = 'Elige el mes de aplicación'
    if (mesAplic && !MES_RE.test(mesAplic)) errs.mes = 'Mes inválido'
    const dupMedio = medio && activo && otras.find(f => f.activo && normName(f.medioPago) === normName(medio))
    if (dupMedio) errs.medio = `La fuente “${dupMedio.nombre}” ya usa ${medio}`
    if (editar && !mes && Number(m) !== fuente!.monto && !esMesBase) errs.monto = 'Para cambiar un importe, elige un único mes en el período.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const n = Math.round(Number(m) * 100) / 100
    const cambiaImporteMes = editar && !!mes && !esMesBase && actualMes !== null && n !== actualMes.monto
    const orden = fuente?.orden ?? Math.max(0, ...fuentes.map(f => f.orden)) + 1
    const base = { id, nombre: nombre.trim(), monto: editar && !esMesBase ? fuente!.monto : n, moneda, color, icono: fuente?.icono ?? '', activo, orden, recurrencia, mes: mesAplic, medioPago: medio }
    const cambiaConfig = !editar || JSON.stringify({ ...fuente, creadoEn: undefined, actualizadoEn: undefined }) !== JSON.stringify({ ...fuente, ...base, creadoEn: undefined, actualizadoEn: undefined })
    const msgMes = cambiaImporteMes ? (modo === 'desde' ? ` Importe desde ${monthLabel(mes!, true)}: ${money(Math.round(n * 100))}.` : ` Importe de ${monthLabel(mes!, true)}: ${money(Math.round(n * 100))}.`) : ''
    const ok = store.track(`fuente:${id}`, editar
      ? { pending: `Guardando ${base.nombre}…`, ok: `${base.nombre} actualizada.${msgMes}`, error: `No se pudo actualizar ${base.nombre}.` }
      : { pending: `Creando ${base.nombre}…`, ok: `${base.nombre} creada: suma ${money(Math.round(n * 100))} ${recurrencia === 'unica' ? `en ${monthLabel(mesAplic, true)}` : 'al mes'}.`, error: `No se pudo crear ${base.nombre}.` },
    async () => {
      if (cambiaConfig) await store.actions.saveFuente(base)
      if (cambiaImporteMes) await store.actions.saveFuenteMes({ fuenteId: id, mes: mes!, monto: n, modo: recurrencia === 'unica' ? 'solo' : modo })
    })
    if (ok) onClose()
  }
  function quitarAjuste() {
    const ok = store.track(`fuente:${id}`, { pending: 'Quitando el ajuste…', ok: `${fuente!.nombre}: ${monthLabel(mes!, true)} vuelve a su importe habitual.`, error: 'No se pudo quitar el ajuste.' },
      () => store.actions.saveFuenteMes({ fuenteId: id, mes: mes!, monto: 0, modo: 'solo' }, true))
    if (ok) onClose()
  }

  return (
    <Modal open onClose={onClose} size="md" title={editar ? `Editar ${fuente!.nombre}` : 'Nueva fuente'} icon={<CircleDollarSign className="size-5" />}
      subtitle="Dinero que suma a tu presupuesto consolidado. No crea gastos ni ingresos contables."
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save}>{editar ? 'Guardar cambios' : 'Crear fuente'}</Button></>}>
      <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); save() }}>
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: `${color}14`, boxShadow: `inset 0 0 0 1px ${color}33` }}>
          <span className="grid size-11 place-items-center rounded-2xl bg-card" style={{ color }}><Icon className="size-5" /></span>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{nombre.trim() || 'Nueva fuente'}</p>
            <p className="truncate text-[11px] text-muted">{recurrencia === 'unica' ? `Solo ${MES_RE.test(mesAplic) ? monthLabel(mesAplic, true) : '—'}` : mesAplic ? `Todos los meses desde ${monthLabel(mesAplic, true)}` : 'Todos los meses'}</p></div>
        </div>
        {primera && !editar && general > 0 && (
          <ErrorBox tone="warning" message={`Es tu primera fuente: desde ahora el presupuesto será la suma de fuentes y la caja general (${money(general)}/mes) deja de sumar. Si ese dinero sigue disponible, crea primero la fuente General desde el aviso de la pestaña.`} />
        )}
        <Field label="Nombre de la fuente" error={errors.nombre} htmlFor="fuente-nombre">
          <input id="fuente-nombre" className={inputCls} maxLength={40} placeholder="Ej. Extra 1, Bonificación, Reembolso" value={nombre} onChange={e => setNombre(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Field label={editar && !esMesBase ? (mes ? `Importe de ${monthLabel(mes, true)}` : 'Importe') : 'Monto'} error={errors.monto} htmlFor="fuente-monto"
            hint={editar && !esMesBase ? (mes ? 'Solo cambia el mes elegido (o desde ese mes); los meses anteriores no se tocan.' : 'Elige un único mes en el período para cambiar un importe.') : undefined}>
            <input id="fuente-monto" className={`${inputCls} tabular h-11 text-base font-semibold`} inputMode="decimal" placeholder="0.00" value={monto} onChange={e => setMonto(e.target.value.replace(/[^\d.,]/g, ''))} />
          </Field>
          <Field label="Moneda" error={errors.moneda} htmlFor="fuente-moneda">
            <SelectField id="fuente-moneda" value={moneda} onChange={setMoneda}>{monedas.map(x => <option key={x} value={x}>{x}</option>)}</SelectField>
          </Field>
        </div>
        {editar && mes && !esMesBase && recurrencia === 'mensual' && (
          <Segmented label="Aplicar el importe" value={modo} onChange={setModo}
            options={[{ value: 'solo', label: `Solo ${monthLabel(mes, true)}` }, { value: 'desde', label: `Desde ${monthLabel(mes, true)} en adelante` }]} />
        )}
        {tieneSolo && <button type="button" className="text-xs font-semibold text-navy underline" onClick={quitarAjuste}>Quitar el ajuste de {monthLabel(mes!, true)} (vuelve al importe habitual)</button>}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">¿Cuándo suma?</p>
          <Segmented label="Recurrencia" value={recurrencia} onChange={v => { setRecurrencia(v); if (v === 'unica' && !mesAplic) setMesAplic(mesRef) }}
            options={[{ value: 'mensual', label: 'Todos los meses' }, { value: 'unica', label: 'Solo un mes' }]} />
          <p className="mt-1 text-[11px] text-muted">{recurrencia === 'unica' ? 'Ideal para un ingreso extraordinario: no se arrastra a otros meses.' : 'Fuente habitual: suma su importe cada mes desde el mes de aplicación.'}</p>
        </div>
        <Field label={recurrencia === 'unica' ? 'Mes de aplicación' : 'Mes de aplicación (desde)'} error={errors.mes} htmlFor="fuente-mes"
          hint={recurrencia === 'mensual' && !mesAplic ? 'Sin mes: suma en todos los meses, también los anteriores.' : undefined}>
          <span className="flex items-center gap-2">
            <input id="fuente-mes" type="month" className={`${inputCls} h-11`} value={mesAplic} onChange={e => setMesAplic(e.target.value)} />
            {recurrencia === 'mensual' && mesAplic && <button type="button" className="shrink-0 text-xs text-muted underline" onClick={() => setMesAplic('')}>Todos</button>}
          </span>
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Color</p>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Color de la fuente">
            {COLORES.map(c => (
              <button key={c} type="button" role="radio" aria-checked={color.toLowerCase() === c.toLowerCase()} aria-label={`Color ${c}`} onClick={() => setColor(c)}
                className="size-8 rounded-full transition hover:scale-110" style={{ background: c, boxShadow: color.toLowerCase() === c.toLowerCase() ? `0 0 0 2px var(--card), 0 0 0 4px ${c}` : undefined }} />
            ))}
          </div>
        </div>
        <Field label="Medio de pago asociado (opcional)" error={errors.medio} htmlFor="fuente-medio" hint="Ej. Sodexo: los gastos pagados con ese medio se atribuyen a esta fuente. No cambia ningún gasto.">
          <SelectField id="fuente-medio" value={medio} onChange={setMedio}>
            <option value="">Ninguno (fuente libre)</option>
            {mediosOpc.map(x => <option key={x} value={x}>{x}</option>)}
          </SelectField>
        </Field>
        <div className="rounded-xl border border-line p-3">
          <Switch checked={activo} onChange={setActivo} label="Fuente activa" />
          <p className="mt-1 text-[11px] text-muted">Inactiva: queda guardada pero no suma al presupuesto.</p>
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
