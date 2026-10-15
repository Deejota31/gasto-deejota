import { useMemo, useState } from 'react'
import { Archive, Layers, Pencil, Plus } from 'lucide-react'
import type { AppStore } from '../../lib/store'
import { gruposVigentes, type GrupoFondos } from '../../lib/conciliacion'
import { Button, Checkbox, Empty, Field, inputCls, Modal } from '../ui'

/**
 * Grupos de fondos: conjuntos de FUENTES que se concilian por separado (p. ej. «Dinero general» y «Sodexo»).
 * Una fuente solo puede estar en un grupo, así ningún dinero se cuenta dos veces. Yape y Plin son medios de pago, no cuentas:
 * por eso no hay grupos por medio de pago. Guardar un grupo solo agrega una fila a CONCILIACIONES; no toca las fuentes.
 */
export function GruposFondos({ store, onClose }: { store: AppStore; onClose: () => void }) {
  const data = store.data!
  const grupos = useMemo(() => gruposVigentes(data.conciliaciones), [data.conciliaciones])
  const fuentes = (data.fuentes ?? []).filter(f => f.activo !== false)
  const [edit, setEdit] = useState<{ grupoId: string; nombre: string; sel: string[] } | null>(null)
  const [err, setErr] = useState('')
  const usadas = (excepto: string) => new Map(grupos.filter(g => g.id !== excepto).flatMap(g => g.fuenteIds.map(f => [f, g.nombre] as const)))

  const guardar = () => {
    if (!edit) return
    const nombre = edit.nombre.trim()
    if (!nombre) { setErr('Escribe un nombre para el grupo.'); return }
    if (!edit.sel.length) { setErr('Elige al menos una fuente.'); return }
    if (grupos.some(g => g.id !== edit.grupoId && g.nombre.trim().toLowerCase() === nombre.toLowerCase())) { setErr(`Ya existe un grupo llamado “${nombre}”.`); return }
    setErr('')
    const id = `conc-${crypto.randomUUID()}`
    store.track(`conc:${id}`, { pending: 'Guardando grupo…', ok: `Grupo «${nombre}» guardado.`, error: 'No se pudo guardar el grupo.' },
      () => store.actions.saveGrupoConciliacion({ id, grupoId: edit.grupoId, nombre, fuenteIds: edit.sel, activo: true }))
    setEdit(null)
  }
  const archivar = (g: GrupoFondos) => {
    const id = `conc-${crypto.randomUUID()}`
    store.track(`conc:${id}`, { pending: 'Archivando grupo…', ok: `Grupo «${g.nombre}» archivado. Su historial se conserva.`, error: 'No se pudo archivar el grupo.' },
      () => store.actions.saveGrupoConciliacion({ id, grupoId: g.id, nombre: g.nombre, fuenteIds: g.fuenteIds, activo: false }))
  }
  const nuevo = () => setEdit({ grupoId: `gf-${crypto.randomUUID()}`, nombre: '', sel: [] })
  const nombreFuente = (id: string) => data.fuentes?.find(f => f.id === id)?.nombre ?? id

  return (
    <Modal open onClose={onClose} size="lg" title="Grupos de fondos" subtitle="Agrupa tus fuentes para conciliar por separado (por ejemplo, Dinero general y Sodexo)." icon={<Layers className="size-5" />}
      footer={edit ? <><Button variant="outline" onClick={() => { setEdit(null); setErr('') }}>Cancelar</Button><Button onClick={guardar} data-testid="grupo-guardar">Guardar grupo</Button></>
        : <><Button variant="outline" onClick={onClose}>Cerrar</Button><Button onClick={nuevo} disabled={!fuentes.length} data-testid="grupo-nuevo"><Plus className="size-4" /> Nuevo grupo</Button></>}>
      <div className="space-y-3" data-testid="conc-grupos">
        {!edit && (
          <>
            {!grupos.length && <Empty icon={<Layers className="size-5" />} title="Sin grupos: se concilia el total">Mientras no definas grupos, la conciliación compara un único saldo. Crea un grupo por cada cuenta o fondo independiente que quieras verificar.</Empty>}
            <ul className="space-y-2">
              {grupos.map(g => (
                <li key={g.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-line p-3" data-testid="grupo-fila">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{g.nombre}</p><p className="truncate text-[11px] text-muted">{g.fuenteIds.map(nombreFuente).join(' · ') || 'Sin fuentes'}</p></div>
                  <Button variant="outline" className="h-8 text-xs" onClick={() => setEdit({ grupoId: g.id, nombre: g.nombre, sel: g.fuenteIds })}><Pencil className="size-3.5" /> Editar</Button>
                  <Button variant="ghost" className="h-8 text-xs" onClick={() => archivar(g)}><Archive className="size-3.5" /> Archivar</Button>
                </li>
              ))}
            </ul>
            {!fuentes.length && <p className="rounded-xl bg-bg px-3 py-2 text-xs text-muted">Primero crea tus fuentes de dinero en Cajas: los grupos se arman con ellas.</p>}
            <p className="text-[11px] text-muted">Yape y Plin son medios de pago, no cuentas: pueden salir de la misma cuenta que tu dinero general, por eso no se concilian por separado.</p>
          </>
        )}
        {edit && (
          <div className="space-y-3">
            <Field label="Nombre del grupo" htmlFor="grupo-nombre">
              <input id="grupo-nombre" className={inputCls} maxLength={40} value={edit.nombre} onChange={e => setEdit({ ...edit, nombre: e.target.value })} placeholder="Dinero general, Sodexo, Efectivo…" />
            </Field>
            <fieldset className="space-y-1.5"><legend className="mb-1 text-sm font-medium text-ink">Fuentes del grupo</legend>
              {fuentes.map(f => {
                const otro = usadas(edit.grupoId).get(f.id)
                return (
                  <label key={f.id} className={`flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm ${otro ? 'opacity-60' : ''}`}>
                    <Checkbox checked={edit.sel.includes(f.id)} disabled={!!otro} label={`Fuente ${f.nombre}`}
                      onChange={on => setEdit({ ...edit, sel: on ? [...edit.sel, f.id] : edit.sel.filter(x => x !== f.id) })} />
                    <span className="min-w-0 flex-1 truncate">{f.nombre}</span>
                    {otro && <span className="text-[11px] text-muted">ya está en «{otro}»</span>}
                  </label>
                )
              })}
            </fieldset>
            {err && <p role="alert" className="text-xs text-danger">{err}</p>}
          </div>
        )}
      </div>
    </Modal>
  )
}
