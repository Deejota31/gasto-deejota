// Normalización de descripciones: una sola función para nuevo gasto, edición, clonación y plantillas.
// Solo se aplica a lo que el usuario escribe ahora (al salir del campo y al guardar); nunca a registros antiguos.

/**
 * Palabras secundarias que van en minúscula salvo al inicio de la descripción (lista oficial del usuario).
 * Misma lista en apps-script/Code.gs (DESC_MINUSCULAS_): si se cambia aquí, cambiarla allá (hay una prueba que las compara).
 */
export const MINUSCULAS_LISTA = ['de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'se', 'del', 'las', 'un', 'por', 'con', 'no', 'una', 'su', 'para', 'al', 'lo', 'como', 'más', 'o', 'pero', 'sus', 'le', 'me', 'si', 'sin', 'sobre', 'este', 'ya', 'entre', 'cuando', 'todo', 'esta', 'son', 'también', 'hasta', 'desde', 'mi', 'porque', 'qué', 'nos', 'ni', 'uno', 'donde', 'cada', 'e', 'otro', 'te', 'otros', 'aunque', 'esa', 'eso', 'otra', 'tan', 'durante', 'tanto', 'ella', 'él', 'yo', 'tú', 'tu', 'tus', 'mis', 'nuestro', 'nuestra', 'nuestros', 'nuestras', 'suyo', 'suya', 'suyos', 'suyas', 'aquel', 'aquella', 'aquellos', 'aquellas', 'estos', 'estas', 'ese', 'esos', 'esas', 'aquello', 'unas', 'unos', 'algo', 'alguien', 'nadie', 'nada', 'cual', 'cuáles', 'quien', 'quienes', 'cuyo', 'cuya', 'cuyos', 'cuyas', 'hacia', 'según']
const MINUSCULAS = new Set(MINUSCULAS_LISTA)

/**
 * Excepciones de escritura (prioridad máxima): marcas, siglas y expresiones con una forma propia.
 * Una entrada puede ser una palabra ("iPhone") o una expresión ("papa a la Huancaina"); se compara sin distinguir
 * mayúsculas y palabra completa. El usuario puede añadir más en Configuración (clave desc_excepciones, separadas por coma).
 */
export const EXCEPCIONES_BASE = ['ChatGPT', 'Google', 'YouTube', 'HBO', 'SOAT', 'Netflix', 'Spotify', 'Yape', 'Plin', 'USD', 'PEN', 'API', 'WiFi',
  'iPhone', 'iPad', 'Claude', 'Cluely', 'Crunchyroll', 'Sodexo', 'KFC', 'BCP', 'BBVA', 'Interbank', 'Uber', 'Cabify', 'Rappi',
  'PedidosYa', 'Amazon', 'Disney+', 'WhatsApp', 'iCloud', 'IGV', 'SUNAT', 'papa a la Huancaina']
let extras: string[] = []
/** Excepciones propias del usuario (texto "a, b, c" de la configuración). */
export function configurarExcepciones(csv: string | undefined) { extras = (csv ?? '').split(',').map(x => x.trim()).filter(Boolean) }
const PARTE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}+]*)$/u
const partir = (palabra: string) => { const m = palabra.match(PARTE); return m ? { pre: m[1], core: m[2], post: m[3] } : { pre: '', core: '', post: palabra } }

/** Subcategorías poco informativas como descripción: se deja vacío para escribir algo más específico. */
const GENERICAS = new Set(['otros', 'por clasificar'])

/** Descripción sugerida al elegir una subcategoría ("" si es genérica). */
export function descripcionDeSubcategoria(sub: string): string {
  const s = sub.trim().replace(/\s+/g, ' ')
  return GENERICAS.has(s.toLowerCase()) ? '' : s
}

function capitalizarCore(core: string, inicio: boolean): string {
  if (/\p{N}/u.test(core)) return core                                  // números y cosas como 4g: se respetan
  return core.split(/([-/])/).map((seg, i) => {
    if (seg === '-' || seg === '/' || !seg) return seg
    const lower = seg.toLowerCase()
    if (!(inicio && i === 0) && MINUSCULAS.has(lower)) return lower
    return lower.charAt(0).toUpperCase() + lower.slice(1)
  }).join('')
}

/**
 * "arroz con pollo" → "Arroz con Pollo"; "TALLARINES AL HORNO CON PAPA A LA HUANCAINA" → "Tallarines al Horno con papa a la Huancaina".
 * Prioridad: 1) excepciones de marca o expresión, 2) primera palabra, 3) lista de palabras secundarias, 4) mayúscula inicial.
 * Conserva tildes, ñ, números, signos y emojis; solo limpia espacios sobrantes; no corrige ortografía. Determinista e idempotente.
 * La misma regla vive en el backend (normalizarDescripcion_ en Code.gs): lo que se guarda en Sheets es idéntico.
 */
export function formatearDescripcion(texto: string): string {
  const limpio = texto.trim().replace(/\s+/g, ' ')
  if (!limpio) return ''
  const toks = limpio.split(' ').map(partir)
  const fijo: (string | undefined)[] = new Array(toks.length).fill(undefined)
  const ex = [...EXCEPCIONES_BASE, ...extras].map(e => e.trim().split(/\s+/)).filter(w => w[0]).sort((a, b) => b.length - a.length)
  for (let i = 0; i < toks.length; i++) {
    if (fijo[i] !== undefined || !toks[i].core) continue
    for (const e of ex) {
      if (i + e.length > toks.length) continue
      if (e.every((w, k) => fijo[i + k] === undefined && toks[i + k].core.toLowerCase() === w.toLowerCase())) { e.forEach((w, k) => { fijo[i + k] = w }); break }
    }
  }
  let primera = true
  return toks.map((t, i) => {
    if (!t.core) return t.pre + t.post
    const out = fijo[i] !== undefined ? fijo[i]! : capitalizarCore(t.core, primera)
    primera = false
    return t.pre + out + t.post
  }).join(' ')
}
