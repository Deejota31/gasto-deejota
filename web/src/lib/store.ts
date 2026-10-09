import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createApi, httpTransport, type Api, type Connection, type GastoInput } from './api'
import { demoTransport } from './demo'
import { todayIn } from './dates'
import type { AppData, Caja, CatalogoItem, Gasto, Medio, Presupuesto } from './types'

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
  // ?demo=10000 carga más filas sintéticas para medir rendimiento en el navegador.
  const n = Math.min(Number(new URLSearchParams(location.search).get('demo')) || 400, 20000)
  return createApi(conn ? httpTransport(conn) : demoTransport(todayIn(), n))
}

/** Estado global: una lectura completa al abrir y al pulsar "Actualizar"; las escrituras actualizan el estado local. */
export function useAppData(conn: Connection | null, apiOverride?: Api) {
  const api = useMemo(() => apiOverride ?? buildApi(conn), [conn, apiOverride])
  const [data, setData] = useState<AppData | null>(() => readSnapshot(conn))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const loadingRef = useRef(false)

  // fresh=true salta la caché del servidor: "Actualizar" siempre trae lo último, incluidas ediciones hechas a mano en la hoja.
  const refresh = useCallback(async (fresh = true) => {
    if (loadingRef.current) return // evita peticiones duplicadas por clics repetidos
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const d = await api.getData(fresh)
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
    setData(readSnapshot(conn))
    void refresh(false)
  }, [refresh, conn])

  const patch = useCallback((fn: (d: AppData) => AppData) => {
    setData(prev => {
      if (!prev) return prev
      const next = fn(prev)
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

  return { data, loading, error, lastSync, refresh, actions, isDemo: !conn && !apiOverride }
}

export type AppStore = ReturnType<typeof useAppData>
