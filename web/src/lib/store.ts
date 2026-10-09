import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createApi, httpTransport, type Api, type Connection, type GastoInput } from './api'
import { demoTransport } from './demo'
import { todayIn } from './dates'
import type { AppData, Caja, CatalogoItem, Gasto, Medio, Presupuesto } from './types'
import { sortCatalogo } from './orden'
import { dismiss, showToast, updateToast, type ToastAction } from './toast'

/** El catálogo siempre se entrega ordenado ("Otros" al final de cada grupo), venga de la hoja o de un cambio local. */
const normalize = (d: AppData): AppData => ({ ...d, catalogo: sortCatalogo(d.catalogo) })

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
  return createApi(falla ? (action, payload) => (action === 'data' ? demo(action, payload)
    : new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('No se pudo conectar con Google Sheets.'), { code: 'NETWORK' })), 300))) : demo)
}

/** Estado global: una lectura completa al abrir y al pulsar "Actualizar"; las escrituras actualizan el estado local. */
export function useAppData(conn: Connection | null, apiOverride?: Api) {
  const api = useMemo(() => apiOverride ?? buildApi(conn), [conn, apiOverride])
  const [data, setData] = useState<AppData | null>(() => { const s = readSnapshot(conn); return s && normalize(s) })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const loadingRef = useRef(false)
  // Cambios confirmados mientras una lectura completa estaba en curso: se vuelven a aplicar sobre su resultado
  // para que una respuesta tardía no pise datos más recientes. Todos los parches son idempotentes (upsert por clave).
  const journal = useRef<((d: AppData) => AppData)[]>([])
  const inflight = useRef(new Set<string>())
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const quiet = useRef(false) // Configuración → "Mostrar notificaciones al guardar" desactivado: se omiten solo los éxitos
  useEffect(() => { quiet.current = data?.config.notificaciones === 'false' }, [data?.config.notificaciones])

  // fresh=true salta la caché del servidor: "Actualizar" siempre trae lo último, incluidas ediciones hechas a mano en la hoja.
  const refresh = useCallback(async (fresh = true) => {
    if (loadingRef.current) return // evita peticiones duplicadas por clics repetidos
    loadingRef.current = true
    journal.current = []
    setLoading(true)
    setError(null)
    try {
      const raw = await api.getData(fresh)
      const d = normalize(journal.current.reduce((acc, fn) => fn(acc), raw))
      journal.current = []
      setData(d)
      setLastSync(new Date())
      writeSnapshot(conn, d)
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
    void refresh(false)
  }, [refresh, conn])

  const patch = useCallback((fn: (d: AppData) => AppData) => {
    if (loadingRef.current) journal.current.push(fn)
    setData(prev => {
      if (!prev) return prev
      const next = normalize(fn(prev))
      writeSnapshot(conn, next)
      return next
    })
  }, [conn])

  const actions = useMemo(() => ({
    async saveGasto(g: GastoInput, mode: 'create' | 'update') {
      const saved = await api.saveGasto(g, mode)
      patch(d => ({ ...d, gastos: mode === 'create' && !d.gastos.some(x => x.id === saved.id) ? [...d.gastos, saved] : d.gastos.map(x => x.id === saved.id ? saved : x) }))
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

  return { data, loading, error, lastSync, refresh, actions, track, pending, isDemo: !conn && !apiOverride }
}

export type AppStore = ReturnType<typeof useAppData>
