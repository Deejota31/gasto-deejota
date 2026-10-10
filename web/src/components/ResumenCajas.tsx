import { useId, useState, type ReactNode } from 'react'
import { Boxes, ChevronDown, ChevronRight, CircleDollarSign } from 'lucide-react'
import type { CajasResumen } from '../lib/engine'
import { ESTADO } from './PresupuestoConsolidado'

/**
 * Dos acordeones compactos bajo el Presupuesto consolidado del Dashboard: Fuentes de dinero y Subcajas / reservas.
 * Empiezan cerrados cada vez que entras al Dashboard; no editan nada (eso vive en Cajas) ni hacen consultas propias.
 */
export function ResumenCajas({ c, money, onIrCajas }: { c: CajasResumen; money: (n: number) => string; onIrCajas?: () => void }) {
  const [abierto, setAbierto] = useState<{ fuentes: boolean; subcajas: boolean }>({ fuentes: false, subcajas: false })
  const fuentesAct = c.fuentes.lista.filter(r => r.fuente.activo)
  const resumenFuentes = c.origen === 'fuentes'
    ? `${fuentesAct.length} activa${fuentesAct.length === 1 ? '' : 's'} · ${money(c.fuentes.total)}`
    : `Sin fuentes · ${c.general?.nombre ?? 'caja general'} ${c.presupuesto ? money(c.presupuesto) : ''}`.trim()
  const link = onIrCajas && (
    <button type="button" onClick={onIrCajas} className="inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline">
      Administrar en Cajas <ChevronRight className="size-3.5" />
    </button>
  )
  return (
    <div className="grid items-start gap-3 lg:grid-cols-2" data-testid="resumen-cajas">
      <Acordeon icon={<CircleDollarSign className="size-4" />} color="#0F8A6B" titulo="Fuentes de dinero" resumen={resumenFuentes}
        open={abierto.fuentes} onToggle={() => setAbierto(x => ({ ...x, fuentes: !x.fuentes }))}>
        {c.fuentes.lista.length ? (
          <ul className="divide-y divide-line/70" aria-label="Fuentes del período">
            {c.fuentes.lista.map(r => (
              <Fila key={r.fuente.id} color={r.fuente.color} nombre={r.fuente.nombre}
                detalle={r.fuente.activo ? (r.fuente.medioPago ? `Medio ${r.fuente.medioPago}` : r.principal ? 'Principal' : 'Libre') : 'Inactiva · no suma'}
                apagada={!r.fuente.activo}
                cols={[['Asignado', money(r.asignado)], ['Gastado', money(r.gastado)], ['Disponible', r.fuente.activo ? money(r.disponible) : '—', r.disponible < 0 && r.fuente.activo ? ESTADO.alerta : undefined]]} />
            ))}
          </ul>
        ) : <p className="py-2 text-xs text-muted">Aún no tienes fuentes: el presupuesto sale de la caja general.</p>}
        <div className="mt-2 flex justify-end">{link}</div>
      </Acordeon>
      <Acordeon icon={<Boxes className="size-4" />} color="#6D5DD3" titulo="Subcajas / reservas"
        resumen={`${c.subcajas.length} activa${c.subcajas.length === 1 ? '' : 's'} · ${money(c.reservado)} reservados`}
        open={abierto.subcajas} onToggle={() => setAbierto(x => ({ ...x, subcajas: !x.subcajas }))}>
        {c.subcajas.length ? (
          <ul className="divide-y divide-line/70" aria-label="Subcajas del período">
            {c.subcajas.map(s => (
              <Fila key={s.caja.id} color={s.caja.color} nombre={s.caja.nombre} detalle={`${s.caja.filtroCampo} · ${s.caja.filtroValor}`}
                cols={[['Reservado', s.asignado ? money(s.asignado) : '—'], ['Gastado', money(s.gastado)],
                  [s.excedido ? 'Exceso' : 'Disponible', s.asignado ? money(Math.abs(s.disponible)) : '—', s.excedido ? ESTADO.alerta : undefined]]} />
            ))}
          </ul>
        ) : <p className="py-2 text-xs text-muted">No hay subcajas activas.</p>}
        <div className="mt-2 flex justify-end">{link}</div>
      </Acordeon>
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

function Fila({ color, nombre, detalle, cols, apagada }: { color: string; nombre: string; detalle: string; cols: [string, string, string?][]; apagada?: boolean }) {
  return (
    <li className={`grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${apagada ? 'opacity-60' : ''}`}>
      <span className="flex min-w-0 items-center gap-2">
        <i className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{nombre}</span><span className="block truncate text-[11px] text-muted">{detalle}</span></span>
      </span>
      <dl className="tabular grid grid-cols-3 gap-3 pl-4.5 text-right text-[11px] sm:pl-0">
        {cols.map(([l, v, col]) => <div key={l} className="min-w-0 sm:w-24"><dt className="text-muted">{l}</dt><dd className="truncate text-xs font-semibold" style={{ color: col ?? 'var(--ink)' }}>{v}</dd></div>)}
      </dl>
    </li>
  )
}
