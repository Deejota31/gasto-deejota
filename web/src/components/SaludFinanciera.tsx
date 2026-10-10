import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, CircleDashed, ExternalLink, HeartPulse, Link2, Link2Off, Lightbulb, ListChecks,
  PiggyBank, Repeat, Search, ShieldCheck, Sparkles, TrendingUp,
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
import { Button, Card, Empty, InfoTooltip, inputCls, Modal, Segmented, SelectField } from './ui'

type Vista = 'calidad' | 'presupuesto' | 'evolucion' | 'compromisos'

const NIVEL: Record<NivelPresupuesto, { txt: string; color: string; bg: string }> = {
  'sin-presupuesto': { txt: 'Sin presupuesto definido', color: 'var(--muted)', bg: 'var(--bg)' },
  ok: { txt: 'Dentro del presupuesto', color: '#0F7A5F', bg: '#E7F7F2' },
  atencion: { txt: 'Atención: ya usaste más del 70 %', color: '#9A6700', bg: '#FFF6DB' },
  cerca: { txt: 'Cerca del límite (90 % o más)', color: '#C2410C', bg: '#FFEDE3' },
  excedido: { txt: 'Presupuesto alcanzado o excedido', color: '#C0362C', bg: '#FDECEC' },
}
const pctTxt = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es-PE', { maximumFractionDigits: 1 })}%`)

/**
 * Salud financiera: calidad de los datos, presupuesto con compromisos, evolución y compromisos mensuales.
 * Todo se calcula con los datos ya cargados (memoizado); la única lectura adicional son las plantillas,
 * una vez por sesión y solo si aún no estaban en memoria.
 */
export default function SaludFinanciera({ store, a, filters, today, onEditGasto, onGastosMensuales }: {
  store: AppStore; a: Aggregates; filters: Filters; today: string; onEditGasto: (g: Gasto) => void; onGastosMensuales: () => void
}) {
  const data = store.data!
  const base = data.config.moneda || 'PEN'
  const rates = useMemo(() => ratesFromConfig(data.config), [data.config])
  const fmt = data.config.formato_fecha
  const money = (c: number) => formatMoney(c, base)
  const [vista, setVista] = useState<Vista>('presupuesto')
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
  const tiles: { id: Vista; titulo: string; icon: ReactNode; valor: string; sub: string; barra?: ReactNode; info: ReactNode }[] = [
    {
      id: 'calidad', titulo: 'Calidad de datos', icon: <ShieldCheck className="size-4" />,
      valor: calidad.indice === null ? '—' : `${calidad.indice}/100`,
      sub: calidad.indice === null ? 'Sin movimientos en el período' : calidad.pendientes ? `${calidad.pendientes} alerta${calidad.pendientes === 1 ? '' : 's'} por revisar` : 'Sin alertas pendientes',
      barra: calidad.indice === null ? undefined : <Barra partes={[{ v: calidad.indice, color: calidad.indice >= 90 ? '#16A085' : calidad.indice >= 70 ? '#E0A100' : '#E25563' }]} total={100} />,
      info: <>
        <p>Índice de 0 a 100 = 30 % integridad + 30 % clasificación + 20 % consistencia del catálogo + 20 % duplicados confirmados.</p>
        <p>Evalúa los movimientos activos del período y filtros elegidos. Las coincidencias sin revisar o marcadas como legítimas no restan puntos.</p>
      </>,
    },
    {
      id: 'presupuesto', titulo: 'Mi presupuesto', icon: <PiggyBank className="size-4" />,
      valor: pres.presupuesto ? money(pres.disponibleTrasCompromisos) : 'Sin definir',
      sub: pres.presupuesto ? `Disponible tras compromisos · usado ${pctTxt(pres.pctUsado)}` : 'Define la caja general',
      barra: pres.presupuesto ? <Barra partes={[{ v: pres.gastado, color: NIVEL[pres.nivel].color }, { v: pres.pendiente, color: '#E0A100', rayado: true }]} total={pres.presupuesto} /> : undefined,
      info: <>
        <p>Disponible tras compromisos = presupuesto mensual − gastos registrados − compromisos pendientes.</p>
        <p>Es un indicador de presupuesto, no el saldo de tu cuenta: la app no conoce tus ingresos ni tu banco.</p>
      </>,
    },
    {
      id: 'evolucion', titulo: 'Evolución', icon: <TrendingUp className="size-4" />,
      valor: evo.hayHistorial ? `${evo.aumentaron.length} ↑ · ${evo.disminuyeron.length} ↓` : 'Sin historial',
      sub: evo.hayHistorial ? (evo.aumentaron[0] ? `Más subió: ${evo.aumentaron[0].nombre} (${variacionTxt(evo.aumentaron[0])})` : 'Nada subió frente al período anterior') : 'Aún no hay un período anterior con datos',
      info: <>
        <p>Compara el período elegido con el anterior equivalente: si el mes no ha terminado, compara los mismos días (p. ej. del 1 al 9 contra del 1 al 9).</p>
        <p>Variación = (actual − anterior) ÷ anterior. Si el anterior es 0, se marca como nuevo (sin base de comparación).</p>
      </>,
    },
    {
      id: 'compromisos', titulo: 'Compromisos', icon: <Repeat className="size-4" />,
      valor: comp.n ? money(comp.pendiente) : 'Sin compromisos',
      sub: comp.n ? `Pendiente · ${comp.nCubiertos} de ${comp.n - comp.sinMonto} cubiertos` : 'Márcalos en tus plantillas',
      barra: comp.previsto ? <Barra partes={[{ v: comp.cubierto, color: '#16A085' }]} total={comp.previsto} /> : undefined,
      info: <>
        <p>Plantillas que marcaste como compromiso mensual. Cubierto = gastos activos vinculados a esa plantilla con fecha dentro del período (se suman pagos parciales).</p>
        <p>Pendiente = previsto − cubierto (nunca negativo). Un gasto con descripción parecida pero sin vínculo no cuenta como pago.</p>
      </>,
    },
  ]

  return (
    <Card title={`Salud financiera — ${periodo}`} icon={<HeartPulse className="size-4 text-coral" />}
      info={{ title: 'Salud financiera', body: <>
        <p>Responde tres preguntas: cuánto puedes gastar todavía, qué gastos están aumentando y cuánto necesitas reservar para tus compromisos. Además evalúa la calidad de tus datos.</p>
        <p>Usa los mismos datos y filtros del dashboard, sin consultas adicionales a tu hoja, y nunca modifica movimientos.</p></> }}>
      <div role="tablist" aria-label="Vistas de salud financiera" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map(t => {
          const on = vista === t.id
          return (
            <div key={t.id} className="relative">
              <button type="button" role="tab" aria-selected={on} aria-controls={`salud-${t.id}`} id={`salud-tab-${t.id}`} onClick={() => setVista(t.id)}
                className={`h-full w-full rounded-2xl border p-3 pr-8 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-navy/40 ${on ? 'border-navy/40 bg-primary-soft/60 shadow-sm' : 'border-line hover:bg-bg'}`}>
                <span className={`flex items-center gap-1.5 text-xs font-semibold ${on ? 'text-navy' : 'text-muted'}`}>{t.icon}{t.titulo}</span>
                <span className="tabular mt-1 block truncate text-lg font-bold text-ink" data-testid={`salud-valor-${t.id}`}>{t.valor}</span>
                <span className="block text-[11px] leading-snug text-muted">{t.sub}</span>
                {t.barra && <span className="mt-2 block">{t.barra}</span>}
              </button>
              <span className="absolute top-2 right-2"><InfoTooltip title={t.titulo}>{t.info}</InfoTooltip></span>
            </div>
          )
        })}
      </div>

      <div id={`salud-${vista}`} role="tabpanel" aria-labelledby={`salud-tab-${vista}`} className="fade-in mt-4" key={vista}>
        {vista === 'calidad' && <PanelCalidad c={calidad} onRevisar={() => setRevisar(true)} />}
        {vista === 'presupuesto' && <PanelPresupuesto p={pres} comp={comp} money={money} />}
        {vista === 'evolucion' && (
          <PanelEvolucion evo={evo} ahorro={ahorro} money={money} fmt={fmt} per={per} modo={modo} setModo={setModo} nivel={nivel} setNivel={setNivel}
            mesA={mesA} mesB={mesB} setMesA={setMesA} setMesB={setMesB} meses={mesesConDatos} />
        )}
        {vista === 'compromisos' && (
          <PanelCompromisos store={store} comp={comp} money={money} fmt={fmt} filters={filters} vinculos={vinculos} loaded={store.plantillas.loaded}
            onEditGasto={onEditGasto} onGastosMensuales={onGastosMensuales} />
        )}
      </div>

      {revisar && <RevisionDatos store={store} c={calidad} fmt={fmt} onClose={() => setRevisar(false)} onEditGasto={onEditGasto} />}
    </Card>
  )
}

function Barra({ partes, total, alto = 'h-2' }: { partes: { v: number; color: string; rayado?: boolean }[]; total: number; alto?: string }) {
  return (
    <span className={`flex ${alto} overflow-hidden rounded-full bg-bg`} role="presentation">
      {partes.map((p, i) => (
        <span key={i} className="bar-grow block h-full" style={{
          width: `${total > 0 ? Math.min(100, Math.max(0, (p.v / total) * 100)) : 0}%`,
          background: p.rayado ? `repeating-linear-gradient(135deg, ${p.color}, ${p.color} 4px, ${p.color}99 4px, ${p.color}99 8px)` : p.color,
        }} />
      ))}
    </span>
  )
}

function Dato({ label, value, tone, hint, testid }: { label: string; value: string; tone?: string; hint?: string; testid?: string }) {
  return (
    <div className="rounded-xl bg-bg px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="tabular truncate text-base font-semibold" style={tone ? { color: tone } : undefined} data-testid={testid}>{value}</p>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  )
}

/* ================================ Calidad ================================ */

function PanelCalidad({ c, onRevisar }: { c: CalidadDatos; onRevisar: () => void }) {
  if (c.indice === null) return <Empty icon={<ShieldCheck className="size-5" />} title="Sin movimientos para evaluar">No hay movimientos activos en el período y filtros seleccionados.</Empty>
  const dims: { label: string; v: number | null; peso: number; detalle: string }[] = [
    { label: 'Integridad', v: c.integridad, peso: PESOS.integridad, detalle: `${c.conProblemas.length} movimiento(s) con datos faltantes o inválidos` },
    { label: 'Clasificación válida', v: c.clasificacion, peso: PESOS.clasificacion, detalle: `${c.invalidas.length} inválida(s) · ${c.historicas.length} histórica(s) reconocida(s)` },
    { label: 'Consistencia del catálogo', v: c.consistencia, peso: PESOS.consistencia, detalle: `${c.catalogo.length} observación(es) en el catálogo` },
    { label: 'Duplicados confirmados', v: c.duplicados, peso: PESOS.duplicados, detalle: `${c.similares.filter(s => s.estado === 'duplicado').length} confirmado(s) · ${c.similares.filter(s => s.estado === 'sin-revisar' || s.estado === 'pendiente').length} coincidencia(s) por revisar` },
  ]
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,14rem)_1fr]">
      <div className="flex flex-col items-center justify-center rounded-2xl bg-bg p-4 text-center">
        <p className="text-xs text-muted">Índice de calidad</p>
        <p className="tabular text-4xl font-bold text-ink" data-testid="indice-calidad">{c.indice}<span className="text-base font-medium text-muted">/100</span></p>
        <p className="text-xs text-muted">{c.evaluados} movimiento{c.evaluados === 1 ? '' : 's'} evaluado{c.evaluados === 1 ? '' : 's'}</p>
        <Button className="mt-3" onClick={onRevisar}><ListChecks className="size-4" /> Revisar datos{c.pendientes ? ` (${c.pendientes})` : ''}</Button>
      </div>
      <ul className="space-y-3">
        {dims.map(d => (
          <li key={d.label}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium text-ink">{d.label} <span className="text-[11px] text-muted">· peso {Math.round(d.peso * 100)} %</span></span>
              <span className="tabular font-semibold">{d.v === null ? '—' : `${d.v.toLocaleString('es-PE', { maximumFractionDigits: 1 })}`}</span>
            </div>
            <Barra partes={[{ v: d.v ?? 0, color: (d.v ?? 0) >= 90 ? '#16A085' : (d.v ?? 0) >= 70 ? '#E0A100' : '#E25563' }]} total={100} />
            <p className="mt-0.5 text-[11px] text-muted">{d.detalle}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ================================ Presupuesto ================================ */

function PanelPresupuesto({ p, comp, money }: { p: MiPresupuesto; comp: Compromisos; money: (c: number) => string }) {
  if (!p.presupuesto) {
    return <Empty icon={<PiggyBank className="size-5" />} title="Aún no defines tu presupuesto">Ajusta la caja general (botón “Ajustar caja”) para ver cuánto puedes gastar todavía.</Empty>
  }
  const n = NIVEL[p.nivel]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Dato label="Presupuesto mensual" value={money(p.presupuesto)} testid="pres-presupuesto" />
        <Dato label="Gastos registrados" value={money(p.gastado)} hint={`${pctTxt(p.pctUsado)} utilizado`} testid="pres-gastado" />
        <Dato label="Compromisos pendientes" value={money(p.pendiente)} hint={`${pctTxt(p.pctComprometido)} comprometido`} tone="#9A6700" testid="pres-pendiente" />
        <Dato label="Disponible presupuestario" value={money(p.disponible)} tone={p.disponible < 0 ? '#C0362C' : undefined} testid="pres-disponible" />
        <Dato label="Disponible tras compromisos" value={money(p.disponibleTrasCompromisos)} tone={p.disponibleTrasCompromisos < 0 ? '#C0362C' : '#0F7A5F'} testid="pres-tras" />
      </div>
      <div>
        <Barra partes={[{ v: p.gastado, color: n.color }, { v: p.pendiente, color: '#E0A100', rayado: true }]} total={p.presupuesto} alto="h-3" />
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: n.color }} /> Gastado</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#E0A100]" /> Compromisos pendientes</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-line" /> Libre</span>
        </div>
      </div>
      <p className="rounded-xl px-3 py-2 text-sm font-medium" style={{ color: n.color, background: n.bg }} data-testid="pres-nivel">
        {n.txt}. {p.nivel === 'excedido'
          ? `Superaste el presupuesto en ${money(-p.disponible)}.`
          : comp.pendiente ? `Después de cubrir ${money(comp.pendiente)} en compromisos te quedarían ${money(p.disponibleTrasCompromisos)}.` : `Te quedan ${money(p.disponible)} del presupuesto.`}
      </p>
      {p.cajas.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-muted">Cajas específicas (reservas dentro del presupuesto general, no se suman a él)</p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {p.cajas.map(c => (
              <li key={c.caja.id} className="rounded-xl border border-line p-3">
                <p className="flex items-center justify-between gap-2 text-sm font-semibold"><span className="truncate">{c.caja.nombre}</span>
                  <span className="tabular text-xs text-muted">{c.asignado ? pctTxt(c.pct) : 'Sin asignar'}</span></p>
                <div className="my-1.5"><Barra partes={[{ v: c.gastado, color: c.caja.color || '#1e3a8a' }, { v: c.pendiente, color: '#E0A100', rayado: true }]} total={c.asignado} /></div>
                <p className="tabular text-[11px] text-muted">Gastado {money(c.gastado)}{c.pendiente ? ` · pendiente ${money(c.pendiente)}` : ''} · de {money(c.asignado)}</p>
                <p className="tabular text-xs font-medium" style={{ color: c.disponibleTrasCompromisos < 0 ? '#C0362C' : undefined }}>Disponible tras compromisos: {money(c.disponibleTrasCompromisos)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-muted">Indicadores de presupuesto calculados con la fecha real de cada gasto. No representan dinero en tu cuenta bancaria. Un pago de compromiso sube “gastado” y baja “pendiente” en el mismo monto: nunca se descuenta dos veces.</p>
    </div>
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
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
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
          <Segmented label="Nivel" value={nivel} onChange={setNivel}
            options={[{ value: 'ambito', label: 'Ámbito' }, { value: 'categoria', label: 'Categoría' }, { value: 'subcategoria', label: 'Subcategoría' }]} />
        </div>
      </div>
      <p className="text-xs text-muted" data-testid="evo-rangos">
        Del <b className="text-ink">{r(per.actual)}</b> contra del <b className="text-ink">{r(per.anterior)}</b>.
        {per.parcial && ' El mes aún no termina: se comparan los mismos días para que sea justo.'}
      </p>

      {!evo.hayHistorial ? (
        <div className="space-y-3">
          <p className="rounded-xl bg-bg px-3 py-2 text-sm text-ink" data-testid="evo-sin-historial">Aún no tienes suficiente historial para comparar meses. Continúa registrando tus gastos.</p>
          {evo.filas.length > 0 && <ListaEvolucion titulo="Análisis del período actual" icon={<Sparkles className="size-4 text-navy" />} filas={[...evo.filas].sort((a, b) => b.actual - a.actual).slice(0, 8)} money={money} soloActual />}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Dato label="Período actual" value={money(evo.totalActual)} hint={`${evo.nActual} movimientos`} />
            <Dato label="Período anterior" value={money(evo.totalAnterior)} hint={`${evo.nAnterior} movimientos`} />
            <Dato label="Diferencia" value={`${evo.totalActual - evo.totalAnterior >= 0 ? '+' : ''}${money(evo.totalActual - evo.totalAnterior)}`} tone={evo.totalActual > evo.totalAnterior ? '#C0362C' : '#0F7A5F'} />
            <Dato label="Variación" value={evo.totalAnterior ? `${(Math.round(((evo.totalActual - evo.totalAnterior) / evo.totalAnterior) * 1000) / 10).toLocaleString('es-PE')}%` : '—'} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <ListaEvolucion titulo="Aumentaron" icon={<ArrowUpRight className="size-4 text-[#C0362C]" />} filas={evo.aumentaron.slice(0, 6)} money={money} vacio="Nada aumentó." />
            <ListaEvolucion titulo="Disminuyeron" icon={<ArrowDownRight className="size-4 text-[#0F7A5F]" />} filas={evo.disminuyeron.slice(0, 6)} money={money} vacio="Nada disminuyó." />
          </div>
          {evo.nuevos.length > 0 && <ListaEvolucion titulo="Nuevos (sin base de comparación)" icon={<Sparkles className="size-4 text-navy" />} filas={evo.nuevos.slice(0, 6)} money={money} soloActual />}
          <details className="rounded-xl border border-line">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted">Ver tabla completa ({evo.filas.length})</summary>
            <div className="overflow-x-auto px-1 pb-2">
              <table className="w-full min-w-[34rem] text-xs">
                <thead className="text-left text-muted"><tr>
                  <th className="px-2 py-1 font-medium">Nombre</th><th className="px-2 py-1 text-right font-medium">Actual</th><th className="px-2 py-1 text-right font-medium">Anterior</th>
                  <th className="px-2 py-1 text-right font-medium">Diferencia</th><th className="px-2 py-1 text-right font-medium">Variación</th>
                  <th className="px-2 py-1 text-right font-medium">Mov.</th><th className="px-2 py-1 text-right font-medium">Promedio</th>
                </tr></thead>
                <tbody>{evo.filas.map(f => (
                  <tr key={f.key} className="border-t border-line/70">
                    <td className="px-2 py-1">{f.nombre}{f.detalle && <span className="text-muted"> · {f.detalle}</span>}</td>
                    <td className="tabular px-2 py-1 text-right">{money(f.actual)}</td><td className="tabular px-2 py-1 text-right">{money(f.anterior)}</td>
                    <td className="tabular px-2 py-1 text-right">{money(f.diferencia)}</td><td className="tabular px-2 py-1 text-right">{f.variacion === null ? 'Sin base' : variacionTxt(f)}</td>
                    <td className="tabular px-2 py-1 text-right">{f.nActual} / {f.nAnterior}</td><td className="tabular px-2 py-1 text-right">{money(f.promedioActual)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </>
      )}

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink"><Lightbulb className="size-4 text-[#E0A100]" /> Oportunidades de ahorro <span className="rounded-full bg-bg px-2 py-0.5 text-[10px] font-medium text-muted">Simulación</span></p>
        {ahorro.length === 0 ? <p className="text-xs text-muted">No hay gastos discrecionales relevantes (delivery, antojos, suscripciones, salidas o compras no esenciales) en el período.</p> : (
          <ul className="grid gap-2 md:grid-cols-2" data-testid="ahorro">
            {ahorro.map(o => (
              <li key={o.key} className="rounded-xl border border-line p-3 text-sm">
                <p>Durante el período analizado gastaste <b className="tabular">{money(o.cents)}</b> en <b>{o.nombre}</b>{o.nombre !== o.categoria ? ` (${o.categoria})` : ''}.
                  {' '}Una reducción hipotética del {Math.round(REDUCCION_SIMULADA * 100)} % representaría <b className="tabular text-[#0F7A5F]">{money(o.ahorro)}</b> de ahorro.</p>
                <p className="mt-1 text-[11px] text-muted">{o.count} movimiento{o.count === 1 ? '' : 's'}{o.variacion !== null ? ` · ${o.variacion > 0 ? 'subió' : 'bajó'} ${Math.abs(o.variacion).toLocaleString('es-PE')} % frente al período anterior` : ''}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted">Solo se sugieren gastos discrecionales con datos reales del período. Nunca se sugiere reducir leche, pañales, medicamentos, consultas médicas ni servicios esenciales.</p>
      </div>
    </div>
  )
}

function ListaEvolucion({ titulo, icon, filas, money, vacio, soloActual }: { titulo: string; icon: ReactNode; filas: FilaEvolucion[]; money: (c: number) => string; vacio?: string; soloActual?: boolean }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">{icon}{titulo}</p>
      {!filas.length ? <p className="text-xs text-muted">{vacio}</p> : (
        <ul className="space-y-1.5">
          {filas.map(f => (
            <li key={f.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0"><span className="block truncate font-medium">{f.nombre}</span>
                <span className="block truncate text-[11px] text-muted">{f.detalle ? `${f.detalle} · ` : ''}{soloActual ? `${f.nActual} mov. · prom. ${money(f.promedioActual)}` : `${money(f.anterior)} → ${money(f.actual)}`}</span></span>
              <span className="shrink-0 text-right">
                <span className="tabular block font-semibold">{soloActual ? money(f.actual) : `${f.diferencia > 0 ? '+' : ''}${money(f.diferencia)}`}</span>
                {!soloActual && <span className={`tabular block text-[11px] font-medium ${f.diferencia > 0 ? 'text-[#C0362C]' : 'text-[#0F7A5F]'}`}>{variacionTxt(f)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ================================ Compromisos ================================ */

function PanelCompromisos({ store, comp, money, fmt, filters, vinculos, loaded, onEditGasto, onGastosMensuales }: {
  store: AppStore; comp: Compromisos; money: (c: number) => string; fmt?: string; filters: Filters; vinculos: Map<string, string>; loaded: boolean
  onEditGasto: (g: Gasto) => void; onGastosMensuales: () => void
}) {
  const [asociar, setAsociar] = useState<Plantilla | null>(null)
  if (!loaded && !comp.n) return <p className="text-sm text-muted">Cargando plantillas…</p>
  if (!comp.n) {
    return (
      <Empty icon={<Repeat className="size-5" />} title="Aún no tienes compromisos">
        <span className="block">En “Gastos mensuales”, edita una plantilla (Luz, Internet, Apoyo familiar…) y activa “Es un compromiso mensual”.</span>
        <Button variant="soft" className="mt-3" onClick={onGastosMensuales}>Abrir Gastos mensuales</Button>
      </Empty>
    )
  }
  const quitar = (g: Gasto) => store.track(`vinculo:${g.id}`, { pending: 'Quitando vínculo…', ok: 'Vínculo quitado. El gasto no cambió.', error: 'No se pudo quitar el vínculo.' },
    () => store.actions.vincular(g.id, ''))
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Dato label="Total previsto" value={money(comp.previsto)} testid="comp-previsto" />
        <Dato label="Cubierto" value={money(comp.cubierto)} tone="#0F7A5F" testid="comp-cubierto" />
        <Dato label="Pendiente" value={money(comp.pendiente)} tone="#9A6700" testid="comp-pendiente" />
        <Dato label="Compromisos" value={String(comp.n)} hint={comp.sinMonto ? `${comp.sinMonto} sin monto definido` : undefined} />
        <Dato label="Cubiertos" value={String(comp.nCubiertos)} />
        <Dato label="Pendientes" value={String(comp.nPendientes)} />
      </div>
      {comp.meses.length > 1 && <p className="text-[11px] text-muted">El período abarca {comp.meses.length} meses: cada compromiso se espera una vez por mes y un pago solo cubre el mes de su fecha.</p>}
      <ul className="space-y-2" aria-label="Compromisos">
        {comp.items.map(i => <FilaCompromiso key={i.plantilla.id} i={i} money={money} fmt={fmt} onAsociar={() => setAsociar(i.plantilla)} onEditGasto={onEditGasto} onQuitar={quitar} />)}
      </ul>
      {asociar && <AsociarModal store={store} plantilla={asociar} filters={filters} vinculos={vinculos} money={money} fmt={fmt} onClose={() => setAsociar(null)} />}
    </div>
  )
}

function FilaCompromiso({ i, money, fmt, onAsociar, onEditGasto, onQuitar }: {
  i: CompromisoItem; money: (c: number) => string; fmt?: string; onAsociar: () => void; onEditGasto: (g: Gasto) => void; onQuitar: (g: Gasto) => void
}) {
  const estado = i.previsto === null ? { txt: 'Sin monto', color: 'var(--muted)', Icon: CircleDashed }
    : i.cubiertoCompleto ? { txt: 'Cubierto', color: '#0F7A5F', Icon: CheckCircle2 }
      : i.cubierto > 0 ? { txt: 'Parcial', color: '#9A6700', Icon: CircleDashed } : { txt: 'Pendiente', color: '#C2410C', Icon: CircleDashed }
  return (
    <li className="rounded-xl border border-line p-3" data-testid="compromiso">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold"><span className="truncate">{i.plantilla.descripcion}</span>
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: estado.color, background: 'var(--bg)' }}><estado.Icon className="size-3" />{estado.txt}</span></p>
          <p className="truncate text-[11px] text-muted">{i.plantilla.ambito} · {i.plantilla.categoria} · {i.plantilla.subcategoria}</p>
        </div>
        <div className="tabular text-right text-sm">
          <span className="font-semibold">{money(i.cubierto)}</span><span className="text-muted"> / {i.previsto === null ? 'sin monto' : money(i.previsto)}</span>
          {i.pendiente > 0 && <span className="block text-[11px] font-medium text-[#9A6700]">Pendiente {money(i.pendiente)}</span>}
        </div>
      </div>
      {i.previsto !== null && <div className="mt-2"><Barra partes={[{ v: i.aplicado, color: '#16A085' }]} total={i.previsto} /></div>}
      {i.pagos.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-line/70 pt-2 text-xs">
          {i.pagos.map(g => (
            <li key={g.uid ?? g.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate text-muted">{formatDate(g.fecha, fmt)} · {g.descripcion || g.subcategoria} · {g.medioPago}</span>
              <span className="flex items-center gap-1">
                <b className="tabular">{formatMoney(Math.round(g.monto * 100), g.moneda)}</b>
                <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-navy" aria-label={`Abrir ${g.descripcion || 'gasto'} del ${g.fecha}`} onClick={() => onEditGasto(g)}><ExternalLink className="size-3.5" /></button>
                <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-[#C0362C]" aria-label={`Quitar vínculo de ${g.descripcion || 'gasto'} del ${g.fecha}`} onClick={() => onQuitar(g)}><Link2Off className="size-3.5" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex justify-end">
        <Button variant="ghost" className="h-9 px-2 text-xs" onClick={onAsociar} aria-label={`Asociar un movimiento a ${i.plantilla.descripcion}`}><Link2 className="size-3.5" /> Asociar movimiento</Button>
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

function RevisionDatos({ store, c, fmt, onClose, onEditGasto }: { store: AppStore; c: CalidadDatos; fmt?: string; onClose: () => void; onEditGasto: (g: Gasto) => void }) {
  const pendientes = c.similares.filter(s => s.estado === 'sin-revisar' || s.estado === 'pendiente')
  const revisados = c.similares.filter(s => s.estado === 'legitimo' || s.estado === 'duplicado')
  const marcar = (s: GrupoSimilar, estado: EstadoRevision) => {
    const msg = { legitimo: 'Coincidencia marcada como legítima.', pendiente: 'Coincidencia marcada como pendiente de revisión.', duplicado: 'Duplicado confirmado. No se eliminó ningún movimiento.' }[estado]
    store.track(`revision:${s.ids.join(',')}`, { pending: 'Guardando revisión…', ok: msg, error: 'No se pudo guardar la revisión.' },
      () => store.actions.saveRevision({ id: s.revision?.id ?? `rev-${crypto.randomUUID()}`, ids: s.ids, estado, firma: s.clave }))
  }
  const fila = (g: Gasto, extra?: ReactNode) => (
    <li key={g.uid ?? g.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
      <span className="min-w-0">
        <span className="block truncate font-medium">{g.descripcion || g.subcategoria || '(sin descripción)'}</span>
        <span className="block truncate text-[11px] text-muted">{/^\d{4}-\d{2}-\d{2}$/.test(g.fecha) ? formatDate(g.fecha, fmt) : g.fecha || 'sin fecha'} · {g.ambito} · {g.categoria} › {g.subcategoria || '—'} · {g.medioPago}</span>
        {extra}
      </span>
      <span className="flex items-center gap-2">
        <b className="tabular">{Number.isFinite(g.monto) ? formatMoney(Math.round(g.monto * 100), g.moneda || 'PEN') : '—'}</b>
        <Button variant="outline" className="h-9 px-3 text-xs" disabled={!!g.problemaId} title={g.problemaId ? 'Su ID está repetido o es inválido: repáralo primero (repararIds en Apps Script)' : 'Abrir para revisar o corregir'}
          onClick={() => onEditGasto(g)} aria-label={`Abrir ${g.descripcion || 'gasto'}`}><ExternalLink className="size-3.5" /> Abrir</Button>
      </span>
    </li>
  )
  return (
    <Modal open onClose={onClose} size="xl" title="Revisar datos" subtitle="Nada se modifica automáticamente: abre cada movimiento para corregirlo o marca las coincidencias." icon={<ListChecks className="size-5" />}>
      <div className="space-y-5">
        <Seccion titulo="Posibles duplicados" n={pendientes.length} icon={<AlertTriangle className="size-4 text-[#E0A100]" />}>
          {!c.similares.length ? <p className="text-xs text-muted">No se encontraron movimientos similares.</p> : (
            <div className="space-y-3">
              {[...pendientes, ...revisados].map(s => (
                <div key={s.ids.join(',')} className="rounded-xl border border-line p-3" data-testid="grupo-similar">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm">Se encontraron <b>{s.gastos.length} movimientos similares</b>. Revisa si corresponden a operaciones diferentes.</p>
                    <EstadoChip estado={s.estado} />
                  </div>
                  <ul className="divide-y divide-line/60">{s.gastos.map(g => fila(g))}</ul>
                  <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-end">
                    <Button variant={s.estado === 'legitimo' ? 'soft' : 'outline'} className="h-9 text-xs" onClick={() => marcar(s, 'legitimo')}><CheckCircle2 className="size-3.5" /> Son legítimos</Button>
                    <Button variant="outline" className="h-9 text-xs" onClick={() => marcar(s, 'pendiente')}><CircleDashed className="size-3.5" /> Dejar pendiente</Button>
                    <Button variant="outline" className="h-9 text-xs" onClick={() => marcar(s, 'duplicado')}><AlertTriangle className="size-3.5" /> Confirmar duplicado</Button>
                  </div>
                  {s.estado === 'duplicado' && <p className="mt-1 text-[11px] text-muted">Confirmado como duplicado: resta puntos de calidad. No se eliminó nada; si sobra un registro, ábrelo y elimínalo tú.</p>}
                </div>
              ))}
            </div>
          )}
        </Seccion>
        <Seccion titulo="Integridad" n={c.conProblemas.length} icon={<ShieldCheck className="size-4 text-navy" />}>
          {!c.conProblemas.length ? <p className="text-xs text-muted">Todos los movimientos tienen ID, fecha, monto, moneda, clasificación, medio y estado válidos.</p> : (
            <ul className="divide-y divide-line/60">{c.conProblemas.slice(0, 100).map(x => fila(x.gasto,
              <span className="mt-0.5 flex flex-wrap gap-1">{x.problemas.map(p => <span key={p} className="rounded-full bg-[#FDECEC] px-1.5 py-0.5 text-[10px] font-medium text-[#C0362C]">{PROBLEMA_TXT[p]}</span>)}</span>))}</ul>
          )}
        </Seccion>
        <Seccion titulo="Clasificación" n={c.invalidas.length} icon={<ListChecks className="size-4 text-morado" />}>
          {!c.invalidas.length ? <p className="text-xs text-muted">Todas las clasificaciones existen en el catálogo (o son históricas reconocidas).</p> : (
            <ul className="divide-y divide-line/60">{c.invalidas.slice(0, 100).map(x => fila(x.gasto, <span className="block text-[11px] text-[#C0362C]">{x.c.motivo}{x.c.sugerencia ? ` Sugerencia: ${x.c.sugerencia.ambito} › ${x.c.sugerencia.categoria} › ${x.c.sugerencia.subcategoria}.` : ''}</span>))}</ul>
          )}
          {c.historicas.length > 0 && (
            <details className="mt-2 rounded-xl bg-bg px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted">{c.historicas.length} clasificación(es) histórica(s) reconocida(s): válidas, no restan puntos</summary>
              <ul className="divide-y divide-line/60">{c.historicas.slice(0, 100).map(x => fila(x.gasto, <span className="block text-[11px] text-muted">{x.c.motivo}</span>))}</ul>
            </details>
          )}
        </Seccion>
        <Seccion titulo="Catálogo" n={c.catalogo.length} icon={<ListChecks className="size-4 text-turquesa" />}>
          {!c.catalogo.length ? <p className="text-xs text-muted">El catálogo y los medios de pago no tienen repeticiones ni opciones huérfanas.</p> : (
            <ul className="list-disc space-y-1 pl-5 text-sm">{c.catalogo.map((x, i) => <li key={i}>{x.texto}</li>)}</ul>
          )}
        </Seccion>
      </div>
    </Modal>
  )
}

function Seccion({ titulo, n, icon, children }: { titulo: string; n: number; icon: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={titulo}>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">{icon}{titulo}
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${n ? 'bg-[#FFF6DB] text-[#9A6700]' : 'bg-[#E7F7F2] text-[#0F7A5F]'}`}>{n ? `${n} por revisar` : 'Sin alertas'}</span></h3>
      {children}
    </section>
  )
}

function EstadoChip({ estado }: { estado: GrupoSimilar['estado'] }) {
  const m = {
    'sin-revisar': { t: 'Sin revisar', c: '#9A6700', b: '#FFF6DB' }, pendiente: { t: 'Pendiente de revisión', c: '#9A6700', b: '#FFF6DB' },
    legitimo: { t: 'Legítimos', c: '#0F7A5F', b: '#E7F7F2' }, duplicado: { t: 'Duplicado confirmado', c: '#C0362C', b: '#FDECEC' },
  }[estado]
  return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: m.c, background: m.b }} data-testid="estado-grupo">{m.t}</span>
}
