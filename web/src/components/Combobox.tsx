import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { controlCls, inputCls } from './ui'

/**
 * Posición de un desplegable anclado a un elemento: se pinta con position: fixed en un portal (dentro del <dialog>
 * abierto si lo hay, porque un modal tapa todo lo que está fuera de él), se abre hacia abajo o hacia arriba según el
 * espacio libre, nunca se sale de la pantalla y tiene altura máxima con desplazamiento interno.
 */
export function usePopover(open: boolean, anchor: RefObject<HTMLElement | null>, opts: { minWidth?: number; maxWidth?: number; maxHeight?: number; align?: 'left' | 'right' } = {}) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null)
  const { minWidth = 0, maxWidth = 440, maxHeight = 320, align = 'left' } = opts
  useLayoutEffect(() => {
    if (!open || !anchor.current) { setPos(null); return }
    const place = () => {
      const r = anchor.current!.getBoundingClientRect()
      const vw = window.innerWidth, vh = window.innerHeight
      const width = Math.min(Math.max(r.width, minWidth), maxWidth, vw - 16)
      let left = align === 'right' ? r.right - width : r.left
      left = Math.max(8, Math.min(left, vw - width - 8))
      const abajo = vh - r.bottom - 12, arriba = r.top - 12
      const hacia = abajo >= Math.min(maxHeight, 200) || abajo >= arriba ? 'abajo' : 'arriba'
      const alto = Math.max(120, Math.min(maxHeight, hacia === 'abajo' ? abajo : arriba))
      setPos(hacia === 'abajo' ? { top: r.bottom + 6, left, width, maxHeight: alto } : { bottom: vh - r.top + 6, left, width, maxHeight: alto })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open, anchor, minWidth, maxWidth, maxHeight, align])
  const host = (): HTMLElement => (anchor.current?.closest('dialog') as HTMLElement | null) ?? document.body
  return { pos, host }
}

export interface Opcion {
  value: string
  label: string
  Icon?: ComponentType<{ className?: string; style?: CSSProperties }>
  color?: string
  group?: string
  hint?: string
  /** Descripción secundaria bajo el nombre (en la lista y, con `descEnTrigger`, también en el campo). */
  desc?: string
  disabled?: boolean
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Selector desplegable único de la aplicación (monedas, medios de pago, ámbitos, categorías…): muestra icono y color de cada
 * opción, busca cuando hay muchas, se maneja con teclado (↑ ↓ Inicio Fin Enter Esc, o escribir para saltar) y marca la elegida.
 */
export function Combobox({ id, value, onChange, options, label, placeholder = 'Elige…', invalid, disabled, searchable, className = '', compact, vacio, triggerClass, descEnTrigger, maxHeight }: {
  id?: string; value: string; onChange: (v: string) => void; options: Opcion[]; label: string; placeholder?: string; invalid?: boolean; disabled?: boolean
  searchable?: boolean; className?: string; compact?: boolean; vacio?: ReactNode; triggerClass?: string; descEnTrigger?: boolean; maxHeight?: number
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [activo, setActivo] = useState(0)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const lista = useRef<HTMLDivElement>(null)
  const buscador = useRef<HTMLInputElement>(null)
  const uid = useId()
  const { pos, host } = usePopover(open, btn, { minWidth: compact ? 176 : 224, maxHeight })
  const conBusqueda = searchable ?? options.length > 8
  const term = sinTildes(q.trim())
  const shown = useMemo(() => options.filter(o => !term || sinTildes(`${o.label} ${o.group ?? ''}`).includes(term)), [options, term])
  const sel = options.find(o => o.value === value)

  const cerrar = useCallback((foco = true) => { setOpen(false); setQ(''); if (foco) btn.current?.focus() }, [])
  const abrir = () => {
    if (disabled) return
    const i = shown.findIndex(o => o.value === value)
    setActivo(i >= 0 ? i : Math.max(0, shown.findIndex(o => !o.disabled)))
    setOpen(true)
  }
  const elegir = (o: Opcion) => { if (o.disabled) return; onChange(o.value); cerrar() }

  // Foco inicial dentro del panel y cierre al tocar fuera.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => (conBusqueda ? buscador.current : lista.current)?.focus({ preventScroll: true }), 0)
    const fuera = (e: PointerEvent) => {
      const n = e.target as Node
      if (!panel.current?.contains(n) && !btn.current?.contains(n)) cerrar(false)
    }
    document.addEventListener('pointerdown', fuera)
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', fuera) }
  }, [open, conBusqueda, cerrar])

  // La opción activa siempre queda a la vista.
  useEffect(() => {
    if (!open) return
    lista.current?.querySelector<HTMLElement>(`[data-i="${activo}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activo, open, shown])

  const mover = (d: number) => {
    if (!shown.length) return
    let i = activo
    for (let n = 0; n < shown.length; n++) { i = (i + d + shown.length) % shown.length; if (!shown[i].disabled) break }
    setActivo(i)
  }
  const onKeyPanel = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); mover(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1) }
    else if (e.key === 'Home') { e.preventDefault(); setActivo(shown.findIndex(o => !o.disabled)) }
    else if (e.key === 'End') { e.preventDefault(); setActivo(shown.length - 1 - [...shown].reverse().findIndex(o => !o.disabled)) }
    else if (e.key === 'Enter') { e.preventDefault(); const o = shown[activo]; if (o) elegir(o) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar() }
    else if (e.key === 'Tab') cerrar(false)
    else if (!conBusqueda && e.key.length === 1 && /\S/.test(e.key)) {    // escribir salta a la primera opción que empieza así
      const i = shown.findIndex(o => sinTildes(o.label).startsWith(sinTildes(e.key)))
      if (i >= 0) setActivo(i)
    }
  }
  const grupos = [...new Set(shown.map(o => o.group ?? ''))]
  const Icon = sel?.Icon

  return (
    <div className={`relative ${className}`}>
      <button ref={btn} id={id} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${uid}-lb` : undefined}
        aria-label={label} aria-invalid={invalid || undefined} disabled={disabled}
        onClick={() => (open ? cerrar(false) : abrir())}
        onKeyDown={e => { if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); abrir() } else if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar() } }}
        className={triggerClass ?? `${controlCls} ${compact ? '!h-9 !min-h-9 !px-2.5 !py-1 text-[13px]' : ''} flex items-center gap-2 pr-9 text-left shadow-[0_1px_1px_rgb(15_23_42/0.04)] hover:border-navy/40 ${open ? 'border-navy ring-4 ring-navy/10' : ''} ${invalid ? 'border-[#D2463C]' : ''}`}
        style={{ position: 'relative' }}>
        {sel
          ? <>
            {Icon && <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: sel.color ? `${sel.color}1F` : undefined, color: sel.color }}><Icon className="size-3.5" /></span>}
            {descEnTrigger && sel.desc
              ? <span className="min-w-0 flex-1 leading-tight"><span className="block truncate" title={sel.label}>{sel.label}</span><span className="block truncate text-[10px] font-normal text-muted">{sel.desc}</span></span>
              : <span className="min-w-0 flex-1 truncate" title={sel.label}>{sel.label}</span>}
          </>
          : <span className="min-w-0 flex-1 truncate text-muted/80">{placeholder}</span>}
        <ChevronDown aria-hidden className={`pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted transition ${open ? 'rotate-180 text-navy' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div ref={panel} role="presentation" onKeyDown={onKeyPanel}
          style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
          className="fade-in z-[300] flex flex-col overflow-hidden rounded-2xl border border-line bg-card text-ink shadow-xl ring-1 ring-black/5">
          {conBusqueda && (
            <label className="relative m-2 mb-1 block">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input ref={buscador} aria-label={`Buscar ${label.toLowerCase()}`} aria-controls={`${uid}-lb`} aria-activedescendant={shown[activo] ? `${uid}-o${activo}` : undefined}
                className={`${inputCls} !py-1.5 pl-8`} placeholder="Buscar…" value={q} onChange={e => { setQ(e.target.value); setActivo(0) }} />
            </label>
          )}
          <div ref={lista} id={`${uid}-lb`} role="listbox" aria-label={label} tabIndex={-1} aria-activedescendant={shown[activo] ? `${uid}-o${activo}` : undefined}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 outline-none">
            {!shown.length && <p className="px-2 py-4 text-center text-xs text-muted">{vacio ?? 'Sin resultados.'}</p>}
            {grupos.map(g => (
              <div key={g || 'sin-grupo'} role="presentation">
                {g && <p className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-muted uppercase">{g}</p>}
                {shown.map((o, i) => (o.group ?? '') !== g ? null : (
                  <div key={o.value} id={`${uid}-o${i}`} data-i={i} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined} title={o.hint ? `${o.label} · ${o.hint}` : o.label}
                    onPointerMove={() => i !== activo && setActivo(i)} onClick={() => elegir(o)}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition ${o.disabled ? 'cursor-not-allowed opacity-45' : ''} ${i === activo ? 'bg-bg' : ''} ${o.value === value ? 'font-semibold' : ''}`}
                    style={o.value === value ? { background: o.color ? `${o.color}1A` : 'var(--primary-soft)', color: o.color } : undefined}>
                    {o.Icon && <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: o.color ? `${o.color}1F` : undefined, color: o.color }}><o.Icon className="size-4" /></span>}
                    {o.desc
                      ? <span className="min-w-0 flex-1 leading-tight"><span className="block truncate">{o.label}</span><span className="block truncate text-[11px] font-normal text-muted">{o.desc}</span></span>
                      : <span className="min-w-0 flex-1 truncate">{o.label}</span>}
                    {o.hint && <span className="shrink-0 text-[11px] font-normal text-muted">{o.hint}</span>}
                    {o.value === value && <Check className="size-4 shrink-0" aria-hidden />}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>, host())}
    </div>
  )
}
