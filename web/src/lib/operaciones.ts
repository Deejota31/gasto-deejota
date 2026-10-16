import type { Api, FuenteInput, GastoInput, PlantillaFinInput } from './api'
import type { AppData, Caja, CatalogoItem, Fuente, FuenteMes, Gasto, Medio, PlantillaFin, Presupuesto } from './types'

/**
 * Escrituras optimistas (v1.23). Cada operación tiene:
 *  - `local`: cambio puro e idempotente sobre los datos; se aplica al instante (y se vuelve a aplicar sobre cualquier lectura
 *    posterior mientras la operación siga pendiente, para que una respuesta antigua no la "borre" de la pantalla);
 *  - `remoto`: la llamada a Apps Script (todas son idempotentes: el ID del registro viaja en el pedido);
 *  - `confirmar`: ajusta el registro con lo que realmente devolvió el backend;
 *  - `deshacer`: vuelve ESA entidad a como estaba si el backend falla (sin tocar cambios de otras operaciones).
 * Los argumentos son JSON puro: la cola se guarda en localStorage y sobrevive a recargar.
 */
/** `prev`: lo que había antes del cambio (para revertir con exactitud aunque la pantalla ya traiga el cambio, p. ej. tras recargar). */
export interface OpPersistida { id: string; nombre: string; args: unknown[]; ts: string; prev?: unknown; hay?: boolean }

interface Def<A extends unknown[], P, R> {
  capturar: (d: AppData, ...a: A) => P
  local: (d: AppData, ts: string, ...a: A) => AppData
  remoto: (api: Api, ...a: A) => Promise<R>
  confirmar?: (d: AppData, r: R, prev: P, ...a: A) => AppData
  deshacer: (d: AppData, prev: P, ...a: A) => AppData
}
const def = <A extends unknown[], P, R>(x: Def<A, P, R>): Def<A, P, R> => x

/** Vínculos gasto → plantilla: upsert por ID de gasto; plantilla vacía = sin vínculo. */
export const upsertVinculos = (prev: [string, string][] | undefined, pares: [string, string][]) => {
  const m = new Map((prev ?? []).map(([g, p]) => [g.toLowerCase(), p]))
  for (const [g, p] of pares) { if (p) m.set(g.toLowerCase(), p); else m.delete(g.toLowerCase()) }
  return [...m.entries()]
}

/** Inserta o reemplaza por clave; `x` ya viene completo. */
function poner<T>(xs: T[] | undefined, x: T, mismo: (a: T) => boolean): T[] {
  const l = xs ?? []
  return l.some(mismo) ? l.map(a => (mismo(a) ? x : a)) : [...l, x]
}
/** Devuelve la entidad a su estado previo (o la quita si no existía). */
function restaurar<T>(xs: T[] | undefined, prev: T | undefined, mismo: (a: T) => boolean): T[] {
  const l = xs ?? []
  return prev === undefined ? l.filter(a => !mismo(a)) : poner(l, prev, mismo)
}

const claveCat = (c: { ambito: string; categoria: string; subcategoria: string }) => `${c.ambito}|${c.categoria}|${c.subcategoria}`.toLowerCase()
const lcMedio = (m: { nombre: string }) => m.nombre.toLowerCase()

// Categorías y subcategorías se comparten entre ámbitos: sus hermanas toman el mismo icono y color.
function conHermanas(cat: CatalogoItem[], s: CatalogoItem): CatalogoItem[] {
  const hermana = (c: CatalogoItem) => !!s.categoria && c.categoria === s.categoria && c.subcategoria === s.subcategoria
  const lista = poner(cat, s, c => claveCat(c) === claveCat(s))
  return lista.map(c => (hermana(c) && claveCat(c) !== claveCat(s) ? { ...c, icono: s.icono || c.icono, color: s.color || c.color } : c))
}
const hitRename = (p: { nivel: 'ambito' | 'categoria' | 'subcategoria'; ambito: string; categoria?: string; subcategoria?: string }) =>
  (x: { ambito: string; categoria: string; subcategoria: string }) =>
    x.ambito === p.ambito && (p.nivel === 'ambito' || x.categoria === (p.categoria ?? '')) && (p.nivel !== 'subcategoria' || x.subcategoria === (p.subcategoria ?? ''))

export const OPS = {
  saveGasto: def<[GastoInput, 'create' | 'update'], { gasto?: Gasto; vinc?: [string, string] }, Gasto>({
    capturar: (d, g) => ({ gasto: d.gastos.find(x => x.id === g.id), vinc: (d.vinculos ?? []).find(([id]) => id === g.id.toLowerCase()) }),
    local: (d, ts, g, mode) => {
      const prev = d.gastos.find(x => x.id === g.id)
      const { plantillaId, ...base } = g
      const nuevo: Gasto = { ...base, estado: prev?.estado ?? 'Activo', origen: prev?.origen ?? 'web', creadoEn: prev?.creadoEn ?? ts, actualizadoEn: ts }
      return {
        ...d, gastos: prev ? d.gastos.map(x => (x.id === g.id ? { ...x, ...nuevo } : x)) : [...d.gastos, nuevo],
        ...(mode === 'create' && plantillaId ? { vinculos: upsertVinculos(d.vinculos, [[g.id, plantillaId]]) } : {}),
      }
    },
    remoto: (api, g, mode) => api.saveGasto(g, mode),
    confirmar: (d, saved, _p, g, mode) => {
      const plId = mode === 'create' ? g.plantillaId : undefined
      return { ...d, gastos: poner(d.gastos, saved, x => x.id === saved.id), ...(plId ? { vinculos: upsertVinculos(d.vinculos, [[saved.id, plId]]) } : {}) }
    },
    deshacer: (d, prev, g) => ({
      ...d, gastos: restaurar(d.gastos, prev.gasto, x => x.id === g.id),
      vinculos: upsertVinculos(d.vinculos, [[g.id, prev.vinc?.[1] ?? '']]),
    }),
  }),

  setEstado: def<[string, 'Activo' | 'Anulado'], Pick<Gasto, 'estado' | 'actualizadoEn'> | undefined, { actualizadoEn: string }>({
    capturar: (d, id) => { const g = d.gastos.find(x => x.id === id); return g && { estado: g.estado, actualizadoEn: g.actualizadoEn } },
    local: (d, ts, id, estado) => ({ ...d, gastos: d.gastos.map(x => (x.id === id ? { ...x, estado, actualizadoEn: ts } : x)) }),
    remoto: (api, id, estado) => api.setEstado(id, estado),
    confirmar: (d, r, _p, id, estado) => ({ ...d, gastos: d.gastos.map(x => (x.id === id ? { ...x, estado, actualizadoEn: r.actualizadoEn } : x)) }),
    deshacer: (d, prev, id) => (prev ? { ...d, gastos: d.gastos.map(x => (x.id === id ? { ...x, ...prev } : x)) } : d),
  }),

  setEstadoLote: def<[string[], 'Activo' | 'Anulado'], [string, Gasto['estado'], string][], { actualizadoEn: string }>({
    capturar: (d, ids) => d.gastos.filter(x => ids.includes(x.id)).map(x => [x.id, x.estado, x.actualizadoEn] as [string, Gasto['estado'], string]),
    local: (d, ts, ids, estado) => { const s = new Set(ids); return { ...d, gastos: d.gastos.map(x => (s.has(x.id) ? { ...x, estado, actualizadoEn: ts } : x)) } },
    remoto: (api, ids, estado) => api.setEstadoLote(ids, estado),
    confirmar: (d, r, _p, ids, estado) => { const s = new Set(ids); return { ...d, gastos: d.gastos.map(x => (s.has(x.id) ? { ...x, estado, actualizadoEn: r.actualizadoEn } : x)) } },
    deshacer: (d, prev) => { const m = new Map(prev.map(([id, e, a]) => [id, { estado: e, actualizadoEn: a }])); return { ...d, gastos: d.gastos.map(x => (m.has(x.id) ? { ...x, ...m.get(x.id)! } : x)) } },
  }),

  saveCatalogo: def<[CatalogoItem], CatalogoItem[], CatalogoItem>({
    capturar: (d, item) => d.catalogo.filter(c => claveCat(c) === claveCat(item) || (!!item.categoria && c.categoria === item.categoria && c.subcategoria === item.subcategoria)),
    local: (d, _ts, item) => ({ ...d, catalogo: conHermanas(d.catalogo, { ...d.catalogo.find(c => claveCat(c) === claveCat(item)), ...item }) }),
    remoto: (api, item) => api.saveCatalogo(item),
    confirmar: (d, s) => ({ ...d, catalogo: conHermanas(d.catalogo, s) }),
    deshacer: (d, prev, item) => {
      const m = new Map(prev.map(c => [claveCat(c), c]))
      return { ...d, catalogo: d.catalogo.filter(c => claveCat(c) !== claveCat(item) || m.has(claveCat(c))).map(c => m.get(claveCat(c)) ?? c) }
    },
  }),

  renameCatalogo: def<[Parameters<Api['renameCatalogo']>[0]], { cat: CatalogoItem[]; gastos: Gasto[] }, Awaited<ReturnType<Api['renameCatalogo']>>>({
    capturar: (d, p) => ({ cat: d.catalogo.filter(hitRename(p)), gastos: d.gastos.filter(hitRename(p)) }),
    local: (d, _ts, p) => {
      const col = p.nivel, hit = hitRename(p)
      return { ...d, catalogo: d.catalogo.map(c => (hit(c) ? { ...c, [col]: p.nuevo } : c)), gastos: d.gastos.map(g => (hit(g) ? { ...g, [col]: p.nuevo } : g)) }
    },
    remoto: (api, p) => api.renameCatalogo(p),
    deshacer: (d, prev, p) => {
      const col = p.nivel
      const renom = (x: { ambito: string; categoria: string; subcategoria: string }) => ({ ...x, [col]: p.nuevo })
      const cat = new Map(prev.cat.map(c => [claveCat(renom(c)), c]))
      const gas = new Map(prev.gastos.map(g => [g.id, g]))
      return { ...d, catalogo: d.catalogo.map(c => cat.get(claveCat(c)) ?? c), gastos: d.gastos.map(g => gas.get(g.id) ?? g) }
    },
  }),

  deleteCategoria: def<[string, string, boolean], CatalogoItem[], Awaited<ReturnType<Api['deleteCategoria']>>>({
    capturar: (d, ambito, categoria) => d.catalogo.filter(c => c.ambito === ambito && c.categoria === categoria),
    local: (d, _ts, ambito, categoria) => ({ ...d, catalogo: d.catalogo.filter(c => !(c.ambito === ambito && c.categoria === categoria)) }),
    remoto: (api, ambito, categoria, cascada) => api.deleteCategoria(ambito, categoria, cascada),
    // Si el backend no la eliminó (p. ej. está en uso), vuelve a mostrarse.
    confirmar: (d, r, prev) => (r.eliminada ? d : { ...d, catalogo: [...d.catalogo, ...prev.filter(p => !d.catalogo.some(c => claveCat(c) === claveCat(p)))] }),
    deshacer: (d, prev) => ({ ...d, catalogo: [...d.catalogo, ...prev.filter(p => !d.catalogo.some(c => claveCat(c) === claveCat(p)))] }),
  }),

  saveMedio: def<[Medio], Medio | undefined, Medio>({
    capturar: (d, m) => d.medios.find(x => lcMedio(x) === lcMedio(m)),
    local: (d, _ts, m) => ({ ...d, medios: poner(d.medios, { ...d.medios.find(x => lcMedio(x) === lcMedio(m)), ...m }, x => lcMedio(x) === lcMedio(m)) }),
    remoto: (api, m) => api.saveMedio(m),
    confirmar: (d, s) => ({ ...d, medios: poner(d.medios, s, x => lcMedio(x) === lcMedio(s)) }),
    deshacer: (d, prev, m) => ({ ...d, medios: restaurar(d.medios, prev, x => lcMedio(x) === lcMedio(m)) }),
  }),

  saveCaja: def<[Caja], Caja | undefined, Caja>({
    capturar: (d, c) => d.cajas.find(x => x.id === c.id),
    local: (d, _ts, c) => ({ ...d, cajas: poner(d.cajas, c, x => x.id === c.id) }),
    remoto: (api, c) => api.saveCaja(c),
    confirmar: (d, s) => ({ ...d, cajas: poner(d.cajas, s, x => x.id === s.id) }),
    deshacer: (d, prev, c) => ({ ...d, cajas: restaurar(d.cajas, prev, x => x.id === c.id) }),
  }),

  deleteCaja: def<[string], Caja | undefined, unknown>({
    capturar: (d, id) => d.cajas.find(x => x.id === id),
    local: (d, _ts, id) => ({ ...d, cajas: d.cajas.filter(c => c.id !== id) }),
    remoto: (api, id) => api.deleteCaja(id),
    deshacer: (d, prev, id) => ({ ...d, cajas: restaurar(d.cajas, prev, x => x.id === id) }),
  }),

  savePresupuesto: def<[Presupuesto], Presupuesto | undefined, Presupuesto>({
    capturar: (d, p) => d.presupuestos.find(x => x.periodo === p.periodo && x.cajaId === p.cajaId),
    local: (d, _ts, p) => ({ ...d, presupuestos: poner(d.presupuestos, p, x => x.periodo === p.periodo && x.cajaId === p.cajaId) }),
    remoto: (api, p) => api.savePresupuesto(p),
    confirmar: (d, s) => ({ ...d, presupuestos: poner(d.presupuestos, s, x => x.periodo === s.periodo && x.cajaId === s.cajaId) }),
    deshacer: (d, prev, p) => ({ ...d, presupuestos: restaurar(d.presupuestos, prev, x => x.periodo === p.periodo && x.cajaId === p.cajaId) }),
  }),

  saveFuente: def<[FuenteInput], Fuente | undefined, Fuente>({
    capturar: (d, f) => (d.fuentes ?? []).find(x => x.id === f.id),
    local: (d, ts, f) => {
      const prev = (d.fuentes ?? []).find(x => x.id === f.id)
      return { ...d, fuentes: poner(d.fuentes, { ...prev, ...f, creadoEn: prev?.creadoEn ?? ts, actualizadoEn: ts }, x => x.id === f.id) }
    },
    remoto: (api, f) => api.saveFuente(f),
    confirmar: (d, s) => ({ ...d, fuentes: poner(d.fuentes, s, x => x.id === s.id) }),
    deshacer: (d, prev, f) => ({ ...d, fuentes: restaurar(d.fuentes, prev, x => x.id === f.id) }),
  }),

  deleteFuente: def<[string], { f?: Fuente; meses: FuenteMes[] }, unknown>({
    capturar: (d, id) => ({ f: (d.fuentes ?? []).find(x => x.id === id), meses: (d.fuentesMeses ?? []).filter(x => x.fuenteId === id) }),
    local: (d, _ts, id) => ({ ...d, fuentes: (d.fuentes ?? []).filter(x => x.id !== id), fuentesMeses: (d.fuentesMeses ?? []).filter(x => x.fuenteId !== id) }),
    remoto: (api, id) => api.deleteFuente(id),
    deshacer: (d, prev, id) => ({
      ...d, fuentes: restaurar(d.fuentes, prev.f, x => x.id === id),
      fuentesMeses: [...(d.fuentesMeses ?? []).filter(x => x.fuenteId !== id), ...prev.meses],
    }),
  }),

  saveFuenteMes: def<[FuenteMes, boolean], FuenteMes[], unknown>({
    capturar: (d, m) => (d.fuentesMeses ?? []).filter(x => x.fuenteId === m.fuenteId && x.mes === m.mes && x.modo === m.modo),
    local: (d, _ts, m, quitar) => ({ ...d, fuentesMeses: [...(d.fuentesMeses ?? []).filter(x => !(x.fuenteId === m.fuenteId && x.mes === m.mes && x.modo === m.modo)), ...(quitar ? [] : [m])] }),
    remoto: (api, m, quitar) => api.saveFuenteMes(m, quitar),
    deshacer: (d, prev, m) => ({ ...d, fuentesMeses: [...(d.fuentesMeses ?? []).filter(x => !(x.fuenteId === m.fuenteId && x.mes === m.mes && x.modo === m.modo)), ...prev] }),
  }),

  savePlantillaFin: def<[PlantillaFinInput], PlantillaFin | undefined, PlantillaFin>({
    capturar: (d, p) => (d.plantillasFin ?? []).find(x => x.id === p.id),
    local: (d, ts, p) => {
      const prev = (d.plantillasFin ?? []).find(x => x.id === p.id)
      const orden = p.orden ?? prev?.orden ?? (d.plantillasFin ?? []).filter(x => x.tipo === p.tipo).length + 1
      return { ...d, plantillasFin: poner(d.plantillasFin, { estados: {}, ...prev, ...p, orden, creadoEn: prev?.creadoEn ?? ts, actualizadoEn: ts }, x => x.id === p.id) }
    },
    remoto: (api, p) => api.savePlantillaFin(p),
    confirmar: (d, s) => ({ ...d, plantillasFin: poner(d.plantillasFin, s, x => x.id === s.id) }),
    deshacer: (d, prev, p) => ({ ...d, plantillasFin: restaurar(d.plantillasFin, prev, x => x.id === p.id) }),
  }),

  deletePlantillaFin: def<[string], PlantillaFin | undefined, unknown>({
    capturar: (d, id) => (d.plantillasFin ?? []).find(x => x.id === id),
    local: (d, _ts, id) => ({ ...d, plantillasFin: (d.plantillasFin ?? []).filter(x => x.id !== id) }),
    remoto: (api, id) => api.deletePlantillaFin(id),
    deshacer: (d, prev, id) => ({ ...d, plantillasFin: restaurar(d.plantillasFin, prev, x => x.id === id) }),
  }),

  saveConfig: def<[string, string], { tenia: boolean; valor?: string }, unknown>({
    capturar: (d, clave) => ({ tenia: clave in d.config, valor: d.config[clave] }),
    local: (d, _ts, clave, valor) => ({ ...d, config: { ...d.config, [clave]: valor } }),
    remoto: (api, clave, valor) => api.saveConfig(clave, valor),
    deshacer: (d, prev, clave) => {
      const config = { ...d.config }
      if (prev.tenia) config[clave] = prev.valor ?? ''; else delete config[clave]
      return { ...d, config }
    },
  }),

  vincular: def<[string, string], [string, string] | undefined, unknown>({
    capturar: (d, gastoId) => (d.vinculos ?? []).find(([id]) => id === gastoId.toLowerCase()),
    local: (d, _ts, gastoId, plantillaId) => ({ ...d, vinculos: upsertVinculos(d.vinculos, [[gastoId, plantillaId]]) }),
    remoto: (api, gastoId, plantillaId) => api.vincularGasto(gastoId, plantillaId),
    deshacer: (d, prev, gastoId) => ({ ...d, vinculos: upsertVinculos(d.vinculos, [[gastoId, prev?.[1] ?? '']]) }),
  }),
}

export type NombreOp = keyof typeof OPS
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ArgsOp<N extends NombreOp> = (typeof OPS)[N] extends Def<infer A, any, any> ? A : never
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResultadoOp<N extends NombreOp> = (typeof OPS)[N] extends Def<any, any, infer R> ? R : never

/* ---------------- Cola persistida (localStorage) ---------------- */

const COLA_KEY = 'gd.cola'

export function leerCola(url: string | undefined): OpPersistida[] {
  if (!url) return []
  try {
    const s = JSON.parse(localStorage.getItem(COLA_KEY) ?? 'null')
    return s?.url === url && Array.isArray(s.ops) ? (s.ops as OpPersistida[]).filter(o => o && typeof o.id === 'string' && o.nombre in OPS && Array.isArray(o.args)) : []
  } catch { return [] }
}

export function guardarCola(url: string | undefined, ops: OpPersistida[]) {
  if (!url) return
  try { ops.length ? localStorage.setItem(COLA_KEY, JSON.stringify({ url, ops })) : localStorage.removeItem(COLA_KEY) } catch { /* cuota llena o modo privado: la cola sigue en memoria */ }
}
