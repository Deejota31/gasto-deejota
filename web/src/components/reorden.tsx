import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { GripVertical } from 'lucide-react'

/**
 * Reordenar arrastrando (v1.16). Sirve para listas y cuadrículas, con mouse, dedo y teclado:
 *  - mouse / táctil: se arrastra desde el asa; el orden se previsualiza al mover y SOLO se guarda al soltar (un único guardado);
 *  - teclado: con el asa enfocada, Espacio/Enter la "toma", ↑ ↓ (← →) la mueven, Espacio/Enter la suelta y Esc cancela;
 *  - si el orden no cambió no se guarda nada; si el guardado falla, quien llama restaura el orden anterior (rollback).
 * `ids` es el orden guardado; `habilitado` es false cuando hay búsqueda/filtros/paginación (el orden sería ambiguo).
 */
export function useReorden({ ids, habilitado, onCommit, nombre }: { ids: string[]; habilitado: boolean; onCommit: (nuevo: string[]) => void; nombre: (id: string) => string }) {
  const [vista, setVista] = useState<string[] | null>(null)
  const [activo, setActivo] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')
  const refs = useRef(new Map<string, HTMLElement>())
  const slots = useRef<DOMRect[]>([])
  const vistaRef = useRef<string[] | null>(null)
  const idsRef = useRef(ids)
  idsRef.current = ids
  const foco = useRef<string | null>(null)
  const teclado = useRef(false)
  const cb = useRef(onCommit)
  cb.current = onCommit
  const nom = useRef(nombre)
  nom.current = nombre

  // Si cambian los datos (otro dispositivo, refresco) en pleno arrastre, se cancela.
  const firma = ids.join('|')
  useEffect(() => { vistaRef.current = null; setVista(null); setActivo(null); teclado.current = false }, [firma])

  useLayoutEffect(() => {
    if (!teclado.current || !foco.current) return
    document.querySelector<HTMLElement>(`[data-asa-orden="${CSS.escape(foco.current)}"]`)?.focus({ preventScroll: true })
  })

  const poner = (v: string[] | null) => { vistaRef.current = v; setVista(v) }
  const terminar = useCallback((guardar: boolean) => {
    const v = vistaRef.current
    const orig = idsRef.current
    const id = foco.current
    poner(null); setActivo(null); teclado.current = false; foco.current = null
    if (!guardar || !v || v.join('|') === orig.join('|')) { if (!guardar && id) setAviso(`Movimiento cancelado. ${nom.current(id)} sigue en su lugar.`); return }
    if (id) setAviso(`${nom.current(id)} se movió a la posición ${v.indexOf(id) + 1} de ${v.length}.`)
    cb.current(v)
  }, [])

  const mover = (id: string, destino: number) => {
    const base = vistaRef.current ?? idsRef.current
    const i = base.indexOf(id)
    const j = Math.max(0, Math.min(base.length - 1, destino))
    if (i < 0 || i === j) return
    const xs = [...base]
    xs.splice(i, 1); xs.splice(j, 0, id)
    poner(xs)
  }

  const empezar = (id: string, e: ReactPointerEvent) => {
    if (!habilitado || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    slots.current = idsRef.current.map(x => refs.current.get(x)?.getBoundingClientRect()).filter((r): r is DOMRect => !!r)
    if (slots.current.length !== idsRef.current.length) return
    foco.current = id
    setActivo(id); poner([...idsRef.current])
    setAviso(`Arrastrando ${nom.current(id)}.`)
    const move = (ev: PointerEvent) => {
      const { clientX: x, clientY: y } = ev
      // Auto-desplazamiento cerca del borde de la pantalla.
      if (y < 56) window.scrollBy(0, -14); else if (y > window.innerHeight - 56) window.scrollBy(0, 14)
      let mejor = 0, dist = Infinity
      slots.current.forEach((r, k) => {
        const dentro = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
        const d = dentro ? -1 : Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2))
        if (d < dist) { dist = d; mejor = k }
      })
      mover(id, mejor)
    }
    const fin = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', fin); window.removeEventListener('pointercancel', fin)
      terminar(ev.type === 'pointerup')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', fin)
    window.addEventListener('pointercancel', fin)
  }

  const tecla = (id: string, e: ReactKeyboardEvent) => {
    if (!habilitado) return
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      if (teclado.current) terminar(true)
      else {
        teclado.current = true; foco.current = id; setActivo(id); poner([...idsRef.current])
        setAviso(`${nom.current(id)} tomada, posición ${idsRef.current.indexOf(id) + 1} de ${idsRef.current.length}. Usa las flechas para moverla; Espacio para soltarla y Escape para cancelar.`)
      }
      return
    }
    if (!teclado.current) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); terminar(false); return }
    const delta = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0
    if (!delta) return
    e.preventDefault()
    const base = vistaRef.current ?? idsRef.current
    mover(id, base.indexOf(id) + delta)
    const n = (vistaRef.current ?? base).indexOf(id) + 1
    setAviso(`${nom.current(id)}: posición ${n} de ${base.length}.`)
  }

  const orden = vista ?? ids
  return {
    orden, activo, aviso, arrastrando: activo !== null,
    /** Registra el elemento de cada ítem (para medir) y marca el que se arrastra. */
    item: (id: string) => ({ ref: (el: HTMLElement | null) => { if (el) refs.current.set(id, el); else refs.current.delete(id) }, 'data-arrastrando': activo === id ? 'true' : undefined }),
    asa: (id: string) => ({
      id, habilitado, tomada: activo === id, nombre: nom.current(id),
      onPointerDown: (e: ReactPointerEvent) => empezar(id, e),
      onKeyDown: (e: ReactKeyboardEvent) => tecla(id, e),
      // Mover el nodo en el DOM puede disparar un blur pasajero: solo se cancela si el foco de verdad salió del asa.
      onBlur: () => { requestAnimationFrame(() => { if (teclado.current && foco.current === id && document.activeElement?.getAttribute('data-asa-orden') !== id) terminar(false) }) },
    }),
  }
}

type AsaProps = ReturnType<ReturnType<typeof useReorden>['asa']> & { motivo?: string }

/** Asa de arrastre: botón con el icono de agarre. Deshabilitada (con motivo) cuando reordenar sería ambiguo. */
export function AsaOrden({ id, habilitado, tomada, nombre, onPointerDown, onKeyDown, onBlur, motivo }: AsaProps) {
  return (
    <button type="button" data-asa-orden={id} disabled={!habilitado} aria-pressed={tomada} aria-roledescription="asa para reordenar"
      aria-label={`Reordenar ${nombre}`} title={habilitado ? 'Arrastra para reordenar (o Espacio y flechas)' : motivo ?? 'No se puede reordenar ahora'}
      onPointerDown={onPointerDown} onKeyDown={onKeyDown} onBlur={onBlur} style={{ touchAction: 'none' }}
      className={`grid size-8 shrink-0 cursor-grab place-items-center rounded-lg text-muted transition outline-none hover:bg-bg hover:text-ink focus-visible:ring-2 focus-visible:ring-navy/50 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30 ${tomada ? 'bg-primary-soft text-navy' : ''}`}>
      <GripVertical className="size-4" />
    </button>
  )
}

/** Región en vivo para lectores de pantalla. */
export const AvisoOrden = ({ texto }: { texto: string }) => <p role="status" aria-live="polite" className="sr-only">{texto}</p>

/** Clase de la fila/tarjeta que se está arrastrando: borde punteado y elevación (indicador de destino). */
export const CLASE_ARRASTRE = 'data-[arrastrando=true]:z-10 data-[arrastrando=true]:scale-[1.01] data-[arrastrando=true]:border-dashed data-[arrastrando=true]:border-navy data-[arrastrando=true]:bg-primary-soft/40 data-[arrastrando=true]:shadow-lg'
