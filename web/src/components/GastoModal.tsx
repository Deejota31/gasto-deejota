import { useState } from 'react'
import { z } from 'zod'
import { Copy, Link2, Pencil, Plus, Receipt } from 'lucide-react'
import type { GastoInput } from '../lib/api'
import type { AppStore, OpMessages } from '../lib/store'
import { TIPOS_GASTO, type Gasto, type TipoGasto } from '../lib/types'
import { todayIn } from '../lib/dates'
import { medioLook, sortMedios } from '../lib/visual'
import { formatearDescripcion } from '../lib/texto'
import { autocompletar, ClasificacionPicker, opcionesClasif, type Clasif } from './Clasificacion'
import { Button, DateField, Field, inputCls, Modal, Segmented, SelectField, Switch } from './ui'

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

export type GastoDraft = Omit<GastoInput, 'monto'> & { montoText: string }
type Form = GastoDraft

/** Datos precargados desde una plantilla de "Gastos mensuales" (solo clasificación y descripción). */
export type GastoPreset = Clasif & { descripcion: string; monto?: number | null; moneda?: string; medioPago?: string
  /** Plantilla de origen: el gasto queda vinculado como pago de ese compromiso. */
  plantillaId?: string; plantillaNombre?: string }

function initial(store: AppStore, mode: ModalMode, g: Gasto | null, draft?: GastoDraft, preset?: GastoPreset): Form {
  if (draft) return draft // reabrir tras un error: se conservan los datos que ingresaste
  const cfg = store.data?.config ?? {}
  if (g) {
    // uid y problemaId son solo de la interfaz; estado, origen y marcas de tiempo los pone el backend.
    const { monto, estado: _e, origen: _o, creadoEn: _c, actualizadoEn: _a, uid: _u, problemaId: _p, ...rest } = g
    // Clonar: todos los datos funcionales del original, INCLUIDA su fecha (texto AAAA-MM-DD, sin conversiones de zona
    // horaria), e ID nuevo. Antes se ponía la fecha de hoy.
    return mode === 'clone' ? { ...rest, id: crypto.randomUUID(), montoText: String(monto) } : { ...rest, montoText: String(monto) }
  }
  return {
    id: crypto.randomUUID(), // generado al abrir: si la red falla y se reintenta, el backend no duplica
    fecha: todayIn(cfg.zona_horaria || 'America/Lima'), montoText: preset?.monto ? String(preset.monto) : '', moneda: preset?.moneda || cfg.moneda || 'PEN',
    ambito: preset?.ambito ?? 'Personal', categoria: preset?.categoria ?? '', subcategoria: preset?.subcategoria ?? '', descripcion: preset?.descripcion ?? '',
    medioPago: preset?.medioPago ?? '', tipoGasto: 'Variable', esRecurrente: false, comprobanteUrl: '',
    ...(preset?.plantillaId ? { plantillaId: preset.plantillaId } : {}),
  }
}

const TITLES: Record<ModalMode, { title: string; sub: string; cta: string }> = {
  create: { title: 'Nuevo gasto', sub: 'Elige el ámbito y luego la categoría.', cta: 'Registrar gasto' },
  edit: { title: 'Editar gasto', sub: 'Los cambios se guardan en tu hoja con el mismo ID.', cta: 'Guardar cambios' },
  clone: { title: 'Clonar gasto', sub: 'Se creará un gasto nuevo con estos datos. Ajusta lo que necesites.', cta: 'Crear copia' },
}

/** Mensajes de las notificaciones de cada operación (pendiente → éxito o error real del backend). */
export const GASTO_MSG: Record<ModalMode, OpMessages> = {
  create: { pending: 'Guardando gasto…', ok: 'Gasto registrado correctamente.', error: 'No se pudo registrar el gasto.' },
  edit: { pending: 'Actualizando gasto…', ok: 'Gasto actualizado correctamente.', error: 'Error al actualizar el registro.' },
  clone: { pending: 'Clonando gasto…', ok: 'Gasto clonado correctamente.', error: 'No se pudo clonar el gasto.' },
}

/**
 * Formulario único de gasto (crear, editar, clonar), usado desde el Dashboard y desde Gastos.
 * Al guardar valida, entrega la operación a `onSubmit` y se cierra: el guardado sigue en segundo plano
 * y su resultado real llega como notificación. Si falla, la notificación permite reabrirlo con los mismos datos.
 */
export default function GastoModal({ store, mode, gasto, draft, preset, onClose, onSubmit }: {
  store: AppStore; mode: ModalMode; gasto: Gasto | null; draft?: GastoDraft; preset?: GastoPreset; onClose: () => void
  onSubmit: (input: GastoInput, mode: ModalMode, draft: GastoDraft) => boolean
}) {
  const [form, setForm] = useState<Form>(() => initial(store, mode, gasto, draft, preset))
  // Última descripción que se completó sola. En editar/clonar la descripción es la del registro: no se reemplaza
  // (null nunca coincide con un texto, así que solo se autocompleta si la vacías).
  const [descAuto, setDescAuto] = useState<string | null>(() => {
    if (mode !== 'create') return null
    const f = draft ?? preset
    return f ? (autocompletar('', null, f.subcategoria).descripcion === f.descripcion ? f.descripcion : null) : ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (p: Partial<Form>) => setForm(f => ({ ...f, ...p }))
  const catalogo = store.data?.catalogo ?? []
  const subOptions = opcionesClasif(catalogo, form, mode !== 'create' || !!draft).subsVigentes
  const medios = sortMedios((store.data?.medios ?? []).filter(m => m.activo).map(m => m.nombre))
  const monedas = (store.data?.config.monedas || 'PEN,USD').split(',').map(s => s.trim()).filter(Boolean)
  // Al editar, conserva valores que ya no estén activos en el catálogo.
  const withCurrent = (xs: string[], v: string) => sortMedios(v && !xs.includes(v) ? [...xs, v] : xs)

  function setClasif(next: Clasif) {
    const subCambio = next.subcategoria !== form.subcategoria
    if (subCambio && next.subcategoria) {
      const r = autocompletar(form.descripcion, descAuto, next.subcategoria)
      setDescAuto(r.auto)
      set({ ...next, descripcion: r.descripcion })
    } else set(next)
  }
  // Formato al salir del campo (no en cada tecla: así no salta el cursor).
  function onDescBlur() {
    const f = formatearDescripcion(form.descripcion)
    if (f === form.descripcion) return
    if (form.descripcion === descAuto) setDescAuto(f)
    set({ descripcion: f })
  }
  const t = TITLES[mode]
  const symbol = form.moneda === 'PEN' ? 'S/' : form.moneda === 'USD' ? 'US$' : form.moneda

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    const errs: Record<string, string> = {}
    const montoTxt = form.montoText.trim()
    const monto = Number(montoTxt.replace(',', '.'))
    if (!montoTxt) errs.monto = 'Ingresa un monto'
    else if (!AMOUNT.test(montoTxt) || !(monto > 0)) errs.monto = 'Monto mayor a 0, con hasta 2 decimales'
    const descripcion = formatearDescripcion(form.descripcion) // normalización final antes de guardar
    const parsed = schema.safeParse({ ...form, descripcion })
    if (!parsed.success) parsed.error.issues.forEach(i => { errs[String(i.path[0])] ??= i.message })
    if (form.categoria && subOptions.length && !form.subcategoria) errs.subcategoria = 'Elige una subcategoría'
    setErrors(errs)
    if (Object.keys(errs).length || !parsed.success) return
    // El mismo ID viaja en cada reintento: el backend no duplica aunque llegue dos veces.
    // Solo un alta desde plantilla queda vinculada a ella; editar o clonar nunca crea un compromiso nuevo.
    const plantillaId = mode === 'create' ? form.plantillaId : undefined
    if (onSubmit({ ...parsed.data, id: form.id, monto, comprobanteUrl: form.comprobanteUrl, ...(plantillaId ? { plantillaId } : {}) }, mode, { ...form, descripcion })) onClose()
  }

  return (
    <Modal open onClose={onClose} size="lg" title={t.title} subtitle={t.sub}
      icon={mode === 'edit' ? <Pencil className="size-5" /> : mode === 'clone' ? <Copy className="size-5" /> : <Receipt className="size-5" />}
      footer={<>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="gasto-form">{mode === 'create' && <Plus className="size-4" />}{t.cta}</Button>
      </>}>
      <form id="gasto-form" onSubmit={submit} noValidate className="grid gap-5 md:grid-cols-2">
        <ClasificacionPicker catalogo={catalogo} value={form} onChange={setClasif} errors={errors} keepCurrent={mode !== 'create' || !!draft} />

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
          {/* Fecha y Tipo de gasto con la misma caja; en pantallas muy angostas se apilan. */}
          <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
            <Field label="Fecha" error={errors.fecha} htmlFor="gasto-fecha">
              <DateField id="gasto-fecha" value={form.fecha} onChange={fecha => set({ fecha })} format={store.data?.config.formato_fecha} invalid={!!errors.fecha} />
            </Field>
            <Field label="Tipo de gasto" htmlFor="gasto-tipo">
              <SelectField id="gasto-tipo" value={form.tipoGasto} onChange={v => set({ tipoGasto: v as TipoGasto })}>
                {TIPOS_GASTO.map(x => <option key={x}>{x}</option>)}
              </SelectField>
            </Field>
          </div>
          {mode === 'create' && form.plantillaId && (
            <p className="flex items-center gap-1.5 rounded-xl bg-primary-soft px-3 py-2 text-xs text-navy" data-testid="vinculo-plantilla">
              <Link2 className="size-3.5 shrink-0" /> Quedará vinculado a la plantilla{preset?.plantillaNombre ? ` “${preset.plantillaNombre}”` : ''}: si es un compromiso, cuenta como su pago.
            </p>
          )}
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
            <input id="gasto-desc" className={inputCls} maxLength={200} placeholder="Ej. almuerzo con el equipo" value={form.descripcion} onChange={e => set({ descripcion: e.target.value })} onBlur={onDescBlur} />
          </Field>
          <Switch checked={form.esRecurrente} onChange={v => set({ esRecurrente: v })} label="Es recurrente" />
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
