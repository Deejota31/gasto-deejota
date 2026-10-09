import { useState } from 'react'
import { z } from 'zod'
import { Check, Copy, Pencil, Plus, Receipt } from 'lucide-react'
import type { GastoInput } from '../lib/api'
import type { AppStore } from '../lib/store'
import { TIPOS_GASTO, type Gasto, type TipoGasto } from '../lib/types'
import { todayIn } from '../lib/dates'
import { ambitoLook, categoriaLook, medioLook, sortMedios } from '../lib/visual'
import { catalogOptions } from './shared'
import { Button, ErrorBox, Field, inputCls, Modal, Segmented, Switch } from './ui'

export type ModalMode = 'create' | 'edit' | 'clone'

const AMOUNT = /^\d{1,9}([.,]\d{1,2})?$/

const schema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige una fecha'),
  moneda: z.string().regex(/^[A-Z]{3}$/, 'Moneda inválida'),
  ambito: z.string().min(1, 'Elige un ámbito'),
  categoria: z.string().min(1, 'Elige una categoría').max(60),
  subcategoria: z.string().max(60),
  descripcion: z.string().max(200, 'Máximo 200 caracteres'),
  medioPago: z.string().min(1, 'Elige un medio de pago'),
  tipoGasto: z.enum(TIPOS_GASTO),
  esRecurrente: z.boolean(),
})

type Form = Omit<GastoInput, 'monto'> & { montoText: string }

function initial(store: AppStore, mode: ModalMode, g: Gasto | null): Form {
  const cfg = store.data?.config ?? {}
  const today = todayIn(cfg.zona_horaria || 'America/Lima')
  if (g) {
    const { monto, estado: _e, origen: _o, creadoEn: _c, actualizadoEn: _a, ...rest } = g
    // Clonar: mismos datos, ID nuevo y fecha de hoy (editable).
    return mode === 'clone' ? { ...rest, id: crypto.randomUUID(), fecha: today, montoText: String(monto) } : { ...rest, montoText: String(monto) }
  }
  return {
    id: crypto.randomUUID(), // generado al abrir: si la red falla y se reintenta, el backend no duplica
    fecha: today, montoText: '', moneda: cfg.moneda || 'PEN', ambito: 'Personal', categoria: '', subcategoria: '', descripcion: '',
    medioPago: '', tipoGasto: 'Variable', esRecurrente: false, comprobanteUrl: '',
  }
}

const TITLES: Record<ModalMode, { title: string; sub: string; cta: string; ok: string }> = {
  create: { title: 'Nuevo gasto', sub: 'Elige el ámbito y luego la categoría.', cta: 'Registrar gasto', ok: 'Gasto registrado' },
  edit: { title: 'Editar gasto', sub: 'Los cambios se guardan en tu hoja con el mismo ID.', cta: 'Guardar cambios', ok: 'Gasto actualizado' },
  clone: { title: 'Clonar gasto', sub: 'Se creará un gasto nuevo con estos datos. Ajusta lo que necesites.', cta: 'Crear copia', ok: 'Copia registrada' },
}

function Chip({ on, color, children, onClick, label }: { on: boolean; color: string; children: React.ReactNode; onClick: () => void; label?: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={label} onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[13px] font-medium transition ${on ? 'shadow-sm' : 'border-line bg-card text-ink hover:bg-bg'}`}
      style={on ? { background: `${color}1F`, borderColor: color, color } : undefined}>
      {children}
      {on && <Check className="size-3.5" />}
    </button>
  )
}

export default function GastoModal({ store, mode, gasto, onClose, onSaved }: { store: AppStore; mode: ModalMode; gasto: Gasto | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [form, setForm] = useState<Form>(() => initial(store, mode, gasto))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<Form>) => setForm(f => ({ ...f, ...p }))
  const catalogo = store.data?.catalogo ?? []
  const opts = catalogOptions(catalogo, form.ambito ? [form.ambito] : [], form.categoria ? [form.categoria] : [])
  const subOptions = form.categoria ? opts.subcategorias.map(s => s.subcategoria) : []
  const medios = sortMedios((store.data?.medios ?? []).filter(m => m.activo).map(m => m.nombre))
  const monedas = (store.data?.config.monedas || 'PEN,USD').split(',').map(s => s.trim()).filter(Boolean)
  // Al editar, conserva valores que ya no estén activos en el catálogo.
  const withCurrent = (xs: string[], v: string) => (v && !xs.includes(v) ? [v, ...xs] : xs)
  const t = TITLES[mode]
  const symbol = form.moneda === 'PEN' ? 'S/' : form.moneda === 'USD' ? 'US$' : form.moneda

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (saving) return // evita envíos duplicados
    const errs: Record<string, string> = {}
    const montoTxt = form.montoText.trim()
    const monto = Number(montoTxt.replace(',', '.'))
    if (!montoTxt) errs.monto = 'Ingresa un monto'
    else if (!AMOUNT.test(montoTxt) || !(monto > 0)) errs.monto = 'Monto mayor a 0, con hasta 2 decimales'
    const parsed = schema.safeParse(form)
    if (!parsed.success) parsed.error.issues.forEach(i => { errs[String(i.path[0])] ??= i.message })
    if (form.categoria && subOptions.length && !form.subcategoria) errs.subcategoria = 'Elige una subcategoría'
    setErrors(errs)
    if (Object.keys(errs).length || !parsed.success) return
    setServerError('')
    setSaving(true)
    try {
      await store.actions.saveGasto({ ...parsed.data, id: form.id, monto, comprobanteUrl: form.comprobanteUrl }, mode === 'edit' ? 'update' : 'create')
      onSaved(t.ok)
      onClose() // solo se cierra cuando el backend confirmó
    } catch (err) {
      setServerError((err as Error).message) // los datos quedan en el formulario
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={t.title} subtitle={t.sub}
      icon={mode === 'edit' ? <Pencil className="size-5" /> : mode === 'clone' ? <Copy className="size-5" /> : <Receipt className="size-5" />}
      footer={<>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="gasto-form" loading={saving}>{mode === 'create' && <Plus className="size-4" />}{t.cta}</Button>
      </>}>
      <form id="gasto-form" onSubmit={submit} noValidate className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">1. Ámbito</p>
            <div role="radiogroup" aria-label="Ámbito" className="flex flex-wrap gap-1.5">
              {withCurrent(opts.ambitos, form.ambito).map(a => {
                const l = ambitoLook(a, catalogo)
                return <Chip key={a} on={form.ambito === a} color={l.color} onClick={() => form.ambito !== a && set({ ambito: a, categoria: '', subcategoria: '' })}><l.Icon className="size-4" />{a}</Chip>
              })}
            </div>
            {errors.ambito && <span className="text-xs text-[#D2463C]">{errors.ambito}</span>}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">2. Categoría</p>
            {!form.ambito ? <p className="rounded-xl bg-bg px-3 py-2 text-xs text-muted">Primero elige un ámbito.</p> : (
              <div role="radiogroup" aria-label="Categoría" className="flex flex-wrap gap-1.5">
                {withCurrent(opts.categorias, form.categoria).map(c => {
                  const l = categoriaLook(c, catalogo, form.ambito)
                  return <Chip key={c} on={form.categoria === c} color={l.color} onClick={() => form.categoria !== c && set({ categoria: c, subcategoria: '' })}><l.Icon className="size-4" />{c}</Chip>
                })}
                {!opts.categorias.length && <p className="text-xs text-muted">No hay categorías activas para este ámbito. Agrégalas en Categorías.</p>}
              </div>
            )}
            {errors.categoria && <span className="text-xs text-[#D2463C]">{errors.categoria}</span>}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">3. Subcategoría</p>
            {!form.categoria ? <p className="rounded-xl bg-bg px-3 py-2 text-xs text-muted">Se habilita al elegir una categoría.</p> : (
              <div role="radiogroup" aria-label="Subcategoría" className="flex flex-wrap gap-1.5">
                {withCurrent(subOptions, form.subcategoria).map(s => (
                  <Chip key={s} on={form.subcategoria === s} color={categoriaLook(form.categoria, catalogo, form.ambito).color} onClick={() => set({ subcategoria: s })}>{s}</Chip>
                ))}
              </div>
            )}
            {errors.subcategoria && <span className="text-xs text-[#D2463C]">{errors.subcategoria}</span>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-bg/50 p-3">
            <label htmlFor="gasto-monto" className="text-xs font-medium text-muted">Monto</label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-2xl font-semibold text-muted">{symbol}</span>
              <input id="gasto-monto" aria-label="Monto" autoFocus={mode !== 'edit'} type="text" inputMode="decimal" placeholder="0.00" autoComplete="off"
                className="tabular w-full min-w-0 bg-transparent text-3xl font-bold text-ink outline-none placeholder:text-muted/40"
                value={form.montoText} onChange={e => set({ montoText: e.target.value.replace(/[^\d.,]/g, '') })} />
            </div>
            {errors.monto && <span className="text-xs text-[#D2463C]">{errors.monto}</span>}
            {monedas.length > 1 && (
              <div className="mt-2">
                <Segmented label="Moneda" value={form.moneda} onChange={moneda => set({ moneda })} options={withCurrent(monedas, form.moneda).map(m => ({ value: m, label: m }))} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha" error={errors.fecha} htmlFor="gasto-fecha"><input id="gasto-fecha" type="date" className={inputCls} value={form.fecha} onChange={e => set({ fecha: e.target.value })} /></Field>
            <Field label="Tipo de gasto">
              <select aria-label="Tipo de gasto" className={inputCls} value={form.tipoGasto} onChange={e => set({ tipoGasto: e.target.value as TipoGasto })}>
                {TIPOS_GASTO.map(x => <option key={x}>{x}</option>)}
              </select>
            </Field>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Medio de pago</p>
            <div role="radiogroup" aria-label="Medio de pago" className="grid grid-cols-3 gap-1.5">
              {withCurrent(medios, form.medioPago).map(m => {
                const l = medioLook(m)
                const on = form.medioPago === m
                return (
                  <button key={m} type="button" role="radio" aria-checked={on} onClick={() => set({ medioPago: m })}
                    className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-xs font-medium transition ${on ? 'shadow-sm' : 'border-line hover:bg-bg'}`}
                    style={on ? { background: `${l.color}1A`, borderColor: l.color, color: l.color } : undefined}>
                    <l.Icon className="size-4" style={{ color: l.color }} />{m}
                  </button>
                )
              })}
            </div>
            {errors.medioPago && <span className="text-xs text-[#D2463C]">{errors.medioPago}</span>}
          </div>
          <Field label="Descripción" error={errors.descripcion} hint="Opcional" htmlFor="gasto-desc">
            <input id="gasto-desc" className={inputCls} maxLength={200} placeholder="Ej. almuerzo con el equipo" value={form.descripcion} onChange={e => set({ descripcion: e.target.value })} />
          </Field>
          <Switch checked={form.esRecurrente} onChange={v => set({ esRecurrente: v })} label="Es recurrente" />
        </div>
        {serverError && <div className="md:col-span-2"><ErrorBox message={serverError} /></div>}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
