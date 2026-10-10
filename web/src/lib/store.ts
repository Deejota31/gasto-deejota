import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createApi, httpTransport, type Api, type Connection, type GastoInput, type PlantillaInput } from './api'
import { demoTransport } from './demo'
import { todayIn } from './dates'
import type { AppData, Caja, CatalogoItem, Gasto, Medio, Plantilla, Presupuesto, Revision } from './types'
import { sortCatalogo } from './orden'
import { dismiss, showToast, updateToast, type ToastAction } from './toast'

/** El catálogo siempre se entrega ordenado ("Otros" al final de cada grupo), venga de la hoja o de un cambio local. */
// El orden personalizado de Gastos se separa de `data`: reordenar no debe recalcular KPIs ni gráficos.
const normalize = (d: AppData): AppData => { const { ordenGastos: _o, ...rest } = d; return { ...rest, catalogo: sortCatalogo(d.catalogo) } }
const ordenMap = (d: AppData | null) => new Map((d?.ordenGastos ?? []).map(([id, o]) => [id.toLowerCase(), o]))
/** Vínculos gasto → plantilla: upsert por ID de gasto; plantilla vacía = sin vínculo. */
const upsertVinculos = (prev: [string, string][] | undefined, pares: [string, string][]) => {
  const m = new Map((prev ?? []).map(([g, p]) => [g.toLowerCase(), p]))
  for (const [g, p] of pares) { if (p) m.set(g.toLowerCase(), p); else m.delete(g.toLowerCase()) }
  return [...m.entries()]
}
const aplicarRangos = (m: Map<string, number>, ids: string[]) => { const n = new Map(m); ids.forEach((id, i) => n.set(id.toLowerCase(), i + 1)); return n }
const aplicarOrden = (items: Plantilla[], ids: string[]) => {
  const byId = new Map(items.map(x => [x.id, x]))
  return [...ids.map(id => byId.get(id)!).filter(Boolean), ...items.filter(x => !ids.includes(x.id))].map((x, i) => ({ ...x, orden: i + 1 }))
}

/** Preparación de un registro masivo desde plantillas. Vive en memoria mientras la app está abierta (sobrevive a cerrar el modal). */
export interface LoteState {
  fecha: string                                   // '' = hoy
  seleccion: string[]                             // IDs de plantillas marcadas
  valores: Record<string, { monto?: string; moneda?: string; medioPago?: string }> // cambios temporales (no tocan la plantilla)
  gastoIds: Record<string, string>                // ID de gasto fijo por plantilla: un reintento no duplica
  loteId: string
}
const nuevoLote = (): LoteState => ({ fecha: '', seleccion: [], valores: {}, gastoIds: {}, loteId: `lote-${crypto.randomUUID()}` })

export interface OpMessages { pending: string; ok: string; error: string }

const SNAPSHOT_KEY = 'gd.snapshot'

function readSnapshot(conn: Connection | null): AppData | null {
  if (!conn) return null
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    const s = raw ? JSON.parse(raw) : null
    return s?.url === conn.url ? (s.data as AppData) : null
  } catch { return null }
}

function writeSnapshot(conn: Connection | null, data: AppData) {
  if (!conn) return
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ url: conn.url, data })) } catch { /* cuota llena: solo se pierde el arranque instantáneo */ }
}

export function buildApi(conn: Connection | null): Api {
  if (conn) return createApi(httpTransport(conn))
  // Solo modo demo: ?demo=10000 carga más filas; ?latencia=2000 simula un Apps Script lento; ?falla=1 hace fallar las escrituras.
  const q = new URLSearchParams(location.search)
  const n = Math.min(Number(q.get('demo')) || 400, 20000)
  const demo = demoTransport(todayIn(), n, Math.min(Number(q.get('latencia')) || 250, 10000))
  const falla = q.get('falla') === '1'
  return createApi(falla ? (action, payload) => (action === 'data' || action === 'plantillas' ? demo(action, payload)
    : (() => {
      const w = globalThis as unknown as { __gdDemoCalls?: Record<string, number> } // también cuenta los intentos fallidos
      w.__gdDemoCalls = { ...w.__gdDemoCalls, [action]: (w.__gdDemoCalls?.[action] ?? 0) + 1 }
      return new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('No se pudo conectar con Google Sheets.'), { code: 'NETWORK' })), 300))
    })()) : demo)
}

/** Estado global: una lectura completa al abrir y al pulsar "Actualizar"; las escrituras actualizan el estado local. */
export function useAppData(conn: Connection | null, apiOverride?: Api) {
  const api = useMemo(() => apiOverride ?? buildApi(conn), [conn, apiOverride])
  const [data, setData] = useState<AppData | null>(() => { const s = readSnapshot(conn); return s && normalize(s) })
  const [ordenGastos, setOrdenGastos] = useState<Map<string, number>>(() => ordenMap(readSnapshot(conn)))
  // Sube con cada reordenamiento local y con cada respuesta de reordenamiento: una lectura iniciada antes no lo pisa.
  const ordenVersion = useRef(0)
  const ordenRef = useRef(ordenGastos)
  ordenRef.current = ordenGastos
  // Último orden que se vio en la interfaz mientras otro se estaba guardando: se envía al terminar (gana el más reciente).
  const colaOrden = useRef<Record<string, string[] | undefined>>({})
  const gastosConfirmado = useRef<Map<string, number>>(new Map())
  const plantillasConfirmado = useRef<string[]>([])
  const [lote, setLote] = useState<LoteState>(nuevoLote)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const loadingRef = useRef(false)
  // Cambios confirmados mientras una lectura completa estaba en curso: se vuelven a aplicar sobre su resultado
  // para que una respuesta tardía no pise datos más recientes. Todos los parches son idempotentes (upsert por clave).
  const journal = useRef<((d: AppData) => AppData)[]>([])
  const inflight = useRef(new Set<string>())
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  // Plantillas: estado aparte de `data` para que sus cambios no recalculen KPIs ni gráficos.
  // Se leen una sola vez (al abrir "Gastos mensuales") y se reutilizan; "Actualizar" las marca para releer.
  const [plantillas, setPlantillas] = useState<{ items: Plantilla[]; loading: boolean; error: string | null; loaded: boolean }>(
    { items: [], loading: false, error: null, loaded: false })
  const plantillasReq = useRef<Promise<void> | null>(null)
  const plantillasRef = useRef(plantillas.items)
  plantillasRef.current = plantillas.items
  const plantillasLoaded = useRef(false)
  const apiRef = useRef(api)
  useEffect(() => {
    apiRef.current = api
    plantillasLoaded.current = false
    plantillasReq.current = null // una lectura de la conexión anterior ya no cuenta
    setPlantillas({ items: [], loading: false, error: null, loaded: false })
  }, [api])
  const quiet = useRef(false) // Configuración → "Mostrar notificaciones al guardar" desactivado: se omiten solo los éxitos
  useEffect(() => { quiet.current = data?.config.notificaciones === 'false' }, [data?.config.notificaciones])

  // fresh=true salta la caché del servidor: "Actualizar" siempre trae lo último, incluidas ediciones hechas a mano en la hoja.
  const refresh = useCallback(async (fresh = true) => {
    if (loadingRef.current) return // evita peticiones duplicadas por clics repetidos
    loadingRef.current = true
    journal.current = []
    plantillasLoaded.current = false // la próxima apertura de "Gastos mensuales" relee la hoja
    setPlantillas(p => ({ ...p, loaded: false }))
    setLoading(true)
    setError(null)
    const ordenAlEmpezar = ordenVersion.current
    try {
      const raw = await api.getData(fresh)
      const merged = journal.current.reduce((acc, fn) => fn(acc), raw)
      journal.current = []
      setData(normalize(merged))
      const ordenVigente = ordenVersion.current === ordenAlEmpezar && !inflight.current.has('gastos:orden')
      if (ordenVigente) setOrdenGastos(ordenMap(raw))
      setLastSync(new Date())
      writeSnapshot(conn, ordenVigente ? merged : { ...merged, ordenGastos: [...ordenRef.current] })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [api, conn])

  useEffect(() => {
    const s = readSnapshot(conn)
    setData(s && normalize(s))
    setOrdenGastos(ordenMap(s))
    void refresh(false)
  }, [refresh, conn])

  const patch = useCallback((fn: (d: AppData) => AppData) => {
    if (loadingRef.current) journal.current.push(fn)
    setData(prev => {
      if (!prev) return prev
      const next = normalize(fn(prev))
      writeSnapshot(conn, { ...next, ordenGastos: [...ordenRef.current] })
      return next
    })
  }, [conn])

  const actions = useMemo(() => ({
    async saveGasto(g: GastoInput, mode: 'create' | 'update') {
      const saved = await api.saveGasto(g, mode)
      const plId = mode === 'create' ? g.plantillaId : undefined
      patch(d => ({
        ...d,
        gastos: mode === 'create' && !d.gastos.some(x => x.id === saved.id) ? [...d.gastos, saved] : d.gastos.map(x => x.id === saved.id ? saved : x),
        ...(plId ? { vinculos: upsertVinculos(d.vinculos, [[saved.id, plId]]) } : {}),
      }))
      return saved
    },
    async setEstado(g: Gasto, estado: 'Activo' | 'Anulado') {
      const r = await api.setEstado(g.id, estado)
      patch(d => ({ ...d, gastos: d.gastos.map(x => x.id === g.id ? { ...x, estado, actualizadoEn: r.actualizadoEn } : x) }))
    },
    async saveCatalogo(item: CatalogoItem) {
      const s = await api.saveCatalogo(item)
      const key = (c: CatalogoItem) => `${c.ambito}|${c.categoria}|${c.subcategoria}`.toLowerCase()
      patch(d => ({ ...d, catalogo: d.catalogo.some(c => key(c) === key(s)) ? d.catalogo.map(c => key(c) === key(s) ? s : c) : [...d.catalogo, s] }))
    },
    async renameCatalogo(p: Parameters<Api['renameCatalogo']>[0]) {
      const r = await api.renameCatalogo(p)
      const col = ({ ambito: 'ambito', categoria: 'categoria', subcategoria: 'subcategoria' } as const)[p.nivel]
      const hit = (x: { ambito: string; categoria: string; subcategoria: string }) =>
        x.ambito === p.ambito && (p.nivel === 'ambito' || x.categoria === p.categoria) && (p.nivel !== 'subcategoria' || x.subcategoria === p.subcategoria)
      patch(d => ({
        ...d,
        catalogo: d.catalogo.map(c => (hit(c) ? { ...c, [col]: p.nuevo } : c)),
        gastos: d.gastos.map(g => (hit(g) ? { ...g, [col]: p.nuevo } : g)),
      }))
      return r
    },
    async saveMedio(m: Medio) {
      const s = await api.saveMedio(m)
      patch(d => ({ ...d, medios: d.medios.some(x => x.nombre.toLowerCase() === s.nombre.toLowerCase()) ? d.medios.map(x => x.nombre.toLowerCase() === s.nombre.toLowerCase() ? s : x) : [...d.medios, s] }))
    },
    async saveCaja(c: Caja) {
      const s = await api.saveCaja(c)
      patch(d => ({ ...d, cajas: d.cajas.some(x => x.id === s.id) ? d.cajas.map(x => x.id === s.id ? s : x) : [...d.cajas, s] }))
    },
    async savePresupuesto(p: Presupuesto) {
      const s = await api.savePresupuesto(p)
      patch(d => ({ ...d, presupuestos: [...d.presupuestos.filter(x => !(x.periodo === s.periodo && x.cajaId === s.cajaId)), s] }))
    },
    async saveConfig(clave: string, valor: string) {
      await api.saveConfig(clave, valor)
      patch(d => ({ ...d, config: { ...d.config, [clave]: valor } }))
    },
    /** Asocia (o desasocia con '') un movimiento existente a un compromiso. No cambia el gasto. */
    async vincular(gastoId: string, plantillaId: string) {
      await api.vincularGasto(gastoId, plantillaId)
      patch(d => ({ ...d, vinculos: upsertVinculos(d.vinculos, [[gastoId, plantillaId]]) }))
    },
    /** Decisión sobre una coincidencia (legítima, pendiente o duplicado confirmado). Nunca modifica movimientos. */
    async saveRevision(r: Pick<Revision, 'id' | 'ids' | 'estado' | 'firma'>) {
      const saved = await api.saveRevision(r)
      const key = saved.ids.join(',')
      patch(d => ({ ...d, revisiones: [...(d.revisiones ?? []).filter(x => x.ids.join(',') !== key), saved] }))
    },
    diagnose: () => api.diagnose(),
    backup: () => api.backup(),
  }), [api, patch])

  /**
   * Ejecuta una escritura sin bloquear la interfaz: la promesa sigue en segundo plano y el resultado real
   * del backend se informa con una notificación (arriba a la derecha). Devuelve false si esa misma operación
   * (misma clave) ya está en curso, para evitar envíos duplicados.
   * Una operación en curso no sobrevive a recargar o cerrar la pestaña: no es una cola persistente.
   */
  const track = useCallback((key: string, msg: OpMessages, fn: () => Promise<unknown>, extra?: { retry?: boolean; onErrorActions?: ToastAction[] }): boolean => {
    if (inflight.current.has(key)) { showToast('info', 'Esa operación ya se está guardando.'); return false }
    inflight.current.add(key)
    setPending(new Set(inflight.current))
    const id = showToast('pending', msg.pending)
    const done = () => { inflight.current.delete(key); setPending(new Set(inflight.current)) }
    fn().then(() => {
      done()
      if (quiet.current) dismiss(id); else updateToast(id, 'success', msg.ok)
    }, (e: unknown) => {
      done()
      const actions: ToastAction[] = [...(extra?.retry !== false ? [{ label: 'Reintentar', run: () => { track(key, msg, fn, extra) } }] : []), ...(extra?.onErrorActions ?? [])]
      const detail = e instanceof Error ? e.message : String(e ?? '')
      updateToast(id, 'error', `${msg.error} ${detail}`.trim(), actions)
    })
    return true
  }, [])

  /**
   * Guarda un orden con una sola petición. Si ya hay uno guardándose, no se descarta el nuevo: queda en cola
   * (solo el más reciente) y se envía al terminar. Si una petición falla, la interfaz vuelve al último orden confirmado.
   */
  const guardarOrden = useCallback((key: string, ids: string[], msg: OpMessages, send: (ids: string[]) => Promise<unknown>,
    onOk: (ids: string[]) => void, onFail: () => void) => {
    if (inflight.current.has(key)) { colaOrden.current[key] = ids; return }
    track(key, msg, async () => {
      let next: string[] | undefined = ids
      try {
        while (next) {
          colaOrden.current[key] = undefined
          await send(next)
          onOk(next)
          next = colaOrden.current[key]
        }
      } catch (e) {
        colaOrden.current[key] = undefined
        onFail()
        throw e
      }
    }, { retry: false })
  }, [track])

  const loadPlantillas = useCallback((force = false): Promise<void> => {
    if (plantillasReq.current) return plantillasReq.current // ya hay una lectura en curso
    if (plantillasLoaded.current && !force) return Promise.resolve() // ya están en memoria
    setPlantillas(p => ({ ...p, loading: true, error: null }))
    const req: Promise<void> = api.getPlantillas()
      .then(items => {
        if (apiRef.current !== api) return // respuesta de otra conexión: se ignora
        plantillasLoaded.current = true
        setPlantillas({ items, loading: false, error: null, loaded: true })
      })
      .catch((e: Error) => { if (apiRef.current === api) setPlantillas(p => ({ ...p, loading: false, error: e.message })) })
      .finally(() => { if (plantillasReq.current === req) plantillasReq.current = null })
    plantillasReq.current = req
    return req
  }, [api])

  const plantillaActions = useMemo(() => ({
    /** Crea o edita. Una plantilla nueva va al final; una copia (afterId), justo después de la original. */
    async save(p: PlantillaInput, mode: 'create' | 'update', afterId?: string) {
      const s = await api.savePlantilla(p, mode, afterId)
      setPlantillas(st => {
        if (st.items.some(x => x.id === s.id)) return { ...st, items: st.items.map(x => (x.id === s.id ? { ...s, orden: x.orden } : x)) }
        const items = [...st.items]
        const pos = afterId ? items.findIndex(x => x.id === afterId) + 1 || items.length : items.length
        items.splice(pos, 0, s)
        return { ...st, items: items.map((x, i) => ({ ...x, orden: i + 1 })) }
      })
    },
    /** Reordenar: se ve al instante y se guarda en una sola petición; si falla, vuelve al último orden confirmado. */
    reorder(ids: string[]) {
      const key = 'plantillas:orden'
      if (!inflight.current.has(key)) plantillasConfirmado.current = plantillasRef.current.map(x => x.id)
      setPlantillas(st => ({ ...st, items: aplicarOrden(st.items, ids) }))
      guardarOrden(key, ids, { pending: 'Guardando el orden…', ok: 'Orden guardado.', error: 'No se pudo guardar el orden de las plantillas. Se restauró el anterior.' },
        x => api.reorderPlantillas(x), x => { plantillasConfirmado.current = x },
        () => setPlantillas(st => ({ ...st, items: aplicarOrden(st.items, plantillasConfirmado.current) })))
    },
    async remove(id: string) {
      await api.deletePlantilla(id)
      setPlantillas(st => ({ ...st, items: st.items.filter(x => x.id !== id) }))
    },
  }), [api, guardarOrden])

  /** Registra un lote de gastos en una sola petición e incorpora los confirmados sin releer el histórico. */
  const registrarLote = useCallback(async (loteId: string, gastos: GastoInput[]) => {
    const r = await api.saveGastosBatch(loteId, gastos)
    const pares = gastos.filter(g => g.plantillaId).map(g => [g.id, g.plantillaId!] as [string, string])
    patch(d => {
      const ids = new Set(r.gastos.map(g => g.id))
      return { ...d, gastos: [...d.gastos.filter(g => !ids.has(g.id)), ...r.gastos], ...(pares.length ? { vinculos: upsertVinculos(d.vinculos, pares) } : {}) }
    })
    return r
  }, [api, patch])

  /** Orden personalizado de la tabla de Gastos: optimista, una petición, y vuelta atrás si falla. */
  const reorderGastos = useCallback((ids: string[]) => {
    const key = 'gastos:orden'
    ordenVersion.current++
    if (!inflight.current.has(key)) gastosConfirmado.current = ordenRef.current
    setOrdenGastos(m => aplicarRangos(m, ids))
    guardarOrden(key, ids, { pending: 'Guardando el orden…', ok: 'Orden guardado.', error: 'No se pudo guardar el orden. Se restauró el anterior.' },
      x => api.reorderGastos(x),
      x => { ordenVersion.current++; gastosConfirmado.current = aplicarRangos(gastosConfirmado.current, x) },
      () => { ordenVersion.current++; setOrdenGastos(gastosConfirmado.current) })
  }, [api, guardarOrden])

  return {
    data, loading, error, lastSync, refresh, actions, track, pending, plantillas, loadPlantillas, plantillaActions,
    lote, setLote, nuevoLote, registrarLote, ordenGastos, reorderGastos, isDemo: !conn && !apiOverride,
  }
}

export type AppStore = ReturnType<typeof useAppData>
