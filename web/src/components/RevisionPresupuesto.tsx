import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarPlus, Check, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, Hourglass, Info, ListChecks, MessageSquareText, Search } from 'lucide-react'
import { formatDate, monthEnd, monthLabel } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { ESTADO_REV_AYUDA, ESTADO_REV_TXT, estadoDe, historial, revisarPeriodo, type Chequeo as ChequeoRev, type Severidad } from '../lib/revisionPresupuesto'
import type { AppStore } from '../lib/store'
import type { EstadoRevisionPres, RevisionPres } from '../lib/types'
import { MonthPicker } from './DatePicker'
import { Button, Empty, Field, InfoTooltip, inputCls } from './ui'

const ESTADOS: EstadoRevisionPres[] = ['pendiente', 'completo', 'con_gastos_anteriores', 'revisado_con_observaciones']
const TONO: Record<EstadoRevisionPres, string> = {
  pendiente: 'bg-[#FEF3C7] text-[#92400E]', completo: 'bg-[#DCFCE7] text-[#166534]',
  con_gastos_anteriores: 'bg-[#FEE2E2] text-[#991B1B]', revisado_con_observaciones: 'bg-[#E0E7FF] text-[#3730A3]',
}
const ESTADO_ICONO: Record<EstadoRevisionPres, typeof Info> = { pendiente: Hourglass, completo: CheckCircle2, con_gastos_anteriores: ClipboardList, revisado_con_observaciones: MessageSquareText }
const ESTADO_COLOR: Record<EstadoRevisionPres, string> = { pendiente: '#92400E', completo: '#166534', con_gastos_anteriores: '#991B1B', revisado_con_observaciones: '#3730A3' }
/** Descripciones breves para la selección (las completas siguen en ESTADO_REV_AYUDA, que se muestra bajo el estado actual). */
const ESTADO_CORTO: Record<EstadoRevisionPres, string> = {
  pendiente: 'Aún sin confirmar.', completo: 'Todos los gastos están registrados.', con_gastos_anteriores: 'Faltan gastos por registrar.', revisado_con_observaciones: 'Revisado, con una nota.',
}
const ICONO: Record<Severidad, typeof Info> = { ok: CheckCircle2, aviso: Info, alerta: AlertTriangle }

/**
 * Revisión del presupuesto: ¿el período tiene todos sus gastos y es coherente? Solo usa fondos y gastos registrados
 * (nada de saldos de banco). Guardar solo AGREGA un registro a REVISIONES_PRESUPUESTO; regularizar un gasto olvidado se hace
 * creando un gasto normal (con su antiduplicado), nunca desde aquí.
 */
export function RevisionPresupuesto({ store, today, onRevisarGastos, onNuevoGasto }: {
  store: AppStore; today: string
  onRevisarGastos: (desde: string, hasta: string) => void; onNuevoGasto: (fecha: string) => void
}) {
  const data = store.data!
  const [periodo, setPeriodo] = useState(today.slice(0, 7))
  const res = useMemo(() => revisarPeriodo(data, periodo, today), [data, periodo, today])
  const actual = estadoDe(data.revisionesPresupuesto, periodo)
  const money = (c: number) => formatMoney(c, data.config.moneda || 'PEN')
  return (
    <div id="salud-revision" role="tabpanel" aria-labelledby="salud-tab-revision" className="fade-in space-y-4" data-testid="revision-presupuesto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold"><ClipboardCheck className="size-5 text-navy" />Revisión del presupuesto
            <InfoTooltip title="Qué revisa">
              <p>Comprueba que el período esté completo y coherente usando solo tus fondos y gastos registrados.</p>
              <p>No usa saldos de cuentas ni ingresos: para la app, el dinero es el presupuesto que tú defines.</p>
            </InfoTooltip>
          </h3>
          <p className="text-xs text-muted">{monthLabel(periodo, true)}{res.enCurso ? ' · en curso (revisión hasta hoy)' : ''}</p>
        </div>
        <div className="w-44"><MonthPicker id="rev-periodo" label="Período a revisar" value={periodo} onChange={v => v && setPeriodo(v)} /></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="rev-estado" className={`rounded-full px-3 py-1 text-xs font-semibold ${TONO[actual]}`}>{ESTADO_REV_TXT[actual]}</span>
        <span className="text-xs text-muted">{ESTADO_REV_AYUDA[actual]}</span>
      </div>

      <ul className="space-y-1.5" aria-label="Chequeos del período" data-testid="rev-chequeos">
        {res.chequeos.map(c => <Chequeo key={c.id} c={c} money={money} />)}
      </ul>

      {res.diasTranscurridos > 0 && (
        <DiasSinMovimientos dias={res.diasSinMovimientos} transcurridos={res.diasTranscurridos} fmt={data.config.formato_fecha} onNuevoGasto={onNuevoGasto} />)}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onRevisarGastos(`${periodo}-01`, monthEnd(periodo))}><Search className="size-4" />Ver los {res.movimientos} gastos del período</Button>
      </div>

      <FormularioRevision key={periodo} store={store} periodo={periodo} actual={actual} />

      <Historial revisiones={data.revisionesPresupuesto ?? []} periodo={periodo} fmt={data.config.formato_fecha} />
    </div>
  )
}

function FormularioRevision({ store, periodo, actual }: { store: AppStore; periodo: string; actual: EstadoRevisionPres }) {
  // ID fijo mientras el formulario está abierto: guardar dos veces (doble clic, reintento) no duplica.
  const [id, setId] = useState(() => `rev-${crypto.randomUUID()}`)
  const [estado, setEstado] = useState<EstadoRevisionPres>(actual === 'pendiente' ? 'completo' : actual)
  const [pendientes, setPendientes] = useState('')
  const [observacion, setObservacion] = useState('')
  const exigePend = estado === 'con_gastos_anteriores'
  const exigeObs = estado === 'revisado_con_observaciones'
  const error = exigePend && !pendientes.trim() ? 'Anota qué gastos faltan por registrar (sin importes si no los sabes).'
    : exigeObs && !observacion.trim() ? 'Escribe la observación: es lo que distingue este estado.' : ''
  const [intento, setIntento] = useState(false)
  const guardar = () => {
    setIntento(true)
    if (error) return
    const input = { id, periodo, estado, pendientes: pendientes.trim(), observacion: observacion.trim() }
    const ok = store.track(`revision:${periodo}`, { pending: 'Guardando la revisión…', ok: `Revisión de ${monthLabel(periodo, true)} guardada.`, error: 'No se pudo guardar la revisión.' },
      () => store.actions.saveRevisionPresupuesto(input))
    if (ok) { setPendientes(''); setObservacion(''); setIntento(false); setId(`rev-${crypto.randomUUID()}`) }
  }
  return (
    <form className="space-y-3 rounded-2xl border border-line bg-card p-3" noValidate onSubmit={e => { e.preventDefault(); guardar() }} data-testid="rev-form">
      <h4 className="text-sm font-semibold">Registrar el resultado de la revisión</h4>
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-muted">Estado del período</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Estado del período">
          {ESTADOS.map(e => {
            const I = ESTADO_ICONO[e], on = estado === e, c = ESTADO_COLOR[e]
            return (
              <label key={e} className={`relative flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition focus-within:ring-2 focus-within:ring-navy/40 ${on ? 'border-transparent' : 'border-line hover:bg-bg'}`}
                style={on ? { background: `${c}12`, boxShadow: `inset 0 0 0 1.5px ${c}` } : undefined}>
                <input type="radio" name="rev-estado" className="sr-only" checked={on} onChange={() => setEstado(e)} />
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: `${c}1F`, color: c }}><I className="size-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-[13px] leading-tight font-semibold">{ESTADO_REV_TXT[e]}</span><span className="mt-0.5 block text-[11px] leading-snug text-muted">{ESTADO_CORTO[e]}</span></span>
                {on && <Check className="size-4 shrink-0" style={{ color: c }} aria-hidden />}
              </label>)
          })}
        </div>
      </fieldset>
      {exigePend && (
        <Field label="Gastos anteriores por registrar" error={intento ? error : ''} htmlFor="rev-pendientes" hint="Texto libre, sin importes inventados. Luego regístralos como gastos normales.">
          <textarea id="rev-pendientes" className={inputCls} rows={2} maxLength={500} value={pendientes} onChange={e => setPendientes(e.target.value)} placeholder="Ej. Almuerzos del 3 y 4, pasaje del viernes" />
        </Field>)}
      <Field label={exigeObs ? 'Observación' : 'Observación (opcional)'} htmlFor="rev-observacion" error={intento && exigeObs ? error : ''}>
        <textarea id="rev-observacion" className={inputCls} rows={2} maxLength={500} value={observacion} onChange={e => setObservacion(e.target.value)} />
      </Field>
      <div className="flex justify-end"><Button type="submit">Guardar revisión</Button></div>
    </form>
  )
}

/** Una alerta compacta: qué pasó, cuánto es y, si hay detalle (p. ej. qué fondos), se despliega. */
function Chequeo({ c, money }: { c: ChequeoRev; money: (c: number) => string }) {
  const [abierto, setAbierto] = useState(false)
  const I = ICONO[c.severidad]
  const tono = c.severidad === 'alerta' ? 'border-danger/40 bg-danger/5' : c.severidad === 'aviso' ? 'border-warn/40 bg-warn/5' : 'border-line bg-card'
  return (
    <li data-testid={`rev-chequeo-${c.id}`} className={`rounded-xl border px-3 py-2 text-sm ${tono}`}>
      <div className="flex items-start gap-2">
        <I className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="font-medium">{c.titulo}</span>
            {c.importe ? <span className="tabular text-xs font-semibold" data-testid={`rev-importe-${c.id}`}>{money(c.importe)}</span> : null}</p>
          <p className="text-xs text-muted">{c.detalle}</p>
          {c.items?.length ? (
            <>
              <button type="button" aria-expanded={abierto} onClick={() => setAbierto(a => !a)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-navy underline-offset-2 hover:underline">
                {abierto ? 'Ocultar detalle' : 'Ver detalle'} <ChevronDown className={`size-3 transition ${abierto ? 'rotate-180' : ''}`} />
              </button>
              {abierto && (
                <ul className="mt-1.5 space-y-0.5 text-xs" data-testid={`rev-detalle-${c.id}`}>
                  {c.items.map(i => <li key={i.nombre} className="flex justify-between gap-3"><span className="truncate">{i.nombre}</span><span className="tabular shrink-0 text-muted">+{money(i.importe)}</span></li>)}
                </ul>)}
            </>) : null}
        </div>
      </div>
    </li>
  )
}

const DIAS_VISIBLES = 10

/** Fechas ya transcurridas sin gastos: información (no todos los días tienen gastos), con acceso directo al registro con esa fecha. */
function DiasSinMovimientos({ dias, transcurridos, fmt, onNuevoGasto }: { dias: string[]; transcurridos: number; fmt?: string; onNuevoGasto: (fecha: string) => void }) {
  const [todos, setTodos] = useState(false)
  const lista = todos ? dias : dias.slice(0, DIAS_VISIBLES)
  return (
    <div className="rounded-xl border border-line bg-card p-3" data-testid="rev-dias">
      <p className="mb-1 flex flex-wrap items-center gap-1.5 text-sm font-medium"><ListChecks className="size-4" />Días sin gastos registrados
        <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] font-semibold text-muted">{dias.length} de {transcurridos} transcurridos</span></p>
      {!dias.length ? <p className="text-xs text-muted">Todos los días transcurridos tienen al menos un gasto.</p> : (
        <>
          <p className="mb-2 text-[11px] text-muted">Es solo informativo: no todos los días tienes gastos. Si olvidaste alguno, toca la fecha para registrarlo.</p>
          <ul className="flex flex-wrap gap-1.5">
            {lista.map(d => (
              <li key={d}><button type="button" className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs hover:bg-bg" onClick={() => onNuevoGasto(d)}
                aria-label={`Registrar un gasto del ${formatDate(d, fmt)}`}><CalendarPlus className="size-3" />{formatDate(d, fmt)}</button></li>))}
            {dias.length > DIAS_VISIBLES && (
              <li><button type="button" className="rounded-full px-2.5 py-1 text-xs font-semibold text-navy hover:bg-bg" aria-expanded={todos} onClick={() => setTodos(t => !t)}>
                {todos ? 'Ver menos' : `Ver ${dias.length - DIAS_VISIBLES} más`}</button></li>)}
          </ul>
          <p className="mt-2 text-[11px] text-muted">Al guardar se crea un gasto normal; el antiduplicado evita registrarlo dos veces.</p>
        </>)}
    </div>
  )
}

const HIST_VISIBLES = 3

/** Historial: resumen compacto de este período y, a pedido, los anteriores. Cada revisión se agrega; nada se edita ni se borra. */
function Historial({ revisiones, periodo, fmt }: { revisiones: readonly RevisionPres[]; periodo: string; fmt?: string }) {
  const [verTodo, setVerTodo] = useState(false)
  const [otros, setOtros] = useState(false)
  const propias = useMemo(() => historial(revisiones, periodo), [revisiones, periodo])
  const anteriores = useMemo(() => revisiones.filter(r => r.periodo !== periodo).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)), [revisiones, periodo])
  const lista = otros ? [...propias, ...anteriores].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)) : propias
  const visibles = verTodo ? lista : lista.slice(0, HIST_VISIBLES)
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Historial {otros ? 'de revisiones' : `de ${monthLabel(periodo, true)}`}</h4>
        {anteriores.length > 0 && (
          <button type="button" aria-pressed={otros} onClick={() => setOtros(o => !o)} className="text-xs font-semibold text-navy hover:underline">
            {otros ? 'Solo este período' : `Incluir otros períodos (${anteriores.length})`}</button>)}
      </div>
      {!lista.length ? <Empty title="Sin revisiones guardadas">Cuando guardes una revisión aparecerá aquí. Nada se borra ni se edita: cada revisión se agrega.</Empty> : (
        <>
          <ol className="space-y-1.5" data-testid="rev-historial">
            {visibles.map(h => (
              <li key={h.id} className="rounded-xl border border-line bg-card px-3 py-2 text-sm">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONO[h.estado]}`}>{ESTADO_REV_TXT[h.estado]}</span>
                  <span className="text-xs text-muted">{formatDate(h.creadoEn.slice(0, 10), fmt)}</span>
                  <span className="text-xs text-muted">· Período {monthLabel(h.periodo, true)}</span></p>
                {h.pendientes && <p className="mt-1 text-xs"><b>Por registrar:</b> {h.pendientes}</p>}
                {h.observacion && <p className="mt-1 text-xs"><b>Observación:</b> {h.observacion}</p>}
              </li>))}
          </ol>
          {lista.length > HIST_VISIBLES && (
            <button type="button" aria-expanded={verTodo} onClick={() => setVerTodo(v => !v)} className="mt-1.5 text-xs font-semibold text-navy hover:underline">
              {verTodo ? 'Ver menos' : `Ver los ${lista.length - HIST_VISIBLES} anteriores`}</button>)}
        </>)}
    </div>
  )
}
