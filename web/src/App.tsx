import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, FileSpreadsheet, HeartPulse, LayoutDashboard, Receipt, RefreshCw, Settings, Tags, Wallet } from 'lucide-react'
import { loadConnection, type Api, type Connection } from './lib/api'
import { useAppData } from './lib/store'
import { Skeleton } from './components/ui'
import Toaster from './components/Toaster'
import GastoModal, { GASTO_MSG, type GastoDraft, type GastoPreset, type ModalMode } from './components/GastoModal'
import PlantillasModal, { type PlantillaDraft } from './components/PlantillasModal'
import type { GastoInput } from './lib/api'
import type { Gasto } from './lib/types'
import { showToast } from './lib/toast'
import { emptyFilters } from './components/shared'
import { todayIn } from './lib/dates'
import type { Filters } from './lib/types'
import Gastos from './tabs/Gastos'
import Categorias from './tabs/Categorias'
import Configuracion from './tabs/Configuracion'

// Recharts es la dependencia más pesada: el Dashboard se carga aparte para que Gastos abra rápido.
const Dashboard = lazy(() => import('./tabs/Dashboard'))
const Salud = lazy(() => import('./tabs/Salud'))
const CajasTab = lazy(() => import('./tabs/Cajas'))

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'gastos', label: 'Gastos', icon: Receipt },
  { id: 'cajas', label: 'Cajas', icon: Boxes },
  { id: 'categorias', label: 'Categorías', icon: Tags },
  { id: 'salud', label: 'Salud financiera', icon: HeartPulse },
  { id: 'config', label: 'Configuración', icon: Settings },
] as const
type TabId = (typeof TABS)[number]['id']

export default function App({ api }: { api?: Api }) {
  const [conn, setConn] = useState<Connection | null>(() => loadConnection())
  const store = useAppData(conn, api)
  const [tab, setTab] = useState<TabId>(() => (TABS.some(t => `#${t.id}` === location.hash) ? (location.hash.slice(1) as TabId) : 'dashboard'))
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
    const onHash = () => { const h = location.hash.slice(1); if (TABS.some(t => t.id === h)) irATab(h as TabId) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [irATab])
  useEffect(() => { document.documentElement.dataset.theme = store.data?.config.tema === 'oscuro' ? 'dark' : 'light' }, [store.data?.config.tema])
  const notify = (m: string) => { if (store.data?.config.notificaciones !== 'false') showToast('success', m) }

  // Guardar no bloquea: el formulario se cierra al aceptar la operación y el resultado real llega como notificación.
  function submitGasto(input: GastoInput, mode: ModalMode, draft: GastoDraft): boolean {
    return store.track(`gasto:${input.id}`, GASTO_MSG[mode], () => store.actions.saveGasto(input, mode === 'edit' ? 'update' : 'create'), {
      onErrorActions: [{ label: 'Abrir formulario', run: () => openGasto(mode, null, draft) }],
    })
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-card/90 backdrop-blur">
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
            <a href={store.data?.sheetUrl || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!store.data?.sheetUrl || store.isDemo}
              className={`inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink hover:bg-bg ${!store.data?.sheetUrl || store.isDemo ? 'pointer-events-none opacity-50' : ''}`}>
              <FileSpreadsheet className="size-4 text-lima" /> Mi hoja
            </a>
          </div>
        </div>
      </header>

      {store.isDemo && (
        <div className="bg-morado/10 px-4 py-1.5 text-center text-xs text-morado">
          Modo demostración con datos de ejemplo. Conecta tu Apps Script en <button className="font-semibold underline" onClick={() => setTab('config')}>Configuración</button>.
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
        {tab === 'categorias' && <Categorias store={store} />}
        {tab === 'config' && <Configuracion store={store} conn={conn} onConnect={setConn} notify={notify} goCategorias={() => setTab('categorias')} />}
      </main>

      {modal && <GastoModal key={modal.key} store={store} mode={modal.mode} gasto={modal.gasto} draft={modal.draft} preset={modal.preset} onClose={() => setModal(null)} onSubmit={submitGasto} />}
      {/* "Usar" cierra las plantillas y abre el mismo formulario de Nuevo gasto con los datos precargados. */}
      {plantillasOpen && <PlantillasModal key={plantillasOpen.key} store={store} draft={plantillasOpen.draft} onClose={() => setPlantillasOpen(false)}
        onUse={p => { setPlantillasOpen(false); openGasto('create', null, undefined, p) }}
        onReopen={draft => { setModal(null); setPlantillasOpen({ draft, key: Date.now() }) }} />}
      <Toaster />
    </div>
  )
}
