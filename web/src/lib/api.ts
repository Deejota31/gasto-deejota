import { z } from 'zod'
import { TIPOS_GASTO, TIPOS_FONDO, type EstadoRevisionPres, type RevisionPres, type TipoFondo, type AppData, type Caja, type CatalogoItem, type EstadoRevision, type Fondo, type FondoMes, type PlantillaFin, type TipoPlantillaFin, type Gasto, type Medio, type Plantilla, type Presupuesto, type Revision, type TipoGasto } from './types'

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

/** Valida la URL del despliegue y el token antes de guardarlos. Devuelve el mensaje de error o null si está bien. */
export function validarConexion(url: string, token: string): string | null {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url.trim())) return 'La URL debe ser la del despliegue: https://script.google.com/macros/s/…/exec'
  if (token.trim().length < 16) return 'El token parece incompleto. Cópialo del registro de setup().'
  return null
}

export function saveConnection(c: Connection | null) {
  try { c ? localStorage.setItem(STORAGE_KEY, JSON.stringify(c)) : localStorage.removeItem(STORAGE_KEY) } catch { /* modo privado */ }
}

export class ApiError extends Error {
  code: string
  /** Fallo transitorio de Google/Apps Script (saturación, 404 temporal, HTML en vez de JSON): reintentar es seguro. */
  reintentable: boolean
  constructor(code: string, message: string, reintentable = false) { super(message); this.code = code; this.reintentable = reintentable }
}

const envelope = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  ms: z.number().optional(),
})

const RETRYABLE = new Set(['NETWORK', 'TIMEOUT', 'BUSY', 'HTTP'])
/** Apps Script tarda 12–33 s en responder cuando está frío o saturado: el tiempo máximo por intento lo tolera. */
const TIMEOUT_MS = 45_000
/** Códigos HTTP transitorios: límite de uso, errores de servidor y el 404 que Google devuelve a veces al redistribuir el despliegue. */
const HTTP_TRANSITORIO = new Set([404, 408, 425, 429, 500, 502, 503, 504])
const ESPERAS_MS = [1000, 3000, 7000]   // backoff exponencial entre los 4 intentos
/** Espera antes del reintento nº `n` (1..3): 1 s, 3 s, 7 s con ±30 % de jitter para no sincronizar reintentos. */
export const retardoReintento = (n: number, rnd: () => number = Math.random) => Math.round(ESPERAS_MS[Math.min(n, ESPERAS_MS.length) - 1] * (0.7 + 0.6 * rnd()))
const depurar = () => { try { return new URLSearchParams(location.search).get('debug') === '1' } catch { return false } }

/** Calienta Apps Script (arranque en frío) con un GET sin esperar ni leer la respuesta. Nunca bloquea ni falla. */
export function calentar(conn: Connection, fetchImpl: typeof fetch = fetch): void {
  try { void fetchImpl(conn.url, { method: 'GET', mode: 'no-cors', cache: 'no-store' }).catch(() => undefined) } catch { /* sin red: no importa */ }
}

/** `extra.adminToken`: credencial de las funciones de administración (S-04). Nunca se guarda: se pasa solo en esa llamada. */
export type Transport = (action: string, payload: unknown, extra?: { adminToken?: string }) => Promise<unknown>

export function httpTransport(conn: Connection, fetchImpl: typeof fetch = fetch, sleep = (ms: number) => new Promise(r => setTimeout(r, ms))): Transport {
  return async (action, payload, extra) => {
    let lastError: ApiError | null = null
    // Todas las acciones son idempotentes (el alta lleva su UUID), así que reintentar es seguro. Máximo 4 intentos (1 s, 3 s, 7 s entre ellos).
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await sleep(retardoReintento(attempt))
      try {
        return await once(conn, action, payload, fetchImpl, extra)
      } catch (e) {
        lastError = e instanceof ApiError ? e : new ApiError('NETWORK', 'Error de red.')
        if (!RETRYABLE.has(lastError.code) && !lastError.reintentable) throw lastError
      }
    }
    throw lastError!
  }
}

async function once(conn: Connection, action: string, payload: unknown, fetchImpl: typeof fetch, extra?: { adminToken?: string }): Promise<unknown> {
  const ctrl = new AbortController()
  const t0 = performance.now()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetchImpl(conn.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: conn.token, action, payload, ...(extra?.adminToken ? { adminToken: extra.adminToken } : {}) }),
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
  if (!res.ok) throw new ApiError(HTTP_TRANSITORIO.has(res.status) ? 'HTTP' : 'HTTP_FATAL', `Apps Script respondió ${res.status}.`)
  let texto = ''
  try { texto = await res.text() } catch { /* cuerpo ilegible */ }
  let json: unknown
  try { json = JSON.parse(texto) } catch {
    // Una página HTML en lugar de JSON: Google saturado (transitorio) o despliegue sin acceso "Cualquier persona" / URL incorrecta.
    throw new ApiError('INVALID_RESPONSE', 'Respuesta inválida. Verifica que la URL sea la del despliegue /exec con acceso "Cualquier persona".', /^\s*</.test(texto))
  }
  const env = envelope.safeParse(json)
  if (!env.success) throw new ApiError('INVALID_RESPONSE', 'Respuesta con formato inesperado.')
  if (depurar()) console.debug(`[gd] ${action}: ${Math.round(performance.now() - t0)} ms en total · servidor ${env.data.ms ?? '?'} ms`)
  if (!env.data.ok) throw new ApiError(env.data.error?.code ?? 'SERVER_ERROR', env.data.error?.message ?? 'Error desconocido.')
  return env.data.data
}

/* ============ Conversión de filas de la hoja ↔ objetos tipados ============ */

const str = z.string()
// La fila de un gasto tolera los tipos "casi correctos" que Sheets puede devolver (texto, nulos, fechas ISO completas,
// "TRUE") y los convierte; lo que de verdad no se puede interpretar (monto "abc") sigue siendo un error.
const strC = z.preprocess(v => (v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v)), z.string())
const fechaC = z.preprocess(v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : v === null || v === undefined ? '' : String(v)), z.string())
const numC = z.preprocess(v => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v), z.number())
const boolC = z.preprocess(v => (typeof v === 'string' ? v.trim().toUpperCase() === 'TRUE' : v === 1 ? true : v === 0 || v === null || v === undefined ? false : v), z.boolean())
const gastoRow = z.tuple([fechaC, numC, strC, strC, strC, strC, strC, strC, strC, boolC, strC, strC, strC, strC, strC, strC])

export function rowToGasto(r: z.infer<typeof gastoRow>): Gasto {
  return {
    fecha: r[0], monto: r[1], moneda: r[2], categoria: r[3], subcategoria: r[4], descripcion: r[5], medioPago: r[6],
    tipoGasto: (TIPOS_GASTO as readonly string[]).includes(r[7]) ? (r[7] as Gasto['tipoGasto']) : 'Variable',
    ambito: r[8], esRecurrente: r[9], estado: r[10] === 'Anulado' ? 'Anulado' : 'Activo', origen: r[11],
    comprobanteUrl: r[12], id: r[13], creadoEn: r[14], actualizadoEn: r[15],
    ...(r[10] !== 'Activo' && r[10] !== 'Anulado' ? { estadoHoja: r[10] } : {}),
  }
}

// [ámbito, categoría, subcategoría, activo, icono?, color?, orden?] — un backend 1.0 envía solo las 4 primeras.
const catRow = z.tuple([str, str, str, z.boolean()]).rest(z.union([str, z.number()]))
const toMedio = ([nombre, activo, icono, color]: unknown[]): Medio => ({
  nombre: String(nombre), activo: activo === true,
  icono: typeof icono === 'string' && /^[a-z0-9-]{1,30}$/.test(icono) ? icono : '',
  color: typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '',
})

const toCatalogo = ([ambito, categoria, subcategoria, activo, icono = '', color = '', orden]: z.infer<typeof catRow>): CatalogoItem => ({
  ambito, categoria, subcategoria, activo, icono: String(icono), color: String(color),
  ...(orden !== '' && orden !== undefined && Number.isFinite(Number(orden)) ? { orden: Number(orden) } : {}),
})

// [id, ámbito, categoría, subcategoría, descripción, creado, actualizado]
// [id, ámbito, categoría, subcategoría, descripción, creado, actualizado, monto?, moneda?, medio?, orden?] (v1.3 envía solo 7)
const optNum = (v: unknown) => (v === '' || v === undefined || v === null || !Number.isFinite(Number(v)) ? null : Number(v))
// v1.5 agrega "Es compromiso" (booleano) al final.
const plantillaRowV15 = z.tuple([str, str, str, str, str, str, str]).rest(z.union([str, z.number(), z.boolean()]))
const toPlantilla = ([id, ambito, categoria, subcategoria, descripcion, creadoEn, actualizadoEn, monto, moneda, medioPago, orden, comp, tipo, rec]: z.infer<typeof plantillaRowV15>): Plantilla =>
  ({ id, ambito, categoria, subcategoria, descripcion, creadoEn, actualizadoEn, monto: optNum(monto), moneda: String(moneda || 'PEN'), medioPago: String(medioPago ?? ''), orden: optNum(orden),
    esCompromiso: comp === true || String(comp).toUpperCase() === 'TRUE',
    // v1.10: tipo de gasto y recurrencia con que se precargan los gastos de la plantilla (hojas anteriores: Variable / no recurrente).
    tipoGasto: (TIPOS_GASTO as readonly string[]).includes(String(tipo)) ? String(tipo) as TipoGasto : 'Variable',
    esRecurrente: rec === true || String(rec).toUpperCase() === 'TRUE' })

/** Lo que se envía para crear o editar una plantilla. `afterId`: al clonar, la copia queda justo después de la original. */
export type PlantillaInput = Pick<Plantilla, 'id' | 'ambito' | 'categoria' | 'subcategoria' | 'descripcion' | 'monto' | 'moneda' | 'medioPago'> & { esCompromiso?: boolean; tipoGasto?: TipoGasto; esRecurrente?: boolean }

const loteSchema = z.object({
  estado: str, loteId: str, solicitados: z.number(), confirmados: z.number(), nuevos: z.number(), yaExistian: z.number().default(0),
  ids: z.array(str), gastos: z.array(gastoRow), mensaje: str,
})

// [id, nombre, presupuesto, campo, valor, color, orden, activo?, descripción?, icono?] — antes de v1.7 llegan solo 7; antes de v1.10 sin icono.
const cajaRow = z.tuple([str, str, z.number(), str, str, str, z.number()]).rest(z.union([str, z.number(), z.boolean()]))

// [id, nombre, monto, moneda, color, icono, activo, orden, recurrencia, mes, medio, creadoEn, actualizadoEn, tipo?] (backend anterior: sin tipo)
const fondoRow = z.tuple([str, str, z.number(), str, str, str, z.boolean(), z.number(), str, str, str, str, str]).rest(str)
const fondoMesRow = z.tuple([str, str, z.number(), str])
const tipoFondo = (t: unknown, nombre: string, recurrencia: string): TipoFondo =>
  (TIPOS_FONDO as readonly unknown[]).includes(t) ? t as TipoFondo : /^(carpeta t[ée]sis|viaje a ica)/i.test(nombre) ? 'ahorro_asignado' : recurrencia === 'unica' ? 'extra' : 'mensual'
const toFondo = (r: z.infer<typeof fondoRow>): Fondo => ({
  tipo: tipoFondo(r[13], r[1], r[8]), id: r[0], nombre: r[1], monto: r[2], moneda: r[3] || 'PEN', color: r[4] || '#1e3a8a', icono: r[5], activo: r[6], orden: r[7],
  recurrencia: r[8] === 'unica' ? 'unica' : 'mensual', mes: r[9], medioPago: r[10], creadoEn: r[11], actualizadoEn: r[12],
})
const toFondoMes = (r: z.infer<typeof fondoMesRow>): FondoMes => ({ fondoId: r[0], mes: r[1], monto: r[2], modo: r[3] === 'desde' ? 'desde' : 'solo' })
// [id, tipo, nombre, monto, moneda, medios, campo, valor, descripción, color, icono, recurrencia, activo, orden, origenId, estados, creado, actualizado]
const plantillaFinRow = z.tuple([str, str, str, z.number(), str, str, str, str, str, str, str, str, z.boolean(), z.number(), str, z.record(z.string(), z.object({ e: z.enum(['aplicada', 'omitida']), m: z.number() })), str, str])
const toPlantillaFin = (r: z.infer<typeof plantillaFinRow>): PlantillaFin => ({
  id: r[0], tipo: r[1] === 'subcaja' ? 'subcaja' : 'fondo', nombre: r[2], monto: r[3], moneda: r[4], medios: r[5] === 'Libre' ? '' : r[5], campo: r[6], valor: r[7], descripcion: r[8],
  color: r[9] || '#1e3a8a', icono: r[10], recurrencia: r[11] === 'unica' ? 'unica' : 'mensual', activo: r[12], orden: r[13], origenId: r[14], estados: r[15], creadoEn: r[16], actualizadoEn: r[17],
})
export type PlantillaFinInput = Omit<PlantillaFin, 'creadoEn' | 'actualizadoEn' | 'estados' | 'orden'> & { orden?: number }
export interface AplicarItem { id: string; accion: 'aplicar' | 'omitir' | 'pendiente'; monto?: number }
export interface CarpetaRespaldo { id: string; nombre: string; url: string; personalizada: boolean }
export type FondoInput = Omit<Fondo, 'creadoEn' | 'actualizadoEn'>

const revPresRow = z.tuple([str, str, str, str, str, str, str])
const ESTADOS_REV_PRES: readonly string[] = ['pendiente', 'completo', 'con_gastos_anteriores', 'revisado_con_observaciones']
const toRevPres = ([id, periodo, estado, pendientes, observacion, , creadoEn]: z.infer<typeof revPresRow>): RevisionPres =>
  ({ id, periodo, estado: (ESTADOS_REV_PRES.includes(estado) ? estado : 'pendiente') as EstadoRevisionPres, pendientes, observacion, creadoEn })
export interface RevisionPresInput { id: string; periodo: string; estado: EstadoRevisionPres; pendientes: string; observacion: string }
const dataSchema = z.object({
  version: str,
  sheetUrl: str,
  gastos: z.array(gastoRow),
  catalogo: z.array(catRow),
  medios: z.array(z.tuple([str, z.boolean()]).rest(z.unknown())),
  cajas: z.array(cajaRow),
  presupuestos: z.array(z.tuple([str, str, z.number()])),
  config: z.record(str, str),
  ordenGastos: z.array(z.tuple([str, z.number()])).optional(),
  vinculos: z.array(z.tuple([str, str])).optional(),
  revisiones: z.array(z.tuple([str, str, str, str, str, str, str])).optional(),
  revisionesPresupuesto: z.array(revPresRow).optional(),
  fondos: z.array(fondoRow).optional(),
  fondosMeses: z.array(fondoMesRow).optional(),
  plantillasFin: z.array(plantillaFinRow).optional(),
})

const ESTADOS_REVISION: readonly string[] = ['legitimo', 'pendiente', 'duplicado']
const revisionRow = z.tuple([str, str, str, str, str, str, str])
const toRevision = ([id, , ids, estado, firma, creadoEn, actualizadoEn]: z.infer<typeof revisionRow>): Revision => ({
  id, tipo: 'duplicado', ids: ids.split(',').map(x => x.trim().toLowerCase()).filter(Boolean).sort(),
  estado: (ESTADOS_REVISION.includes(estado) ? estado : 'pendiente') as EstadoRevision, firma, creadoEn, actualizadoEn,
})

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) throw new ApiError('INVALID_RESPONSE', 'Los datos de la hoja tienen un formato inesperado.')
  return r.data
}

const FILTRO_CAMPOS = ['Todos', 'Ámbito', 'Categoría', 'Subcategoría', 'Medio de pago'] as const
const toCaja = (r: z.infer<typeof cajaRow>): Caja => ({
  id: r[0], nombre: r[1], presupuesto: r[2],
  filtroCampo: (FILTRO_CAMPOS as readonly string[]).includes(r[3]) ? (r[3] as Caja['filtroCampo']) : 'Todos',
  filtroValor: r[4], color: r[5] || '#1e3a8a', orden: r[6],
  activo: r[7] === undefined || r[7] === '' ? true : r[7] === true || String(r[7]).toUpperCase() === 'TRUE',
  descripcion: r[8] === undefined ? '' : String(r[8]),
  icono: r[9] === undefined ? '' : String(r[9]),
})

export type GastoInput = Omit<Gasto, 'estado' | 'origen' | 'creadoEn' | 'actualizadoEn'> & {
  /** Al crear desde una plantilla: queda vinculado como pago de ese compromiso. Se ignora al editar o clonar. */
  plantillaId?: string
}

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
          medios: d.medios.map((r): Medio => toMedio(r)),
          cajas: d.cajas.map(toCaja),
          presupuestos: d.presupuestos.map(([periodo, cajaId, monto]): Presupuesto => ({ periodo, cajaId, monto })),
          ordenGastos: d.ordenGastos ?? [],
          vinculos: (d.vinculos ?? []).map(([g, p]) => [g.toLowerCase(), p] as [string, string]),
          revisiones: (d.revisiones ?? []).filter(r => r[1] === 'duplicado').map(toRevision),
          revisionesPresupuesto: (d.revisionesPresupuesto ?? []).map(toRevPres),
          fondos: (d.fondos ?? []).map(toFondo),
          fondosMeses: (d.fondosMeses ?? []).map(toFondoMes),
          plantillasFin: (d.plantillasFin ?? []).map(toPlantillaFin),
        }
      }).finally(() => { inflight = null })
      return inflight
    },
    async saveGasto(g: GastoInput, mode: 'create' | 'update'): Promise<Gasto> {
      const raw = await t('saveGasto', { ...g, mode })
      try { return rowToGasto(parse(gastoRow, raw)) } catch (e) {
        // El backend confirmó la escritura (respondió ok) pero la fila no se puede leer: no se muestra error. Se relee la hoja
        // y se devuelve el registro tal como quedó guardado; solo si tampoco está ahí el error es real.
        if (!(e instanceof ApiError) || e.code !== 'INVALID_RESPONSE') throw e
        const guardado = (await this.getData(true)).gastos.find(x => x.id.toLowerCase() === g.id.toLowerCase())
        if (guardado) return guardado
        throw e
      }
    },
    async setEstado(id: string, estado: 'Activo' | 'Anulado'): Promise<{ actualizadoEn: string }> {
      return parse(z.object({ actualizadoEn: str }), await t('setEstado', { id, estado }))
    },
    /** Elimina o restaura varios gastos en una sola petición (todo o nada). */
    async setEstadoLote(ids: string[], estado: 'Activo' | 'Anulado'): Promise<{ actualizadoEn: string }> {
      return parse(z.object({ actualizadoEn: str }), await t('setEstadoLote', { ids, estado }))
    },
    async saveCatalogo(item: CatalogoItem): Promise<CatalogoItem> {
      return toCatalogo(parse(catRow, await t('saveCatalogo', item)))
    },
    /** Renombra en el catálogo y en todos los gastos que usan ese nombre (dentro del mismo ámbito/categoría). */
    async renameCatalogo(p: { nivel: 'ambito' | 'categoria' | 'subcategoria'; ambito: string; categoria?: string; subcategoria?: string; nuevo: string }) {
      return parse(z.object({ catalogo: z.number(), gastos: z.number() }), await t('renameCatalogo', p))
    },
    /** Orden manual de las categorías de un ámbito (columna Orden de CATALOGO). */
    async reorderCategorias(ambito: string, categorias: string[]): Promise<void> {
      await t('reorderCategorias', { ambito, categorias })
    },
    /** Elimina una categoría solo si nada la usa (el backend lo comprueba otra vez). `cascada` autoriza borrar sus subcategorías. */
    async deleteCategoria(ambito: string, categoria: string, cascada = false) {
      return parse(z.object({ eliminada: z.boolean(), subcategorias: z.number() }).passthrough(), await t('deleteCategoria', { ambito, categoria, cascada }))
    },
    async saveMedio(m: Medio): Promise<Medio> {
      return toMedio(parse(z.tuple([str, z.boolean()]).rest(z.unknown()), await t('saveMedio', m)))
    },
    async saveCaja(c: Caja): Promise<Caja> {
      return toCaja(parse(cajaRow, await t('saveCaja', c)))
    },
    async deleteCaja(id: string): Promise<void> {
      await t('deleteCaja', { id })
    },
    /** Orden manual de las subcajas (la general queda primera), en una sola escritura. */
    async reorderCajas(ids: string[]): Promise<void> {
      await t('reorderCajas', { ids })
    },
    async savePresupuesto(p: Presupuesto): Promise<Presupuesto> {
      const [periodo, cajaId, monto] = parse(z.tuple([str, str, z.number()]), await t('savePresupuesto', p))
      return { periodo, cajaId, monto }
    },
    /** Crea o edita un fondo (upsert por ID: reintentar o doble clic no duplica). */
    async saveFondo(f: FondoInput): Promise<Fondo> {
      return toFondo(parse(fondoRow, await t('saveFondo', f)))
    },
    /** Importe de un fondo para un mes (o desde un mes). quitar = vuelve al importe habitual. */
    async saveFondoMes(m: FondoMes, quitar = false): Promise<void> {
      await t('saveFondoMes', { ...m, ...(quitar ? { quitar: true } : {}) })
    },
    /** Plantillas de fondos/subcajas: definiciones reutilizables (upsert por ID; no crea dinero ni entidades). */
    async savePlantillaFin(p: PlantillaFinInput): Promise<PlantillaFin> {
      return toPlantillaFin(parse(plantillaFinRow, await t('savePlantillaFin', p)))
    },
    async deletePlantillaFin(id: string): Promise<void> { await t('deletePlantillaFin', { id }) },
    async reorderPlantillasFin(tipo: TipoPlantillaFin, ids: string[]): Promise<void> { await t('reorderPlantillasFin', { tipo, ids }) },
    /** Aplica, omite o devuelve a Pendiente plantillas en UN mes (todo o nada; idempotente). */
    async aplicarPlantillasFin(mes: string, items: AplicarItem[]): Promise<PlantillaFin[]> {
      return parse(z.object({ plantillas: z.array(plantillaFinRow) }), await t('aplicarPlantillasFin', { mes, items })).plantillas.map(toPlantillaFin)
    },
    /** Aplica fondos o subcajas existentes a UN mes (copiar mes anterior, nuevo fondo/subcaja del mes). Idempotente. */
    async aplicarEntidadesMes(tipo: 'fondo' | 'subcaja', mes: string, items: { id: string; monto: number }[]): Promise<void> {
      await t('aplicarEntidadesMes', { tipo, mes, items })
    },
    async deleteFondo(id: string): Promise<void> {
      await t('deleteFondo', { id })
    },
    async reorderFondos(ids: string[]): Promise<void> {
      await t('reorderFondos', { ids })
    },
    /** Crea el fondo General con el presupuesto de la caja general y sus ajustes mensuales. Idempotente. */
    /** Rellena celdas vacías de la hoja (Activo, Icono, Medio, Orden…). `catalogo` trae el icono/color a escribir en cada fila vacía. */
    async completarVacios(catalogo: { ambito: string; categoria: string; subcategoria: string; icono: string; color: string }[]) {
      return parse(z.object({ cajas: z.number(), fondos: z.number(), catalogo: z.number(), config: z.number(), medios: z.number().optional() }), await t('completarVacios', { catalogo }))
    },
    async migrarGeneralAFondo() {
      const r = parse(z.object({ creada: z.boolean(), meses: z.number(), fondo: fondoRow.optional(), ajustes: z.array(fondoMesRow).optional() }), await t('migrarGeneralAFondo', {}))
      return { creada: r.creada, meses: r.meses, fondo: r.fondo ? toFondo(r.fondo) : null, ajustes: (r.ajustes ?? []).map(toFondoMes) }
    },
    async saveConfig(clave: string, valor: string): Promise<void> {
      await t('saveConfig', { clave, valor })
    },
    /** Solo la hoja de plantillas: no lee gastos ni recalcula nada del dashboard. */
    async getPlantillas(): Promise<Plantilla[]> {
      return parse(z.array(plantillaRowV15), await t('plantillas', {})).map(toPlantilla)
    },
    async savePlantilla(p: PlantillaInput, mode: 'create' | 'update', afterId?: string): Promise<Plantilla> {
      return toPlantilla(parse(plantillaRowV15, await t('savePlantilla', { ...p, monto: p.monto ?? '', mode, ...(afterId ? { afterId } : {}) })))
    },
    /** Guarda el orden manual de todas las plantillas en una sola petición. */
    async reorderPlantillas(ids: string[]): Promise<void> {
      await t('reorderPlantillas', { ids })
    },
    /** Registra varios gastos en UNA petición. Idempotente por los IDs de cada gasto. */
    async saveGastosBatch(loteId: string, gastos: GastoInput[]) {
      const r = parse(loteSchema, await t('saveGastosBatch', { loteId, gastos }))
      return { ...r, gastos: r.gastos.map(rowToGasto) }
    },
    /** Orden personalizado de la tabla de Gastos (solo la hoja ORDEN_GASTOS). */
    async reorderGastos(ids: string[]): Promise<void> {
      await t('reorderGastos', { ids })
    },
    /** Asocia (o con plantillaId vacío, desasocia) un movimiento a una plantilla. Solo escribe la hoja de vínculos. */
    async vincularGasto(gastoId: string, plantillaId: string): Promise<[string, string]> {
      return parse(z.tuple([str, str]), await t('vincularGasto', { gastoId, plantillaId }))
    },
    async saveRevision(r: Pick<Revision, 'id' | 'ids' | 'estado' | 'firma'>): Promise<Revision> {
      return toRevision(parse(revisionRow, await t('saveRevision', { ...r, tipo: 'duplicado' })))
    },
    /** Revisión del presupuesto: SOLO agrega a REVISIONES_PRESUPUESTO (nunca fondos, gastos, cajas ni presupuestos). */
    async saveRevisionPresupuesto(i: RevisionPresInput): Promise<RevisionPres> { return toRevPres(parse(revPresRow, await t('saveRevisionPresupuesto', i))) },
    async deletePlantilla(id: string): Promise<void> {
      await t('deletePlantilla', { id })
    },
    diagnose: () => t('diagnose', {}) as Promise<Record<string, unknown>>,
    /** Ejecuta por nombre una función del backend (Configuración → Funciones del backend) y devuelve su respuesta tal cual. */
    ejecutar: (nombre: string, payload: Record<string, unknown> = {}, adminToken?: string) => t(nombre, payload, adminToken ? { adminToken } : undefined) as Promise<unknown>,
    /** Carpeta de Drive donde se guardan los respaldos. */
    carpetaRespaldo: () => t('carpetaRespaldo', {}) as Promise<CarpetaRespaldo>,
    /** Cambia la carpeta (enlace o ID de Drive); vacío = carpeta "Backup" junto a la hoja. */
    saveCarpetaRespaldo: (carpeta: string) => t('saveCarpetaRespaldo', { carpeta }) as Promise<CarpetaRespaldo>,
    backup: () => t('backup', {}) as Promise<{ nombre: string; url: string; carpeta?: string; carpetaUrl?: string; aviso?: string }>,
  }
}

export type Api = ReturnType<typeof createApi>
