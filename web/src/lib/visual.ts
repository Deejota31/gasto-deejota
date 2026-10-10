import { ArrowLeftRight, Banknote, CreditCard, Smartphone, Ticket, Wallet, type LucideIcon } from 'lucide-react'
import type { CatalogoItem } from './types'
import { ICONS, sugerirIconos } from './iconos'

export { ICONS }

/**
 * Sistema de color (v1.9). Dos familias que no se mezclan:
 *  - ESTADOS: verde = bien, ámbar = atención, rojo = alerta/exceso, azul = información/acción. Solo para estados.
 *  - CLASIFICACIÓN: paleta reducida para ámbitos, categorías y fuentes, sin rojos ni ámbar puros para no confundirse
 *    con alertas. Ámbito = identidad fuerte y estable; categoría = su propio tono (el mismo en todas las pantallas);
 *    subcategoría = el color de su categoría (variación por opacidad), con icono propio.
 * Los colores e iconos guardados en CATALOGO siempre mandan sobre estos predeterminados.
 */
export const ESTADOS = {
  ok: { fg: '#0F8A6B', bg: '#E7F7F2' }, atencion: { fg: '#B7791F', bg: '#FFF6DB' }, alerta: { fg: '#C0362C', bg: '#FDECEC' },
  info: { fg: '#4F6FC8', bg: '#EEF3FF' }, neutro: { fg: '#64748B', bg: 'var(--bg)' },
} as const

/** Paleta de clasificación (también la que ofrece el selector de color). Contraste ≥ 3:1 sobre blanco como icono. */
export const COLORS = ['#4F7BE8', '#6366F1', '#8B7CF6', '#C2569B', '#DB5A9A', '#0E8FA8', '#14917F', '#2F9E6B', '#6B8E23', '#B4693C', '#8A6A4F', '#64748B']

const AMBITOS: Record<string, { icon: string; color: string }> = {
  Personal: { icon: 'user', color: '#4F7BE8' },
  Trabajo: { icon: 'briefcase', color: '#B4693C' },
  Pareja: { icon: 'heart', color: '#8B7CF6' },
  Familia: { icon: 'users', color: '#14917F' },
  Amigos: { icon: 'party-popper', color: '#DB5A9A' },
}

const CATEGORIAS: Record<string, { icon: string; color: string }> = {
  'Alimentación': { icon: 'utensils', color: '#B4693C' },
  Auto: { icon: 'car', color: '#64748B' },
  Transporte: { icon: 'bus', color: '#0E8FA8' },
  Suscripciones: { icon: 'tv', color: '#8B7CF6' },
  Compras: { icon: 'shopping-bag', color: '#DB5A9A' },
  'Educación': { icon: 'graduation-cap', color: '#6366F1' },
  Otros: { icon: 'shapes', color: '#94A3B8' },
  'Plan Nube': { icon: 'cloud', color: '#7C6FE0' },
  Regalos: { icon: 'gift', color: '#C2569B' },
  'Bebé': { icon: 'baby', color: '#DB5A9A' },
  Hogar: { icon: 'house', color: '#14917F' },
  Servicios: { icon: 'zap', color: '#4F7BE8' },
  Familia: { icon: 'users', color: '#2F9E6B' },
  'Apoyo Familiar': { icon: 'hand-coins', color: '#2F9E6B' },
  Salud: { icon: 'stethoscope', color: '#0E8FA8' },
  'Salud Familiar': { icon: 'stethoscope', color: '#0E8FA8' },
  'Cuidado Personal': { icon: 'sparkles', color: '#C2569B' },
  'Herramientas y Equipamiento': { icon: 'wrench', color: '#8A6A4F' },
  Salidas: { icon: 'film', color: '#6B8E23' },
}

const MEDIOS: Record<string, { icon: LucideIcon; color: string }> = {
  yape: { icon: Smartphone, color: '#7B3FA0' },
  plin: { icon: Smartphone, color: '#0B9EA8' },
  sodexo: { icon: Ticket, color: '#D2463C' },
  transferencia: { icon: ArrowLeftRight, color: '#3B6FD9' },
  efectivo: { icon: Banknote, color: '#22A35A' },
  otros: { icon: Wallet, color: '#64748B' },
}

/** Orden pedido para medios de pago; los no listados van al final en su orden original. */
export const MEDIOS_ORDEN = ['Yape', 'Plin', 'Sodexo', 'Transferencia', 'Efectivo', 'Otros']

export function sortMedios(names: string[]): string[] {
  const pos = (n: string) => {
    if (n.trim().toLowerCase() === 'otros') return 100 // "Otros" siempre al final, también tras medios agregados
    const i = MEDIOS_ORDEN.findIndex(m => m.toLowerCase() === n.trim().toLowerCase())
    return i < 0 ? 99 : i
  }
  return names.map((n, i) => ({ n, i })).sort((a, b) => pos(a.n) - pos(b.n) || a.i - b.i).map(x => x.n)
}

export interface Look { Icon: LucideIcon; color: string }

function hashColor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
}

const pick = (stored: string | undefined, fallback: string) => (stored && /^#[0-9a-fA-F]{6}$/.test(stored) ? stored : fallback)

/** Estilo de un ámbito: lo guardado en el catálogo o el predeterminado. */
export function ambitoLook(name: string, catalogo: CatalogoItem[] = []): Look {
  const row = catalogo.find(c => c.ambito === name && !c.categoria)
  const def = AMBITOS[name] ?? { icon: 'tag', color: hashColor(name) }
  return { Icon: ICONS[row?.icono ?? ''] ?? ICONS[def.icon] ?? ICONS.tag, color: pick(row?.color, def.color) }
}

/** Estilo de una categoría (de un ámbito concreto si se indica). */
export function categoriaLook(name: string, catalogo: CatalogoItem[] = [], ambito?: string): Look {
  const row = catalogo.find(c => c.categoria === name && !c.subcategoria && (!ambito || c.ambito === ambito) && (c.icono || c.color))
  const def = CATEGORIAS[name] ?? { icon: 'tag', color: hashColor(name) }
  return { Icon: ICONS[row?.icono ?? ''] ?? ICONS[def.icon] ?? ICONS.tag, color: pick(row?.color, def.color) }
}

/**
 * Estilo de una subcategoría: el icono guardado en su fila del catálogo o, si no hay, el más relacionado con su
 * nombre (sugerencia contextual) y si no, el de su categoría. El color es siempre el de su categoría.
 */
const subCache = new Map<string, string>()
export function subcategoriaLook(sub: string, categoria: string, catalogo: CatalogoItem[] = [], ambito?: string): Look {
  const cat = categoriaLook(categoria, catalogo, ambito)
  const row = catalogo.find(c => c.subcategoria === sub && c.categoria === categoria && (!ambito || c.ambito === ambito) && c.icono)
  if (row?.icono && ICONS[row.icono]) return { Icon: ICONS[row.icono], color: cat.color }
  const k = `${categoria}|${sub}`
  let key = subCache.get(k)
  // Solo si el NOMBRE de la subcategoría coincide con algo; la categoría solo desempata (Gas en Auto → surtidor).
  if (key === undefined) { key = sugerirIconos(sub, [], 1).length ? sugerirIconos(sub, [categoria], 1)[0].key : ''; subCache.set(k, key) }
  return { Icon: (key && ICONS[key]) || cat.Icon, color: cat.color }
}

export function medioLook(name: string): Look {
  const key = name.trim().toLowerCase()
  const m = MEDIOS[key] ?? (key.includes('tarjeta') ? { icon: CreditCard, color: '#475569' } : MEDIOS.otros)
  return { Icon: m.icon, color: m.color }
}

/** Fondo pastel a partir del color (alfa en hexadecimal). */
export const soft = (hex: string, alpha = '1A') => `${hex}${alpha}`
