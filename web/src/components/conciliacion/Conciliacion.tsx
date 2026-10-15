import { useMemo, useState } from 'react'
import { Download, History, Landmark, Layers, Plus, Search } from 'lucide-react'
import type { AppStore } from '../../lib/store'
import { formatDate, monthEnd, monthLabel } from '../../lib/dates'
import {
  calcularSaldos, cortePersonas, difTxt, ESTADO_TXT, ESTADO_VISUAL_TXT, estaDesactualizada, fechaEnTz, gruposDeTrabajo, historialCsv, montoTxt,
  porcentajeDif, signoDe, verificaciones, visualDe, vigentePorGrupo, type EstadoVisual, type SaldoCalculado, type Verificacion,
} from '../../lib/conciliacion'
import { Button, DateField, Empty, InfoTooltip, SelectField, inputCls } from '../ui'
import { Chip, mesesDisponibles } from './piezas'
import { NuevaConciliacion } from './NuevaConciliacion'
import { RevisarDiferencia } from './RevisarDiferencia'
import { GruposFondos } from './GruposFondos'

type Modal =
  | null
  | { k: 'nueva'; grupoId?: string; reemplaza?: Verificacion }
  | { k: 'revisar' | 'detalle'; v: Verificacion }
  | { k: 'grupos' }

/**
 * Salud financiera → Conciliación de saldos (v1.22). Compara lo que Deejota calcula que deberías tener con lo que realmente
 * tienes. Solo lee los datos ya cargados (sin consultas nuevas) y NUNCA escribe al mostrarse: únicamente cuando tú guardas una
 * verificación, un seguimiento o un grupo. El refresco automático nunca toca un saldo real verificado.
 */
export function Conciliacion({ store, today, onRevisarGastos, onNuevoGasto, onIrFuentes }: {
  store: AppStore; today: string
  onRevisarGastos: (desde: string, hasta: string) => void
  onNuevoGasto: (fecha: string) => void
  onIrFuentes: () => void
}) {
  const data = store.data!
  const tz = data.config.zona_horaria || 'America/Lima'
  const formato = data.config.formato_fecha || 'dd/MM/yyyy'
  const hoyMes = today.slice(0, 7)
  const [periodo, setPeriodo] = useState(hoyMes)
  const [corte, setCorte] = useState(today)
  const [modal, setModal] = useState<Modal>(null)
  const [historialAbierto, setHistorialAbierto] = useState(false)
  const [fPeriodo, setFPeriodo] = useState('')
  const [fGrupo, setFGrupo] = useState('')
  const [q, setQ] = useState('')

  const conc = data.conciliaciones
  const grupos = useMemo(() => gruposDeTrabajo(conc), [conc])
  const vs = useMemo(() => verificaciones(conc), [conc])
  const saldo = useMemo(() => calcularSaldos(data, periodo, corte, today, grupos), [data, periodo, corte, today, grupos])
  const periodos = mesesDisponibles(hoyMes, 12, [...vs.map(v => v.periodo), periodo])

  // Saldo calculado HOY para el corte de cada verificación vigente: si difiere de su foto, la verificación está desactualizada.
  const actualDe = useMemo(() => {
    const cache = new Map<string, SaldoCalculado>()
    return (v: Verificacion): number | null => {
      const fecha = fechaEnTz(v.corte, tz), k = `${v.periodo}|${fecha}`
      let s = cache.get(k)
      if (!s) { s = calcularSaldos(data, v.periodo, fecha, today, grupos); cache.set(k, s) }
      return s.porGrupo[v.grupoId] ?? null
    }
  }, [data, tz, today, grupos])

  const filas = grupos.map(g => {
    const v = vigentePorGrupo(vs, periodo, g.id)
    const calc = saldo.porGrupo[g.id] ?? null
    const stale = v ? estaDesactualizada(v, actualDe(v)) : false
    const dif = v?.diferencia ?? null
    const estado: EstadoVisual = !saldo.calculable || (calc === null && !v) ? 'insuficiente' : !v ? 'sin_verificar' : stale ? 'desactualizada'
      : visualDe(dif ?? 0)
    return { g, v, calc, stale, dif, estado }
  })
  const verificadas = filas.filter(f => f.v)
  const sumaReal = verificadas.reduce((s, f) => s + (f.v!.real ?? 0), 0)
  const sumaDif = verificadas.reduce((s, f) => s + (f.v!.diferencia ?? 0), 0)
  const sumaCalcSnap = verificadas.reduce((s, f) => s + (f.v!.calculado ?? 0), 0)
  const algunaStale = verificadas.some(f => f.stale)
  const ultima = vs.find(v => !v.corregidaPor)
  const ultimaDelPeriodo = verificadas.map(f => f.v!).sort((a, b) => b.corte.localeCompare(a.corte))[0]
  const estadoGlobal: EstadoVisual = !saldo.calculable ? 'insuficiente' : !verificadas.length ? 'sin_verificar' : algunaStale ? 'desactualizada'
    : verificadas.some(f => signoDe(f.v!.diferencia ?? 0) !== 'cero' && f.v!.estadoEfectivo !== 'cerrada_justificada') ? 'pendiente' : 'conciliado'
  const estadoDif: EstadoVisual = !verificadas.length ? 'sin_verificar' : algunaStale ? 'desactualizada' : visualDe(sumaDif)

  const m = saldo.moneda
  const cambiarPeriodo = (p: string) => { setPeriodo(p); setCorte(p === hoyMes ? today : monthEnd(p)) }

  // Historial filtrado (todas las verificaciones, también las corregidas: nada se borra).
  const term = q.trim().toLowerCase()
  const hist = vs.filter(v => (!fPeriodo || v.periodo === fPeriodo) && (!fGrupo || v.grupoId === fGrupo)
    && (!term || `${v.grupo} ${v.notaEfectiva} ${monthLabel(v.periodo, true)} ${ESTADO_TXT[v.estadoEfectivo]}`.toLowerCase().includes(term)))
  const exportar = () => {
    const blob = new Blob([historialCsv(hist, tz, formato)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'conciliaciones.csv'; a.click(); URL.revokeObjectURL(a.href)
  }
  const abrirNueva = (grupoId?: string) => setModal({ k: 'nueva', grupoId })

  return (
    <section className="space-y-3" aria-label="Conciliación de saldos" data-testid="conciliacion">
      <div className="rounded-3xl border border-line bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-navy"><Landmark className="size-5" /></span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight text-ink">Conciliación de saldos</h2>
              <p className="text-sm text-muted">Compara tus saldos reales con los importes registrados y detecta diferencias pendientes.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => abrirNueva()} data-testid="conc-nueva"><Plus className="size-4" /> Nueva conciliación</Button>
            <Button variant="outline" onClick={() => setModal({ k: 'grupos' })} data-testid="conc-grupos-btn"><Layers className="size-4" /> Grupos de fondos</Button>
            <Button variant="outline" onClick={() => setHistorialAbierto(o => !o)} aria-expanded={historialAbierto} data-testid="conc-historial-btn"><History className="size-4" /> Historial</Button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_1fr] sm:items-end">
          <label className="block text-xs font-medium text-muted">Período
            <SelectField value={periodo} onChange={cambiarPeriodo} label="Período de la conciliación">
              {periodos.map(p => <option key={p} value={p}>{monthLabel(p, true)}</option>)}
            </SelectField>
          </label>
          <div className="text-xs font-medium text-muted">Fecha de corte
            <DateField value={corte} onChange={v => { if (v) setCorte(v) }} format={formato} min={`${periodo}-01`} max={periodo === hoyMes ? today : monthEnd(periodo)} today={today} label="Fecha de corte" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted sm:justify-end">
            <span data-testid="conc-ultima">Última conciliación: <b className="text-ink">{ultima ? cortePersonas(ultima.corte, tz, formato) : 'ninguna todavía'}</b></span>
            <Chip estado={estadoGlobal} testid="conc-estado-general" />
          </div>
        </div>
      </div>

      {!saldo.calculable && (
        <p role="status" className="rounded-xl bg-bg px-3 py-2 text-sm text-muted" data-testid="conc-insuficiente">Información insuficiente. {saldo.motivo}</p>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <Kpi titulo="Disponible presupuestario" testid="conc-kpi-disponible"
          info="Dinero que debería quedar según las fuentes efectivas y gastos registrados hasta la fecha de corte."
          valor={saldo.total !== null ? montoTxt(saldo.total, m) : 'Información insuficiente'} apagado={saldo.total === null}
          sub={`${monthLabel(periodo, true)} · corte ${formatDate(corte, formato)} · ${m}`}>
          {saldo.total !== null && <p className="mt-1 text-[11px] text-muted">Reservado en cajas {montoTxt(saldo.reservado, m)} · Libre no reservado {saldo.libreNoReservado !== null ? montoTxt(saldo.libreNoReservado, m) : '—'}</p>}
        </Kpi>
        <Kpi titulo="Saldo real verificado" testid="conc-kpi-real"
          info="Dinero que realmente tienes según los saldos comprobados en tus cuentas y medios financieros."
          valor={verificadas.length ? montoTxt(sumaReal, m) : 'Sin saldo verificado'} apagado={!verificadas.length}
          sub={ultimaDelPeriodo ? `Verificado ${cortePersonas(ultimaDelPeriodo.corte, tz, formato)} · ${m}` : 'Aún no verificas este período'}>
          <p className="mt-1 text-[11px] text-muted">{verificadas.length ? `${verificadas.length} de ${grupos.length} grupo${grupos.length === 1 ? '' : 's'} verificado${verificadas.length === 1 ? '' : 's'}` : 'Usa «Nueva conciliación» para registrar tus saldos.'}</p>
        </Kpi>
        <Kpi titulo="Diferencia" testid="conc-kpi-diferencia"
          info="Saldo real verificado − saldo presupuestario calculado en la fecha de la verificación. Es una diferencia para investigar, no un ingreso ni un gasto."
          valor={verificadas.length ? difTxt(sumaDif, m) : '—'} apagado={!verificadas.length}
          sub={ESTADO_VISUAL_TXT[estadoDif]}>
          <div className="mt-1 flex flex-wrap items-center gap-2"><Chip estado={estadoDif} />
            {verificadas.length > 0 && porcentajeDif(sumaDif, sumaCalcSnap) !== null && <span className="text-[11px] text-muted">{porcentajeDif(sumaDif, sumaCalcSnap)! > 0 ? '+' : ''}{porcentajeDif(sumaDif, sumaCalcSnap)}% del calculado</span>}</div>
        </Kpi>
      </div>

      <div className="rounded-2xl border border-line bg-card" data-testid="conc-grupos-lista">
        <ul className="divide-y divide-line/70">
          {filas.map(({ g, v, calc, stale, dif, estado }) => (
            <li key={g.id} className="grid gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))_auto] sm:items-center" data-testid="conc-grupo" data-grupo={g.id}>
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{g.nombre}</p><p className="text-[11px] text-muted">{v ? `Verificado ${cortePersonas(v.corte, tz, formato)}` : 'Sin verificar'}{v && stale ? ' · desactualizado' : ''}</p></div>
              <Cifra k="Calculado" v={calc !== null ? montoTxt(calc, m) : 'Info. insuficiente'} muted={calc === null} />
              <Cifra k="Real" v={v?.real != null ? montoTxt(v.real, m) : 'Sin verificar'} muted={!v} />
              <div className="min-w-0"><p className="text-[11px] text-muted sm:hidden">Diferencia</p><div className="flex flex-wrap items-center gap-1.5">
                <span className="tabular text-sm font-semibold text-ink" data-testid="conc-grupo-dif">{v && dif !== null ? difTxt(dif, m) : '—'}</span><Chip estado={estado} />
              </div>{v && dif !== null && signoDe(dif) !== 'cero' && <p className="text-[11px] text-muted">{ESTADO_TXT[v.estadoEfectivo]}</p>}</div>
              <div className="flex flex-wrap gap-1.5 sm:justify-end">
                <Button variant="outline" className="h-8 text-xs" onClick={() => abrirNueva(g.id)} disabled={calc === null} data-testid="conc-verificar">{v ? 'Verificar de nuevo' : 'Verificar'}</Button>
                {v && dif !== null && signoDe(dif) !== 'cero' && <Button variant="soft" className="h-8 text-xs" onClick={() => setModal({ k: 'revisar', v })} data-testid="conc-revisar">Revisar diferencia</Button>}
                {v && <Button variant="ghost" className="h-8 text-xs" onClick={() => setModal({ k: 'detalle', v })}>Detalle</Button>}
              </div>
            </li>
          ))}
        </ul>
        {saldo.sinAtribuir !== null && Math.abs(saldo.sinAtribuir) >= 0.005 && (
          <p className="border-t border-line/70 px-4 py-2 text-[11px] text-warning" data-testid="conc-sin-atribuir">Sin atribuir a ningún grupo: {montoTxt(saldo.sinAtribuir, m)} (gastos con fuente inactiva o sin fuente, o fuentes que no están en un grupo).</p>
        )}
        {saldo.advertencias.map(a => <p key={a} className="border-t border-line/70 px-4 py-2 text-[11px] text-warning">{a}</p>)}
      </div>

      {historialAbierto && (
        <div className="rounded-2xl border border-line bg-card p-4" data-testid="conc-historial">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="block min-w-36 flex-1 text-xs font-medium text-muted">Período
              <SelectField value={fPeriodo} onChange={setFPeriodo} label="Filtrar por período"><option value="">Todos</option>{periodos.map(p => <option key={p} value={p}>{monthLabel(p, true)}</option>)}</SelectField></label>
            <label className="block min-w-36 flex-1 text-xs font-medium text-muted">Grupo
              <SelectField value={fGrupo} onChange={setFGrupo} label="Filtrar por grupo"><option value="">Todos</option>{[...new Map(vs.map(v => [v.grupoId, v.grupo])).entries()].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</SelectField></label>
            <label className="relative block min-w-40 flex-[2] text-xs font-medium text-muted">Buscar
              <Search aria-hidden className="pointer-events-none absolute bottom-3 left-3 size-4" />
              <input className={`${inputCls} control-box h-11 pl-9`} value={q} onChange={e => setQ(e.target.value)} placeholder="Grupo, estado u observación" aria-label="Buscar en el historial" /></label>
            <Button variant="outline" onClick={exportar} disabled={!hist.length} data-testid="conc-exportar"><Download className="size-4" /> Exportar</Button>
          </div>
          {!hist.length ? <Empty icon={<History className="size-5" />} title={vs.length ? 'Ninguna conciliación coincide' : 'Aún no hay conciliaciones'}>{vs.length ? 'Prueba con otro período, grupo o palabra.' : 'Cada verificación que guardes quedará aquí, con su fecha y hora.'}</Empty> : (
            <ul className="divide-y divide-line/70">
              {hist.map(v => (
                <li key={v.id} className="grid gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_repeat(3,minmax(0,0.9fr))_auto] sm:items-center" data-testid="conc-hist-fila">
                  <div className="min-w-0"><p className="text-sm font-medium text-ink">{cortePersonas(v.corte, tz, formato)}</p><p className="text-[11px] text-muted">{monthLabel(v.periodo, true)}</p></div>
                  <p className="truncate text-sm text-ink">{v.grupo}{v.corregidaPor && <span className="ml-1 rounded-full bg-bg px-1.5 py-0.5 text-[10px] font-semibold text-muted">Corregida</span>}</p>
                  <Cifra k="Calculado" v={v.calculado !== null ? montoTxt(v.calculado, v.moneda) : '—'} />
                  <Cifra k="Real" v={v.real !== null ? montoTxt(v.real, v.moneda) : '—'} />
                  <Cifra k="Diferencia" v={v.diferencia !== null ? difTxt(v.diferencia, v.moneda) : '—'} />
                  <div className="flex items-center gap-2 sm:justify-end"><span className="text-[11px] text-muted">{ESTADO_TXT[v.estadoEfectivo]}</span>
                    <Button variant="ghost" className="h-8 text-xs" onClick={() => setModal({ k: 'detalle', v })}>Ver detalle</Button></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {modal?.k === 'nueva' && <NuevaConciliacion store={store} today={today} periodoInicial={periodo} fechaInicial={corte} grupoInicial={modal.grupoId} reemplaza={modal.reemplaza}
        onClose={() => setModal(null)} onRevisarGastos={onRevisarGastos} />}
      {(modal?.k === 'revisar' || modal?.k === 'detalle') && (
        <RevisarDiferencia store={store} v={modal.v} tz={tz} formato={formato} soloDetalle={modal.k === 'detalle'} actual={actualDe(modal.v)} desactualizada={!modal.v.corregidaPor && estaDesactualizada(modal.v, actualDe(modal.v))}
          onClose={() => setModal(null)} onRevisarGastos={onRevisarGastos} onNuevoGasto={onNuevoGasto} onIrFuentes={onIrFuentes}
          onVerificarDeNuevo={v => { setPeriodo(v.periodo); setCorte(v.periodo === hoyMes ? today : monthEnd(v.periodo)); setModal({ k: 'nueva', grupoId: v.grupoId }) }}
          onCorregir={v => setModal({ k: 'nueva', reemplaza: v })} />
      )}
      {modal?.k === 'grupos' && <GruposFondos store={store} onClose={() => setModal(null)} />}
    </section>
  )
}

function Kpi({ titulo, valor, sub, info, apagado, testid, children }: { titulo: string; valor: string; sub: string; info: string; apagado?: boolean; testid: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-card p-4" data-testid={testid}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">{titulo}</p>
        <InfoTooltip title={titulo}><p>{info}</p></InfoTooltip>
      </div>
      <p className={`mt-1 tabular font-bold ${apagado ? 'text-base text-muted' : 'text-2xl text-ink'}`} data-testid={`${testid}-valor`}>{valor}</p>
      <p className="text-[11px] text-muted">{sub}</p>
      {children}
    </div>
  )
}

function Cifra({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return <div className="min-w-0"><p className="text-[11px] text-muted sm:hidden">{k}</p><p className={`tabular truncate text-sm ${muted ? 'text-muted' : 'font-semibold text-ink'}`}>{v}</p></div>
}

