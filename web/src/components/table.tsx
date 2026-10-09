import { useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

export const PAGE_SIZES = [5, 10, 15, 25, 50]

/** Números de página adaptativos: 1 … 4 5 6 … 20 */
export function pageNumbers(current: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i)
  const set = new Set([0, pages - 1, current - 1, current, current + 1].filter(p => p >= 0 && p < pages))
  if (current <= 2) [1, 2, 3].forEach(p => set.add(p))
  if (current >= pages - 3) [pages - 2, pages - 3, pages - 4].forEach(p => set.add(p))
  const sorted = [...set].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  sorted.forEach((p, i) => { if (i && p - sorted[i - 1] > 1) out.push('…'); out.push(p) })
  return out
}

export function Pagination({ page, pageSize, total, onPage, onPageSize, noun = 'movimientos' }: {
  page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize: (n: number) => void; noun?: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? page * pageSize + 1 : 0
  const to = Math.min(total, (page + 1) * pageSize)
  const btn = 'grid h-8 min-w-8 place-items-center rounded-lg px-2 text-xs font-medium transition disabled:opacity-40'
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span>Mostrando <b className="tabular text-ink">{from}–{to}</b> de <b className="tabular text-ink">{total}</b> {noun}</span>
        <label className="flex items-center gap-1.5">
          <span className="hidden sm:inline">Por página</span>
          <select aria-label="Registros por página" value={pageSize} onChange={e => onPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-line bg-card px-2 text-xs text-ink outline-none focus:border-navy">
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <nav aria-label="Paginación" className="flex items-center gap-1 self-center sm:self-auto">
        <button type="button" className={`${btn} hover:bg-bg`} aria-label="Primera página" disabled={page === 0} onClick={() => onPage(0)}><ChevronsLeft className="size-4" /></button>
        <button type="button" className={`${btn} hover:bg-bg`} aria-label="Página anterior" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft className="size-4" /></button>
        {pageNumbers(page, pages).map((p, i) => p === '…'
          ? <span key={`e${i}`} className="px-1">…</span>
          : <button key={p} type="button" aria-label={`Página ${p + 1}`} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}
              className={`${btn} ${p === page ? 'bg-navy text-white dark:text-[#0E1525]' : 'text-ink hover:bg-bg'}`}>{p + 1}</button>)}
        <button type="button" className={`${btn} hover:bg-bg`} aria-label="Página siguiente" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}><ChevronRight className="size-4" /></button>
        <button type="button" className={`${btn} hover:bg-bg`} aria-label="Última página" disabled={page >= pages - 1} onClick={() => onPage(pages - 1)}><ChevronsRight className="size-4" /></button>
      </nav>
    </div>
  )
}

/** Fila deslizable (móvil): arrastra a la izquierda para ver las acciones. Nunca ejecuta una acción con el gesto. */
export function SwipeRow({ actions, children, width = 168 }: { actions: ReactNode; children: ReactNode; width?: number }) {
  const [x, setX] = useState(0)
  const start = useRef<{ x: number; y: number; base: number; horizontal: boolean | null } | null>(null)
  const dragged = useRef(false) // el click que sigue a un arrastre no debe cerrar ni activar nada
  const open = x <= -width / 2
  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div className="absolute inset-y-0 right-0 flex items-stretch" style={{ width }} aria-hidden={!open}>{actions}</div>
      <div
        className="relative touch-pan-y bg-card transition-transform duration-200"
        style={{ transform: `translateX(${x}px)`, transitionDuration: start.current ? '0ms' : undefined }}
        onPointerDown={e => { dragged.current = false; start.current = { x: e.clientX, y: e.clientY, base: x, horizontal: null }; try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* sin captura */ } }}
        onPointerMove={e => {
          const s = start.current
          if (!s) return
          const dx = e.clientX - s.x, dy = e.clientY - s.y
          if (s.horizontal === null && Math.abs(dx) + Math.abs(dy) > 6) s.horizontal = Math.abs(dx) > Math.abs(dy)
          if (s.horizontal) setX(Math.max(-width, Math.min(0, s.base + dx)))
        }}
        onPointerUp={() => { dragged.current = !!start.current?.horizontal; if (dragged.current) setX(x < -width / 3 ? -width : 0); start.current = null }}
        onPointerCancel={() => { start.current = null; setX(0) }}
        onClickCapture={e => {
          if (dragged.current) { dragged.current = false; e.stopPropagation(); return }
          if (x !== 0) { e.stopPropagation(); setX(0) } // tocar la tarjeta abierta la cierra
        }}
      >
        {children}
      </div>
    </div>
  )
}
