import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'

export function Card({ title, icon, action, children, className = '' }: { title?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-card p-4 shadow-sm ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">{icon}{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

type Variant = 'primary' | 'ghost' | 'danger' | 'outline'
const variants: Record<Variant, string> = {
  primary: 'bg-navy text-white hover:bg-navy/90',
  outline: 'border border-line bg-card text-ink hover:bg-bg',
  ghost: 'text-muted hover:bg-bg hover:text-ink',
  danger: 'bg-red-600 text-white hover:bg-red-700',
}

export function Button({ variant = 'primary', loading, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-turquesa ${variants[variant]} ${className}`}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      {children}
      {error && <span className="text-red-600">{error}</span>}
    </label>
  )
}

export const inputCls = 'w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-turquesa focus:ring-2 focus:ring-turquesa/20'

export function Select({ value, onChange, options, placeholder, label }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string; label: string }) {
  return (
    <select aria-label={label} className={inputCls} value={value} onChange={e => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(34rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-card p-0 text-ink shadow-xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <button aria-label="Cerrar" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-bg"><X className="size-4" /></button>
      </div>
      <div className="p-4">{open && children}</div>
    </dialog>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="flex-1">{message}</span>
      {onRetry && <button className="font-semibold underline" onClick={() => onRetry()}>Reintentar</button>}
    </div>
  )
}

export function Skeleton({ className = 'h-24' }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-line/70 ${className}`} aria-hidden />
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>
}
