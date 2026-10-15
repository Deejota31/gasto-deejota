import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, Banknote, CalendarDays, CalendarRange, CircleDollarSign, CreditCard,
  Copy, FilePlus2, Info, LayoutGrid, List, Pencil, Search, Star, Trash2, X,
} from 'lucide-react'
import { fuenteMontoMes, type CajasResumen, type FuenteResumen } from '../lib/engine'
import { monthLabel, todayIn } from '../lib/dates'
import { normName } from '../lib/orden'
import { fuenteLook, medioLook } from '../lib/visual'
import type { AppStore } from '../lib/store'
import type { AppData, Fuente, FuenteMes, Recurrencia } from '../lib/types'
import { dependenciasFuente } from '../lib/dependencias'
import { MenuAcciones, type AccionMenu } from './MenuAcciones'
import { BotonEditar, BotonMensual, BotonNuevo, Button, ErrorBox, Field, InfoTooltip, inputCls, Modal, Segmented, SelectField, Switch } from './ui'
import { Combobox } from './Combobox'
import { MonthPicker } from './DatePicker'
import { AsaOrden, AvisoOrden, CLASE_ARRASTRE, useReorden } from './reorden'
import { guardarPref, leerPref } from '../lib/prefs'
import { SwipeFila, useEsMovil } from './swipe'
import type { usePlantillasFin } from './PlantillasFin'
import { mediosDeFuente, unirMedios } from '../lib/fuenteMedios'

const NINGUNO = '__ninguno__'

/**
 * Fuentes de dinero (v1.8): General, Sodexo, Extra 1… Cada fuente activa suma su importe del mes al presupuesto
 * consolidado; desactivarla la conserva sin aportar. Todo pasa por el motor (`aggregate`): esta pantalla solo muestra
 * y edita, no calcula por su cuenta.
 */

const TONO = {
  ok: { fg: 'var(--success)', bg: 'var(--success-soft)' }, atencion: { fg: 'var(--warning)', bg: 'var(--warning-soft)' }, alerta: { fg: 'var(--danger)', bg: 'var(--danger-soft)' },
  info: { fg: '#4F6FC8', bg: '#EEF3FF' }, neutro: { fg: '#64748B', bg: 'var(--bg)' },
}
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const recurrenciaTxt = (f: Fuente) => f.recurrencia === 'unica' ? `Solo ${f.mes ? monthLabel(f.mes, true) : '—'}` : f.mes ? `Mensual desde ${monthLabel(f.mes, true)}` : 'Todos los meses'

export const FUENTE_GENERAL_ID = 'fuente-general'

export function FuentesSeccion({ store, c, mes, money, periodo, hoyMes, plantillas }: {
  plantillas: ReturnType<typeof usePlantillasFin>; store: AppStore; c: CajasResumen; mes: string | null; money: (n: number) => string; periodo: string; hoyMes: string
}) {
  const data = store.data!
  const fuentes = c.fuentes.lista
  const todas = useMemo(() => fuentes.map(r => r.fuente), [fuentes])
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState<'todas' | 'activas' | 'inactivas'>('todas')
  const [vista, setVistaState] = useState<'grid' | 'lista'>(() => leerPref('deejota.vista.fuentes', ['grid', 'lista'] as const, 'lista'))
  const setVista = (v: 'grid' | 'lista') => { setVistaState(v); guardarPref('deejota.vista.fuentes', v) }
  const [verTodas, setVerTodas] = useState(false)
  const [form, setForm] = useState<{ fuente: Fuente | null; clonDe?: Fuente | null; key: number } | null>(null)
  const [borrar, setBorrar] = useState<FuenteResumen | null>(null)
  const [desactivar, setDesactivar] = useState<FuenteResumen | null>(null)
  const general = c.general
  const migrada = fuentes.some(r => r.fuente.id === FUENTE_GENERAL_ID)
  const puedeMigrar = !!general && general.presupuesto > 0 && !migrada && !fuentes.some(r => normName(r.fuente.nombre) === 'general')
  const muchas = fuentes.length > 4
  const term = normName(q)
  const visibles = fuentes
    .filter(r => estado === 'todas' || (estado === 'activas') === r.fuente.activo)
    .filter(r => !term || normName(`${r.fuente.nombre} ${mediosDeFuente(r.fuente.medioPago).join(' ')}`).includes(term))
  const filtrando = !!term || estado !== 'todas'
  // Con muchas fuentes se ven las primeras 6 (o todas al buscar/filtrar o al pedirlo): la página no se vuelve eterna en el móvil.
  const LIMITE = 6
  const mostradas = filtrando || verTodas ? visibles : visibles.slice(0, LIMITE)
  const ids = fuentes.map(r => r.fuente.id)

  const abrir = (fuente: Fuente | null) => setForm({ fuente, key: Date.now() })
  const clonar = (fuente: Fuente) => setForm({ fuente: null, clonDe: fuente, key: Date.now() })
  const mover = (id: string, delta: number) => {
    const xs = [...ids]
    const i = xs.indexOf(id), j = i + delta
    if (i < 0 || j < 0 || j >= xs.length) return
    ;[xs[i], xs[j]] = [xs[j], xs[i]]
    store.track('fuentes:orden', { pending: 'Guardando el orden…', ok: 'Orden de fuentes guardado.', error: 'No se pudo guardar el orden de las fuentes. Se restauró el anterior.' },
      () => store.actions.reorderFuentes(xs), { retry: false })
  }
  // Arrastrar y soltar: solo con la lista completa (sin búsqueda, filtros ni "ver menos"); guarda UNA vez al soltar.
  const puedeArrastrar = !filtrando && mostradas.length === fuentes.length && fuentes.length > 1
  const motivoNoArrastrar = filtrando ? 'Quita la búsqueda y los filtros para reordenar' : mostradas.length < fuentes.length ? 'Muestra todas las fuentes para reordenar' : 'Se necesitan al menos dos fuentes'
  const dnd = useReorden({ ids, habilitado: puedeArrastrar, nombre: id => fuentes.find(r => r.fuente.id === id)?.fuente.nombre ?? 'Fuente',
    onCommit: xs => store.track('fuentes:orden', { pending: 'Guardando el orden…', ok: 'Orden de fuentes guardado.', error: 'No se pudo guardar el orden de las fuentes. Se restauró el anterior.' },
      () => store.actions.reorderFuentes(xs), { retry: false }) })
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
            <span className="grid size-8 place-items-center rounded-xl" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}><CircleDollarSign className="size-4" /></span>
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
        <div className="flex flex-wrap gap-2">
          <BotonNuevo onClick={() => abrir(null)}>Nueva fuente</BotonNuevo>
          <BotonMensual onClick={() => plantillas.abrir('fuente')}>Fuentes mensuales</BotonMensual>
        </div>
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

      {fuentes.length > 0 && (
        <div className={`mb-3 grid gap-2 rounded-2xl bg-bg/70 p-2 ${muchas ? 'sm:grid-cols-[minmax(0,1fr)_auto_auto]' : 'grid-cols-[1fr_auto]'}`}>
          {muchas ? (
            <>
              <label className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                <input aria-label="Buscar fuente" className={`${inputCls} h-11 pl-9`} placeholder="Buscar fuente…" value={q} onChange={e => setQ(e.target.value)} />
              </label>
              <div className="w-full sm:w-36"><SelectField label="Filtrar fuentes por estado" value={estado} onChange={v => setEstado(v as typeof estado)}>
                <option value="todas">Todas</option><option value="activas">Activas</option><option value="inactivas">Inactivas</option>
              </SelectField></div>
            </>
          ) : <p className="self-center px-2 text-[11px] text-muted">{puedeArrastrar ? 'Arrastra el asa ⠿ para reordenar; el orden decide cuál fuente se usa primero.' : ''}</p>}
          <div className="flex items-center gap-1 justify-self-end rounded-xl bg-card p-1 ring-1 ring-line" role="radiogroup" aria-label="Vista de fuentes">
            {([['lista', List, 'Lista'], ['grid', LayoutGrid, 'Tarjetas']] as const).map(([v, Icon, l]) => (
              <button key={v} type="button" role="radio" aria-checked={vista === v} aria-label={l} title={l} onClick={() => setVista(v)}
                className={`grid size-9 place-items-center rounded-lg transition ${vista === v ? 'bg-primary-soft text-navy' : 'text-muted hover:bg-bg'}`}><Icon className="size-4" /></button>
            ))}
          </div>
        </div>
      )}

      {fuentes.length > 0 && !visibles.length ? (
        <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">Ninguna fuente coincide. <button className="font-semibold text-navy underline" onClick={() => { setQ(''); setEstado('todas') }}>Limpiar filtros</button></div>
      ) : fuentes.length > 0 && (() => {
        const porId = new Map(mostradas.map(r => [r.fuente.id, r]))
        const ordenadas = (puedeArrastrar ? dnd.orden : mostradas.map(r => r.fuente.id)).map(id => porId.get(id)).filter((r): r is FuenteResumen => !!r)
        const acc = (r: FuenteResumen) => <AccionesFuente f={r.fuente} puedeOrdenar={!filtrando} first={ids[0] === r.fuente.id} last={ids.at(-1) === r.fuente.id}
          onEdit={() => abrir(r.fuente)} onUp={() => mover(r.fuente.id, -1)} onDown={() => mover(r.fuente.id, 1)} onClone={() => clonar(r.fuente)} onDelete={() => setBorrar(r)} onPlantilla={() => plantillas.guardarComoPlantilla('fuente', r.fuente.id)} />
        const swipe = (r: FuenteResumen): AccionMenu[] => [
          { key: 'edit', label: 'Editar', icon: <Pencil className="size-4" />, onClick: () => abrir(r.fuente) },
          { key: 'clone', label: 'Clonar', icon: <Copy className="size-4" />, onClick: () => clonar(r.fuente) },
          { key: 'tpl', label: 'Plantilla', icon: <FilePlus2 className="size-4" />, onClick: () => plantillas.guardarComoPlantilla('fuente', r.fuente.id) },
          { key: 'delete', label: 'Eliminar', icon: <Trash2 className="size-4" />, onClick: () => setBorrar(r), danger: true },
        ]
        const asa = (r: FuenteResumen) => <AsaOrden {...dnd.asa(r.fuente.id)} habilitado={puedeArrastrar} motivo={motivoNoArrastrar} />
        return vista === 'grid' ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Lista de fuentes">
            {ordenadas.map(r => <TarjetaFuente key={r.fuente.id} r={r} todas={todas} money={money} mes={mes} busy={store.pending.has(`fuente:${r.fuente.id}`)} onToggle={() => alternar(r)}
              dnd={dnd.item(r.fuente.id)} asa={asa(r)} acciones={acc(r)} />)}
          </ul>
        ) : (
          <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line" aria-label="Lista de fuentes">
            {ordenadas.map(r => <FilaFuente key={r.fuente.id} r={r} todas={todas} money={money} busy={store.pending.has(`fuente:${r.fuente.id}`)} onToggle={() => alternar(r)}
              dnd={dnd.item(r.fuente.id)} asa={asa(r)} acciones={acc(r)} swipe={swipe(r)} />)}
          </ul>
        )
      })()}
      <AvisoOrden texto={dnd.aviso} />

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

      {form && <FuenteForm key={form.key} store={store} fuente={form.fuente} clonDe={form.clonDe ?? null} fuentes={fuentes.map(r => r.fuente)} meses={data.fuentesMeses ?? []} mes={mes} hoyMes={hoyMes}
        monedas={monedasDe(data.config)} medios={data.medios.map(m => m.nombre)} primera={c.origen === 'caja-general'} general={general ? Math.round(general.presupuesto * 100) : 0} money={money} onClose={() => setForm(null)} />}
      {borrar && <BorrarFuente store={store} r={borrar} data={data} money={money} onClose={() => setBorrar(null)} onDesactivar={() => { const x = borrar; setBorrar(null); if (x.fuente.activo) alternar(x) }} />}
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

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return <Switch estado checked={on} onChange={() => onChange()} label={label} disabled={disabled} title={on ? 'Activa: suma al presupuesto' : 'Inactiva: no suma'} />
}

function Badges({ r }: { r: FuenteResumen }) {
  const e = estadoFuente(r)
  const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold'
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={chip} style={{ color: e.tono.fg, background: e.tono.bg }} data-testid="estado-fuente">{e.txt}</span>
      {r.principal && <span className={chip} style={{ color: TONO.info.fg, background: TONO.info.bg }} title="Recibe los gastos que no tienen una fuente por medio de pago"><Star className="size-2.5" /> Principal</span>}
      {mediosDeFuente(r.fuente.medioPago).length > 0 && <span className={chip} style={{ color: '#4D7C0F', background: '#F0F9E0' }} title={`Los gastos pagados con ${mediosDeFuente(r.fuente.medioPago).join(', ')} se atribuyen a esta fuente`}><CreditCard className="size-2.5" /> {mediosDeFuente(r.fuente.medioPago).join(', ')}</span>}
      {r.ajustado && <span className={chip} style={{ color: TONO.atencion.fg, background: TONO.atencion.bg }} title={`Importe base registrado: ${r.fuente.moneda} ${r.fuente.monto.toFixed(2)}. Este período usa un importe propio (ajuste por mes, hoja FUENTES_MESES).`}>Ajustado</span>}
    </span>
  )
}

type DndItem = { ref: (el: HTMLElement | null) => void; 'data-arrastrando'?: string }

function TarjetaFuente({ r, todas, money, mes, busy, onToggle, acciones, dnd, asa }: { r: FuenteResumen; todas: Fuente[]; money: (n: number) => string; mes: string | null; busy: boolean; onToggle: () => void; acciones: ReactNode; dnd: DndItem; asa: ReactNode }) {
  const f = r.fuente
  const { Icon, color } = fuenteLook(f, todas)
  const pct = r.pct ?? 0
  return (
    <li {...dnd} className={`${CLASE_ARRASTRE} relative flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgb(15_23_42/0.07)] ${f.activo ? '' : 'opacity-75'}`} data-testid="fuente">
      <span className="h-1.5" style={{ background: f.activo ? `linear-gradient(90deg, ${color}, ${color}99)` : 'var(--line)' }} aria-hidden />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          {asa}
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
            {r.ajustado && <p className="tabular truncate text-[10px] text-muted" data-testid="fuente-base" title="Importe base de la hoja FUENTES; el período usa un ajuste de FUENTES_MESES">Base {f.moneda} {f.monto.toFixed(2)} · ajuste de este período</p>}
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

function FilaFuente({ r, todas, money, busy, onToggle, acciones, swipe, dnd, asa }: { r: FuenteResumen; todas: Fuente[]; money: (n: number) => string; busy: boolean; onToggle: () => void; acciones: ReactNode; swipe: AccionMenu[]; dnd: DndItem; asa: ReactNode }) {
  const f = r.fuente
  const { Icon, color } = fuenteLook(f, todas)
  const movil = useEsMovil()
  return (
    <li {...dnd} data-testid="fuente" className={`${CLASE_ARRASTRE} border border-transparent transition hover:bg-bg/60`}>
      <SwipeFila nombre={f.nombre} acciones={swipe} activo={movil} testId="fuente-fila">
        {/* Móvil: línea 1 = asa, icono, nombre, ON/OFF; línea 2 = recurrencia, estado/medio y monto. Escritorio: una fila. */}
        <div className="grid grid-cols-[2rem_2.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 px-2.5 py-2 sm:grid-cols-[2rem_2.5rem_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto_auto] sm:gap-x-3 sm:px-3 sm:py-2.5">
          {asa}
          <span className="grid size-9 place-items-center rounded-xl sm:size-10" style={{ background: `${color}1A`, color }}><Icon className="size-4" /></span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" data-testid="fuente-nombre">{f.nombre}{busy && <span className="ml-2 text-[10px] font-normal text-muted">Guardando…</span>}</p>
            <p className="truncate text-[11px] text-muted">{recurrenciaTxt(f)}</p>
          </div>
          <div className="col-start-3 col-end-4 row-start-2 min-w-0 sm:col-start-4 sm:col-end-5 sm:row-start-1"><Badges r={r} /></div>
          <span className="tabular col-start-4 row-start-2 text-right text-sm font-bold sm:col-start-5 sm:row-start-1" data-testid="fuente-aporte">{money(r.asignado)}</span>
          <div className="col-start-4 row-start-1 sm:col-start-6"><Toggle on={f.activo} onChange={onToggle} label={`${f.activo ? 'Desactivar' : 'Activar'} ${f.nombre}`} disabled={busy} /></div>
          {!movil && acciones}
        </div>
      </SwipeFila>
    </li>
  )
}

function AccionesFuente({ f, puedeOrdenar, first, last, onEdit, onUp, onDown, onClone, onDelete, onPlantilla }: {
  f: Fuente; puedeOrdenar: boolean; first: boolean; last: boolean; onEdit: () => void; onUp: () => void; onDown: () => void; onClone: () => void; onDelete: () => void; onPlantilla: () => void
}) {
  return (
    <div className="relative flex shrink-0 items-center gap-1">
      <BotonEditar label={`Editar fuente ${f.nombre}`} onClick={onEdit} />
      <MenuAcciones label={`Más acciones de la fuente ${f.nombre}`} acciones={[
        { key: 'up', label: 'Subir', icon: <ArrowUp className="size-3.5" />, onClick: onUp, disabled: !puedeOrdenar || first, title: puedeOrdenar ? undefined : 'Quita la búsqueda y los filtros para reordenar' },
        { key: 'down', label: 'Bajar', icon: <ArrowDown className="size-3.5" />, onClick: onDown, disabled: !puedeOrdenar || last, title: puedeOrdenar ? undefined : 'Quita la búsqueda y los filtros para reordenar' },
        { key: 'clone', label: 'Clonar', icon: <Copy className="size-3.5" />, onClick: onClone },
        { key: 'tpl', label: 'Guardar como plantilla', icon: <FilePlus2 className="size-3.5" />, onClick: onPlantilla },
        { key: 'delete', label: 'Eliminar', icon: <Trash2 className="size-3.5" />, onClick: onDelete, danger: true },
      ]} />
    </div>
  )
}

/** Eliminar: verifica dependencias (gastos atribuidos en todo el historial, importes por mes). Con gastos NO se elimina: se ofrece desactivar. */
function BorrarFuente({ store, r, data, money, onClose, onDesactivar }: {
  store: AppStore; r: FuenteResumen; data: AppData; money: (n: number) => string; onClose: () => void; onDesactivar: () => void
}) {
  const f = r.fuente
  const deps = useMemo(() => dependenciasFuente(f, data, todayIn()), [f, data])
  const bloqueada = deps.gastos > 0
  return (
    <Modal open onClose={onClose} size="sm" title={bloqueada ? `No se puede eliminar ${f.nombre}` : `Eliminar ${f.nombre}`} icon={<Trash2 className="size-5" />}
      footer={bloqueada
        ? <><Button variant="outline" onClick={onClose}>Cerrar</Button>{f.activo && <Button onClick={onDesactivar}>Desactivar en su lugar</Button>}</>
        : <><Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" disabled={store.pending.has(`fuente:${f.id}`)} onClick={() => {
            const ok = store.track(`fuente:${f.id}`, { pending: `Eliminando ${f.nombre}…`, ok: `${f.nombre} eliminada. Ningún gasto se borró.`, error: `No se pudo eliminar ${f.nombre}.` },
              () => store.actions.deleteFuente(f.id))
            if (ok) onClose()
          }}><Trash2 className="size-4" /> Eliminar</Button></>}>
      <div className="space-y-3 text-sm" data-testid="eliminar-fuente">
        <p className="font-semibold">“{f.nombre}” · {recurrenciaTxt(f)}{mediosDeFuente(f.medioPago).length ? ` · ${mediosDeFuente(f.medioPago).join(', ')}` : ''}</p>
        {bloqueada ? (
          <p className="rounded-xl px-3 py-2 text-xs" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }} data-testid="fuente-con-gastos">
            Tiene {deps.gastos} gasto(s) atribuido(s) en tu historial. Para no perder la trazabilidad no se elimina.
            {f.activo ? ' Puedes desactivarla: deja de sumar al presupuesto, conserva su historial y puedes reactivarla cuando quieras.' : ' Ya está inactiva: queda guardada sin sumar al presupuesto.'}
          </p>
        ) : (
          <>
            <p className="text-muted">No tiene gastos atribuidos. Se eliminará la fuente{deps.ajustes ? ` y sus ${deps.ajustes} importe(s) por mes` : ''}; ningún gasto se borra.</p>
            {f.activo && r.aporta > 0 && <p className="text-xs text-muted">En este período el presupuesto consolidado bajará en <b className="tabular">{money(r.aporta)}</b>.</p>}
          </>
        )}
      </div>
    </Modal>
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
          {r.count} gasto(s) por {money(r.gastado)} están atribuidos a esta fuente. {mediosDeFuente(r.fuente.medioPago).length
            ? `Los pagados con ${mediosDeFuente(r.fuente.medioPago).join(', ')} seguirán descontando del presupuesto y se mostrarán en una conciliación aparte: no se pasan a otra fuente.`
            : 'Pasarán a la siguiente fuente principal activa (si no hay, se mostrarán como “sin fuente”). Siguen descontando del presupuesto.'}</p>}
        <p className="text-xs text-muted">No se borra la fuente, ni sus importes por mes, ni ningún gasto. Puedes reactivarla cuando quieras.</p>
      </div>
    </Modal>
  )
}

/* ============================== Crear / editar ============================== */

function FuenteForm({ store, fuente, clonDe = null, fuentes, meses, mes, hoyMes, monedas, medios, primera, general, money, onClose }: {
  store: AppStore; fuente: Fuente | null; clonDe?: Fuente | null; fuentes: Fuente[]; meses: FuenteMes[]; mes: string | null; hoyMes: string; monedas: string[]; medios: string[]
  primera: boolean; general: number; money: (n: number) => string; onClose: () => void
}) {
  const editar = !!fuente
  // ID fijo mientras el formulario está abierto: guardar dos veces (doble clic, reintento) actualiza la misma fuente.
  const [id] = useState(() => fuente?.id ?? `f-${crypto.randomUUID()}`)
  const mesRef = mes ?? hoyMes
  // Clonar: parte de la configuración de la original (sin gastos ni importes por mes) y nace INACTIVA: no suma dinero
  // al presupuesto hasta que el usuario la active y confirme el importe.
  const [nombre, setNombre] = useState(fuente?.nombre ?? (clonDe ? `${clonDe.nombre.slice(0, 31)} (Copia)` : ''))
  const [moneda, setMoneda] = useState(fuente?.moneda ?? clonDe?.moneda ?? monedas[0] ?? 'PEN')
  const [recurrencia, setRecurrencia] = useState<Recurrencia>(fuente?.recurrencia ?? clonDe?.recurrencia ?? 'mensual')
  const [mesAplic, setMesAplic] = useState(fuente ? fuente.mes : clonDe ? clonDe.mes : mesRef)
  const [elegidos, setElegidos] = useState<string[]>(() => mediosDeFuente(fuente?.medioPago ?? clonDe?.medioPago ?? ''))
  const medio = unirMedios(elegidos)
  const [activo, setActivo] = useState(fuente?.activo ?? (clonDe ? false : true))
  // Importe: al crear es el importe base; al editar es el del mes elegido (solo ese mes o desde ese mes).
  const actualMes = fuente && mes ? fuenteMontoMes(fuente, mes, meses) : null
  const [monto, setMonto] = useState(fuente ? String(actualMes ? actualMes.monto : fuente.monto) : clonDe ? String(clonDe.monto) : '')
  const [modo, setModo] = useState<'solo' | 'desde'>('solo')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const tieneSolo = !!fuente && !!mes && meses.some(m => m.fuenteId === fuente.id && m.mes === mes && m.modo === 'solo')
  const esMesBase = !!fuente && fuente.recurrencia === 'unica' && recurrencia === 'unica' && mes === mesAplic
  const otras = fuentes.filter(f => f.id !== id)
  // Automático: el del medio de pago asociado (Yape se ve como Yape) y, sin medio (fuente libre), el de la fuente General.
  const auto = elegidos.length ? medioLook(elegidos[0]) : fuenteLook({ nombre: nombre || 'Fuente', medioPago: '', icono: '', color: '' }, otras)
  const { Icon, color } = auto // el aspecto es siempre automático (ya no se elige aquí)
  const mediosOpc = useMemo(() => [...new Set([...elegidos, ...medios])].filter(m => !elegidos.some(e => normName(e) === normName(m))), [elegidos, medios])

  function save() {
    const errs: Record<string, string> = {}
    const m = monto.trim().replace(',', '.')
    if (!nombre.trim()) errs.nombre = 'Escribe un nombre'
    else if (otras.some(f => normName(f.nombre) === normName(nombre))) errs.nombre = 'Ya tienes una fuente con ese nombre'
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(m)) errs.monto = 'Monto mayor o igual a 0, hasta 2 decimales'
    if (!monedas.includes(moneda)) errs.moneda = 'Moneda no permitida'
    if (recurrencia === 'unica' && !MES_RE.test(mesAplic)) errs.mes = 'Elige el mes de aplicación'
    if (mesAplic && !MES_RE.test(mesAplic)) errs.mes = 'Mes inválido'
    if (editar && !mes && Number(m) !== fuente!.monto && !esMesBase) errs.monto = 'Para cambiar un importe, elige un único mes en el período.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const n = Math.round(Number(m) * 100) / 100
    const cambiaImporteMes = editar && !!mes && !esMesBase && actualMes !== null && n !== actualMes.monto
    const orden = fuente?.orden ?? Math.max(0, ...fuentes.map(f => f.orden)) + 1
    const base = { id, nombre: nombre.trim(), monto: editar && !esMesBase ? fuente!.monto : n, moneda, color, icono: '', activo, orden, recurrencia, mes: mesAplic, medioPago: medio }
    const cambiaConfig = !editar || JSON.stringify({ ...fuente, creadoEn: undefined, actualizadoEn: undefined }) !== JSON.stringify({ ...fuente, ...base, creadoEn: undefined, actualizadoEn: undefined })
    const msgMes = cambiaImporteMes ? (modo === 'desde' ? ` Importe desde ${monthLabel(mes!, true)}: ${money(Math.round(n * 100))}.` : ` Importe de ${monthLabel(mes!, true)}: ${money(Math.round(n * 100))}.`) : ''
    const ok = store.track(`fuente:${id}`, editar
      ? { pending: `Guardando ${base.nombre}…`, ok: `${base.nombre} actualizada.${msgMes}`, error: `No se pudo actualizar ${base.nombre}.` }
      : { pending: `Creando ${base.nombre}…`, ok: activo ? `${base.nombre} creada: suma ${money(Math.round(n * 100))} ${recurrencia === 'unica' ? `en ${monthLabel(mesAplic, true)}` : 'al mes'}.` : `${base.nombre} creada inactiva: no suma al presupuesto hasta que la actives.`, error: `No se pudo crear ${base.nombre}.` },
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
    <Modal open onClose={onClose} size="md" title={editar ? `Editar ${fuente!.nombre}` : clonDe ? `Clonar ${clonDe.nombre}` : 'Nueva fuente'} icon={<CircleDollarSign className="size-5" />}
      subtitle="Dinero que suma a tu presupuesto consolidado. No crea gastos ni ingresos contables."
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save}>{editar ? 'Guardar cambios' : clonDe ? 'Crear copia' : 'Crear fuente'}</Button></>}>
      <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); save() }}>
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: `${color}14`, boxShadow: `inset 0 0 0 1px ${color}33` }}>
          <span className="grid size-11 place-items-center rounded-2xl bg-card" style={{ color }}><Icon className="size-5" /></span>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{nombre.trim() || 'Nueva fuente'}</p>
            <p className="truncate text-[11px] text-muted">{recurrencia === 'unica' ? `Solo ${MES_RE.test(mesAplic) ? monthLabel(mesAplic, true) : '—'}` : mesAplic ? `Todos los meses desde ${monthLabel(mesAplic, true)}` : 'Todos los meses'}</p></div>
        </div>
        {clonDe && (
          <ErrorBox tone="warning" message={activo
            ? `Al crearla, esta copia sumará ${money(Math.round((Number(monto.replace(',', '.')) || 0) * 100))} al presupuesto consolidado (dinero adicional). Revisa el importe o déjala inactiva.`
            : `Es una copia de “${clonDe.nombre}”: no copia gastos ni importes por mes y nace inactiva, así que no suma dinero al presupuesto hasta que la actives.`} />
        )}
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
            <Combobox id="fuente-moneda" label="Moneda" value={moneda} onChange={setMoneda} options={monedas.map(x => ({ value: x, label: x }))} />
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
            <span className="min-w-0 flex-1"><MonthPicker id="fuente-mes" label="Mes de aplicación" value={mesAplic} invalid={!!errors.mes} onChange={setMesAplic} /></span>
            {recurrencia === 'mensual' && mesAplic && <button type="button" className="shrink-0 text-xs text-muted underline" onClick={() => setMesAplic('')}>Todos</button>}
          </span>
        </Field>
        <Field label="Medios de pago asociados (opcional)" error={errors.medio} htmlFor="fuente-medio"
          hint="Los gastos pagados con esos medios se atribuyen a esta fuente. El importe no se divide entre medios. Varias fuentes pueden compartir un medio; se usan en el orden de la lista. No cambia ningún gasto.">
          <div className="space-y-2">
            <ul className="flex flex-wrap gap-1.5" aria-label="Medios elegidos" data-testid="fuente-medios">
              {!elegidos.length && <li className="rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-muted">Ninguno (fuente libre)</li>}
              {elegidos.map(m => { const l = medioLook(m); return (
                <li key={m} className="flex items-center gap-1.5 rounded-full py-1 pr-1 pl-2 text-xs font-medium" style={{ background: `${l.color}1A`, color: l.color }}>
                  <l.Icon className="size-3.5" />{m}
                  <button type="button" aria-label={`Quitar ${m}`} onClick={() => setElegidos(xs => xs.filter(x => x !== m))} className="grid size-5 place-items-center rounded-full hover:bg-black/10"><X className="size-3" /></button>
                </li>) })}
            </ul>
            <Combobox id="fuente-medio" label="Agregar medio de pago" value="" onChange={v => setElegidos(xs => v === NINGUNO ? [] : [...xs, v])} placeholder="Agregar medio de pago…"
              options={[{ value: NINGUNO, label: 'Ninguno (fuente libre)' }, ...mediosOpc.map(x => { const l = medioLook(x); return { value: x, label: x, Icon: l.Icon, color: l.color } })]} />
          </div>
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
