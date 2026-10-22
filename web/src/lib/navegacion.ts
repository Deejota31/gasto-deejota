import { HeartPulse, PiggyBank, LayoutDashboard, Receipt, Settings, Tags, type LucideIcon } from 'lucide-react'

/**
 * Definición ÚNICA de los módulos de navegación. Sidebar de escritorio, panel de tablet, barra inferior del celular y menú
 * "Más" leen esta lista, así que nunca hay dos listas que se desincronicen. `movil` marca los que van en la barra inferior;
 * el resto vive en "Más".
 */
export const TABS = [
  { id: 'dashboard', label: 'Dashboard', subtitulo: 'Resumen financiero', icon: LayoutDashboard, movil: true },
  { id: 'gastos', label: 'Gastos', subtitulo: 'Movimientos', icon: Receipt, movil: true },
  { id: 'presupuestos', label: 'Presupuestos', subtitulo: 'Fondos del presupuesto', icon: PiggyBank, movil: true },
  { id: 'catalogo', label: 'Catálogo', subtitulo: 'Administración del catálogo', icon: Tags, movil: false },
  { id: 'salud', label: 'Salud financiera', subtitulo: 'Salud financiera', icon: HeartPulse, movil: false },
  { id: 'config', label: 'Configuración', subtitulo: 'Configuración', icon: Settings, movil: false },
] as const satisfies readonly { id: string; label: string; subtitulo: string; icon: LucideIcon; movil: boolean }[]

export type TabId = (typeof TABS)[number]['id']

/**
 * Enlaces anteriores que siguen funcionando: #categorias → Catálogo y, desde v1.28, #cajas → Presupuestos (la pantalla de cajas
 * ya no existe; solo se redirige el enlace guardado).
 */
const ALIAS: Record<string, TabId> = { categorias: 'catalogo', cajas: 'presupuestos' }
export const tabDeHash = (h: string): TabId | null => {
  const raw = h.replace(/^#\/?/, '')
  const id = ALIAS[raw] ?? raw
  return TABS.some(t => t.id === id) ? (id as TabId) : null
}

/** Preferencia del sidebar (solo visual, solo este navegador). Sin valor guardado inicia contraído. */
export const CLAVE_SIDEBAR = 'deejota.sidebar.collapsed'
export function leerSidebarContraido(): boolean {
  try { return localStorage.getItem(CLAVE_SIDEBAR) !== '0' } catch { return true }
}
export function guardarSidebarContraido(v: boolean): void {
  try { localStorage.setItem(CLAVE_SIDEBAR, v ? '1' : '0') } catch { /* almacenamiento bloqueado: vale solo para esta sesión */ }
}
