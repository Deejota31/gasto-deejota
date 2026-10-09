import { z } from 'zod'
import { TIPOS_GASTO, type AppData, type Caja, type CatalogoItem, type Gasto, type Medio, type Presupuesto } from './types'

/** Cliente de la API de Apps Script. Todas las acciones van por POST con text/plain (sin preflight CORS). */

export interface Connection { url: string; token: string }
const STORAGE_KEY = 'gd.connection'

export function loadConnection(): Connection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const c = raw ? JSON.parse(raw) : null
    return c && typeof c.url === 'string' && typeof c.token === 'string' ? c : null
  } catch { return null }
}

export function saveConnection(c: Connection | null) {
  try { c ? localStorage.setItem(STORAGE_KEY, JSON.stringify(c)) : localStorage.removeItem(STORAGE_KEY) } catch { /* modo privado */ }
}

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

const envelope = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  ms: z.number().optional(),
})

const RETRYABLE = new Set(['NETWORK', 'TIMEOUT', 'BUSY', 'HTTP'])
const TIMEOUT_MS = 30_000

export type Transport = (action: string, payload: unknown) => Promise<unknown>

export function httpTransport(conn: Connection, fetchImpl: typeof fetch = fetch, sleep = (ms: number) => new Promise(r => setTimeout(r, ms))): Transport {
  return async (action, payload) => {
    let lastError: ApiError | null = null
    // Todas las acciones son idempotentes (el alta lleva su UUID), así que reintentar es seguro. Máximo 3 intentos.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await sleep(1000 * attempt)
      try {
        return await once(conn, action, payload, fetchImpl)
      } catch (e) {
        lastError = e instanceof ApiError ? e : new ApiError('NETWORK', 'Error de red.')
        if (!RETRYABLE.has(lastError.code)) throw lastError
      }
    }
    throw lastError!
  }
}

async function once(conn: Connection, action: string, payload: unknown, fetchImpl: typeof fetch): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetchImpl(conn.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: conn.token, action, payload }),
      redirect: 'follow',
      signal: ctrl.signal,
    })
  } catch (e) {
    throw (e as Error).name === 'AbortError'
      ? new ApiError('TIMEOUT', 'Apps Script tardó demasiado en responder.')
      : new ApiError('NETWORK', 'No se pudo conectar con Apps Script. Revisa tu conexión y la URL.')
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new ApiError('HTTP', `Apps Script respondió ${res.status}.`)
  let json: unknown
  try { json = await res.json() } catch {
    // Una página HTML en lugar de JSON suele indicar despliegue sin acceso "Cualquier persona" o URL incorrecta.
    throw new ApiError('INVALID_RESPONSE', 'Respuesta inválida. Verifica que la URL sea la del despliegue /exec con acceso "Cualquier persona".')
  }
  const env = envelope.safeParse(json)
  if (!env.success) throw new ApiError('INVALID_RESPONSE', 'Respuesta con formato inesperado.')
  if (!env.data.ok) throw new ApiError(env.data.error?.code ?? 'SERVER_ERROR', env.data.error?.message ?? 'Error desconocido.')
  return env.data.data
}

/* ============ Conversión de filas de la hoja ↔ objetos tipados ============ */

const str = z.string()
const gastoRow = z.tuple([str, z.number(), str, str, str, str, str, str, str, z.boolean(), str, str, str, str, str, str])

export function rowToGasto(r: z.infer<typeof gastoRow>): Gasto {
  return {
    fecha: r[0], monto: r[1], moneda: r[2], categoria: r[3], subcategoria: r[4], descripcion: r[5], medioPago: r[6],
    tipoGasto: (TIPOS_GASTO as readonly string[]).includes(r[7]) ? (r[7] as Gasto['tipoGasto']) : 'Variable',
    ambito: r[8], esRecurrente: r[9], estado: r[10] === 'Anulado' ? 'Anulado' : 'Activo', origen: r[11],
    comprobanteUrl: r[12], id: r[13], creadoEn: r[14], actualizadoEn: r[15],
  }
}

// [ámbito, categoría, subcategoría, activo, icono?, color?, orden?] — un backend 1.0 envía solo las 4 primeras.
const catRow = z.tuple([str, str, str, z.boolean()]).rest(z.union([str, z.number()]))
const toCatalogo = ([ambito, categoria, subcategoria, activo, icono = '', color = '', orden]: z.infer<typeof catRow>): CatalogoItem => ({
  ambito, categoria, subcategoria, activo, icono: String(icono), color: String(color),
  ...(orden !== '' && orden !== undefined && Number.isFinite(Number(orden)) ? { orden: Number(orden) } : {}),
})

const dataSchema = z.object({
  version: str,
  sheetUrl: str,
  gastos: z.array(gastoRow),
  catalogo: z.array(catRow),
  medios: z.array(z.tuple([str, z.boolean()])),
  cajas: z.array(z.tuple([str, str, z.number(), str, str, str, z.number()])),
  presupuestos: z.array(z.tuple([str, str, z.number()])),
  config: z.record(str, str),
})

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) throw new ApiError('INVALID_RESPONSE', 'Los datos de la hoja tienen un formato inesperado.')
  return r.data
}

const FILTRO_CAMPOS = ['Todos', 'Ámbito', 'Categoría', 'Subcategoría', 'Medio de pago'] as const
const toCaja = (r: [string, string, number, string, string, string, number]): Caja => ({
  id: r[0], nombre: r[1], presupuesto: r[2],
  filtroCampo: (FILTRO_CAMPOS as readonly string[]).includes(r[3]) ? (r[3] as Caja['filtroCampo']) : 'Todos',
  filtroValor: r[4], color: r[5] || '#1e3a8a', orden: r[6],
})

export type GastoInput = Omit<Gasto, 'estado' | 'origen' | 'creadoEn' | 'actualizadoEn'>

/** API de alto nivel usada por la app. El transporte puede ser HTTP real o el modo demo. */
/** Mismo criterio que requireId_ en Code.gs: un ID que no cumple no se puede editar ni eliminar desde la app. */
export const ID_VALIDO = /^[0-9a-fA-F-]{8,64}$/

/**
 * Marca gastos cuyo ID repetido o inválido (p. ej. escrito a mano en la hoja) impediría editarlos con seguridad:
 * con un ID repetido, editar uno modificaría el otro. Cada fila recibe además una clave única para la interfaz.
 */
export function marcarIds(gastos: Gasto[]): Gasto[] {
  const count = new Map<string, number>()
  for (const g of gastos) count.set(g.id.toLowerCase(), (count.get(g.id.toLowerCase()) ?? 0) + 1)
  const seen = new Map<string, number>()
  return gastos.map(g => {
    const k = g.id.toLowerCase()
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    const problemaId = !ID_VALIDO.test(g.id) ? 'invalido' as const : (count.get(k) ?? 0) > 1 ? 'duplicado' as const : undefined
    return { ...g, uid: n ? `${g.id}#${n}` : g.id, ...(problemaId ? { problemaId } : {}) }
  })
}

export function createApi(t: Transport) {
  let inflight: Promise<AppData> | null = null
  return {
    /** Una sola lectura de todo; llamadas simultáneas comparten la misma petición. */
    getData(fresh = false): Promise<AppData> {
      inflight ??= t('data', { fresh }).then(raw => {
        const d = parse(dataSchema, raw)
        return {
          version: d.version, sheetUrl: d.sheetUrl, config: d.config,
          gastos: marcarIds(d.gastos.map(rowToGasto)),
          catalogo: d.catalogo.map(toCatalogo),
          medios: d.medios.map(([nombre, activo]): Medio => ({ nombre, activo })),
          cajas: d.cajas.map(toCaja),
          presupuestos: d.presupuestos.map(([periodo, cajaId, monto]): Presupuesto => ({ periodo, cajaId, monto })),
        }
      }).finally(() => { inflight = null })
      return inflight
    },
    async saveGasto(g: GastoInput, mode: 'create' | 'update'): Promise<Gasto> {
      return rowToGasto(parse(gastoRow, await t('saveGasto', { ...g, mode })))
    },
    async setEstado(id: string, estado: 'Activo' | 'Anulado'): Promise<{ actualizadoEn: string }> {
      return parse(z.object({ actualizadoEn: str }), await t('setEstado', { id, estado }))
    },
    async saveCatalogo(item: CatalogoItem): Promise<CatalogoItem> {
      return toCatalogo(parse(catRow, await t('saveCatalogo', item)))
    },
    /** Renombra en el catálogo y en todos los gastos que usan ese nombre (dentro del mismo ámbito/categoría). */
    async renameCatalogo(p: { nivel: 'ambito' | 'categoria' | 'subcategoria'; ambito: string; categoria?: string; subcategoria?: string; nuevo: string }) {
      return parse(z.object({ catalogo: z.number(), gastos: z.number() }), await t('renameCatalogo', p))
    },
    async saveMedio(m: Medio): Promise<Medio> {
      const [nombre, activo] = parse(z.tuple([str, z.boolean()]), await t('saveMedio', m))
      return { nombre, activo }
    },
    async saveCaja(c: Caja): Promise<Caja> {
      return toCaja(parse(z.tuple([str, str, z.number(), str, str, str, z.number()]), await t('saveCaja', c)))
    },
    async savePresupuesto(p: Presupuesto): Promise<Presupuesto> {
      const [periodo, cajaId, monto] = parse(z.tuple([str, str, z.number()]), await t('savePresupuesto', p))
      return { periodo, cajaId, monto }
    },
    async saveConfig(clave: string, valor: string): Promise<void> {
      await t('saveConfig', { clave, valor })
    },
    diagnose: () => t('diagnose', {}) as Promise<Record<string, unknown>>,
    backup: () => t('backup', {}) as Promise<{ nombre: string; url: string }>,
  }
}

export type Api = ReturnType<typeof createApi>
