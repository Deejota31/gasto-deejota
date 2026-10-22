import { useId, useState, type ReactNode } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, CircleDollarSign, Layers } from 'lucide-react'
import type { PresupuestoResumen } from '../lib/engine'
import { describirCobertura } from '../lib/presupuesto'
import { fondoLook, soft, type Look } from '../lib/visual'
import { ESTADO } from './PresupuestoConsolidado'

/**
 * Acordeones compactos bajo el Presupuesto consolidado del Dashboard: los fondos del presupuesto y, si hay varios fondos con
 * la misma cobertura, su presupuesto combinado. Empiezan cerrados; no editan nada (eso vive en Presupuestos) ni consultan nada.
 */
export function ResumenFondos({ p, money, onIrPresupuestos }: { p: PresupuestoResumen; money: (n: number) => string; onIrPresupuestos?: () => void }) {
  const [abierto, setAbierto] = useState<{ fondos: boolean; grupos: boolean }>({ fondos: false, grupos: false })
  const lista = p.fondos.filter(r => r.aplicada || !r.fondo.activo)
  const nombres = new Map(p.fondos.map(r => [r.fondo.id, r.fondo.nombre]))
  const grupos = p.grupos.filter(g => g.fondos.length > 1)
  const link = onIrPresupuestos && (
    <button type="button" onClick={onIrPresupuestos} className="inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline">
      Administrar presupuestos <ChevronRight className="size-3.5" />
    </button>
  )
  const extra = [p.desbordados ? `${p.desbordados} con excedente` : '', p.sobregirados ? `${p.sobregirados} sobregirado${p.sobregirados === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
  return (
    <div className={`grid items-start gap-3 ${grupos.length ? 'lg:grid-cols-2' : ''}`} data-testid="resumen-fondos">
      <Acordeon icon={<CircleDollarSign className="size-4" />} color="var(--success)" titulo="Fondos del presupuesto"
        resumen={`${p.activos} activo${p.activos === 1 ? '' : 's'} · ${money(p.total)}${extra ? ` · ${extra}` : ''}`}
        open={abierto.fondos} onToggle={() => setAbierto(x => ({ ...x, fondos: !x.fondos }))}>
        {lista.length ? (
          <ul className="divide-y divide-line/70" aria-label="Fondos del período">
            {lista.map(r => (
              <Fila key={r.fondo.id} look={fondoLook(r.fondo, p.fondos.map(x => x.fondo))} nombre={r.fondo.nombre}
                detalle={r.fondo.activo ? describirCobertura(r.regla) : 'Inactivo · no suma'} apagada={!r.fondo.activo}
                etiqueta={r.enviado > 0 ? <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }} data-testid="desborde">
                  Excedente {money(r.enviado)} <ArrowRight className="size-2.5" /> {r.destinos.map(d => nombres.get(d) ?? d).join(', ')}</span> : null}
                cols={[['Asignado', money(r.asignado)], ['Gastado', money(r.gastado)], ['Disponible', r.fondo.activo ? money(r.disponible) : '—', r.disponible < 0 && r.fondo.activo ? ESTADO.alerta : undefined]]} />
            ))}
          </ul>
        ) : <p className="py-2 text-xs text-muted">Aún no tienes fondos aplicados en este período.</p>}
        {p.sinFondo.count > 0 && <p className="mt-2 text-[11px]" style={{ color: 'var(--warning)' }}>Sin fondo asignable: {money(p.sinFondo.cents)} en {p.sinFondo.count} gasto(s).</p>}
        <div className="mt-2 flex justify-end">{link}</div>
      </Acordeon>
      {grupos.length > 0 && (
        <Acordeon icon={<Layers className="size-4" />} color="#6D5DD3" titulo="Presupuestos combinados"
          resumen={`${grupos.length} grupo${grupos.length === 1 ? '' : 's'} con la misma cobertura`}
          open={abierto.grupos} onToggle={() => setAbierto(x => ({ ...x, grupos: !x.grupos }))}>
          <ul className="divide-y divide-line/70" aria-label="Presupuestos combinados">
            {grupos.map(g => (
              <Fila key={g.clave} look={fondoLook(g.fondos[0].fondo, p.fondos.map(x => x.fondo))} nombre={describirCobertura(g.fondos[0].regla)}
                detalle={g.fondos.map(r => r.fondo.nombre).join(' + ')}
                cols={[['Combinado', money(g.asignado)], ['Gastado', money(g.gastado)], ['Disponible', money(g.asignado - g.gastado), g.gastado > g.asignado ? ESTADO.alerta : undefined]]} />
            ))}
          </ul>
          <div className="mt-2 flex justify-end">{link}</div>
        </Acordeon>
      )}
    </div>
  )
}

function Acordeon({ icon, color, titulo, resumen, open, onToggle, children }: {
  icon: ReactNode; color: string; titulo: string; resumen: string; open: boolean; onToggle: () => void; children: ReactNode
}) {
  const id = useId()
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none transition hover:bg-bg/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy/40">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ background: `${color}1A`, color }}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{titulo}</span>
          <span className="tabular block truncate text-[11px] text-muted" data-testid="acordeon-resumen">{resumen}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id={id} role="region" aria-label={titulo} hidden={!open} className="border-t border-line px-3.5 pt-1 pb-3">
        {open && children}
      </div>
    </section>
  )
}

function Fila({ look, nombre, detalle, cols, apagada, etiqueta }: { look: Look; nombre: string; detalle: string; cols: [string, string, string?][]; apagada?: boolean; etiqueta?: ReactNode }) {
  return (
    <li className={`grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${apagada ? 'opacity-60' : ''}`}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: soft(look.color), color: look.color }} aria-hidden><look.Icon className="size-3.5" /></span>
        <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{nombre}</span><span className="block truncate text-[11px] text-muted">{detalle}</span>{etiqueta}</span>
      </span>
      <dl className="tabular grid grid-cols-3 gap-3 pl-9 text-right text-[11px] sm:pl-0">
        {cols.map(([l, v, col]) => <div key={l} className="min-w-0 sm:w-24"><dt className="text-muted">{l}</dt><dd className="truncate text-xs font-semibold" style={{ color: col ?? 'var(--ink)' }}>{v}</dd></div>)}
      </dl>
    </li>
  )
}
