import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CalendarDays, ChevronDown, Info, Loader2, Pencil, Plus, X } from 'lucide-react'
import { DatePicker } from './DatePicker'
import { useModalLayer } from '../lib/toast'
import Toaster from './Toaster'

/** Cierra un popover al hacer clic fuera o pulsar Escape. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, close])
  return ref
}

/** Icono ⓘ con explicación. Se abre con hover, foco o toque (móvil). El globo se pinta en un portal
 *  (position: fixed) para que ningún contenedor con overflow o tarjeta vecina lo tape. */
export function InfoTooltip({ title, children, align = 'right' }: { title: string; children: ReactNode; align?: 'right' | 'left' }) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const ref = useDismiss(open, () => { setOpen(false); setPinned(false) })
  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const place = () => {
      const r = btn.current!.getBoundingClientRect()
      const w = Math.min(288, window.innerWidth * 0.8)
      let left = align === 'right' ? r.right - w : r.left
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      const h = tip.current?.offsetHeight ?? 0
      // Abajo por defecto; si no cabe y arriba hay más espacio, se abre hacia arriba.
      const abajo = r.bottom + 6 + h <= window.innerHeight - 8 || r.top < window.innerHeight - r.bottom
      setPos({ top: abajo ? r.bottom + 6 : Math.max(8, r.top - 6 - h), left })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open, align])
  return (
    <div ref={ref} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => !pinned && setOpen(false)}>
      <button ref={btn} type="button" aria-label={`Información: ${title}`} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={() => { setPinned(!pinned); setOpen(!pinned) }} onFocus={() => setOpen(true)} onBlur={() => !pinned && setOpen(false)}
        className="grid size-6 cursor-help place-items-center rounded-full text-muted transition hover:bg-bg hover:text-navy focus-visible:outline-2 focus-visible:outline-navy">
        <Info className="size-4" />
      </button>
      {open && createPortal(
        <div ref={tip} id={id} role="tooltip" style={{ top: pos?.top ?? -9999, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          onMouseEnter={() => setOpen(true)} onMouseLeave={() => !pinned && setOpen(false)}
          className="fixed z-[200] w-72 max-w-[80vw] rounded-xl border border-line bg-card p-3 text-left text-xs leading-relaxed font-normal text-ink shadow-lg">
          <p className="mb-1 text-sm font-semibold">{title}</p>
          <div className="space-y-1.5 text-muted">{children}</div>
        </div>, document.body)}
    </div>
  )
}

export function Card({ title, icon, action, info, children, className = '', bodyClass = '' }: {
  title?: ReactNode; icon?: ReactNode; action?: ReactNode; info?: { title: string; body: ReactNode }; children: ReactNode; className?: string; bodyClass?: string
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_16px_rgb(15_23_42/0.04)] ${className}`}>
      {(title || action || info) && (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">{icon}<span className="truncate">{title}</span></h2>
          <div className="ml-auto flex shrink-0 items-center gap-1">{action}{info && <InfoTooltip title={info.title}>{info.body}</InfoTooltip>}</div>
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

type Variant = 'primary' | 'ghost' | 'danger' | 'outline' | 'soft'
const variants: Record<Variant, string> = {
  primary: 'bg-navy text-white shadow-sm hover:brightness-110 active:brightness-95 dark:text-[#0E1525]',
  outline: 'border border-line bg-card text-ink hover:bg-bg active:bg-line/60',
  ghost: 'text-muted hover:bg-bg hover:text-ink active:bg-line/60',
  danger: 'bg-danger-solid text-white shadow-sm hover:brightness-110 active:brightness-95 dark:text-[#0E1525]',
  soft: 'bg-primary-soft text-navy hover:brightness-95 active:brightness-90',
}

export const BTN_BASE = 'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy'
/** Clases de un botón para disparadores que no pueden ser <Button> (p. ej. el trigger de un menú). */
export const claseBoton = (v: Variant = 'primary') => `${BTN_BASE} ${variants[v]}`

export function Button({ variant = 'primary', loading, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`${BTN_BASE} ${variants[variant]} ${className}`}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

/** Botón principal de creación (Nuevo gasto, Nuevo fondo, Nueva subcaja…): misma variante en todos los módulos. */
export function BotonNuevo({ children, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & { loading?: boolean }) {
  return <Button variant="primary" {...rest}><Plus className="size-4" aria-hidden />{children}</Button>
}
/** Botón secundario de módulos mensuales (Gastos / Fondos / Subcajas mensuales): idéntico en los tres. Va justo después de BotonNuevo. */
export function BotonMensual({ children, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>) {
  return <Button variant="soft" {...rest}><CalendarDays className="size-4" aria-hidden />{children}</Button>
}
/** Editar (acción externa de tarjetas y filas): mismo lápiz, tamaño y hover en todos los módulos. */
export function BotonEditar({ label, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'aria-label'> & { label: string }) {
  return (
    <button type="button" aria-label={label} title="Editar" {...rest}
      className="grid size-9 place-items-center rounded-xl text-muted transition hover:bg-bg hover:text-navy focus-visible:outline-2 focus-visible:outline-navy disabled:opacity-40">
      <Pencil className="size-4" aria-hidden />
    </button>
  )
}

export function IconButton({ label, children, tone = 'default', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: 'default' | 'danger' | 'primary' }) {
  const tones = { default: 'text-muted hover:bg-bg hover:text-ink', danger: 'text-muted hover:bg-danger-soft hover:text-danger', primary: 'text-muted hover:bg-primary-soft hover:text-navy' }
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={`grid size-8 place-items-center rounded-lg transition focus-visible:outline-2 focus-visible:outline-navy disabled:opacity-40 ${tones[tone]} ${className}`}>
      {children}
    </button>
  )
}

export function Field({ label, children, error, hint, htmlFor }: { label: ReactNode; children: ReactNode; error?: string; hint?: string; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">{label}</label>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : hint && <span className="text-[11px] text-muted">{hint}</span>}
    </div>
  )
}

export const inputCls = 'w-full rounded-xl border border-line bg-card px-3 py-2 text-base text-ink sm:text-sm outline-none transition placeholder:text-muted/70 focus:border-navy focus:ring-4 focus:ring-navy/10 disabled:cursor-not-allowed disabled:bg-bg disabled:text-muted'

/**
 * Controles con la misma caja en todos los navegadores (incluido Safari/iPhone): altura táctil de 44 px, mismo borde,
 * radio, relleno y alineación. Sin estilos nativos de iOS (appearance: none); el icono va dibujado aparte.
 */
export const controlCls = `${inputCls} control-box h-11 leading-tight`

/**
 * Fecha: usa el calendario propio de la app (DatePicker). El valor real es AAAA-MM-DD; lo que se ve usa el formato de
 * Configuración. Sin conversiones de zona horaria: es solo texto.
 */
export function DateField(props: {
  id?: string; value: string; onChange: (v: string) => void; format?: string; min?: string; max?: string; invalid?: boolean; label?: string; today?: string
}) {
  return <DatePicker {...props} />
}

export function SelectField({ id, value, onChange, children, label, invalid }: {
  id?: string; value: string; onChange: (v: string) => void; children: ReactNode; label?: string; invalid?: boolean
}) {
  return (
    <div className="relative">
      <select id={id} aria-label={label} value={value} onChange={e => onChange(e.target.value)} aria-invalid={invalid || undefined}
        className={`${controlCls} appearance-none pr-10 ${invalid ? 'border-danger' : ''}`}>{children}</select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
    </div>
  )
}

export function Select({ value, onChange, options, placeholder, label, id }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string; label: string; id?: string }) {
  return (
    <select id={id} aria-label={label} className={inputCls} value={value} onChange={e => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

/**
 * Casilla de selección múltiple (no es un interruptor: los interruptores activan/desactivan, las casillas seleccionan).
 * Un solo diseño para listas, filtros y plantillas; `color` tiñe el estado marcado con el color del catálogo.
 */
export function Checkbox({ checked, onChange, label, indeterminate, disabled, color, className = '', id }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; indeterminate?: boolean; disabled?: boolean; color?: string; className?: string; id?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate && !checked }, [indeterminate, checked])
  return <input ref={ref} id={id} type="checkbox" className={`cb ${className}`} style={color ? { ['--cb-color' as string]: color } : undefined}
    aria-label={label} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
}

/** ÚNICO interruptor ON/OFF de la app: ON azul principal, OFF gris neutro, mismo tamaño, animación y foco en todos los módulos.
 *  `estado` añade el texto ON/OFF a la derecha. Activar no confirma nada: el guardado lo informa el propio flujo (loading/error). */
export function Switch({ checked, onChange, label, compact, disabled, title, estado }: { checked: boolean; onChange: (v: boolean) => void; label: string; compact?: boolean; disabled?: boolean; title?: string; estado?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={compact || estado ? label : undefined} title={title ?? (compact ? label : undefined)} disabled={disabled}
      onClick={e => { e.stopPropagation(); onChange(!checked) }}
      className="inline-flex shrink-0 items-center gap-2 rounded-full text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-wait disabled:opacity-60">
      <span data-ds="switch" className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-navy' : 'bg-switch-off'}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all duration-200 ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {estado ? <span className={`w-6 text-left text-[11px] font-bold ${checked ? 'text-navy' : 'text-muted'}`} aria-hidden>{checked ? 'ON' : 'OFF'}</span> : !compact && label}
    </button>
  )
}

/** Grupo de opciones excluyentes con aspecto de pastillas (accesible como radiogroup). */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-xl bg-bg p-1">
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition outline-none focus-visible:ring-2 focus-visible:ring-navy/40 ${value === o.value ? 'bg-card font-semibold text-navy shadow-sm ring-1 ring-line' : 'text-muted hover:bg-card/60 hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Modal({ open, onClose, title, subtitle, icon, children, footer, size = 'md', bloqueado }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; icon?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Guardado crítico en curso: Escape y el botón Cerrar no cierran el diálogo (evita perder el resultado). */
  bloqueado?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useModalLayer(open)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  const w = { sm: 'w-[min(26rem,calc(100vw-1.5rem))]', md: 'w-[min(36rem,calc(100vw-1.5rem))]', lg: 'w-[min(44rem,calc(100vw-1.5rem))]', xl: 'w-[min(64rem,calc(100vw-1.5rem))]' }[size]
  return (
    <dialog ref={ref} onClose={onClose} onCancel={e => { if (bloqueado) e.preventDefault() }} className={`m-auto max-h-[calc(100dvh-2rem)] ${w} overflow-hidden rounded-2xl border border-line bg-card p-0 text-ink shadow-2xl`}>
      {open && (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            {icon && <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-navy">{icon}</span>}
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">{title}</h2>
              {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
            </div>
            <IconButton label="Cerrar" onClick={bloqueado ? () => undefined : onClose}><X className="size-4" /></IconButton>
          </div>
          {/* Al abrirse el teclado del teléfono, el campo enfocado se mantiene visible dentro del área desplazable. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
            onFocusCapture={e => { const t = e.target as HTMLElement; if (t.matches('input,select,textarea')) setTimeout(() => t.scrollIntoView?.({ block: 'nearest' }), 300) }}>{children}</div>
          {footer && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line bg-bg/50 px-4 py-3 sm:px-5">{footer}</div>}
          <Toaster layer="modal" />
        </div>
      )}
    </dialog>
  )
}

export function ErrorBox({ message, onRetry, tone = 'error', action }: { message: ReactNode; onRetry?: () => void; tone?: 'error' | 'warning'; action?: { label: string; onClick: () => void } }) {
  const cls = tone === 'error'
    ? 'border-danger/30 bg-danger-soft text-danger'
    : 'border-warning/30 bg-warning-soft text-warning'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${cls}`}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="flex-1">{message}</span>
      {onRetry && <button className="font-semibold underline" onClick={() => onRetry()}>Reintentar</button>}
      {action && <button type="button" className="font-semibold underline" onClick={action.onClick}>{action.label}</button>}
    </div>
  )
}

export function Skeleton({ className = 'h-24' }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-line/70 ${className}`} aria-hidden />
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      {icon && <span className="grid size-12 place-items-center rounded-2xl bg-bg text-muted">{icon}</span>}
      {title && <p className="text-sm font-semibold text-ink">{title}</p>}
      {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
    </div>
  )
}

/** Chip con icono y color de una entidad (ámbito, categoría, medio). */
export function Pill({ color, Icon, children, size = 'sm' }: { color: string; Icon?: React.ComponentType<{ className?: string }>; children: ReactNode; size?: 'sm' | 'xs' }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full font-medium ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-px text-[11px]'}`}
      style={{ background: `${color}1F`, color }}>
      {Icon && <Icon className={size === 'sm' ? 'size-3.5 shrink-0' : 'size-3 shrink-0'} />}
      <span className="truncate">{children}</span>
    </span>
  )
}

/** Cuadro de icono con fondo pastel del color de la entidad. */
export function IconTile({ color, Icon, size = 'md' }: { color: string; Icon: React.ComponentType<{ className?: string }>; size?: 'sm' | 'md' | 'lg' }) {
  const s = { sm: 'size-7 [&>svg]:size-3.5 rounded-lg', md: 'size-9 [&>svg]:size-4.5 rounded-xl', lg: 'size-11 [&>svg]:size-5 rounded-xl' }[size]
  return <span className={`grid shrink-0 place-items-center ${s}`} style={{ background: `${color}1F`, color }}><Icon /></span>
}
