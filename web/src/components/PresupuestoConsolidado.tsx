import { useState, type CSSProperties, type ReactNode } from 'react'
import { AlertTriangle, ArrowUpRight, CheckCircle2, Gauge, Info, Lock, Scale, Wallet } from 'lucide-react'
import type { CajasResumen } from '../lib/engine'
import { barraPresupuesto, estadoPresupuesto, type ClaveSegmento, type TonoEstado } from '../lib/presupuestoVista'
import { InfoTooltip } from './ui'

/**
 * Bloque único de "Presupuesto consolidado" del Dashboard: protagonista de la pantalla, en dos niveles.
 * No calcula nada: todo sale de `aggregate().cajas` (mismo fondo que antes, mismas cifras y mismos nombres).
 * El presupuesto usa el período completo (sin filtros de categoría, ámbito o medio), por eso su "Gastado del período"
 * puede diferir de los KPIs inferiores cuando hay filtros.
 *
 * Contrato con las pruebas: cada indicador es un `data-testid="cons-<nombre>"` con exactamente dos <p> (etiqueta, valor),
 * todos dentro de `data-testid="consolidado"`.
 */
export const ESTADO = { ok: 'var(--success)', atencion: 'var(--warning)', alerta: 'var(--danger)' }

const TONO_VAR: Record<TonoEstado, string> = { ok: ESTADO.ok, atencion: ESTADO.atencion, alerta: ESTADO.alerta, neutro: 'var(--ink)' }
// El chip de estado va sobre fondo blanco en ambos temas: colores fijos con contraste suficiente.
const CHIP: Record<TonoEstado, string> = { ok: '#0B7A5E', atencion: '#92610F', alerta: '#B42318', neutro: '#475569' }
const COLOR_GASTO = '#E8664F'
const COLOR_RESERVA = '#6D5DD3'

const idCelda = (etiqueta: string) => `cons-${etiqueta.toLowerCase().replace(/\s+/g, '-')}`

const SEGMENTO: Record<ClaveSegmento, { color: string; estilo: CSSProperties }> = {
  fuera: { color: COLOR_GASTO, estilo: { background: COLOR_GASTO } },
  cajas: { color: COLOR_RESERVA, estilo: { background: COLOR_RESERVA } },
  // Rayado: las reservas sin usar se distinguen también por textura, no solo por color.
  reservas: { color: COLOR_RESERVA, estilo: { background: `repeating-linear-gradient(135deg, color-mix(in srgb, ${COLOR_RESERVA} 55%, transparent) 0 4px, color-mix(in srgb, ${COLOR_RESERVA} 14%, transparent) 4px 8px)` } },
  libre: { color: 'var(--success)', estilo: { background: 'color-mix(in srgb, var(--success) 40%, transparent)' } },
}

/** Métrica complementaria (nivel 4): promedio diario, promedio por movimiento, mayor gasto y movimientos. */
export type Complementario = { etiqueta: string; valor: string; pista?: string; info: ReactNode; icono: ReactNode; color?: string }

/** Escritorio: 4 por fila; tablet y móvil (≥ 360 px): 2; menos: 1. */
const REJILLA = 'grid grid-cols-1 gap-px border-line bg-line min-[360px]:grid-cols-2 lg:grid-cols-4'

/** Icono de indicador: mismo recuadro tintado (color semántico del indicador) en los ocho indicadores. */
function IconoIndicador({ icono, color }: { icono: ReactNode; color: string }) {
  return (
    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl transition-colors [&>svg]:size-[18px]" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>{icono}</span>
  )
}

export function PresupuestoConsolidado({ c, money, periodo, accion, complementarios }: { c: CajasResumen; money: (n: number) => string; periodo: string; accion?: ReactNode; complementarios?: Complementario[] }) {
  const P = c.presupuesto
  const def = P > 0 || c.origen === 'fondos'
  const v = (n: number) => (def ? money(n) : '—')
  const estado = estadoPresupuesto(c, money)
  const origen = c.origen === 'fondos'
    ? `${c.fondos.activas} fondo${c.fondos.activas === 1 ? '' : 's'} activa${c.fondos.activas === 1 ? '' : 's'}`
    : `Desde ${c.general?.nombre ?? 'la caja general'}`
  const tonoSaldo = (n: number) => (def ? (n < 0 ? ESTADO.alerta : ESTADO.ok) : undefined)
  const IconoEstado = estado.tono === 'ok' ? CheckCircle2 : estado.tono === 'neutro' ? Info : AlertTriangle

  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04),0_8px_24px_rgb(15_23_42/0.05)]" aria-label="Presupuesto consolidado" data-testid="caja-general">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-[linear-gradient(120deg,#294690,#4F6FC8)] px-4 py-3.5 text-white sm:px-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/15"><Lock className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-base font-semibold">Presupuesto consolidado</h2>
            <span className="rounded-full bg-white/15 [&_button]:text-white [&_button:hover]:bg-white/20">
              <InfoTooltip title="Cómo se calcula" align="left">
                <p>Presupuesto consolidado = suma de lo que aportan los fondos activos del período (sin fondos: la caja general). Es el 100 % contra el que se mide todo lo demás.</p>
                <p><b>Gastado:</b> todos los gastos activos del período, cada uno una sola vez. No usa los filtros de ámbito, categoría, subcategoría, medio ni tipo.</p>
                <p><b>Reservado en cajas:</b> lo asignado a las cajas activas. Es una parte del presupuesto, no dinero adicional.</p>
                <p><b>Disponible consolidado</b> = presupuesto − gastado. <b>Saldo libre</b> = libre inicial − gastado fuera de reservas − excesos de cajas. Siempre se cumple: disponible = saldo libre + reservas sin utilizar.</p>
                <p><b>Consumido</b> = gastado ÷ presupuesto. Pasa de 100 % cuando se excede.</p>
              </InfoTooltip>
            </span>
          </div>
          <p className="truncate text-xs text-white/75" data-testid="consolidado-subtitulo">{origen} · {periodo}</p>
        </div>
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold" style={{ color: CHIP[estado.tono] }} data-testid="consolidado-estado" data-tono={estado.tono}>
          <IconoEstado className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{estado.etiqueta}</span>
        </span>
        {accion}
      </div>

      <div data-testid="consolidado">
        {/* Cifras clave en una línea (sin tarjetas): presupuesto, gastado, disponible y reservado. */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-4 pt-3 sm:px-5" data-testid="consolidado-resumen">
          <Cifra etiqueta="Presupuesto consolidado" valor={v(P)} />
          <Cifra etiqueta="Gastado del período" valor={money(c.gastadoPeriodo)} color={COLOR_GASTO} />
          <Cifra etiqueta="Disponible consolidado" valor={v(c.disponible)} color={def ? (c.disponible < 0 ? ESTADO.alerta : ESTADO.ok) : undefined} testidValor="disponible-consolidado" />
          <Cifra etiqueta="Reservado en cajas" valor={money(c.reservado)} color={COLOR_RESERVA} />
        </div>

        {/* Distribución */}
        <Barra c={c} money={money} />

        {/* Ocho indicadores con el mismo diseño: icono | título + ⓘ / valor */}
        <div className={`${REJILLA} border-t`} data-testid="indicadores">
          <Indicador etiqueta="Libre inicial" icono={<Wallet />} valor={v(c.libreInicial)} color={def && c.libreInicial < 0 ? ESTADO.alerta : undefined} tinte="var(--color-navy)"
            info="Presupuesto consolidado − reservado en cajas: lo que queda sin asignar a ninguna caja antes de gastar." />
          <Indicador etiqueta="Gastado fuera de reservas" icono={<ArrowUpRight />} valor={money(c.gastadoLibre)} color={COLOR_GASTO}
            info="Gastos que no caen en ninguna caja activa. Cada gasto cae como máximo en una caja." />
          <Indicador etiqueta="Saldo libre actual" icono={<Scale />} valor={v(c.saldoLibre)} color={tonoSaldo(c.saldoLibre)} tinte={tonoSaldo(c.saldoLibre) ?? 'var(--muted)'}
            info={<><p>Libre inicial − gastado fuera de reservas − excesos de cajas (lo que una caja gastó por encima de lo asignado).</p>
              <p>Es lo que queda sin comprometer en reservas. Se diferencia del disponible consolidado porque no cuenta las reservas sin utilizar.</p></>} />
          <Indicador etiqueta="Consumido" icono={<Gauge />} valor={c.pct === null ? '—' : `${c.pct}%`} color={c.pct === null ? undefined : TONO_VAR[estado.tono]}
            info="Gastado del período ÷ presupuesto consolidado. Menos de 70 %: holgado; desde 70 %: cerca del límite; más de 100 %: presupuesto excedido."
            barra={c.pct === null ? undefined : { pct: c.pct, color: TONO_VAR[estado.tono] }} />
        </div>
        {/* Segunda fila: complementarios (responden a los filtros, a diferencia del presupuesto). */}
        {complementarios && complementarios.length > 0 && (
          <div className={`${REJILLA} border-t`} data-testid="kpis">
            {complementarios.map(k => <Indicador key={k.etiqueta} {...k} testid={`kpi-${k.etiqueta.toLowerCase().replace(/\s+/g, '-')}`} />)}
          </div>
        )}
      </div>

      {c.sobreasignado && (
        <p className="flex items-center gap-1.5 border-t border-line px-4 py-2.5 text-xs font-medium sm:px-5" style={{ color: ESTADO.atencion }}>
          <AlertTriangle className="size-3.5 shrink-0" /> Las reservas ({money(c.reservado)}) superan el presupuesto consolidado.
        </p>
      )}
    </section>
  )
}

/** Cifra clave en línea (sin tarjeta). Mantiene el contrato de dos <p> (etiqueta, valor) con `data-testid="cons-…"`. */
function Cifra({ etiqueta, valor, color, testidValor }: { etiqueta: string; valor: string; color?: string; testidValor?: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5" data-testid={idCelda(etiqueta)}>
      <p className="truncate text-xs text-muted">{etiqueta}</p>
      <p className="tabular text-sm font-bold" style={{ color: color ?? 'var(--ink)' }} data-testid={testidValor}>{valor}</p>
    </div>
  )
}

/**
 * Indicador único para los ocho: [icono] [título ⓘ] / [valor] [subtítulo]. El icono queda a la izquierda de TODO el bloque de
 * texto y centrado en vertical; el ⓘ va a la derecha de la fila del título. Altura mínima común para que las filas queden parejas.
 * Contrato: etiqueta y valor son los dos primeros <p> hermanos (e2e y Salud financiera los leen así).
 */
function Indicador({ etiqueta, icono, valor, color, tinte, info, pista, barra, testid }: {
  etiqueta: string; icono: ReactNode; valor: string; color?: string; tinte?: string; info: ReactNode; pista?: string; barra?: { pct: number; color: string }; testid?: string
}) {
  return (
    <div className="flex min-h-[4.5rem] min-w-0 items-center gap-2.5 bg-card px-3 py-2.5 transition-colors hover:bg-bg sm:gap-3 sm:px-4" data-testid={testid ?? idCelda(etiqueta)}>
      <IconoIndicador icono={icono} color={tinte ?? color ?? 'var(--muted)'} />
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1">
        <p className="line-clamp-2 text-xs leading-tight text-muted">{etiqueta}</p>
        <span className="-mr-1.5"><InfoTooltip title={etiqueta}>{typeof info === 'string' ? <p>{info}</p> : info}</InfoTooltip></span>
        <p className="tabular col-span-2 truncate text-base leading-snug font-semibold" style={{ color: color ?? 'var(--ink)' }} title={valor}>{valor}</p>
        {pista && <span className="col-span-2 block truncate text-[11px] leading-tight text-muted" title={pista}>{pista}</span>}
        {barra && (
          <span className="col-span-2 mt-1 block h-1 overflow-hidden rounded-full bg-bg" role="progressbar" aria-label="Consumido" aria-valuenow={barra.pct} aria-valuemin={0} aria-valuemax={100}>
            <span className="bar-grow block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, barra.pct))}%`, background: barra.color }} />
          </span>
        )}
      </div>
    </div>
  )
}

/** Barra segmentada: cada tramo tiene color, textura, tooltip (nombre, importe y % del presupuesto) y entrada en la leyenda. */
function Barra({ c, money }: { c: CajasResumen; money: (n: number) => string }) {
  const [foco, setFoco] = useState<ClaveSegmento | null>(null)
  const b = barraPresupuesto(c)
  if (!b.segmentos.length) return null
  const visibles = b.segmentos.filter(s => s.valor > 0)
  let acumulado = 0
  const centros = new Map<ClaveSegmento, number>()
  for (const s of visibles) { centros.set(s.clave, acumulado + s.ancho / 2); acumulado += s.ancho }
  const pctTxt = (n: number | null) => (n === null ? '' : `${n.toLocaleString('es-PE', { maximumFractionDigits: 1 })} %`)
  const alinear = (clave: ClaveSegmento) => {
    const x = centros.get(clave) ?? 50
    return x < 22 ? 'left-0' : x > 78 ? 'right-0' : 'left-1/2 -translate-x-1/2'
  }
  return (
    <div className="border-t border-line px-4 py-3 sm:px-5" data-testid="barra-presupuesto">
      <div className="relative">
        <div role="group" aria-label="Distribución del presupuesto consolidado" className="flex h-3.5 rounded-full bg-bg ring-1 ring-line"
          onKeyDown={e => { if (e.key === 'Escape') setFoco(null) }}>
          {visibles.map((s, i) => (
            <div key={s.clave} className="relative h-full" style={{ width: `${s.ancho}%`, minWidth: 4 }}>
              <div tabIndex={0} role="img" aria-label={`${s.nombre}: ${money(s.valor)}`} data-segmento={s.clave}
                onMouseEnter={() => setFoco(s.clave)} onMouseLeave={() => setFoco(null)} onFocus={() => setFoco(s.clave)} onBlur={() => setFoco(null)}
                className={`bar-grow h-full w-full outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-navy ${i === 0 ? 'rounded-l-full' : ''} ${i === visibles.length - 1 ? 'rounded-r-full' : ''} ${foco && foco !== s.clave ? 'opacity-40' : ''}`}
                style={SEGMENTO[s.clave].estilo} />
              {foco === s.clave && (
                <div role="tooltip" className={`pointer-events-none absolute bottom-full z-20 mb-2 w-max max-w-56 rounded-xl border border-line bg-card px-2.5 py-1.5 text-xs shadow-lg ${alinear(s.clave)}`}>
                  <span className="block font-semibold text-ink">{s.nombre}</span>
                  <span className="tabular block text-muted">{money(s.valor)} · {pctTxt(s.pctPresupuesto)} del presupuesto</span>
                </div>
              )}
            </div>
          ))}
        </div>
        {b.limite !== null && (
          <span className="pointer-events-none absolute -top-1 -bottom-1 w-0 border-l-2 border-dashed" style={{ left: `${b.limite}%`, borderColor: ESTADO.alerta }} title="Límite del presupuesto" data-testid="barra-limite" />
        )}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted" aria-label="Leyenda de la distribución">
        {b.segmentos.map(s => (
          <li key={s.clave} className="flex items-center gap-1.5" onMouseEnter={() => s.valor > 0 && setFoco(s.clave)} onMouseLeave={() => setFoco(null)}>
            <i className="size-2.5 rounded-full ring-1 ring-line" style={SEGMENTO[s.clave].estilo} />
            {s.nombre} <b className="tabular font-semibold text-ink">{pctTxt(s.pctPresupuesto)}</b>
          </li>
        ))}
        {b.limite !== null && (
          <li className="flex items-center gap-1.5 font-medium" style={{ color: ESTADO.alerta }}>
            <i className="h-3 w-0 border-l-2 border-dashed" style={{ borderColor: ESTADO.alerta }} /> Límite del presupuesto
          </li>
        )}
      </ul>
    </div>
  )
}
