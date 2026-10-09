// Orden del catálogo en un solo lugar. Regla: dentro de cada grupo (ámbitos; categorías de un ámbito;
// subcategorías de una categoría) se respeta el número de la columna Orden y "Otros" va siempre al final.
import type { CatalogoItem } from './types'

/** "Otros", " otros " y "OTROS" son la misma opción. */
export const normName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
export const isOtros = (s: string) => normName(s) === 'otros'

/** Mueve "Otros" al final sin tocar el orden del resto (orden estable). Quita duplicados lógicos. */
export function otrosAlFinal<T>(xs: T[], name: (x: T) => string = x => String(x)): T[] {
  const seen = new Set<string>()
  const uniq = xs.filter(x => { const k = normName(name(x)); if (seen.has(k)) return false; seen.add(k); return true })
  return [...uniq.filter(x => !isOtros(name(x))), ...uniq.filter(x => isOtros(name(x)))]
}

const ord = (o: number | undefined) => (typeof o === 'number' && Number.isFinite(o) ? o : Number.POSITIVE_INFINITY)

/**
 * Ordena el catálogo jerárquicamente: ámbito → categoría → subcategoría.
 * El rango de un grupo es el menor Orden de sus filas; las filas sin Orden (hojas antiguas) quedan detrás
 * de las numeradas en el orden en que llegaron. Nunca depende solo del orden físico de las filas.
 */
export function sortCatalogo(items: CatalogoItem[]): CatalogoItem[] {
  const ambRank = new Map<string, [number, number]>()
  const catRank = new Map<string, [number, number]>()
  items.forEach((c, i) => {
    const a = normName(c.ambito), k = `${a}|${normName(c.categoria)}`
    const ra = ambRank.get(a); ambRank.set(a, [Math.min(ra?.[0] ?? Infinity, ord(c.orden)), ra?.[1] ?? i])
    if (c.categoria) { const rc = catRank.get(k); catRank.set(k, [Math.min(rc?.[0] ?? Infinity, ord(c.orden)), rc?.[1] ?? i]) }
  })
  const cmp = (x: [number, number], y: [number, number]) => x[0] - y[0] || x[1] - y[1]
  const key = (c: CatalogoItem, i: number) => {
    const a = normName(c.ambito), k = `${a}|${normName(c.categoria)}`
    return { c, i, a, k }
  }
  return items.map(key).sort((x, y) => {
    if (x.a !== y.a) return Number(isOtros(x.c.ambito)) - Number(isOtros(y.c.ambito)) || cmp(ambRank.get(x.a)!, ambRank.get(y.a)!)
    if (!x.c.categoria || !y.c.categoria) return Number(!!x.c.categoria) - Number(!!y.c.categoria) || x.i - y.i // fila del ámbito primero
    if (x.k !== y.k) return Number(isOtros(x.c.categoria)) - Number(isOtros(y.c.categoria)) || cmp(catRank.get(x.k)!, catRank.get(y.k)!)
    if (!x.c.subcategoria || !y.c.subcategoria) return Number(!!x.c.subcategoria) - Number(!!y.c.subcategoria) || x.i - y.i
    return Number(isOtros(x.c.subcategoria)) - Number(isOtros(y.c.subcategoria)) || ord(x.c.orden) - ord(y.c.orden) || x.i - y.i
  }).map(x => x.c)
}

/** Orden inicial del catálogo (igual que ordenCanonico_ en Code.gs): ámbito×10000 + categoría×100 + subcategoría. */
export function ordenCanonico(cat: Record<string, Record<string, string[]>>): Map<string, number> {
  const out = new Map<string, number>()
  Object.entries(cat).forEach(([a, cats], i) => {
    const base = (i + 1) * 10000
    out.set(`${normName(a)}||`, base)
    Object.entries(cats).forEach(([c, subs], j) => {
      const cb = base + (j + 1) * 100
      out.set(`${normName(a)}|${normName(c)}|`, cb)
      subs.forEach((s, k) => out.set(`${normName(a)}|${normName(c)}|${normName(s)}`, cb + k + 1))
    })
  })
  return out
}

/** Orden para una opción nueva: al final de su grupo (igual que nextOrden_ en Code.gs). */
export function nextOrden(rows: { ambito: string; categoria: string; orden?: number }[], ambito: string, categoria: string, sub: string): number | undefined {
  const max = (pred: (r: { ambito: string; categoria: string }) => boolean) =>
    rows.reduce<number | null>((m, r) => (Number.isFinite(r.orden) && pred(r) && (m === null || r.orden! > m) ? r.orden! : m), null)
  if (sub) { const m = max(r => normName(r.ambito) === normName(ambito) && normName(r.categoria) === normName(categoria)); if (m !== null) return m + 1 }
  if (categoria) { const m = max(r => normName(r.ambito) === normName(ambito)); if (m !== null) return (Math.floor(m / 100) + 1) * 100 + (sub ? 1 : 0) }
  const m = max(() => true)
  return m === null ? undefined : (Math.floor(m / 10000) + 1) * 10000 + (categoria ? 100 : 0) + (sub ? 1 : 0)
}
