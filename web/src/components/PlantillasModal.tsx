// "Gastos mensuales": plantillas rápidas (ámbito, categoría, subcategoría y descripción) para gastos frecuentes.
// Una plantilla no es un movimiento: no tiene monto ni fecha y no entra en KPIs, cajas ni gráficos.
import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, CalendarDays, Loader2, Pencil, Plus, Save, Trash2, Zap } from 'lucide-react'
import type { AppStore } from '../lib/store'
import type { Plantilla } from '../lib/types'
import { normName } from '../lib/orden'
import { categoriaLook } from '../lib/visual'
import { formatearDescripcion } from '../lib/texto'
import { autocompletar, ClasificacionPicker, clasificacionVigente, type Clasif } from './Clasificacion'
import type { GastoPreset } from './GastoModal'
import { Button, Empty, ErrorBox, Field, inputCls, Modal, Skeleton } from './ui'

export interface PlantillaDraft extends Clasif { id: string; descripcion: string; existente: boolean }
type View = { kind: 'list' } | { kind: 'form'; plantilla: Plantilla | null; draft?: PlantillaDraft } | { kind: 'delete'; plantilla: Plantilla }

const nuevoId = () => `pl-${crypto.randomUUID()}`

export default function PlantillasModal({ store, onClose, onUse, draft, onReopen }: {
  store: AppStore; onClose: () => void; onUse: (p: GastoPreset) => void
  /** Reabrir tras un error al guardar: vuelve al formulario con lo que habías escrito. */
  draft?: PlantillaDraft; onReopen: (d: PlantillaDraft) => void
}) {
  const [view, setView] = useState<View>(() => draft ? { kind: 'form', plantilla: null, draft } : { kind: 'list' })
  const { items, loading, error, loaded } = store.plantillas
  const { loadPlantillas } = store
  const catalogo = store.data?.catalogo ?? []

  // Solo lee la hoja de plantillas, y solo la primera vez: al reabrir se usan las que ya están en memoria.
  useEffect(() => { void loadPlantillas() }, [loadPlantillas])

  const title = view.kind === 'form' ? (view.plantilla ? 'Editar plantilla' : 'Nueva plantilla') : view.kind === 'delete' ? 'Eliminar plantilla' : 'Gastos mensuales'

  return (
    <Modal open onClose={onClose} size="md" title={title} subtitle="Plantillas rápidas para gastos frecuentes" icon={<CalendarDays className="size-5" />}>
      {view.kind === 'form' ? (
        <PlantillaForm store={store} plantilla={view.plantilla} draft={view.draft} items={items} onDone={() => setView({ kind: 'list' })} onReopen={onReopen} />
      ) : view.kind === 'delete' ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-bg/50 p-3">
            <p className="font-semibold">¿Eliminar la plantilla “{view.plantilla.descripcion}”?</p>
            <p className="mt-1 text-sm text-muted">Esta acción eliminará únicamente la plantilla. Los gastos registrados anteriormente no se modificarán.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setView({ kind: 'list' })}>Cancelar</Button>
            <Button variant="danger" onClick={() => {
              const p = view.plantilla
              store.track(`plantilla:${p.id}`, { pending: 'Eliminando plantilla…', ok: 'Plantilla eliminada correctamente.', error: 'No se pudo eliminar la plantilla.' },
                () => store.plantillaActions.remove(p.id))
              setView({ kind: 'list' })
            }}><Trash2 className="size-4" /> Eliminar</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Mis plantillas</p>
            {/* Deshabilitado mientras se leen: así una lectura en curso no pisa una plantilla recién creada. */}
            <Button onClick={() => setView({ kind: 'form', plantilla: null })} disabled={!store.data || !loaded}><Plus className="size-4" /> Nueva plantilla</Button>
          </div>
          {error && !loading && <ErrorBox message={`No se pudieron cargar las plantillas. ${error}`} onRetry={() => void store.loadPlantillas(true)} />}
          {!loaded && !error ? <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16" />)}</div>
            : !items.length && !error ? (
              <Empty icon={<Zap className="size-5" />} title="Aún no tienes plantillas">
                Guarda la clasificación de un gasto frecuente (ChatGPT, Internet, Línea Celular…) y regístralo en segundos con “Usar”.
              </Empty>
            ) : (
              <ul className="space-y-2" aria-label="Plantillas">
                {items.map(p => {
                  const vigente = clasificacionVigente(catalogo, p)
                  const busy = store.pending.has(`plantilla:${p.id}`)
                  const l = categoriaLook(p.categoria, catalogo, p.ambito)
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 sm:flex-nowrap">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: `${l.color}1F`, color: l.color }}><l.Icon className="size-5" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{p.descripcion}</p>
                        <p className="truncate text-xs text-muted">{p.ambito} · {p.categoria} · {p.subcategoria}</p>
                        {!vigente && <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-[#92400E]"><AlertTriangle className="size-3" /> Requiere revisión: su clasificación ya no está disponible</p>}
                      </div>
                      <div className="flex w-full shrink-0 justify-end gap-1.5 sm:w-auto">
                        {busy ? <span className="inline-flex items-center gap-1.5 px-2 text-xs text-muted"><Loader2 className="size-3.5 animate-spin" /> Guardando…</span> : <>
                          <Button className="px-3 py-1.5 text-xs" disabled={!vigente} aria-label={`Usar plantilla ${p.descripcion}`} title={vigente ? 'Abrir Nuevo gasto con estos datos' : 'Edítala y elige una clasificación vigente'}
                            onClick={() => onUse({ ambito: p.ambito, categoria: p.categoria, subcategoria: p.subcategoria, descripcion: p.descripcion })}>Usar</Button>
                          <Button variant="outline" className="px-3 py-1.5 text-xs" onClick={() => setView({ kind: 'form', plantilla: p })} aria-label={`Editar plantilla ${p.descripcion}`}><Pencil className="size-3.5" /> Editar</Button>
                          <Button variant="outline" className="px-3 py-1.5 text-xs text-[#D2463C]" onClick={() => setView({ kind: 'delete', plantilla: p })} aria-label={`Eliminar plantilla ${p.descripcion}`}><Trash2 className="size-3.5" /></Button>
                        </>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          <p className="text-[11px] text-muted">Las plantillas no son gastos: no suman en el dashboard ni en las cajas. “Usar” abre Nuevo gasto con los datos precargados.</p>
        </div>
      )}
    </Modal>
  )
}

function PlantillaForm({ store, plantilla, draft, items, onDone, onReopen }: {
  store: AppStore; plantilla: Plantilla | null; draft?: PlantillaDraft; items: Plantilla[]; onDone: () => void; onReopen: (d: PlantillaDraft) => void
}) {
  const catalogo = store.data?.catalogo ?? []
  const base = draft ?? plantilla
  const existente = draft ? draft.existente : !!plantilla
  const [v, setV] = useState<Clasif>(() => base ? { ambito: base.ambito, categoria: base.categoria, subcategoria: base.subcategoria } : { ambito: 'Personal', categoria: '', subcategoria: '' })
  const [descripcion, setDescripcion] = useState(base?.descripcion ?? '')
  const [descAuto, setDescAuto] = useState<string | null>(base ? null : '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  function change(next: Clasif) {
    if (next.subcategoria && next.subcategoria !== v.subcategoria) {
      const r = autocompletar(descripcion, descAuto, next.subcategoria)
      setDescripcion(r.descripcion)
      setDescAuto(r.auto)
    }
    setV(next)
  }

  function save() {
    const desc = formatearDescripcion(descripcion)
    const errs: Record<string, string> = {}
    if (!v.ambito) errs.ambito = 'Elige un ámbito'
    if (!v.categoria) errs.categoria = 'Elige una categoría'
    if (!v.subcategoria) errs.subcategoria = 'Elige una subcategoría'
    if (!desc) errs.descripcion = 'Escribe una descripción'
    if (!errs.subcategoria && !clasificacionVigente(catalogo, v)) errs.subcategoria = 'Esa clasificación ya no está disponible: elige una vigente'
    const key = (x: Clasif & { descripcion: string }) => [x.ambito, x.categoria, x.subcategoria, x.descripcion].map(normName).join('|')
    const id = draft?.id ?? plantilla?.id ?? nuevoId() // generado una vez: un reintento no duplica la plantilla
    if (!Object.keys(errs).length && items.some(p => p.id !== id && key(p) === key({ ...v, descripcion: desc }))) errs.descripcion = 'Ya existe una plantilla igual'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const data = { id, ambito: v.ambito, categoria: v.categoria, subcategoria: v.subcategoria, descripcion: desc }
    const ok = store.track(`plantilla:${id}`, existente
      ? { pending: 'Actualizando plantilla…', ok: 'Plantilla actualizada correctamente.', error: 'Error al actualizar la plantilla.' }
      : { pending: 'Creando plantilla…', ok: 'Plantilla creada correctamente.', error: 'No se pudo crear la plantilla.' },
    () => store.plantillaActions.save(data, existente ? 'update' : 'create'),
    { onErrorActions: [{ label: 'Abrir formulario', run: () => onReopen({ ...data, existente }) }] })
    if (ok) onDone()
  }

  return (
    <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); save() }}>
      <ClasificacionPicker catalogo={catalogo} value={v} onChange={change} errors={errors} keepCurrent={!!base} />
      <Field label="Descripción" error={errors.descripcion} htmlFor="plantilla-desc" hint="Se completa con la subcategoría; puedes cambiarla.">
        <input id="plantilla-desc" className={inputCls} maxLength={200} value={descripcion} placeholder="Ej. ChatGPT Plus"
          onChange={e => setDescripcion(e.target.value)} onBlur={() => { const f = formatearDescripcion(descripcion); if (descripcion === descAuto) setDescAuto(f); setDescripcion(f) }} />
      </Field>
      <div className="flex justify-between gap-2 border-t border-line pt-3">
        <Button type="button" variant="outline" onClick={onDone}><ArrowLeft className="size-4" /> Volver</Button>
        <Button type="submit"><Save className="size-4" /> {existente ? 'Guardar cambios' : 'Guardar plantilla'}</Button>
      </div>
    </form>
  )
}
