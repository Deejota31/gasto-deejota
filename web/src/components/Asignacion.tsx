import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Hand, Plus, RotateCcw, Shuffle, Trash2, Unlink } from 'lucide-react'
import type { AppStore } from '../lib/store'
import type { Gasto, ParteManual } from '../lib/types'
import { activoEnMes, asignarMes, elegibles, explicarImputacion, TIPO_PARTE_TXT, validarAsignacion, type Imputacion } from '../lib/presupuesto'
import { ctxReparto } from '../lib/useAgregado'
import { monthLabel, todayIn } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { Button, Checkbox, ErrorBox, inputCls, Modal, SelectField } from './ui'

/**
 * Indicador compacto del reparto de un gasto entre fondos (tabla de Gastos) y el detalle "Ver / cambiar asignación".
 * No calcula nada propio: todo sale del motor (lib/presupuesto.ts). Una asignación manual nunca reclasifica el gasto.
 */

const chip = 'inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap'

export function IndicadorFondos({ imp, nombre, money, onClick }: { imp: Imputacion | undefined; nombre: (id: string) => string; money: (c: number) => string; onClick: () => void }) {
  if (!imp) return null
  let cont: { txt: React.ReactNode; fg: string; bg: string; title: string; Icon: typeof Shuffle }
  if (imp.incompatible) cont = { txt: 'Medio no permitido', fg: 'var(--danger)', bg: 'var(--danger-soft)', title: 'El medio de pago no está permitido para esta clasificación', Icon: AlertTriangle }
  else if (imp.sinFondo === imp.total) cont = { txt: 'Sin fondo', fg: 'var(--warning)', bg: 'var(--warning-soft)', title: 'Ningún fondo activo cubre este gasto', Icon: Unlink }
  else if (imp.excedente > 0) cont = { txt: <>Excedente {money(imp.excedente)} <ArrowRight className="size-2.5" /> {imp.destino.map(nombre).join(', ')}</>, fg: 'var(--warning)', bg: 'var(--warning-soft)', title: 'Parte del gasto pasó a otro fondo', Icon: Shuffle }
  else if (imp.manual) cont = { txt: [...new Set(imp.partes.map(p => nombre(p.fondoId)))].join(' + '), fg: '#4F6FC8', bg: '#EEF3FF', title: 'Asignación manual', Icon: Hand }
  else cont = { txt: [...new Set(imp.partes.map(p => nombre(p.fondoId)))].join(' + '), fg: '#64748B', bg: 'var(--bg)', title: 'Fondo asignado automáticamente', Icon: Shuffle }
  return (
    <button type="button" onClick={onClick} className={`${chip} hover:brightness-95`} style={{ color: cont.fg, background: cont.bg }} title={`${cont.title}. Ver / cambiar asignación`}
      data-testid="indicador-fondos" aria-label={`Ver o cambiar la asignación a fondos: ${cont.title}`}>
      <cont.Icon className="size-2.5 shrink-0" /><span className="truncate">{cont.txt}</span>{imp.conflicto && <AlertTriangle className="size-2.5 shrink-0" aria-label="Asignación manual inválida" />}
    </button>
  )
}

interface Fila { fondoId: string; monto: string }

export function AsignacionModal({ store, gasto, imp, onClose }: { store: AppStore; gasto: Gasto; imp: Imputacion | undefined; onClose: () => void }) {
  const data = store.data!
  const base = data.config.moneda || 'PEN'
  const money = (c: number) => formatMoney(c, base)
  const fondos = useMemo(() => data.fondos ?? [], [data.fondos])
  const nombres = useMemo(() => new Map(fondos.map(f => [f.id, f.nombre])), [fondos])
  const nombre = (id: string) => nombres.get(id) ?? 'Fondo eliminado'
  const ctx = ctxReparto(data)
  const mes = gasto.fecha.slice(0, 7)
  const historico = mes < todayIn().slice(0, 7)
  const guardada = data.asignaciones?.[gasto.id.toLowerCase()] ?? []
  const opciones = useMemo(() => elegibles(gasto, mes, fondos, f => activoEnMes(f, mes, ctx)).map(e => e.f), [gasto, mes, fondos]) // eslint-disable-line react-hooks/exhaustive-deps
  const otraMoneda = gasto.moneda !== base
  const [editar, setEditar] = useState(false)
  const [filas, setFilas] = useState<Fila[]>(() => guardada.length ? guardada.map(p => ({ fondoId: p.fondoId, monto: p.monto.toFixed(2) }))
    : imp?.partes.length && !otraMoneda ? agrupar(imp).map(([fondoId, c]) => ({ fondoId, monto: (c / 100).toFixed(2) })) : [{ fondoId: opciones[0]?.id ?? '', monto: gasto.monto.toFixed(2) }])
  const [confirmo, setConfirmo] = useState(false)
  const partes: ParteManual[] = filas.filter(f => f.fondoId).map(f => ({ fondoId: f.fondoId, monto: Number(f.monto.replace(',', '.')) }))
  const error = editar ? (partes.length ? validarAsignacion(gasto, partes, fondos, ctx) : 'Elige al menos un fondo.') : null
  // Simulación: cómo quedarían los fondos con esta asignación (avisa sobregiros; no bloquea).
  const simulacion = useMemo(() => {
    if (!editar || error) return []
    const r = asignarMes(mes, data.gastos, fondos, { ...ctx, asignaciones: { ...(ctx.asignaciones ?? {}), [gasto.id.toLowerCase()]: partes } })
    return partes.map(p => r.porFondo.get(p.fondoId)).map((c, i) => c && c.imputado > c.cupo ? `${nombre(partes[i].fondoId)} quedará excedido en ${money(c.imputado - c.cupo)}.` : '').filter(Boolean)
  }, [editar, error, JSON.stringify(partes)]) // eslint-disable-line react-hooks/exhaustive-deps
  const suma = partes.reduce((s, p) => s + (Number.isFinite(p.monto) ? Math.round(p.monto * 100) : 0), 0)
  const busy = store.pending.has(`asignacion:${gasto.id}`)
  const necesitaConfirmar = historico && !confirmo

  const guardar = (nuevas: ParteManual[]) => {
    const ok = store.track(`asignacion:${gasto.id}`, nuevas.length
      ? { pending: 'Guardando la asignación…', ok: `Asignación manual guardada: ${nuevas.map(p => `${nombre(p.fondoId)} ${money(Math.round(p.monto * 100))}`).join(' · ')}. El gasto no cambió.`, error: 'No se pudo guardar la asignación.' }
      : { pending: 'Restaurando la asignación automática…', ok: 'Se restauró la asignación automática. El gasto no cambió.', error: 'No se pudo restaurar la asignación automática.' },
    () => store.actions.saveAsignacion(gasto.id, nuevas))
    if (ok) onClose()
  }

  return (
    <Modal open onClose={onClose} size="md" title="Asignación a fondos" subtitle={`${gasto.descripcion || gasto.subcategoria} · ${gasto.fecha} · ${formatMoney(Math.round(gasto.monto * 100), gasto.moneda)}`}
      icon={<Shuffle className="size-5" />}
      footer={editar
        ? <><Button variant="outline" onClick={() => setEditar(false)}>Cancelar</Button><Button disabled={!!error || busy || necesitaConfirmar} onClick={() => guardar(partes)}>Guardar asignación</Button></>
        : <><Button variant="outline" onClick={onClose}>Cerrar</Button>
          {guardada.length > 0 && <Button variant="soft" disabled={busy || necesitaConfirmar} onClick={() => guardar([])}><RotateCcw className="size-4" /> Restaurar asignación automática</Button>}
          <Button disabled={!opciones.length || otraMoneda} onClick={() => setEditar(true)} title={otraMoneda ? 'Solo para gastos en la moneda base' : undefined}>Cambiar asignación</Button></>}>
      <div className="space-y-3 text-sm" data-testid="asignacion-gasto">
        <p className="text-xs text-muted">{gasto.ambito} › {gasto.categoria}{gasto.subcategoria ? ` › ${gasto.subcategoria}` : ''} · {gasto.medioPago}</p>
        {imp && (
          <>
            <ul className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line" aria-label="Distribución del gasto" data-testid="distribucion-gasto">
              {imp.partes.map(p => (
                <li key={`${p.fondoId}-${p.tipo}`} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span className="min-w-0 truncate"><b className="text-ink">{nombre(p.fondoId)}</b> <span className="text-muted">· {TIPO_PARTE_TXT[p.tipo]}</span></span>
                  <span className="tabular shrink-0 font-semibold">{money(p.cents)}</span>
                </li>
              ))}
              {imp.sinFondo > 0 && <li className="flex justify-between gap-3 px-3 py-2 text-xs" style={{ color: 'var(--warning)' }}><span>Sin fondo asignable</span><span className="tabular font-semibold">{money(imp.sinFondo)}</span></li>}
              <li className="flex justify-between gap-3 bg-bg/60 px-3 py-2 text-xs font-semibold"><span>Total</span><span className="tabular">{money(imp.total)}</span></li>
            </ul>
            <p className="rounded-xl bg-bg px-3 py-2 text-xs text-muted" data-testid="explicacion-asignacion">{explicarImputacion(imp, nombre, money)}</p>
            {imp.conflicto && <ErrorBox tone="warning" message={`La asignación manual guardada ya no es válida: ${imp.conflicto} Se usa la automática hasta que la cambies o la restaures.`} />}
          </>
        )}
        {!opciones.length && <p className="text-xs text-muted">Ningún fondo activo de {monthLabel(mes, true)} acepta este gasto, así que no se puede asignar a mano. Revisa la cobertura y los medios de tus fondos.</p>}
        {otraMoneda && <p className="text-xs text-muted">La asignación manual solo está disponible para gastos en {base}.</p>}

        {editar && (
          <div className="space-y-2 rounded-xl border border-line p-3" data-testid="editor-asignacion">
            <p className="text-xs text-muted">Solo aparecen los fondos activos que cubren este gasto y aceptan su medio. La suma debe ser exactamente {formatMoney(Math.round(gasto.monto * 100), gasto.moneda)}.</p>
            {filas.map((f, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2">
                <SelectField label={`Fondo ${i + 1}`} value={f.fondoId} onChange={v => setFilas(xs => xs.map((x, j) => j === i ? { ...x, fondoId: v } : x))}>
                  <option value="">Elige un fondo…</option>
                  {opciones.map(o => <option key={o.id} value={o.id} disabled={filas.some((x, j) => j !== i && x.fondoId === o.id)}>{o.nombre}</option>)}
                </SelectField>
                <input aria-label={`Importe para el fondo ${i + 1}`} className={`${inputCls} tabular h-11 text-right`} inputMode="decimal" value={f.monto}
                  onChange={e => setFilas(xs => xs.map((x, j) => j === i ? { ...x, monto: e.target.value.replace(/[^\d.,]/g, '') } : x))} />
                <button type="button" aria-label={`Quitar fondo ${i + 1}`} disabled={filas.length === 1} onClick={() => setFilas(xs => xs.filter((_, j) => j !== i))}
                  className="grid size-9 place-items-center rounded-lg text-muted hover:bg-bg disabled:opacity-30"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" className="h-9 text-xs" disabled={filas.length >= Math.min(10, opciones.length)} onClick={() => setFilas(xs => [...xs, { fondoId: '', monto: '' }])}><Plus className="size-3.5" /> Agregar fondo</Button>
              <span className="tabular text-xs text-muted">Suma {money(suma)} de {money(Math.round(gasto.monto * 100))}</span>
            </div>
            {error && <ErrorBox message={error} />}
            {simulacion.map(t => <p key={t} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--warning)' }}><AlertTriangle className="size-3.5" /> {t} Puedes guardar igual.</p>)}
          </div>
        )}
        {historico && (editar || guardada.length > 0) && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
            <Checkbox checked={confirmo} onChange={setConfirmo} label={`Confirmo que quiero cambiar el reparto de ${monthLabel(mes, true)}, un mes cerrado. Cambiarán sus saldos por fondo; el gasto no se modifica.`} />
          </div>
        )}
      </div>
    </Modal>
  )
}

function agrupar(imp: Imputacion): [string, number][] {
  const m = new Map<string, number>()
  for (const p of imp.partes) m.set(p.fondoId, (m.get(p.fondoId) ?? 0) + p.cents)
  return [...m]
}
