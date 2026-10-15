import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, formatDate, monthLabel, shiftMonth, todayIn } from '../lib/dates'
import { acotar, cuadriculaDelMes, DIAS_CORTOS, fechaLarga, MESES, MESES_CORTOS, moverMeses, nombreMes } from '../lib/calendario'
import { usePopover } from './Combobox'
import { controlCls } from './ui'

/**
 * Calendario único de la aplicación (día, rango y mes). Todo es texto AAAA-MM-DD / AAAA-MM: no hay conversiones de zona
 * horaria, así que una fecha nunca se corre un día. La semana empieza en lunes. Teclado: flechas (±1 día, ±1 semana),
 * Re Pág / Av Pág (mes), Inicio / Fin (semana), Enter selecciona, Esc cierra.
 */
type Vista = 'dias' | 'meses' | 'anios'

const celda = 'grid size-9 place-items-center rounded-lg text-[13px] tabular outline-none transition focus-visible:ring-2 focus-visible:ring-navy/50 disabled:cursor-not-allowed disabled:opacity-30'
const sel = 'bg-navy font-semibold text-white dark:text-[#0E1525]'

export interface CalendarioProps {
  modo: 'dia' | 'rango' | 'mes'
  /** dia: fecha elegida · mes: AAAA-MM elegido. */
  value?: string
  desde?: string
  hasta?: string
  today: string
  min?: string
  max?: string
  onDia?: (iso: string) => void
  onRango?: (desde: string, hasta: string) => void
  onMes?: (periodo: string) => void
  /** Se llama al elegir un día / mes definitivo (para cerrar el desplegable). */
  onListo?: () => void
}

export function Calendario({ modo, value, desde, hasta, today, min, max, onDia, onRango, onMes, onListo }: CalendarioProps) {
  const base = modo === 'mes' ? (value ? `${value}-01` : `${today.slice(0, 7)}-01`) : (modo === 'rango' ? desde : value) || today
  const [vista, setVista] = useState<Vista>(modo === 'mes' ? 'meses' : 'dias')
  const [mes, setMes] = useState(base.slice(0, 7))
  const [anio, setAnio] = useState(Number(base.slice(0, 4)))
  const [foco, setFoco] = useState(acotar(base, min, max))
  const [ancla, setAncla] = useState<string | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const enfocar = useRef(false)
  const celdas = useMemo(() => cuadriculaDelMes(mes), [mes])
  const fuera = (iso: string) => (!!min && iso < min) || (!!max && iso > max)
  const mesFuera = (p: string) => (!!min && `${p}-31` < min) || (!!max && `${p}-01` > max)

  useLayoutEffect(() => {
    if (!enfocar.current || vista !== 'dias') return
    enfocar.current = false
    grid.current?.querySelector<HTMLElement>(`[data-iso="${foco}"]`)?.focus()
  }, [foco, mes, vista])

  const irA = (iso: string) => { const f = acotar(iso, min, max); enfocar.current = true; setFoco(f); setMes(f.slice(0, 7)) }
  const elegirDia = (iso: string) => {
    if (fuera(iso)) return
    setFoco(iso)
    if (modo === 'dia') { onDia?.(iso); onListo?.(); return }
    if (!ancla) { setAncla(iso); onRango?.(iso, iso) } else { const [a, b] = iso < ancla ? [iso, ancla] : [ancla, iso]; setAncla(null); onRango?.(a, b) }
  }
  const teclas = (e: React.KeyboardEvent) => {
    const mov: Record<string, string> = {
      ArrowLeft: addDays(foco, -1), ArrowRight: addDays(foco, 1), ArrowUp: addDays(foco, -7), ArrowDown: addDays(foco, 7),
      PageUp: moverMeses(foco, -1), PageDown: moverMeses(foco, 1),
      Home: addDays(foco, -((new Date(`${foco}T00:00:00Z`).getUTCDay() + 6) % 7)), End: addDays(foco, 6 - ((new Date(`${foco}T00:00:00Z`).getUTCDay() + 6) % 7)),
    }
    if (mov[e.key]) { e.preventDefault(); irA(mov[e.key]) }
  }
  const elegirMes = (m: number) => {
    const p = `${anio}-${String(m + 1).padStart(2, '0')}`
    if (mesFuera(p)) return
    if (modo === 'mes') { onMes?.(p); onListo?.(); return }
    setMes(p); setFoco(acotar(`${p}-${String(Math.min(Number(foco.slice(8, 10)), 28)).padStart(2, '0')}`, min, max)); setVista('dias')
  }
  const enRango = (iso: string) => modo === 'rango' && !!desde && !!hasta && iso >= desde && iso <= hasta
  const eleg = (iso: string) => (modo === 'dia' ? iso === value : modo === 'rango' ? iso === desde || iso === hasta : false)

  const cab = 'grid size-8 place-items-center rounded-lg text-muted transition hover:bg-bg hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-navy/50'
  const titulo = vista === 'dias' ? nombreMes(mes) : vista === 'meses' ? String(anio) : `${Math.floor(anio / 12) * 12} – ${Math.floor(anio / 12) * 12 + 11}`
  const prev = () => (vista === 'dias' ? irA0(shiftMonth(mes, -1)) : setAnio(a => a - (vista === 'anios' ? 12 : 1)))
  const next = () => (vista === 'dias' ? irA0(shiftMonth(mes, 1)) : setAnio(a => a + (vista === 'anios' ? 12 : 1)))
  const irA0 = (p: string) => { setMes(p); setAnio(Number(p.slice(0, 4))) }

  return (
    <div className="w-[17.5rem] max-w-full select-none" data-testid="calendario">
      <div className="mb-2 flex items-center gap-1">
        <button type="button" className={cab} aria-label={vista === 'dias' ? 'Mes anterior' : vista === 'meses' ? 'Año anterior' : 'Años anteriores'} onClick={prev}><ChevronLeft className="size-4" /></button>
        <button type="button" aria-live="polite"
          aria-label={vista === 'dias' ? `${titulo}: elegir mes o año` : vista === 'meses' ? `${titulo}: elegir año` : titulo}
          onClick={() => { if (vista === 'dias') { setAnio(Number(mes.slice(0, 4))); setVista('meses') } else if (vista === 'meses') setVista('anios') }}
          className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg text-sm font-semibold transition hover:bg-bg outline-none focus-visible:ring-2 focus-visible:ring-navy/50">
          {titulo}{vista !== 'anios' && <ChevronDown className="size-3.5 text-muted" aria-hidden />}
        </button>
        <button type="button" className={cab} aria-label={vista === 'dias' ? 'Mes siguiente' : vista === 'meses' ? 'Año siguiente' : 'Años siguientes'} onClick={next}><ChevronRight className="size-4" /></button>
      </div>

      {vista === 'dias' && (
        <div role="grid" aria-label={nombreMes(mes)} ref={grid} onKeyDown={teclas}>
          <div role="row" className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-muted">
            {DIAS_CORTOS.map(d => <span key={d} role="columnheader" aria-label={d}>{d}</span>)}
          </div>
          {[0, 1, 2, 3, 4, 5].map(r => (
            <div key={r} role="row" className="grid grid-cols-7 gap-y-0.5">
              {celdas.slice(r * 7, r * 7 + 7).map(c => {
                const es = eleg(c.iso), rango = enRango(c.iso), hoy = c.iso === today, off = fuera(c.iso)
                return (
                  <button key={c.iso} type="button" role="gridcell" data-iso={c.iso} disabled={off} tabIndex={c.iso === foco ? 0 : -1}
                    aria-label={fechaLarga(c.iso)} aria-selected={es || undefined} aria-current={hoy ? 'date' : undefined} onClick={() => elegirDia(c.iso)}
                    className={`${celda} ${es ? sel : rango ? 'bg-primary-soft text-navy' : c.enMes ? 'text-ink hover:bg-bg' : 'text-muted/50 hover:bg-bg'} ${hoy && !es ? 'font-semibold text-navy ring-1 ring-navy/60' : ''}`}>
                    {c.dia}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {vista === 'meses' && (
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={`Meses de ${anio}`}>
          {MESES_CORTOS.map((nombre, i) => {
            const p = `${anio}-${String(i + 1).padStart(2, '0')}`
            const es = modo === 'mes' ? value === p : mes === p
            return (
              <button key={nombre} type="button" disabled={mesFuera(p)} aria-label={`${MESES[i]} ${anio}`} aria-pressed={es} onClick={() => elegirMes(i)}
                className={`h-10 rounded-xl text-sm transition outline-none focus-visible:ring-2 focus-visible:ring-navy/50 disabled:cursor-not-allowed disabled:opacity-30 ${es ? sel : p === today.slice(0, 7) ? 'font-semibold text-navy ring-1 ring-navy/60' : 'hover:bg-bg'}`}>
                {nombre}
              </button>
            )
          })}
        </div>
      )}

      {vista === 'anios' && (
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Años">
          {Array.from({ length: 12 }, (_, i) => Math.floor(anio / 12) * 12 + i).map(y => {
            const actual = Number((modo === 'mes' ? value : mes)?.slice(0, 4) ?? today.slice(0, 4))
            return (
              <button key={y} type="button" aria-pressed={y === actual} onClick={() => { setAnio(y); setVista('meses') }}
                className={`h-10 rounded-xl text-sm tabular transition outline-none focus-visible:ring-2 focus-visible:ring-navy/50 ${y === actual ? sel : y === Number(today.slice(0, 4)) ? 'font-semibold text-navy ring-1 ring-navy/60' : 'hover:bg-bg'}`}>{y}</button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Desplegable anclado a un botón: portal (dentro del <dialog> si lo hay), se abre hacia arriba o abajo, nunca sale de la pantalla. */
function useDesplegable(anchor: React.RefObject<HTMLElement | null>, onClose: () => void, open: boolean) {
  const panel = useRef<HTMLDivElement>(null)
  const { pos, host } = usePopover(open, anchor, { minWidth: 296, maxWidth: 340, maxHeight: 460 })
  useEffect(() => {
    if (!open) return
    const fuera = (e: PointerEvent) => { const n = e.target as Node; if (!panel.current?.contains(n) && !anchor.current?.contains(n)) onClose() }
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [open, onClose, anchor])
  useEffect(() => {
    if (open && pos) panel.current?.querySelector<HTMLElement>('[tabindex="0"], [aria-pressed="true"], button')?.focus({ preventScroll: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, !!pos])
  return { panel, pos, host }
}

function Panel({ d, label, children, cerrar, anchor }: { d: ReturnType<typeof useDesplegable>; label: string; children: ReactNode; cerrar: () => void; anchor: React.RefObject<HTMLElement | null> }) {
  const { pos } = d
  if (!pos) return null
  return createPortal(
    <div ref={d.panel} role="dialog" aria-label={label}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); anchor.current?.focus() } }}
      style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, maxHeight: pos.maxHeight, width: 'max-content', maxWidth: 'calc(100vw - 16px)' }}
      className="fade-in z-[300] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-card p-3 text-ink shadow-xl ring-1 ring-black/5">
      {children}
    </div>, d.host())
}

const accion = 'rounded-lg px-2.5 py-1.5 text-xs font-semibold text-navy transition hover:bg-primary-soft outline-none focus-visible:ring-2 focus-visible:ring-navy/50'

/** Campo de fecha: el valor real es AAAA-MM-DD, lo que se ve usa el formato de Configuración. */
export function DatePicker({ id, value, onChange, format, min, max, invalid, label = 'Fecha', today, clearable, placeholder }: {
  id?: string; value: string; onChange: (v: string) => void; format?: string; min?: string; max?: string; invalid?: boolean; label?: string
  today?: string; clearable?: boolean; placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const hoy = today ?? todayIn()
  const cerrar = useCallback(() => setOpen(false), [])
  const d = useDesplegable(btn, cerrar, open)
  const uid = useId()
  const texto = value ? formatDate(value, format) : ''
  return (
    <div className="relative">
      <button ref={btn} id={id} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? uid : undefined} data-value={value}
        aria-label={`${label}${texto ? `: ${texto}` : ''}`} aria-invalid={invalid || undefined}
        onClick={() => setOpen(o => !o)}
        className={`${controlCls} flex items-center pr-10 text-left shadow-[0_1px_1px_rgb(15_23_42/0.04)] hover:border-navy/40 ${open ? 'border-navy ring-4 ring-navy/10' : ''} ${invalid ? 'border-danger' : ''}`}>
        <span className={`tabular truncate ${texto ? '' : 'text-muted/70'}`}>{texto || placeholder || (format || 'dd/MM/yyyy').toLowerCase()}</span>
        <CalendarDays aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
      </button>
      {open && (
        <Panel d={d} anchor={btn} cerrar={cerrar} label={`Elegir ${label.toLowerCase()}`}>
          <div id={uid}>
            <Calendario modo="dia" value={value} today={hoy} min={min} max={max} onDia={onChange} onListo={() => { cerrar(); btn.current?.focus() }} />
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
              <button type="button" className={accion} disabled={(!!min && hoy < min) || (!!max && hoy > max)} onClick={() => { onChange(hoy); cerrar(); btn.current?.focus() }}>Hoy</button>
              {clearable && value && <button type="button" className={accion} onClick={() => { onChange(''); cerrar(); btn.current?.focus() }}>Limpiar</button>}
            </div>
          </div>
        </Panel>
      )}
    </div>
  )
}

/** Campo de mes (AAAA-MM): cuadrícula de meses con cambio rápido de año. */
export function MonthPicker({ id, value, onChange, invalid, label = 'Mes', today, min, max, clearable }: {
  id?: string; value: string; onChange: (v: string) => void; invalid?: boolean; label?: string; today?: string; min?: string; max?: string; clearable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const hoy = today ?? todayIn()
  const cerrar = useCallback(() => setOpen(false), [])
  const d = useDesplegable(btn, cerrar, open)
  const texto = value ? monthLabel(value, true) : ''
  return (
    <div className="relative">
      <button ref={btn} id={id} type="button" aria-haspopup="dialog" aria-expanded={open} data-value={value}
        aria-label={`${label}${texto ? `: ${texto}` : ''}`} aria-invalid={invalid || undefined} onClick={() => setOpen(o => !o)}
        className={`${controlCls} flex items-center pr-10 text-left shadow-[0_1px_1px_rgb(15_23_42/0.04)] hover:border-navy/40 ${open ? 'border-navy ring-4 ring-navy/10' : ''} ${invalid ? 'border-danger' : ''}`}>
        <span className={`truncate ${texto ? '' : 'text-muted/70'}`}>{texto || 'Elige un mes'}</span>
        <CalendarDays aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
      </button>
      {open && (
        <Panel d={d} anchor={btn} cerrar={cerrar} label={`Elegir ${label.toLowerCase()}`}>
          <Calendario modo="mes" value={value} today={hoy} min={min} max={max} onMes={onChange} onListo={() => { cerrar(); btn.current?.focus() }} />
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <button type="button" className={accion} onClick={() => { onChange(hoy.slice(0, 7)); cerrar(); btn.current?.focus() }}>Este mes</button>
            {clearable && value && <button type="button" className={accion} onClick={() => { onChange(''); cerrar(); btn.current?.focus() }}>Limpiar</button>}
          </div>
        </Panel>
      )}
    </div>
  )
}

