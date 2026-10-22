import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarPlus, CheckCircle2, ClipboardCheck, Info, ListChecks, Search } from 'lucide-react'
import { formatDate, monthEnd, monthLabel } from '../lib/dates'
import { ESTADO_REV_AYUDA, ESTADO_REV_TXT, estadoDe, historial, revisarPeriodo, type Severidad } from '../lib/revisionPresupuesto'
import type { AppStore } from '../lib/store'
import type { EstadoRevisionPres } from '../lib/types'
import { MonthPicker } from './DatePicker'
import { Button, Empty, Field, InfoTooltip, inputCls } from './ui'

const ESTADOS: EstadoRevisionPres[] = ['pendiente', 'completo', 'con_gastos_anteriores', 'revisado_con_observaciones']
const TONO: Record<EstadoRevisionPres, string> = {
  pendiente: 'bg-[#FEF3C7] text-[#92400E]', completo: 'bg-[#DCFCE7] text-[#166534]',
  con_gastos_anteriores: 'bg-[#FEE2E2] text-[#991B1B]', revisado_con_observaciones: 'bg-[#E0E7FF] text-[#3730A3]',
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
  const hist = useMemo(() => historial(data.revisionesPresupuesto, periodo), [data.revisionesPresupuesto, periodo])
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

      <ul className="space-y-2" aria-label="Chequeos del período" data-testid="rev-chequeos">
        {res.chequeos.map(c => { const I = ICONO[c.severidad]; return (
          <li key={c.id} data-testid={`rev-chequeo-${c.id}`} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${c.severidad === 'alerta' ? 'border-danger/40 bg-danger/5' : c.severidad === 'aviso' ? 'border-warn/40 bg-warn/5' : 'border-line bg-card'}`}>
            <I className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">{c.titulo}</p><p className="text-xs text-muted">{c.detalle}</p></div>
          </li>) })}
      </ul>

      {res.diasSinMovimientos.length > 0 && (
        <div className="rounded-xl border border-line bg-card p-3" data-testid="rev-dias">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><ListChecks className="size-4" />Días sin movimientos ({res.diasSinMovimientos.length})</p>
          <ul className="flex flex-wrap gap-1.5">
            {res.diasSinMovimientos.slice(0, 12).map(d => (
              <li key={d}><button type="button" className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs hover:bg-bg" onClick={() => onNuevoGasto(d)}
                aria-label={`Registrar un gasto del ${formatDate(d, data.config.formato_fecha)}`}><CalendarPlus className="size-3" />{formatDate(d, data.config.formato_fecha)}</button></li>))}
          </ul>
          <p className="mt-2 text-[11px] text-muted">Tocar un día abre “Nuevo gasto” con esa fecha. Si lo guardas, es un gasto normal: el antiduplicado evita registrarlo dos veces.</p>
        </div>)}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onRevisarGastos(`${periodo}-01`, monthEnd(periodo))}><Search className="size-4" />Ver los {res.movimientos} gastos del período</Button>
      </div>

      <FormularioRevision key={periodo} store={store} periodo={periodo} actual={actual} />

      <div>
        <h4 className="mb-1.5 text-sm font-semibold">Historial de este período</h4>
        {!hist.length ? <Empty title="Sin revisiones guardadas">Cuando guardes una revisión aparecerá aquí. Nada se borra ni se edita: cada revisión se agrega.</Empty> : (
          <ol className="space-y-1.5" data-testid="rev-historial">
            {hist.map(h => (
              <li key={h.id} className="rounded-xl border border-line bg-card px-3 py-2 text-sm">
                <p className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONO[h.estado]}`}>{ESTADO_REV_TXT[h.estado]}</span>
                  <span className="text-xs text-muted">{formatDate(h.creadoEn.slice(0, 10), data.config.formato_fecha)}</span></p>
                {h.pendientes && <p className="mt-1 text-xs"><b>Por registrar:</b> {h.pendientes}</p>}
                {h.observacion && <p className="mt-1 text-xs"><b>Observación:</b> {h.observacion}</p>}
              </li>))}
          </ol>)}
      </div>
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
  const error = exigePend && !pendientes.trim() ? 'Anota qué gastos faltan por registrar (sin importes si no los sabes).' : ''
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
        <legend className="mb-1 text-xs font-medium text-muted">Estado del período</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {ESTADOS.map(e => (
            <label key={e} className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm ${estado === e ? 'border-navy bg-navy/5' : 'border-line'}`}>
              <input type="radio" name="rev-estado" className="mt-1" checked={estado === e} onChange={() => setEstado(e)} />
              <span><span className="font-medium">{ESTADO_REV_TXT[e]}</span><span className="block text-[11px] text-muted">{ESTADO_REV_AYUDA[e]}</span></span>
            </label>))}
        </div>
      </fieldset>
      {exigePend && (
        <Field label="Gastos anteriores por registrar" error={intento ? error : ''} htmlFor="rev-pendientes" hint="Texto libre, sin importes inventados. Luego regístralos como gastos normales.">
          <textarea id="rev-pendientes" className={inputCls} rows={2} maxLength={500} value={pendientes} onChange={e => setPendientes(e.target.value)} placeholder="Ej. Almuerzos del 3 y 4, pasaje del viernes" />
        </Field>)}
      <Field label="Observación (opcional)" htmlFor="rev-observacion">
        <textarea id="rev-observacion" className={inputCls} rows={2} maxLength={500} value={observacion} onChange={e => setObservacion(e.target.value)} />
      </Field>
      <div className="flex justify-end"><Button type="submit">Guardar revisión</Button></div>
    </form>
  )
}
