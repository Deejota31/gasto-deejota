import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, Banknote, CalendarDays, CalendarRange, CircleDollarSign, CreditCard,
  Copy, FilePlus2, Info, LayoutGrid, List, Pencil, Search, Star, Trash2, X,
} from 'lucide-react'
import { aislaDesde, fondoMontoMes, type CajasResumen, type FondoResumen } from '../lib/engine'
import { monthLabel, todayIn } from '../lib/dates'
import { normName } from '../lib/orden'
import { fondoLook, medioLook } from '../lib/visual'
import type { AppStore } from '../lib/store'
import { TIPOS_FONDO, TIPO_FONDO_TXT, type AppData, type Fondo, type FondoMes, type Recurrencia, type TipoFondo } from '../lib/types'
import { dependenciasFondo } from '../lib/dependencias'
import { MenuAcciones, type AccionMenu } from './MenuAcciones'
import { BotonEditar, BotonMensual, BotonNuevo, Button, ErrorBox, Field, InfoTooltip, inputCls, Modal, Segmented, SelectField, Switch } from './ui'
import { Combobox } from './Combobox'
import { VacioMes, type PlanificacionApi } from './Planificacion'
import { MonthPicker } from './DatePicker'
import { AsaOrden, AvisoOrden, CLASE_ARRASTRE, useReorden } from './reorden'
import { guardarPref, leerPref } from '../lib/prefs'
import { SwipeFila, useEsMovil } from './swipe'
import type { usePlantillasFin } from './PlantillasFin'
import { mediosDeFondo, unirMedios } from '../lib/fondoMedios'

const NINGUNO = '__ninguno__'

/**
 * Fondos del presupuesto (v1.8): General, Sodexo, Extra 1… Cada fondo activo suma su importe del mes al presupuesto
 * consolidado; desactivarlo lo conserva sin aportar. Todo pasa por el motor (`aggregate`): esta pantalla solo muestra
 * y edita, no calcula por su cuenta.
 */

const TONO = {
  ok: { fg: 'var(--success)', bg: 'var(--success-soft)' }, atencion: { fg: 'var(--warning)', bg: 'var(--warning-soft)' }, alerta: { fg: 'var(--danger)', bg: 'var(--danger-soft)' },
  info: { fg: '#4F6FC8', bg: '#EEF3FF' }, neutro: { fg: '#64748B', bg: 'var(--bg)' },
}
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const TIPO_FONDO_AYUDA: Record<TipoFondo, string> = {
  mensual: 'Presupuesto habitual: tiene su propio importe cada mes y el historial de meses anteriores no cambia.',
  extra: 'Presupuesto adicional de un período: solo cuenta en el período en que se aplica.',
  ahorro_asignado: 'Dinero ya separado para un objetivo (p. ej. una tesis o un viaje). Es una distribución interna de tu presupuesto, no un ingreso nuevo.',
}
const recurrenciaTxt = (f: Fondo) => f.recurrencia === 'unica' ? `Solo ${f.mes ? monthLabel(f.mes, true) : '—'}` : f.mes ? `Mensual desde ${monthLabel(f.mes, true)}` : 'Todos los meses'

export const FONDO_GENERAL_ID = 'fondo-general'
/** ID histórico del fondo General (datos anteriores a la migración): se reconoce, no se cambia. */
export const FONDO_GENERAL_ID_ANTERIOR = 'fuente-general' // [compat-migración]

export function FondosSeccion({ store, c, mes, money, periodo, hoyMes, plantillas, plan }: {
  plan: PlanificacionApi; plantillas: ReturnType<typeof usePlantillasFin>; store: AppStore; c: CajasResumen; mes: string | null; money: (n: number) => string; periodo: string; hoyMes: string
}) {
  const data = store.data!
  // v1.19: en un mes con aislamiento solo se listan los fondos aplicados a ese mes; el resto sigue existiendo y se aplica desde la planificación.
  const todosLosFondos = c.fondos.lista
  const fondos = useMemo(() => todosLosFondos.filter(r => r.aplicada), [todosLosFondos])
  const ocultas = todosLosFondos.length - fondos.length
  const mesVacio = !!mes && mes >= aislaDesde(data.config) && !fondos.length
  const todas = useMemo(() => todosLosFondos.map(r => r.fondo), [todosLosFondos])
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState<'todas' | 'activas' | 'inactivas'>('todas')
  const [vista, setVistaState] = useState<'grid' | 'lista'>(() => leerPref('deejota.vista.fondos', ['grid', 'lista'] as const, 'lista'))
  const setVista = (v: 'grid' | 'lista') => { setVistaState(v); guardarPref('deejota.vista.fondos', v) }
  const [verTodas, setVerTodas] = useState(false)
  const [form, setForm] = useState<{ fondo: Fondo | null; clonDe?: Fondo | null; key: number } | null>(null)
  const [borrar, setBorrar] = useState<FondoResumen | null>(null)
  const [desactivar, setDesactivar] = useState<FondoResumen | null>(null)
  const general = c.general
  const migrada = todosLosFondos.some(r => r.fondo.id === FONDO_GENERAL_ID || r.fondo.id === FONDO_GENERAL_ID_ANTERIOR)
  const puedeMigrar = !!general && general.presupuesto > 0 && !migrada && !todosLosFondos.some(r => normName(r.fondo.nombre) === 'general')
  const muchas = fondos.length > 4
  const term = normName(q)
  const visibles = fondos
    .filter(r => estado === 'todas' || (estado === 'activas') === r.fondo.activo)
    .filter(r => !term || normName(`${r.fondo.nombre} ${mediosDeFondo(r.fondo.medioPago).join(' ')}`).includes(term))
  const filtrando = !!term || estado !== 'todas'
  // Con muchos fondos se ven las primeras 6 (o todas al buscar/filtrar o al pedirlo): la página no se vuelve eterna en el móvil.
  const LIMITE = 6
  const mostradas = filtrando || verTodas ? visibles : visibles.slice(0, LIMITE)
  const ids = todosLosFondos.map(r => r.fondo.id)

  const abrir = (fondo: Fondo | null) => setForm({ fondo, key: Date.now() })
  const clonar = (fondo: Fondo) => setForm({ fondo: null, clonDe: fondo, key: Date.now() })
  const mover = (id: string, delta: number) => {
    const xs = [...ids]
    const i = xs.indexOf(id), j = i + delta
    if (i < 0 || j < 0 || j >= xs.length) return
    ;[xs[i], xs[j]] = [xs[j], xs[i]]
    store.track('fondos:orden', { pending: 'Guardando el orden…', ok: 'Orden de fondos guardado.', error: 'No se pudo guardar el orden de los fondos. Se restauró el anterior.' },
      () => store.actions.reorderFondos(xs), { retry: false })
  }
  // Arrastrar y soltar: solo con la lista completa (sin búsqueda, filtros ni "ver menos"); guarda UNA vez al soltar.
  const puedeArrastrar = !filtrando && ocultas === 0 && mostradas.length === fondos.length && fondos.length > 1
  const motivoNoArrastrar = ocultas > 0 ? 'Hay fondos sin aplicar a este mes' : filtrando ? 'Quita la búsqueda y los filtros para reordenar' : mostradas.length < fondos.length ? 'Muestra todos los fondos para reordenar' : 'Se necesitan al menos dos fondos'
  const dnd = useReorden({ ids, habilitado: puedeArrastrar, nombre: id => fondos.find(r => r.fondo.id === id)?.fondo.nombre ?? 'Fondo',
    onCommit: xs => store.track('fondos:orden', { pending: 'Guardando el orden…', ok: 'Orden de fondos guardado.', error: 'No se pudo guardar el orden de los fondos. Se restauró el anterior.' },
      () => store.actions.reorderFondos(xs), { retry: false }) })
  const guardarEstado = (f: Fondo, on: boolean) => store.track(`fondo:${f.id}`,
    { pending: on ? `Activando ${f.nombre}…` : `Desactivando ${f.nombre}…`, ok: `${f.nombre} ${on ? 'activado: vuelve a sumar al presupuesto' : 'desactivado: ya no suma al presupuesto. No se borró nada'}.`, error: `No se pudo ${on ? 'activar' : 'desactivar'} ${f.nombre}.` },
    () => store.actions.saveFondo({ ...f, activo: on }))
  // Antes de apagar un fondo que aporta o tiene gastos atribuidos se muestra el impacto; encender es directo.
  const alternar = (r: FondoResumen) => {
    if (r.fondo.activo && (r.aporta > 0 || r.count > 0)) setDesactivar(r)
    else guardarEstado(r.fondo, !r.fondo.activo)
  }
  const migrar = () => store.track('fondos:migrar', { pending: 'Creando el fondo General desde la caja general (con respaldo previo)…', ok: 'Fondo General creado con el presupuesto y los ajustes mensuales de la caja general.', error: 'No se pudo crear el fondo General.' },
    () => store.actions.migrarGeneralAFondo())

  return (
    <section className="rounded-3xl border border-line bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_8px_24px_rgb(15_23_42/0.04)] sm:p-5" aria-label="Fondos del presupuesto">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <span className="grid size-8 place-items-center rounded-xl" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}><CircleDollarSign className="size-4" /></span>
            Fondos del presupuesto <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-semibold text-muted" data-testid="n-fondos">{fondos.length}</span>
            <InfoTooltip title="Cómo suman los fondos" align="left">
              <p>El <b>presupuesto consolidado</b> es la suma de lo que aporta cada fondo <b>activo</b> en el período. Las reservas no suman: reparten ese mismo dinero.</p>
              <p>Un fondo mensual aporta todos los meses (desde su mes de aplicación); una de un solo mes, por ejemplo un ingreso extra, solo en ese mes y no se arrastra.</p>
              <p>Cambiar el importe de un mes no toca los demás. Desactivar no borra el fondo ni ningún gasto.</p>
              <p>Cada gasto se atribuye a una sola fondo: la que tiene asociado su medio de pago (p. ej. Sodexo) o, si no, el fondo principal.</p>
            </InfoTooltip>
          </h2>
          <p className="mt-0.5 text-xs text-muted">{c.origen === 'fondos'
            ? `${c.fondos.activas} activo${c.fondos.activas === 1 ? '' : 's'} · aportan ${money(c.fondos.total)} en ${periodo}`
            : 'Aún no tienes fondos: el presupuesto sale de la caja general.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <BotonNuevo onClick={() => abrir(null)}>Nuevo fondo</BotonNuevo>
          <BotonMensual onClick={() => plantillas.abrir('fondo')}>Fondos mensuales</BotonMensual>
        </div>
      </div>

      {mesVacio && c.origen === 'fondos' && (
        <div className="mb-4"><VacioMes tipo="fondo" mes={mes!} nOcultas={ocultas} onConfigurar={() => abrir(null)} onPlantillas={() => plantillas.abrir('fondo')} onAnterior={() => plan.usarAnterior('fondo', mes!)} /></div>
      )}
      {c.origen === 'caja-general' && (
        <div className="mb-4 rounded-2xl px-4 py-3 text-sm" style={{ background: TONO.info.bg, color: TONO.info.fg }} data-testid="sin-fondos">
          <p className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0" />
            <span>Hoy tu presupuesto es el de la caja general{general && general.presupuesto > 0 ? ` (${money(Math.round(general.presupuesto * 100))} al mes)` : ''}. Con fondos puedes separar de dónde viene el dinero (General, Sodexo, un extra…) y sumarlo por mes.</span></p>
          {puedeMigrar && <p className="mt-2 text-xs">Te recomendamos empezar creando el fondo <b>General</b> con ese importe y sus ajustes mensuales, así ningún mes cambia. Se hace un respaldo antes.</p>}
          <p className="mt-1 text-xs opacity-90">Sodexo no se convierte sola en fondo: si su dinero no está incluido en tu presupuesto general, créala tú; tu caja Sodexo seguirá como reserva.</p>
          {puedeMigrar && <div className="mt-2"><Button variant="soft" className="h-9 text-xs" disabled={store.pending.has('fondos:migrar')} onClick={migrar}><Banknote className="size-3.5" /> Crear fondo General con {money(Math.round(general!.presupuesto * 100))}</Button></div>}
        </div>
      )}
      {c.origen === 'fondos' && puedeMigrar && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-xs" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }} data-testid="aviso-general">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">El presupuesto ya es la suma de fondos: la caja general ({money(Math.round(general!.presupuesto * 100))}/mes) dejó de sumar. Si ese dinero sigue siendo tuyo, pásalo a un fondo.</span>
          <Button variant="outline" className="h-8 text-xs" disabled={store.pending.has('fondos:migrar')} onClick={migrar}>Crear fondo General</Button>
        </div>
      )}

      {!todosLosFondos.length && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-10 text-center" data-testid="vacio-fondos">
          <span className="grid size-12 place-items-center rounded-2xl" style={{ background: TONO.info.bg, color: TONO.info.fg }}><CircleDollarSign className="size-6" /></span>
          <p className="text-sm font-semibold text-ink">Aún no tienes fondos registrados. Registra un fondo para empezar</p>
          <p className="max-w-md text-xs text-muted">Un fondo es de dónde viene tu dinero (General, Sodexo, un extra…): cada uno suma al presupuesto del mes en que lo apliques.</p>
        </div>
      )}

      {fondos.length > 0 && (
        <div className={`mb-3 grid gap-2 rounded-2xl bg-bg/70 p-2 ${muchas ? 'sm:grid-cols-[minmax(0,1fr)_auto_auto]' : 'grid-cols-[1fr_auto]'}`}>
          {muchas ? (
            <>
              <label className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                <input aria-label="Buscar fondo" className={`${inputCls} h-11 pl-9`} placeholder="Buscar fondo…" value={q} onChange={e => setQ(e.target.value)} />
              </label>
              <div className="w-full sm:w-36"><SelectField label="Filtrar fondos por estado" value={estado} onChange={v => setEstado(v as typeof estado)}>
                <option value="todas">Todos</option><option value="activas">Activos</option><option value="inactivas">Inactivos</option>
              </SelectField></div>
            </>
          ) : <p className="self-center px-2 text-[11px] text-muted">{puedeArrastrar ? 'Arrastra el asa ⠿ para reordenar; el orden decide cuál fondo se usa primero.' : ''}</p>}
          <div className="flex items-center gap-1 justify-self-end rounded-xl bg-card p-1 ring-1 ring-line" role="radiogroup" aria-label="Vista de fondos">
            {([['lista', List, 'Lista'], ['grid', LayoutGrid, 'Tarjetas']] as const).map(([v, Icon, l]) => (
              <button key={v} type="button" role="radio" aria-checked={vista === v} aria-label={l} title={l} onClick={() => setVista(v)}
                className={`grid size-9 place-items-center rounded-lg transition ${vista === v ? 'bg-primary-soft text-navy' : 'text-muted hover:bg-bg'}`}><Icon className="size-4" /></button>
            ))}
          </div>
        </div>
      )}

      {fondos.length > 0 && !visibles.length ? (
        <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">Ningún fondo coincide. <button className="font-semibold text-navy underline" onClick={() => { setQ(''); setEstado('todas') }}>Limpiar filtros</button></div>
      ) : fondos.length > 0 && (() => {
        const porId = new Map(mostradas.map(r => [r.fondo.id, r]))
        const ordenadas = (puedeArrastrar ? dnd.orden : mostradas.map(r => r.fondo.id)).map(id => porId.get(id)).filter((r): r is FondoResumen => !!r)
        const acc = (r: FondoResumen) => <AccionesFondo f={r.fondo} puedeOrdenar={!filtrando} first={ids[0] === r.fondo.id} last={ids.at(-1) === r.fondo.id}
          onEdit={() => abrir(r.fondo)} onUp={() => mover(r.fondo.id, -1)} onDown={() => mover(r.fondo.id, 1)} onClone={() => clonar(r.fondo)} onDelete={() => setBorrar(r)} onPlantilla={() => plantillas.guardarComoPlantilla('fondo', r.fondo.id)} />
        const swipe = (r: FondoResumen): AccionMenu[] => [
          { key: 'edit', label: 'Editar', icon: <Pencil className="size-4" />, onClick: () => abrir(r.fondo) },
          { key: 'clone', label: 'Clonar', icon: <Copy className="size-4" />, onClick: () => clonar(r.fondo) },
          { key: 'tpl', label: 'Plantilla', icon: <FilePlus2 className="size-4" />, onClick: () => plantillas.guardarComoPlantilla('fondo', r.fondo.id) },
          { key: 'delete', label: 'Eliminar', icon: <Trash2 className="size-4" />, onClick: () => setBorrar(r), danger: true },
        ]
        const asa = (r: FondoResumen) => <AsaOrden {...dnd.asa(r.fondo.id)} habilitado={puedeArrastrar} motivo={motivoNoArrastrar} />
        return vista === 'grid' ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Lista de fondos">
            {ordenadas.map(r => <TarjetaFondo key={r.fondo.id} r={r} todas={todas} money={money} mes={mes} busy={store.pending.has(`fondo:${r.fondo.id}`)} onToggle={() => alternar(r)}
              dnd={dnd.item(r.fondo.id)} asa={asa(r)} acciones={acc(r)} />)}
          </ul>
        ) : (
          <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line" aria-label="Lista de fondos">
            {ordenadas.map(r => <FilaFondo key={r.fondo.id} r={r} todas={todas} money={money} busy={store.pending.has(`fondo:${r.fondo.id}`)} onToggle={() => alternar(r)}
              dnd={dnd.item(r.fondo.id)} asa={asa(r)} acciones={acc(r)} swipe={swipe(r)} />)}
          </ul>
        )
      })()}
      <AvisoOrden texto={dnd.aviso} />

      {!filtrando && visibles.length > LIMITE && (
        <div className="mt-3 flex justify-center">
          <Button variant="ghost" className="text-xs" onClick={() => setVerTodas(v => !v)}>{verTodas ? 'Mostrar menos' : `Ver las ${visibles.length} fondos`}</Button>
        </div>
      )}
      {(c.fondos.countInactivas > 0 || c.fondos.countSinFondo > 0) && (
        <div className="mt-3 space-y-1 rounded-2xl px-4 py-3 text-xs" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }} data-testid="revision-fondos">
          <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" /> Gastos por revisar en los fondos</p>
          {c.fondos.countInactivas > 0 && <p>{c.fondos.countInactivas} gasto(s) por {money(c.fondos.gastadoInactivas)} se pagaron con el medio de un fondo inactivo. Siguen descontando del presupuesto consolidado y no se pasaron a otro fondo.</p>}
          {c.fondos.countSinFondo > 0 && <p>{c.fondos.countSinFondo} gasto(s) por {money(c.fondos.gastadoSinFondo)} no tienen un fondo activo al cual atribuirse (no hay fondo principal activo). También descuentan del presupuesto.</p>}
        </div>
      )}

      {form && <FondoForm key={form.key} store={store} fondo={form.fondo} clonDe={form.clonDe ?? null} fondos={todosLosFondos.map(r => r.fondo)} meses={data.fondosMeses ?? []} mes={mes} hoyMes={hoyMes}
        monedas={monedasDe(data.config)} medios={data.medios.map(m => m.nombre)} primera={c.origen === 'caja-general'} general={general ? Math.round(general.presupuesto * 100) : 0} money={money} onClose={() => setForm(null)} />}
      {borrar && <BorrarFondo store={store} r={borrar} data={data} money={money} onClose={() => setBorrar(null)} onDesactivar={() => { const x = borrar; setBorrar(null); if (x.fondo.activo) alternar(x) }} />}
      {desactivar && <DesactivarFondo r={desactivar} c={c} money={money} periodo={periodo} onClose={() => setDesactivar(null)}
        onConfirm={() => { guardarEstado(desactivar.fondo, false); setDesactivar(null) }} />}
    </section>
  )
}

export const monedasDe = (config: Record<string, string>) => [...new Set([config.moneda || 'PEN', ...String(config.monedas ?? '').split(',').map(x => x.trim()).filter(Boolean)])]

function estadoFondo(r: FondoResumen) {
  if (!r.fondo.activo) return { txt: 'Inactivo', tono: TONO.neutro }
  if (r.sinTipoCambio) return { txt: 'Sin tipo de cambio', tono: TONO.alerta }
  if (!r.asignado) return { txt: 'Sin importe en el período', tono: TONO.neutro }
  if (r.aporta && r.gastado > r.aporta) return { txt: 'Excedida', tono: TONO.alerta }
  return { txt: 'Activa', tono: TONO.ok }
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return <Switch estado checked={on} onChange={() => onChange()} label={label} disabled={disabled} title={on ? 'Activo: suma al presupuesto' : 'Inactivo: no suma'} />
}

function Badges({ r }: { r: FondoResumen }) {
  const e = estadoFondo(r)
  const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold'
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={chip} style={{ color: e.tono.fg, background: e.tono.bg }} data-testid="estado-fondo">{e.txt}</span>
      {r.principal && <span className={chip} style={{ color: TONO.info.fg, background: TONO.info.bg }} title="Recibe los gastos que no tienen un fondo por medio de pago"><Star className="size-2.5" /> Principal</span>}
      {mediosDeFondo(r.fondo.medioPago).length > 0 && <span className={chip} style={{ color: '#4D7C0F', background: '#F0F9E0' }} title={`Los gastos pagados con ${mediosDeFondo(r.fondo.medioPago).join(', ')} se atribuyen a este fondo`}><CreditCard className="size-2.5" /> {mediosDeFondo(r.fondo.medioPago).join(', ')}</span>}
      {r.ajustado && <span className={chip} style={{ color: TONO.atencion.fg, background: TONO.atencion.bg }} title={`Importe base registrado: ${r.fondo.moneda} ${r.fondo.monto.toFixed(2)}. Este período usa un importe propio (ajuste por mes, hoja FONDOS_PRESUPUESTO_MESES).`}>Ajustado</span>}
    </span>
  )
}

type DndItem = { ref: (el: HTMLElement | null) => void; 'data-arrastrando'?: string }

function TarjetaFondo({ r, todas, money, mes, busy, onToggle, acciones, dnd, asa }: { r: FondoResumen; todas: Fondo[]; money: (n: number) => string; mes: string | null; busy: boolean; onToggle: () => void; acciones: ReactNode; dnd: DndItem; asa: ReactNode }) {
  const f = r.fondo
  const { Icon, color } = fondoLook(f, todas)
  const pct = r.pct ?? 0
  return (
    <li {...dnd} className={`${CLASE_ARRASTRE} relative flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgb(15_23_42/0.07)] ${f.activo ? '' : 'opacity-75'}`} data-testid="fondo">
      <span className="h-1.5" style={{ background: f.activo ? `linear-gradient(90deg, ${color}, ${color}99)` : 'var(--line)' }} aria-hidden />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          {asa}
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: `${color}1A`, color }}><Icon className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink" data-testid="fondo-nombre">{f.nombre}</p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted">{f.recurrencia === 'unica' ? <CalendarDays className="size-3 shrink-0" /> : <CalendarRange className="size-3 shrink-0" />}{recurrenciaTxt(f)}{f.moneda !== 'PEN' ? ` · ${f.moneda}` : ''}</p>
          </div>
          {acciones}
        </div>
        <div className="mt-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] text-muted">{mes ? `Aporta en ${monthLabel(mes, true)}` : 'Aporta en el período'}</p>
            <p className={`tabular truncate text-xl font-bold ${f.activo ? 'text-ink' : 'text-muted line-through decoration-1'}`} data-testid="fondo-aporte">{money(r.asignado)}</p>
            {r.ajustado && <p className="tabular truncate text-[10px] text-muted" data-testid="fondo-base" title="Importe base de la hoja FONDOS_PRESUPUESTO; el período usa un ajuste de FONDOS_PRESUPUESTO_MESES">Base {f.moneda} {f.monto.toFixed(2)} · ajuste de este período</p>}
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
        {!f.activo && <p className="mt-3 rounded-xl bg-bg px-3 py-2 text-[11px] text-muted">Inactivo: queda guardado pero no suma al presupuesto.{r.count ? ` Sus ${r.count} gasto(s) siguen descontando (ver gastos por revisar).` : ''}</p>}
        {busy && <p className="mt-2 text-[11px] text-muted">Guardando…</p>}
      </div>
    </li>
  )
}

function FilaFondo({ r, todas, money, busy, onToggle, acciones, swipe, dnd, asa }: { r: FondoResumen; todas: Fondo[]; money: (n: number) => string; busy: boolean; onToggle: () => void; acciones: ReactNode; swipe: AccionMenu[]; dnd: DndItem; asa: ReactNode }) {
  const f = r.fondo
  const { Icon, color } = fondoLook(f, todas)
  const movil = useEsMovil()
  return (
    <li {...dnd} data-testid="fondo" className={`${CLASE_ARRASTRE} border border-transparent transition hover:bg-bg/60`}>
      <SwipeFila nombre={f.nombre} acciones={swipe} activo={movil} testId="fondo-fila">
        {/* Móvil: línea 1 = asa, icono, nombre, ON/OFF; línea 2 = recurrencia, estado/medio y monto. Escritorio: una fila. */}
        <div className="grid grid-cols-[2rem_2.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 px-2.5 py-2 sm:grid-cols-[2rem_2.5rem_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto_auto] sm:gap-x-3 sm:px-3 sm:py-2.5">
          {asa}
          <span className="grid size-9 place-items-center rounded-xl sm:size-10" style={{ background: `${color}1A`, color }}><Icon className="size-4" /></span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" data-testid="fondo-nombre">{f.nombre}{busy && <span className="ml-2 text-[10px] font-normal text-muted">Guardando…</span>}</p>
            <p className="truncate text-[11px] text-muted">{recurrenciaTxt(f)}</p>
          </div>
          <div className="col-start-3 col-end-4 row-start-2 min-w-0 sm:col-start-4 sm:col-end-5 sm:row-start-1"><Badges r={r} /></div>
          <span className="tabular col-start-4 row-start-2 text-right text-sm font-bold sm:col-start-5 sm:row-start-1" data-testid="fondo-aporte">{money(r.asignado)}</span>
          <div className="col-start-4 row-start-1 sm:col-start-6"><Toggle on={f.activo} onChange={onToggle} label={`${f.activo ? 'Desactivar' : 'Activar'} ${f.nombre}`} disabled={busy} /></div>
          {!movil && acciones}
        </div>
      </SwipeFila>
    </li>
  )
}

function AccionesFondo({ f, puedeOrdenar, first, last, onEdit, onUp, onDown, onClone, onDelete, onPlantilla }: {
  f: Fondo; puedeOrdenar: boolean; first: boolean; last: boolean; onEdit: () => void; onUp: () => void; onDown: () => void; onClone: () => void; onDelete: () => void; onPlantilla: () => void
}) {
  return (
    <div className="relative flex shrink-0 items-center gap-1">
      <BotonEditar label={`Editar fondo ${f.nombre}`} onClick={onEdit} />
      <MenuAcciones label={`Más acciones del fondo ${f.nombre}`} acciones={[
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
function BorrarFondo({ store, r, data, money, onClose, onDesactivar }: {
  store: AppStore; r: FondoResumen; data: AppData; money: (n: number) => string; onClose: () => void; onDesactivar: () => void
}) {
  const f = r.fondo
  const deps = useMemo(() => dependenciasFondo(f, data, todayIn()), [f, data])
  const bloqueada = deps.gastos > 0
  return (
    <Modal open onClose={onClose} size="sm" title={bloqueada ? `No se puede eliminar ${f.nombre}` : `Eliminar ${f.nombre}`} icon={<Trash2 className="size-5" />}
      footer={bloqueada
        ? <><Button variant="outline" onClick={onClose}>Cerrar</Button>{f.activo && <Button onClick={onDesactivar}>Desactivar en su lugar</Button>}</>
        : <><Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" disabled={store.pending.has(`fondo:${f.id}`)} onClick={() => {
            const ok = store.track(`fondo:${f.id}`, { pending: `Eliminando ${f.nombre}…`, ok: `${f.nombre} eliminado. Ningún gasto se borró.`, error: `No se pudo eliminar ${f.nombre}.` },
              () => store.actions.deleteFondo(f.id))
            if (ok) onClose()
          }}><Trash2 className="size-4" /> Eliminar</Button></>}>
      <div className="space-y-3 text-sm" data-testid="eliminar-fondo">
        <p className="font-semibold">“{f.nombre}” · {recurrenciaTxt(f)}{mediosDeFondo(f.medioPago).length ? ` · ${mediosDeFondo(f.medioPago).join(', ')}` : ''}</p>
        {bloqueada ? (
          <p className="rounded-xl px-3 py-2 text-xs" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }} data-testid="fondo-con-gastos">
            Tiene {deps.gastos} gasto(s) atribuido(s) en tu historial. Para no perder la trazabilidad no se elimina.
            {f.activo ? ' Puedes desactivarlo: deja de sumar al presupuesto, conserva su historial y puedes reactivarlo cuando quieras.' : ' Ya está inactivo: queda guardado sin sumar al presupuesto.'}
          </p>
        ) : (
          <>
            <p className="text-muted">No tiene gastos atribuidos. Se eliminará el fondo{deps.ajustes ? ` y sus ${deps.ajustes} importe(s) por mes` : ''}; ningún gasto se borra.</p>
            {f.activo && r.aporta > 0 && <p className="text-xs text-muted">En este período el presupuesto consolidado bajará en <b className="tabular">{money(r.aporta)}</b>.</p>}
          </>
        )}
      </div>
    </Modal>
  )
}

function DesactivarFondo({ r, c, money, periodo, onClose, onConfirm }: { r: FondoResumen; c: CajasResumen; money: (n: number) => string; periodo: string; onClose: () => void; onConfirm: () => void }) {
  const P2 = c.presupuesto - r.aporta
  const gastado = c.gastadoSubcajas + c.gastadoLibre
  return (
    <Modal open onClose={onClose} size="sm" title={`Desactivar ${r.fondo.nombre}`} icon={<AlertTriangle className="size-5" />}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={onConfirm}>Desactivar</Button></>}>
      <div className="space-y-3 text-sm" data-testid="impacto-desactivar">
        <p>En {periodo} el presupuesto consolidado pasará de <b className="tabular">{money(c.presupuesto)}</b> a <b className="tabular">{money(P2)}</b>, y el disponible de <b className="tabular">{money(c.presupuesto - gastado)}</b> a <b className="tabular">{money(P2 - gastado)}</b>.</p>
        {r.count > 0 && <p className="rounded-xl px-3 py-2 text-xs" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }}>
          {r.count} gasto(s) por {money(r.gastado)} están atribuidos a este fondo. {mediosDeFondo(r.fondo.medioPago).length
            ? `Los pagados con ${mediosDeFondo(r.fondo.medioPago).join(', ')} seguirán descontando del presupuesto y se mostrarán como gastos por revisar: no se pasan a otro fondo.`
            : 'Pasarán a la siguiente fondo principal activo (si no hay, se mostrarán como “sin fondo”). Siguen descontando del presupuesto.'}</p>}
        <p className="text-xs text-muted">No se borra el fondo, ni sus importes por mes, ni ningún gasto. Puedes reactivarlo cuando quieras.</p>
      </div>
    </Modal>
  )
}

/* ============================== Crear / editar ============================== */

function FondoForm({ store, fondo, clonDe = null, fondos, meses, mes, hoyMes, monedas, medios, primera, general, money, onClose }: {
  store: AppStore; fondo: Fondo | null; clonDe?: Fondo | null; fondos: Fondo[]; meses: FondoMes[]; mes: string | null; hoyMes: string; monedas: string[]; medios: string[]
  primera: boolean; general: number; money: (n: number) => string; onClose: () => void
}) {
  const editar = !!fondo
  // ID fijo mientras el formulario está abierto: guardar dos veces (doble clic, reintento) actualiza la mismo fondo.
  const [id] = useState(() => fondo?.id ?? `f-${crypto.randomUUID()}`)
  const mesRef = mes ?? hoyMes
  // Clonar: parte de la configuración de la original (sin gastos ni importes por mes) y nace INACTIVA: no suma dinero
  // al presupuesto hasta que el usuario la active y confirme el importe.
  const [nombre, setNombre] = useState(fondo?.nombre ?? (clonDe ? `${clonDe.nombre.slice(0, 31)} (Copia)` : ''))
  const [moneda, setMoneda] = useState(fondo?.moneda ?? clonDe?.moneda ?? monedas[0] ?? 'PEN')
  const [recurrencia, setRecurrencia] = useState<Recurrencia>(fondo?.recurrencia ?? clonDe?.recurrencia ?? 'mensual')
  const [tipo, setTipo] = useState<TipoFondo>(fondo?.tipo ?? clonDe?.tipo ?? 'mensual')
  // Tipo y recurrencia son independientes; solo al crear, si no elegiste tipo, "Solo un mes" sugiere Extra.
  const [tipoElegido, setTipoElegido] = useState(!!(fondo || clonDe))
  const [mesAplic, setMesAplic] = useState(fondo ? fondo.mes : clonDe ? clonDe.mes : mesRef)
  const [elegidos, setElegidos] = useState<string[]>(() => mediosDeFondo(fondo?.medioPago ?? clonDe?.medioPago ?? ''))
  const medio = unirMedios(elegidos)
  const [activo, setActivo] = useState(fondo?.activo ?? (clonDe ? false : true))
  // Importe: al crear es el importe base; al editar es el del mes elegido (solo ese mes o desde ese mes).
  const actualMes = fondo && mes ? fondoMontoMes(fondo, mes, meses) : null
  const [monto, setMonto] = useState(fondo ? String(actualMes ? actualMes.monto : fondo.monto) : clonDe ? String(clonDe.monto) : '')
  const [modo, setModo] = useState<'solo' | 'desde'>('solo')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const tieneSolo = !!fondo && !!mes && meses.some(m => m.fondoId === fondo.id && m.mes === mes && m.modo === 'solo')
  const esMesBase = !!fondo && fondo.recurrencia === 'unica' && recurrencia === 'unica' && mes === mesAplic
  const otras = fondos.filter(f => f.id !== id)
  // Automático: el del medio de pago asociado (Yape se ve como Yape) y, sin medio (fondo libre), el del fondo General.
  const auto = elegidos.length ? medioLook(elegidos[0]) : fondoLook({ nombre: nombre || 'Fondo', medioPago: '', icono: '', color: '' }, otras)
  const { Icon, color } = auto // el aspecto es siempre automático (ya no se elige aquí)
  const mediosOpc = useMemo(() => [...new Set([...elegidos, ...medios])].filter(m => !elegidos.some(e => normName(e) === normName(m))), [elegidos, medios])

  function save() {
    const errs: Record<string, string> = {}
    const m = monto.trim().replace(',', '.')
    if (!nombre.trim()) errs.nombre = 'Escribe un nombre'
    else if (otras.some(f => normName(f.nombre) === normName(nombre))) errs.nombre = 'Ya tienes un fondo con ese nombre'
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(m)) errs.monto = 'Monto mayor o igual a 0, hasta 2 decimales'
    if (!monedas.includes(moneda)) errs.moneda = 'Moneda no permitida'
    if (recurrencia === 'unica' && !MES_RE.test(mesAplic)) errs.mes = 'Elige el mes de aplicación'
    if (mesAplic && !MES_RE.test(mesAplic)) errs.mes = 'Mes inválido'
    if (editar && !mes && Number(m) !== fondo!.monto && !esMesBase) errs.monto = 'Para cambiar un importe, elige un único mes en el período.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const n = Math.round(Number(m) * 100) / 100
    const cambiaImporteMes = editar && !!mes && !esMesBase && actualMes !== null && n !== actualMes.monto
    const orden = fondo?.orden ?? Math.max(0, ...fondos.map(f => f.orden)) + 1
    const base = { id, nombre: nombre.trim(), monto: editar && !esMesBase ? fondo!.monto : n, moneda, color, icono: '', activo, orden, recurrencia, mes: mesAplic, medioPago: medio, tipo }
    const mesAplicacion = MES_RE.test(mesAplic) ? mesAplic : mesRef
    const cambiaConfig = !editar || JSON.stringify({ ...fondo, creadoEn: undefined, actualizadoEn: undefined }) !== JSON.stringify({ ...fondo, ...base, creadoEn: undefined, actualizadoEn: undefined })
    const msgMes = cambiaImporteMes ? (modo === 'desde' ? ` Importe desde ${monthLabel(mes!, true)}: ${money(Math.round(n * 100))}.` : ` Importe de ${monthLabel(mes!, true)}: ${money(Math.round(n * 100))}.`) : ''
    const ok = store.track(`fondo:${id}`, editar
      ? { pending: `Guardando ${base.nombre}…`, ok: `${base.nombre} actualizado.${msgMes}`, error: `No se pudo actualizar ${base.nombre}.` }
      : { pending: `Creando ${base.nombre}…`, ok: activo ? `${base.nombre} creado: suma ${money(Math.round(n * 100))} ${recurrencia === 'unica' ? `en ${monthLabel(mesAplic, true)}` : 'al mes'}.` : `${base.nombre} creado inactivo: no suma al presupuesto hasta que la actives.`, error: `No se pudo crear ${base.nombre}.` },
    async () => {
      if (cambiaConfig) await store.actions.saveFondo(base)
      // v1.19: un fondo nuevo se aplica de forma explícita al mes elegido (cada mes tiene sus propias fondos aplicados).
      if (!editar && recurrencia === 'mensual' && activo && mesAplicacion >= aislaDesde(store.data?.config)) await store.actions.aplicarEntidadesMes('fondo', mesAplicacion, [{ id, monto: n }])
      if (cambiaImporteMes) await store.actions.saveFondoMes({ fondoId: id, mes: mes!, monto: n, modo: recurrencia === 'unica' ? 'solo' : modo })
    })
    if (ok) onClose()
  }
  function quitarAjuste() {
    const ok = store.track(`fondo:${id}`, { pending: 'Quitando el ajuste…', ok: `${fondo!.nombre}: ${monthLabel(mes!, true)} vuelve a su importe habitual.`, error: 'No se pudo quitar el ajuste.' },
      () => store.actions.saveFondoMes({ fondoId: id, mes: mes!, monto: 0, modo: 'solo' }, true))
    if (ok) onClose()
  }

  return (
    <Modal open onClose={onClose} size="md" title={editar ? `Editar ${fondo!.nombre}` : clonDe ? `Clonar ${clonDe.nombre}` : 'Nuevo fondo'} icon={<CircleDollarSign className="size-5" />}
      subtitle="Dinero que suma a tu presupuesto consolidado. No crea gastos ni ingresos contables."
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save}>{editar ? 'Guardar cambios' : clonDe ? 'Crear copia' : 'Crear fondo'}</Button></>}>
      <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); save() }}>
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: `${color}14`, boxShadow: `inset 0 0 0 1px ${color}33` }}>
          <span className="grid size-11 place-items-center rounded-2xl bg-card" style={{ color }}><Icon className="size-5" /></span>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{nombre.trim() || 'Nuevo fondo'}</p>
            <p className="truncate text-[11px] text-muted">{recurrencia === 'unica' ? `Solo ${MES_RE.test(mesAplic) ? monthLabel(mesAplic, true) : '—'}` : mesAplic ? `Todos los meses desde ${monthLabel(mesAplic, true)}` : 'Todos los meses'}</p></div>
        </div>
        {clonDe && (
          <ErrorBox tone="warning" message={activo
            ? `Al crearla, esta copia sumará ${money(Math.round((Number(monto.replace(',', '.')) || 0) * 100))} al presupuesto consolidado (dinero adicional). Revisa el importe o déjala inactiva.`
            : `Es una copia de “${clonDe.nombre}”: no copia gastos ni importes por mes y nace inactiva, así que no suma dinero al presupuesto hasta que la actives.`} />
        )}
        {primera && !editar && general > 0 && (
          <ErrorBox tone="warning" message={`Es tu primer fondo: desde ahora el presupuesto será la suma de fondos y la caja general (${money(general)}/mes) deja de sumar. Si ese dinero sigue disponible, crea primero el fondo General desde el aviso de la pestaña.`} />
        )}
        <Field label="Nombre del fondo" error={errors.nombre} htmlFor="fondo-nombre">
          <input id="fondo-nombre" className={inputCls} maxLength={40} placeholder="Ej. Extra 1, Bonificación, Reembolso" value={nombre} onChange={e => setNombre(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Field label={editar && !esMesBase ? (mes ? `Importe de ${monthLabel(mes, true)}` : 'Importe') : 'Monto'} error={errors.monto} htmlFor="fondo-monto"
            hint={editar && !esMesBase ? (mes ? 'Solo cambia el mes elegido (o desde ese mes); los meses anteriores no se tocan.' : 'Elige un único mes en el período para cambiar un importe.') : undefined}>
            <input id="fondo-monto" className={`${inputCls} tabular h-11 text-base font-semibold`} inputMode="decimal" placeholder="0.00" value={monto} onChange={e => setMonto(e.target.value.replace(/[^\d.,]/g, ''))} />
          </Field>
          <Field label="Moneda" error={errors.moneda} htmlFor="fondo-moneda">
            <Combobox id="fondo-moneda" label="Moneda" value={moneda} onChange={setMoneda} options={monedas.map(x => ({ value: x, label: x }))} />
          </Field>
        </div>
        {editar && mes && !esMesBase && recurrencia === 'mensual' && (
          <Segmented label="Aplicar el importe" value={modo} onChange={setModo}
            options={[{ value: 'solo', label: `Solo ${monthLabel(mes, true)}` }, { value: 'desde', label: `Desde ${monthLabel(mes, true)} en adelante` }]} />
        )}
        {tieneSolo && <button type="button" className="text-xs font-semibold text-navy underline" onClick={quitarAjuste}>Quitar el ajuste de {monthLabel(mes!, true)} (vuelve al importe habitual)</button>}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Tipo de fondo</p>
          <Segmented label="Tipo de fondo" value={tipo} onChange={v => { setTipo(v); setTipoElegido(true) }}
            options={TIPOS_FONDO.map(t => ({ value: t, label: TIPO_FONDO_TXT[t] }))} />
          <p className="mt-1 text-[11px] text-muted" data-testid="fondo-tipo-ayuda">{TIPO_FONDO_AYUDA[tipo]}</p>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">¿Cuándo suma?</p>
          <Segmented label="Recurrencia" value={recurrencia} onChange={v => { setRecurrencia(v); if (v === 'unica' && !mesAplic) setMesAplic(mesRef); if (!tipoElegido) setTipo(v === 'unica' ? 'extra' : 'mensual') }}
            options={[{ value: 'mensual', label: 'Todos los meses' }, { value: 'unica', label: 'Solo un mes' }]} />
          <p className="mt-1 text-[11px] text-muted">{recurrencia === 'unica' ? 'Ideal para un ingreso extraordinario: no se arrastra a otros meses.' : 'Fondo habitual: suma su importe cada mes desde el mes de aplicación.'}</p>
        </div>
        <Field label={recurrencia === 'unica' ? 'Mes de aplicación' : 'Mes de aplicación (desde)'} error={errors.mes} htmlFor="fondo-mes"
          hint={recurrencia === 'mensual' && !mesAplic ? 'Sin mes: suma en todos los meses, también los anteriores.' : undefined}>
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1"><MonthPicker id="fondo-mes" label="Mes de aplicación" value={mesAplic} invalid={!!errors.mes} onChange={setMesAplic} /></span>
            {recurrencia === 'mensual' && mesAplic && <button type="button" className="shrink-0 text-xs text-muted underline" onClick={() => setMesAplic('')}>Todos</button>}
          </span>
        </Field>
        <Field label="Medios de pago asociados (opcional)" error={errors.medio} htmlFor="fondo-medio"
          hint="Los gastos pagados con esos medios se atribuyen a este fondo. El importe no se divide entre medios. Varios fondos pueden compartir un medio; se usan en el orden de la lista. No cambia ningún gasto.">
          <div className="space-y-2">
            <ul className="flex flex-wrap gap-1.5" aria-label="Medios elegidos" data-testid="fondo-medios">
              {!elegidos.length && <li className="rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-muted">Ninguno (fondo libre)</li>}
              {elegidos.map(m => { const l = medioLook(m); return (
                <li key={m} className="flex items-center gap-1.5 rounded-full py-1 pr-1 pl-2 text-xs font-medium" style={{ background: `${l.color}1A`, color: l.color }}>
                  <l.Icon className="size-3.5" />{m}
                  <button type="button" aria-label={`Quitar ${m}`} onClick={() => setElegidos(xs => xs.filter(x => x !== m))} className="grid size-5 place-items-center rounded-full hover:bg-black/10"><X className="size-3" /></button>
                </li>) })}
            </ul>
            <Combobox id="fondo-medio" label="Agregar medio de pago" value="" onChange={v => setElegidos(xs => v === NINGUNO ? [] : [...xs, v])} placeholder="Agregar medio de pago…"
              options={[{ value: NINGUNO, label: 'Ninguno (fondo libre)' }, ...mediosOpc.map(x => { const l = medioLook(x); return { value: x, label: x, Icon: l.Icon, color: l.color } })]} />
          </div>
        </Field>
        <div className="rounded-xl border border-line p-3">
          <Switch checked={activo} onChange={setActivo} label="Fondo activo" />
          <p className="mt-1 text-[11px] text-muted">Inactivo: queda guardado pero no suma al presupuesto.</p>
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
