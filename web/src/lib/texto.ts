// Normalización de descripciones: una sola función para nuevo gasto, edición, clonación y plantillas.
// Solo se aplica a lo que el usuario escribe ahora (al salir del campo y al guardar); nunca a registros antiguos.

/** Artículos, preposiciones y conectores que van en minúscula salvo al inicio. */
const MINUSCULAS = new Set([
  'a', 'al', 'ante', 'bajo', 'con', 'contra', 'de', 'del', 'desde', 'durante', 'e', 'el', 'en', 'entre', 'hacia', 'hasta',
  'la', 'las', 'lo', 'los', 'o', 'para', 'por', 'sin', 'sobre', 'tras', 'u', 'un', 'una', 'unos', 'unas', 'y',
])

/** Marcas y siglas con escritura propia: se escriben siempre así, se tipeen como se tipeen. */
const MARCAS = new Map(['ChatGPT', 'Google', 'YouTube', 'HBO', 'SOAT', 'Netflix', 'Spotify', 'Yape', 'Plin', 'USD', 'PEN', 'WiFi',
  'iPhone', 'iPad', 'Claude', 'Cluely', 'Crunchyroll', 'Sodexo', 'KFC', 'BCP', 'BBVA', 'Interbank', 'Uber', 'Cabify', 'Rappi',
  'PedidosYa', 'Amazon', 'Disney+', 'WhatsApp', 'iCloud', 'IGV', 'SUNAT'].map(m => [m.toLowerCase(), m]))

/** Subcategorías poco informativas como descripción: se deja vacío para escribir algo más específico. */
const GENERICAS = new Set(['otros', 'por clasificar'])

/** Descripción sugerida al elegir una subcategoría ("" si es genérica). */
export function descripcionDeSubcategoria(sub: string): string {
  const s = sub.trim().replace(/\s+/g, ' ')
  return GENERICAS.has(s.toLowerCase()) ? '' : s
}

function formatearPalabra(palabra: string, inicio: boolean): string {
  // Separa signos al borde ("(taxi," → "(", "taxi", ",") para no tocarlos.
  const m = palabra.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}+]*)$/u)
  if (!m || !m[2]) return palabra
  const [, pre, core, post] = m
  const marca = MARCAS.get(core.toLowerCase())
  if (marca) return pre + marca + post
  // Escritura especial que puso el usuario: siglas (SOAT), mayúsculas internas (iPhone), números (4G): se respeta.
  if (/\p{N}/u.test(core) || (core.length > 1 && core === core.toUpperCase() && /\p{L}{2}/u.test(core)) || /\p{Ll}\p{Lu}/u.test(core)) return palabra
  const lower = core.toLowerCase()
  if (!inicio && MINUSCULAS.has(lower)) return pre + lower + post
  return pre + lower.charAt(0).toUpperCase() + lower.slice(1) + post
}

/**
 * "compra de ropa para la bebe" → "Compra de Ropa para la Bebe".
 * Conserva tildes, números, signos y emojis; quita espacios sobrantes; no corrige ortografía.
 */
export function formatearDescripcion(texto: string): string {
  const limpio = texto.trim().replace(/\s+/g, ' ')
  if (!limpio) return ''
  let primera = true
  return limpio.split(' ').map(p => {
    const out = formatearPalabra(p, primera)
    if (/[\p{L}\p{N}]/u.test(p)) primera = false
    return out
  }).join(' ')
}
