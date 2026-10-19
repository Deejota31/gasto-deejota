// <compat-migración>
import { DatabaseBackup } from 'lucide-react'
import type { AppStore } from '../lib/store'
import { Button } from './ui'

/**
 * Aviso de migración a “Fondos del presupuesto”. Aparece solo cuando el Apps Script ya es v1.26 pero la hoja aún tiene los
 * nombres anteriores. Migrar hace un respaldo completo antes, conserva todas las filas e IDs y es seguro de repetir.
 */
export function MigracionBanner({ store }: { store: AppStore }) {
  const m = store.data?.migracion
  if (!m?.pendiente) return null
  const migrar = () => store.track('migracion:fondos', {
    pending: 'Migrando a Fondos del presupuesto (con respaldo previo)…',
    ok: 'Migración lista: ahora tu hoja usa Fondos del presupuesto. Se hizo un respaldo antes.',
    error: 'No se pudo migrar. Tus datos no se tocaron o puedes repetirla sin riesgo.',
  }, () => store.actions.migrarAFondosPresupuesto(), { retry: false })
  return (
    <div role="alert" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-warning-soft px-4 py-2 text-center text-xs text-warning" data-testid="migracion-fondos">
      <DatabaseBackup className="size-4 shrink-0" />
      <span>“Fuentes de dinero” ahora se llama <b>Fondos del presupuesto</b>. Falta migrar tu hoja (se hace un respaldo antes y no se pierde ningún dato).
        Mientras tanto no podrás editar fondos ni guardar revisiones.</span>
      <Button variant="outline" onClick={migrar} data-testid="migrar-fondos">Migrar ahora</Button>
    </div>
  )
}
// </compat-migración>
