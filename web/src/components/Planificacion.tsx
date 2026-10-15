import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, Ban, Bell, CalendarCheck2, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardList, Copy, FileClock, Loader2, RotateCcw, Settings2, SkipForward, Wallet } from 'lucide-react'
import { ETAPAS, estadoDesdeEtapas, leerEstadoPlan, mesAnterior, nombreMes, proximasFechas, serializarEstadoPlan, type Etapa, type EstadoEtapa, type EstadoPlan, type PlanMes } from '../lib/plan'
import { candidatos, recordatoriosVigentes, resumenMes, resumenReal, verificarEntidadesAplicadas, type Candidato, type ContextoPlan, type TipoEntidad } from '../lib/planificar'
import { aislaDesde } from '../lib/engine'
import { formatMoney } from '../lib/money'
import { formatDate } from '../lib/dates'
import type { AppStore } from '../lib/store'
import { Button, ErrorBox, Modal } from './ui'

/**
 * Planificación mensual (v1.19). Guía para preparar cada mes con SUS fuentes, subcajas y gastos: nada se arrastra solo.
 * Las selecciones viven en memoria hasta "Aplicar planificación": avanzar de etapa no escribe nada y los gastos nunca se
 * registran por avanzar. El estado de cada mes (y de cada etapa) se guarda en CONFIG, así se ve igual en cualquier dispositivo.
 */

const ETAPA_TXT: Record<Etapa, { titulo: string; icon: typeof Wallet }> = {
  fuentes: { titulo: 'Fuentes', icon: CircleDollarSign }, subcajas: { titulo: 'Cajas', icon: Wallet }, gastos: { titulo: 'Gastos', icon: ClipboardList },
}
export const ESTADO_TXT: Record<EstadoPlan, string> = { pendiente: 'Pendiente', en_progreso: 'En progreso', completada: 'Completada', descartada: 'Descartada' }
const ESTADO_TONO: Record<EstadoPlan, string> = {
  pendiente: 'bg-warning-soft text-warning', en_progreso: 'bg-primary-soft text-navy', completada: 'bg-success-soft text-success', descartada: 'bg-bg text-muted',
}
const MONTO_RE = /^\d{1,9}([.,]\d{1,2})?$/

export const Insignia = ({ estado, posp }: { estado: EstadoPlan; posp?: boolean }) => (
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${posp ? 'bg-bg text-muted' : ESTADO_TONO[estado]}`}>{posp ? 'Pospuesta' : ESTADO_TXT[estado]}</span>
)

function mananaDe(hoy: string): string {
  const d = new Date(`${hoy}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10)
}

export interface PlanificacionOpts { hoy: string; onGastosMensuales: (ctx?: ContextoPlan) => void; onPlantillas: (t: TipoEntidad, ctx?: ContextoPlan) => void; onConfigurar: () => void }

export function usePlanificacion(store: AppStore, o: PlanificacionOpts) {
  const [wiz, setWiz] = useState<{ mes: string; etapa: Etapa | null; key: number } | null>(null)
  const [ant, setAnt] = useState<{ tipo: TipoEntidad; mes: string; key: number } | null>(null)
  const [res, setRes] = useState<{ key: number } | null>(null)
  const hoyMes = o.hoy.slice(0, 7)
  const abrir = (mes: string = hoyMes, etapa: Etapa | null = null) => setWiz({ mes, etapa, key: Date.now() })
  const usarAnterior = (tipo: TipoEntidad, mes: string) => setAnt({ tipo, mes, key: Date.now() })
  const abrirResumen = () => setRes({ key: Date.now() })
  const nodo = store.data ? (
    <>
      {wiz && <Asistente key={wiz.key} store={store} mes={wiz.mes} etapaInicial={wiz.etapa} o={o} onClose={() => setWiz(null)} />}
      {ant && <UsarMesAnterior key={ant.key} store={store} tipo={ant.tipo} mes={ant.mes} onClose={() => setAnt(null)} />}
      {res && (
        <Modal open onClose={() => setRes(null)} size="md" title="Planificación mensual" subtitle="Cada mes tiene sus propias fuentes, cajas y gastos." icon={<CalendarCheck2 className="size-5" />}
          footer={<Button variant="outline" onClick={() => setRes(null)}>Cerrar</Button>}>
          <ResumenPlan store={store} hoy={o.hoy} onPreparar={() => { setRes(null); abrir() }} onConfigurar={() => { setRes(null); o.onConfigurar() }} />
        </Modal>
      )}
    </>
  ) : null
  const campana = store.data ? <Campana store={store} hoy={o.hoy} onPreparar={mes => abrir(mes)} onResumen={abrirResumen} /> : null
  return { abrir, usarAnterior, abrirResumen, nodo, campana }
}
export type PlanificacionApi = ReturnType<typeof usePlanificacion>

/* ============================== Campana + panel ============================== */

function Campana({ store, hoy, onPreparar, onResumen }: { store: AppStore; hoy: string; onPreparar: (mes: string) => void; onResumen: () => void }) {
  const data = store.data!
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  const pendientes = useMemo(() => recordatoriosVigentes(data, hoy), [data, hoy])
  const proxima = useMemo(() => proximasFechas(data.config, hoy, 1)[0], [data.config, hoy])
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc) }
  }, [abierto])
  const guardar = (mes: string, p: Partial<PlanMes>, ok: string) => store.track(`plan:${mes}`, { pending: 'Guardando…', ok, error: 'No se pudo guardar el aviso. Inténtalo de nuevo.' },
    () => store.actions.saveConfig(`plan_est_${mes}`, serializarEstadoPlan({ ...leerEstadoPlan(data.config, mes), ...p })))
  const n = pendientes.length
  return (
    <div ref={caja} className="relative">
      <button type="button" onClick={() => setAbierto(v => !v)} aria-label={n ? `Avisos de planificación (${n} pendiente${n === 1 ? '' : 's'})` : 'Avisos de planificación'} aria-haspopup="dialog" aria-expanded={abierto} data-testid="campana-plan"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted outline-none transition hover:bg-bg focus-visible:ring-2 focus-visible:ring-navy/60">
        <Bell className="size-4" />
        {n > 0 && <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-4 font-bold text-white" data-testid="campana-badge">{n}</span>}
      </button>
      {abierto && (
        <div role="dialog" aria-label="Planificación mensual" data-testid="panel-plan"
          className="fixed inset-x-3 top-[calc(var(--header-h,48px)+0.5rem)] z-40 max-h-[70dvh] overflow-y-auto rounded-2xl border border-line bg-card p-3 shadow-2xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96">
          <p className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-ink"><CalendarCheck2 className="size-4 text-navy" /> Planificación mensual</p>
          {!n ? (
            <p className="rounded-xl bg-bg px-3 py-3 text-xs text-muted" data-testid="plan-al-dia">
              {data.config.plan_activo === 'false' ? 'Los recordatorios están desactivados (Configuración → Preferencias).' : `Todo al día.${proxima ? ` Próximo aviso: ${formatDate(proxima.fecha, data.config.formato_fecha)} (${nombreMes(proxima.mes)}).` : ''}`}
            </p>
          ) : (
            <ul className="space-y-2">
              {pendientes.map(r => (
                <li key={r.mes} className="rounded-xl border border-line p-3" data-testid={`aviso-${r.mes}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-ink">Prepara {nombreMes(r.mes)}</p><Insignia estado={r.plan.estado} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">Aviso del {formatDate(r.fecha, data.config.formato_fecha)}. Elige las fuentes, cajas y gastos de este mes.</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button className="h-8 text-xs" onClick={() => { setAbierto(false); onPreparar(r.mes) }}>Preparar ahora</Button>
                    <Button variant="outline" className="h-8 text-xs" disabled={store.pending.has(`plan:${r.mes}`)} onClick={() => guardar(r.mes, { posponerHasta: mananaDe(hoy) }, 'Te lo recordaremos mañana.')}>Recordar después</Button>
                    <Button variant="ghost" className="h-8 text-xs" disabled={store.pending.has(`plan:${r.mes}`)} onClick={() => guardar(r.mes, { estado: 'descartada' }, `Aviso de ${nombreMes(r.mes)} descartado.`)}>Descartar aviso del mes</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => { setAbierto(false); onResumen() }} className="mt-2 w-full rounded-lg px-2 py-2 text-left text-xs font-semibold text-navy hover:bg-bg">Ver planificación del mes</button>
        </div>
      )}
    </div>
  )
}

/* ============================== Resumen ============================== */

export function ResumenPlan({ store, hoy, onPreparar, onConfigurar, compacto }: { store: AppStore; hoy: string; onPreparar: () => void; onConfigurar?: () => void; compacto?: boolean }) {
  const data = store.data
  if (!data) return null
  const mes = hoy.slice(0, 7), r = resumenMes(data, mes), plan = leerEstadoPlan(data.config, mes)
  const aisl = aislaDesde(data.config), aplica = mes >= aisl
  const prox = proximasFechas(data.config, hoy, 1)[0]
  const posp = !!plan.posponerHasta && hoy < plan.posponerHasta
  const guardando = store.pending.has(`plan:${mes}`)
  const fila = (k: string, v: ReactNode) => <div className="flex items-baseline justify-between gap-3 text-xs"><dt className="text-muted">{k}</dt><dd className="min-w-0 text-right font-medium text-ink">{v}</dd></div>
  return (
    <section aria-label="Planificación mensual" data-testid="resumen-plan" className={compacto ? 'rounded-2xl border border-line bg-card p-3' : ''}>
      <dl className="space-y-1.5">
        {fila('Mes actual', nombreMes(mes))}
        {fila('Estado', guardando
          ? <span className="inline-flex items-center gap-1.5 text-navy" data-testid="plan-guardando"><Loader2 className="size-3.5 animate-spin" /> Guardando planificación…</span>
          : <Insignia estado={plan.estado} posp={posp && plan.estado !== 'completada'} />)}
        {fila('Fuentes configuradas', aplica ? `${r.fuentes} de ${r.fuentesTotal}` : 'Mes anterior al aislamiento (todas)')}
        {fila('Cajas configuradas', aplica ? `${r.subcajas} de ${r.cajasTotal}` : 'Mes anterior al aislamiento (todas)')}
        {fila('Gastos registrados', r.gastos)}
        {fila('Próximo recordatorio', prox ? `${formatDate(prox.fecha, data.config.formato_fecha)} · ${nombreMes(prox.mes)}` : 'Sin recordatorios programados')}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="h-9 text-xs" onClick={onPreparar}><CalendarCheck2 className="size-3.5" /> {plan.estado === 'pendiente' ? 'Preparar mes' : 'Ver planificación'}</Button>
        {onConfigurar && <Button variant="outline" className="h-9 text-xs" onClick={onConfigurar}><Settings2 className="size-3.5" /> Configurar recordatorios</Button>}
      </div>
    </section>
  )
}

/* ============================== Selección de fuentes / subcajas ============================== */

interface Sel { on: boolean; monto: string }
const aSel = (cs: Candidato[]): Record<string, Sel> => Object.fromEntries(cs.map(c => [c.id, { on: c.aplicada, monto: String(c.monto) }]))
const montoNum = (s: string) => Number(s.replace(',', '.'))

function ListaSel({ cands, sel, setSel, tipo }: { cands: Candidato[]; sel: Record<string, Sel>; setSel: (s: Record<string, Sel>) => void; tipo: TipoEntidad }) {
  if (!cands.length) return <p className="rounded-xl bg-bg px-3 py-4 text-sm text-muted">{tipo === 'fuente' ? 'Aún no tienes fuentes mensuales. Créalas desde Cajas → Nueva fuente.' : 'Aún no tienes cajas activas. Créalas desde Cajas → Nueva caja.'}</p>
  return (
    <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line" aria-label={tipo === 'fuente' ? 'Fuentes del mes' : 'Cajas del mes'}>
      {cands.map(c => {
        const s = sel[c.id] ?? { on: false, monto: '' }, malo = s.on && !MONTO_RE.test(s.monto.trim())
        return (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <label className="flex min-w-0 flex-1 items-center gap-2.5 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--navy)]" checked={s.on} disabled={c.aplicada} onChange={e => setSel({ ...sel, [c.id]: { ...s, on: e.target.checked } })} aria-label={`Aplicar ${c.nombre}`} />
              <span className="min-w-0"><span className="block truncate font-medium text-ink">{c.nombre}</span>
                <span className="block text-[11px] text-muted">{c.aplicada ? 'Ya aplicada a este mes' : c.previo !== null ? `Mes anterior: ${formatMoney(Math.round(c.previo * 100), c.moneda)}` : 'No estaba en el mes anterior'}</span></span>
            </label>
            <input aria-label={`Monto de ${c.nombre}`} aria-invalid={malo} inputMode="decimal" disabled={!s.on} value={s.monto} onChange={e => setSel({ ...sel, [c.id]: { ...s, monto: e.target.value.replace(/[^\d.,]/g, '') } })}
              className={`tabular h-9 w-28 rounded-lg border bg-card px-2 text-right text-sm outline-none focus-visible:ring-2 focus-visible:ring-navy/60 disabled:opacity-50 ${malo ? 'border-danger' : 'border-line'}`} />
          </li>
        )
      })}
    </ul>
  )
}

/** Fuentes/subcajas que realmente se escribirían (marcadas y con monto válido). Las ya aplicadas solo si cambió el monto. */
function itemsAAplicar(cands: Candidato[], sel: Record<string, Sel>): { id: string; monto: number }[] {
  return cands.filter(c => sel[c.id]?.on && MONTO_RE.test(sel[c.id].monto.trim()))
    .map(c => ({ id: c.id, monto: montoNum(sel[c.id].monto) })).filter(i => { const c = cands.find(x => x.id === i.id)!; return !c.aplicada || Math.abs(i.monto - c.monto) > 0.004 })
}

/* ============================== Usar mes anterior ============================== */

export function UsarMesAnterior({ store, tipo, mes, onClose }: { store: AppStore; tipo: TipoEntidad; mes: string; onClose: () => void }) {
  const data = store.data!, prev = mesAnterior(mes)
  const cands = useMemo(() => candidatos(data, tipo, mes), [data, tipo, mes])
  const propios = cands.filter(c => !c.aplicada && c.previo !== null)
  const yaAplicadas = cands.filter(c => c.aplicada)
  const [sel, setSel] = useState<Record<string, Sel>>(() => Object.fromEntries(propios.map(c => [c.id, { on: true, monto: String(c.previo) }])))
  const lista = propios.map(c => ({ ...c, aplicada: false, monto: c.previo! }))
  const items = itemsAAplicar(lista, sel)
  const invalido = lista.some(c => sel[c.id]?.on && !MONTO_RE.test(sel[c.id].monto.trim()))
  const noun = tipo === 'fuente' ? 'fuentes' : 'cajas'
  const aplicar = () => {
    if (!items.length || invalido) return
    const ok = store.track(`plan-ant:${tipo}:${mes}`, { pending: `Aplicando ${noun} a ${nombreMes(mes)}…`, ok: `${items.length} ${items.length === 1 ? (tipo === 'fuente' ? 'fuente aplicada' : 'caja aplicada') : `${noun} aplicadas`} a ${nombreMes(mes)}.`, error: `No se pudieron aplicar las ${noun}.` },
      () => store.actions.aplicarEntidadesMes(tipo, mes, items))
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} size="md" title={`Usar ${noun} del mes anterior`} subtitle={`${nombreMes(prev)} → ${nombreMes(mes)}. Revisa y ajusta antes de aplicar.`} icon={<Copy className="size-5" />}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={aplicar} disabled={!items.length || invalido || store.pending.has(`plan-ant:${tipo}:${mes}`)}>Aplicar {items.length || ''} a {nombreMes(mes)}</Button></>}>
      <div className="space-y-3">
        {!propios.length ? (
          <ErrorBox tone="warning" message={yaAplicadas.length ? `Todas las ${noun} que tenías en ${nombreMes(prev)} ya están aplicadas a ${nombreMes(mes)}. No se sobrescribe nada.` : `${nombreMes(prev)} no tiene ${noun} aplicadas para copiar.`} />
        ) : (
          <>
            <p className="text-xs text-muted">Solo se copian {noun} que no están ya en {nombreMes(mes)}; las existentes no se tocan. No se crean gastos ni dinero nuevo fuera de lo que apliques aquí.</p>
            <ListaSel cands={lista} sel={sel} setSel={setSel} tipo={tipo} />
          </>
        )}
        {yaAplicadas.length > 0 && propios.length > 0 && <p className="text-[11px] text-muted">{yaAplicadas.length} ya aplicada(s) en {nombreMes(mes)}: {yaAplicadas.map(c => c.nombre).join(', ')}.</p>}
      </div>
    </Modal>
  )
}

/* ============================== Asistente ============================== */

/**
 * «Prepara tu mes» (v1.20): asistente continuo. Reglas:
 *  - El asistente NUNCA se cierra para abrir un módulo hijo (Fuentes/Subcajas/Gastos mensuales): se queda montado y oculto,
 *    así conserva período, etapa, selecciones y estados. El hijo avisa al terminar (ContextoPlan) y el asistente reaparece.
 *  - Una etapa solo pasa a «Completada» cuando el backend confirmó y la relectura de Sheets lo verificó. Se guarda en CONFIG.
 *  - Omitir/retomar también se guardan al instante (por mes), así el progreso sobrevive a cerrar, recargar o cambiar de dispositivo.
 *  - Avanzar de etapa jamás escribe dinero ni gastos.
 */
type EstadoVisual = 'pendiente' | 'en_progreso' | 'completada' | 'omitida' | 'error'
const VISUAL: Record<EstadoVisual, { txt: string; cls: string }> = {
  pendiente: { txt: 'Pendiente', cls: 'border-line text-muted hover:bg-bg' },
  en_progreso: { txt: 'En progreso', cls: 'border-navy/50 bg-primary-soft text-navy' },
  completada: { txt: 'Completada', cls: 'border-success/40 bg-success-soft text-success' },
  omitida: { txt: 'Omitida', cls: 'border-line bg-bg text-muted' },
  error: { txt: 'Error', cls: 'border-danger/40 bg-danger-soft text-danger' },
}
const ETAPA_SIG: Record<Etapa, string> = { fuentes: 'Configurar fuentes', subcajas: 'Configurar cajas', gastos: 'Registrar gastos mensuales' }
const ETAPA_OK: Record<Etapa, string> = { fuentes: 'Fuentes configuradas correctamente', subcajas: 'Cajas configuradas correctamente', gastos: 'Gastos mensuales registrados correctamente' }
const money = (c: number, m: string) => formatMoney(c, m)

function Asistente({ store, mes, etapaInicial, o, onClose }: { store: AppStore; mes: string; etapaInicial: Etapa | null; o: PlanificacionOpts; onClose: () => void }) {
  const data = store.data!
  const plan = useMemo(() => leerEstadoPlan(data.config, mes), [data.config, mes])
  const planRef = useRef(plan); planRef.current = plan
  /** Cambios de etapa ya enviados pero aún no reflejados en CONFIG: evita que dos guardados seguidos se pisen (último gana sobre lo viejo). */
  const localRef = useRef<Partial<Record<Etapa, EstadoEtapa>>>({})
  const etapasConLocal = (e?: Etapa, valor?: EstadoEtapa) => { if (e && valor !== undefined) localRef.current = { ...localRef.current, [e]: valor }; return { ...planRef.current.etapas, ...localRef.current } as Record<Etapa, EstadoEtapa> }
  const sinLocal = (e: Etapa) => { const x = { ...localRef.current }; delete x[e]; localRef.current = x }
  const cf = useMemo(() => candidatos(data, 'fuente', mes), [data, mes])
  const cs = useMemo(() => candidatos(data, 'subcaja', mes), [data, mes])
  const primera = etapaInicial ?? ETAPAS.find(e => plan.etapas[e] === 0) ?? 'fuentes'
  const [paso, setPaso] = useState<number>(ETAPAS.indexOf(primera))   // 0..2 etapas · 3 resumen
  const [selF, setSelF] = useState(() => aSel(cf))
  const [selS, setSelS] = useState(() => aSel(cs))
  const [bg, setBg] = useState<Partial<Record<Etapa, boolean>>>({})   // guardado en segundo plano lanzado desde un módulo hijo
  const [hijo, setHijo] = useState<Etapa | null>(null)              // módulo hijo abierto: el asistente queda oculto pero montado
  const [fallo, setFallo] = useState<Partial<Record<Etapa | 'final', { msg: string; reintentar: () => void }>>>({})
  const etapa = ETAPAS[paso] as Etapa | undefined
  const aisl = aislaDesde(data.config), antesCorte = mes < aisl
  const itF = itemsAAplicar(cf, selF), itS = itemsAAplicar(cs, selS)
  const invalidoF = cf.some(c => selF[c.id]?.on && !MONTO_RE.test(selF[c.id].monto.trim()))
  const invalidoS = cs.some(c => selS[c.id]?.on && !MONTO_RE.test(selS[c.id].monto.trim()))
  const keyFinal = `plan:${mes}`
  const ocupado = (e: Etapa | 'final') => store.pending.has(e === 'final' ? keyFinal : `plan:${mes}:${e}`)
  /** Operación de esta etapa en curso: la lanzada desde un módulo hijo (aunque el asistente se haya cerrado y reabierto) o la del propio asistente. */
  const claveBg: Record<Etapa, string> = { fuentes: `pf:aplicar:fuente:${mes}:aplicar`, subcajas: `pf:aplicar:subcaja:${mes}:aplicar`, gastos: 'lote:' }
  const enCurso = (e: Etapa) => !!bg[e] || [...store.pending].some(k => k.startsWith(claveBg[e]))
  const hayBg = ETAPAS.some(e => enCurso(e))
  const real = useMemo(() => resumenReal(data, mes), [data, mes])
  const monedaBase = data.config.moneda || 'PEN'

  /** Estado visual de una etapa: sale de lo guardado (CONFIG + datos releídos), no de que se haya pulsado un botón. */
  const visual = (e: Etapa): EstadoVisual => {
    if (fallo[e]) return 'error'
    const pend = e === 'fuentes' ? itF.length : e === 'subcajas' ? itS.length : 0
    if (ocupado(e) || enCurso(e) || pend > 0) return 'en_progreso'
    return plan.etapas[e] === 1 ? 'completada' : plan.etapas[e] === 2 ? 'omitida' : 'pendiente'
  }
  const siguientePaso = (desde: number): number => {
    for (let i = desde + 1; i < 3; i++) { const v = visual(ETAPAS[i]); if (v !== 'omitida' && v !== 'completada') return i }
    return 3
  }
  const bloqueado = etapa === 'fuentes' ? invalidoF : etapa === 'subcajas' ? invalidoS : false

  /** Guarda el estado de UNA etapa en CONFIG (solo configuración del asistente: no toca dinero ni gastos). */
  const persistir = (e: Etapa, valor: EstadoEtapa, textos: { pending: string; ok: string }, despues?: () => void, silencioso = false) => {
    const ejecutar = () => store.track(`plan:${mes}:${e}`, { pending: textos.pending, ok: textos.ok, error: 'No se pudo guardar el avance de la planificación.' },
      () => {
        const et = etapasConLocal(e, valor)
        return store.actions.saveConfig(`plan_est_${mes}`, serializarEstadoPlan({ mes, etapas: et, estado: estadoDesdeEtapas(et), posponerHasta: '' }))
      }, { retry: false, silencioso, onDone: (ok, err) => {
        if (!ok) sinLocal(e)
        setFallo(f => { const x = { ...f }; if (ok) delete x[e]; else x[e] = { msg: err ?? 'No se pudo guardar el avance.', reintentar: ejecutar }; return x })
        if (ok) despues?.()
      } })
    ejecutar()
  }

  /** Vuelve del módulo hijo: el hijo ya verificó contra Sheets; aquí se guarda la etapa como completada. */
  const confirmarEtapa = (e: Etapa) => {
    // Nunca toca la navegación (ni `hijo` ni `paso`): el usuario puede estar ya en otra etapa o con otro módulo abierto.
    // El aviso verde de éxito lo da la propia operación; este guardado del avance es silencioso (solo avisa si falla).
    persistir(e, 1, { pending: '', ok: '' }, undefined, true)
  }
  const finBg = (e: Etapa) => setBg(b => { const x = { ...b }; delete x[e]; return x })
  const ctxPara = (e: Etapa): ContextoPlan => ({
    mes, onCerrar: () => setHijo(null),
    onAplicado: () => { finBg(e); confirmarEtapa(e) },
    // Segundo plano: el módulo se cierra y el asistente sigue visible; la etapa queda «En progreso» hasta que Sheets confirme.
    onIniciado: () => { setFallo(f => { const x = { ...f }; delete x[e]; return x }); setBg(b => ({ ...b, [e]: true })); setHijo(null) },
    onFallo: (msg, reintentar) => {
      finBg(e)
      setFallo(f => ({ ...f, [e]: { msg, reintentar: () => { setFallo(g => { const x = { ...g }; delete x[e]; return x }); if (reintentar) { setBg(b => ({ ...b, [e]: true })); reintentar() } else abrirHijo(e) } } }))
    },
  })
  const abrirHijo = (e: Etapa) => {
    setHijo(e)
    if (e === 'gastos') o.onGastosMensuales(ctxPara(e)); else o.onPlantillas(e === 'fuentes' ? 'fuente' : 'subcaja', ctxPara(e))
  }

  /** Aplica las selecciones hechas dentro del asistente (si las hay), las verifica y marca la etapa. */
  const aplicarSeleccion = (e: 'fuentes' | 'subcajas') => {
    const tipo: TipoEntidad = e === 'fuentes' ? 'fuente' : 'subcaja', items = e === 'fuentes' ? itF : itS
    if (!items.length) return
    const ejecutar = () => store.track(`plan:${mes}:${e}`, { pending: `Aplicando ${e === 'fuentes' ? 'fuentes' : 'cajas'} a ${nombreMes(mes)}…`, ok: `${ETAPA_OK[e]} en ${nombreMes(mes)}.`, error: `No se pudieron aplicar las ${e}.` },
      async () => {
        const fresco = await store.actions.aplicarEntidadesMes(tipo, mes, items)
        const problemas = verificarEntidadesAplicadas({ ...data, ...fresco }, tipo, mes, items)
        if (problemas.length) throw new Error(`No se pudo verificar lo guardado en Google Sheets. ${problemas.join(' ')}`)
        const et = etapasConLocal(e, 1)
        await store.actions.saveConfig(`plan_est_${mes}`, serializarEstadoPlan({ mes, etapas: et, estado: estadoDesdeEtapas(et), posponerHasta: '' }))
      }, { retry: false, onDone: (ok, err) => setFallo(f => { const x = { ...f }; if (ok) delete x[e]; else x[e] = { msg: err ?? 'No se pudo confirmar la operación.', reintentar: ejecutar }; return x }) })
    ejecutar()
  }

  const omitir = () => {
    if (!etapa) return
    const e = etapa, destino = siguientePaso(paso)
    persistir(e, 2, { pending: 'Guardando…', ok: `${ETAPA_TXT[e].titulo} omitidas en ${nombreMes(mes)}.`.replace('Gastos omitidas', 'Gastos omitidos') })
    setPaso(destino)
  }
  const retomar = (e: Etapa) => persistir(e, 0, { pending: 'Guardando…', ok: `${ETAPA_TXT[e].titulo} vuelve a estar pendiente.` })

  /** Finalizar: aplica lo que haya quedado seleccionado en el asistente (verificado) y guarda el estado del mes. No crea nada más. */
  const finalizar = () => {
    if (invalidoF || invalidoS) return
    const ejecutar = () => store.track(keyFinal, { pending: `Finalizando la planificación de ${nombreMes(mes)}…`, ok: 'Planificación guardada.', error: 'No se pudo guardar la planificación. No se marcó como guardada; puedes reintentar.' },
      async () => {
        let d = data
        const et = etapasConLocal()
        if (itF.length) { const fr = await store.actions.aplicarEntidadesMes('fuente', mes, itF); d = { ...d, ...fr }; const p = verificarEntidadesAplicadas(d, 'fuente', mes, itF); if (p.length) throw new Error(`No se pudo verificar lo guardado en Google Sheets. ${p.join(' ')}`); et.fuentes = 1 }
        if (itS.length) { const fr = await store.actions.aplicarEntidadesMes('subcaja', mes, itS); d = { ...d, ...fr }; const p = verificarEntidadesAplicadas(d, 'subcaja', mes, itS); if (p.length) throw new Error(`No se pudo verificar lo guardado en Google Sheets. ${p.join(' ')}`); et.subcajas = 1 }
        await store.actions.saveConfig(`plan_est_${mes}`, serializarEstadoPlan({ mes, etapas: et, estado: estadoDesdeEtapas(et), posponerHasta: '' }))
      })   // sin onDone: al terminar solo se actualiza el estado y se avisa; el asistente ya está cerrado y no se reabre
    ejecutar()
    onClose()   // la navegación causada por el clic del usuario es inmediata; el guardado sigue en segundo plano
  }

  if (hijo) return null   // el módulo hijo está abierto: el asistente conserva su estado pero no se dibuja

  const sigTxt = (e: Etapa) => { const i = siguientePaso(ETAPAS.indexOf(e)); return i === 3 ? { label: 'Continuar con el Resumen', sig: 'Resumen de la planificación', i } : { label: `Continuar con ${ETAPA_TXT[ETAPAS[i]].titulo}`, sig: ETAPA_SIG[ETAPAS[i]], i } }
  const nCompletadas = ETAPAS.filter(e => plan.etapas[e] === 1).length, nOmitidas = ETAPAS.filter(e => plan.etapas[e] === 2).length
  const finalizada = plan.estado === 'completada'
  const totalesTxt = (t: Record<string, number>) => { const k = Object.keys(t); return k.length ? k.map(m => money(t[m], m)).join(' + ') : '—' }
  const libre = (() => { const k = Object.keys(real.fuentes.totales); return k.length <= 1 && (k[0] ?? monedaBase) === monedaBase ? money((real.fuentes.totales[monedaBase] ?? 0) - real.subcajas.reservado, monedaBase) : '—' })()

  const Guardando = ({ e }: { e: Etapa }) => enCurso(e) ? (
    <div className="flex items-center gap-2 rounded-xl border border-navy/30 bg-primary-soft px-3 py-2 text-xs font-medium text-navy" role="status" data-testid={`bg-${e}`}>
      <Loader2 className="size-3.5 animate-spin" /> Guardando {e === 'fuentes' ? 'las fuentes' : e === 'subcajas' ? 'las cajas' : 'los gastos'} en segundo plano… Puedes seguir navegando; esta pasará a «Completada» cuando Google Sheets lo confirme.
    </div>
  ) : null
  const Aviso = ({ e }: { e: Etapa | 'final' }) => fallo[e] ? (
    <div className="space-y-2" data-testid={`error-${e}`}>
      <ErrorBox message={fallo[e]!.msg} onRetry={fallo[e]!.reintentar} />
      <p className="text-[11px] text-muted">Tu selección y tu avance se conservan. No se marcó nada como completado.</p>
    </div>
  ) : null

  const Continuar = ({ e }: { e: Etapa }) => {
    if (plan.etapas[e] !== 1 || visual(e) !== 'completada') return null
    const s = sigTxt(e)
    const n = e === 'fuentes' ? real.fuentes.n : e === 'subcajas' ? real.subcajas.n : real.gastos.n
    const unidad = e === 'fuentes' ? `${n} fuente${n === 1 ? '' : 's'}` : e === 'subcajas' ? `${n} caja${n === 1 ? '' : 's'}` : `${n} gasto${n === 1 ? '' : 's'}`
    return (
      <div className="rounded-2xl border border-success/30 bg-success-soft p-3" data-testid={`ok-${e}`}>
        <p className="flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="size-4" /> {ETAPA_OK[e]}</p>
        <p className="mt-0.5 text-xs text-ink">{e === 'gastos' ? `${unidad} en ${nombreMes(mes)} (según los movimientos confirmados).` : `${unidad} aplicada${n === 1 ? '' : 's'} al período ${nombreMes(mes)}.`}</p>
        <p className="mt-2 text-[11px] text-muted">Siguiente etapa: <b className="text-ink">{s.sig}</b></p>
        <div className="mt-2"><Button className="h-9 text-xs" onClick={() => setPaso(s.i)} data-testid={`continuar-${e}`}>{s.label} <ArrowRight className="size-3.5" /></Button></div>
      </div>
    )
  }

  return (
    <Modal open onClose={onClose} size="lg" title={`Prepara tu mes · ${nombreMes(mes)}`} subtitle="Fuentes, cajas y gastos de este mes. Cada etapa se guarda cuando la confirmas." icon={<CalendarCheck2 className="size-5" />}
      footer={<>
        <Button variant="outline" onClick={() => setPaso(p => Math.max(0, p - 1))} disabled={paso === 0}><ChevronLeft className="size-4" /> Anterior</Button>
        {etapa && (plan.etapas[etapa] === 2
          ? <Button variant="ghost" onClick={() => retomar(etapa)} disabled={ocupado(etapa)}><RotateCcw className="size-4" /> Retomar etapa</Button>
          : <Button variant="ghost" onClick={omitir} disabled={ocupado(etapa)}><SkipForward className="size-4" /> Omitir</Button>)}
        {etapa ? <Button onClick={() => setPaso(siguientePaso(paso))} disabled={bloqueado}>{siguientePaso(paso) === 3 ? 'Revisar resumen' : 'Siguiente'} <ChevronRight className="size-4" /></Button>
          : <Button onClick={finalizar} disabled={ocupado('final') || hayBg || invalidoF || invalidoS} title={hayBg ? 'Espera a que termine el guardado en curso' : undefined}>{ocupado('final') && <Loader2 className="size-4 animate-spin" />} Finalizar planificación</Button>}
      </>}>
      <div className="space-y-4" data-testid="asistente-plan">
        <ol className="grid grid-cols-4 gap-1.5" aria-label="Etapas">
          {ETAPAS.map((e, i) => { const T = ETAPA_TXT[e], v = visual(e), V = VISUAL[v]; return (
            <li key={e}><button type="button" onClick={() => setPaso(i)} aria-current={paso === i ? 'step' : undefined} data-testid={`etapa-${e}`} data-estado={v}
              className={`flex h-full w-full flex-col items-center gap-0.5 rounded-xl border px-1.5 py-2 text-center text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-navy/60 ${V.cls} ${paso === i ? 'ring-2 ring-navy/40' : ''}`}>
              {v === 'completada' ? <CheckCircle2 className="size-4" /> : v === 'error' ? <AlertTriangle className="size-4" /> : v === 'omitida' ? <Ban className="size-4" /> : <T.icon className="size-4" />}
              {T.titulo}<span className="text-[10px] font-normal" data-testid={`etapa-${e}-estado`}>{V.txt}</span></button></li>) })}
          <li><button type="button" onClick={() => setPaso(3)} aria-current={paso === 3 ? 'step' : undefined} data-testid="etapa-resumen" data-estado={finalizada ? 'completada' : 'pendiente'}
            className={`flex h-full w-full flex-col items-center gap-0.5 rounded-xl border px-1.5 py-2 text-center text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-navy/60 ${finalizada ? VISUAL.completada.cls : VISUAL.pendiente.cls} ${paso === 3 ? 'ring-2 ring-navy/40' : ''}`}>
            <CheckCircle2 className="size-4" />Resumen<span className="text-[10px] font-normal">{finalizada ? 'Finalizada' : 'Por finalizar'}</span></button></li>
        </ol>
        {antesCorte && <ErrorBox tone="warning" message={`${nombreMes(mes)} es anterior al aislamiento mensual (${nombreMes(aisl)}): conserva su comportamiento histórico y no necesita preparación.`} />}

        {etapa === 'fuentes' && (
          <div className="space-y-2.5">
            <Continuar e="fuentes" />
            <Guardando e="fuentes" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">¿Qué fuentes de dinero tendrás en {nombreMes(mes)}?</p>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" className="h-8 text-xs" onClick={() => setSelF(s => ({ ...s, ...Object.fromEntries(cf.filter(c => !c.aplicada && c.previo !== null).map(c => [c.id, { on: true, monto: String(c.previo) }])) }))}><Copy className="size-3.5" /> Usar mes anterior</Button>
                <Button variant="outline" className="h-8 text-xs" onClick={() => abrirHijo('fuentes')}><FileClock className="size-3.5" /> Plantillas mensuales</Button>
              </div>
            </div>
            <ListaSel cands={cf} sel={selF} setSel={setSelF} tipo="fuente" />
            <Aviso e="fuentes" />
            {itF.length > 0 && <Button className="h-9 text-xs" disabled={invalidoF || ocupado('fuentes')} onClick={() => aplicarSeleccion('fuentes')} data-testid="aplicar-fuentes">{ocupado('fuentes') && <Loader2 className="size-3.5 animate-spin" />} Aplicar {itF.length} fuente{itF.length === 1 ? '' : 's'} a {nombreMes(mes)}</Button>}
          </div>
        )}
        {etapa === 'subcajas' && (
          <div className="space-y-2.5">
            <Continuar e="subcajas" />
            <Guardando e="subcajas" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">¿Cuánto reservas en cada caja en {nombreMes(mes)}?</p>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" className="h-8 text-xs" onClick={() => setSelS(s => ({ ...s, ...Object.fromEntries(cs.filter(c => !c.aplicada && c.previo !== null).map(c => [c.id, { on: true, monto: String(c.previo) }])) }))}><Copy className="size-3.5" /> Usar mes anterior</Button>
                <Button variant="outline" className="h-8 text-xs" onClick={() => abrirHijo('subcajas')}><FileClock className="size-3.5" /> Plantillas mensuales</Button>
              </div>
            </div>
            <ListaSel cands={cs} sel={selS} setSel={setSelS} tipo="subcaja" />
            <Aviso e="subcajas" />
            {itS.length > 0 && <Button className="h-9 text-xs" disabled={invalidoS || ocupado('subcajas')} onClick={() => aplicarSeleccion('subcajas')} data-testid="aplicar-subcajas">{ocupado('subcajas') && <Loader2 className="size-3.5 animate-spin" />} Aplicar {itS.length} subcaja{itS.length === 1 ? '' : 's'} a {nombreMes(mes)}</Button>}
          </div>
        )}
        {etapa === 'gastos' && (
          <div className="space-y-3">
            <Continuar e="gastos" />
            <Guardando e="gastos" />
            <p className="text-sm font-semibold text-ink">Gastos de {nombreMes(mes)}</p>
            <p className="text-xs text-muted">Avanzar aquí <b>no registra ningún gasto</b>. Los compromisos mensuales se registran desde “Gastos mensuales”, donde ves cada uno antes de confirmar.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-9 text-xs" onClick={() => abrirHijo('gastos')}><ClipboardList className="size-3.5" /> Abrir gastos mensuales</Button>
            </div>
            <Aviso e="gastos" />
            <label className="flex items-center gap-2 rounded-xl border border-line p-3 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--navy)]" checked={plan.etapas.gastos === 1} disabled={ocupado('gastos')}
                onChange={e => persistir('gastos', e.target.checked ? 1 : 0, { pending: 'Guardando…', ok: e.target.checked ? `Gastos de ${nombreMes(mes)} marcados como revisados.` : 'Gastos vuelve a estar pendiente.' })} />
              Ya revisé mis gastos mensuales de {nombreMes(mes)}
            </label>
          </div>
        )}
        {paso === 3 && (
          <div className="space-y-3" data-testid="plan-resumen-final">
            <p className="text-sm font-semibold text-ink">Planificación de {nombreMes(mes)}</p>
            <ul className="space-y-1.5 text-sm">
              {ETAPAS.map(e => { const v = visual(e), n = e === 'fuentes' ? real.fuentes.n : e === 'subcajas' ? real.subcajas.n : real.gastos.n
                const detalle = v === 'omitida' ? 'Omitida (no se ejecutó)' : e === 'fuentes' ? `${n} configurada${n === 1 ? '' : 's'} · Total ${totalesTxt(real.fuentes.totales)}`
                  : e === 'subcajas' ? `${n} configurada${n === 1 ? '' : 's'} · Total reservado ${money(real.subcajas.reservado, monedaBase)}` : `${n} registrado${n === 1 ? '' : 's'} · Total ${totalesTxt(real.gastos.totales)}`
                return (
                  <li key={e} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-bg px-3 py-2" data-testid={`resumen-${e}`}>
                    <span className="font-medium">{ETAPA_TXT[e].titulo} <span className="ml-1 text-[11px] font-semibold text-muted">· {VISUAL[v].txt}</span></span>
                    <span className="flex items-center gap-2"><span className="text-xs text-muted">{detalle}</span>
                      <button type="button" className="text-xs font-semibold text-navy underline" onClick={() => setPaso(ETAPAS.indexOf(e))}>Revisar {ETAPA_TXT[e].titulo}</button></span>
                  </li>) })}
            </ul>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border border-line p-3 text-xs sm:grid-cols-3" data-testid="plan-indicadores">
              <div><dt className="text-muted">Presupuesto consolidado</dt><dd className="font-semibold text-ink">{totalesTxt(real.fuentes.totales)}</dd></div>
              <div><dt className="text-muted">Total reservado</dt><dd className="font-semibold text-ink">{money(real.subcajas.reservado, monedaBase)}</dd></div>
              <div><dt className="text-muted">Presupuesto libre</dt><dd className="font-semibold text-ink">{libre}</dd></div>
              <div><dt className="text-muted">Gastos registrados</dt><dd className="font-semibold text-ink">{real.gastos.n}</dd></div>
              <div><dt className="text-muted">Etapas completadas</dt><dd className="font-semibold text-ink">{nCompletadas}</dd></div>
              <div><dt className="text-muted">Etapas omitidas</dt><dd className="font-semibold text-ink">{nOmitidas}</dd></div>
            </dl>
            <Aviso e="final" />
            <p className="text-[11px] text-muted">Estado: <b>{ESTADO_TXT[plan.estado]}</b>{itF.length + itS.length > 0 ? ` · Al finalizar se aplicarán ${itF.length} fuente(s) y ${itS.length} caja(s) que elegiste.` : ''}. Finalizar solo guarda el estado: no vuelve a crear fuentes, reservas ni gastos. Las etapas pendientes se pueden retomar desde la campana.</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ============================== Vacíos por mes ============================== */

/** Estado vacío de un mes sin fuentes/subcajas aplicadas, con las tres acciones de la planificación. */
export function VacioMes({ tipo, mes, nOcultas, onConfigurar, onPlantillas, onAnterior }: { tipo: TipoEntidad; mes: string; nOcultas: number; onConfigurar: () => void; onPlantillas: () => void; onAnterior: () => void }) {
  const noun = tipo === 'fuente' ? 'fuentes' : 'cajas'
  return (
    <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center" data-testid={`vacio-mes-${tipo}`}>
      <p className="text-sm font-semibold text-ink">No tienes {noun} configuradas para {nombreMes(mes).split(' ')[0].toLowerCase()}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted">Cada mes tiene sus propias {noun}: nada se arrastra solo del mes anterior. {nOcultas > 0 ? `Tienes ${nOcultas} ${noun} creadas que aún no se aplicaron a ${nombreMes(mes)}.` : ''} Tus gastos de {nombreMes(mes)} se conservan.</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Button className="h-9 text-xs" onClick={onConfigurar}>Configurar {noun} del mes</Button>
        <Button variant="outline" className="h-9 text-xs" onClick={onPlantillas}>Usar plantillas mensuales</Button>
        <Button variant="outline" className="h-9 text-xs" onClick={onAnterior}><Copy className="size-3.5" /> Copiar configuración del mes anterior</Button>
      </div>
    </div>
  )
}

/** Franja compacta (Cajas): estado del mes y acceso directo al asistente. */
export function BarraPlan({ store, hoy, mes, plan }: { store: AppStore; hoy: string; mes: string; plan: PlanificacionApi }) {
  const data = store.data
  if (!data || mes < aislaDesde(data.config)) return null
  const r = resumenMes(data, mes), p = leerEstadoPlan(data.config, mes)
  const posp = !!p.posponerHasta && hoy < p.posponerHasta
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-card px-4 py-2.5" data-testid="barra-plan">
      <CalendarCheck2 className="size-4 shrink-0 text-navy" />
      <p className="min-w-0 flex-1 text-xs text-muted"><span className="font-semibold text-ink">Planificación de {nombreMes(mes)}</span> · {r.fuentes} fuente{r.fuentes === 1 ? '' : 's'} · {r.subcajas} caja{r.subcajas === 1 ? '' : 's'}</p>
      {store.pending.has(`plan:${mes}`)
        ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-navy" data-testid="plan-guardando"><Loader2 className="size-3.5 animate-spin" /> Guardando planificación…</span>
        : <Insignia estado={p.estado} posp={posp && p.estado !== 'completada'} />}
      <Button variant="outline" className="h-8 text-xs" onClick={() => plan.abrir(mes)}>{p.estado === 'pendiente' ? 'Preparar mes' : 'Ver planificación'}</Button>
    </div>
  )
}
