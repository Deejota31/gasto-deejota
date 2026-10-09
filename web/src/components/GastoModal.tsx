import { useState } from 'react'
import { z } from 'zod'
import type { GastoInput } from '../lib/api'
import type { AppStore } from '../lib/store'
import { TIPOS_GASTO, type Gasto } from '../lib/types'
import { todayIn } from '../lib/dates'
import { catalogOptions } from './shared'
import { Button, ErrorBox, Field, inputCls, Modal, Select } from './ui'

const schema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  monto: z.number({ error: 'Ingresa un monto' }).positive('Debe ser mayor a 0').max(1e9, 'Monto demasiado alto'),
  moneda: z.string().regex(/^[A-Z]{3}$/, 'Moneda inválida'),
  ambito: z.string().min(1, 'Elige un ámbito'),
  categoria: z.string().min(1, 'Elige una categoría').max(60),
  subcategoria: z.string().max(60),
  descripcion: z.string().max(200, 'Máximo 200 caracteres'),
  medioPago: z.string().min(1, 'Elige un medio de pago'),
  tipoGasto: z.enum(TIPOS_GASTO),
  esRecurrente: z.boolean(),
})

type Form = { [K in keyof GastoInput]: GastoInput[K] } & { montoText: string }

function initial(store: AppStore, g: Gasto | null): Form {
  const cfg = store.data?.config ?? {}
  if (g) return { ...g, montoText: String(g.monto) }
  return {
    id: crypto.randomUUID(), // generado al abrir: si la red falla y se reintenta, el backend no duplica
    fecha: todayIn(cfg.zona_horaria || 'America/Lima'), monto: 0, montoText: '', moneda: cfg.moneda || 'PEN',
    ambito: 'Personal', categoria: '', subcategoria: '', descripcion: '', medioPago: '', tipoGasto: 'Variable',
    esRecurrente: false, comprobanteUrl: '',
  }
}

export default function GastoModal({ store, gasto, open, onClose, onSaved }: { store: AppStore; gasto: Gasto | null; open: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const [form, setForm] = useState<Form>(() => initial(store, gasto))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<Form>) => setForm(f => ({ ...f, ...p }))
  const opts = catalogOptions(store, form.ambito, form.categoria)
  const subOptions = form.categoria ? opts.subcategorias : []
  const medios = (store.data?.medios ?? []).filter(m => m.activo).map(m => m.nombre)
  const monedas = (store.data?.config.monedas || 'PEN,USD').split(',').map(s => s.trim()).filter(Boolean)
  // Al editar, conserva valores que ya no estén activos en el catálogo.
  const withCurrent = (xs: string[], v: string) => (v && !xs.includes(v) ? [v, ...xs] : xs)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse({ ...form, monto: form.montoText.trim() === '' ? undefined : Number(form.montoText.replace(',', '.')) })
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0]), i.message])))
      return
    }
    if (subOptions.length && !parsed.data.subcategoria) {
      setErrors({ subcategoria: 'Elige una subcategoría' })
      return
    }
    setErrors({})
    setServerError('')
    setSaving(true)
    try {
      await store.actions.saveGasto({ ...parsed.data, id: form.id, comprobanteUrl: form.comprobanteUrl }, gasto ? 'update' : 'create')
      onSaved(gasto ? 'Gasto actualizado' : 'Gasto registrado')
      onClose()
    } catch (err) {
      setServerError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={gasto ? 'Editar gasto' : 'Nuevo gasto'}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
        {/* Orden jerárquico: el ámbito define las categorías y la categoría define las subcategorías. */}
        <fieldset className="col-span-2">
          <legend className="mb-1 text-xs font-medium text-muted">Ámbito</legend>
          <div role="radiogroup" aria-label="Ámbito" className="flex flex-wrap gap-1.5">
            {withCurrent(opts.ambitos, form.ambito).map(a => (
              <button key={a} type="button" role="radio" aria-checked={form.ambito === a}
                onClick={() => form.ambito !== a && set({ ambito: a, categoria: '', subcategoria: '' })}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition ${form.ambito === a ? 'border-navy bg-navy text-white' : 'border-line text-ink hover:bg-bg'}`}>
                {a}
              </button>
            ))}
          </div>
          {errors.ambito && <span className="text-xs text-red-600">{errors.ambito}</span>}
        </fieldset>
        <Field label="Categoría" error={errors.categoria}>
          <select aria-label="Categoría" className={inputCls} disabled={!form.ambito} value={form.categoria} onChange={e => set({ categoria: e.target.value, subcategoria: '' })}>
            <option value="">{form.ambito ? 'Elige…' : 'Primero elige un ámbito'}</option>
            {withCurrent(opts.categorias, form.categoria).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Subcategoría" error={errors.subcategoria}>
          <select aria-label="Subcategoría" className={inputCls} disabled={!form.categoria} value={form.subcategoria} onChange={e => set({ subcategoria: e.target.value })}>
            <option value="">{form.categoria ? 'Elige…' : 'Primero elige una categoría'}</option>
            {withCurrent(subOptions, form.subcategoria).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Monto" error={errors.monto}>
          <input type="text" inputMode="decimal" className={`${inputCls} tabular`} placeholder="0.00" value={form.montoText} onChange={e => set({ montoText: e.target.value })} />
        </Field>
        <Field label="Moneda" error={errors.moneda}><Select label="Moneda" value={form.moneda} onChange={moneda => set({ moneda })} options={withCurrent(monedas, form.moneda)} /></Field>
        <Field label="Fecha" error={errors.fecha}><input type="date" className={inputCls} value={form.fecha} onChange={e => set({ fecha: e.target.value })} /></Field>
        <Field label="Medio de pago" error={errors.medioPago}>
          <Select label="Medio de pago" value={form.medioPago} onChange={medioPago => set({ medioPago })} options={withCurrent(medios, form.medioPago)} placeholder="Elige…" />
        </Field>
        <Field label="Tipo de gasto"><Select label="Tipo de gasto" value={form.tipoGasto} onChange={v => set({ tipoGasto: v as Form['tipoGasto'] })} options={[...TIPOS_GASTO]} /></Field>
        <div className="col-span-2">
          <Field label="Descripción" error={errors.descripcion}><input className={inputCls} maxLength={200} value={form.descripcion} onChange={e => set({ descripcion: e.target.value })} /></Field>
        </div>
        <label className="col-span-2 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.esRecurrente} onChange={e => set({ esRecurrente: e.target.checked })} /> Es recurrente
        </label>
        {form.ambito && !opts.categorias.length && <p className="col-span-2 text-xs text-muted">No hay categorías para este ámbito. Agrégalas en la pestaña Categorías.</p>}
        {serverError && <div className="col-span-2"><ErrorBox message={serverError} /></div>}
        <div className="col-span-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={saving}>{gasto ? 'Guardar cambios' : 'Registrar'}</Button>
        </div>
      </form>
    </Modal>
  )
}
