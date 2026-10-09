import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet, LayoutDashboard, Receipt, RefreshCw, Settings, Tags, Wallet } from 'lucide-react'
import { loadConnection, type Api, type Connection } from './lib/api'
import { useAppData } from './lib/store'
import { Skeleton } from './components/ui'
import { emptyFilters } from './components/shared'
import { todayIn } from './lib/dates'
import type { Filters } from './lib/types'
import Gastos from './tabs/Gastos'
import Categorias from './tabs/Categorias'
import Configuracion from './tabs/Configuracion'

// Recharts es la dependencia más pesada: el Dashboard se carga aparte para que Gastos abra rápido.
const Dashboard = lazy(() => import('./tabs/Dashboard'))

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'gastos', label: 'Gastos', icon: Receipt },
  { id: 'categorias', label: 'Categorías', icon: Tags },
  { id: 'config', label: 'Configuración', icon: Settings },
] as const
type TabId = (typeof TABS)[number]['id']

export default function App({ api }: { api?: Api }) {
  const [conn, setConn] = useState<Connection | null>(() => loadConnection())
  const store = useAppData(conn, api)
  const [tab, setTab] = useState<TabId>(() => (TABS.some(t => `#${t.id}` === location.hash) ? (location.hash.slice(1) as TabId) : 'dashboard'))
  const [toast, setToast] = useState('')
  const tz = store.data?.config.zona_horaria || 'America/Lima'
  const today = useMemo(() => { try { return todayIn(tz) } catch { return todayIn() } }, [tz])
  // Filtros compartidos entre Dashboard y Gastos: lo que filtras en uno se respeta en el otro.
  const [filters, setFilters] = useState<Filters>(() => emptyFilters(todayIn()))

  useEffect(() => { history.replaceState(null, '', `#${tab}`) }, [tab])
  useEffect(() => { document.documentElement.dataset.theme = store.data?.config.tema === 'oscuro' ? 'dark' : 'light' }, [store.data?.config.tema])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(t)
  }, [toast])
  const notify = (m: string) => { if (store.data?.config.notificaciones !== 'false') setToast(m) }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-navy text-white"><Wallet className="size-4" /></span>
            <span className="font-semibold whitespace-nowrap text-ink">Gasto <span className="text-turquesa">Deejota</span></span>
          </div>
          <nav className="order-last -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto" aria-label="Secciones">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap ${tab === id ? 'bg-navy text-white dark:text-[#0E1525]' : 'text-muted hover:bg-bg hover:text-ink'}`}>
                <Icon className="size-4" />{label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
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
        {tab === 'dashboard' && <Suspense fallback={<Skeleton className="h-96" />}><Dashboard store={store} filters={filters} setFilters={setFilters} today={today} /></Suspense>}
        {tab === 'gastos' && <Gastos store={store} notify={notify} filters={filters} setFilters={setFilters} today={today} />}
        {tab === 'categorias' && <Categorias store={store} notify={notify} />}
        {tab === 'config' && <Configuracion store={store} conn={conn} onConnect={setConn} notify={notify} goCategorias={() => setTab('categorias')} />}
      </main>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 flex justify-center">
        {toast && <div className="rounded-xl bg-navy px-4 py-2 text-sm text-white shadow-lg">{toast}</div>}
      </div>
    </div>
  )
}
