import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Copy, ExternalLink,
  Info, Layers, Link2, Link2Off, Lightbulb, ListChecks, PiggyBank, Receipt, Repeat, Search, ShieldCheck, Tags, TrendingUp, Wallet,
} from 'lucide-react'
import type { Aggregates } from '../lib/engine'
import { formatDate, monthLabel, rangeLabel, singleMonth, shiftMonth } from '../lib/dates'
import { formatMoney, ratesFromConfig } from '../lib/money'
import {
  calcularCompromisos, calcularPresupuesto, compararPeriodos, evaluarCalidad, oportunidadesAhorro, periodosEquivalentes, periodosMeses,
  PESOS, PROBLEMA_TXT, REDUCCION_SIMULADA, type CalidadDatos, type CompromisoItem, type Compromisos, type Evolucion, type FilaEvolucion,
  type GrupoSimilar, type MiPresupuesto, type NivelComparacion, type NivelPresupuesto, type Oportunidad, type Rango,
} from '../lib/salud'
import type { AppStore } from '../lib/store'
import type { EstadoRevision, Filters, Gasto, Plantilla } from '../lib/types'
import { Button, Empty, InfoTooltip, inputCls, Modal, Segmented, SelectField } from './ui'

type Vista = 'calidad' | 'presupuesto' | 'evolucion' | 'compromisos'
let vistaSesion: Vista = 'presupuesto'

/**
 * Salud financiera: calidad de los datos, presupuesto con compromisos, evolución y compromisos mensuales.
 * Todo se calcula con los datos ya cargados (memoizado); la única lectura adicional son las plantillas,
 * una vez por sesión y solo si aún no estaban en memoria.
 */
export default function SaludFinanciera({ store, a, filters, today, onRevisarGasto, onGastosMensuales }: {
  store: AppStore; a: Aggregates; filters: Filters; today: string
  /** Abre el movimiento en la pestaña Gastos (con su formulario) y permite volver aquí. */
  onRevisarGasto: (g: Gasto) => void; onGastosMensuales: () => void
}) {
  const data = store.data!
  const base = data.config.moneda || 'PEN'
  const rates = useMemo(() => ratesFromConfig(data.config), [data.config])
  const fmt = data.config.formato_fecha
  const money = (c: number) => formatMoney(c, base)
  // La sección elegida se recuerda mientras la app esté abierta (al ir a Gastos y volver).
  const [vista, setVistaState] = useState<Vista>(vistaSesion)
  const setVista = (v: Vista) => { vistaSesion = v; setVistaState(v) }
  const [revisar, setRevisar] = useState(false)
  const { loadPlantillas } = store
  useEffect(() => { void loadPlantillas() }, [loadPlantillas])
  const plantillas = store.plantillas.items
  const vinculos = useMemo(() => new Map((data.vinculos ?? []).map(([g, p]) => [g.toLowerCase(), p])), [data.vinculos])
  const monedas = useMemo(() => (data.config.monedas || 'PEN,USD').split(',').map(s => s.trim()).filter(Boolean), [data.config.monedas])

  const calidad = useMemo(() => evaluarCalidad({ gastos: data.gastos, f: filters, catalogo: data.catalogo, medios: data.medios, monedas, revisiones: data.revisiones ?? [] }),
    [data.gastos, data.catalogo, data.medios, monedas, data.revisiones, filters])
  const comp = useMemo(() => calcularCompromisos({ gastos: data.gastos, plantillas, vinculos, desde: filters.desde, hasta: filters.hasta, base, rates }),
    [data.gastos, plantillas, vinculos, filters.desde, filters.hasta, base, rates])
  const pres = useMemo(() => calcularPresupuesto(a, comp), [a, comp])

  // Evolución: por defecto, el mes del filtro (o el actual) contra el mismo tramo del mes anterior.
  const mesBase = singleMonth(filters.desde, filters.hasta) ?? today.slice(0, 7)
  const [modo, setModo] = useState<'equivalente' | 'meses'>('equivalente')
  const [mesA, setMesA] = useState(mesBase)
  const [mesB, setMesB] = useState(shiftMonth(mesBase, -1))
  const [nivel, setNivel] = useState<NivelComparacion>('categoria')
  useEffect(() => { setMesA(mesBase); setMesB(shiftMonth(mesBase, -1)) }, [mesBase])
  const per = modo === 'equivalente' ? periodosEquivalentes(mesBase, today) : periodosMeses(mesA, mesB, today)
  const perKey = `${per.actual.desde}|${per.actual.hasta}|${per.anterior.desde}|${per.anterior.hasta}`
  const evo = useMemo(() => compararPeriodos({ gastos: data.gastos, f: filters, actual: per.actual, anterior: per.anterior, nivel, base, rates }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.gastos, filters, perKey, nivel, base, rates])
  const ahorro = useMemo(() => {
    const evoSub = nivel === 'subcategoria' ? evo : compararPeriodos({ gastos: data.gastos, f: filters, actual: per.actual, anterior: per.anterior, nivel: 'subcategoria', base, rates })
    return oportunidadesAhorro({ gastos: data.gastos, f: filters, rango: per.actual, evolucion: evoSub, base, rates })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.gastos, filters, perKey, evo, nivel, base, rates])
  const mesesConDatos = useMemo(() => {
    const s = new Set(data.gastos.filter(g => g.estado === 'Activo').map(g => g.fecha.slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m)))
    s.add(today.slice(0, 7))
    return [...s].sort().reverse()
  }, [data.gastos, today])

  const periodo = rangeLabel(filters)
  const calTone = calidad.indice === null ? TONO.neutro : calidad.indice >= 90 ? TONO.ok : calidad.indice >= 70 ? TONO.atencion : TONO.alerta
  const presTone = pres.presupuesto ? TONO[NIVEL[pres.nivel].tono] : TONO.neutro
  const compTone = !comp.n ? TONO.neutro : comp.pendiente > 0 ? TONO.atencion : TONO.ok
  const tiles: Tile[] = [
    {
      id: 'calidad', titulo: 'Calidad de datos', icon: ShieldCheck, tone: calTone,
      valor: calidad.indice === null ? '—' : <>{calidad.indice}<span className="text-sm font-semibold text-muted">/100</span></>,
      valorTxt: calidad.indice === null ? '—' : `${calidad.indice}/100`,
      sub: calidad.indice === null ? 'Sin movimientos en el período' : calidad.pendientes ? `${calidad.pendientes} alerta${calidad.pendientes === 1 ? '' : 's'} por revisar` : 'Todo en orden',
      barra: calidad.indice === null ? undefined : <Barra partes={[{ v: calidad.indice, color: calTone.fg }]} total={100} alto="h-1.5" />,
      cta: calidad.pendientes ? 'Ver alertas' : 'Ver detalle',
      vacio: calidad.indice === null,
      info: <>
        <p>Índice de 0 a 100 = 30 % integridad + 30 % clasificación + 20 % consistencia del catálogo + 20 % duplicados confirmados.</p>
        <p>Evalúa los movimientos activos del período y filtros elegidos. Las coincidencias sin revisar o marcadas como legítimas no restan puntos.</p>
      </>,
    },
    {
      id: 'presupuesto', titulo: 'Mi presupuesto', icon: PiggyBank, tone: presTone,
      valor: pres.presupuesto ? money(pres.disponibleTrasCompromisos) : 'Sin definir',
      valorTxt: pres.presupuesto ? money(pres.disponibleTrasCompromisos) : 'Sin definir',
      sub: pres.presupuesto ? <>Disponible tras compromisos · <b className="font-semibold" style={{ color: presTone.fg }}>usado {pctTxt(pres.pctUsado)}</b></> : 'Define el presupuesto en Ajustar caja',
      barra: pres.presupuesto ? <Barra partes={[{ v: pres.gastado, color: presTone.fg }, { v: pres.pendiente, color: TONO.atencion.fg, rayado: true }]} total={pres.presupuesto} alto="h-1.5" /> : undefined,
      cta: 'Ver presupuesto',
      vacio: !pres.presupuesto,
      info: <>
        <p>Disponible tras compromisos = presupuesto mensual − gastos registrados − compromisos pendientes.</p>
        <p>Es un indicador de presupuesto, no el saldo de tu cuenta: la app no conoce tus ingresos ni tu banco.</p>
      </>,
    },
    {
      id: 'evolucion', titulo: 'Evolución', icon: TrendingUp, tone: evo.hayHistorial ? TONO.info : TONO.neutro,
      valor: evo.hayHistorial ? <span className="flex items-center gap-2"><span className="text-[#C0362C]">{evo.aumentaron.length} ↑</span><span className="text-[#0F7A5F]">{evo.disminuyeron.length} ↓</span></span> : 'Sin historial aún',
      valorTxt: evo.hayHistorial ? `${evo.aumentaron.length} ↑ · ${evo.disminuyeron.length} ↓` : 'Sin historial aún',
      sub: evo.hayHistorial ? (evo.aumentaron[0] ? `Más subió: ${evo.aumentaron[0].nombre} (${variacionTxt(evo.aumentaron[0])})` : 'Nada subió frente al período anterior') : 'Sigue registrando: compararemos con el mes anterior',
      cta: evo.hayHistorial ? 'Ver comparación' : 'Ver período actual',
      vacio: !evo.hayHistorial,
      info: <>
        <p>Compara el período elegido con el anterior equivalente: si el mes no ha terminado, compara los mismos días (p. ej. del 1 al 9 contra del 1 al 9).</p>
        <p>Variación = (actual − anterior) ÷ anterior. Si el anterior es 0, se marca como nuevo (sin base de comparación).</p>
      </>,
    },
    {
      id: 'compromisos', titulo: 'Compromisos', icon: Repeat, tone: compTone,
      valor: comp.n ? money(comp.pendiente) : 'Sin compromisos',
      valorTxt: comp.n ? money(comp.pendiente) : 'Sin compromisos',
      sub: comp.n ? `Pendiente · ${comp.nCubiertos} de ${comp.n - comp.sinMonto} cubiertos` : 'Márcalos en tus plantillas para reservar cada mes',
      barra: comp.previsto ? <Barra partes={[{ v: comp.cubierto, color: TONO.ok.fg }]} total={comp.previsto} alto="h-1.5" /> : undefined,
      cta: comp.n ? 'Ver compromisos' : 'Cómo empezar',
      vacio: !comp.n,
      info: <>
        <p>Plantillas que marcaste como compromiso mensual. Cubierto = gastos activos vinculados a esa plantilla con fecha dentro del período (se suman pagos parciales).</p>
        <p>Pendiente = previsto − cubierto (nunca negativo). Un gasto con descripción parecida pero sin vínculo no cuenta como pago.</p>
      </>,
    },
  ]

  return (
    <section className="space-y-4" aria-label={`Salud financiera — ${periodo}`}>
      <div role="tablist" aria-label="Vistas de salud financiera" className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
        {tiles.map(t => <TileKpi key={t.id} t={t} on={vista === t.id} onClick={() => setVista(t.id)} />)}
      </div>

      <div id={`salud-${vista}`} role="tabpanel" aria-labelledby={`salud-tab-${vista}`} key={vista}
        className="fade-in rounded-2xl border border-line bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_8px_24px_rgb(15_23_42/0.05)] sm:p-5">
        {vista === 'calidad' && <PanelCalidad c={calidad} onRevisar={() => setRevisar(true)} />}
        {vista === 'presupuesto' && <PanelPresupuesto p={pres} comp={comp} money={money} />}
        {vista === 'evolucion' && (
          <PanelEvolucion evo={evo} ahorro={ahorro} money={money} fmt={fmt} per={per} modo={modo} setModo={setModo} nivel={nivel} setNivel={setNivel}
            mesA={mesA} mesB={mesB} setMesA={setMesA} setMesB={setMesB} meses={mesesConDatos} />
        )}
        {vista === 'compromisos' && (
          <PanelCompromisos store={store} comp={comp} money={money} fmt={fmt} filters={filters} vinculos={vinculos} loaded={store.plantillas.loaded}
            onRevisarGasto={onRevisarGasto} onGastosMensuales={onGastosMensuales} />
        )}
      </div>

      {revisar && <RevisionDatos store={store} c={calidad} fmt={fmt} onClose={() => setRevisar(false)} onRevisarGasto={onRevisarGasto} />}
    </section>
  )
}

/* ============================== Piezas visuales ============================== */

type Tono = { fg: string; bg: string; ring: string }
/** Color funcional: verde/teal sano, ámbar atención, rojo suave alerta, azul/morado información, gris neutro. */
const TONO = {
  ok: { fg: '#0F8A6B', bg: '#E7F7F2', ring: '#16A08540' },
  atencion: { fg: '#B7791F', bg: '#FFF6DB', ring: '#E0A10040' },
  cerca: { fg: '#C2410C', bg: '#FFEDE3', ring: '#C2410C33' },
  alerta: { fg: '#C0362C', bg: '#FDECEC', ring: '#E2556340' },
  info: { fg: '#6D5DD3', bg: '#F1EEFF', ring: '#8B7CF640' },
  neutro: { fg: '#64748B', bg: 'var(--bg)', ring: 'var(--line)' },
} satisfies Record<string, Tono>

const NIVEL: Record<NivelPresupuesto, { txt: string; ayuda: string; tono: keyof typeof TONO }> = {
  'sin-presupuesto': { txt: 'Sin presupuesto definido', ayuda: '', tono: 'neutro' },
  ok: { txt: 'Dentro del presupuesto', ayuda: 'Vas bien.', tono: 'ok' },
  atencion: { txt: 'Atención', ayuda: 'Ya usaste más del 70 %.', tono: 'atencion' },
  cerca: { txt: 'Cerca del límite', ayuda: 'Usaste el 90 % o más.', tono: 'cerca' },
  excedido: { txt: 'Presupuesto alcanzado', ayuda: 'Llegaste o pasaste el 100 %.', tono: 'alerta' },
}
const pctTxt = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es-PE', { maximumFractionDigits: 1 })}%`)

type Tile = {
  id: Vista; titulo: string; icon: typeof ShieldCheck; tone: Tono; valor: ReactNode; valorTxt: string; sub: ReactNode
  barra?: ReactNode; cta: string; vacio: boolean; info: ReactNode
}

function TileKpi({ t, on, onClick }: { t: Tile; on: boolean; onClick: () => void }) {
  const Icon = t.icon
  return (
    <div className="relative">
      <button type="button" role="tab" aria-selected={on} aria-controls={`salud-${t.id}`} id={`salud-tab-${t.id}`} onClick={onClick}
        className={`group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card p-4 pr-10 text-left transition duration-200 outline-none focus-visible:ring-2 focus-visible:ring-navy/40 ${on ? 'border-transparent shadow-[0_6px_20px_rgb(15_23_42/0.08)]' : 'border-line hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgb(15_23_42/0.06)]'}`}
        style={on ? { boxShadow: `0 0 0 2px ${t.tone.fg}55, 0 8px 22px rgb(15 23 42 / 0.08)` } : undefined}>
        <span className="absolute inset-x-0 top-0 h-1" style={{ background: on ? t.tone.fg : 'transparent' }} aria-hidden />
        <span className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-xl" style={{ background: t.tone.bg, color: t.tone.fg }}><Icon className="size-4" /></span>
          <span className={`text-xs font-semibold ${on ? 'text-ink' : 'text-muted'}`}>{t.titulo}</span>
        </span>
        <span className={`tabular mt-3 block truncate font-bold tracking-tight text-ink ${t.vacio ? 'text-base text-muted' : 'text-2xl'}`} data-testid={`salud-valor-${t.id}`} aria-label={t.valorTxt}>{t.valor}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted">{t.sub}</span>
        {t.barra && <span className="mt-3 block">{t.barra}</span>}
        <span className="mt-auto flex items-center gap-1 pt-3 text-[11px] font-semibold transition group-hover:gap-1.5" style={{ color: on ? t.tone.fg : 'var(--muted)' }}>
          {t.cta} <ChevronRight className="size-3.5" />
        </span>
      </button>
      <span className="absolute top-3 right-3"><InfoTooltip title={t.titulo}>{t.info}</InfoTooltip></span>
    </div>
  )
}

function Barra({ partes, total, alto = 'h-2' }: { partes: { v: number; color: string; rayado?: boolean }[]; total: number; alto?: string }) {
  return (
    <span className={`flex ${alto} overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--line)_70%,transparent)]`} role="presentation">
      {partes.map((p, i) => (
        <span key={i} className={`bar-grow block h-full ${i === 0 ? 'rounded-l-full' : ''}`} style={{
          width: `${total > 0 ? Math.min(100, Math.max(0, (p.v / total) * 100)) : 0}%`,
          background: p.rayado ? `repeating-linear-gradient(135deg, ${p.color}, ${p.color} 4px, ${p.color}88 4px, ${p.color}88 8px)` : p.color,
        }} />
      ))}
    </span>
  )
}

/** Encabezado de cada sección: separa visualmente resumen, detalle y acciones. */
function Cabecera({ icon: Icon, titulo, texto, tono = TONO.info, acciones }: { icon: typeof ShieldCheck; titulo: string; texto?: ReactNode; tono?: Tono; acciones?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl" style={{ background: tono.bg, color: tono.fg }}><Icon className="size-5" /></span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{titulo}</h3>
          {texto && <p className="text-xs text-muted">{texto}</p>}
        </div>
      </div>
      {acciones}
    </div>
  )
}

function Subtitulo({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">{children}</p>{extra}
    </div>
  )
}

function Stat({ label, value, hint, tone, destacado, testid, icon: Icon }: {
  label: string; value: string; hint?: ReactNode; tone?: Tono; destacado?: boolean; testid?: string; icon?: typeof ShieldCheck
}) {
  return (
    <div className={`min-w-0 rounded-2xl border p-3 ${destacado ? 'border-transparent' : 'border-line bg-card'}`}
      style={destacado && tone ? { background: tone.bg, boxShadow: `inset 0 0 0 1px ${tone.ring}` } : undefined}>
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted">{Icon && <Icon className="size-3.5" style={tone ? { color: tone.fg } : undefined} />}{label}</p>
      <p className={`tabular mt-1 truncate font-bold tracking-tight ${destacado ? 'text-2xl' : 'text-lg'}`} style={tone ? { color: tone.fg } : undefined} data-testid={testid}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  )
}

function Aviso({ tono, icon: Icon, titulo, children, testid }: { tono: Tono; icon: typeof ShieldCheck; titulo: string; children?: ReactNode; testid?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl px-4 py-3" style={{ background: tono.bg, boxShadow: `inset 0 0 0 1px ${tono.ring}` }} data-testid={testid}>
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-card/70" style={{ color: tono.fg }}><Icon className="size-4" /></span>
      <div className="min-w-0 text-sm">
        <p className="font-semibold" style={{ color: tono.fg }}>{titulo}</p>
        {children && <p className="text-ink/80">{children}</p>}
      </div>
    </div>
  )
}

function Vacio({ icon: Icon, titulo, children, accion, tono = TONO.info, testid }: { icon: typeof ShieldCheck; titulo: string; children?: ReactNode; accion?: ReactNode; tono?: Tono; testid?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-8 text-center" data-testid={testid}>
      <span className="grid size-12 place-items-center rounded-2xl" style={{ background: tono.bg, color: tono.fg }}><Icon className="size-6" /></span>
      <p className="text-sm font-semibold text-ink">{titulo}</p>
      {children && <p className="max-w-sm text-xs text-muted">{children}</p>}
      {accion && <div className="mt-1">{accion}</div>}
    </div>
  )
}

const Chip = ({ children, tono = TONO.neutro, testid }: { children: ReactNode; tono?: Tono; testid?: string }) => (
  <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: tono.fg, background: tono.bg }} data-testid={testid}>{children}</span>
)

/** Indicador circular del índice de calidad. */
function Anillo({ valor, tono }: { valor: number; tono: Tono }) {
  const r = 52, c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 128 128" className="size-36" role="presentation">
      <circle cx="64" cy="64" r={r} fill="none" stroke="var(--line)" strokeWidth="10" />
      <circle cx="64" cy="64" r={r} fill="none" stroke={tono.fg} strokeWidth="10" strokeLinecap="round" strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(100, valor)) / 100)} transform="rotate(-90 64 64)" style={{ transition: 'stroke-dashoffset .6s ease' }} />
    </svg>
  )
}

/* ================================ Calidad ================================ */

function PanelCalidad({ c, onRevisar }: { c: CalidadDatos; onRevisar: () => void }) {
  if (c.indice === null) {
    return <Vacio icon={ShieldCheck} titulo="Sin movimientos para evaluar" tono={TONO.neutro}>Cuando registres gastos en este período, verás aquí la calidad de tus datos.</Vacio>
  }
  const tono = c.indice >= 90 ? TONO.ok : c.indice >= 70 ? TONO.atencion : TONO.alerta
  const pendDup = c.similares.filter(s => s.estado === 'sin-revisar' || s.estado === 'pendiente').length
  const dims: { label: string; v: number | null; peso: number; detalle: string; icon: typeof ShieldCheck }[] = [
    { label: 'Integridad', icon: ShieldCheck, v: c.integridad, peso: PESOS.integridad, detalle: c.conProblemas.length ? `${c.conProblemas.length} movimiento(s) con datos faltantes o inválidos` : 'Todos los datos completos' },
    { label: 'Clasificación válida', icon: Tags, v: c.clasificacion, peso: PESOS.clasificacion, detalle: `${c.invalidas.length} inválida(s) · ${c.historicas.length} histórica(s) reconocida(s)` },
    { label: 'Consistencia del catálogo', icon: Layers, v: c.consistencia, peso: PESOS.consistencia, detalle: c.catalogo.length ? `${c.catalogo.length} observación(es) en el catálogo` : 'Sin repeticiones ni opciones huérfanas' },
    { label: 'Duplicados confirmados', icon: Copy, v: c.duplicados, peso: PESOS.duplicados, detalle: `${c.similares.filter(s => s.estado === 'duplicado').length} confirmado(s) · ${pendDup} coincidencia(s) por revisar` },
  ]
  return (
    <>
      <Cabecera icon={ShieldCheck} titulo="Calidad de datos" tono={tono} texto="Qué tan completos, bien clasificados y sin duplicados están tus movimientos del período." />
      <div className="grid gap-4 md:grid-cols-[minmax(0,17rem)_1fr]">
        <div className="flex flex-col items-center rounded-2xl p-5 text-center" style={{ background: `linear-gradient(160deg, ${tono.bg}, var(--card))`, boxShadow: `inset 0 0 0 1px ${tono.ring}` }}>
          <div className="relative">
            <Anillo valor={c.indice} tono={tono} />
            <div className="absolute inset-0 grid place-items-center">
              <p className="tabular text-4xl font-bold tracking-tight text-ink" data-testid="indice-calidad">{c.indice}<span className="text-sm font-medium text-muted">/100</span></p>
            </div>
          </div>
          <p className="mt-1 text-sm font-semibold" style={{ color: tono.fg }}>{c.indice >= 90 ? 'Excelente' : c.indice >= 70 ? 'Aceptable' : 'Necesita revisión'}</p>
          <p className="text-xs text-muted">{c.evaluados} movimiento{c.evaluados === 1 ? '' : 's'} evaluado{c.evaluados === 1 ? '' : 's'}</p>
          <div className="mt-3">{c.pendientes ? <Chip tono={TONO.atencion}><AlertTriangle className="size-3" /> {c.pendientes} alerta{c.pendientes === 1 ? '' : 's'} pendiente{c.pendientes === 1 ? '' : 's'}</Chip>
            : <Chip tono={TONO.ok}><CheckCircle2 className="size-3" /> Sin alertas pendientes</Chip>}</div>
          <Button variant="soft" className="mt-4 w-full" onClick={onRevisar}><ListChecks className="size-4" /> Revisar datos{c.pendientes ? ` (${c.pendientes})` : ''}</Button>
        </div>
        <div>
          <Subtitulo>Detalle por dimensión</Subtitulo>
          <ul className="grid gap-2 sm:grid-cols-2">
            {dims.map(d => {
              const t = d.v === null ? TONO.neutro : d.v >= 90 ? TONO.ok : d.v >= 70 ? TONO.atencion : TONO.alerta
              return (
                <li key={d.label} className="rounded-2xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: t.bg, color: t.fg }}><d.icon className="size-3.5" /></span>
                      <span className="truncate">{d.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Chip>peso {Math.round(d.peso * 100)} %</Chip>
                      <b className="tabular text-base" style={{ color: t.fg }}>{d.v === null ? '—' : d.v.toLocaleString('es-PE', { maximumFractionDigits: 1 })}</b>
                    </span>
                  </div>
                  <div className="mt-2"><Barra partes={[{ v: d.v ?? 0, color: t.fg }]} total={100} alto="h-1.5" /></div>
                  <p className="mt-1.5 text-[11px] text-muted">{d.detalle}</p>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-[11px] text-muted">Las coincidencias legítimas o sin revisar no restan puntos: solo los duplicados que confirmes.</p>
        </div>
      </div>
    </>
  )
}

/* ================================ Presupuesto ================================ */

function PanelPresupuesto({ p, comp, money }: { p: MiPresupuesto; comp: Compromisos; money: (c: number) => string }) {
  if (!p.presupuesto) {
    return <Vacio icon={PiggyBank} titulo="Aún no defines tu presupuesto" tono={TONO.neutro}>Usa “Ajustar caja” en el Dashboard para fijar tu presupuesto mensual y ver cuánto puedes gastar todavía.</Vacio>
  }
  const nivel = NIVEL[p.nivel], tono = TONO[nivel.tono]
  const libre = Math.max(0, p.presupuesto - p.gastado - p.pendiente)
  return (
    <>
      <Cabecera icon={PiggyBank} titulo="Mi presupuesto" tono={tono} texto="Cuánto puedes gastar todavía, considerando lo que ya gastaste y lo que tienes comprometido."
        acciones={<Chip tono={tono}>{nivel.txt}</Chip>} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
        <div className="rounded-2xl p-4" style={{ background: `linear-gradient(150deg, ${TONO.ok.bg}, var(--card))`, boxShadow: `inset 0 0 0 1px ${TONO.ok.ring}` }}>
          <p className="text-xs font-medium text-muted">Disponible tras compromisos</p>
          <p className="tabular mt-1 text-3xl font-bold tracking-tight" style={{ color: p.disponibleTrasCompromisos < 0 ? TONO.alerta.fg : TONO.ok.fg }} data-testid="pres-tras">{money(p.disponibleTrasCompromisos)}</p>
          <p className="mt-1 text-xs text-muted">de un presupuesto de <b className="tabular text-ink">{money(p.presupuesto)}</b></p>
          <div className="mt-4">
            <Barra partes={[{ v: p.gastado, color: tono.fg }, { v: p.pendiente, color: TONO.atencion.fg, rayado: true }]} total={p.presupuesto} alto="h-3" />
            <div className="tabular mt-2 flex justify-between text-[11px] text-muted"><span>Usado {pctTxt(p.pctUsado)}</span><span>Comprometido {pctTxt(p.pctComprometido)}</span></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Presupuesto mensual" value={money(p.presupuesto)} icon={Wallet} testid="pres-presupuesto" />
          <Stat label="Gastos registrados" value={money(p.gastado)} hint={`${pctTxt(p.pctUsado)} utilizado`} icon={Receipt} tone={tono} testid="pres-gastado" />
          <Stat label="Compromisos pendientes" value={money(p.pendiente)} hint={`${pctTxt(p.pctComprometido)} comprometido`} icon={Repeat} tone={TONO.atencion} testid="pres-pendiente" />
          <Stat label="Disponible presupuestario" value={money(p.disponible)} hint="Presupuesto − gastado" icon={PiggyBank} tone={p.disponible < 0 ? TONO.alerta : undefined} testid="pres-disponible" />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <Leyenda color={tono.fg} label="Gastado" valor={money(p.gastado)} />
        <Leyenda color={TONO.atencion.fg} label="Compromisos pendientes" valor={money(p.pendiente)} rayado />
        <Leyenda color="var(--line)" label="Libre" valor={money(libre)} />
      </div>

      <div className="mt-4" data-testid="pres-nivel">
        {p.nivel === 'excedido'
          ? <Aviso tono={TONO.alerta} icon={AlertTriangle} titulo={nivel.txt}>Superaste el presupuesto en {money(-p.disponible)}.</Aviso>
          : <Aviso tono={tono} icon={p.nivel === 'ok' ? CheckCircle2 : AlertTriangle} titulo={`${nivel.txt}. ${nivel.ayuda}`}>
            {comp.pendiente ? `Después de cubrir ${money(comp.pendiente)} en compromisos te quedarían ${money(p.disponibleTrasCompromisos)}.` : `Te quedan ${money(p.disponible)} del presupuesto.`}
          </Aviso>}
      </div>

      {p.cajas.length > 0 && (
        <div className="mt-5">
          <Subtitulo extra={<span className="text-[11px] text-muted">Reservas dentro del presupuesto general · no se suman a él</span>}>Cajas específicas</Subtitulo>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {p.cajas.map(c => {
              const t = c.asignado ? TONO[NIVEL[c.nivel].tono] : TONO.neutro
              const color = c.caja.color || '#1e3a8a'
              return (
                <li key={c.caja.id} className="rounded-2xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                      <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ background: `${color}1A`, color }}><Wallet className="size-4" /></span>
                      <span className="truncate">{c.caja.nombre}</span>
                    </span>
                    <Chip tono={t}>{c.asignado ? pctTxt(c.pct) : 'Sin asignar'}</Chip>
                  </div>
                  <div className="my-2.5"><Barra partes={[{ v: c.gastado, color }, { v: c.pendiente, color: TONO.atencion.fg, rayado: true }]} total={c.asignado} alto="h-2" /></div>
                  <div className="tabular flex items-end justify-between gap-2">
                    <div className="min-w-0 text-[11px] text-muted">Gastado <b className="text-ink">{money(c.gastado)}</b> de {money(c.asignado)}{c.pendiente ? <> · pendiente {money(c.pendiente)}</> : null}</div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] text-muted">Disponible tras compromisos</p>
                      <p className="text-sm font-bold" style={{ color: c.disponibleTrasCompromisos < 0 ? TONO.alerta.fg : 'var(--ink)' }}>{money(c.disponibleTrasCompromisos)}</p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <p className="mt-4 text-[11px] text-muted">Indicadores de presupuesto con la fecha real de cada gasto; no son el saldo de tu cuenta. Un pago de compromiso sube “gastado” y baja “pendiente” en lo mismo: nunca se descuenta dos veces.</p>
    </>
  )
}

function Leyenda({ color, label, valor, rayado }: { color: string; label: string; valor: string; rayado?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-muted">
      <span className="size-2.5 rounded-full" style={{ background: rayado ? `repeating-linear-gradient(135deg, ${color}, ${color} 2px, ${color}88 2px, ${color}88 4px)` : color }} />
      {label} <b className="tabular text-ink">{valor}</b>
    </span>
  )
}

/* ================================ Evolución ================================ */

const variacionTxt = (r: FilaEvolucion) => (r.variacion === null ? 'nuevo' : `${r.variacion > 0 ? '+' : ''}${r.variacion.toLocaleString('es-PE', { maximumFractionDigits: 1 })}%`)

function PanelEvolucion({ evo, ahorro, money, fmt, per, modo, setModo, nivel, setNivel, mesA, mesB, setMesA, setMesB, meses }: {
  evo: Evolucion; ahorro: Oportunidad[]; money: (c: number) => string; fmt?: string; per: { actual: Rango; anterior: Rango; parcial: boolean }
  modo: 'equivalente' | 'meses'; setModo: (m: 'equivalente' | 'meses') => void; nivel: NivelComparacion; setNivel: (n: NivelComparacion) => void
  mesA: string; mesB: string; setMesA: (m: string) => void; setMesB: (m: string) => void; meses: string[]
}) {
  const r = (x: Rango) => `${formatDate(x.desde, fmt)} al ${formatDate(x.hasta, fmt)}`
  const dif = evo.totalActual - evo.totalAnterior
  return (
    <>
      <Cabecera icon={TrendingUp} titulo="Evolución y oportunidades de ahorro" texto="Qué gastos están subiendo o bajando frente al período anterior, y dónde podrías ahorrar." />
      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-bg/70 p-3">
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-medium text-muted">Comparar</p>
          <Segmented label="Comparación" value={modo} onChange={setModo}
            options={[{ value: 'equivalente', label: 'Mismo tramo del mes anterior' }, { value: 'meses', label: 'Elegir meses' }]} />
        </div>
        {modo === 'meses' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-40"><SelectField label="Mes a analizar" value={mesA} onChange={setMesA}>{meses.map(m => <option key={m} value={m}>{monthLabel(m, true)}</option>)}</SelectField></div>
            <span className="text-xs text-muted">contra</span>
            <div className="w-40"><SelectField label="Mes de comparación" value={mesB} onChange={setMesB}>{[...new Set([...meses, mesB])].sort().reverse().map(m => <option key={m} value={m}>{monthLabel(m, true)}</option>)}</SelectField></div>
          </div>
        )}
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-medium text-muted">Agrupar por</p>
          <Segmented label="Nivel" value={nivel} onChange={setNivel}
            options={[{ value: 'ambito', label: 'Ámbito' }, { value: 'categoria', label: 'Categoría' }, { value: 'subcategoria', label: 'Subcategoría' }]} />
        </div>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted" data-testid="evo-rangos">
        <Chip tono={TONO.info}>Actual</Chip> Del <b className="text-ink">{r(per.actual)}</b> contra
        <Chip>Anterior</Chip> del <b className="text-ink">{r(per.anterior)}</b>.
        {per.parcial && <span>El mes aún no termina: se comparan los mismos días.</span>}
      </p>

      <div className="mt-4 space-y-4">
        {!evo.hayHistorial ? (
          <>
            <div data-testid="evo-sin-historial">
              <Vacio icon={CalendarClock} titulo="Aún no hay historial para comparar" tono={TONO.info}>
                Aún no tienes suficiente historial para comparar meses. Continúa registrando tus gastos: el próximo mes verás qué sube y qué baja.
              </Vacio>
            </div>
            {evo.filas.length > 0 && <Ranking titulo="Análisis del período actual" filas={[...evo.filas].sort((a, b) => b.actual - a.actual).slice(0, 8)} total={evo.totalActual} money={money} />}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat label="Período actual" value={money(evo.totalActual)} hint={`${evo.nActual} movimientos`} icon={CalendarDays} />
              <Stat label="Período anterior" value={money(evo.totalAnterior)} hint={`${evo.nAnterior} movimientos`} icon={CalendarClock} />
              <Stat label="Diferencia" value={`${dif >= 0 ? '+' : ''}${money(dif)}`} tone={dif > 0 ? TONO.alerta : TONO.ok} icon={dif > 0 ? ArrowUpRight : ArrowDownRight} />
              <Stat label="Variación" value={evo.totalAnterior ? `${(Math.round((dif / evo.totalAnterior) * 1000) / 10).toLocaleString('es-PE')}%` : '—'} tone={dif > 0 ? TONO.alerta : TONO.ok} />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <ListaEvolucion titulo="Aumentaron" tono={TONO.alerta} icon={ArrowUpRight} filas={evo.aumentaron.slice(0, 6)} money={money} vacio="Nada aumentó frente al período anterior." />
              <ListaEvolucion titulo="Disminuyeron" tono={TONO.ok} icon={ArrowDownRight} filas={evo.disminuyeron.slice(0, 6)} money={money} vacio="Nada disminuyó frente al período anterior." />
            </div>
            {evo.nuevos.length > 0 && <Ranking titulo="Nuevos (sin base de comparación)" filas={evo.nuevos.slice(0, 6)} total={evo.totalActual} money={money} />}
            <details className="group rounded-2xl border border-line">
              <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-xs font-semibold text-muted">Ver tabla completa ({evo.filas.length})<ChevronDown className="size-4 transition group-open:rotate-180" /></summary>
              <div className="overflow-x-auto px-2 pb-2">
                <table className="w-full min-w-[34rem] text-xs">
                  <thead className="text-left text-muted"><tr>
                    <th className="px-2 py-1.5 font-medium">Nombre</th><th className="px-2 py-1.5 text-right font-medium">Actual</th><th className="px-2 py-1.5 text-right font-medium">Anterior</th>
                    <th className="px-2 py-1.5 text-right font-medium">Diferencia</th><th className="px-2 py-1.5 text-right font-medium">Variación</th>
                    <th className="px-2 py-1.5 text-right font-medium">Mov.</th><th className="px-2 py-1.5 text-right font-medium">Promedio</th>
                  </tr></thead>
                  <tbody>{evo.filas.map(f => (
                    <tr key={f.key} className="border-t border-line/70">
                      <td className="px-2 py-1.5">{f.nombre}{f.detalle && <span className="text-muted"> · {f.detalle}</span>}</td>
                      <td className="tabular px-2 py-1.5 text-right">{money(f.actual)}</td><td className="tabular px-2 py-1.5 text-right">{money(f.anterior)}</td>
                      <td className="tabular px-2 py-1.5 text-right">{money(f.diferencia)}</td><td className="tabular px-2 py-1.5 text-right">{f.variacion === null ? 'Sin base' : variacionTxt(f)}</td>
                      <td className="tabular px-2 py-1.5 text-right">{f.nActual} / {f.nAnterior}</td><td className="tabular px-2 py-1.5 text-right">{money(f.promedioActual)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          </>
        )}

        <div>
          <Subtitulo extra={<Chip tono={TONO.info}>Simulación</Chip>}><span className="flex items-center gap-1.5"><Lightbulb className="size-3.5 text-[#B7791F]" /> Oportunidades de ahorro</span></Subtitulo>
          {ahorro.length === 0
            ? <Vacio icon={Lightbulb} titulo="Sin oportunidades relevantes" tono={TONO.neutro}>No hay gastos discrecionales importantes (delivery, antojos, suscripciones, salidas o compras no esenciales) en el período.</Vacio>
            : (
              <ul className="grid gap-2 md:grid-cols-2" data-testid="ahorro">
                {ahorro.map(o => (
                  <li key={o.key} className="flex items-stretch gap-3 rounded-2xl border border-line p-3">
                    <div className="flex w-28 shrink-0 flex-col justify-center rounded-xl px-3 py-2" style={{ background: TONO.ok.bg }}>
                      <p className="text-[10px] font-medium text-muted">Ahorro potencial</p>
                      <p className="tabular text-lg font-bold" style={{ color: TONO.ok.fg }}>{money(o.ahorro)}</p>
                      <p className="text-[10px] text-muted">−{Math.round(REDUCCION_SIMULADA * 100)} % simulado</p>
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="flex items-center gap-1.5 font-semibold text-ink"><span className="truncate">{o.nombre}</span>{o.nombre !== o.categoria && <Chip>{o.categoria}</Chip>}</p>
                      <p className="mt-0.5 text-xs text-muted">Durante el período analizado gastaste <b className="tabular text-ink">{money(o.cents)}</b> en {o.nombre}. Una reducción hipotética del {Math.round(REDUCCION_SIMULADA * 100)} % representaría {money(o.ahorro)} de ahorro.</p>
                      <p className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted">
                        <span>{o.count} movimiento{o.count === 1 ? '' : 's'}</span>
                        {o.variacion !== null && <Chip tono={o.variacion > 0 ? TONO.alerta : TONO.ok}>{o.variacion > 0 ? '↑ subió' : '↓ bajó'} {Math.abs(o.variacion).toLocaleString('es-PE')} %</Chip>}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          <p className="mt-2 text-[11px] text-muted">Solo gastos discrecionales con datos reales. Nunca se sugiere reducir leche, pañales, medicamentos, consultas médicas ni servicios esenciales.</p>
        </div>
      </div>
    </>
  )
}

/** Ranking con peso relativo: nombre, monto, movimientos y promedio. */
function Ranking({ titulo, filas, total, money }: { titulo: string; filas: FilaEvolucion[]; total: number; money: (c: number) => string }) {
  const max = Math.max(1, ...filas.map(f => f.actual))
  return (
    <div className="rounded-2xl border border-line p-4">
      <Subtitulo>{titulo}</Subtitulo>
      <ol className="space-y-2.5">
        {filas.map((f, i) => (
          <li key={f.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3">
            <span className="tabular grid size-6 place-items-center rounded-lg bg-bg text-[11px] font-bold text-muted">{i + 1}</span>
            <div className="min-w-0">
              <p className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-medium text-ink">{f.nombre}{f.detalle && <span className="font-normal text-muted"> · {f.detalle}</span>}</span></p>
              <div className="mt-1"><Barra partes={[{ v: f.actual, color: TONO.info.fg }]} total={max} alto="h-1.5" /></div>
              <p className="mt-0.5 text-[11px] text-muted">{f.nActual} mov. · prom. {money(f.promedioActual)} · {pctTxt(total ? Math.round((f.actual / total) * 1000) / 10 : null)} del total</p>
            </div>
            <span className="tabular text-right text-sm font-bold text-ink">{money(f.actual)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function ListaEvolucion({ titulo, icon: Icon, tono, filas, money, vacio }: { titulo: string; icon: typeof ShieldCheck; tono: Tono; filas: FilaEvolucion[]; money: (c: number) => string; vacio: string }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><span className="grid size-7 place-items-center rounded-lg" style={{ background: tono.bg, color: tono.fg }}><Icon className="size-4" /></span>{titulo}
        {filas.length > 0 && <Chip tono={tono}>{filas.length}</Chip>}</p>
      {!filas.length ? <p className="rounded-xl bg-bg px-3 py-3 text-center text-xs text-muted">{vacio}</p> : (
        <ul className="divide-y divide-line/70">
          {filas.map(f => (
            <li key={f.key} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0"><span className="block truncate font-medium">{f.nombre}</span>
                <span className="tabular block truncate text-[11px] text-muted">{f.detalle ? `${f.detalle} · ` : ''}{money(f.anterior)} → {money(f.actual)}</span></span>
              <span className="shrink-0 text-right">
                <span className="tabular block font-bold">{`${f.diferencia > 0 ? '+' : ''}${money(f.diferencia)}`}</span>
                <Chip tono={tono}>{variacionTxt(f)}</Chip>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ================================ Compromisos ================================ */

function PanelCompromisos({ store, comp, money, fmt, filters, vinculos, loaded, onRevisarGasto, onGastosMensuales }: {
  store: AppStore; comp: Compromisos; money: (c: number) => string; fmt?: string; filters: Filters; vinculos: Map<string, string>; loaded: boolean
  onRevisarGasto: (g: Gasto) => void; onGastosMensuales: () => void
}) {
  const [asociar, setAsociar] = useState<Plantilla | null>(null)
  if (!loaded && !comp.n) return <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-20 animate-pulse rounded-2xl bg-bg" />)}</div>
  if (!comp.n) {
    return (
      <Vacio icon={Repeat} titulo="Aún no tienes compromisos marcados" tono={TONO.atencion}
        accion={<Button variant="soft" onClick={onGastosMensuales}><CalendarDays className="size-4" /> Abrir Gastos mensuales</Button>}>
        Edita una plantilla (Luz, Internet, Apoyo familiar…) y activa “Es un compromiso mensual” para ver aquí cuánto reservar cada mes.
      </Vacio>
    )
  }
  const quitar = (g: Gasto) => store.track(`vinculo:${g.id}`, { pending: 'Quitando vínculo…', ok: 'Vínculo quitado. El gasto no cambió.', error: 'No se pudo quitar el vínculo.' },
    () => store.actions.vincular(g.id, ''))
  const pct = comp.previsto ? Math.round((comp.cubierto / comp.previsto) * 100) : 0
  return (
    <>
      <Cabecera icon={Repeat} titulo="Compromisos mensuales" tono={comp.pendiente > 0 ? TONO.atencion : TONO.ok}
        texto="Pagos que haces cada mes. Se cubren con los gastos registrados desde su plantilla o asociados a ella." />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]">
        <div className="rounded-2xl p-4" style={{ background: `linear-gradient(150deg, ${TONO.atencion.bg}, var(--card))`, boxShadow: `inset 0 0 0 1px ${TONO.atencion.ring}` }}>
          <p className="text-xs font-medium text-muted">Pendiente por cubrir</p>
          <p className="tabular mt-1 text-3xl font-bold tracking-tight" style={{ color: comp.pendiente ? TONO.atencion.fg : TONO.ok.fg }} data-testid="comp-pendiente">{money(comp.pendiente)}</p>
          <div className="mt-3"><Barra partes={[{ v: comp.cubierto, color: TONO.ok.fg }]} total={comp.previsto} alto="h-2.5" /></div>
          <p className="tabular mt-1.5 text-[11px] text-muted">{pct} % cubierto de lo previsto</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Total previsto" value={money(comp.previsto)} icon={CalendarDays} testid="comp-previsto" />
          <Stat label="Cubierto" value={money(comp.cubierto)} tone={TONO.ok} icon={CheckCircle2} testid="comp-cubierto" />
          <Stat label="Compromisos" value={String(comp.n)} hint={comp.sinMonto ? `${comp.sinMonto} sin monto` : undefined} icon={Repeat} />
          <Stat label="Cubiertos" value={String(comp.nCubiertos)} tone={TONO.ok} />
          <Stat label="Pendientes" value={String(comp.nPendientes)} tone={comp.nPendientes ? TONO.atencion : TONO.ok} />
        </div>
      </div>
      {comp.meses.length > 1 && <p className="mt-2 text-[11px] text-muted">El período abarca {comp.meses.length} meses: cada compromiso se espera una vez por mes y un pago solo cubre el mes de su fecha.</p>}
      <ul className="mt-4 grid gap-3 md:grid-cols-2" aria-label="Compromisos">
        {comp.items.map(i => <FilaCompromiso key={i.plantilla.id} i={i} money={money} fmt={fmt} onAsociar={() => setAsociar(i.plantilla)} onRevisarGasto={onRevisarGasto} onQuitar={quitar} />)}
      </ul>
      {asociar && <AsociarModal store={store} plantilla={asociar} filters={filters} vinculos={vinculos} money={money} fmt={fmt} onClose={() => setAsociar(null)} />}
    </>
  )
}

function FilaCompromiso({ i, money, fmt, onAsociar, onRevisarGasto, onQuitar }: {
  i: CompromisoItem; money: (c: number) => string; fmt?: string; onAsociar: () => void; onRevisarGasto: (g: Gasto) => void; onQuitar: (g: Gasto) => void
}) {
  const estado = i.previsto === null ? { txt: 'Sin monto', tono: TONO.neutro, Icon: CircleDashed }
    : i.cubiertoCompleto ? { txt: 'Cubierto', tono: TONO.ok, Icon: CheckCircle2 }
      : i.cubierto > 0 ? { txt: 'Parcial', tono: TONO.atencion, Icon: CircleDashed } : { txt: 'Pendiente', tono: TONO.cerca, Icon: CircleDashed }
  const pct = i.previsto ? Math.min(100, Math.round((i.aplicado / i.previsto) * 100)) : 0
  return (
    <li className="flex flex-col rounded-2xl border border-line bg-card p-4 transition hover:shadow-[0_6px_18px_rgb(15_23_42/0.06)]" data-testid="compromiso"
      style={{ borderLeft: `4px solid ${estado.tono.fg}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: estado.tono.bg, color: estado.tono.fg }}><Repeat className="size-4" /></span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{i.plantilla.descripcion}</p>
            <p className="truncate text-[11px] text-muted">{i.plantilla.ambito} · {i.plantilla.categoria} · {i.plantilla.subcategoria}</p>
          </div>
        </div>
        <Chip tono={estado.tono}><estado.Icon className="size-3" />{estado.txt}</Chip>
      </div>

      {i.previsto === null ? (
        <p className="mt-3 rounded-xl bg-bg px-3 py-2 text-xs text-muted">Define un monto en la plantilla para medir cuánto falta cubrir. Pagado este período: <b className="tabular text-ink">{money(i.cubierto)}</b></p>
      ) : (
        <div className="mt-3">
          <div className="tabular flex items-end justify-between gap-2">
            <div>
              <p className="text-[10px] text-muted">Cubierto</p>
              <p className="text-lg font-bold text-ink">{money(i.cubierto)} <span className="text-xs font-medium text-muted">/ {money(i.previsto)}</span></p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted">{i.pendiente > 0 ? 'Pendiente' : 'Completo'}</p>
              <p className="text-sm font-bold" style={{ color: i.pendiente > 0 ? TONO.cerca.fg : TONO.ok.fg }}>{i.pendiente > 0 ? `Pendiente ${money(i.pendiente)}` : '✓'}</p>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2"><span className="flex-1"><Barra partes={[{ v: i.aplicado, color: estado.tono.fg }]} total={i.previsto} alto="h-2" /></span><span className="tabular text-[11px] font-semibold text-muted">{pct} %</span></div>
        </div>
      )}

      {i.pagos.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl bg-bg/70 p-2 text-xs">
          {i.pagos.map(g => (
            <li key={g.uid ?? g.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-muted"><CheckCircle2 className="mr-1 inline size-3 text-[#0F8A6B]" />{formatDate(g.fecha, fmt)} · {g.descripcion || g.subcategoria} · {g.medioPago}</span>
              <span className="flex shrink-0 items-center gap-0.5">
                <b className="tabular mr-1">{formatMoney(Math.round(g.monto * 100), g.moneda)}</b>
                <button type="button" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-card hover:text-navy" aria-label={`Abrir ${g.descripcion || 'gasto'} del ${g.fecha}`} onClick={() => onRevisarGasto(g)}><ExternalLink className="size-3.5" /></button>
                <button type="button" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-card hover:text-[#C0362C]" aria-label={`Quitar vínculo de ${g.descripcion || 'gasto'} del ${g.fecha}`} onClick={() => onQuitar(g)}><Link2Off className="size-3.5" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex justify-end pt-3">
        <Button variant={i.cubiertoCompleto ? 'ghost' : 'soft'} className="h-9 px-3 text-xs" onClick={onAsociar} aria-label={`Asociar un movimiento a ${i.plantilla.descripcion}`}><Link2 className="size-3.5" /> Asociar movimiento</Button>
      </div>
    </li>
  )
}

function AsociarModal({ store, plantilla, filters, vinculos, money, fmt, onClose }: {
  store: AppStore; plantilla: Plantilla; filters: Filters; vinculos: Map<string, string>; money: (c: number) => string; fmt?: string; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const base = store.data?.config.moneda || 'PEN'
  const compromisoIds = useMemo(() => new Set(store.plantillas.items.filter(p => p.esCompromiso).map(p => p.id)), [store.plantillas.items])
  const candidatos = useMemo(() => {
    const t = q.trim().toLowerCase()
    const score = (g: Gasto) => (g.ambito === plantilla.ambito && g.subcategoria === plantilla.subcategoria ? 3 : g.categoria === plantilla.categoria ? 2 : 0)
      + (g.descripcion.toLowerCase().includes(plantilla.descripcion.toLowerCase()) ? 1 : 0)
    return (store.data?.gastos ?? [])
      // Disponibles: activos del período que no pagan ya otro compromiso (un vínculo a una plantilla común sí se puede reasignar).
      .filter(g => g.estado === 'Activo' && !g.problemaId && g.fecha >= filters.desde && g.fecha <= filters.hasta && !compromisoIds.has(vinculos.get(g.id.toLowerCase()) ?? ''))
      .filter(g => !t || `${g.descripcion} ${g.categoria} ${g.subcategoria} ${g.medioPago} ${g.monto}`.toLowerCase().includes(t))
      .map(g => ({ g, s: score(g) })).sort((a, b) => b.s - a.s || b.g.fecha.localeCompare(a.g.fecha)).slice(0, 40)
  }, [store.data?.gastos, filters.desde, filters.hasta, vinculos, q, plantilla, compromisoIds])
  const asociar = (g: Gasto) => {
    if (store.track(`vinculo:${g.id}`, { pending: 'Asociando movimiento…', ok: `Movimiento asociado a ${plantilla.descripcion}. El gasto no cambió.`, error: 'No se pudo asociar el movimiento.' },
      () => store.actions.vincular(g.id, plantilla.id))) onClose()
  }
  void base
  return (
    <Modal open onClose={onClose} size="md" title={`Asociar a “${plantilla.descripcion}”`} subtitle="Elige el gasto que pagó este compromiso. Solo se guarda el vínculo: el gasto no se modifica." icon={<Link2 className="size-5" />}>
      <label className="relative mb-3 block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input aria-label="Buscar movimiento" className={`${inputCls} pl-9`} placeholder="Buscar por descripción, categoría o monto…" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      {!candidatos.length ? <Empty title="Sin movimientos disponibles">No hay gastos activos sin vínculo en el período.</Empty> : (
        <ul className="divide-y divide-line/70 rounded-xl border border-line" aria-label="Movimientos disponibles">
          {candidatos.map(({ g, s }) => (
            <li key={g.uid ?? g.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">{g.descripcion || g.subcategoria}{s >= 3 && <span className="ml-1.5 rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-navy">Coincide</span>}</span>
                <span className="block truncate text-[11px] text-muted">{formatDate(g.fecha, fmt)} · {g.ambito} · {g.categoria} › {g.subcategoria} · {g.medioPago}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2"><b className="tabular">{formatMoney(Math.round(g.monto * 100), g.moneda)}</b>
                <Button variant="soft" className="h-9 px-3 text-xs" onClick={() => asociar(g)}>Asociar</Button></span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted">Compromiso previsto: {plantilla.monto === null ? 'sin monto' : money(Math.round(plantilla.monto * 100))}{plantilla.moneda !== base ? ` (${plantilla.moneda})` : ''}.</p>
    </Modal>
  )
}

/* ================================ Revisión de datos ================================ */

function RevisionDatos({ store, c, fmt, onClose, onRevisarGasto }: { store: AppStore; c: CalidadDatos; fmt?: string; onClose: () => void; onRevisarGasto: (g: Gasto) => void }) {
  const pendientes = c.similares.filter(s => s.estado === 'sin-revisar' || s.estado === 'pendiente')
  const revisados = c.similares.filter(s => s.estado === 'legitimo' || s.estado === 'duplicado')
  const marcar = (s: GrupoSimilar, estado: EstadoRevision) => {
    const msg = { legitimo: 'Coincidencia marcada como legítima.', pendiente: 'Coincidencia marcada como pendiente de revisión.', duplicado: 'Duplicado confirmado. No se eliminó ningún movimiento.' }[estado]
    store.track(`revision:${s.ids.join(',')}`, { pending: 'Guardando revisión…', ok: msg, error: 'No se pudo guardar la revisión.' },
      () => store.actions.saveRevision({ id: s.revision?.id ?? `rev-${crypto.randomUUID()}`, ids: s.ids, estado, firma: s.clave }))
  }
  const fila = (g: Gasto, extra?: ReactNode) => (
    <li key={g.uid ?? g.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 py-2.5 text-sm sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto]">
      <span className="order-1 min-w-0">
        <span className="block truncate font-medium text-ink">{g.descripcion || g.subcategoria || '(sin descripción)'}</span>
        <span className="tabular block text-[11px] text-muted">{/^\d{4}-\d{2}-\d{2}$/.test(g.fecha) ? formatDate(g.fecha, fmt) : g.fecha || 'sin fecha'}</span>
      </span>
      <span className="order-4 col-span-3 min-w-0 text-[11px] text-muted sm:order-2 sm:col-span-1">
        <span className="block truncate">{g.ambito} › {g.categoria} › {g.subcategoria || '—'}</span>
        <span className="block truncate">{g.medioPago}</span>
      </span>
      <b className="tabular order-2 text-right sm:order-3">{Number.isFinite(g.monto) ? formatMoney(Math.round(g.monto * 100), g.moneda || 'PEN') : '—'}</b>
      <span className="order-3 flex justify-end sm:order-4">
        <Button variant="outline" className="h-9 px-2.5 text-xs sm:px-3" disabled={!!g.problemaId} title={g.problemaId ? 'Su ID está repetido o es inválido: repáralo primero (repararIds en Apps Script)' : 'Abrir para revisar o corregir'}
          onClick={() => onRevisarGasto(g)} aria-label={`Abrir ${g.descripcion || 'gasto'}`}><ExternalLink className="size-3.5" /><span className="max-sm:sr-only">Abrir</span></Button>
      </span>
      {extra && <span className="order-5 col-span-3 sm:col-span-4">{extra}</span>}
    </li>
  )
  const resumen = [
    { t: 'Posibles duplicados', n: pendientes.length, icon: Copy, href: 'rev-duplicados' },
    { t: 'Integridad', n: c.conProblemas.length, icon: ShieldCheck, href: 'rev-integridad' },
    { t: 'Clasificación', n: c.invalidas.length, icon: Tags, href: 'rev-clasificacion' },
    { t: 'Catálogo', n: c.catalogo.length, icon: Layers, href: 'rev-catalogo' },
  ]
  return (
    <Modal open onClose={onClose} size="xl" title="Revisar datos" subtitle="Nada se modifica automáticamente: abre cada movimiento para corregirlo o marca las coincidencias." icon={<ListChecks className="size-5" />}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {resumen.map(r => {
            const t = r.n ? TONO.atencion : TONO.ok
            return (
              <a key={r.t} href={`#${r.href}`} onClick={e => { e.preventDefault(); document.getElementById(r.href)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                className="flex items-center gap-2 rounded-2xl border border-line p-2.5 transition hover:bg-bg">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ background: t.bg, color: t.fg }}><r.icon className="size-4" /></span>
                <span className="min-w-0"><span className="block truncate text-xs font-medium text-muted">{r.t}</span>
                  <span className="block text-sm font-bold" style={{ color: t.fg }}>{r.n ? `${r.n} por revisar` : 'Sin alertas'}</span></span>
              </a>
            )
          })}
        </div>

        <Seccion id="rev-duplicados" titulo="Posibles duplicados" n={pendientes.length} icon={Copy}>
          {!c.similares.length ? <SinAlertas>No se encontraron movimientos similares.</SinAlertas> : (
            <div className="space-y-3">
              {[...pendientes, ...revisados].map(s => {
                const t = s.estado === 'legitimo' ? TONO.ok : s.estado === 'duplicado' ? TONO.alerta : TONO.atencion
                return (
                  <div key={s.ids.join(',')} className="overflow-hidden rounded-2xl border border-line" data-testid="grupo-similar" style={{ borderLeft: `4px solid ${t.fg}` }}>
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
                      <p className="flex items-center gap-2 text-sm"><Copy className="size-4" style={{ color: t.fg }} />
                        <span>Se encontraron <b>{s.gastos.length} movimientos similares</b>. Revisa si corresponden a operaciones diferentes.</span></p>
                      <EstadoChip estado={s.estado} />
                    </div>
                    <ul className="divide-y divide-line/60 px-4">{s.gastos.map(g => fila(g))}</ul>
                    <div className="flex flex-wrap items-center justify-center gap-2 border-t border-line bg-bg/60 px-4 py-2.5 sm:justify-end">
                      <Button variant={s.estado === 'legitimo' ? 'primary' : 'soft'} className="h-9 text-xs" onClick={() => marcar(s, 'legitimo')}><CheckCircle2 className="size-3.5" /> Son legítimos</Button>
                      <Button variant="outline" className="h-9 text-xs" onClick={() => marcar(s, 'pendiente')}><CircleDashed className="size-3.5" /> Dejar pendiente</Button>
                      <Button variant="outline" className="h-9 text-xs text-[#C0362C]" onClick={() => marcar(s, 'duplicado')}><AlertTriangle className="size-3.5" /> Confirmar duplicado</Button>
                    </div>
                    {s.estado === 'duplicado' && <p className="px-4 pb-3 text-[11px] text-muted">Confirmado como duplicado: resta puntos de calidad. No se eliminó nada; si sobra un registro, ábrelo y elimínalo tú.</p>}
                  </div>
                )
              })}
            </div>
          )}
        </Seccion>

        <Seccion id="rev-integridad" titulo="Integridad" n={c.conProblemas.length} icon={ShieldCheck}>
          {!c.conProblemas.length ? <SinAlertas>Todos los movimientos tienen ID, fecha, monto, moneda, clasificación, medio y estado válidos.</SinAlertas> : (
            <ul className="divide-y divide-line/60 rounded-2xl border border-line px-4">{c.conProblemas.slice(0, 100).map(x => fila(x.gasto,
              <span className="flex flex-wrap gap-1">{x.problemas.map(p => <Chip key={p} tono={TONO.alerta}>{PROBLEMA_TXT[p]}</Chip>)}</span>))}</ul>
          )}
        </Seccion>

        <Seccion id="rev-clasificacion" titulo="Clasificación" n={c.invalidas.length} icon={Tags}>
          {!c.invalidas.length ? <SinAlertas>Todas las clasificaciones existen en el catálogo (o son históricas reconocidas).</SinAlertas> : (
            <ul className="divide-y divide-line/60 rounded-2xl border border-line px-4">{c.invalidas.slice(0, 100).map(x => fila(x.gasto,
              <span className="block rounded-lg px-2 py-1 text-[11px]" style={{ background: TONO.alerta.bg, color: TONO.alerta.fg }}>{x.c.motivo}{x.c.sugerencia ? ` Sugerencia: ${x.c.sugerencia.ambito} › ${x.c.sugerencia.categoria} › ${x.c.sugerencia.subcategoria}.` : ''}</span>))}</ul>
          )}
          {c.historicas.length > 0 && (
            <details className="group mt-2 rounded-2xl px-4 py-2.5" style={{ background: TONO.info.bg }}>
              <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold" style={{ color: TONO.info.fg }}>
                <Info className="size-3.5" />{c.historicas.length} clasificación(es) histórica(s) reconocida(s): válidas, no restan puntos
                <ChevronDown className="ml-auto size-4 transition group-open:rotate-180" />
              </summary>
              <ul className="mt-1 divide-y divide-line/60">{c.historicas.slice(0, 100).map(x => fila(x.gasto,
                <span className="flex items-center gap-1 text-[11px]" style={{ color: TONO.info.fg }}><Info className="size-3" /> {x.c.motivo}</span>))}</ul>
            </details>
          )}
        </Seccion>

        <Seccion id="rev-catalogo" titulo="Catálogo" n={c.catalogo.length} icon={Layers}>
          {!c.catalogo.length ? <SinAlertas>El catálogo y los medios de pago no tienen repeticiones ni opciones huérfanas.</SinAlertas> : (
            <ul className="space-y-1.5">{c.catalogo.map((x, i) => <li key={i} className="flex items-start gap-2 rounded-xl px-3 py-2 text-sm" style={{ background: TONO.atencion.bg }}><AlertTriangle className="mt-0.5 size-3.5 shrink-0" style={{ color: TONO.atencion.fg }} />{x.texto}</li>)}</ul>
          )}
        </Seccion>
      </div>
    </Modal>
  )
}

function SinAlertas({ children }: { children: ReactNode }) {
  return <p className="flex items-center gap-2 rounded-2xl px-4 py-3 text-xs" style={{ background: TONO.ok.bg, color: TONO.ok.fg }}><CheckCircle2 className="size-4 shrink-0" />{children}</p>
}

function Seccion({ id, titulo, n, icon: Icon, children }: { id: string; titulo: string; n: number; icon: typeof ShieldCheck; children: ReactNode }) {
  const t = n ? TONO.atencion : TONO.ok
  return (
    <section aria-label={titulo} id={id} className="scroll-mt-2 rounded-2xl border border-line p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="grid size-7 place-items-center rounded-lg" style={{ background: t.bg, color: t.fg }}><Icon className="size-4" /></span>{titulo}
        <Chip tono={t}>{n ? `${n} por revisar` : 'Sin alertas'}</Chip>
      </h3>
      {children}
    </section>
  )
}

function EstadoChip({ estado }: { estado: GrupoSimilar['estado'] }) {
  const m = {
    'sin-revisar': { t: 'Sin revisar', tono: TONO.atencion }, pendiente: { t: 'Pendiente de revisión', tono: TONO.atencion },
    legitimo: { t: 'Legítimos', tono: TONO.ok }, duplicado: { t: 'Duplicado confirmado', tono: TONO.alerta },
  }[estado]
  return <Chip tono={m.tono} testid="estado-grupo">{m.t}</Chip>
}
