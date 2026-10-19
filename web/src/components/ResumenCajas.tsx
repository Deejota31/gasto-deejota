import { mediosDeFondo } from '../lib/fondoMedios'
import { useId, useState, type ReactNode } from 'react'
import { Boxes, ChevronDown, ChevronRight, CircleDollarSign } from 'lucide-react'
import type { CajasResumen } from '../lib/engine'
import type { CatalogoItem } from '../lib/types'
import { cajaLook, fondoLook, soft, type Look } from '../lib/visual'
import { ESTADO } from './PresupuestoConsolidado'

/**
 * Dos acordeones compactos bajo el Presupuesto consolidado del Dashboard: Fondos del presupuesto y Subcajas / reservas.
 * Empiezan cerrados cada vez que entras al Dashboard; no editan nada (eso vive en Cajas) ni hacen consultas propias.
 */
export function ResumenCajas({ c, money, catalogo = [], onIrCajas }: { c: CajasResumen; money: (n: number) => string; catalogo?: CatalogoItem[]; onIrCajas?: () => void }) {
  const [abierto, setAbierto] = useState<{ fondos: boolean; subcajas: boolean }>({ fondos: false, subcajas: false })
  const fondosAct = c.fondos.lista.filter(r => r.fondo.activo)
  const resumenFondos = c.origen === 'fondos'
    ? `${fondosAct.length} activo${fondosAct.length === 1 ? '' : 's'} · ${money(c.fondos.total)}`
    : `Sin fondos · ${c.general?.nombre ?? 'caja general'} ${c.presupuesto ? money(c.presupuesto) : ''}`.trim()
  const link = onIrCajas && (
    <button type="button" onClick={onIrCajas} className="inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline">
      Administrar en Cajas <ChevronRight className="size-3.5" />
    </button>
  )
  return (
    <div className="grid items-start gap-3 lg:grid-cols-2" data-testid="resumen-cajas">
      <Acordeon icon={<CircleDollarSign className="size-4" />} color="var(--success)" titulo="Fondos del presupuesto" resumen={resumenFondos}
        open={abierto.fondos} onToggle={() => setAbierto(x => ({ ...x, fondos: !x.fondos }))}>
        {c.fondos.lista.length ? (
          <ul className="divide-y divide-line/70" aria-label="Fondos del período">
            {c.fondos.lista.map(r => (
              <Fila key={r.fondo.id} look={fondoLook(r.fondo, c.fondos.lista.map(x => x.fondo))} nombre={r.fondo.nombre}
                detalle={r.fondo.activo ? (mediosDeFondo(r.fondo.medioPago).length ? `${mediosDeFondo(r.fondo.medioPago).length > 1 ? 'Medios' : 'Medio'} ${mediosDeFondo(r.fondo.medioPago).join(', ')}` : r.principal ? 'Principal' : 'Libre') : 'Inactiva · no suma'}
                apagada={!r.fondo.activo}
                cols={[['Asignado', money(r.asignado)], ['Gastado', money(r.gastado)], ['Disponible', r.fondo.activo ? money(r.disponible) : '—', r.disponible < 0 && r.fondo.activo ? ESTADO.alerta : undefined]]} />
            ))}
          </ul>
        ) : <p className="py-2 text-xs text-muted">Aún no tienes fondos: el presupuesto sale de la caja general.</p>}
        <div className="mt-2 flex justify-end">{link}</div>
      </Acordeon>
      <Acordeon icon={<Boxes className="size-4" />} color="#6D5DD3" titulo="Cajas / reservas"
        resumen={`${c.subcajas.length} activa${c.subcajas.length === 1 ? '' : 's'} · ${money(c.reservado)} reservados`}
        open={abierto.subcajas} onToggle={() => setAbierto(x => ({ ...x, subcajas: !x.subcajas }))}>
        {c.subcajas.length ? (
          <ul className="divide-y divide-line/70" aria-label="Cajas del período">
            {c.subcajas.map(s => (
              <Fila key={s.caja.id} look={cajaLook(s.caja, catalogo)} nombre={s.caja.nombre} detalle={`${s.caja.filtroCampo} · ${s.caja.filtroValor}`}
                cols={[['Reservado', s.asignado ? money(s.asignado) : '—'], ['Gastado', money(s.gastado)],
                  [s.excedido ? 'Exceso' : 'Disponible', s.asignado ? money(Math.abs(s.disponible)) : '—', s.excedido ? ESTADO.alerta : undefined]]} />
            ))}
          </ul>
        ) : <p className="py-2 text-xs text-muted">No hay cajas activas.</p>}
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

function Fila({ look, nombre, detalle, cols, apagada }: { look: Look; nombre: string; detalle: string; cols: [string, string, string?][]; apagada?: boolean }) {
  return (
    <li className={`grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${apagada ? 'opacity-60' : ''}`}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: soft(look.color), color: look.color }} aria-hidden><look.Icon className="size-3.5" /></span>
        <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{nombre}</span><span className="block truncate text-[11px] text-muted">{detalle}</span></span>
      </span>
      <dl className="tabular grid grid-cols-3 gap-3 pl-9 text-right text-[11px] sm:pl-0">
        {cols.map(([l, v, col]) => <div key={l} className="min-w-0 sm:w-24"><dt className="text-muted">{l}</dt><dd className="truncate text-xs font-semibold" style={{ color: col ?? 'var(--ink)' }}>{v}</dd></div>)}
      </dl>
    </li>
  )
}
