import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

export interface AccionMenu { key: string; label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean; title?: string }

/**
 * Menú ⋯ de las tarjetas (Fuentes y Subcajas). Se dibuja en un portal con position: fixed: las tarjetas tienen
 * overflow-hidden y un menú absoluto quedaba cortado. Se abre hacia arriba si abajo no cabe y se cierra con Esc,
 * al tocar fuera, al desplazar o al cambiar el tamaño de la ventana.
 */
/** Orden canónico de acciones CRUD en TODOS los menús ⋯: Editar, Clonar, Guardar como plantilla, Subir, Bajar … y Eliminar al final. */
const RANGO: Record<string, number> = { edit: 0, clone: 1, tpl: 2, up: 3, down: 4, delete: 99 }
export const ordenarAcciones = (xs: AccionMenu[]) => xs.some(a => a.key in RANGO) ? xs.map((a, i) => [a, i] as const).sort((a, b) => (RANGO[a[0].key] ?? 10) - (RANGO[b[0].key] ?? 10) || a[1] - b[1]).map(([a]) => a) : xs

export function MenuAcciones({ label, acciones: sinOrden, ancho = 224, trigger, triggerClass, triggerStyle, disabled }: { label: string; acciones: AccionMenu[]; ancho?: number; trigger?: ReactNode; triggerClass?: string; triggerStyle?: CSSProperties; disabled?: boolean }) {
  const acciones = ordenarAcciones(sinOrden)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const place = () => {
      const r = btn.current!.getBoundingClientRect()
      const w = Math.min(ancho, window.innerWidth - 16), h = menu.current?.offsetHeight ?? acciones.length * 38 + 8
      const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))
      const abajo = r.bottom + 4 + h <= window.innerHeight - 8 || r.top < window.innerHeight - r.bottom
      setPos({ left, top: abajo ? r.bottom + 4 : Math.max(8, r.top - 4 - h) })
    }
    place()
    // Con scroll (de la página o de un contenedor) el menú sigue al botón; solo se cierra si el botón sale de la pantalla.
    const seguir = (e?: Event) => {
      if (e && menu.current?.contains(e.target as Node)) return
      const r = btn.current?.getBoundingClientRect()
      if (!r || r.bottom < 0 || r.top > window.innerHeight) setOpen(false)
      else place()
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', seguir, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', seguir, true) }
  }, [open, acciones.length])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!btn.current?.contains(t) && !menu.current?.contains(t)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); btn.current?.focus() } }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const item = 'flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-bg focus-visible:bg-bg focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={trigger ? undefined : label} disabled={disabled} onClick={() => setOpen(o => !o)} style={triggerStyle}
        className={triggerClass ?? 'grid size-9 place-items-center rounded-xl text-muted transition hover:bg-bg'}>{trigger ?? <MoreHorizontal className="size-4" />}</button>
      {open && createPortal(
        <div ref={menu} role="menu" aria-label={label} style={{ top: pos?.top ?? -9999, left: pos?.left ?? 0, width: Math.min(ancho, window.innerWidth - 16), visibility: pos ? 'visible' : 'hidden' }}
          className="fixed z-[150] rounded-xl border border-line bg-card p-1 shadow-xl">
          {acciones.map((a, i) => (
            <div key={a.key}>
              {a.danger && i > 0 && <div className="my-1 h-px bg-line" role="separator" />}
              <button role="menuitem" type="button" title={a.title} disabled={a.disabled} className={`${item} ${a.danger ? 'font-medium text-danger hover:bg-danger-soft' : ''}`}
                onClick={() => { setOpen(false); a.onClick() }}>
                <span className={`grid size-4 shrink-0 place-items-center [&>svg]:size-4 ${a.danger ? '' : 'text-muted'}`}>{a.icon}</span> {a.label}
              </button>
            </div>
          ))}
        </div>, (btn.current?.closest('dialog') as HTMLElement | null) ?? document.body)}
    </>
  )
}
