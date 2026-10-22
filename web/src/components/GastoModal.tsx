import { useMemo, useState } from 'react'
import { z } from 'zod'
import { AlertTriangle, Copy, Link2, Pencil, Plus, Receipt, Shuffle } from 'lucide-react'
import type { GastoInput } from '../lib/api'
import type { AppStore, OpMessages } from '../lib/store'
import { TIPOS_GASTO, type Gasto, type TipoGasto } from '../lib/types'
import { monthLabel, todayIn } from '../lib/dates'
import { asignarMes, avisosPrevios, resumenDistribucion, validarMedioGasto } from '../lib/presupuesto'
import { ctxReparto } from '../lib/useAgregado'
import { formatMoney } from '../lib/money'
import { medioLook, sortMedios } from '../lib/visual'
import { formatearDescripcion } from '../lib/texto'
import { ClasificacionPicker, ConfirmarDescripcion, opcionesClasif, useDescripcionSub, type Clasif } from './Clasificacion'
import { Button, Checkbox, DateField, ErrorBox, Field, inputCls, Modal, Segmented, Switch } from './ui'
import { Combobox } from './Combobox'

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
export type GastoPreset = Clasif & { descripcion: string; monto?: number | null; moneda?: string; medioPago?: string; tipoGasto?: TipoGasto; esRecurrente?: boolean
  /** Plantilla de origen: el gasto queda vinculado como pago de ese compromiso. */
  plantillaId?: string; plantillaNombre?: string
  /** Fecha precargada AAAA-MM-DD (p. ej. un día sin movimientos de la Revisión del presupuesto). */
  fecha?: string }

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
    fecha: preset?.fecha ?? todayIn(cfg.zona_horaria || 'America/Lima'), montoText: preset?.monto ? String(preset.monto) : '', moneda: preset?.moneda || cfg.moneda || 'PEN',
    ambito: preset?.ambito ?? 'Personal', categoria: preset?.categoria ?? '', subcategoria: preset?.subcategoria ?? '', descripcion: preset?.descripcion ?? '',
    medioPago: preset?.medioPago ?? '', tipoGasto: preset?.tipoGasto ?? 'Variable', esRecurrente: preset?.esRecurrente ?? false, comprobanteUrl: '',
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
  /** `distribucion`: resumen del reparto entre fondos para el aviso de éxito (se muestra cuando el backend confirma). */
  onSubmit: (input: GastoInput, mode: ModalMode, draft: GastoDraft, distribucion?: string) => boolean
}) {
  const [form, setForm] = useState<Form>(() => initial(store, mode, gasto, draft, preset))
  // La descripción sigue a la subcategoría (ver useDescripcionSub): editar/clonar conservan la del registro al abrir.
  const desc = useDescripcionSub(form.descripcion, form.subcategoria)
  const [intentado, setIntentado] = useState(false)   // tras el primer intento de guardar, cada campo se valida al cambiarlo
  const set = (p: Partial<Form>) => setForm(f => ({ ...f, ...p }))
  const catalogo = store.data?.catalogo ?? []
  const subOptions = opcionesClasif(catalogo, form, mode !== 'create' || !!draft).subsVigentes
  const medios = sortMedios((store.data?.medios ?? []).filter(m => m.activo).map(m => m.nombre))
  const monedas = (store.data?.config.monedas || 'PEN,USD').split(',').map(s => s.trim()).filter(Boolean)
  // Al editar, conserva valores que ya no estén activos en el catálogo.
  const withCurrent = (xs: string[], v: string) => sortMedios(v && !xs.includes(v) ? [...xs, v] : xs)

  function setClasif(next: Clasif) {
    if (next.subcategoria !== form.subcategoria) desc.alCambiarSub(next.subcategoria)
    set(next)
  }
  const t = TITLES[mode]
  const symbol = form.moneda === 'PEN' ? 'S/' : form.moneda === 'USD' ? 'US$' : form.moneda

  // Validación pura sobre el estado actual: el error de un campo desaparece en cuanto el campo es válido (sin volver a pulsar Guardar).
  const montoTxt = form.montoText.trim()
  const monto = Number(montoTxt.replace(',', '.'))
  const descripcion = formatearDescripcion(desc.descripcion) // normalización final antes de guardar
  const parsed = schema.safeParse({ ...form, descripcion })
  const errs: Record<string, string> = {}
  if (!montoTxt) errs.monto = 'Ingresa un monto'
  else if (!AMOUNT.test(montoTxt) || !(monto > 0)) errs.monto = 'Monto mayor a 0, con hasta 2 decimales'
  if (!parsed.success) parsed.error.issues.forEach(i => { errs[String(i.path[0])] ??= i.message })
  if (form.categoria && subOptions.length && !form.subcategoria) errs.subcategoria = 'Elige una subcategoría'

  // v1.28 — Presupuestos: el medio que viola una restricción configurada BLOQUEA el guardado (el backend aplica la misma regla).
  // Un fondo sin saldo NO bloquea: se avisa del excedente/sobregiro antes de guardar.
  const data = store.data
  const fondos = data?.fondos ?? []
  const medioCheck = data && form.medioPago && form.categoria ? validarMedioGasto({ ...form }, fondos) : { ok: true as const }
  // Al editar, solo se exige si cambió algo que afecta a la regla (igual que el backend): un gasto antiguo no queda bloqueado.
  const relevante = mode !== 'edit' || !gasto || ['medioPago', 'ambito', 'categoria', 'subcategoria'].some(k => gasto[k as keyof Gasto] !== form[k as keyof Form]) || gasto.fecha.slice(0, 7) !== form.fecha.slice(0, 7)
  if (!medioCheck.ok && relevante) errs.medioPago = medioCheck.mensaje
  const errors = intentado ? errs : {}
  const base = data?.config.moneda || 'PEN'
  const money = (c: number) => formatMoney(c, base)
  const nombre = (id: string) => fondos.find(f => f.id === id)?.nombre ?? 'Fondo'
  const mesG = /^\d{4}-\d{2}/.test(form.fecha) ? form.fecha.slice(0, 7) : ''
  // Vista previa del reparto: el mes del gasto con este gasto (nuevo o editado) dentro. Mismo motor que Presupuestos.
  const previa = useMemo(() => {
    if (!data || !fondos.length || !mesG || !(monto > 0) || !form.categoria || !form.medioPago) return null
    const g: Gasto = { ...(gasto && mode === 'edit' ? gasto : {} as Gasto), ...form, descripcion, monto, estado: 'Activo', origen: gasto?.origen ?? 'web',
      creadoEn: mode === 'edit' && gasto ? gasto.creadoEn : '9999-12-31T23:59:59Z', actualizadoEn: '', id: form.id }
    const otros = data.gastos.filter(x => x.id !== form.id && (mode !== 'edit' || x.id !== gasto?.id))
    const r = asignarMes(mesG, [...otros, g], fondos, ctxReparto(data))
    const imp = r.porGasto.get(g.id)
    return imp ? { imp, avisos: avisosPrevios(imp, r.porFondo, nombre, money) } : null
  }, [data, fondos, mesG, monto, form.categoria, form.subcategoria, form.ambito, form.medioPago, form.moneda, form.fecha]) // eslint-disable-line react-hooks/exhaustive-deps
  // Editar un gasto de un mes ya cerrado cambia los saldos de ese mes: se pide confirmación explícita.
  const hoyMes = todayIn(data?.config.zona_horaria || 'America/Lima').slice(0, 7)
  const tocaHistorico = mode === 'edit' && !!gasto && (gasto.fecha.slice(0, 7) < hoyMes || (mesG !== '' && mesG < hoyMes)) &&
    (['medioPago', 'ambito', 'categoria', 'subcategoria', 'fecha', 'moneda'].some(k => gasto[k as keyof Gasto] !== form[k as keyof Form]) || Number(gasto.monto) !== monto)
  const [confirmaHistorico, setConfirmaHistorico] = useState(false)
  if (tocaHistorico && !confirmaHistorico) errs.historico = 'Confirma que quieres modificar un mes cerrado.'

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setIntentado(true)
    if (Object.keys(errs).length || !parsed.success) return
    // El mismo ID viaja en cada reintento: el backend no duplica aunque llegue dos veces.
    // Solo un alta desde plantilla queda vinculada a ella; editar o clonar nunca crea un compromiso nuevo.
    const plantillaId = mode === 'create' ? form.plantillaId : undefined
    const distribucion = previa ? resumenDistribucion(previa.imp, nombre, money) : undefined
    if (onSubmit({ ...parsed.data, id: form.id, monto, comprobanteUrl: form.comprobanteUrl, ...(plantillaId ? { plantillaId } : {}) }, mode, { ...form, descripcion }, distribucion)) onClose()
  }

  return (
    <Modal open onClose={onClose} size="lg" title={t.title} subtitle={t.sub}
      icon={mode === 'edit' ? <Pencil className="size-5" /> : mode === 'clone' ? <Copy className="size-5" /> : <Receipt className="size-5" />}
      footer={<>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="gasto-form">{mode === 'create' && <Plus className="size-4" />}{t.cta}</Button>
      </>}>
      <form id="gasto-form" onSubmit={submit} noValidate className="grid gap-5 md:grid-cols-2">
        <ClasificacionPicker catalogo={catalogo} value={form} onChange={setClasif} errors={errors} keepCurrent={mode !== 'create' || !!draft}>
          {/* Descripción pegada a la subcategoría de la que depende. */}
          <Field label="Descripción" error={errors.descripcion} hint="Se completa con la subcategoría; puedes cambiarla." htmlFor="gasto-desc">
            <input id="gasto-desc" className={inputCls} maxLength={200} placeholder="Ej. almuerzo con el equipo" value={desc.descripcion} onChange={e => desc.escribir(e.target.value)} onBlur={desc.alSalir} />
            <ConfirmarDescripcion d={desc} />
          </Field>
        </ClasificacionPicker>

        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-bg/50 p-3">
            <label htmlFor="gasto-monto" className="text-xs font-medium text-muted">Monto</label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-2xl font-semibold text-muted">{symbol}</span>
              <input id="gasto-monto" aria-label="Monto" autoFocus={mode !== 'edit'} type="text" inputMode="decimal" placeholder="0.00" autoComplete="off"
                className="tabular w-full min-w-0 bg-transparent text-3xl font-bold text-ink outline-none placeholder:text-muted/40"
                value={form.montoText} onChange={e => set({ montoText: e.target.value.replace(/[^\d.,]/g, '') })} />
            </div>
            {errors.monto && <span className="text-xs text-danger">{errors.monto}</span>}
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
              <Combobox id="gasto-tipo" label="Tipo de gasto" value={form.tipoGasto} onChange={v => set({ tipoGasto: v as TipoGasto })} options={TIPOS_GASTO.map(x => ({ value: x, label: x }))} />
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
            {errors.medioPago && <span className="text-xs text-danger" data-testid="error-medio">{errors.medioPago}</span>}
            {!errors.medioPago && !medioCheck.ok && relevante && <span className="text-xs text-danger" data-testid="error-medio">{medioCheck.mensaje}</span>}
          </div>
          {previa && (previa.avisos.length > 0 || previa.imp.partes.length > 0) && (
            <div className="space-y-1 rounded-xl border border-line px-3 py-2 text-xs" data-testid="previa-fondos">
              <p className="flex items-center gap-1.5 font-semibold text-ink"><Shuffle className="size-3.5" /> {resumenDistribucion(previa.imp, nombre, money)}</p>
              {previa.avisos.map(a => <p key={a} className="flex items-start gap-1.5" style={{ color: 'var(--warning)' }}><AlertTriangle className="mt-0.5 size-3 shrink-0" />{a}</p>)}
            </div>
          )}
          {tocaHistorico && (
            <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }} data-testid="confirmar-historico">
              <Checkbox checked={confirmaHistorico} onChange={setConfirmaHistorico} label={`Confirmo que quiero modificar un gasto de ${monthLabel(gasto!.fecha.slice(0, 7) < hoyMes ? gasto!.fecha.slice(0, 7) : mesG, true)}, un mes cerrado: cambiarán los saldos de sus fondos.`} />
            </div>
          )}
          {intentado && errs.historico && <ErrorBox message={errs.historico} />}
          <Switch checked={form.esRecurrente} onChange={v => set({ esRecurrente: v })} label="Es recurrente" />
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
