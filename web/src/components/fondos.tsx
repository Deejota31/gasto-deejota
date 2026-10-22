import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CalendarDays, CalendarRange, CircleDollarSign, Copy, CreditCard, Eye, FilePlus2, LayoutGrid,
  Layers, List, Lock, Pencil, Search, Shapes, Trash2,
} from 'lucide-react'
import { aislaDesde, fondoMontoMes, type FondoResumen, type PresupuestoResumen } from '../lib/engine'
import { monthLabel, monthsInRange, todayIn } from '../lib/dates'
import { normName, otrosAlFinal } from '../lib/orden'
import { ambitoLook, categoriaLook, fondoLook, medioLook, sortMedios } from '../lib/visual'
import type { AppStore } from '../lib/store'
import { TIPOS_FONDO, TIPO_FONDO_TXT, type AppData, type Filters, type Fondo, type FondoMes, type ModoMedios, type Recurrencia, type ReglaFondo, type Ruta, type TipoCobertura, type TipoFondo } from '../lib/types'
import { dependenciasFondo } from '../lib/dependencias'
import {
  describirCobertura, describirMedios, explicarImputacion, imputacionesDe, reglaActual, TIPO_PARTE_TXT, validarMedioGasto, validarRegla, versionarReglas,
} from '../lib/presupuesto'
import { ctxReparto } from '../lib/useAgregado'
import { unirMedios } from '../lib/fondoMedios'
import { MenuAcciones, type AccionMenu } from './MenuAcciones'
import { BotonEditar, Button, ErrorBox, Field, InfoTooltip, inputCls, Modal, Segmented, Switch } from './ui'
import { Combobox, type Opcion } from './Combobox'
import { MultiSelect } from './shared'
import { COBERTURAS, EditorCobertura, MediosCampos } from './fondoCampos'
import { VacioMes, type PlanificacionApi } from './Planificacion'
import { MonthPicker } from './DatePicker'
import { AsaOrden, AvisoOrden, CLASE_ARRASTRE, useReorden } from './reorden'
import { guardarPref, leerPref } from '../lib/prefs'
import { SwipeFila, useEsMovil } from './swipe'
import type { usePlantillasFin } from './PlantillasFin'

/**
 * Fondos del presupuesto (v1.28): la ÚNICA estructura de presupuesto. Cada fondo activo suma su importe del mes al presupuesto
 * consolidado y cubre los gastos que sus reglas indican (medios + cobertura). Todo pasa por el motor (lib/presupuesto.ts):
 * esta pantalla solo muestra y edita, no calcula por su cuenta.
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
export const monedasDe = (config: Record<string, string>) => [...new Set([config.moneda || 'PEN', ...String(config.monedas ?? '').split(',').map(x => x.trim()).filter(Boolean)])]

type Vista = 'grid' | 'lista'
type FiltroEstado = 'todas' | 'activas' | 'inactivas'

/** Botones de la cabecera de Presupuestos: los abre esta sección (que tiene el formulario). */
export interface AccionesFondos { nuevo: () => void; mensuales: () => void }

export function FondosSeccion({ store, p, filters, mes, money, periodo, hoyMes, plantillas, plan, cabecera }: {
  plan: PlanificacionApi; plantillas: ReturnType<typeof usePlantillasFin>; store: AppStore; p: PresupuestoResumen; filters: Filters; mes: string | null
  money: (n: number) => string; periodo: string; hoyMes: string; cabecera: (a: AccionesFondos) => ReactNode
}) {
  const data = store.data!
  // v1.19: en un mes con aislamiento solo se listan los fondos aplicados a ese mes; el resto sigue existiendo y se aplica desde la planificación.
  const todosLosFondos = p.fondos
  const fondos = useMemo(() => todosLosFondos.filter(r => r.aplicada || !r.fondo.activo), [todosLosFondos])
  const ocultas = todosLosFondos.length - fondos.length
  const mesVacio = !!mes && mes >= aislaDesde(data.config) && !fondos.some(r => r.aplicada)
  const todas = useMemo(() => todosLosFondos.map(r => r.fondo), [todosLosFondos])
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState<FiltroEstado>('todas')
  const [tipo, setTipo] = useState<string[]>([])
  const [ambito, setAmbito] = useState<string[]>([])
  const [categoria, setCategoria] = useState<string[]>([])
  const [medio, setMedio] = useState<string[]>([])
  const [vista, setVistaState] = useState<Vista>(() => leerPref('deejota.vista.fondos', ['grid', 'lista'] as const, 'lista'))
  const setVista = (v: Vista) => { setVistaState(v); guardarPref('deejota.vista.fondos', v) }
  const [form, setForm] = useState<{ fondo: Fondo | null; clonDe?: Fondo | null; key: number } | null>(null)
  const [borrar, setBorrar] = useState<FondoResumen | null>(null)
  const [desactivar, setDesactivar] = useState<FondoResumen | null>(null)
  const [detalle, setDetalle] = useState<string | null>(null)
  const term = normName(q)
  const cubre = (r: FondoResumen, campo: 'ambito' | 'categoria', vs: string[]) => !vs.length || r.regla.cobertura === 'todos' || r.regla.rutas.some(ru => !ru[campo] || vs.some(v => normName(ru[campo]) === normName(v)))
  const filtrando = !!term || estado !== 'todas' || !!tipo.length || !!ambito.length || !!categoria.length || !!medio.length
  const visibles = fondos
    .filter(r => estado === 'todas' || (estado === 'activas') === r.fondo.activo)
    .filter(r => !tipo.length || tipo.includes(r.fondo.tipo))
    .filter(r => cubre(r, 'ambito', ambito) && cubre(r, 'categoria', categoria))
    .filter(r => !medio.length || medio.some(md => r.regla.medios === 'todos' || (r.regla.medios === 'solo') === r.regla.listaMedios.some(m => normName(m) === normName(md))))
    .filter(r => !term || normName(`${r.fondo.nombre} ${describirCobertura(r.regla)} ${describirMedios(r.regla)}`).includes(term))
  const ids = todosLosFondos.map(r => r.fondo.id)
  const ambitos = useMemo(() => [...new Set(data.catalogo.filter(c => c.activo !== false).map(c => c.ambito))], [data.catalogo])
  const categorias = useMemo(() => otrosAlFinal([...new Set(data.catalogo.filter(c => c.activo !== false && c.categoria && (!ambito.length || ambito.includes(c.ambito))).map(c => c.categoria))].sort((a, b) => a.localeCompare(b))), [data.catalogo, ambito])

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
  // Arrastrar y soltar: solo con la lista completa (sin búsqueda ni filtros); guarda UNA vez al soltar.
  const puedeArrastrar = !filtrando && ocultas === 0 && fondos.length > 1
  const motivoNoArrastrar = ocultas > 0 ? 'Hay fondos sin aplicar a este mes' : filtrando ? 'Quita la búsqueda y los filtros para reordenar' : 'Se necesitan al menos dos fondos'
  const dnd = useReorden({ ids, habilitado: puedeArrastrar, nombre: id => fondos.find(r => r.fondo.id === id)?.fondo.nombre ?? 'Fondo',
    onCommit: xs => store.track('fondos:orden', { pending: 'Guardando el orden…', ok: 'Orden de fondos guardado.', error: 'No se pudo guardar el orden de los fondos. Se restauró el anterior.' },
      () => store.actions.reorderFondos(xs), { retry: false }) })
  const guardarEstado = (f: Fondo, on: boolean) => store.track(`fondo:${f.id}`,
    { pending: on ? `Activando ${f.nombre}…` : `Desactivando ${f.nombre}…`, ok: `${f.nombre} ${on ? 'activado: vuelve a sumar al presupuesto' : 'desactivado: ya no suma al presupuesto. No se borró nada'}.`, error: `No se pudo ${on ? 'activar' : 'desactivar'} ${f.nombre}.` },
    () => store.actions.saveFondo({ ...f, activo: on }))
  // Antes de apagar un fondo que aporta o tiene gastos imputados se muestra el impacto; encender es directo.
  const alternar = (r: FondoResumen) => {
    if (r.fondo.activo && (r.aporta > 0 || r.count > 0)) setDesactivar(r)
    else guardarEstado(r.fondo, !r.fondo.activo)
  }
  const limpiar = () => { setQ(''); setEstado('todas'); setTipo([]); setAmbito([]); setCategoria([]); setMedio([]) }
  const rDetalle = detalle ? todosLosFondos.find(r => r.fondo.id === detalle) ?? null : null

  return (
    <>
      {cabecera({ nuevo: () => abrir(null), mensuales: () => plantillas.abrir() })}
      <section className="rounded-3xl border border-line bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_8px_24px_rgb(15_23_42/0.04)] sm:p-5" aria-label="Fondos del presupuesto">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <span className="grid size-8 place-items-center rounded-xl" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}><CircleDollarSign className="size-4" /></span>
              Fondos del presupuesto <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-semibold text-muted" data-testid="n-fondos">{fondos.length}</span>
              <InfoTooltip title="Cómo se reparten los gastos" align="left">
                <p>El <b>presupuesto consolidado</b> es la suma de lo que aporta cada fondo <b>activo</b> en el período.</p>
                <p>Cada gasto va a los fondos que lo cubren y aceptan su medio de pago. Primero el fondo dedicado a ese medio, luego el más específico (subcategoría &gt; categoría &gt; ámbito &gt; todos los gastos) y, a igual nivel, tu orden manual.</p>
                <p>Si un fondo se agota, el resto pasa al siguiente compatible y al final a un fondo que cubre todos los gastos (como General), que puede quedar en negativo. Un gasto nunca se pierde ni se duplica.</p>
                <p>Cambiar las reglas de un fondo afecta desde el mes actual: los meses anteriores conservan las suyas.</p>
              </InfoTooltip>
            </h2>
            <p className="mt-0.5 text-xs text-muted">{`${p.activos} activo${p.activos === 1 ? '' : 's'} · aportan ${money(p.total)} en ${periodo}`}</p>
          </div>
        </div>

        {mesVacio && (
          <div className="mb-4"><VacioMes mes={mes!} nOcultas={ocultas} onConfigurar={() => abrir(null)} onPlantillas={() => plantillas.abrir()} onAnterior={() => plan.usarAnterior(mes!)} /></div>
        )}

        {!todosLosFondos.length && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-10 text-center" data-testid="vacio-fondos">
            <span className="grid size-12 place-items-center rounded-2xl" style={{ background: TONO.info.bg, color: TONO.info.fg }}><CircleDollarSign className="size-6" /></span>
            <p className="text-sm font-semibold text-ink">Aún no tienes fondos registrados. Registra un fondo para empezar</p>
            <p className="max-w-md text-xs text-muted">Un fondo es un presupuesto asignado (General, Sodexo, Auto, Viaje…): suma al mes en que lo apliques y cubre los gastos que elijas.</p>
          </div>
        )}

        {p.avisosConfig.length > 0 && (
          <div className="mb-3 space-y-1 rounded-2xl px-4 py-3 text-xs" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }} data-testid="avisos-config">
            <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" /> Revisa la configuración de tus fondos</p>
            {p.avisosConfig.map(t => <p key={t}>{t}</p>)}
          </div>
        )}

        {fondos.length > 0 && (
          <div className="mb-3 grid gap-2 rounded-2xl bg-bg/70 p-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))_auto]" data-testid="filtros-fondos">
            <label className="relative sm:col-span-2 lg:col-span-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input aria-label="Buscar fondo" className={`${inputCls} h-11 pl-9`} placeholder="Buscar fondo…" value={q} onChange={e => setQ(e.target.value)} />
            </label>
            <Combobox label="Filtrar fondos por estado" caption="Estado" value={estado} onChange={v => setEstado((v || 'todas') as FiltroEstado)} leading={<CircleDollarSign />}
              options={[{ value: 'todas', label: 'Activos e inactivos' }, { value: 'activas', label: 'Activos' }, { value: 'inactivas', label: 'Inactivos' }]} />
            <MultiSelect label="Tipo" icon={<Layers />} allLabel="Todos los tipos" value={tipo} onChange={setTipo} options={TIPOS_FONDO.map(t => ({ value: t, label: TIPO_FONDO_TXT[t] }))} />
            <MultiSelect label="Ámbito" icon={<Layers />} allLabel="Todos los ámbitos" value={ambito} options={ambitos.map(a => ({ value: a, label: a, look: ambitoLook(a, data.catalogo) }))}
              onChange={v => { setAmbito(v); setCategoria([]) }} />
            <MultiSelect label="Categoría" icon={<Shapes />} allLabel="Todas las categorías" value={categoria} options={categorias.map(c => ({ value: c, label: c, look: categoriaLook(c, data.catalogo) }))} onChange={setCategoria} />
            <MultiSelect label="Medio de pago" icon={<CreditCard />} allLabel="Todos los medios" value={medio} options={sortMedios(data.medios.map(m => m.nombre)).map(m => ({ value: m, label: m, look: medioLook(m) }))} onChange={setMedio} />
            <div className="flex items-center gap-1 justify-self-end rounded-xl bg-card p-1 ring-1 ring-line" role="radiogroup" aria-label="Vista de fondos">
              {([['grid', LayoutGrid, 'Tarjetas'], ['lista', List, 'Lista']] as const).map(([v, Icon, l]) => (
                <button key={v} type="button" role="radio" aria-checked={vista === v} aria-label={l} title={l} onClick={() => setVista(v)}
                  className={`grid size-9 place-items-center rounded-lg transition ${vista === v ? 'bg-primary-soft text-navy' : 'text-muted hover:bg-bg'}`}><Icon className="size-4" /></button>
              ))}
            </div>
          </div>
        )}
        {filtrando && (
          <p className="-mt-1 mb-3 flex flex-wrap items-center gap-2 px-1 text-xs text-muted" data-testid="filtros-activos">
            <span className="rounded-full bg-primary-soft px-2 py-0.5 font-semibold text-navy">{[term, estado !== 'todas', tipo.length, ambito.length, categoria.length, medio.length].filter(Boolean).length} filtro(s) activo(s)</span>
            Mostrando {visibles.length} de {fondos.length}
            <button type="button" className="font-semibold text-navy underline" onClick={limpiar}>Limpiar filtros</button>
          </p>
        )}
        {fondos.length > 1 && <p className="-mt-1 mb-3 px-1 text-[11px] text-muted">{puedeArrastrar ? 'Arrastra el asa ⠿ para reordenar: entre fondos del mismo nivel, el orden decide cuál se usa primero.' : `Orden manual: ${motivoNoArrastrar.toLowerCase()}.`}</p>}

        {fondos.length > 0 && !visibles.length ? (
          <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">Ningún fondo coincide. <button className="font-semibold text-navy underline" onClick={limpiar}>Limpiar filtros</button></div>
        ) : fondos.length > 0 && (() => {
          const porId = new Map(visibles.map(r => [r.fondo.id, r]))
          const ordenadas = (puedeArrastrar ? dnd.orden : visibles.map(r => r.fondo.id)).map(id => porId.get(id)).filter((r): r is FondoResumen => !!r)
          const acc = (r: FondoResumen) => <AccionesFondo f={r.fondo} puedeOrdenar={!filtrando} first={ids[0] === r.fondo.id} last={ids.at(-1) === r.fondo.id}
            onEdit={() => abrir(r.fondo)} onUp={() => mover(r.fondo.id, -1)} onDown={() => mover(r.fondo.id, 1)} onClone={() => clonar(r.fondo)} onDelete={() => setBorrar(r)} onPlantilla={() => plantillas.guardarComoPlantilla(r.fondo.id)} />
          const swipe = (r: FondoResumen): AccionMenu[] => [
            { key: 'ver', label: 'Detalle', icon: <Eye className="size-4" />, onClick: () => setDetalle(r.fondo.id) },
            { key: 'edit', label: 'Editar', icon: <Pencil className="size-4" />, onClick: () => abrir(r.fondo) },
            { key: 'clone', label: 'Clonar', icon: <Copy className="size-4" />, onClick: () => clonar(r.fondo) },
            { key: 'delete', label: 'Eliminar', icon: <Trash2 className="size-4" />, onClick: () => setBorrar(r), danger: true },
          ]
          const asa = (r: FondoResumen) => <AsaOrden {...dnd.asa(r.fondo.id)} habilitado={puedeArrastrar} motivo={motivoNoArrastrar} />
          const nombres = new Map(todas.map(f => [f.id, f.nombre]))
          return vista === 'grid' ? (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Lista de fondos">
              {ordenadas.map(r => <TarjetaFondo key={r.fondo.id} r={r} todas={todas} nombres={nombres} money={money} mes={mes} busy={store.pending.has(`fondo:${r.fondo.id}`)} onToggle={() => alternar(r)}
                onVer={() => setDetalle(r.fondo.id)} dnd={dnd.item(r.fondo.id)} asa={asa(r)} acciones={acc(r)} />)}
            </ul>
          ) : (
            <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line" aria-label="Lista de fondos">
              {ordenadas.map(r => <FilaFondo key={r.fondo.id} r={r} todas={todas} nombres={nombres} money={money} busy={store.pending.has(`fondo:${r.fondo.id}`)} onToggle={() => alternar(r)}
                onVer={() => setDetalle(r.fondo.id)} dnd={dnd.item(r.fondo.id)} asa={asa(r)} acciones={acc(r)} swipe={swipe(r)} />)}
            </ul>
          )
        })()}
        <AvisoOrden texto={dnd.aviso} />

        {(p.sinFondo.count > 0 || p.incompatibles > 0 || p.conflictos > 0) && (
          <div className="mt-3 space-y-1 rounded-2xl px-4 py-3 text-xs" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }} data-testid="revision-fondos">
            <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" /> Gastos por revisar en los fondos</p>
            {p.sinFondo.count > 0 && <p>{p.sinFondo.count} gasto(s) por {money(p.sinFondo.cents)} no los cubre ningún fondo activo (sin fondo asignable). Siguen descontando del presupuesto consolidado.</p>}
            {p.incompatibles > 0 && <p>{p.incompatibles} gasto(s) usan un medio de pago fuera de la cobertura que le configuraste. Corrige su medio o su clasificación desde Gastos.</p>}
            {p.conflictos > 0 && <p>{p.conflictos} asignación(es) manual(es) ya no son válidas; esos gastos usan la asignación automática. Revísalas desde el detalle del gasto.</p>}
          </div>
        )}

        {form && <FondoForm key={form.key} store={store} fondo={form.fondo} clonDe={form.clonDe ?? null} fondos={todas} meses={data.fondosMeses ?? []} mes={mes} hoyMes={hoyMes}
          monedas={monedasDe(data.config)} money={money} onClose={() => setForm(null)} />}
        {borrar && <BorrarFondo store={store} r={borrar} data={data} money={money} onClose={() => setBorrar(null)} onDesactivar={() => { const x = borrar; setBorrar(null); if (x.fondo.activo) alternar(x) }} />}
        {desactivar && <DesactivarFondo r={desactivar} p={p} money={money} periodo={periodo} onClose={() => setDesactivar(null)}
          onConfirm={() => { guardarEstado(desactivar.fondo, false); setDesactivar(null) }} />}
        {rDetalle && <DetalleFondo r={rDetalle} data={data} filters={filters} money={money} periodo={periodo} onClose={() => setDetalle(null)} onEditar={() => { setDetalle(null); abrir(rDetalle.fondo) }} />}
      </section>
    </>
  )
}

const ESTADO_FONDO: Record<FondoResumen['estado'], { txt: string; tono: { fg: string; bg: string } }> = {
  inactivo: { txt: 'Inactivo', tono: TONO.neutro }, sin_importe: { txt: 'Sin importe en el período', tono: TONO.neutro },
  disponible: { txt: 'Con saldo', tono: TONO.ok }, cerca: { txt: 'Cerca del límite', tono: TONO.atencion },
  agotado: { txt: 'Agotado', tono: TONO.atencion }, sobregirado: { txt: 'Sobregirado', tono: TONO.alerta },
}
function estadoFondo(r: FondoResumen) {
  if (r.sinTipoCambio && r.fondo.activo) return { txt: 'Sin tipo de cambio', tono: TONO.alerta }
  return ESTADO_FONDO[r.estado]
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return <Switch estado checked={on} onChange={() => onChange()} label={label} disabled={disabled} title={on ? 'Activo: suma al presupuesto' : 'Inactivo: no suma'} />
}

const chip = 'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold'
/** Etiqueta de desborde: "Excedente S/ 100 → General". */
export function EtiquetaDesborde({ r, nombres, money }: { r: FondoResumen; nombres: Map<string, string>; money: (n: number) => string }) {
  if (!r.enviado) return null
  const destino = r.destinos.map(d => nombres.get(d) ?? d).join(', ') || 'otro fondo'
  return <span className={chip} style={{ color: TONO.atencion.fg, background: TONO.atencion.bg }} data-testid="desborde" title={`Parte de los gastos que cubre este fondo pasó a ${destino} porque se agotó`}>
    <span className="truncate">Excedente {money(r.enviado)}</span> <ArrowRight className="size-2.5 shrink-0" /> <span className="truncate">{destino}</span></span>
}

function Badges({ r, nombres, money }: { r: FondoResumen; nombres: Map<string, string>; money: (n: number) => string }) {
  const e = estadoFondo(r)
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={chip} style={{ color: e.tono.fg, background: e.tono.bg }} data-testid="estado-fondo">{e.txt}</span>
      <span className={chip} style={{ color: TONO.info.fg, background: TONO.info.bg }}>{TIPO_FONDO_TXT[r.fondo.tipo]}</span>
      {r.regla.restringeMedio && <span className={chip} style={{ color: '#4D7C0F', background: '#F0F9E0' }} title="Este fondo restringe el uso de sus medios de pago"><Lock className="size-2.5" /> {r.regla.listaMedios.join(', ')} exclusivo</span>}
      {r.ajustado && <span className={chip} style={{ color: TONO.atencion.fg, background: TONO.atencion.bg }} title={`Importe base registrado: ${r.fondo.moneda} ${r.fondo.monto.toFixed(2)}. Este período usa un importe propio.`}>Ajustado</span>}
      <EtiquetaDesborde r={r} nombres={nombres} money={money} />
    </span>
  )
}

type DndItem = { ref: (el: HTMLElement | null) => void; 'data-arrastrando'?: string }

function TarjetaFondo({ r, todas, nombres, money, mes, busy, onToggle, onVer, acciones, dnd, asa }: {
  r: FondoResumen; todas: Fondo[]; nombres: Map<string, string>; money: (n: number) => string; mes: string | null; busy: boolean; onToggle: () => void; onVer: () => void; acciones: ReactNode; dnd: DndItem; asa: ReactNode
}) {
  const f = r.fondo
  const { Icon, color } = fondoLook(f, todas)
  const pct = r.pct ?? 0
  const rojo = r.gastado > r.aporta && r.fondo.activo
  return (
    <li {...dnd} className={`${CLASE_ARRASTRE} relative flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgb(15_23_42/0.07)] ${f.activo ? '' : 'opacity-75'}`} data-testid="fondo">
      <span className="h-1.5" style={{ background: f.activo ? `linear-gradient(90deg, ${color}, ${color}99)` : 'var(--line)' }} aria-hidden />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          {asa}
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: `${color}1A`, color }}><Icon className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <button type="button" onClick={onVer} className="block max-w-full truncate text-left text-sm font-semibold text-ink hover:underline" data-testid="fondo-nombre">{f.nombre}</button>
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted">{f.recurrencia === 'unica' ? <CalendarDays className="size-3 shrink-0" /> : <CalendarRange className="size-3 shrink-0" />}{recurrenciaTxt(f)}{f.moneda !== 'PEN' ? ` · ${f.moneda}` : ''}</p>
          </div>
          {acciones}
        </div>
        <div className="mt-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] text-muted">{mes ? `Presupuesto de ${monthLabel(mes, true)}` : 'Presupuesto del período'}</p>
            <p className={`tabular truncate text-xl font-bold ${f.activo ? 'text-ink' : 'text-muted line-through decoration-1'}`} data-testid="fondo-aporte">{money(r.asignado)}</p>
          </div>
          <Toggle on={f.activo} onChange={onToggle} label={`${f.activo ? 'Desactivar' : 'Activar'} ${f.nombre}`} disabled={busy} />
        </div>
        <div className="mt-2"><Badges r={r} nombres={nombres} money={money} /></div>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted" data-testid="fondo-cobertura"><Shapes className="mt-0.5 size-3 shrink-0" /><span className="line-clamp-2">{describirCobertura(r.regla)}</span></p>
        <p className="mt-0.5 flex items-start gap-1.5 text-[11px] text-muted" data-testid="fondo-medios"><CreditCard className="mt-0.5 size-3 shrink-0" /><span className="truncate">{describirMedios(r.regla)}</span></p>
        {f.activo && r.aporta > 0 && (
          <>
            <div className="mt-3 flex items-center gap-2">
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-bg" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Consumido de ${f.nombre}`}>
                <span className="bar-grow block h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: rojo ? TONO.alerta.fg : color }} />
              </span>
              <span className="tabular w-12 text-right text-xs font-bold">{r.pct === null ? '—' : `${r.pct}%`}</span>
            </div>
            <p className="tabular mt-1 text-[11px] text-muted">Gastado {money(r.gastado)} · disponible <b style={{ color: r.disponible < 0 ? TONO.alerta.fg : TONO.ok.fg }} data-testid="fondo-disponible">{money(r.disponible)}</b> · {r.count} mov.</p>
          </>
        )}
        {f.activo && !r.aporta && r.gastado > 0 && <p className="tabular mt-3 text-[11px]" style={{ color: TONO.alerta.fg }}>Sin importe en el período, pero tiene {money(r.gastado)} imputados.</p>}
        {!f.activo && <p className="mt-3 rounded-xl bg-bg px-3 py-2 text-[11px] text-muted">Inactivo: queda guardado pero no suma al presupuesto ni recibe gastos.</p>}
        {busy && <p className="mt-2 text-[11px] text-muted">Guardando…</p>}
      </div>
    </li>
  )
}

function FilaFondo({ r, todas, nombres, money, busy, onToggle, onVer, acciones, swipe, dnd, asa }: {
  r: FondoResumen; todas: Fondo[]; nombres: Map<string, string>; money: (n: number) => string; busy: boolean; onToggle: () => void; onVer: () => void; acciones: ReactNode; swipe: AccionMenu[]; dnd: DndItem; asa: ReactNode
}) {
  const f = r.fondo
  const { Icon, color } = fondoLook(f, todas)
  const movil = useEsMovil()
  return (
    <li {...dnd} data-testid="fondo" className={`${CLASE_ARRASTRE} border border-transparent transition hover:bg-bg/60`}>
      <SwipeFila nombre={f.nombre} acciones={swipe} activo={movil} testId="fondo-fila">
        <div className="grid grid-cols-[2rem_2.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 px-2.5 py-2 sm:grid-cols-[2rem_2.5rem_minmax(0,1.3fr)_minmax(0,1.2fr)_6.5rem_6.5rem_auto_auto] sm:gap-x-3 sm:px-3 sm:py-2.5">
          {asa}
          <span className="grid size-9 place-items-center rounded-xl sm:size-10" style={{ background: `${color}1A`, color }}><Icon className="size-4" /></span>
          <div className="min-w-0">
            <button type="button" onClick={onVer} className="block max-w-full truncate text-left text-sm font-semibold hover:underline" data-testid="fondo-nombre">{f.nombre}{busy && <span className="ml-2 text-[10px] font-normal text-muted">Guardando…</span>}</button>
            <p className="truncate text-[11px] text-muted">{recurrenciaTxt(f)} · {describirCobertura(r.regla)}</p>
          </div>
          <div className="col-start-3 col-end-4 row-start-2 min-w-0 sm:col-start-4 sm:col-end-5 sm:row-start-1"><Badges r={r} nombres={nombres} money={money} /></div>
          <span className="tabular col-start-4 row-start-2 text-right text-sm font-bold sm:col-start-5 sm:row-start-1" data-testid="fondo-aporte">{money(r.asignado)}</span>
          <span className="tabular hidden text-right text-sm font-semibold sm:col-start-6 sm:row-start-1 sm:block" style={{ color: r.fondo.activo && r.disponible < 0 ? TONO.alerta.fg : 'var(--ink)' }} title="Disponible" data-testid="fondo-disponible">{r.fondo.activo ? money(r.disponible) : '—'}</span>
          <div className="col-start-4 row-start-1 sm:col-start-7"><Toggle on={f.activo} onChange={onToggle} label={`${f.activo ? 'Desactivar' : 'Activar'} ${f.nombre}`} disabled={busy} /></div>
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
        { key: 'clone', label: 'Clonar', icon: <Copy className="size-3.5" />, onClick: onClone },
        { key: 'tpl', label: 'Guardar como plantilla', icon: <FilePlus2 className="size-3.5" />, onClick: onPlantilla },
        { key: 'up', label: 'Subir', icon: <ArrowUp className="size-3.5" />, onClick: onUp, disabled: !puedeOrdenar || first, title: puedeOrdenar ? undefined : 'Quita la búsqueda y los filtros para reordenar' },
        { key: 'down', label: 'Bajar', icon: <ArrowDown className="size-3.5" />, onClick: onDown, disabled: !puedeOrdenar || last, title: puedeOrdenar ? undefined : 'Quita la búsqueda y los filtros para reordenar' },
        { key: 'delete', label: 'Eliminar', icon: <Trash2 className="size-3.5" />, onClick: onDelete, danger: true },
      ]} />
    </div>
  )
}

/** Eliminar: verifica dependencias (gastos imputados en todo el historial, importes por mes, asignaciones manuales). Con gastos NO se elimina. */
function BorrarFondo({ store, r, data, money, onClose, onDesactivar }: {
  store: AppStore; r: FondoResumen; data: AppData; money: (n: number) => string; onClose: () => void; onDesactivar: () => void
}) {
  const f = r.fondo
  const deps = useMemo(() => dependenciasFondo(f, data, todayIn()), [f, data])
  const bloqueada = deps.gastos > 0 || deps.manuales > 0
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
        <p className="font-semibold">“{f.nombre}” · {recurrenciaTxt(f)} · {describirMedios(r.regla)}</p>
        {bloqueada ? (
          <p className="rounded-xl px-3 py-2 text-xs" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }} data-testid="fondo-con-gastos">
            {deps.gastos > 0 ? `Tiene ${deps.gastos} gasto(s) imputado(s) en tu historial` : `${deps.manuales} gasto(s) lo usan en una asignación manual`}. Para no perder la trazabilidad no se elimina.
            {f.activo ? ' Puedes desactivarlo: deja de sumar al presupuesto, conserva su historial y puedes reactivarlo cuando quieras.' : ' Ya está inactivo: queda guardado sin sumar al presupuesto.'}
          </p>
        ) : (
          <>
            <p className="text-muted">No tiene gastos imputados. Se eliminará el fondo{deps.ajustes ? ` y sus ${deps.ajustes} importe(s) por mes` : ''}; ningún gasto se borra.</p>
            {f.activo && r.aporta > 0 && <p className="text-xs text-muted">En este período el presupuesto consolidado bajará en <b className="tabular">{money(r.aporta)}</b>.</p>}
          </>
        )}
      </div>
    </Modal>
  )
}

function DesactivarFondo({ r, p, money, periodo, onClose, onConfirm }: { r: FondoResumen; p: PresupuestoResumen; money: (n: number) => string; periodo: string; onClose: () => void; onConfirm: () => void }) {
  const P2 = p.presupuesto - r.aporta
  return (
    <Modal open onClose={onClose} size="sm" title={`Desactivar ${r.fondo.nombre}`} icon={<AlertTriangle className="size-5" />}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={onConfirm}>Desactivar</Button></>}>
      <div className="space-y-3 text-sm" data-testid="impacto-desactivar">
        <p>En {periodo} el presupuesto consolidado pasará de <b className="tabular">{money(p.presupuesto)}</b> a <b className="tabular">{money(P2)}</b>, y el disponible de <b className="tabular">{money(p.disponible)}</b> a <b className="tabular">{money(P2 - p.gastadoPeriodo)}</b>.</p>
        {r.count > 0 && <p className="rounded-xl px-3 py-2 text-xs" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }}>
          {r.count} gasto(s) tienen {money(r.gastado)} imputados a este fondo. Pasarán a los otros fondos compatibles o quedarán sin fondo asignable; siguen descontando del presupuesto.</p>}
        <p className="text-xs text-muted">No se borra el fondo, ni sus importes por mes, ni ningún gasto. Puedes reactivarlo cuando quieras.</p>
      </div>
    </Modal>
  )
}

/* ============================== Detalle de un fondo ============================== */

function DetalleFondo({ r, data, filters, money, periodo, onClose, onEditar }: {
  r: FondoResumen; data: AppData; filters: Filters; money: (n: number) => string; periodo: string; onClose: () => void; onEditar: () => void
}) {
  const f = r.fondo
  const nombres = useMemo(() => new Map((data.fondos ?? []).map(x => [x.id, x.nombre])), [data.fondos])
  const nombre = (id: string) => nombres.get(id) ?? id
  const meses = monthsInRange(filters.desde, filters.hasta)
  const imps = useMemo(() => imputacionesDe(data.gastos, data.fondos ?? [], ctxReparto(data), meses), [data, meses.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const porId = useMemo(() => new Map(data.gastos.map(g => [g.id, g])), [data.gastos])
  const movs = [...imps.values()].filter(i => i.partes.some(p => p.fondoId === f.id)).map(i => ({ i, g: porId.get(i.gastoId)! })).filter(x => x.g && x.g.fecha >= filters.desde && x.g.fecha <= filters.hasta)
    .sort((a, b) => b.g.fecha.localeCompare(a.g.fecha))
  const enviados = [...imps.values()].filter(i => i.excedente > 0 && i.origen.at(-1) === f.id).map(i => ({ i, g: porId.get(i.gastoId)! })).filter(x => x.g && x.g.fecha >= filters.desde && x.g.fecha <= filters.hasta)
  const [ver, setVer] = useState(12)
  return (
    <Modal open onClose={onClose} size="lg" title={f.nombre} subtitle={`${TIPO_FONDO_TXT[f.tipo]} · ${recurrenciaTxt(f)} · ${periodo}`} icon={<CircleDollarSign className="size-5" />}
      footer={<><Button variant="outline" onClick={onClose}>Cerrar</Button><Button onClick={onEditar}><Pencil className="size-4" /> Editar fondo</Button></>}>
      <div className="space-y-4 text-sm" data-testid="detalle-fondo">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([['Presupuesto', money(r.aporta || r.asignado)], ['Gastado imputado', money(r.gastado)], ['Disponible', f.activo ? money(r.disponible) : '—'], ['Movimientos', String(r.count)]] as const).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-bg px-3 py-2"><dt className="text-[11px] text-muted">{k}</dt><dd className="tabular font-semibold" style={k === 'Disponible' && r.disponible < 0 && f.activo ? { color: TONO.alerta.fg } : undefined}>{v}</dd></div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2 text-xs">
          {r.manual > 0 && <span className="rounded-full bg-bg px-2.5 py-1">Asignado a mano: <b className="tabular">{money(r.manual)}</b></span>}
          {r.enviado > 0 && <span className="rounded-full px-2.5 py-1" style={{ background: TONO.atencion.bg, color: TONO.atencion.fg }}>Excedentes enviados: <b className="tabular">{money(r.enviado)}</b> → {r.destinos.map(nombre).join(', ')}</span>}
          {r.recibido > 0 && <span className="rounded-full px-2.5 py-1" style={{ background: TONO.info.bg, color: TONO.info.fg }}>Excedentes recibidos: <b className="tabular">{money(r.recibido)}</b></span>}
        </div>
        <section>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Reglas</h3>
          <ul className="space-y-1.5">
            {[...f.reglas].reverse().map(v => (
              <li key={v.desde || 'base'} className="rounded-xl border border-line px-3 py-2 text-xs">
                <p className="font-semibold text-ink">{v.desde ? `Desde ${monthLabel(v.desde, true)}` : 'Desde siempre'}{v === reglaActual(f) ? ' · vigente' : ''}</p>
                <p className="text-muted">Cubre: {describirCobertura(v)}</p>
                <p className="text-muted">Medios: {describirMedios(v)}{v.restringeMedio ? ' · uso exclusivo de esos medios para esta cobertura' : ''}</p>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Imputaciones del período · {movs.length}</h3>
          {!movs.length ? <p className="rounded-xl bg-bg px-3 py-3 text-xs text-muted">Ningún gasto imputado a este fondo en {periodo}.</p> : (
            <ul className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line" data-testid="imputaciones-fondo">
              {movs.slice(0, ver).map(({ i, g }) => {
                const partes = i.partes.filter(p => p.fondoId === f.id)
                return (
                  <li key={g.uid ?? g.id} className="px-3 py-2 text-xs">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate"><b className="text-ink">{g.descripcion || g.subcategoria}</b> <span className="text-muted">· {g.fecha} · {g.categoria} › {g.subcategoria} · {g.medioPago}</span></span>
                      <span className="tabular shrink-0 font-semibold">{money(partes.reduce((s, p) => s + p.cents, 0))}</span>
                    </div>
                    <p className="text-muted">{partes.map(p => TIPO_PARTE_TXT[p.tipo]).join(' + ')}{i.total !== partes.reduce((s, p) => s + p.cents, 0) ? ` · de un gasto de ${money(i.total)}` : ''}. {explicarImputacion(i, nombre, money)}</p>
                  </li>
                )
              })}
            </ul>
          )}
          {movs.length > ver && <div className="mt-2 text-center"><Button variant="ghost" className="text-xs" onClick={() => setVer(v => v + 30)}>Ver más</Button></div>}
        </section>
        {enviados.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Excedentes enviados a otros fondos</h3>
            <ul className="space-y-1 text-xs">
              {enviados.map(({ i, g }) => <li key={g.id} className="flex justify-between gap-3 rounded-lg bg-bg px-3 py-1.5"><span className="truncate">{g.fecha} · {g.descripcion || g.subcategoria}</span><span className="tabular shrink-0">{money(i.excedente)} → {i.destino.map(nombre).join(', ')}</span></li>)}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  )
}

/* ============================== Crear / editar ============================== */

function FondoForm({ store, fondo, clonDe = null, fondos, meses, mes, hoyMes, monedas, money, onClose }: {
  store: AppStore; fondo: Fondo | null; clonDe?: Fondo | null; fondos: Fondo[]; meses: FondoMes[]; mes: string | null; hoyMes: string; monedas: string[]
  money: (n: number) => string; onClose: () => void
}) {
  const data = store.data!
  const editar = !!fondo
  // ID fijo mientras el formulario está abierto: guardar dos veces (doble clic, reintento) actualiza el mismo fondo.
  const [id] = useState(() => fondo?.id ?? `f-${crypto.randomUUID()}`)
  const mesRef = mes ?? hoyMes
  const origen = fondo ?? clonDe
  const reglaBase = origen ? reglaActual(origen) : null
  // Clonar: parte de la configuración del original (sin gastos ni importes por mes) y nace INACTIVO.
  const [nombre, setNombre] = useState(fondo?.nombre ?? (clonDe ? `${clonDe.nombre.slice(0, 31)} (Copia)` : ''))
  const [moneda, setMoneda] = useState(origen?.moneda ?? monedas[0] ?? 'PEN')
  const [recurrencia, setRecurrencia] = useState<Recurrencia>(origen?.recurrencia ?? 'mensual')
  const [tipo, setTipo] = useState<TipoFondo>(origen?.tipo ?? 'mensual')
  const [tipoElegido, setTipoElegido] = useState(!!origen)
  const [mesAplic, setMesAplic] = useState(fondo ? fondo.mes : clonDe ? clonDe.mes : mesRef)
  const [activo, setActivo] = useState(fondo?.activo ?? (clonDe ? false : true))
  const [modoMedios, setModoMedios] = useState<ModoMedios>(reglaBase?.medios ?? 'todos')
  const [listaMedios, setListaMedios] = useState<string[]>(reglaBase?.listaMedios ?? [])
  const [restringe, setRestringe] = useState(reglaBase?.restringeMedio ?? false)
  const [cobertura, setCobertura] = useState<TipoCobertura>(reglaBase?.cobertura ?? 'todos')
  const [rutas, setRutas] = useState<Ruta[]>(reglaBase?.rutas ?? [])
  // Importe: al crear es el importe base; al editar es el del mes elegido (solo ese mes o desde ese mes).
  const actualMes = fondo && mes ? fondoMontoMes(fondo, mes, meses, aislaDesde(data.config)) : null
  const [monto, setMonto] = useState(fondo ? String(actualMes ? actualMes.monto : fondo.monto) : clonDe ? String(clonDe.monto) : '')
  const [modo, setModo] = useState<'solo' | 'desde'>('solo')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const tieneSolo = !!fondo && !!mes && meses.some(m => m.fondoId === fondo.id && m.mes === mes && m.modo === 'solo')
  const esMesBase = !!fondo && fondo.recurrencia === 'unica' && recurrencia === 'unica' && mes === mesAplic
  const otras = fondos.filter(f => f.id !== id)
  const { Icon, color } = modoMedios === 'solo' && listaMedios.length ? medioLook(listaMedios[0]) : fondoLook({ nombre: nombre || 'Fondo', medioPago: '', icono: '', color: '' }, otras)
  const regla: ReglaFondo = { desde: '', medios: modoMedios, listaMedios: modoMedios === 'todos' ? [] : listaMedios, cobertura, rutas: cobertura === 'todos' ? [] : rutas, restringeMedio: modoMedios === 'solo' && restringe }
  const errorRegla = validarRegla(regla)
  const montoNum = Number(monto.trim().replace(',', '.'))
  // Gastos de este mes que la nueva restricción dejaría fuera (quedan marcados para revisión; no se modifican).
  const afectados = useMemo(() => {
    if (!regla.restringeMedio || errorRegla) return 0
    const prueba = [...otras, { ...(origen ?? {}), id, nombre: nombre || 'Fondo', monto: montoNum || 0, moneda, color: '', icono: '', activo, orden: 0, recurrencia, mes: mesAplic, medioPago: '', tipo, creadoEn: '', actualizadoEn: '', reglas: [regla] } as Fondo]
    return data.gastos.filter(g => g.estado !== 'Anulado' && g.fecha.startsWith(hoyMes) && !validarMedioGasto(g, prueba).ok).length
  }, [JSON.stringify(regla), errorRegla, data.gastos, hoyMes, activo, recurrencia, mesAplic]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (errorRegla) errs.reglas = errorRegla
    setErrors(errs)
    if (Object.keys(errs).length) return
    const n = Math.round(Number(m) * 100) / 100
    const cambiaImporteMes = editar && !!mes && !esMesBase && actualMes !== null && n !== actualMes.monto
    const orden = fondo?.orden ?? Math.max(0, ...fondos.map(f => f.orden)) + 1
    const { desde: _d, ...nueva } = regla
    void _d
    // Reglas versionadas: una edición rige desde el mes actual; los meses anteriores conservan las suyas.
    const reglas = editar ? versionarReglas(fondo!.reglas, nueva, hoyMes) : [{ ...nueva, desde: '' }]
    const base = { id, nombre: nombre.trim(), monto: editar && !esMesBase ? fondo!.monto : n, moneda, color, icono: '', activo, orden, recurrencia, mes: mesAplic, tipo,
      medioPago: modoMedios === 'solo' ? unirMedios(listaMedios) : '', reglas }
    const mesAplicacion = MES_RE.test(mesAplic) ? mesAplic : mesRef
    const cambiaConfig = !editar || JSON.stringify({ ...fondo, creadoEn: undefined, actualizadoEn: undefined }) !== JSON.stringify({ ...fondo, ...base, creadoEn: undefined, actualizadoEn: undefined })
    const msgMes = cambiaImporteMes ? (modo === 'desde' ? ` Importe desde ${monthLabel(mes!, true)}: ${money(Math.round(n * 100))}.` : ` Importe de ${monthLabel(mes!, true)}: ${money(Math.round(n * 100))}.`) : ''
    const ok = store.track(`fondo:${id}`, editar
      ? { pending: `Guardando ${base.nombre}…`, ok: `${base.nombre} actualizado.${msgMes}`, error: `No se pudo actualizar ${base.nombre}.` }
      : { pending: `Creando ${base.nombre}…`, ok: activo ? `${base.nombre} creado: suma ${money(Math.round(n * 100))} ${recurrencia === 'unica' ? `en ${monthLabel(mesAplic, true)}` : 'al mes'}.` : `${base.nombre} creado inactivo: no suma al presupuesto hasta que lo actives.`, error: `No se pudo crear ${base.nombre}.` },
    async () => {
      if (cambiaConfig) await store.actions.saveFondo(base)
      // v1.19: un fondo nuevo se aplica de forma explícita al mes elegido (cada mes tiene sus propios fondos aplicados).
      if (!editar && recurrencia === 'mensual' && activo && mesAplicacion >= aislaDesde(store.data?.config)) await store.actions.aplicarFondosMes(mesAplicacion, [{ id, monto: n }])
      if (cambiaImporteMes) await store.actions.saveFondoMes({ fondoId: id, mes: mes!, monto: n, modo: recurrencia === 'unica' ? 'solo' : modo })
    })
    if (ok) onClose()
  }
  function quitarAjuste() {
    const ok = store.track(`fondo:${id}`, { pending: 'Quitando el ajuste…', ok: `${fondo!.nombre}: ${monthLabel(mes!, true)} vuelve a su importe habitual.`, error: 'No se pudo quitar el ajuste.' },
      () => store.actions.saveFondoMes({ fondoId: id, mes: mes!, monto: 0, modo: 'solo' }, true))
    if (ok) onClose()
  }
  const tipoTxt = tipo === 'ahorro_asignado' ? 'de ahorro asignado' : tipo
  const vista = errorRegla ? null
    : `Este fondo ${tipoTxt} de ${Number.isFinite(montoNum) && monto.trim() ? money(Math.round(montoNum * 100)) : '—'} cubrirá ${cobertura === 'todos' ? 'cualquier gasto compatible' : describirCobertura(regla)}, con ${modoMedios === 'todos' ? 'todos los medios' : modoMedios === 'solo' ? `solo ${listaMedios.join(', ')}` : `todos los medios excepto ${listaMedios.join(', ')}`}.${regla.restringeMedio ? ` ${listaMedios.join(', ')} solo se podrá usar en esos gastos.` : ''}`

  const periodoTxt = recurrencia === 'unica' ? `Solo ${MES_RE.test(mesAplic) ? monthLabel(mesAplic, true) : '—'}` : mesAplic ? `Todos los meses desde ${monthLabel(mesAplic, true)}` : 'Todos los meses'
  const opcionesTipo: Opcion[] = TIPOS_FONDO.map(t => ({ value: t, label: TIPO_FONDO_TXT[t], Icon: t === 'mensual' ? CalendarDays : t === 'extra' ? CalendarRange : Lock }))
  const mediosActivos = useMemo(() => data.medios.filter(m => m.activo).map(m => m.nombre), [data.medios])

  return (
    <Modal open onClose={onClose} size="lg" title={editar ? `Editar ${fondo!.nombre}` : clonDe ? `Clonar ${clonDe.nombre}` : 'Nuevo fondo'} icon={<CircleDollarSign className="size-5" />}
      subtitle="Presupuesto asignado que suma a tu presupuesto consolidado. No crea gastos ni ingresos contables."
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save}>{editar ? 'Guardar cambios' : clonDe ? 'Crear copia' : 'Crear fondo'}</Button></>}>
      <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); save() }} data-testid="form-fondo">
        {clonDe && (
          <ErrorBox tone="warning" message={activo
            ? `Al crearlo, esta copia sumará ${money(Math.round((montoNum || 0) * 100))} al presupuesto consolidado (dinero adicional). Revisa el importe o déjalo inactivo.`
            : `Es una copia de “${clonDe.nombre}”: no copia gastos ni importes por mes y nace inactiva, así que no suma dinero al presupuesto hasta que la actives.`} />
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre del fondo" error={errors.nombre} htmlFor="fondo-nombre">
            <input id="fondo-nombre" className={inputCls} maxLength={40} placeholder="Ej. Auto, Bebé, Viaje a Ica" value={nombre} onChange={e => setNombre(e.target.value)} />
          </Field>
          <Field label="Tipo de fondo" htmlFor="fondo-tipo">
            <Combobox id="fondo-tipo" label="Tipo de fondo" value={tipo} onChange={v => { setTipo(v as TipoFondo); setTipoElegido(true) }} options={opcionesTipo} />
          </Field>
        </div>
        <p className="-mt-2 text-[11px] text-muted" data-testid="fondo-tipo-ayuda">{TIPO_FONDO_AYUDA[tipo]}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={editar && !esMesBase ? (mes ? `Importe de ${monthLabel(mes, true)}` : 'Importe') : 'Importe'} error={errors.monto} htmlFor="fondo-monto"
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

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Periodo" htmlFor="fondo-recurrencia">
            <Combobox id="fondo-recurrencia" label="Periodo del fondo" value={recurrencia}
              onChange={v => { const r = v as Recurrencia; setRecurrencia(r); if (r === 'unica' && !mesAplic) setMesAplic(mesRef); if (!tipoElegido) setTipo(r === 'unica' ? 'extra' : 'mensual') }}
              options={[{ value: 'mensual', label: 'Todos los meses', Icon: CalendarDays }, { value: 'unica', label: 'Solo un mes', Icon: CalendarRange }]} />
          </Field>
          <Field label={recurrencia === 'unica' ? 'Mes de aplicación' : 'Vigencia desde'} error={errors.mes} htmlFor="fondo-mes"
            hint={recurrencia === 'mensual' && !mesAplic ? 'Sin mes: rige en todos los meses, también los anteriores.' : recurrencia === 'unica' ? 'No se arrastra a otros meses.' : undefined}>
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1"><MonthPicker id="fondo-mes" label="Mes de aplicación" value={mesAplic} invalid={!!errors.mes} onChange={setMesAplic} /></span>
              {recurrencia === 'mensual' && mesAplic && <button type="button" className="shrink-0 text-xs text-muted underline" onClick={() => setMesAplic('')}>Todos</button>}
            </span>
          </Field>
        </div>

        <MediosCampos medios={mediosActivos} modo={modoMedios} onModo={v => { setModoMedios(v); if (v !== 'solo') setRestringe(false) }} lista={listaMedios} onLista={setListaMedios} invalid={!!errors.reglas} />

        <div className="space-y-2">
          <Field label="¿Qué gastos cubre este fondo?" htmlFor="fondo-cobertura">
            <Combobox id="fondo-cobertura" label="Cobertura del fondo" value={cobertura} onChange={v => { setCobertura(v as TipoCobertura); setRutas([]) }} options={COBERTURAS} />
          </Field>
          {cobertura === 'todos'
            ? <p className="rounded-xl bg-bg px-3 py-2 text-xs text-muted" data-testid="cobertura-todos">Este fondo puede utilizarse para cualquier gasto compatible.</p>
            : <EditorCobertura key={cobertura} tipo={cobertura} rutas={rutas} onRutas={setRutas} catalogo={data.catalogo} />}
        </div>

        {errors.reglas && <ErrorBox message={errors.reglas} />}
        <div className="grid items-stretch gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: `${color}14`, boxShadow: `inset 0 0 0 1px ${color}33` }}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-card" style={{ color }}><Icon className="size-5" /></span>
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{nombre.trim() || 'Nuevo fondo'}</p><p className="truncate text-[11px] text-muted">{periodoTxt}</p></div>
          </div>
          <div className="rounded-2xl border border-line bg-bg/60 p-3 text-xs" data-testid="vista-previa-fondo">
            <p className="mb-0.5 font-semibold text-ink">Vista previa</p>
            <p className="text-muted">{vista ?? errorRegla}</p>
            {editar && JSON.stringify(reglaActual(fondo!)) !== JSON.stringify({ ...regla, desde: reglaActual(fondo!).desde }) && (
              <p className="mt-1 text-muted">Las nuevas reglas rigen desde {monthLabel(hoyMes, true)}; los meses anteriores conservan las suyas.</p>
            )}
          </div>
        </div>

        <div className={`grid gap-3 ${modoMedios === 'solo' ? 'sm:grid-cols-2' : ''}`}>
          <div className="rounded-xl border border-line p-3">
            <Switch checked={activo} onChange={setActivo} label="Fondo activo" />
            <p className="mt-1 text-[11px] text-muted">Inactivo: queda guardado pero no suma al presupuesto ni recibe gastos.</p>
          </div>
          {modoMedios === 'solo' && (
            <div className="rounded-xl border border-line p-3">
              <Switch checked={restringe} onChange={setRestringe} label="Restringir el uso de estos medios a lo que cubre este fondo" />
              <p className="mt-1 text-[11px] text-muted">Activado: un gasto con {listaMedios.join(', ') || 'estos medios'} fuera de la cobertura de este fondo no se podrá guardar.</p>
              {afectados > 0 && <p className="mt-1 text-[11px] font-medium text-warning" data-testid="restriccion-afectados">{afectados} gasto(s) de este mes ya usan ese medio fuera de la cobertura: no se modifican, quedarán marcados para revisión.</p>}
            </div>
          )}
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
