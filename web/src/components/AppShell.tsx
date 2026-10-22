import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Ellipsis, FileSpreadsheet, Link2, Menu, PanelLeftClose, PanelLeftOpen, RefreshCw, Wallet, X } from 'lucide-react'
import { guardarSidebarContraido, leerSidebarContraido, TABS, type TabId } from '../lib/navegacion'

/**
 * Estructura de la aplicación: Sidebar (escritorio ≥1024 px, contraído por defecto) · Topbar compacta · Contenido.
 *  - 640–1023 px: el sidebar es un panel temporal (botón ☰ en la topbar) con fondo oscurecido.
 *  - < 640 px: barra inferior Dashboard · Gastos · Presupuestos · Más (Catálogo, Salud financiera, Configuración).
 * Jerarquía de capas: contenido < topbar (20) < sidebar fijo y barra inferior (30) < fondo del panel (40) < panel y hoja "Más" (50)
 * < avisos (60) < desplegables (300). Los modales usan <dialog> (capa superior del navegador) y siempre quedan por encima.
 * Todos los accesos comparten el mismo estado de módulo activo (`tab`).
 */
function useMedia(query: string): boolean {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const f = () => setM(mq.matches)
    f()
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [query])
  return m
}

export interface AccionesGlobales {
  /** Campana de planificación mensual (v1.19): va antes de Actualizar. */
  campana?: ReactNode
  loading: boolean
  /** Escrituras que ya se ven en pantalla pero Sheets aún no confirmó (cola en segundo plano). */
  pendientes?: number
  lastSync: Date | null
  onRefresh: () => void
  conectado: boolean
  onConexion: () => void
  sheetUrl?: string
  isDemo: boolean
}

export default function AppShell({ tab, onTab, acciones, headerRef, children, avisos }: {
  tab: TabId; onTab: (t: TabId) => void; acciones: AccionesGlobales; headerRef: React.RefObject<HTMLElement | null>; children: ReactNode; avisos?: ReactNode
}) {
  const escritorio = useMedia('(min-width: 1024px)')
  const movil = !useMedia('(min-width: 640px)')
  const [contraido, setContraido] = useState(leerSidebarContraido)
  const [panel, setPanel] = useState(false)        // panel temporal (tablet)
  const [mas, setMas] = useState(false)            // hoja "Más" (celular)
  const [tecladoAbierto, setTecladoAbierto] = useState(false)
  const botonMenu = useRef<HTMLButtonElement>(null)
  const botonMas = useRef<HTMLButtonElement>(null)
  const actual = TABS.find(t => t.id === tab)!

  const alternar = () => setContraido(c => { guardarSidebarContraido(!c); return !c })
  const navegar = useCallback((t: TabId) => { setPanel(false); setMas(false); onTab(t) }, [onTab])

  // Al cambiar de modo (girar, redimensionar) se cierran los paneles temporales.
  useEffect(() => { if (escritorio || movil) setPanel(false); if (!movil) setMas(false) }, [escritorio, movil])

  // Con el teclado virtual abierto (campo de texto enfocado en el celular) la barra inferior se oculta para no tapar nada.
  useEffect(() => {
    if (!movil) { setTecladoAbierto(false); return }
    const campo = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !['checkbox', 'radio', 'button', 'submit'].includes((t as HTMLInputElement).type)
    const dentro = (e: FocusEvent) => { if (campo(e.target)) setTecladoAbierto(true) }
    const fuera = (e: FocusEvent) => { if (campo(e.target)) setTecladoAbierto(false) }
    document.addEventListener('focusin', dentro)
    document.addEventListener('focusout', fuera)
    return () => { document.removeEventListener('focusin', dentro); document.removeEventListener('focusout', fuera) }
  }, [movil])

  // Panel/hoja modal: el resto de la página no recibe interacción mientras está abierto.
  const modalAbierto = panel || mas
  useEffect(() => {
    const main = document.getElementById('app-main')
    if (!main) return
    if (modalAbierto) main.setAttribute('inert', ''); else main.removeAttribute('inert')
    return () => main.removeAttribute('inert')
  }, [modalAbierto])

  const lateral = escritorio ? (
    <Sidebar tab={tab} onTab={navegar} contraido={contraido} onAlternar={alternar} />
  ) : null

  return (
    <div className="min-h-dvh">
      {lateral}
      <div className={`min-h-dvh transition-[padding] duration-200 motion-reduce:transition-none ${escritorio ? (contraido ? 'pl-[72px]' : 'pl-[232px]') : ''}`}>
        <Topbar headerRef={headerRef} actual={actual} acciones={acciones} movil={movil} conMenu={!escritorio && !movil}
          botonMenu={botonMenu} onMenu={() => setPanel(true)} menuAbierto={panel} />
        {avisos}
        <main id="app-main" className={`w-full px-4 py-4 lg:px-6 ${movil ? 'pb-[calc(5rem+env(safe-area-inset-bottom))]' : ''}`}>{children}</main>
      </div>

      {panel && !escritorio && !movil && <PanelTemporal tab={tab} onTab={navegar} onCerrar={() => { setPanel(false); botonMenu.current?.focus() }} />}
      {movil && !tecladoAbierto && <BarraInferior tab={tab} onTab={navegar} masAbierto={mas} onMas={() => setMas(v => !v)} botonMas={botonMas} />}
      {movil && mas && <HojaMas tab={tab} onTab={navegar} onCerrar={() => { setMas(false); botonMas.current?.focus() }} />}
    </div>
  )
}

/* ============================== Sidebar ============================== */

function Logo({ compacto }: { compacto?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-navy text-white dark:text-[#0E1525]"><Wallet className="size-[18px]" /></span>
      {!compacto && <span className="font-semibold whitespace-nowrap text-ink">Gasto <span className="text-turquesa">Deejota</span></span>}
    </span>
  )
}

/** Tooltip accesible del sidebar contraído: aparece con cursor o foco de teclado, fuera del contenedor (no se corta). */
function ItemSidebar({ id, label, icon: Icon, activo, contraido, onClick }: { id: string; label: string; icon: React.ComponentType<{ className?: string }>; activo: boolean; contraido: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null)
  const mostrar = () => { if (!contraido || !ref.current) return; const r = ref.current.getBoundingClientRect(); setTip({ top: r.top + r.height / 2, left: r.right + 10 }) }
  useEffect(() => { if (!contraido) setTip(null) }, [contraido])
  return (
    <li>
      <button ref={ref} type="button" data-nav={id} onClick={onClick} aria-current={activo ? 'page' : undefined} aria-label={contraido ? label : undefined}
        onMouseEnter={mostrar} onMouseLeave={() => setTip(null)} onFocus={e => { if (e.currentTarget.matches(':focus-visible')) mostrar() }} onBlur={() => setTip(null)}
        className={`flex h-11 w-full items-center rounded-xl text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-navy/60 ${contraido ? 'justify-center' : 'gap-3 px-3'} ${activo ? 'bg-navy text-white shadow-sm dark:text-[#0E1525]' : 'text-muted hover:bg-bg hover:text-ink'}`}>
        <Icon className="size-5 shrink-0" />
        {!contraido && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      </button>
      {tip && createPortal(
        <span role="tooltip" style={{ top: tip.top, left: tip.left }} className="pointer-events-none fixed z-[70] -translate-y-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-card shadow-lg">{label}</span>, document.body)}
    </li>
  )
}

function Sidebar({ tab, onTab, contraido, onAlternar }: { tab: TabId; onTab: (t: TabId) => void; contraido: boolean; onAlternar: () => void }) {
  return (
    <aside aria-label="Barra lateral" data-contraido={contraido}
      className={`fixed inset-y-0 left-0 z-30 flex flex-col border-r border-line bg-card transition-[width] duration-200 motion-reduce:transition-none ${contraido ? 'w-[72px]' : 'w-[232px]'}`}>
      <div className={`flex shrink-0 border-b border-line ${contraido ? 'flex-col items-center gap-1.5 px-2 py-3' : 'h-14 items-center justify-between gap-2 px-3'}`}>
        <Logo compacto={contraido} />
        <button type="button" onClick={onAlternar} aria-expanded={!contraido} aria-label={contraido ? 'Expandir barra lateral' : 'Contraer barra lateral'} title={contraido ? 'Expandir' : 'Contraer'}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-bg hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-navy/60">
          {contraido ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
        </button>
      </div>
      <nav aria-label="Secciones" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-2.5">
        <ul className="space-y-1">
          {TABS.map(t => <ItemSidebar key={t.id} id={t.id} label={t.label} icon={t.icon} activo={tab === t.id} contraido={contraido} onClick={() => onTab(t.id)} />)}
        </ul>
      </nav>
    </aside>
  )
}

/* ============================== Tablet: panel temporal ============================== */

function PanelTemporal({ tab, onTab, onCerrar }: { tab: TabId; onTab: (t: TabId) => void; onCerrar: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { panel.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus() }, [])
  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCerrar(); return }
    if (e.key !== 'Tab') return
    const xs = [...panel.current!.querySelectorAll<HTMLElement>('button')]
    const i = xs.indexOf(document.activeElement as HTMLElement)
    if (e.shiftKey && i <= 0) { e.preventDefault(); xs.at(-1)?.focus() } else if (!e.shiftKey && i === xs.length - 1) { e.preventDefault(); xs[0]?.focus() }
  }
  return (
    <div className="fixed inset-0 z-40" onKeyDown={teclas}>
      <div className="fade-in absolute inset-0 bg-black/45" onClick={onCerrar} aria-hidden />
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Navegación" className="absolute inset-y-0 left-0 z-50 flex w-[260px] max-w-[85vw] flex-col border-r border-line bg-card shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-3">
          <Logo />
          <button type="button" onClick={onCerrar} aria-label="Cerrar navegación" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-bg hover:text-ink"><X className="size-[18px]" /></button>
        </div>
        <nav aria-label="Secciones" className="min-h-0 flex-1 overflow-y-auto p-2.5">
          <ul className="space-y-1">{TABS.map(t => <ItemSidebar key={t.id} id={t.id} label={t.label} icon={t.icon} activo={tab === t.id} contraido={false} onClick={() => onTab(t.id)} />)}</ul>
        </nav>
      </div>
    </div>
  )
}

/* ============================== Celular: barra inferior + Más ============================== */

function BarraInferior({ tab, onTab, masAbierto, onMas, botonMas }: { tab: TabId; onTab: (t: TabId) => void; masAbierto: boolean; onMas: () => void; botonMas: React.RefObject<HTMLButtonElement | null> }) {
  const principales = TABS.filter(t => t.movil)
  const enMas = !TABS.find(t => t.id === tab)?.movil
  const item = (activo: boolean) => `flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-navy/60 ${activo ? 'text-navy' : 'text-muted'}`
  const pastilla = (activo: boolean) => `grid h-7 w-12 place-items-center rounded-full transition-colors ${activo ? 'bg-navy text-white dark:text-[#0E1525]' : ''}`
  return (
    <nav aria-label="Secciones" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" data-testid="barra-inferior">
      <ul className="mx-auto flex max-w-lg items-stretch gap-1 px-2 py-1">
        {principales.map(t => (
          <li key={t.id} className="flex min-w-0 flex-1">
            <button type="button" data-nav={t.id} onClick={() => onTab(t.id)} aria-current={tab === t.id ? 'page' : undefined} className={item(tab === t.id)}>
              <span className={pastilla(tab === t.id)}><t.icon className="size-5" /></span><span className="truncate">{t.label}</span>
            </button>
          </li>
        ))}
        <li className="flex min-w-0 flex-1">
          <button ref={botonMas} type="button" data-nav="mas" onClick={onMas} aria-haspopup="dialog" aria-expanded={masAbierto} aria-current={enMas ? 'page' : undefined} className={item(enMas || masAbierto)}>
            <span className={pastilla(enMas)}><Ellipsis className="size-5" /></span><span>Más</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}

function HojaMas({ tab, onTab, onCerrar }: { tab: TabId; onTab: (t: TabId) => void; onCerrar: () => void }) {
  const hoja = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { (hoja.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? hoja.current?.querySelector<HTMLElement>('button'))?.focus() }, [])
  const extras = TABS.filter(t => !t.movil)
  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCerrar(); return }
    if (e.key !== 'Tab') return
    const xs = [...hoja.current!.querySelectorAll<HTMLElement>('button')]
    const i = xs.indexOf(document.activeElement as HTMLElement)
    if (e.shiftKey && i <= 0) { e.preventDefault(); xs.at(-1)?.focus() } else if (!e.shiftKey && i === xs.length - 1) { e.preventDefault(); xs[0]?.focus() }
  }
  return (
    <div className="fixed inset-0 z-40" onKeyDown={teclas}>
      <div className="fade-in absolute inset-0 bg-black/45" onClick={onCerrar} aria-hidden />
      <div ref={hoja} role="dialog" aria-modal="true" aria-label="Más opciones"
        className="absolute inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-line bg-card px-3 pt-2 pb-[calc(5.25rem+env(safe-area-inset-bottom))] shadow-2xl">
        <span className="mx-auto mb-2 block h-1 w-10 rounded-full bg-line" aria-hidden />
        <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Más opciones</p>
        <ul className="space-y-1">
          {extras.map(t => (
            <li key={t.id}>
              <button type="button" onClick={() => onTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
                className={`flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-navy/60 ${tab === t.id ? 'bg-navy text-white dark:text-[#0E1525]' : 'text-ink hover:bg-bg'}`}>
                <t.icon className="size-5 shrink-0" /><span className="min-w-0 flex-1 truncate">{t.label}</span>
                {(t.subtitulo as string) !== (t.label as string) && <span className={`hidden truncate text-[11px] font-normal min-[400px]:block ${tab === t.id ? 'opacity-80' : 'text-muted'}`}>{t.subtitulo}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ============================== Topbar ============================== */

function Topbar({ headerRef, actual, acciones, movil, conMenu, botonMenu, onMenu, menuAbierto }: {
  headerRef: React.RefObject<HTMLElement | null>; actual: (typeof TABS)[number]; acciones: AccionesGlobales; movil: boolean; conMenu: boolean
  botonMenu: React.RefObject<HTMLButtonElement | null>; onMenu: () => void; menuAbierto: boolean
}) {
  const { loading, lastSync, onRefresh, conectado, onConexion, sheetUrl, isDemo, campana, pendientes = 0 } = acciones
  const Icon = actual.icon
  const btn = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium whitespace-nowrap outline-none transition hover:bg-bg focus-visible:ring-2 focus-visible:ring-navy/60'
  const sinHoja = !sheetUrl || isDemo
  return (
    <header ref={headerRef} className="sticky top-0 z-20 border-b border-line bg-card/90 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="flex h-12 items-center gap-2 px-3 lg:px-6">
        {conMenu && (
          <button ref={botonMenu} type="button" onClick={onMenu} aria-label="Abrir navegación" aria-haspopup="dialog" aria-expanded={menuAbierto}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted outline-none hover:bg-bg hover:text-ink focus-visible:ring-2 focus-visible:ring-navy/60"><Menu className="size-5" /></button>
        )}
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-navy" aria-hidden><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-ink" data-testid="topbar-titulo">{actual.label}</p>
          {(actual.subtitulo as string) !== (actual.label as string) && <p className="hidden truncate text-[11px] text-muted sm:block">{actual.subtitulo}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {campana}
          {pendientes > 0 && (
            <span role="status" aria-live="polite" data-testid="cambios-pendientes" title="Se guardan en segundo plano; no cierres la pestaña todavía."
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-warning-soft px-2.5 text-xs font-semibold whitespace-nowrap text-warning">
              <RefreshCw className="size-3.5 animate-spin" aria-hidden />{pendientes}<span className="max-sm:sr-only">{' '}cambio{pendientes === 1 ? '' : 's'} pendiente{pendientes === 1 ? '' : 's'}</span>
            </span>
          )}
          <button type="button" onClick={onRefresh} disabled={loading} aria-label="Actualizar datos" title={lastSync ? `Última sincronización ${lastSync.toLocaleTimeString('es-PE')}` : 'Actualizar'}
            className={`${btn} w-9 border-transparent text-muted disabled:opacity-60`}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={onConexion} aria-label={conectado ? 'Conexión con Google Sheets (conectado)' : 'Conectar con Google Sheets'}
            className={`${btn} ${movil ? 'w-9' : 'px-3'} ${conectado ? 'border-line text-ink' : 'border-navy/30 bg-primary-soft text-navy'}`}>
            {conectado ? <><span className={`size-2 rounded-full bg-lima ${movil ? 'order-last' : ''}`} aria-hidden />{movil ? <Link2 className="size-4" /> : <><Link2 className="size-4" /> Conectado</>}</> : movil ? <Link2 className="size-4" /> : <><Link2 className="size-4" /> Conectar</>}
          </button>
          <a href={sheetUrl || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={sinHoja} aria-label="Mi hoja"
            className={`${btn} border-line text-ink ${movil ? 'w-9' : 'px-3'} ${sinHoja ? 'pointer-events-none opacity-50' : ''}`}>
            <FileSpreadsheet className="size-4 text-lima" />{!movil && ' Mi hoja'}
          </a>
        </div>
      </div>
    </header>
  )
}
