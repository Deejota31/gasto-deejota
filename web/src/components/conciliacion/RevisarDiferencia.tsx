import { useState } from 'react'
import { CircleDollarSign, FilePlus2, FileSearch, History, Pencil, RefreshCcw, Scale, Wallet } from 'lucide-react'
import type { AppStore } from '../../lib/store'
import { formatDate } from '../../lib/dates'
import {
  CAUSAS, causaTxt, cortePersonas, difTxt, ESTADO_TXT, fechaEnTz, montoTxt, porcentajeDif, signoDe, type Verificacion,
} from '../../lib/conciliacion'
import type { ConcFila } from '../../lib/types'
import { Button, Field, inputCls, Modal, SelectField } from '../ui'
import { Chip } from './piezas'

const HIPOTESIS = {
  positiva: ['Un ingreso que no registraste', 'Un saldo anterior que no se consideró', 'Un gasto registrado de más o duplicado', 'Una devolución o reembolso', 'Una transferencia mal considerada'],
  negativa: ['Un gasto que olvidaste registrar', 'Comisiones o cobros automáticos', 'Un ingreso presupuestado que todavía no llegó', 'Un ingreso duplicado en tus fuentes', 'Una diferencia de tipo de cambio'],
}

export interface RevisarProps {
  store: AppStore; v: Verificacion; tz: string; formato: string
  /** Saldo calculado hoy para el mismo período, corte y grupo (null si ya no se puede calcular). */
  actual: number | null; desactualizada: boolean
  /** true = solo lectura del detalle (sin acciones de investigación). */
  soloDetalle?: boolean
  onClose: () => void
  onRevisarGastos: (desde: string, hasta: string) => void
  onNuevoGasto: (fecha: string) => void
  onIrFuentes: () => void
  onVerificarDeNuevo: (v: Verificacion) => void
  onCorregir: (v: Verificacion) => void
}

/**
 * Detalle y revisión de una diferencia. Las hipótesis NO son diagnósticos. Documentar una causa o cambiar el estado solo
 * agrega una fila de seguimiento: no es una transacción y no cambia el saldo calculado ni la verificación original.
 */
export function RevisarDiferencia({ store, v, tz, formato, actual, desactualizada, soloDetalle, onClose, onRevisarGastos, onNuevoGasto, onIrFuentes, onVerificarDeNuevo, onCorregir }: RevisarProps) {
  const [causa, setCausa] = useState(v.causaEfectiva || 'no_identificada')
  const [nota, setNota] = useState('')
  const [err, setErr] = useState('')
  const dif = v.diferencia ?? 0
  const signo = signoDe(dif)
  const fechaCorte = fechaEnTz(v.corte, tz)
  const historial: ConcFila[] = (store.data?.conciliaciones ?? []).filter(r => r.tipo === 'seguimiento' && r.conciliacionId === v.id)
  const editable = !soloDetalle && signo !== 'cero' && !v.corregidaPor

  const seguir = (estado: 'pendiente' | 'en_revision' | 'cerrada_justificada') => {
    if (estado === 'cerrada_justificada' && (!causa || !nota.trim())) { setErr('Para cerrar con diferencia justificada indica la causa y escribe una explicación.'); return }
    setErr('')
    const id = `conc-${crypto.randomUUID()}`
    store.track(`conc:${id}`, {
      pending: 'Guardando seguimiento…',
      ok: estado === 'cerrada_justificada' ? 'Diferencia cerrada como justificada. No se creó ninguna transacción.' : estado === 'en_revision' ? 'Diferencia marcada en revisión.' : 'Diferencia reabierta como pendiente.',
      error: 'No se pudo guardar el seguimiento.',
    }, () => store.actions.saveSeguimientoConciliacion({ id, conciliacionId: v.id, estado, causa, observacion: nota.trim() }))
    onClose()
  }

  return (
    <Modal open onClose={onClose} size="lg" title={soloDetalle ? 'Detalle de la conciliación' : 'Revisar diferencia'}
      subtitle={`${v.grupo} · ${cortePersonas(v.corte, tz, formato)}`} icon={<Scale className="size-5" />}
      footer={<><Button variant="outline" onClick={onClose}>Cerrar</Button></>}>
      <div className="space-y-4" data-testid={soloDetalle ? 'conc-detalle' : 'conc-revisar'}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Dato k="Saldo calculado" v={v.calculado !== null ? montoTxt(v.calculado, v.moneda) : '—'} />
          <Dato k="Saldo real" v={v.real !== null ? montoTxt(v.real, v.moneda) : '—'} />
          <Dato k="Diferencia" v={difTxt(dif, v.moneda)} extra={v.calculado !== null && porcentajeDif(dif, v.calculado) !== null ? `${porcentajeDif(dif, v.calculado)}%` : undefined} />
          <div className="min-w-0"><p className="text-xs text-muted">Estado</p><p className="text-sm font-semibold text-ink" data-testid="conc-estado-actual">{ESTADO_TXT[v.estadoEfectivo]}</p>{v.causaEfectiva && <p className="text-[11px] text-muted">{causaTxt(v.causaEfectiva)}</p>}</div>
        </div>
        {v.corregidaPor && <p className="rounded-xl bg-bg px-3 py-2 text-xs text-muted">Esta verificación fue corregida por una más reciente; se conserva aquí como registro.</p>}
        {desactualizada && (
          <p role="status" className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning" data-testid="conc-desactualizada">
            Datos desactualizados: tus movimientos o presupuestos cambiaron después de esta verificación. Hoy el saldo calculado para el mismo corte sería {actual !== null ? montoTxt(actual, v.moneda) : '—'} (al verificar era {v.calculado !== null ? montoTxt(v.calculado, v.moneda) : '—'}). La verificación original no se modifica: verifica de nuevo para actualizar la comparación.
          </p>
        )}
        {v.notaEfectiva && <p className="rounded-xl bg-bg px-3 py-2 text-sm text-ink">“{v.notaEfectiva}”</p>}
        <p className="text-[11px] text-muted">Registrada {cortePersonas(v.creadoEn, tz, formato)} · Última actualización {cortePersonas(v.actualizadoEn, tz, formato)}{v.referencia ? ` · Datos: ${v.referencia.split('|')[0]} mov.` : ''}</p>

        {signo !== 'cero' && (
          <section className="rounded-2xl border border-line p-3">
            <h3 className="mb-1 text-sm font-semibold text-ink">{signo === 'positiva' ? 'Tienes más dinero real del que estima Deejota' : 'Tienes menos dinero real del que estima Deejota'}</h3>
            <p className="mb-1 text-[11px] text-muted">Posibles causas para investigar (son hipótesis, no un diagnóstico):</p>
            <ul className="list-disc pl-5 text-xs text-ink">{HIPOTESIS[signo].map(h => <li key={h}>{h}</li>)}</ul>
          </section>
        )}

        {editable && (
          <>
            <section className="grid gap-2 sm:grid-cols-2" aria-label="Investigar la diferencia">
              <Accion Icon={FileSearch} titulo="Revisar gastos" texto="Abre Gastos con el período y el corte de esta conciliación. No marca nada como incorrecto." onClick={() => { onRevisarGastos(`${v.periodo}-01`, fechaCorte); onClose() }} testid="conc-rev-gastos" />
              <Accion Icon={FilePlus2} titulo="Registrar gasto olvidado" texto="Abre Nuevo gasto con la fecha de corte. Tú escribes el gasto real; después verifica de nuevo." onClick={() => { onNuevoGasto(fechaCorte); onClose() }} testid="conc-rev-nuevo" />
              <Accion Icon={CircleDollarSign} titulo="Registrar ingreso omitido" texto="Ve a Cajas → Fuentes de dinero y usa el flujo normal. Nunca se crea una fuente para cuadrar." onClick={() => { onIrFuentes(); onClose() }} testid="conc-rev-ingreso" />
              <Accion Icon={Pencil} titulo="Corregir un movimiento" texto="En Gastos edita o anula el movimiento correcto; esta conciliación no se reescribe." onClick={() => { onRevisarGastos(`${v.periodo}-01`, fechaCorte); onClose() }} testid="conc-rev-corregir" />
            </section>

            <section className="rounded-2xl border border-line p-3" aria-label="Documentar la diferencia">
              <h3 className="mb-2 text-sm font-semibold text-ink">Documentar la diferencia</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Causa" htmlFor="conc-causa">
                  <SelectField id="conc-causa" value={causa} onChange={setCausa} label="Causa">
                    {CAUSAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </SelectField>
                </Field>
                <Field label="Explicación" htmlFor="conc-nota">
                  <textarea id="conc-nota" className={`${inputCls} min-h-11`} maxLength={500} value={nota} onChange={e => setNota(e.target.value)} placeholder="Qué encontraste o por qué la aceptas" />
                </Field>
              </div>
              {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
              <p className="mt-2 text-[11px] text-muted">Documentar no es una transacción: no suma ni resta dinero y no cambia tu presupuesto.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {v.estadoEfectivo !== 'en_revision' && <Button variant="outline" className="h-9 text-xs" onClick={() => seguir('en_revision')} data-testid="conc-en-revision"><History className="size-3.5" /> Marcar en revisión</Button>}
                <Button variant="soft" className="h-9 text-xs" onClick={() => seguir('cerrada_justificada')} data-testid="conc-cerrar-just">Cerrar con diferencia justificada</Button>
                {(v.estadoEfectivo === 'en_revision' || v.estadoEfectivo === 'cerrada_justificada') && <Button variant="ghost" className="h-9 text-xs" onClick={() => seguir('pendiente')}>Reabrir como pendiente</Button>}
              </div>
            </section>
          </>
        )}

        {!soloDetalle && !v.corregidaPor && (
          <div className="flex flex-wrap gap-2">
            <Button className="h-9 text-xs" onClick={() => { onVerificarDeNuevo(v); onClose() }} data-testid="conc-verificar-de-nuevo"><RefreshCcw className="size-3.5" /> Verificar de nuevo</Button>
            <Button variant="outline" className="h-9 text-xs" onClick={() => { onCorregir(v); onClose() }}><Wallet className="size-3.5" /> Corregir esta verificación</Button>
          </div>
        )}

        {historial.length > 0 && (
          <section aria-label="Seguimiento">
            <h3 className="mb-1 text-xs font-semibold text-ink">Seguimiento</h3>
            <ol className="space-y-1 text-xs">
              {historial.map(h => (
                <li key={h.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-bg px-2 py-1.5">
                  <span className="text-muted">{formatDate(fechaEnTz(h.creadoEn, tz), formato)}</span>
                  <b className="text-ink">{ESTADO_TXT[h.estado as keyof typeof ESTADO_TXT] ?? h.estado}</b>
                  {h.causa && <span className="text-muted">· {causaTxt(h.causa)}</span>}
                  {h.observacion && <span className="text-ink">— {h.observacion}</span>}
                </li>
              ))}
            </ol>
          </section>
        )}
        <div className="sr-only"><Chip estado={signo === 'cero' ? 'conciliado' : signo} /></div>
      </div>
    </Modal>
  )
}

function Dato({ k, v, extra }: { k: string; v: string; extra?: string }) {
  return <div className="min-w-0"><p className="text-xs text-muted">{k}</p><p className="tabular text-sm font-semibold text-ink">{v}{extra && <span className="ml-1 text-[11px] font-normal text-muted">({extra})</span>}</p></div>
}

function Accion({ Icon, titulo, texto, onClick, testid }: { Icon: typeof FileSearch; titulo: string; texto: string; onClick: () => void; testid: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid}
      className="flex items-start gap-2.5 rounded-2xl border border-line bg-card p-3 text-left transition hover:border-navy/40 hover:bg-bg focus-visible:outline-2 focus-visible:outline-navy">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary-soft text-navy"><Icon className="size-4" /></span>
      <span className="min-w-0"><span className="block text-sm font-semibold text-ink">{titulo}</span><span className="block text-[11px] text-muted">{texto}</span></span>
    </button>
  )
}
