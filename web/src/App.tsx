import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { configurarExcepciones } from './lib/texto'
import { loadConnection, type Api, type Connection } from './lib/api'
import { useAppData } from './lib/store'
import { Skeleton, ErrorBox } from './components/ui'
import { Desconectado } from './components/Desconectado'
import Toaster from './components/Toaster'
import AppShell from './components/AppShell'
import { tabDeHash, type TabId } from './lib/navegacion'
import ConexionModal from './components/ConexionModal'
import GastoModal, { GASTO_MSG, type GastoDraft, type GastoPreset, type ModalMode } from './components/GastoModal'
import PlantillasModal, { type PlantillaDraft } from './components/PlantillasModal'
import type { GastoInput } from './lib/api'
import type { Gasto } from './lib/types'
import { showToast } from './lib/toast'
import { refrescoSegundos } from './lib/refresco'
import { emptyFilters } from './components/shared'
import { todayIn } from './lib/dates'
import type { Filters } from './lib/types'
import Gastos from './tabs/Gastos'
import Catalogo from './tabs/Categorias'
import { usePlanificacion } from './components/Planificacion'
import type { ContextoPlan } from './lib/planificar'
import { usePlantillasFin } from './components/PlantillasFin'
import Configuracion, { APP_VERSION } from './tabs/Configuracion'

// Recharts es la dependencia más pesada: el Dashboard se carga aparte para que Gastos abra rápido.
const Dashboard = lazy(() => import('./tabs/Dashboard'))
const Salud = lazy(() => import('./tabs/Salud'))
const CajasTab = lazy(() => import('./tabs/Cajas'))

export default function App({ api }: { api?: Api }) {
  const [conn, setConn] = useState<Connection | null>(() => loadConnection())
  const store = useAppData(conn, api)
  const [tab, setTab] = useState<TabId>(() => tabDeHash(location.hash) ?? 'dashboard')
  const [conexionAbierta, setConexionAbierta] = useState(false)
  // Un solo formulario de gasto para toda la app (Dashboard y Gastos lo abren igual).
  const [modal, setModal] = useState<{ mode: ModalMode; gasto: Gasto | null; draft?: GastoDraft; preset?: GastoPreset; key: number } | null>(null)
  const openGasto = useCallback((mode: ModalMode, gasto: Gasto | null, draft?: GastoDraft, preset?: GastoPreset) => setModal({ mode, gasto, draft, preset, key: Date.now() }), [])
  // "Revisar movimiento" desde Salud financiera: abre Gastos con ese movimiento resaltado y su formulario, y permite volver.
  const [foco, setFoco] = useState<{ id: string; desde: TabId } | null>(null)
  const irATab = useCallback((t: TabId) => { setTab(t); if (t !== 'gastos') setFoco(null) }, [])
  const [plantillasOpen, setPlantillasOpen] = useState<false | { draft?: PlantillaDraft; key: number; ctx?: ContextoPlan }>(false)
  const tz = store.data?.config.zona_horaria || 'America/Lima'
  const today = useMemo(() => { try { return todayIn(tz) } catch { return todayIn() } }, [tz])
  // Planificación mensual (v1.19): campana, asistente y resumen globales. Las plantillas se abren desde el asistente.
  const plantillasApp = usePlantillasFin(store, today.slice(0, 7))
  const plan = usePlanificacion(store, { hoy: today, onGastosMensuales: ctx => setPlantillasOpen({ key: Date.now(), ctx }), onPlantillas: (t, ctx) => plantillasApp.abrir(t, { modo: 'lista' }, ctx), onConfigurar: () => irATab('config') })
  // Filtros compartidos entre Dashboard y Gastos: lo que filtras en uno se respeta en el otro.
  const [filters, setFilters] = useState<Filters>(() => emptyFilters(todayIn()))

  useEffect(() => {
    history.replaceState(null, '', `#${tab}`)
  }, [tab])
  // Enlaces directos (#salud, #gastos…) y cambios manuales de la dirección: cambia de pestaña sin recargar.
  useEffect(() => {
    const onHash = () => { const t = tabDeHash(location.hash); if (t) irATab(t) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [irATab])
  // Las notificaciones se ubican debajo de la barra superior: nunca tapan el menú (que ahora va centrado).
  const headerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = headerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { configurarExcepciones(store.data?.config.desc_excepciones) }, [store.data?.config.desc_excepciones])
  useEffect(() => { document.documentElement.dataset.theme = store.data?.config.tema === 'oscuro' ? 'dark' : 'light' }, [store.data?.config.tema])
  const notify = (m: string) => { if (store.data?.config.notificaciones !== 'false') showToast('success', m) }

  // Una vez por versión (y por hoja conectada), con el backend al día: rellena las celdas vacías de la hoja (Activo, Icono,
  // Medio "Libre"…) para que quede coherente con lo que ves en la web. Nunca pisa lo que ya tiene contenido.
  const vaciosIntentado = useRef('')
  useEffect(() => {
    if (!conn || !store.data || !store.lastSync) return
    const v = (store.data.version ?? '0').split('.').map(Number)
    if (!(v[0] > 1 || (v[0] === 1 && v[1] >= 11))) return            // backend anterior: primero hay que volver a desplegarlo
    const marca = `${APP_VERSION}|${conn.url}`
    let hecho = ''
    try { hecho = localStorage.getItem('gd.vacios') ?? '' } catch { /* modo privado */ }
    if (hecho === marca || vaciosIntentado.current === marca) return
    vaciosIntentado.current = marca
    store.actions.completarVacios().then(r => {
      try { localStorage.setItem('gd.vacios', marca) } catch { /* modo privado */ }
      if (r.total > 0) showToast('success', `Hoja completada: ${r.total} fila(s) con valores que estaban vacíos.`)
    }, () => { /* se reintenta en la próxima carga */ vaciosIntentado.current = '' })
  }, [conn, store.data, store.lastSync, store.actions])

  // Actualización automática: cada N segundos (Configuración) relee la hoja y avisa en verde. No corre con la pestaña
  // oculta ni mientras se guarda algo; al volver a la pestaña se pone al día si ya pasó el intervalo.
  const segundos = refrescoSegundos(store.data?.config.refresco_segundos)
  const vivo = useRef({ loading: store.loading, pendientes: store.pending.size, lastSync: store.lastSync, refresh: store.refresh })
  vivo.current = { loading: store.loading, pendientes: store.pending.size, lastSync: store.lastSync, refresh: store.refresh }
  useEffect(() => {
    if (!segundos || !store.data) return
    const correr = async () => {
      const v = vivo.current
      if (document.visibilityState === 'hidden' || v.loading || v.pendientes > 0) return
      if (await v.refresh(true)) showToast('success', `Datos actualizados · ${new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`)
    }
    const id = setInterval(() => void correr(), segundos * 1000)
    const alVolver = () => { if (document.visibilityState === 'visible' && Date.now() - (vivo.current.lastSync?.getTime() ?? 0) >= segundos * 1000) void correr() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', alVolver) }
  }, [segundos, !!store.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // Guardar no bloquea: el formulario se cierra al aceptar la operación y el resultado real llega como notificación.
  function submitGasto(input: GastoInput, mode: ModalMode, draft: GastoDraft): boolean {
    return store.track(`gasto:${input.id}`, GASTO_MSG[mode], () => store.actions.saveGasto(input, mode === 'edit' ? 'update' : 'create'), {
      onErrorActions: [{ label: 'Abrir formulario', run: () => openGasto(mode, null, draft) }],
    })
  }

  const avisos = (
    <>
      {!store.isDemo && store.data && !store.confirmado && (
        <div role="alert" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-warning-soft px-4 py-1.5 text-center text-xs text-warning" data-testid="sin-confirmar">
          <span>{store.loading ? 'Confirmando tus datos con la hoja…' : 'Estos datos se guardaron en este navegador y no se pudieron confirmar con tu hoja; pueden estar desactualizados.'}</span>
          {!store.loading && <button className="font-semibold underline" onClick={() => void store.refresh()}>Reintentar</button>}
        </div>
      )}
      {store.desconectado && (
        <div className="bg-bg px-4 py-1.5 text-center text-xs text-muted" data-testid="aviso-desconectado">
          Sin conexión. <button className="font-semibold underline" onClick={() => setConexionAbierta(true)}>Conecta tu Apps Script</button> para ver y usar tu hoja.
        </div>
      )}
      {store.isDemo && (
        <div className="bg-morado/10 px-4 py-1.5 text-center text-xs text-morado">
          Modo demostración con datos de ejemplo. <button className="font-semibold underline" onClick={() => setConexionAbierta(true)}>Conecta tu Apps Script</button> para usar tu hoja.
        </div>
      )}
    </>
  )

  const sinDatosPorError = !!conn && !!store.error && !store.data
  const seccionVacia = tab !== 'config' && (store.desconectado || sinDatosPorError)
  const contenido = seccionVacia ? (
    store.desconectado
      ? <Desconectado seccion={tab as 'dashboard' | 'cajas' | 'gastos' | 'salud' | 'catalogo'} onConectar={() => setConexionAbierta(true)} />
      : <ErrorBox message={`No se pudieron cargar tus datos: ${store.error}`} onRetry={() => void store.refresh()} />
  ) : (
    <>
        {tab === 'dashboard' && <Suspense fallback={<Skeleton className="h-96" />}><Dashboard plan={plan} store={store} filters={filters} setFilters={setFilters} today={today} onNuevoGasto={() => openGasto('create', null)} onGastosMensuales={() => setPlantillasOpen({ key: Date.now() })} onIrCajas={() => irATab('cajas')} /></Suspense>}
        {tab === 'cajas' && <Suspense fallback={<Skeleton className="h-96" />}><CajasTab store={store} filters={filters} setFilters={setFilters} today={today} plan={plan} /></Suspense>}
        {tab === 'gastos' && <Gastos store={store} openGasto={openGasto} filters={filters} setFilters={setFilters} today={today} onGastosMensuales={() => setPlantillasOpen({ key: Date.now() })}
          foco={foco} onVolverFoco={foco ? () => irATab(foco.desde) : undefined} />}
        {tab === 'salud' && <Suspense fallback={<Skeleton className="h-96" />}><Salud store={store} filters={filters} setFilters={setFilters} today={today}
          onGastosMensuales={() => setPlantillasOpen({ key: Date.now() })}
          onConcRevisarGastos={(desde, hasta) => { setFilters({ preset: 'custom', desde, hasta, ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }); irATab('gastos') }}
          onConcNuevoGasto={fecha => openGasto('create', null, undefined, { ambito: 'Personal', categoria: '', subcategoria: '', descripcion: '', fecha })}
          onConcIrFuentes={() => irATab('cajas')}
          onRevisarGasto={g => { setFoco({ id: g.id, desde: 'salud' }); setTab('gastos'); if (!g.problemaId) openGasto('edit', g) }} /></Suspense>}
        {tab === 'catalogo' && <Catalogo store={store} />}
        {tab === 'config' && <Configuracion plan={plan} hoy={today} store={store} conn={conn} onConnect={setConn} notify={notify} goCatalogo={() => setTab('catalogo')} />}
    </>
  )

  return (
    <div className="min-h-dvh">
      <AppShell tab={tab} onTab={irATab} headerRef={headerRef} avisos={avisos}
        acciones={{ loading: store.loading, lastSync: store.lastSync, onRefresh: () => void store.refresh(), conectado: !!conn, onConexion: () => setConexionAbierta(true), sheetUrl: store.data?.sheetUrl, isDemo: store.isDemo, campana: plan.campana }}>
        {contenido}
      </AppShell>

      {modal && <GastoModal key={modal.key} store={store} mode={modal.mode} gasto={modal.gasto} draft={modal.draft} preset={modal.preset} onClose={() => setModal(null)} onSubmit={submitGasto} />}
      {/* "Usar" cierra las plantillas y abre el mismo formulario de Nuevo gasto con los datos precargados. */}
      {plantillasOpen && <PlantillasModal key={plantillasOpen.key} store={store} draft={plantillasOpen.draft} ctx={plantillasOpen.ctx}
        onClose={() => { const c = plantillasOpen.ctx; setPlantillasOpen(false); c?.onCerrar() }}
        onRegistrado={r => { plantillasOpen.ctx?.onAplicado(r) }}   // solo avisa al asistente: nunca cierra ni cambia lo que el usuario tenga abierto
        onSegundoPlano={() => { const c = plantillasOpen.ctx; setPlantillasOpen(false); c?.onIniciado?.() }}
        onUse={p => { const c = plantillasOpen.ctx; setPlantillasOpen(false); c?.onCerrar(); openGasto('create', null, undefined, p) }}
        onReopen={draft => { setModal(null); setPlantillasOpen({ draft, key: Date.now() }) }} />}
      {plan.nodo}
      {plantillasApp.nodo}
      {conexionAbierta && <ConexionModal conn={conn} onConnect={setConn} onClose={() => setConexionAbierta(false)} />}
      <Toaster />
    </div>
  )
}
