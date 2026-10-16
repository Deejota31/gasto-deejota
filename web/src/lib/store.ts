import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { calentar, createApi, httpTransport, type Api, type Connection, type AplicarItem, type FuenteInput, type GastoInput, type PlantillaFinInput, type PlantillaInput } from './api'
import { demoTransport } from './demo'
import { todayIn } from './dates'
import type { ConcGrupoInput, ConcSeguimientoInput, ConcVerificacionInput } from './api'
import type { AppData, Caja, PlantillaFin, TipoPlantillaFin, CatalogoItem, Fuente, FuenteMes, Gasto, Medio, Plantilla, Presupuesto, Revision } from './types'
import { ordenTrasReordenarCategorias, sortCatalogo } from './orden'
import { ambitoLook, categoriaLook, claveDeIcono, registrarMedios, subcategoriaLook } from './visual'
import { dismiss, showToast, updateToast, type ToastAction } from './toast'
import { guardarCola, leerCola, OPS, upsertVinculos, type ArgsOp, type NombreOp, type OpPersistida, type ResultadoOp } from './operaciones'

/** El catálogo siempre se entrega ordenado ("Otros" al final de cada grupo), venga de la hoja o de un cambio local. */
// El orden personalizado de Gastos se separa de `data`: reordenar no debe recalcular KPIs ni gráficos.
const normalize = (d: AppData): AppData => { const { ordenGastos: _o, ...rest } = d; return { ...rest, catalogo: sortCatalogo(d.catalogo) } }
const ordenMap = (d: AppData | null) => new Map((d?.ordenGastos ?? []).map(([id, o]) => [id.toLowerCase(), o]))
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
  const demo = demoTransport(todayIn(), n, Math.min(Number(q.get('latencia')) || 250, 20000), Math.min(Number(q.get('cajas')) || 0, 10), Math.min(Number(q.get('fuentes')) || 0, 25), q.get('vacio') === '1')
  // ?falla=aplicar: solo fallan las acciones «aplicar…» (permite crear plantillas y probar el error del guardado en segundo plano).
  const falla = q.get('falla') === '1' || q.get('falla') === 'timeout' || q.get('falla') === 'aplicar'
  const soloAplicar = q.get('falla') === 'aplicar'
  const codigo = q.get('falla') === 'timeout' ? { code: 'TIMEOUT', msg: 'Apps Script tardó demasiado en responder.' } : { code: 'NETWORK', msg: 'No se pudo conectar con Google Sheets.' }
  return createApi(falla ? (action, payload) => (action === 'data' || action === 'plantillas' || (soloAplicar && !action.startsWith('aplicar')) ? demo(action, payload)
    : (() => {
      const w = globalThis as unknown as { __gdDemoCalls?: Record<string, number> } // también cuenta los intentos fallidos
      w.__gdDemoCalls = { ...w.__gdDemoCalls, [action]: (w.__gdDemoCalls?.[action] ?? 0) + 1 }
      return new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(codigo.msg), { code: codigo.code })), 300))
    })()) : demo)
}

/** Estado global: una lectura completa al abrir y al pulsar "Actualizar"; las escrituras actualizan el estado local. */
/** El modo demostración (datos de ejemplo) solo se activa a propósito con ?demo=… (desarrollo y pruebas). Sin conexión NO se inventan datos. */
const hayDemoParam = () => { try { return new URLSearchParams(location.search).has('demo') } catch { return false } }

export function useAppData(conn: Connection | null, apiOverride?: Api) {
  const demoActivo = hayDemoParam()
  const desconectado = !conn && !apiOverride && !demoActivo
  const api = useMemo(() => apiOverride ?? buildApi(conn), [conn, apiOverride])
  const [data, setData] = useState<AppData | null>(() => { const s = readSnapshot(conn); return s && normalize(s) })
  const dataRef = useRef(data)
  dataRef.current = data
  registrarMedios(data?.medios ?? []) // antes de pintar a los hijos: medioLook usa lo elegido por el usuario
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
  /** true solo tras una lectura exitosa de la hoja en esta sesión; el respaldo del navegador nunca cuenta como confirmado. */
  const [confirmado, setConfirmado] = useState(false)
  const loadingRef = useRef(false)
  // Cambios confirmados mientras una lectura completa estaba en curso: se vuelven a aplicar sobre su resultado
  // para que una respuesta tardía no pise datos más recientes. Todos los parches son idempotentes (upsert por clave).
  const journal = useRef<((d: AppData) => AppData)[]>([])
  const inflight = useRef(new Set<string>())
  // Escrituras optimistas pendientes (v1.23): cambio local por operación, cola secuencial y cola persistida (sobrevive a recargar).
  const pend = useRef(new Map<string, (d: AppData) => AppData>())
  const serie = useRef<Promise<unknown>>(Promise.resolve())
  const colaPersist = useRef<OpPersistida[]>([])
  const [enCola, setEnCola] = useState(0)
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  // Plantillas: estado aparte de `data` para que sus cambios no recalculen KPIs ni gráficos.
  // Se leen una sola vez (al abrir "Gastos mensuales") y se reutilizan; "Actualizar" las marca para releer.
  const [plantillas, setPlantillas] = useState<{ items: Plantilla[]; loading: boolean; error: string | null; loaded: boolean }>(
    { items: [], loading: false, error: null, loaded: false })
  const plantillasReq = useRef<Promise<void> | null>(null)
  // Cambios de plantillas confirmados mientras una lectura de la hoja estaba en curso: se reaplican sobre su
  // resultado para que una respuesta antigua no pise un estado más reciente.
  const plJournal = useRef<((items: Plantilla[]) => Plantilla[])[]>([])
  const aplicarPl = (fn: (items: Plantilla[]) => Plantilla[]) => {
    if (plantillasReq.current) plJournal.current.push(fn)
    setPlantillas(st => ({ ...st, items: fn(st.items) }))
  }
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
  /** Devuelve true si la lectura terminó bien (false: error u otra lectura en curso). */
  const refresh = useCallback(async (fresh = true): Promise<boolean> => {
    if (desconectado || loadingRef.current) return false // sin conexión no hay nada que leer; evita peticiones duplicadas por clics repetidos
    loadingRef.current = true
    journal.current = []
    plantillasLoaded.current = false // la próxima apertura de "Gastos mensuales" relee la hoja
    setPlantillas(p => ({ ...p, loaded: false }))
    setLoading(true)
    setError(null)
    const ordenAlEmpezar = ordenVersion.current
    try {
      const raw = await api.getData(fresh)
      // Lo que ya se ve en pantalla pero el backend aún no confirmó se vuelve a aplicar encima de la lectura (si no, "desaparecería").
      const merged = [...pend.current.values()].reduce((acc, fn) => fn(acc), journal.current.reduce((acc, fn) => fn(acc), raw))
      journal.current = []
      setData(normalize(merged))
      const ordenVigente = ordenVersion.current === ordenAlEmpezar && !inflight.current.has('gastos:orden')
      if (ordenVigente) setOrdenGastos(ordenMap(raw))
      setLastSync(new Date())
      setConfirmado(true)
      writeSnapshot(conn, ordenVigente ? merged : { ...merged, ordenGastos: [...ordenRef.current] })
      return true
    } catch (e) {
      setError((e as Error).message)
      setConfirmado(false) // la lectura falló: lo que se ve puede estar desactualizado y así se indica
      return false
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [api, conn, desconectado])

  const patch = useCallback((fn: (d: AppData) => AppData) => {
    if (loadingRef.current) journal.current.push(fn)
    setData(prev => {
      if (!prev) return prev
      const next = normalize(fn(prev))
      writeSnapshot(conn, { ...next, ordenGastos: [...ordenRef.current] })
      return next
    })
  }, [conn])

  const url = conn?.url
  /**
   * Escritura optimista: el cambio se ve al instante, se envía a Apps Script en segundo plano (una a una, en orden) y, si falla,
   * se revierte SOLO esa entidad. La promesa se resuelve/rechaza con el resultado real del backend (los avisos dependen de él).
   */
  const lanzar = useCallback(<N extends NombreOp>(nombre: N, args: ArgsOp<N>, o?: Pick<OpPersistida, 'id' | 'ts' | 'prev' | 'hay'>): Promise<ResultadoOp<N>> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = OPS[nombre] as any
    const id = o?.id ?? crypto.randomUUID(), ts = o?.ts ?? new Date().toISOString(), miApi = api
    // Al reenviar tras recargar, "lo que había antes" viene de la cola guardada (la pantalla ya traía el cambio optimista).
    const hay = o ? !!o.hay : !!dataRef.current
    const prev = o ? o.prev : hay ? d.capturar(dataRef.current, ...args) : undefined
    const local = (x: AppData): AppData => d.local(x, ts, ...args)
    pend.current.set(id, local)
    patch(local)
    if (!o?.id) { colaPersist.current = [...colaPersist.current, { id, nombre, args: args as unknown[], ts, prev, hay }]; guardarCola(url, colaPersist.current) }
    setEnCola(n => n + 1)
    const fin = () => {
      pend.current.delete(id)
      colaPersist.current = colaPersist.current.filter(x => x.id !== id)
      guardarCola(url, colaPersist.current)
      setEnCola(n => n - 1)
    }
    const p = serie.current.then(async () => {
      try {
        const r = await d.remoto(miApi, ...args)
        fin()
        if (d.confirmar) patch(x => d.confirmar(x, r, prev, ...args))
        return r
      } catch (e) {
        fin()
        if (hay) patch(x => d.deshacer(x, prev, ...args))
        throw e
      }
    }) as Promise<ResultadoOp<N>>
    serie.current = p.catch(() => undefined)
    return p
  }, [api, patch, url])

  /** Al abrir: reenvía lo que quedó pendiente de la sesión anterior (recarga o cierre con cambios sin confirmar). */
  const reproducir = useCallback(() => {
    const ops = leerCola(url).filter(o => !pend.current.has(o.id))
    if (!ops.length) return
    colaPersist.current = [...colaPersist.current, ...ops]
    const toast = showToast('pending', `Enviando ${ops.length} cambio${ops.length === 1 ? '' : 's'} pendiente${ops.length === 1 ? '' : 's'} de la sesión anterior…`)
    const fallos: OpPersistida[] = []
    void Promise.all(ops.map(o => (lanzar(o.nombre as NombreOp, o.args as never, o) as Promise<unknown>).catch(() => { fallos.push(o) }))).then(() => {
      if (!fallos.length) { if (quiet.current) dismiss(toast); else updateToast(toast, 'success', 'Cambios pendientes enviados.'); return }
      updateToast(toast, 'error', `No se pudieron enviar ${fallos.length} cambio${fallos.length === 1 ? '' : 's'} pendiente${fallos.length === 1 ? '' : 's'}; se revirtieron en pantalla. Reintentar no duplica.`,
        [{ label: 'Reintentar', run: () => { fallos.forEach(o => { void (lanzar(o.nombre as NombreOp, o.args as never) as Promise<unknown>).catch(() => undefined) }); dismiss(toast) } }])
    })
  }, [url, lanzar])

  // Con cambios sin confirmar, el navegador pide confirmación antes de cerrar la pestaña.
  useEffect(() => {
    if (!enCola) return
    const alCerrar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', alCerrar)
    return () => window.removeEventListener('beforeunload', alCerrar)
  }, [enCola])

  useEffect(() => {
    const s = readSnapshot(conn)
    setData(s && normalize(s))
    setOrdenGastos(ordenMap(s))
    setConfirmado(false)
    if (desconectado) { setError(null); return }   // sin conexión no se lee nada ni se muestran datos de ejemplo
    if (conn && !apiOverride) calentar(conn)   // despierta Apps Script mientras se pinta el respaldo del navegador (sin esperar)
    reproducir()
    // Siempre lectura fresca al abrir/recargar: la caché del servidor (10 min) no ve las ediciones hechas a mano en la
    // hoja y mostraba registros ya eliminados. El respaldo del navegador solo sirve para pintar mientras llega la lectura.
    void refresh(true)
  }, [refresh, conn, desconectado, reproducir, apiOverride])

  const actions = useMemo(() => ({
    saveGasto: (g: GastoInput, mode: 'create' | 'update') => lanzar('saveGasto', [g, mode]),
    async setEstado(g: Gasto, estado: 'Activo' | 'Anulado') { await lanzar('setEstado', [g.id, estado]) },
    async setEstadoLote(gs: Gasto[], estado: 'Activo' | 'Anulado') { await lanzar('setEstadoLote', [gs.map(g => g.id), estado]) },
    async saveCatalogo(item: CatalogoItem) { await lanzar('saveCatalogo', [item]) },
    renameCatalogo: (p: Parameters<Api['renameCatalogo']>[0]) => lanzar('renameCatalogo', [p]),
    /** Orden manual de categorías de un ámbito: se ve al instante; si falla, vuelve al anterior. */
    async reorderCategorias(ambito: string, nombres: string[]) {
      let previo: CatalogoItem[] = []
      const aplicar = (d: AppData) => { const o = ordenTrasReordenarCategorias(d.catalogo, ambito, nombres); return { ...d, catalogo: d.catalogo.map((c, i) => ({ ...c, orden: o[i] })) } }
      setData(d => { previo = d?.catalogo ?? []; return d && normalize(aplicar(d)) })
      try { await api.reorderCategorias(ambito, nombres); patch(aplicar) } catch (e) { setData(d => d && { ...d, catalogo: previo }); throw e }
    },
    /** Elimina una categoría (y, con `cascada`, sus subcategorías) del catálogo. Nunca borra gastos. */
    deleteCategoria: (ambito: string, categoria: string, cascada = false) => lanzar('deleteCategoria', [ambito, categoria, cascada]),
    async saveMedio(m: Medio) { await lanzar('saveMedio', [m]) },
    async saveCaja(c: Caja) { await lanzar('saveCaja', [c]) },
    /** Elimina una caja. Sus gastos pasan a "fuera de cajas" (u otra caja que coincida); no se borra ningún gasto. */
    async deleteCaja(id: string) { await lanzar('deleteCaja', [id]) },
    /** Orden manual de subcajas: se ve al instante; si falla, vuelve al anterior. */
    async reorderCajas(ids: string[]) {
      let previo: Caja[] = []
      const aplicar = (d: AppData) => ({ ...d, cajas: d.cajas.map(c => c.filtroCampo === 'Todos' ? { ...c, orden: 1 } : { ...c, orden: ids.indexOf(c.id) >= 0 ? ids.indexOf(c.id) + 2 : ids.length + 2 }) })
      setData(d => { previo = d?.cajas ?? []; return d && aplicar(d) })
      try { await api.reorderCajas(ids); patch(aplicar) } catch (e) { setData(d => d && { ...d, cajas: previo }); throw e }
    },
    async savePresupuesto(p: Presupuesto) { await lanzar('savePresupuesto', [p]) },
    /** Plantillas de fuentes/subcajas. Solo guardan configuración: no crean fuentes, subcajas, dinero ni gastos. */
    savePlantillaFin: (p: PlantillaFinInput) => lanzar('savePlantillaFin', [p]),
    async deletePlantillaFin(id: string) { await lanzar('deletePlantillaFin', [id]) },
    /** Orden de las plantillas: se ve al instante; si falla, vuelve al anterior (una sola solicitud por arrastre). */
    async reorderPlantillasFin(tipo: TipoPlantillaFin, ids: string[]) {
      let previo: PlantillaFin[] = []
      const aplicar = (d: AppData) => ({ ...d, plantillasFin: (d.plantillasFin ?? []).map(x => x.tipo === tipo ? { ...x, orden: ids.indexOf(x.id) >= 0 ? ids.indexOf(x.id) + 1 : ids.length + 1 } : x) })
      setData(d => { previo = d?.plantillasFin ?? []; return d && aplicar(d) })
      try { await api.reorderPlantillasFin(tipo, ids); patch(aplicar) } catch (e) { setData(d => d && { ...d, plantillasFin: previo }); throw e }
    },
    /** Aplica / omite / devuelve a Pendiente en un mes. Después relee solo lo que puede haber cambiado (fuentes, cajas, importes del mes). */
    async aplicarPlantillasFin(mes: string, items: AplicarItem[]) {
      const pl = await api.aplicarPlantillasFin(mes, items)
      const raw = await api.getData(true)   // relectura real de Sheets: de aquí sale la verificación de lo aplicado
      patch(d => ({
        ...d, plantillasFin: (d.plantillasFin ?? []).map(x => pl.find(y => y.id === x.id) ?? x).concat(pl.filter(y => !(d.plantillasFin ?? []).some(x => x.id === y.id))),
        fuentes: raw.fuentes, fuentesMeses: raw.fuentesMeses, cajas: raw.cajas, presupuestos: raw.presupuestos,
      }))
      return { plantillas: pl, datos: { fuentes: raw.fuentes ?? [], fuentesMeses: raw.fuentesMeses ?? [], cajas: raw.cajas, presupuestos: raw.presupuestos } }
    },
    /** Aplica fuentes o subcajas existentes a un mes y relee solo lo necesario (todo o nada; idempotente). */
    async aplicarEntidadesMes(tipo: 'fuente' | 'subcaja', mes: string, items: { id: string; monto: number }[]) {
      await api.aplicarEntidadesMes(tipo, mes, items)
      const raw = await api.getData(true)
      patch(d => ({ ...d, fuentes: raw.fuentes, fuentesMeses: raw.fuentesMeses, cajas: raw.cajas, presupuestos: raw.presupuestos }))
      return { fuentes: raw.fuentes ?? [], fuentesMeses: raw.fuentesMeses ?? [], cajas: raw.cajas, presupuestos: raw.presupuestos }
    },
    /** Crea o edita una fuente. Upsert por ID: un reintento o doble clic con el mismo ID no crea otra. */
    saveFuente: (f: FuenteInput) => lanzar('saveFuente', [f]),
    /** Importe de una fuente para un mes ("solo") o desde un mes ("desde"). Nunca toca otros meses. */
    async saveFuenteMes(m: FuenteMes, quitar = false) { await lanzar('saveFuenteMes', [m, quitar]) },
    /** Elimina una fuente y sus importes por mes. Los gastos no se tocan (la atribución se calcula, no se guarda). */
    async deleteFuente(id: string) { await lanzar('deleteFuente', [id]) },
    /** Orden de las fuentes: se ve al instante; si falla, vuelve al anterior. */
    async reorderFuentes(ids: string[]) {
      let previo: Fuente[] = []
      const aplicar = (d: AppData) => ({ ...d, fuentes: (d.fuentes ?? []).map(f => ({ ...f, orden: ids.indexOf(f.id) >= 0 ? ids.indexOf(f.id) + 1 : ids.length + 1 })) })
      setData(d => { previo = d?.fuentes ?? []; return d && aplicar(d) })
      try { await api.reorderFuentes(ids); patch(aplicar) } catch (e) { setData(d => d && { ...d, fuentes: previo }); throw e }
    },
    /** Migración pedida por el usuario: fuente General desde la caja general (con sus ajustes mensuales). Idempotente. */
    async migrarGeneralAFuente() {
      const r = await api.migrarGeneralAFuente()
      const f = r.fuente
      if (f) patch(d => ({
        ...d,
        fuentes: [...(d.fuentes ?? []).filter(x => x.id !== f.id), f],
        fuentesMeses: [...(d.fuentesMeses ?? []).filter(x => x.fuenteId !== f.id), ...r.ajustes],
      }))
      return r
    },
    async saveConfig(clave: string, valor: string) { await lanzar('saveConfig', [clave, valor]) },
    /** Asocia (o desasocia con '') un movimiento existente a un compromiso. No cambia el gasto. */
    async vincular(gastoId: string, plantillaId: string) { await lanzar('vincular', [gastoId, plantillaId]) },
    /** Conciliación de saldos: solo agrega filas a CONCILIACIONES. Nunca modifica fuentes, gastos, cajas ni presupuestos. */
    async saveConciliacion(i: ConcVerificacionInput) { const f = await api.saveConciliacion(i); patch(d => ({ ...d, conciliaciones: [...(d.conciliaciones ?? []).filter(x => x.id !== f.id), f] })) },
    async saveSeguimientoConciliacion(i: ConcSeguimientoInput) { const f = await api.saveSeguimientoConciliacion(i); patch(d => ({ ...d, conciliaciones: [...(d.conciliaciones ?? []).filter(x => x.id !== f.id), f] })) },
    async saveGrupoConciliacion(i: ConcGrupoInput) { const f = await api.saveGrupoConciliacion(i); patch(d => ({ ...d, conciliaciones: [...(d.conciliaciones ?? []).filter(x => x.id !== f.id), f] })) },
    /** Decisión sobre una coincidencia (legítima, pendiente o duplicado confirmado). Nunca modifica movimientos. */
    async saveRevision(r: Pick<Revision, 'id' | 'ids' | 'estado' | 'firma'>) {
      const saved = await api.saveRevision(r)
      const key = saved.ids.join(',')
      patch(d => ({ ...d, revisiones: [...(d.revisiones ?? []).filter(x => x.ids.join(',') !== key), saved] }))
    },
    /**
     * Rellena en la hoja las celdas vacías (Activo, Icono, Medio de pago "Libre", Orden…). Para el catálogo envía el icono y
     * el color que se ven hoy en cada fila, así la hoja queda igual que la web. Devuelve cuántas filas cambió en total.
     */
    async completarVacios() {
      const cat = dataRef.current?.catalogo ?? []
      const defs = cat.filter(c => !c.icono || !c.color).map(c => {
        const l = !c.categoria ? ambitoLook(c.ambito, cat) : !c.subcategoria ? categoriaLook(c.categoria, cat) : subcategoriaLook(c.subcategoria, c.categoria, cat)
        return { ambito: c.ambito, categoria: c.categoria, subcategoria: c.subcategoria, icono: claveDeIcono(l.Icon), color: l.color }
      })
      const r = await api.completarVacios(defs)
      const n = r.cajas + r.fuentes + r.catalogo + r.config + (r.medios ?? 0)
      if (n > 0) await refresh(true)
      return { ...r, total: n }
    },
    diagnose: () => api.diagnose(),
    /** Ejecuta una función del backend por nombre; si pudo cambiar la hoja, relee los datos. */
    async ejecutarFuncion(nombre: string, cambiaHoja: boolean) {
      const r = await api.ejecutar(nombre)
      if (cambiaHoja) await refresh(true)
      return r
    },
    carpetaRespaldo: () => api.carpetaRespaldo(),
    saveCarpetaRespaldo: (c: string) => api.saveCarpetaRespaldo(c),
    backup: () => api.backup(),
  }), [api, patch, refresh, lanzar])

  /**
   * Ejecuta una escritura sin bloquear la interfaz: la promesa sigue en segundo plano y el resultado real
   * del backend se informa con una notificación (arriba a la derecha). Devuelve false si esa misma operación
   * (misma clave) ya está en curso, para evitar envíos duplicados.
   * Una operación en curso no sobrevive a recargar o cerrar la pestaña: no es una cola persistente.
   */
  const track = useCallback((key: string, msg: OpMessages, fn: () => Promise<unknown>, extra?: { retry?: boolean; onErrorActions?: ToastAction[]; onDone?: (ok: boolean, error?: string) => void; silencioso?: boolean }): boolean => {
    if (inflight.current.has(key)) { showToast('info', 'Esa operación ya se está guardando.'); return false }
    inflight.current.add(key)
    setPending(new Set(inflight.current))
    const id = extra?.silencioso ? -1 : showToast('pending', msg.pending)   // silencioso: sin avisos de progreso/éxito (solo errores)
    const done = () => { inflight.current.delete(key); setPending(new Set(inflight.current)) }
    fn().then(() => {
      done()
      if (extra?.silencioso) { /* sin aviso */ } else if (quiet.current) dismiss(id); else updateToast(id, 'success', msg.ok)
      extra?.onDone?.(true)
    }, (e: unknown) => {
      done()
      const actions: ToastAction[] = [...(extra?.retry !== false ? [{ label: 'Reintentar', run: () => { track(key, msg, fn, extra) } }] : []), ...(extra?.onErrorActions ?? [])]
      const detail = e instanceof Error ? e.message : String(e ?? '')
      // Sin respuesta (red, tiempo agotado): la hoja pudo haber guardado igual. Todas las escrituras son idempotentes.
      const code = (e as { code?: string } | null)?.code
      const incierto = code === 'TIMEOUT' || code === 'NETWORK' || code === 'HTTP'
        ? ' Resultado incierto: puede que sí se haya guardado; reintentar no duplica.' : ''
      updateToast(id, 'error', `${msg.error} ${detail}${incierto}`.trim(), actions)
      extra?.onDone?.(false, `${msg.error} ${detail}${incierto}`.trim())
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
    plJournal.current = []
    const req: Promise<void> = api.getPlantillas()
      .then(leidas => {
        if (apiRef.current !== api) return // respuesta de otra conexión: se ignora
        plantillasLoaded.current = true
        const items = plJournal.current.reduce((acc, fn) => fn(acc), leidas)
        plJournal.current = []
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
      aplicarPl(items => {
        if (items.some(x => x.id === s.id)) return items.map(x => (x.id === s.id ? { ...s, orden: x.orden } : x))
        const out = [...items]
        const pos = afterId ? out.findIndex(x => x.id === afterId) + 1 || out.length : out.length
        out.splice(pos, 0, s)
        return out.map((x, i) => ({ ...x, orden: i + 1 }))
      })
    },
    /** Reordenar: se ve al instante y se guarda en una sola petición; si falla, vuelve al último orden confirmado. */
    reorder(ids: string[]) {
      const key = 'plantillas:orden'
      if (!inflight.current.has(key)) plantillasConfirmado.current = plantillasRef.current.map(x => x.id)
      setPlantillas(st => ({ ...st, items: aplicarOrden(st.items, ids) }))
      guardarOrden(key, ids, { pending: 'Guardando el orden…', ok: 'Orden guardado.', error: 'No se pudo guardar el orden de las plantillas. Se restauró el anterior.' },
        x => api.reorderPlantillas(x), x => { plantillasConfirmado.current = x; aplicarPl(items => aplicarOrden(items, x)) },
        () => setPlantillas(st => ({ ...st, items: aplicarOrden(st.items, plantillasConfirmado.current) })))
    },
    async remove(id: string) {
      await api.deletePlantilla(id)
      aplicarPl(items => items.filter(x => x.id !== id))
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
    data, loading, error, lastSync, confirmado, refresh, actions, track, pending, enCola, plantillas, loadPlantillas, plantillaActions,
    lote, setLote, nuevoLote, registrarLote, ordenGastos, reorderGastos, isDemo: !conn && !apiOverride && demoActivo, desconectado,
  }
}

export type AppStore = ReturnType<typeof useAppData>
