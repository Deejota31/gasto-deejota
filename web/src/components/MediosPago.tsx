import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import type { AppStore } from '../lib/store'
import { medioLook, sortMedios } from '../lib/visual'
import { Button, inputCls } from './ui'

/** Medios de pago: se ven y se agregan aquí (pestaña Catálogo), junto a ámbitos, categorías y subcategorías. */
export function MediosPago({ store }: { store: AppStore }) {
  const [nuevo, setNuevo] = useState('')
  const raw = store.data?.medios ?? []
  const medios = sortMedios(raw.map(m => m.nombre)).map(n => raw.find(m => m.nombre === n)!).filter(m => m && m.nombre.trim())
  const save = (nombre: string, activo: boolean) => store.track(`medio:${nombre.toLowerCase()}`,
    { pending: 'Guardando medio de pago…', ok: 'Medio de pago guardado correctamente.', error: 'No se pudo guardar el medio de pago.' },
    () => store.actions.saveMedio({ nombre, activo }))
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Medios de pago">
        {medios.map(m => {
          const { Icon, color } = medioLook(m.nombre)
          const busy = store.pending.has(`medio:${m.nombre.toLowerCase()}`)
          return (
            <li key={m.nombre}>
              <button type="button" onClick={() => save(m.nombre, !m.activo)} disabled={busy} aria-pressed={m.activo}
                title={m.activo ? 'Activo: toca para desactivar' : 'Inactivo: toca para reactivar'}
                className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-sm transition ${m.activo ? 'border-line bg-card hover:bg-bg' : 'border-dashed border-line bg-bg/50 text-muted'}`}>
                <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: m.activo ? `${color}1F` : undefined, color: m.activo ? color : undefined }}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
                </span>
                <span className={`min-w-0 flex-1 truncate font-medium ${m.activo ? '' : 'line-through'}`}>{m.nombre}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (nuevo.trim()) { void save(nuevo.trim(), true); setNuevo('') } }}>
        <input id="medio-nuevo" aria-label="Nuevo medio de pago" className={inputCls} maxLength={40} value={nuevo} onChange={e => setNuevo(e.target.value)} placeholder="Nuevo medio de pago" />
        <Button type="submit" variant="soft" disabled={!nuevo.trim()}><Plus className="size-4" /> Agregar</Button>
      </form>
      <p className="text-[11px] text-muted">Toca un medio para activarlo o desactivarlo. “Otros” siempre va al final.</p>
    </div>
  )
}
