import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { AccionMenu } from './MenuAcciones'

/** true en pantallas de teléfono: ahí las acciones secundarias se muestran deslizando la fila. */
export function useEsMovil(maxPx = 767) {
  const query = `(max-width: ${maxPx}px)`
  const [movil, setMovil] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const mq = matchMedia(query)
    const on = () => setMovil(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return movil
}

// Solo una fila puede tener sus acciones abiertas: al abrir otra se cierra la anterior.
let cerrarActual: (() => void) | null = null

const ANCHO_ACCION = 68
const UMBRAL = 10
const NO_INICIA = 'button,input,select,textarea,a,label,[role="switch"],[role="checkbox"],[role="combobox"],[data-asa-orden],[data-no-swipe]'

/**
 * Fila con acciones ocultas que se revelan deslizando hacia la izquierda (iOS/Android reales: eventos de puntero con
 * touch-action: pan-y, así el scroll vertical y el asa de arrastre no se bloquean).
 *  - Dirección decidida por umbral: vertical = scroll de la página, horizontal = abre/cierra acciones.
 *  - Nunca ejecuta nada por deslizar: solo muestra los botones; Eliminar sigue pidiendo confirmación en su propio modal.
 *  - Alternativa sin gestos: botón «Mostrar acciones» (teclado, lector de pantalla) y flechas ← → con el foco en la fila.
 *  - Con `activo = false` (escritorio) solo renderiza el contenido.
 */
export function SwipeFila({ nombre, acciones, children, activo = true, className = '', testId }: {
  nombre: string; acciones: AccionMenu[]; children: ReactNode; activo?: boolean; className?: string; testId?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [arrastre, setArrastre] = useState<number | null>(null)   // desplazamiento en curso (px) mientras se arrastra
  const raiz = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const gesto = useRef<{ x: number; y: number; base: number; modo: '' | 'h' | 'v'; t: number; id: number } | null>(null)
  const supr = useRef(false)
  const ancho = acciones.length * ANCHO_ACCION

  const cerrar = useCallback(() => { setAbierto(false); setArrastre(null); if (cerrarActual === cerrar) cerrarActual = null }, [])
  const abrir = useCallback(() => {
    if (cerrarActual && cerrarActual !== cerrar) cerrarActual()
    cerrarActual = cerrar
    setAbierto(true); setArrastre(null)
  }, [cerrar])
  useEffect(() => () => { if (cerrarActual === cerrar) cerrarActual = null }, [cerrar])

  // Abierta: tocar fuera o Escape la cierra.
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) cerrar() }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('pointerdown', fuera); document.removeEventListener('keydown', tecla) }
  }, [abierto, cerrar])
  useLayoutEffect(() => { if (!activo) cerrar() }, [activo, cerrar])

  if (!activo) return <div className={className} data-testid={testId}>{children}</div>

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (!abierto && (e.target as HTMLElement).closest(NO_INICIA)) return
    gesto.current = { x: e.clientX, y: e.clientY, base: abierto ? ancho : 0, modo: '', t: e.timeStamp, id: e.pointerId }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesto.current
    if (!g || g.id !== e.pointerId) return
    const dx = e.clientX - g.x, dy = e.clientY - g.y
    if (!g.modo) {
      if (Math.abs(dy) > UMBRAL && Math.abs(dy) > Math.abs(dx)) { g.modo = 'v'; return }        // scroll vertical: no interferimos
      if (Math.abs(dx) > UMBRAL && Math.abs(dx) > Math.abs(dy) * 1.5) {
        g.modo = 'h'
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* sin captura */ }
        if (cerrarActual && cerrarActual !== cerrar) cerrarActual()
      } else return
    }
    if (g.modo !== 'h') return
    const bruto = g.base - dx
    setArrastre(bruto < 0 ? bruto / 4 : bruto > ancho ? ancho + (bruto - ancho) / 4 : bruto)     // resistencia en los extremos
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesto.current
    gesto.current = null
    if (!g || g.modo !== 'h') return
    supr.current = true; setTimeout(() => { supr.current = false }, 0)                           // el soltar no cuenta como toque
    const dx = e.clientX - g.x
    const veloz = Math.abs(dx) / Math.max(e.timeStamp - g.t, 1) > 0.5
    const actual = arrastre ?? g.base
    if (veloz) { if (dx < 0) abrir(); else cerrar() } else if (actual > ancho * 0.4) abrir(); else cerrar()
  }
  const onClickCapture = (e: React.MouseEvent) => {
    if (supr.current) { e.preventDefault(); e.stopPropagation(); return }
    if (abierto && !(e.target as HTMLElement).closest('[data-swipe-panel]')) { e.preventDefault(); e.stopPropagation(); cerrar() }   // tocar la fila la cierra
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,select,textarea')) return
    if (e.key === 'ArrowLeft' && !abierto) { e.preventDefault(); abrir(); setTimeout(() => panel.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus(), 0) }
    else if (e.key === 'ArrowRight' && abierto) { e.preventDefault(); cerrar() }
  }

  const x = arrastre ?? (abierto ? ancho : 0)
  return (
    <div ref={raiz} className={`relative overflow-hidden ${className}`} data-testid={testId} data-swipe-abierto={abierto || undefined} onKeyDown={onKeyDown}>
      <div ref={panel} data-swipe-panel role="group" aria-label={`Acciones de ${nombre}`} inert={!abierto} aria-hidden={!abierto}
        className="absolute inset-y-0 right-0 flex" style={{ width: ancho }}>
        {acciones.map(a => (
          <button key={a.key} type="button" disabled={a.disabled} title={a.title} onClick={() => { cerrar(); a.onClick() }}
            className={`flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition disabled:opacity-40 ${a.danger ? 'bg-danger-solid text-white' : 'bg-primary-soft text-navy'}`}
            style={{ width: ANCHO_ACCION }}>
            {a.icon}<span>{a.label}</span>
          </button>
        ))}
      </div>
      <div className="relative bg-card" style={{ transform: x ? `translateX(${-x}px)` : undefined, transition: arrastre === null ? 'transform 180ms ease-out' : 'none', touchAction: 'pan-y' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { gesto.current = null; setArrastre(null) }} onClickCapture={onClickCapture}>
        <div className="pr-5">{children}</div>
        {!abierto && (
          <button type="button" aria-label={`Mostrar acciones de ${nombre}`} aria-haspopup="true" onClick={abrir} data-testid="swipe-hint"
            className="absolute top-1/2 right-0 grid h-9 w-5 -translate-y-1/2 place-items-center rounded-l-lg text-muted/70 transition hover:bg-bg hover:text-ink">
            <ChevronLeft className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
