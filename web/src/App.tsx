import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, FileSpreadsheet, HeartPulse, LayoutDashboard, Link2, Receipt, RefreshCw, Settings, Tags, Wallet } from 'lucide-react'
import { loadConnection, type Api, type Connection } from './lib/api'
import { useAppData } from './lib/store'
import { Skeleton } from './components/ui'
import Toaster from './components/Toaster'
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
import Configuracion, { APP_VERSION } from './tabs/Configuracion'

// Recharts es la dependencia más pesada: el Dashboard se carga aparte para que Gastos abra rápido.
const Dashboard = lazy(() => import('./tabs/Dashboard'))
const Salud = lazy(() => import('./tabs/Salud'))
const CajasTab = lazy(() => import('./tabs/Cajas'))

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'gastos', label: 'Gastos', icon: Receipt },
  { id: 'cajas', label: 'Cajas', icon: Boxes },
  { id: 'catalogo', label: 'Catálogo', icon: Tags },
  { id: 'salud', label: 'Salud financiera', icon: HeartPulse },
  { id: 'config', label: 'Configuración', icon: Settings },
] as const
type TabId = (typeof TABS)[number]['id']

const tabDeHash = (h: string): TabId | null => {
  const id = h.replace(/^#/, '') === 'categorias' ? 'catalogo' : h.replace(/^#/, '') // el enlace anterior sigue funcionando
  return TABS.some(t => t.id === id) ? (id as TabId) : null
}

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
  const [plantillasOpen, setPlantillasOpen] = useState<false | { draft?: PlantillaDraft; key: number }>(false)
  const tz = store.data?.config.zona_horaria || 'America/Lima'
  const today = useMemo(() => { try { return todayIn(tz) } catch { return todayIn() } }, [tz])
  // Filtros compartidos entre Dashboard y Gastos: lo que filtras en uno se respeta en el otro.
  const [filters, setFilters] = useState<Filters>(() => emptyFilters(todayIn()))

  useEffect(() => {
    history.replaceState(null, '', `#${tab}`)
    // En el móvil el menú se desplaza de lado: la pestaña activa queda siempre a la vista.
    document.querySelector('nav[aria-label="Secciones"] [aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [tab])
  // Enlaces directos (#salud, #gastos…) y cambios manuales de la dirección: cambia de pestaña sin recargar.
  useEffect(() => {
    const onHash = () => { const t = tabDeHash(location.hash); if (t) irATab(t) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [irATab])
  // Las notificaciones se ubican debajo de la barra superior: nunca tapan el menú (que ahora va centrado).
  const headerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = headerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
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

  return (
    <div className="min-h-dvh">
      <header ref={headerRef} className="sticky top-0 z-10 border-b border-line bg-card/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 xl:grid xl:grid-cols-[1fr_auto_1fr]">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-navy text-white"><Wallet className="size-4" /></span>
            <span className="font-semibold whitespace-nowrap text-ink">Gasto <span className="text-turquesa">Deejota</span></span>
          </div>
          {/* Centrado: en pantallas anchas va al medio de la barra; en las demás ocupa su propia fila, centrada si cabe y desplazable si no. */}
          <nav className="order-last -mx-1 flex w-full overflow-x-auto xl:order-none xl:mx-0 xl:w-auto" aria-label="Secciones">
            <div className="mx-auto flex w-max gap-1 px-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => irATab(id)} aria-current={tab === id ? 'page' : undefined}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap ${tab === id ? 'bg-navy text-white dark:text-[#0E1525]' : 'text-muted hover:bg-bg hover:text-ink'}`}>
                <Icon className="size-4" />{label}
              </button>
            ))}
            </div>
          </nav>
          <div className="ml-auto flex items-center gap-2 xl:justify-self-end">
            <button onClick={() => store.refresh()} disabled={store.loading} aria-label="Actualizar datos" title={store.lastSync ? `Última sincronización ${store.lastSync.toLocaleTimeString('es-PE')}` : 'Actualizar'}
              className="rounded-lg p-2 text-muted hover:bg-bg disabled:opacity-60">
              <RefreshCw className={`size-4 ${store.loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={() => setConexionAbierta(true)} aria-label={conn ? 'Conexión con Google Sheets (conectado)' : 'Conectar con Google Sheets'}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium whitespace-nowrap hover:bg-bg ${conn ? 'border-line text-ink' : 'border-navy/30 bg-primary-soft text-navy'}`}>
              <Link2 className="size-4" /> {conn ? <><span className="size-2 rounded-full bg-lima" aria-hidden /> Conectado</> : 'Conectar'}
            </button>
            <a href={store.data?.sheetUrl || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!store.data?.sheetUrl || store.isDemo}
              className={`inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink hover:bg-bg ${!store.data?.sheetUrl || store.isDemo ? 'pointer-events-none opacity-50' : ''}`}>
              <FileSpreadsheet className="size-4 text-lima" /> Mi hoja
            </a>
          </div>
        </div>
      </header>

      {store.isDemo && (
        <div className="bg-morado/10 px-4 py-1.5 text-center text-xs text-morado">
          Modo demostración con datos de ejemplo. <button className="font-semibold underline" onClick={() => setConexionAbierta(true)}>Conecta tu Apps Script</button> para usar tu hoja.
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-4">
        {tab === 'dashboard' && <Suspense fallback={<Skeleton className="h-96" />}><Dashboard store={store} filters={filters} setFilters={setFilters} today={today} onNuevoGasto={() => openGasto('create', null)} onGastosMensuales={() => setPlantillasOpen({ key: Date.now() })} onIrCajas={() => irATab('cajas')} /></Suspense>}
        {tab === 'cajas' && <Suspense fallback={<Skeleton className="h-96" />}><CajasTab store={store} filters={filters} setFilters={setFilters} today={today} /></Suspense>}
        {tab === 'gastos' && <Gastos store={store} openGasto={openGasto} filters={filters} setFilters={setFilters} today={today} onGastosMensuales={() => setPlantillasOpen({ key: Date.now() })}
          foco={foco} onVolverFoco={foco ? () => irATab(foco.desde) : undefined} />}
        {tab === 'salud' && <Suspense fallback={<Skeleton className="h-96" />}><Salud store={store} filters={filters} setFilters={setFilters} today={today}
          onGastosMensuales={() => setPlantillasOpen({ key: Date.now() })}
          onRevisarGasto={g => { setFoco({ id: g.id, desde: 'salud' }); setTab('gastos'); if (!g.problemaId) openGasto('edit', g) }} /></Suspense>}
        {tab === 'catalogo' && <Catalogo store={store} />}
        {tab === 'config' && <Configuracion store={store} conn={conn} onConnect={setConn} notify={notify} goCatalogo={() => setTab('catalogo')} />}
      </main>

      {modal && <GastoModal key={modal.key} store={store} mode={modal.mode} gasto={modal.gasto} draft={modal.draft} preset={modal.preset} onClose={() => setModal(null)} onSubmit={submitGasto} />}
      {/* "Usar" cierra las plantillas y abre el mismo formulario de Nuevo gasto con los datos precargados. */}
      {plantillasOpen && <PlantillasModal key={plantillasOpen.key} store={store} draft={plantillasOpen.draft} onClose={() => setPlantillasOpen(false)}
        onUse={p => { setPlantillasOpen(false); openGasto('create', null, undefined, p) }}
        onReopen={draft => { setModal(null); setPlantillasOpen({ draft, key: Date.now() }) }} />}
      {conexionAbierta && <ConexionModal conn={conn} onConnect={setConn} onClose={() => setConexionAbierta(false)} />}
      <Toaster />
    </div>
  )
}
