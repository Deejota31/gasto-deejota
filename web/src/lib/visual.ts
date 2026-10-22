import { mediosDeFondo } from './fondoMedios'
import { ArrowLeftRight, Banknote, CreditCard, Smartphone, Ticket, Wallet, type LucideIcon } from 'lucide-react'
import type { CatalogoItem, Fondo } from './types'
import { ICONOS, ICONS, sugerirIconos } from './iconos'

export { ICONS }

/**
 * Sistema de color (v1.9). Dos familias que no se mezclan:
 *  - ESTADOS: verde = bien, ámbar = atención, rojo = alerta/exceso, azul = información/acción. Solo para estados.
 *  - CLASIFICACIÓN: paleta reducida para ámbitos, categorías y fondos, sin rojos ni ámbar puros para no confundirse
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

/**
 * Paleta amplia para los selectores (v1.10): 16 familias × 4 tonos. Todas con contraste suficiente como icono sobre
 * blanco; el primer tono de cada familia es el "base". `COLORS` (arriba) sigue siendo la paleta de los predeterminados.
 */
export const PALETA: { nombre: string; tonos: string[] }[] = [
  { nombre: 'Rojo', tonos: ['#E5484D', '#C0362C', '#A52A2A', '#F0777A'] },
  { nombre: 'Naranja', tonos: ['#F76B15', '#D2640E', '#B4693C', '#FF9A5C'] },
  { nombre: 'Ámbar', tonos: ['#F5A524', '#D69E2E', '#B7791F', '#E8B84A'] },
  { nombre: 'Lima', tonos: ['#84A515', '#6B8E23', '#4D7C0F', '#A3C23A'] },
  { nombre: 'Verde', tonos: ['#2F9E6B', '#22A35A', '#15803D', '#5BBF8A'] },
  { nombre: 'Esmeralda', tonos: ['#14917F', '#0F8A6B', '#0B6B55', '#3DB8A4'] },
  { nombre: 'Turquesa', tonos: ['#0E8FA8', '#0B9EA8', '#0B7285', '#3DB5C7'] },
  { nombre: 'Celeste', tonos: ['#3B9BE0', '#2B84C6', '#1C6BA8', '#6DB5EA'] },
  { nombre: 'Azul', tonos: ['#4F7BE8', '#3B6FD9', '#1E3A8A', '#7C9BF0'] },
  { nombre: 'Índigo', tonos: ['#6366F1', '#4F46E5', '#3730A3', '#8B8FF5'] },
  { nombre: 'Violeta', tonos: ['#8B7CF6', '#7B3FA0', '#6D5BD0', '#A99BF8'] },
  { nombre: 'Fucsia', tonos: ['#C2569B', '#A8338A', '#86227A', '#D985BC'] },
  { nombre: 'Rosa', tonos: ['#DB5A9A', '#E0457B', '#BE3A6E', '#EE86B3'] },
  { nombre: 'Marrón', tonos: ['#8A6A4F', '#7A5A3E', '#5F4632', '#A98A70'] },
  { nombre: 'Gris azulado', tonos: ['#64748B', '#475569', '#334155', '#94A3B8'] },
  { nombre: 'Neutro', tonos: ['#6B7280', '#4B5563', '#1F2937', '#9CA3AF'] },
]

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
  Viajes: { icon: 'plane', color: '#0B7285' },
  Mascotas: { icon: 'paw-print', color: '#8A6A4F' },
  Impuestos: { icon: 'landmark', color: '#475569' },
  Ahorro: { icon: 'piggy-bank', color: '#0F8A6B' },
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

/**
 * Las categorías y subcategorías se COMPARTEN entre ámbitos: "Alimentación" es la misma en Personal, Trabajo o Amigos,
 * así que su icono y color también. Se toma el primero guardado en cualquier ámbito (al editar, el backend los
 * escribe en todos). El parámetro de ámbito se acepta por compatibilidad, pero ya no cambia el resultado.
 */
const hexOk = (v: string | undefined): v is string => !!v && /^#[0-9a-fA-F]{6}$/.test(v)
export function categoriaLook(name: string, catalogo: CatalogoItem[] = [], _ambito?: string): Look {
  const rows = catalogo.filter(c => c.categoria === name && !c.subcategoria)
  const def = CATEGORIAS[name] ?? { icon: 'tag', color: hashColor(name) }
  const icono = rows.find(r => r.icono && ICONS[r.icono])?.icono
  const color = rows.find(r => hexOk(r.color))?.color
  return { Icon: ICONS[icono ?? ''] ?? ICONS[def.icon] ?? ICONS.tag, color: pick(color, def.color) }
}

/**
 * Estilo de una subcategoría: el icono guardado en su fila del catálogo (de cualquier ámbito: se comparte) o, si no hay,
 * el más relacionado con su nombre (sugerencia contextual) y si no, el de su categoría. El color es el de su categoría.
 */
const subCache = new Map<string, string>()
export function subcategoriaLook(sub: string, categoria: string, catalogo: CatalogoItem[] = [], _ambito?: string): Look {
  const cat = categoriaLook(categoria, catalogo)
  const row = catalogo.find(c => c.subcategoria === sub && c.categoria === categoria && c.icono && ICONS[c.icono])
  if (row) return { Icon: ICONS[row.icono ?? ""], color: cat.color }
  const k = `${categoria}|${sub}`
  let key = subCache.get(k)
  // Solo si el NOMBRE de la subcategoría coincide con algo; la categoría solo desempata (Gas en Auto → surtidor).
  if (key === undefined) { key = sugerirIconos(sub, [], 1).length ? sugerirIconos(sub, [categoria], 1)[0].key : ''; subCache.set(k, key) }
  return { Icon: (key && ICONS[key]) || cat.Icon, color: cat.color }
}

/** Icono/color elegidos por el usuario para cada medio (vienen de la hoja MEDIOS_PAGO); mandan sobre los predeterminados. */
const mediosElegidos = new Map<string, { icono: string; color: string }>()
export function registrarMedios(medios: { nombre: string; icono?: string; color?: string }[]) {
  mediosElegidos.clear()
  for (const m of medios) mediosElegidos.set(m.nombre.trim().toLowerCase(), { icono: m.icono ?? '', color: m.color ?? '' })
}

/** Aspecto predeterminado de un medio (sin lo elegido por el usuario). */
export function medioLookBase(name: string): Look {
  const key = name.trim().toLowerCase()
  const m = MEDIOS[key] ?? (key.includes('tarjeta') ? { icon: CreditCard, color: '#475569' } : MEDIOS.otros)
  return { Icon: m.icon, color: m.color }
}

export function medioLook(name: string): Look {
  const base = medioLookBase(name)
  const e = mediosElegidos.get(name.trim().toLowerCase())
  if (!e) return base
  return { Icon: (e.icono && ICONS[e.icono]) || base.Icon, color: /^#[0-9a-fA-F]{6}$/.test(e.color) ? e.color : base.color }
}

/** Fondo pastel a partir del color (alfa en hexadecimal). */
export const soft = (hex: string, alpha = '1A') => `${hex}${alpha}`


/* ---------------------------------------------------------------------------------------------------------------
 * Coherencia visual (v1.10): un medio de pago o un fondo se ven igual en TODA la web.
 *  - Medio de pago: su icono y color propios (arriba).
 *  - Fondo: lo que elijas (icono + color); si no eliges nada ("automático"), hereda el de su medio de pago
 *    y, si no tiene medio, uno según su nombre.
 * "Elegido" = la fila tiene icono guardado; mientras no lo tenga, el color guardado se ignora y manda el automático.
 * ------------------------------------------------------------------------------------------------------------- */

/** Clave de icono → componente inverso: para guardar como elegido el icono que se estaba viendo automáticamente. */
const CLAVE_DE = new Map<LucideIcon, string>()
for (const i of ICONOS) if (!CLAVE_DE.has(i.Icon)) CLAVE_DE.set(i.Icon, i.key)
export const claveDeIcono = (Icon: LucideIcon): string => CLAVE_DE.get(Icon) ?? 'tag'

/** Aspecto del fondo General (y de toda fondo libre sin icono propio): billete en azul marino. */
const LIBRE_BASE: Look = { Icon: ICONS.banknote, color: '#1E3A8A' }
const esGeneral = (f: Pick<Fondo, 'nombre' | 'medioPago'>) => !mediosDeFondo(f.medioPago).length && f.nombre.trim().toLowerCase() === 'general'

/** Aspecto del fondo que elegiste (icono guardado) o, si no, el automático de ese caso. */
function propio(f: Pick<Fondo, 'icono' | 'color'>): Look | null {
  return f.icono && ICONS[f.icono] ? { Icon: ICONS[f.icono], color: pick(f.color, LIBRE_BASE.color) } : null
}

/**
 * Estilo de un fondo del presupuesto:
 *  1. lo que elegiste (icono + color);
 *  2. si tiene medio de pago, el de ese medio (Yape se ve como Yape en todas partes);
 *  3. si es libre, el del fondo General (la que tengas llamada así, con lo que haya elegido; si no, el base).
 * `todas` permite encontrar a General; sin ella se usa el aspecto base.
 */
export function fondoLook(f: Pick<Fondo, 'nombre' | 'medioPago' | 'icono' | 'color'>, todas: Pick<Fondo, 'nombre' | 'medioPago' | 'icono' | 'color'>[] = []): Look {
  const mio = propio(f)
  if (mio) return mio
  const ms = mediosDeFondo(f.medioPago)
  if (ms.length) return medioLook(ms[0])
  const general = todas.find(esGeneral)
  return (general && propio(general)) || LIBRE_BASE
}

