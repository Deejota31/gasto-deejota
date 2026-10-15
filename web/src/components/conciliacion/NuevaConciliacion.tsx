import { useMemo, useState } from 'react'
import { Landmark, ListTree, Receipt, Save } from 'lucide-react'
import type { AppStore } from '../../lib/store'
import { monthEnd, monthLabel } from '../../lib/dates'
import {
  calcularSaldos, difTxt, ESTADO_TXT, fechaEnTz, gruposDeTrabajo, horaEnTz, localAIso, montoTxt, porcentajeDif, redondear2, signoDe,
  type Verificacion,
} from '../../lib/conciliacion'
import { Button, DateField, Field, inputCls, Modal, SelectField } from '../ui'
import { Chip, mesesDisponibles, parseMonto } from './piezas'

export interface NuevaProps {
  store: AppStore; today: string; periodoInicial: string; fechaInicial: string; grupoInicial?: string
  /** Si se corrige una verificación mal ingresada, la anterior se conserva en el historial. */
  reemplaza?: Verificacion
  onClose: () => void
  onRevisarGastos: (desde: string, hasta: string) => void
}

/**
 * Nueva conciliación. Solo registra la comparación: no crea ingresos, gastos ni ajustes, y no cambia el presupuesto.
 * El saldo calculado es de solo lectura (sale del motor); el real lo escribes tú. Se cierra al aceptar y el guardado
 * sigue en segundo plano (el resultado real llega como notificación).
 */
export function NuevaConciliacion({ store, today, periodoInicial, fechaInicial, grupoInicial, reemplaza, onClose, onRevisarGastos }: NuevaProps) {
  const data = store.data!
  const tz = data.config.zona_horaria || 'America/Lima'
  const formato = data.config.formato_fecha || 'dd/MM/yyyy'
  const grupos = useMemo(() => gruposDeTrabajo(data.conciliaciones), [data.conciliaciones])
  const [id] = useState(() => `conc-${crypto.randomUUID()}`)   // generado al abrir: un reintento no duplica
  const [periodo, setPeriodo] = useState(reemplaza?.periodo ?? periodoInicial)
  const [fecha, setFecha] = useState(reemplaza ? fechaEnTz(reemplaza.corte, tz) : fechaInicial)
  const [hora, setHora] = useState(() => reemplaza ? horaEnTz(reemplaza.corte, tz) : fechaInicial === today ? horaEnTz(new Date().toISOString(), tz) : '23:59')
  const [grupoId, setGrupoId] = useState(reemplaza?.grupoId ?? grupoInicial ?? grupos[0].id)
  const [realTxt, setRealTxt] = useState(reemplaza?.real != null ? String(reemplaza.real) : '')
  const [obs, setObs] = useState('')
  const [desglose, setDesglose] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [intentado, setIntentado] = useState(false)

  const saldo = useMemo(() => calcularSaldos(data, periodo, fecha, today, grupos), [data, periodo, fecha, today, grupos])
  const grupo = grupos.find(g => g.id === grupoId) ?? grupos[0]
  const calculado = saldo.porGrupo[grupo.id] ?? null
  const real = parseMonto(realTxt)
  const dif = real !== null && calculado !== null ? redondear2(real - calculado) : null
  const corteIso = useMemo(() => { try { return localAIso(fecha, hora || '00:00', tz) } catch { return '' } }, [fecha, hora, tz])
  const futuro = !corteIso || new Date(corteIso).getTime() > Date.now() + 60_000
  const periodos = mesesDisponibles(today.slice(0, 7), 12, [periodo])
  const maxFecha = periodo === today.slice(0, 7) ? today : monthEnd(periodo)

  const cambiarPeriodo = (p: string) => { setPeriodo(p); setFecha(p === today.slice(0, 7) ? today : monthEnd(p)); if (p !== today.slice(0, 7)) setHora('23:59') }

  const errReal = realTxt.trim() === '' ? 'Escribe el saldo que ves en tu cuenta.' : real === null ? 'Importe inválido (usa hasta 2 decimales).' : ''
  const bloqueo = !saldo.calculable ? 'No hay información suficiente para calcular el saldo de este período.' : calculado === null ? 'Este grupo no tiene fuentes aplicadas en el período: no hay saldo calculado.' : futuro ? 'La fecha y hora de corte no pueden estar en el futuro.' : ''

  const guardar = () => {
    setIntentado(true)
    if (enviando || errReal || bloqueo || real === null || calculado === null) return
    setEnviando(true)
    const input = {
      id, periodo, corte: corteIso, grupoId: grupo.id, grupo: grupo.nombre, moneda: saldo.moneda, calculado, real,
      observacion: obs.trim(), referencia: saldo.referencia, ...(reemplaza ? { reemplazaA: reemplaza.id } : {}),
    }
    store.track(`conc:${id}`, {
      pending: 'Guardando conciliación…',
      ok: 'Conciliación guardada. No se creó ni cambió ningún ingreso, gasto ni presupuesto.',
      error: 'No se pudo guardar la conciliación.',
    }, () => store.actions.saveConciliacion(input))
    onClose()
  }

  return (
    <Modal open onClose={onClose} size="lg" title={reemplaza ? 'Corregir verificación' : 'Nueva conciliación'}
      subtitle={reemplaza ? 'Se guarda como una verificación nueva; la anterior se conserva en el historial.' : 'Compara el saldo real de tus cuentas con el saldo presupuestario calculado.'}
      icon={<Landmark className="size-5" />}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button variant="ghost" onClick={() => setDesglose(d => !d)} aria-expanded={desglose} data-testid="conc-ver-desglose"><ListTree className="size-4" /> {desglose ? 'Ocultar desglose' : 'Ver desglose'}</Button>
        <Button variant="ghost" onClick={() => { onRevisarGastos(`${periodo}-01`, fecha); onClose() }}><Receipt className="size-4" /> Revisar movimientos</Button>
        <Button onClick={guardar} disabled={enviando} data-testid="conc-guardar"><Save className="size-4" /> Guardar conciliación</Button>
      </>}>
      <div className="space-y-4" data-testid="conc-modal">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Período" htmlFor="conc-periodo">
            <SelectField id="conc-periodo" value={periodo} onChange={cambiarPeriodo} label="Período">
              {periodos.map(p => <option key={p} value={p}>{monthLabel(p, true)}</option>)}
            </SelectField>
          </Field>
          <Field label="Grupo de fondos" htmlFor="conc-grupo">
            <SelectField id="conc-grupo" value={grupo.id} onChange={setGrupoId} label="Grupo de fondos">
              {grupos.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </SelectField>
          </Field>
          <Field label="Fecha de corte" htmlFor="conc-fecha" hint="El saldo calculado incluye los movimientos fechados hasta este día.">
            <DateField id="conc-fecha" value={fecha} onChange={v => { if (v) setFecha(v) }} format={formato} min={`${periodo}-01`} max={maxFecha} today={today} label="Fecha de corte" />
          </Field>
          <Field label="Hora de la verificación" htmlFor="conc-hora" hint={`Hora local (${tz}).`}>
            <input id="conc-hora" type="time" className={inputCls} value={hora} onChange={e => setHora(e.target.value)} />
          </Field>
          <Field label="Saldo presupuestario calculado" htmlFor="conc-calculado" hint="Solo lectura: sale de tus fuentes y gastos registrados.">
            <output id="conc-calculado" data-testid="conc-calculado" className={`${inputCls} block tabular font-semibold`}>
              {calculado !== null ? montoTxt(calculado, saldo.moneda) : 'Información insuficiente'}
            </output>
          </Field>
          <Field label="Saldo real verificado" htmlFor="conc-real" error={intentado ? errReal : ''} hint="El que ves hoy en tu cuenta, billetera o Sodexo.">
            <input id="conc-real" inputMode="decimal" autoComplete="off" className={`${inputCls} tabular`} placeholder="0.00" value={realTxt}
              onChange={e => setRealTxt(e.target.value)} aria-invalid={intentado && !!errReal || undefined} data-testid="conc-real" />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-bg px-4 py-3" data-testid="conc-diferencia" aria-live="polite">
          <div>
            <p className="text-xs text-muted">Diferencia (real − calculado)</p>
            <p className="tabular text-xl font-bold text-ink" data-testid="conc-dif-valor">{dif === null ? '—' : difTxt(dif, saldo.moneda)}</p>
            {dif !== null && calculado !== null && porcentajeDif(dif, calculado) !== null && <p className="text-[11px] text-muted">{porcentajeDif(dif, calculado)! > 0 ? '+' : ''}{porcentajeDif(dif, calculado)}% del calculado</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            {dif === null ? <Chip estado="sin_verificar" texto="Escribe el saldo real" /> : <Chip estado={signoDe(dif) === 'cero' ? 'conciliado' : signoDe(dif) === 'positiva' ? 'positiva' : 'negativa'} testid="conc-dif-estado" />}
            <p className="text-[11px] text-muted">Estado: <b className="text-ink">{dif === null ? '—' : dif !== null && Math.abs(dif) < 0.005 ? ESTADO_TXT.conciliada : ESTADO_TXT.pendiente}</b></p>
          </div>
        </div>

        {(intentado && bloqueo) && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{bloqueo}</p>}
        {!bloqueo && saldo.advertencias.map(a => <p key={a} className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">{a}</p>)}

        <Field label="Observaciones (opcional)" htmlFor="conc-obs">
          <textarea id="conc-obs" className={`${inputCls} min-h-20`} maxLength={500} value={obs} onChange={e => setObs(e.target.value)} placeholder="Ej.: Saldo confirmado después de revisar mis cuentas" />
        </Field>

        {desglose && (
          <div className="rounded-2xl border border-line p-3" data-testid="conc-desglose">
            <p className="mb-2 text-xs font-semibold text-ink">Desglose al {fecha.split('-').reverse().join('/')}</p>
            <dl className="mb-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div><dt className="text-muted">Disponible presupuestario</dt><dd className="tabular font-semibold">{saldo.total !== null ? montoTxt(saldo.total, saldo.moneda) : '—'}</dd></div>
              <div><dt className="text-muted">Reservado en cajas</dt><dd className="tabular font-semibold">{montoTxt(saldo.reservado, saldo.moneda)}</dd></div>
              <div><dt className="text-muted">Libre no reservado</dt><dd className="tabular font-semibold">{saldo.libreNoReservado !== null ? montoTxt(saldo.libreNoReservado, saldo.moneda) : '—'}</dd></div>
            </dl>
            <p className="mb-2 text-[11px] text-muted">Las cajas son reservas dentro del presupuesto: no son cuentas aparte ni gastos adicionales, y no se descuentan dos veces.</p>
            <ul className="divide-y divide-line/70 text-xs">
              {saldo.fuentes.filter(f => f.aplicada).map(f => (
                <li key={f.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate">{f.nombre}{grupo.fuenteIds.includes(f.id) && <span className="ml-1 rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-navy">en este grupo</span>}</span>
                  <span className="tabular shrink-0 text-muted">{montoTxt(f.aporta, saldo.moneda)} − {montoTxt(f.gastado, saldo.moneda)} = <b className="text-ink">{montoTxt(f.disponible, saldo.moneda)}</b></span>
                </li>
              ))}
              {!saldo.fuentes.some(f => f.aplicada) && <li className="py-1.5 text-muted">Sin fuentes aplicadas a este período.</li>}
            </ul>
            {saldo.sinAtribuir !== null && Math.abs(saldo.sinAtribuir) >= 0.005 && <p className="mt-2 text-[11px] text-warning">Sin atribuir a ningún grupo: {montoTxt(saldo.sinAtribuir, saldo.moneda)}.</p>}
          </div>
        )}

        <p className="text-[11px] text-muted">Al guardar solo se registra la verificación: no se crea ningún ingreso ni gasto, y tu presupuesto, fuentes y cajas no cambian.</p>
      </div>
    </Modal>
  )
}
