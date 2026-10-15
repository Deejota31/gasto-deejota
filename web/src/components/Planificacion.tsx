import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bell, CalendarCheck2, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardList, Copy, FileClock, Settings2, SkipForward, Wallet } from 'lucide-react'
import { ETAPAS, estadoDesdeEtapas, leerEstadoPlan, mesAnterior, nombreMes, proximasFechas, serializarEstadoPlan, type Etapa, type EstadoEtapa, type EstadoPlan, type PlanMes } from '../lib/plan'
import { candidatos, recordatoriosVigentes, resumenMes, type Candidato, type TipoEntidad } from '../lib/planificar'
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
  fuentes: { titulo: 'Fuentes', icon: CircleDollarSign }, subcajas: { titulo: 'Subcajas', icon: Wallet }, gastos: { titulo: 'Gastos', icon: ClipboardList },
}
export const ESTADO_TXT: Record<EstadoPlan, string> = { pendiente: 'Pendiente', en_progreso: 'En progreso', completada: 'Completada', descartada: 'Descartada' }
const ESTADO_TONO: Record<EstadoPlan, string> = {
  pendiente: 'bg-warning-soft text-warning', en_progreso: 'bg-primary-soft text-navy', completada: 'bg-success-soft text-success', descartada: 'bg-bg text-muted',
}
const ETAPA_ESTADO = ['Pendiente', 'Hecha', 'Omitida']
const MONTO_RE = /^\d{1,9}([.,]\d{1,2})?$/

export const Insignia = ({ estado, posp }: { estado: EstadoPlan; posp?: boolean }) => (
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${posp ? 'bg-bg text-muted' : ESTADO_TONO[estado]}`}>{posp ? 'Pospuesta' : ESTADO_TXT[estado]}</span>
)

function mananaDe(hoy: string): string {
  const d = new Date(`${hoy}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10)
}

export interface PlanificacionOpts { hoy: string; onGastosMensuales: () => void; onPlantillas: (t: TipoEntidad) => void; onConfigurar: () => void }

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
        <Modal open onClose={() => setRes(null)} size="md" title="Planificación mensual" subtitle="Cada mes tiene sus propias fuentes, subcajas y gastos." icon={<CalendarCheck2 className="size-5" />}
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
                  <p className="mt-0.5 text-[11px] text-muted">Aviso del {formatDate(r.fecha, data.config.formato_fecha)}. Elige las fuentes, subcajas y gastos de este mes.</p>
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
  const fila = (k: string, v: ReactNode) => <div className="flex items-baseline justify-between gap-3 text-xs"><dt className="text-muted">{k}</dt><dd className="min-w-0 text-right font-medium text-ink">{v}</dd></div>
  return (
    <section aria-label="Planificación mensual" data-testid="resumen-plan" className={compacto ? 'rounded-2xl border border-line bg-card p-3' : ''}>
      <dl className="space-y-1.5">
        {fila('Mes actual', nombreMes(mes))}
        {fila('Estado', <Insignia estado={plan.estado} posp={posp && plan.estado !== 'completada'} />)}
        {fila('Fuentes configuradas', aplica ? `${r.fuentes} de ${r.fuentesTotal}` : 'Mes anterior al aislamiento (todas)')}
        {fila('Subcajas configuradas', aplica ? `${r.subcajas} de ${r.cajasTotal}` : 'Mes anterior al aislamiento (todas)')}
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
  if (!cands.length) return <p className="rounded-xl bg-bg px-3 py-4 text-sm text-muted">{tipo === 'fuente' ? 'Aún no tienes fuentes mensuales. Créalas desde Cajas → Nueva fuente.' : 'Aún no tienes subcajas activas. Créalas desde Cajas → Nueva subcaja.'}</p>
  return (
    <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line" aria-label={tipo === 'fuente' ? 'Fuentes del mes' : 'Subcajas del mes'}>
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
  const noun = tipo === 'fuente' ? 'fuentes' : 'subcajas'
  const aplicar = () => {
    if (!items.length || invalido) return
    const ok = store.track(`plan-ant:${tipo}:${mes}`, { pending: `Aplicando ${noun} a ${nombreMes(mes)}…`, ok: `${items.length} ${items.length === 1 ? (tipo === 'fuente' ? 'fuente aplicada' : 'subcaja aplicada') : `${noun} aplicadas`} a ${nombreMes(mes)}.`, error: `No se pudieron aplicar las ${noun}.` },
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

type Decision = 'pendiente' | 'hacer' | 'omitir'
function Asistente({ store, mes, etapaInicial, o, onClose }: { store: AppStore; mes: string; etapaInicial: Etapa | null; o: PlanificacionOpts; onClose: () => void }) {
  const data = store.data!
  const plan = useMemo(() => leerEstadoPlan(data.config, mes), [data.config, mes])
  const cf = useMemo(() => candidatos(data, 'fuente', mes), [data, mes])
  const cs = useMemo(() => candidatos(data, 'subcaja', mes), [data, mes])
  const primera = etapaInicial ?? ETAPAS.find(e => plan.etapas[e] === 0) ?? 'fuentes'
  const [paso, setPaso] = useState<number>(ETAPAS.indexOf(primera))   // 0..2 etapas · 3 resumen
  const [selF, setSelF] = useState(() => aSel(cf))
  const [selS, setSelS] = useState(() => aSel(cs))
  const [dec, setDec] = useState<Record<Etapa, Decision>>({ fuentes: 'pendiente', subcajas: 'pendiente', gastos: 'pendiente' })
  const [gastosOk, setGastosOk] = useState(false)
  const etapa = ETAPAS[paso] as Etapa | undefined
  const aisl = aislaDesde(data.config), antesCorte = mes < aisl
  const itF = itemsAAplicar(cf, selF), itS = itemsAAplicar(cs, selS)
  const invalidoF = cf.some(c => selF[c.id]?.on && !MONTO_RE.test(selF[c.id].monto.trim()))
  const invalidoS = cs.some(c => selS[c.id]?.on && !MONTO_RE.test(selS[c.id].monto.trim()))
  const marca = (e: Etapa, d: Decision) => setDec(x => ({ ...x, [e]: d }))
  const siguiente = () => { if (etapa) marca(etapa, 'hacer'); setPaso(p => Math.min(3, p + 1)) }
  const omitir = () => { if (etapa) marca(etapa, 'omitir'); setPaso(p => Math.min(3, p + 1)) }
  const bloqueado = etapa === 'fuentes' ? invalidoF : etapa === 'subcajas' ? invalidoS : false

  const estadoFinal = (e: Etapa): EstadoEtapa => {
    if (dec[e] === 'hacer') return e === 'gastos' ? (gastosOk ? 1 : plan.etapas.gastos === 1 ? 1 : 0) : 1
    if (dec[e] === 'omitir') return 2
    return plan.etapas[e]
  }
  const etapasFinal = Object.fromEntries(ETAPAS.map(e => [e, estadoFinal(e)])) as Record<Etapa, EstadoEtapa>
  const key = `plan:${mes}`
  const aplicar = () => {
    if (invalidoF || invalidoS) return
    const ok = store.track(key, { pending: `Aplicando la planificación de ${nombreMes(mes)}…`, ok: `Planificación de ${nombreMes(mes)} aplicada.`, error: 'No se pudo aplicar la planificación. No se guardó el estado; puedes reintentar.' },
      async () => {
        if (dec.fuentes === 'hacer' && itF.length) await store.actions.aplicarEntidadesMes('fuente', mes, itF)
        if (dec.subcajas === 'hacer' && itS.length) await store.actions.aplicarEntidadesMes('subcaja', mes, itS)
        const nuevo: PlanMes = { mes, etapas: etapasFinal, estado: estadoDesdeEtapas(etapasFinal), posponerHasta: '' }
        await store.actions.saveConfig(`plan_est_${mes}`, serializarEstadoPlan(nuevo))
      })
    if (ok) onClose()
  }
  const ocupado = store.pending.has(key)
  const nombresDec = (e: Etapa) => dec[e] === 'hacer' ? (e === 'gastos' && !gastosOk ? 'Sin confirmar' : 'Se aplicará') : dec[e] === 'omitir' ? 'Omitida' : ETAPA_ESTADO[plan.etapas[e]]

  return (
    <Modal open onClose={onClose} size="lg" title={`Prepara tu mes · ${nombreMes(mes)}`} subtitle="Fuentes, subcajas y gastos de este mes. Nada se guarda hasta que apliques la planificación." icon={<CalendarCheck2 className="size-5" />}
      footer={<>
        <Button variant="outline" onClick={() => setPaso(p => Math.max(0, p - 1))} disabled={paso === 0}><ChevronLeft className="size-4" /> Anterior</Button>
        {etapa && <Button variant="ghost" onClick={omitir}><SkipForward className="size-4" /> Omitir</Button>}
        {etapa ? <Button onClick={siguiente} disabled={bloqueado}>{paso === 2 ? 'Revisar resumen' : 'Siguiente'} <ChevronRight className="size-4" /></Button>
          : <Button onClick={aplicar} disabled={ocupado || invalidoF || invalidoS}>Aplicar planificación</Button>}
      </>}>
      <div className="space-y-4" data-testid="asistente-plan">
        <ol className="grid grid-cols-4 gap-1.5" aria-label="Etapas">
          {ETAPAS.map((e, i) => { const T = ETAPA_TXT[e]; return (
            <li key={e}><button type="button" onClick={() => setPaso(i)} aria-current={paso === i ? 'step' : undefined} data-testid={`etapa-${e}`}
              className={`flex h-full w-full flex-col items-center gap-0.5 rounded-xl border px-1.5 py-2 text-center text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-navy/60 ${paso === i ? 'border-navy bg-primary-soft text-navy' : 'border-line text-muted hover:bg-bg'}`}>
              <T.icon className="size-4" />{T.titulo}<span className="text-[10px] font-normal">{nombresDec(e)}</span></button></li>) })}
          <li><button type="button" onClick={() => setPaso(3)} aria-current={paso === 3 ? 'step' : undefined} data-testid="etapa-resumen"
            className={`flex h-full w-full flex-col items-center gap-0.5 rounded-xl border px-1.5 py-2 text-center text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-navy/60 ${paso === 3 ? 'border-navy bg-primary-soft text-navy' : 'border-line text-muted hover:bg-bg'}`}>
            <CheckCircle2 className="size-4" />Resumen<span className="text-[10px] font-normal">Aplicar</span></button></li>
        </ol>
        {antesCorte && <ErrorBox tone="warning" message={`${nombreMes(mes)} es anterior al aislamiento mensual (${nombreMes(aisl)}): conserva su comportamiento histórico y no necesita preparación.`} />}

        {etapa === 'fuentes' && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">¿Qué fuentes de dinero tendrás en {nombreMes(mes)}?</p>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" className="h-8 text-xs" onClick={() => setSelF(s => ({ ...s, ...Object.fromEntries(cf.filter(c => !c.aplicada && c.previo !== null).map(c => [c.id, { on: true, monto: String(c.previo) }])) }))}><Copy className="size-3.5" /> Usar mes anterior</Button>
                <Button variant="outline" className="h-8 text-xs" onClick={() => { onClose(); o.onPlantillas('fuente') }}><FileClock className="size-3.5" /> Plantillas mensuales</Button>
              </div>
            </div>
            <ListaSel cands={cf} sel={selF} setSel={setSelF} tipo="fuente" />
          </div>
        )}
        {etapa === 'subcajas' && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">¿Cuánto reservas en cada subcaja en {nombreMes(mes)}?</p>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" className="h-8 text-xs" onClick={() => setSelS(s => ({ ...s, ...Object.fromEntries(cs.filter(c => !c.aplicada && c.previo !== null).map(c => [c.id, { on: true, monto: String(c.previo) }])) }))}><Copy className="size-3.5" /> Usar mes anterior</Button>
                <Button variant="outline" className="h-8 text-xs" onClick={() => { onClose(); o.onPlantillas('subcaja') }}><FileClock className="size-3.5" /> Plantillas mensuales</Button>
              </div>
            </div>
            <ListaSel cands={cs} sel={selS} setSel={setSelS} tipo="subcaja" />
          </div>
        )}
        {etapa === 'gastos' && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-ink">Gastos de {nombreMes(mes)}</p>
            <p className="text-xs text-muted">Avanzar aquí <b>no registra ningún gasto</b>. Los compromisos mensuales se aplican desde “Gastos mensuales”, donde ves cada uno antes de confirmar.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-9 text-xs" onClick={() => { onClose(); o.onGastosMensuales() }}><ClipboardList className="size-3.5" /> Abrir gastos mensuales</Button>
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-line p-3 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--navy)]" checked={gastosOk} onChange={e => { setGastosOk(e.target.checked); marca('gastos', e.target.checked ? 'hacer' : 'pendiente') }} />
              Ya revisé mis gastos mensuales de {nombreMes(mes)}
            </label>
          </div>
        )}
        {paso === 3 && (
          <div className="space-y-2" data-testid="plan-resumen-final">
            <p className="text-sm font-semibold text-ink">Resumen de la planificación</p>
            <ul className="space-y-1.5 text-sm">
              <li className="flex justify-between gap-3 rounded-xl bg-bg px-3 py-2"><span>Fuentes</span><span className="font-medium">{dec.fuentes === 'hacer' ? `${itF.length} por aplicar` : dec.fuentes === 'omitir' ? 'Omitida' : ETAPA_ESTADO[plan.etapas.fuentes]}</span></li>
              <li className="flex justify-between gap-3 rounded-xl bg-bg px-3 py-2"><span>Subcajas</span><span className="font-medium">{dec.subcajas === 'hacer' ? `${itS.length} por aplicar` : dec.subcajas === 'omitir' ? 'Omitida' : ETAPA_ESTADO[plan.etapas.subcajas]}</span></li>
              <li className="flex justify-between gap-3 rounded-xl bg-bg px-3 py-2"><span>Gastos</span><span className="font-medium">{dec.gastos === 'hacer' && gastosOk ? 'Revisados' : dec.gastos === 'omitir' ? 'Omitida' : ETAPA_ESTADO[plan.etapas.gastos]}</span></li>
            </ul>
            <p className="text-[11px] text-muted">Estado resultante: <b>{ESTADO_TXT[estadoDesdeEtapas(etapasFinal)]}</b>. Las etapas pendientes se podrán retomar luego desde el aviso de la campana.</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ============================== Vacíos por mes ============================== */

/** Estado vacío de un mes sin fuentes/subcajas aplicadas, con las tres acciones de la planificación. */
export function VacioMes({ tipo, mes, nOcultas, onConfigurar, onPlantillas, onAnterior }: { tipo: TipoEntidad; mes: string; nOcultas: number; onConfigurar: () => void; onPlantillas: () => void; onAnterior: () => void }) {
  const noun = tipo === 'fuente' ? 'fuentes' : 'subcajas'
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
      <p className="min-w-0 flex-1 text-xs text-muted"><span className="font-semibold text-ink">Planificación de {nombreMes(mes)}</span> · {r.fuentes} fuente{r.fuentes === 1 ? '' : 's'} · {r.subcajas} subcaja{r.subcajas === 1 ? '' : 's'}</p>
      <Insignia estado={p.estado} posp={posp && p.estado !== 'completada'} />
      <Button variant="outline" className="h-8 text-xs" onClick={() => plan.abrir(mes)}>{p.estado === 'pendiente' ? 'Preparar mes' : 'Ver planificación'}</Button>
    </div>
  )
}
