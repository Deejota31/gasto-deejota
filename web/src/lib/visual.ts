import {
  ArrowLeftRight, Baby, Banknote, Book, Briefcase, Building2, Bus, Car, Cloud, Coffee, CreditCard, Dumbbell, Film, Fuel,
  Gamepad2, Gift, GraduationCap, HandCoins, Heart, House, Lightbulb, Music, PartyPopper, PawPrint, Pill, Plane, Shapes,
  Shirt, ShoppingBag, ShoppingCart, Smartphone, Sofa, Sparkles, Stethoscope, Tag, Ticket, Tv, User, Users,
  UtensilsCrossed, Wallet, Wifi, Wrench, Zap, type LucideIcon,
} from 'lucide-react'
import type { CatalogoItem } from './types'

/** Iconos disponibles para ámbitos y categorías. La clave se guarda en la columna Icono de CATALOGO. */
export const ICONS: Record<string, LucideIcon> = {
  user: User, briefcase: Briefcase, heart: Heart, users: Users, 'party-popper': PartyPopper, house: House,
  utensils: UtensilsCrossed, coffee: Coffee, car: Car, fuel: Fuel, bus: Bus, plane: Plane, tv: Tv, film: Film, music: Music,
  gamepad: Gamepad2, 'shopping-bag': ShoppingBag, 'shopping-cart': ShoppingCart, shirt: Shirt, gift: Gift,
  'graduation-cap': GraduationCap, book: Book, baby: Baby, stethoscope: Stethoscope, pill: Pill, dumbbell: Dumbbell,
  'paw-print': PawPrint, sofa: Sofa, wrench: Wrench, zap: Zap, lightbulb: Lightbulb, wifi: Wifi, cloud: Cloud,
  sparkles: Sparkles, building: Building2, 'hand-coins': HandCoins, tag: Tag, shapes: Shapes,
}

/** Colores suaves para elegir. Todos mantienen contraste suficiente como texto/icono sobre su fondo pastel. */
export const COLORS = ['#4F7BE8', '#F07D69', '#8B7CF6', '#16A085', '#E86AA6', '#E0A030', '#0EA5C6', '#64748B', '#6366F1', '#22A35A', '#E25563', '#B07A4A']

const AMBITOS: Record<string, { icon: string; color: string }> = {
  Personal: { icon: 'user', color: '#4F7BE8' },
  Trabajo: { icon: 'briefcase', color: '#F07D69' },
  Pareja: { icon: 'heart', color: '#8B7CF6' },
  Familia: { icon: 'users', color: '#16A085' },
  Amigos: { icon: 'party-popper', color: '#E86AA6' },
}

const CATEGORIAS: Record<string, { icon: string; color: string }> = {
  'Alimentación': { icon: 'utensils', color: '#E0A030' },
  Auto: { icon: 'car', color: '#64748B' },
  Transporte: { icon: 'bus', color: '#0EA5C6' },
  Suscripciones: { icon: 'tv', color: '#8B7CF6' },
  Compras: { icon: 'shopping-bag', color: '#E86AA6' },
  'Educación': { icon: 'graduation-cap', color: '#6366F1' },
  Otros: { icon: 'shapes', color: '#94A3B8' },
  'Plan Nube': { icon: 'cloud', color: '#A78BFA' },
  Regalos: { icon: 'gift', color: '#E25563' },
  'Bebé': { icon: 'baby', color: '#EC6FA9' },
  Hogar: { icon: 'house', color: '#16A085' },
  Servicios: { icon: 'zap', color: '#0E9F8E' },
  Familia: { icon: 'users', color: '#22A35A' },
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
  return { Icon: ICONS[row?.icono ?? ''] ?? ICONS[def.icon], color: pick(row?.color, def.color) }
}

/** Estilo de una categoría (de un ámbito concreto si se indica). */
export function categoriaLook(name: string, catalogo: CatalogoItem[] = [], ambito?: string): Look {
  const row = catalogo.find(c => c.categoria === name && !c.subcategoria && (!ambito || c.ambito === ambito) && (c.icono || c.color))
  const def = CATEGORIAS[name] ?? { icon: 'tag', color: hashColor(name) }
  return { Icon: ICONS[row?.icono ?? ''] ?? ICONS[def.icon], color: pick(row?.color, def.color) }
}

export function medioLook(name: string): Look {
  const key = name.trim().toLowerCase()
  const m = MEDIOS[key] ?? (key.includes('tarjeta') ? { icon: CreditCard, color: '#475569' } : MEDIOS.otros)
  return { Icon: m.icon, color: m.color }
}

/** Fondo pastel a partir del color (alfa en hexadecimal). */
export const soft = (hex: string, alpha = '1A') => `${hex}${alpha}`
