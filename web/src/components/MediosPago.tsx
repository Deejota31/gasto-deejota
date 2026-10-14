import { useState } from 'react'
import { Loader2, Pencil, Wallet } from 'lucide-react'
import type { AppStore } from '../lib/store'
import type { Medio } from '../lib/types'
import { claveDeIcono, medioLook, medioLookBase, sortMedios } from '../lib/visual'
import { ColorPicker, useApariencia } from './Apariencia'
import { IconPicker } from './IconPicker'
import { Button, Field, inputCls, Modal, Switch } from './ui'

export type MedioEdicion = 'nuevo' | Medio | null

/** Medios de pago: se ven, se agregan y se personalizan (icono y color) aquí, en la pestaña Catálogo. */
export function MediosPago({ store, editando, setEditando }: { store: AppStore; editando: MedioEdicion; setEditando: (m: MedioEdicion) => void }) {
  const raw = store.data?.medios ?? []
  const medios = sortMedios(raw.map(m => m.nombre)).map(n => raw.find(m => m.nombre === n)!).filter(m => m && m.nombre.trim())
  const toggle = (m: Medio) => store.track(`medio:${m.nombre.toLowerCase()}`,
    { pending: 'Guardando medio de pago…', ok: 'Medio de pago guardado correctamente.', error: 'No se pudo guardar el medio de pago.' },
    () => store.actions.saveMedio({ nombre: m.nombre, activo: !m.activo }))
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Medios de pago">
        {medios.map(m => {
          const { Icon, color } = medioLook(m.nombre)
          const busy = store.pending.has(`medio:${m.nombre.toLowerCase()}`)
          return (
            <li key={m.nombre} className={`flex items-center gap-1.5 rounded-xl border pr-1.5 transition ${m.activo ? 'border-line bg-card hover:bg-bg' : 'border-dashed border-line bg-bg/50 text-muted'}`}>
              <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-sm">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: m.activo ? `${color}1F` : undefined, color: m.activo ? color : undefined }}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
                </span>
                <span className={`min-w-0 flex-1 truncate font-medium ${m.activo ? '' : 'line-through'}`} title={m.nombre}>{m.nombre}</span>
              </div>
              <Switch compact checked={m.activo} disabled={busy} label={`Medio de pago ${m.nombre} activo`}
                title={m.activo ? 'Activo: toca para desactivar (deja de ofrecerse; el historial se conserva)' : 'Inactivo: toca para reactivar'} onChange={() => toggle(m)} />
              <button type="button" aria-label={`Personalizar ${m.nombre}`} title="Cambiar icono y color" onClick={() => setEditando(m)}
                className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-bg hover:text-navy"><Pencil className="size-3.5" /></button>
            </li>
          )
        })}
      </ul>
      <p className="text-[11px] text-muted">Usa el interruptor para activar o desactivar un medio; el lápiz cambia su icono y color. “Otros” siempre va al final.</p>
      {editando && <MedioForm key={editando === 'nuevo' ? 'nuevo' : editando.nombre} store={store} medio={editando === 'nuevo' ? null : editando} existentes={raw} onClose={() => setEditando(null)} />}
    </div>
  )
}

function MedioForm({ store, medio, existentes, onClose }: { store: AppStore; medio: Medio | null; existentes: Medio[]; onClose: () => void }) {
  const [nombre, setNombre] = useState(medio?.nombre ?? '')
  const [error, setError] = useState('')
  const auto = medioLookBase(nombre || 'Otros')
  const inicial = medio ? medioLook(medio.nombre) : auto
  const ap = useApariencia(medio?.icono ? { icono: medio.icono, color: medio.color || inicial.color } : medio ? { icono: claveDeIcono(inicial.Icon), color: inicial.color } : { icono: '', color: auto.color }, auto)
  const { Icon, color } = ap.look
  function save() {
    const n = nombre.trim()
    if (!n) return setError('Escribe un nombre')
    if (n.toLowerCase() === 'libre') return setError('“Libre” está reservado para las fuentes sin medio de pago')
    if (!medio && existentes.some(x => x.nombre.trim().toLowerCase() === n.toLowerCase())) return setError('Ya existe un medio con ese nombre')
    setError('')
    const ok = store.track(`medio:${n.toLowerCase()}`,
      { pending: 'Guardando medio de pago…', ok: `${n} guardado correctamente.`, error: 'No se pudo guardar el medio de pago.' },
      () => store.actions.saveMedio({ nombre: n, activo: medio?.activo ?? true, icono: ap.icono || claveDeIcono(auto.Icon), color }))
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} size="md" title={medio ? `Personalizar ${medio.nombre}` : 'Nuevo medio de pago'} icon={<Wallet className="size-5" />}
      subtitle="Su icono y color se ven igual en gastos, filtros, fuentes y cajas, y se guardan en tu hoja."
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save}>{medio ? 'Guardar cambios' : 'Crear medio de pago'}</Button></>}>
      <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); save() }}>
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: `${color}14`, boxShadow: `inset 0 0 0 1px ${color}33` }} data-testid="medio-vista-previa">
          <span className="grid size-11 place-items-center rounded-2xl bg-card" style={{ color }}><Icon className="size-5" /></span>
          <p className="truncate text-sm font-semibold">{nombre.trim() || 'Nuevo medio de pago'}</p>
        </div>
        <Field label="Nombre" error={error} htmlFor="medio-nombre">
          <input id="medio-nombre" aria-label="Nombre del medio de pago" className={inputCls} maxLength={40} autoFocus={!medio} readOnly={!!medio} value={nombre}
            onChange={e => setNombre(e.target.value)} placeholder="Ej. Tarjeta BCP, Lemon, Bim" />
        </Field>
        <div className="space-y-3" data-testid="apariencia">
          <p className="text-xs font-medium text-muted">Icono y color</p>
          <IconPicker value={ap.icono || claveDeIcono(ap.look.Icon)} onChange={k => ap.elegir({ icono: k })} color={color} nombre={nombre} contexto={['dinero', 'pago', nombre]} />
          <ColorPicker value={color} onChange={c => ap.elegir({ color: c })} />
        </div>
      </form>
    </Modal>
  )
}
