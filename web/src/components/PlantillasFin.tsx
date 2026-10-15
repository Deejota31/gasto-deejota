// "Fuentes mensuales" y "Subcajas mensuales" (v1.17): plantillas reutilizables de fuentes de dinero y de subcajas.
// Una plantilla es SOLO configuración: guardarla, editarla o clonarla no crea dinero, fuentes, subcajas ni gastos.
// Aplicarla a un mes escribe únicamente ese mes (FUENTES_MESES / PRESUPUESTOS) y es idempotente; ver el backend.
import { formatearDescripcion } from '../lib/texto'
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, Ban, Boxes, CalendarDays, Check, ChevronDown, ChevronUp, CircleDollarSign, Copy, Info, ListChecks, Loader2, Pencil,
  Plus, Power, RotateCcw, Save, Search, Send, Trash2, X,
} from 'lucide-react'
import type { AppStore } from '../lib/store'
import type { PlantillaFinInput } from '../lib/api'
import type { AppData, Caja, PlantillaFin, TipoPlantillaFin } from '../lib/types'
import { entidadDePlantilla, estadoRealPlantilla, operacionPlantilla, ETIQUETA_OPERACION, verificarPlantillasAplicadas, type ContextoPlan, type OperacionPlantilla } from '../lib/planificar'
import { nombreMes } from '../lib/plan'
import { formatMoney, toCents } from '../lib/money'
import { monthLabel } from '../lib/dates'
import { normName } from '../lib/orden'
import { mediosDeFuente, unirMedios } from '../lib/fuenteMedios'
import { ALCANCES_LISTA, opcionesAlcanceCombo, opcionesValor, type Alcance } from '../lib/alcance'
import { cajaLook, fuenteLook, medioLook, sortMedios } from '../lib/visual'
import { Combobox, type Opcion } from './Combobox'
import { MonthPicker } from './DatePicker'
import { MenuAcciones, type AccionMenu } from './MenuAcciones'
import { AsaOrden, AvisoOrden, CLASE_ARRASTRE, useReorden } from './reorden'
import { SwipeFila, useEsMovil } from './swipe'
import { Button, Checkbox, Empty, Field, inputCls, Modal, Segmented, Skeleton, Switch, claseBoton } from './ui'

export type InicioPlantillasFin =
  | { modo: 'lista' }
  | { modo: 'nueva'; origenId?: string; existente?: boolean }
  | { modo: 'editar'; id: string }

const AMOUNT = /^\d{1,9}([.,]\d{1,2})?$/
const nuevoId = () => `pf-${crypto.randomUUID()}`
const TXT = {
  fuente: { titulo: 'Fuentes mensuales', sub: 'Plantillas de tus fuentes habituales', una: 'fuente', Icon: CircleDollarSign, vacio: 'Aún no tienes plantillas de fuentes', ejemplo: 'General, Aporte de Pareja, Sodexo, Ingresos extras…' },
  subcaja: { titulo: 'Cajas mensuales', sub: 'Plantillas de tus cajas habituales', una: 'caja', Icon: Boxes, vacio: 'Aún no tienes plantillas de cajas', ejemplo: 'Servicios del Hogar, Auto, Bebé, Viaje…' },
} as const

/** Estado de una plantilla en un mes: Pendiente (sin decisión), Aplicada o No aplica este mes. */
export const estadoEnMes = (p: PlantillaFin, mes: string): 'pendiente' | 'aplicada' | 'omitida' => p.estados[mes]?.e ?? 'pendiente'

/**
 * Punto de entrada para el resto de la app: abrir el módulo y "Guardar como plantilla" desde un registro existente.
 * Si ya hay una plantilla vinculada a ese registro no se crea otra: se avisa y se ofrece verla o editarla.
 */
export function usePlantillasFin(store: AppStore, hoyMes: string) {
  const [ui, setUi] = useState<{ tipo: TipoPlantillaFin; inicio: InicioPlantillasFin; key: number; ctx?: ContextoPlan } | null>(null)
  const [yaExiste, setYaExiste] = useState<PlantillaFin | null>(null)
  /** `ctx` = se abrió desde «Prepara tu mes»: al terminar (o cerrar) se avisa al asistente para que recupere su contexto. */
  const abrir = (tipo: TipoPlantillaFin, inicio: InicioPlantillasFin = { modo: 'lista' }, ctx?: ContextoPlan) => setUi({ tipo, inicio, key: Date.now(), ctx })
  const guardarComoPlantilla = (tipo: TipoPlantillaFin, origenId: string) => {
    const ex = (store.data?.plantillasFin ?? []).find(p => p.tipo === tipo && p.origenId === origenId)
    if (ex) setYaExiste(ex); else abrir(tipo, { modo: 'nueva', origenId })
  }
  const nodo = (
    <>
      {ui && <PlantillasFinModal key={ui.key} store={store} tipo={ui.tipo} inicio={ui.inicio} hoyMes={ui.ctx?.mes ?? hoyMes} ctx={ui.ctx}
        onClose={() => { const c = ui.ctx; setUi(null); c?.onCerrar() }}
        onAplicado={r => { ui.ctx?.onAplicado(r) }}   // jamás cierra ni cambia el módulo abierto ahora: solo avisa al asistente
        onSegundoPlano={() => { const c = ui.ctx; setUi(null); c?.onIniciado?.() }} />}
      {yaExiste && (
        <Modal open onClose={() => setYaExiste(null)} size="sm" title="Ya existe una plantilla" icon={<Info className="size-5" />}
          footer={<>
            <Button variant="outline" onClick={() => setYaExiste(null)}>Cerrar</Button>
            <Button variant="soft" onClick={() => { const p = yaExiste; setYaExiste(null); abrir(p.tipo, { modo: 'lista' }) }}>Ver plantilla</Button>
            <Button onClick={() => { const p = yaExiste; setYaExiste(null); abrir(p.tipo, { modo: 'editar', id: p.id }) }}><Pencil className="size-4" /> Editar plantilla</Button>
          </>}>
          <p className="text-sm" data-testid="plantilla-ya-existe">Este registro ya tiene la plantilla <b>{yaExiste.nombre}</b>. No se creó otra: puedes verla o editarla.</p>
        </Modal>
      )}
    </>
  )
  return { abrir, guardarComoPlantilla, nodo }
}

/* ----------------------------- Efecto de aplicar (vista previa) ----------------------------- */

function efecto(p: PlantillaFin, mes: string, monto: number, data: AppData): { txt: string; cambia: boolean; op: OperacionPlantilla } {
  const ml = monthLabel(mes, true)
  const o = operacionPlantilla(p, mes, monto, data)
  const ent = entidadDePlantilla(p, data)
  const nombre = ent?.nombre ?? p.nombre
  if (p.tipo === 'fuente') {
    const m = (c: number) => formatMoney(c, p.moneda || 'PEN')
    if (!o.entidadExiste) return { op: o.op, cambia: true, txt: `Se creará la fuente “${p.nombre}” (${p.recurrencia === 'unica' ? `solo ${ml}` : `mensual desde ${ml}`}) con ${m(toCents(monto))} y su aplicación a ${ml}. No se duplica si ya existe.` }
    if (o.op === 'crear') return { op: o.op, cambia: true, txt: `La fuente ${nombre} ya existe, pero aún no está aplicada a ${ml}: se creará su aplicación mensual con ${m(toCents(monto))}.` }
    if (o.op === 'sin_cambios') return { op: o.op, cambia: false, txt: `Sin cambios: ${nombre} ya aporta ${m(o.actual ?? 0)} en ${ml}.` }
    return { op: o.op, cambia: true, txt: `Ajuste solo de ${ml}: ${m(o.actual ?? 0)} → ${m(toCents(monto))}. Otros meses no cambian.` }
  }
  const mon = data.config.moneda || 'PEN'
  if (!o.entidadExiste) return { op: o.op, cambia: true, txt: `Se creará la caja “${p.nombre}” con reserva de ${formatMoney(toCents(monto), mon)} en ${ml}. Reserva dinero ya existente; no lo crea.` }
  if (o.op === 'crear') return { op: o.op, cambia: true, txt: `La caja ${nombre} ya existe, pero aún no reserva en ${ml}: se creará su aplicación mensual con ${formatMoney(toCents(monto), mon)}.` }
  if (o.op === 'sin_cambios') return { op: o.op, cambia: false, txt: `Sin cambios: ${nombre} ya reserva ${formatMoney(o.actual ?? 0, mon)} en ${ml}.` }
  return { op: o.op, cambia: true, txt: `Reserva de ${ml}: ${formatMoney(o.actual ?? 0, mon)} → ${formatMoney(toCents(monto), mon)}. Otros meses no cambian.` }
}

const BADGE = {
  pendiente: { txt: 'Pendiente', fg: 'var(--warning)', bg: 'var(--warning-soft)' },
  aplicada: { txt: 'Aplicada', fg: 'var(--success)', bg: 'var(--success-soft)' },
  omitida: { txt: 'No aplica este mes', fg: '#64748B', bg: 'var(--bg)' },
  historica: { txt: 'Config. histórica', fg: 'var(--navy)', bg: 'var(--primary-soft)' },
} as const

/* ----------------------------------- Modal principal ----------------------------------- */

type Vista = { kind: 'lista' } | { kind: 'form'; plantilla: PlantillaFin | null; origenId?: string; existente?: boolean; clonDe?: PlantillaFin }

export function PlantillasFinModal({ store, tipo, inicio, hoyMes, onClose, ctx, onAplicado, onSegundoPlano }: {
  store: AppStore; tipo: TipoPlantillaFin; inicio: InicioPlantillasFin; hoyMes: string; onClose: () => void
  ctx?: ContextoPlan; onAplicado?: (r: { mes: string; n: number }) => void; onSegundoPlano?: () => void
}) {
  const data = store.data
  const T = TXT[tipo]
  const [vista, setVista] = useState<Vista>(() => {
    if (inicio.modo === 'nueva') return { kind: 'form', plantilla: null, origenId: inicio.origenId, existente: inicio.existente }
    if (inicio.modo === 'editar') { const p = (data?.plantillasFin ?? []).find(x => x.id === inicio.id); if (p) return { kind: 'form', plantilla: p } }
    return { kind: 'lista' }
  })
  const [borrar, setBorrar] = useState<PlantillaFin | null>(null)
  const todas = useMemo(() => [...(data?.plantillasFin ?? [])].filter(p => p.tipo === tipo).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)), [data?.plantillasFin, tipo])

  if (!data) return <Modal open onClose={onClose} title={T.titulo} icon={<T.Icon className="size-5" />}><Skeleton className="h-40" /></Modal>

  if (vista.kind === 'form') {
    return (
      <Modal open onClose={onClose} size="lg" title={vista.plantilla ? 'Editar plantilla' : vista.clonDe ? 'Clonar plantilla' : `Nueva plantilla de ${T.una}`} icon={<T.Icon className="size-5" />}
        subtitle="Solo guarda una configuración reutilizable: no crea dinero, fuentes, cajas ni gastos."
        footer={<>
          <Button type="button" variant="outline" onClick={() => setVista({ kind: 'lista' })}><ArrowLeft className="size-4" /> Volver</Button>
          <Button type="submit" form="plantilla-fin-form"><Save className="size-4" /> {vista.plantilla ? 'Guardar cambios' : 'Guardar plantilla'}</Button>
        </>}>
        <PlantillaFinForm store={store} tipo={tipo} plantilla={vista.plantilla} origenId={vista.origenId} existente={vista.existente} clonDe={vista.clonDe} todas={todas}
          onEditar={p => setVista({ kind: 'form', plantilla: p })} onDone={() => setVista({ kind: 'lista' })} />
      </Modal>
    )
  }
  return (
    <>
      <ListaPlantillas store={store} tipo={tipo} items={todas} hoyMes={hoyMes} onClose={onClose} ctx={ctx} onAplicado={onAplicado} onSegundoPlano={onSegundoPlano}
        onForm={(plantilla, extra) => setVista({ kind: 'form', plantilla, ...extra })} onBorrar={setBorrar} />
      {borrar && (
        <Modal open onClose={() => setBorrar(null)} size="sm" title="Eliminar plantilla" icon={<Trash2 className="size-5" />}
          footer={<>
            <Button variant="outline" onClick={() => setBorrar(null)}>Cancelar</Button>
            <Button variant="danger" disabled={store.pending.has(`pf:${borrar.id}`)} onClick={() => {
              const p = borrar
              const ok = store.track(`pf:${p.id}`, { pending: `Eliminando ${p.nombre}…`, ok: `Plantilla ${p.nombre} eliminada.`, error: `No se pudo eliminar ${p.nombre}.` }, () => store.actions.deletePlantillaFin(p.id))
              if (ok) setBorrar(null)
            }}><Trash2 className="size-4" /> Eliminar</Button>
          </>}>
          <p className="text-sm" data-testid="eliminar-plantilla-fin">Se eliminará solo la plantilla <b>{borrar.nombre}</b>. {borrar.tipo === 'fuente' ? 'La fuente' : 'La caja'} original, los importes ya aplicados en meses y los gastos no cambian.</p>
        </Modal>
      )}
    </>
  )
}

/* ------------------------------------- Lista ------------------------------------- */

function ListaPlantillas({ store, tipo, items, hoyMes, onClose, ctx, onAplicado, onSegundoPlano, onForm, onBorrar }: {
  store: AppStore; tipo: TipoPlantillaFin; items: PlantillaFin[]; hoyMes: string; onClose: () => void
  ctx?: ContextoPlan; onAplicado?: (r: { mes: string; n: number }) => void; onSegundoPlano?: () => void
  onForm: (p: PlantillaFin | null, extra?: { origenId?: string; existente?: boolean; clonDe?: PlantillaFin }) => void; onBorrar: (p: PlantillaFin) => void
}) {
  const data = store.data!
  const T = TXT[tipo]
  const movil = useEsMovil()
  const [mes, setMes] = useState(hoyMes)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string[]>([])
  const [valores, setValores] = useState<Record<string, string>>({})
  const [detalle, setDetalle] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [errorAplicar, setErrorAplicar] = useState<string | null>(null)
  const monedaPrincipal = data.config.moneda || 'PEN'
  const term = normName(q)
  const visibles = items.filter(p => !term || normName(`${p.nombre} ${p.medios} ${p.valor}`).includes(term))
  const puedeOrdenar = !term && items.length > 1
  const dnd = useReorden({
    ids: items.map(p => p.id), habilitado: puedeOrdenar, nombre: id => items.find(p => p.id === id)?.nombre ?? 'Plantilla',
    onCommit: ids => { store.track(`pf:orden:${tipo}`, { pending: 'Guardando el orden…', ok: 'Orden guardado.', error: 'No se pudo guardar el orden.' }, () => store.actions.reorderPlantillasFin(tipo, ids)) },
  })
  const porId = new Map(visibles.map(p => [p.id, p]))
  const filas = (puedeOrdenar ? dnd.orden : visibles.map(p => p.id)).map(id => porId.get(id)).filter((p): p is PlantillaFin => !!p)

  const montoDe = (p: PlantillaFin) => {
    if (valores[p.id] !== undefined) return valores[p.id]
    const real = estadoRealPlantilla(p, mes, data)
    if (real === 'aplicada' || real === 'historica') { const o = operacionPlantilla(p, mes, p.monto, data); if (o.actual !== null) return String(o.actual / 100) }
    return String(p.estados[mes]?.e === 'aplicada' ? p.estados[mes].m : p.monto)
  }
  const valido = (p: PlantillaFin) => AMOUNT.test(montoDe(p).trim()) && Number(montoDe(p).replace(',', '.')) >= 0
  const numero = (p: PlantillaFin) => Number(montoDe(p).replace(',', '.'))
  const moneda = (p: PlantillaFin) => (p.tipo === 'fuente' ? p.moneda || 'PEN' : monedaPrincipal)
  const elegidas = items.filter(p => sel.includes(p.id))
  const totales = new Map<string, number>()
  for (const p of elegidas) if (valido(p)) totales.set(moneda(p), (totales.get(moneda(p)) ?? 0) + toCents(numero(p)))
  const mesLabel = monthLabel(mes, true)

  type CbAplicar = (ok: boolean, error?: string) => void
  const aplicar = (ps: PlantillaFin[], accion: 'aplicar' | 'omitir' | 'pendiente' = 'aplicar', cb?: CbAplicar) => {
    if (accion === 'aplicar') {
      const malas = ps.filter(p => !valido(p))
      if (malas.length) { setErrores(Object.fromEntries(malas.map(p => [p.id, 'Monto inválido']))); return false }
    }
    setErrores({}); setErrorAplicar(null)
    const n = ps.length
    const verbo = accion === 'aplicar' ? 'aplicada' : accion === 'omitir' ? 'marcada como “No aplica este mes”' : 'devuelta a Pendiente'
    const pedidas = ps.map(p => ({ plantilla: p, monto: numero(p) }))
    return store.track(`pf:aplicar:${tipo}:${mes}:${accion}:${ps.map(p => p.id).join(',')}`,
      { pending: accion === 'aplicar' ? `Aplicando ${n} plantilla${n === 1 ? '' : 's'} a ${mesLabel}…` : 'Guardando…', ok: `${n} plantilla${n === 1 ? '' : 's'} ${verbo}${n === 1 ? '' : 's'} en ${mesLabel}.`.replace('ass ', 'as '), error: 'No se pudo confirmar la operación. Puedes reintentar sin riesgo de duplicar nada.' },
      async () => {
        const r = await store.actions.aplicarPlantillasFin(mes, ps.map(p => ({ id: p.id, accion, ...(accion === 'aplicar' ? { monto: numero(p) } : {}) })))
        if (accion === 'aplicar') {
          // Verificación contra la relectura de Sheets: no se da por aplicado lo que no quedó guardado.
          const problemas = verificarPlantillasAplicadas({ ...data, ...r.datos }, pedidas.map(x => ({ plantilla: r.plantillas.find(y => y.id === x.plantilla.id) ?? x.plantilla, monto: x.monto })), mes)
          if (problemas.length) throw new Error(`No se pudo verificar lo guardado en Google Sheets. ${problemas.join(' ')}`)
        }
        setValores(v => { const x = { ...v }; ps.forEach(p => delete x[p.id]); return x })
        if (accion === 'aplicar') setSel(s => s.filter(id => !ps.some(p => p.id === id)))
      }, { onDone: (ok, error) => { if (!ok) setErrorAplicar(error ?? 'No se pudo confirmar la operación.'); cb?.(ok, error) } })
  }
  /**
   * Segundo plano: si se abrió desde «Prepara tu mes», el módulo se cierra al instante y el asistente sigue visible con la etapa «En progreso»;
   * el guardado continúa en el store (toast de progreso) y, al confirmarse y verificarse en Sheets, la etapa pasa a «Completada».
   * Si falla no queda nada aplicado: la etapa muestra Error y el aviso ofrece «Reintentar».
   */
  const enPlan = !!ctx && ctx.mes === mes
  const lanzar = (ps: PlantillaFin[]) => {
    if (!enPlan) { aplicar(ps, 'aplicar'); return }
    onSegundoPlano?.()
    const ejecutar = (): void => { aplicar(ps, 'aplicar', (ok, err) => { if (ok) onAplicado?.({ mes, n: ps.length }); else ctx?.onFallo?.(err ?? 'No se pudo confirmar la operación.', ejecutar) }) }
    ejecutar()
  }
  const aplicarFila = (ps: PlantillaFin[]) => lanzar(ps)
  // Mientras se guarda no se cierra el módulo (Escape, X o clic fuera): evita perder el resultado de un guardado crítico.
  const cerrar = () => onClose()

  const alternarActiva = (p: PlantillaFin) => store.track(`pf:${p.id}`, { pending: 'Guardando…', ok: `${p.nombre} ${p.activo ? 'desactivada' : 'activada'}.`, error: 'No se pudo cambiar el estado.' },
    () => store.actions.savePlantillaFin({ ...p, medios: p.medios, activo: !p.activo }))

  const accionesFila = (p: PlantillaFin): AccionMenu[] => [
    { key: 'edit', label: 'Editar', icon: <Pencil className="size-4" />, onClick: () => onForm(p) },
    { key: 'clone', label: 'Clonar', icon: <Copy className="size-4" />, onClick: () => onForm(null, { clonDe: p }) },
    { key: 'delete', label: 'Eliminar', icon: <Trash2 className="size-4" />, onClick: () => onBorrar(p), danger: true },
  ]
  const accionesEstado = (p: PlantillaFin): AccionMenu[] => {
    const e = estadoRealPlantilla(p, mes, data)
    return [
      { key: 'apply', label: e === 'aplicada' ? 'Actualizar importe' : 'Aplicar', icon: <Check className="size-3.5" />, onClick: () => aplicarFila([p]), disabled: !p.activo },
      { key: 'omit', label: 'No aplica este mes', icon: <Ban className="size-3.5" />, onClick: () => aplicar([p], 'omitir'), disabled: e === 'omitida' },
      { key: 'pend', label: 'Volver a Pendiente', icon: <RotateCcw className="size-3.5" />, onClick: () => aplicar([p], 'pendiente'), disabled: e === 'pendiente' },
      { key: 'toggle', label: p.activo ? 'Desactivar plantilla' : 'Activar plantilla', icon: <Power className="size-3.5" />, onClick: () => alternarActiva(p) },
    ]
  }

  const n = elegidas.length
  const enviando = [...store.pending].some(k => k.startsWith(`pf:aplicar:${tipo}:`))
  const todasSel = filas.length > 0 && filas.every(p => sel.includes(p.id))
  const previa = elegidas.filter(valido).map(p => ({ p, monto: numero(p), ...efecto(p, mes, numero(p), data) }))

  const Resumen = (
    <ol className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-line bg-card p-2 text-xs" aria-label="Detalle de lo que se aplicará">
      {previa.map(({ p, monto, txt, op }) => (
        <li key={p.id} className="space-y-0.5 border-b border-line/60 pb-1 last:border-0 last:pb-0" data-operacion={op}>
          <p className="flex justify-between gap-3"><span className="truncate font-medium">{p.nombre} <span className="ml-1 rounded-full bg-bg px-1.5 py-0.5 text-[10px] font-semibold text-muted" data-testid="pf-operacion">{ETIQUETA_OPERACION[op]}</span></span><span className="tabular shrink-0 font-semibold">{formatMoney(toCents(monto), moneda(p))}</span></p>
          <p className="text-muted">{txt}</p>
        </li>
      ))}
    </ol>
  )

  return (
    <Modal open onClose={cerrar} size="xl" title={T.titulo} subtitle={ctx ? `${T.sub}. Aplicando a ${nombreMes(mes)} desde «Prepara tu mes».` : `${T.sub}. Aplica cada una al mes que elijas.`} icon={<T.Icon className="size-5" />}
      footer={
        <div className="w-full space-y-2" data-testid="pf-footer">
          {detalle && n > 0 && Resumen}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
              <p className="text-xs text-muted" aria-live="polite"><b className="text-ink">{n}</b> plantilla{n === 1 ? '' : 's'} seleccionada{n === 1 ? '' : 's'} · {mesLabel}</p>
              <p className="tabular flex flex-wrap gap-x-3 text-base font-bold text-ink" data-testid="pf-totales">
                {totales.size ? [...totales].map(([m, c]) => <span key={m} className="whitespace-nowrap">Total {m}: {formatMoney(c, m)}</span>) : <span className="font-medium text-muted">Total: —</span>}
              </p>
            </div>
            <Button variant="ghost" className="px-2 text-xs" disabled={!n} onClick={() => setDetalle(d => !d)} aria-expanded={detalle}>
              {detalle ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />} {detalle ? 'Ocultar detalle' : 'Ver detalle'}
            </Button>
            <Button className="ml-auto" disabled={!n || enviando} onClick={() => { const malas = elegidas.filter(p => !valido(p)); if (malas.length) setErrores(Object.fromEntries(malas.map(p => [p.id, 'Monto inválido']))); else setConfirmar(true) }}>
              {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Aplicar {n} a {mesLabel}
            </Button>
          </div>
        </div>
      }>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          {ctx ? (
            <p className="rounded-xl bg-primary-soft px-3 py-2 text-xs font-semibold text-navy" data-testid="pf-mes-plan">Mes de la planificación: {nombreMes(ctx.mes)}</p>
          ) : (
            <Field label="Mes a aplicar" htmlFor="pf-mes">
              <div className="w-48"><MonthPicker id="pf-mes" value={mes} onChange={v => { setMes(v); setValores({}); setErrores({}) }} today={`${hoyMes}-01`} label="Mes a aplicar" /></div>
            </Field>
          )}
          <MenuAcciones label="Nueva plantilla" ancho={270}
            triggerClass={claseBoton('primary')}
            trigger={<><Plus className="size-4" /> Nueva plantilla <ChevronDown className="size-4" /></>}
            acciones={[
              { key: 'cero', label: 'Crear desde cero', icon: <Plus className="size-4" />, onClick: () => onForm(null) },
              { key: 'existente', label: `Crear desde ${tipo === 'fuente' ? 'una fuente' : 'una caja'} existente`, icon: <Copy className="size-4" />, onClick: () => onForm(null, { existente: true }) },
            ]} />
        </div>
        {items.length > 4 && (
          <label className="relative block">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" />
            <input aria-label="Buscar plantilla" className={`${inputCls} pl-9`} placeholder="Buscar plantilla…" value={q} onChange={e => setQ(e.target.value)} />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <ListChecks className="size-4 text-muted" />
          <button type="button" className="rounded-lg px-2 py-1 font-medium text-navy hover:bg-primary-soft" onClick={() => setSel(s => todasSel ? s.filter(id => !filas.some(p => p.id === id)) : [...new Set([...s, ...filas.filter(p => p.activo).map(p => p.id)])])}>{todasSel ? 'Quitar selección' : `Seleccionar ${term ? 'visibles' : 'todas'} (${filas.filter(p => p.activo).length})`}</button>
          <button type="button" className="rounded-lg px-2 py-1 font-medium text-navy hover:bg-primary-soft" onClick={() => setSel(items.filter(p => p.activo && estadoRealPlantilla(p, mes, data) === 'pendiente').map(p => p.id))}>Solo pendientes</button>
          <span className="ml-auto text-[11px] text-muted">{puedeOrdenar ? 'Arrastra ⠿ para ordenar.' : term ? 'Quita la búsqueda para reordenar.' : ''}</span>
        </div>
        <AvisoOrden texto={dnd.aviso} />

        {items.length === 0 ? (
          <Empty icon={<T.Icon className="size-5" />} title={T.vacio}>
            Guarda tus {T.una}s habituales ({T.ejemplo}) y aplícalas a cada mes en segundos. También puedes usar “Guardar como plantilla” desde el menú ⋯ de una {T.una} existente.
          </Empty>
        ) : !filas.length ? <Empty icon={<Search className="size-5" />} title="Sin coincidencias">Prueba con otra palabra.</Empty> : (
          <ul aria-label={`Plantillas de ${T.una}s`} className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line" data-testid="pf-lista">
            {filas.map(p => {
              const look = p.tipo === 'fuente' ? fuenteLook({ nombre: p.nombre, medioPago: p.medios, icono: p.icono, color: p.color }) : cajaLook({ filtroCampo: p.campo as Caja['filtroCampo'], filtroValor: p.valor, color: p.color, icono: p.icono }, data.catalogo)
              const e = estadoRealPlantilla(p, mes, data)
              const b = BADGE[e]
              const busy = store.pending.has(`pf:${p.id}`)
              const on = sel.includes(p.id)
              const sub = p.tipo === 'fuente'
                ? `${p.recurrencia === 'unica' ? 'Un solo mes' : 'Mensual'}${mediosDeFuente(p.medios).length ? ` · ${mediosDeFuente(p.medios).join(', ')}` : ''}${p.origenId ? '' : ' · sin fuente aún'}`
                : `${p.campo}: ${p.valor.replace(' › ', ' › ')}${p.origenId ? '' : ' · sin caja aún'}`
              return (
                <li key={p.id} {...dnd.item(p.id)} data-testid="pf-fila" data-estado={e} className={`${CLASE_ARRASTRE} border border-transparent ${on ? 'bg-primary-soft/40' : ''} ${p.activo ? '' : 'opacity-70'}`}>
                  <SwipeFila nombre={p.nombre} acciones={accionesFila(p)} activo={movil}>
                    <div className="grid grid-cols-[1.75rem_1.5rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 px-2 py-2.5 md:grid-cols-[1.75rem_1.5rem_minmax(0,1fr)_9.5rem_8.5rem_5.5rem_2.5rem] md:py-2">
                      <div className="col-start-1 row-start-1"><AsaOrden {...dnd.asa(p.id)} habilitado={puedeOrdenar} motivo="Quita la búsqueda para reordenar" /></div>
                      <div className="col-start-2 row-start-1"><Checkbox label={`Seleccionar ${p.nombre}`} checked={on} onChange={() => setSel(s => on ? s.filter(x => x !== p.id) : [...s, p.id])} disabled={!p.activo && !on} color={look.color} /></div>
                      <div className="col-start-3 row-start-1 flex min-w-0 items-center gap-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: `${look.color}1F`, color: look.color }}><look.Icon className="size-4" /></span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold" data-testid="pf-nombre">{p.nombre}{!p.activo && <span className="ml-1.5 text-[10px] font-normal text-muted">Inactiva</span>}{busy && <span className="ml-1.5 text-[10px] font-normal text-muted">Guardando…</span>}</p>
                          <p className="truncate text-[11px] text-muted">{sub}</p>
                        </div>
                      </div>
                      <div className="col-start-4 row-start-1 md:col-start-6">
                        <Button variant={e === 'aplicada' ? 'outline' : 'primary'} className="h-10 px-3 text-sm md:h-8 md:px-2.5 md:text-xs" disabled={!p.activo || busy || (e === 'aplicada' && valores[p.id] === undefined)}
                          aria-label={`${e === 'aplicada' ? 'Actualizar' : 'Aplicar'} ${p.nombre} a ${mesLabel}`} onClick={() => aplicarFila([p])}>
                          {e === 'aplicada' ? (valores[p.id] === undefined ? <><Check className="size-4" /> Lista</> : 'Actualizar') : 'Aplicar'}
                        </Button>
                      </div>
                      <div className="col-start-3 row-start-2 min-w-0 md:col-start-4 md:row-start-1">
                        <MenuAcciones label={`Estado de ${p.nombre}: ${b.txt}`} ancho={220} acciones={accionesEstado(p)}
                          triggerClass="inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold" triggerStyle={{ color: b.fg, background: b.bg }}
                          trigger={<><span data-testid="pf-estado" className="truncate">{b.txt}</span><ChevronDown className="size-3 shrink-0" /></>} />
                      </div>
                      <label className="relative col-start-4 row-start-2 block w-28 md:col-start-5 md:row-start-1 md:w-auto">
                        <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-muted">{moneda(p) === 'PEN' ? 'S/' : moneda(p) === 'USD' ? 'US$' : moneda(p)}</span>
                        <input aria-label={`Monto de ${p.nombre}`} inputMode="decimal" value={montoDe(p)} placeholder="0.00" disabled={!p.activo}
                          onChange={ev => { setValores(v => ({ ...v, [p.id]: ev.target.value.replace(/[^\d.,]/g, '') })); setErrores(x => { const y = { ...x }; delete y[p.id]; return y }) }}
                          className={`tabular h-10 w-full rounded-lg border bg-card pr-2 pl-8 text-right text-base outline-none focus:border-navy md:h-8 md:text-sm ${errores[p.id] ? 'border-danger' : valores[p.id] !== undefined ? 'border-navy/50' : 'border-line'}`} />
                      </label>
                      <div className="hidden md:col-start-7 md:row-start-1 md:block">
                        <MenuAcciones label={`Más acciones de la plantilla ${p.nombre}`} acciones={accionesFila(p)} />
                      </div>
                      {errores[p.id] && <p className="col-span-4 text-[11px] font-medium text-danger md:col-span-7" role="alert">{errores[p.id]}</p>}
                    </div>
                  </SwipeFila>
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-[11px] text-muted">
          {tipo === 'fuente'
            ? 'Cambiar el importe aquí solo afecta al mes elegido: el importe predeterminado de la plantilla (y de la fuente) se conserva para los demás meses. Nunca se crean ingresos ni gastos.'
            : 'Una caja no crea dinero: solo reserva parte del presupuesto existente. Cambiar el importe aquí solo afecta al mes elegido; la plantilla conserva su valor para los demás.'}
        </p>
      </div>

      {confirmar && (
        <Modal open onClose={() => { setConfirmar(false); setErrorAplicar(null) }} size="md" title={`Aplicar a ${mesLabel}`} icon={<CalendarDays className="size-5" />}
          footer={<>
            <Button variant="outline" disabled={enviando} onClick={() => { setConfirmar(false); setErrorAplicar(null) }}>Cancelar</Button>
            <Button disabled={enviando} onClick={() => { setConfirmar(false); lanzar(elegidas) }}><Check className="size-4" /> Confirmar y aplicar</Button>
          </>}>
          <div className="space-y-2" data-testid="pf-vista-previa">
            <p className="text-sm">Vista previa de lo que se escribirá. Solo cambia <b>{mesLabel}</b>; volver a aplicar no duplica nada.</p>
            {Resumen}
            {errorAplicar && <p className="rounded-xl px-3 py-2 text-xs font-medium" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }} role="alert" data-testid="pf-error-aplicar">{errorAplicar}</p>}
          </div>
        </Modal>
      )}
    </Modal>
  )
}

/* ------------------------------------ Formulario ------------------------------------ */

function PlantillaFinForm({ store, tipo, plantilla, origenId, existente, clonDe, todas, onEditar, onDone }: {
  store: AppStore; tipo: TipoPlantillaFin; plantilla: PlantillaFin | null; origenId?: string; existente?: boolean; clonDe?: PlantillaFin; todas: PlantillaFin[]
  onEditar: (p: PlantillaFin) => void; onDone: () => void
}) {
  const data = store.data!
  const base = plantilla ?? clonDe ?? null
  const [id] = useState(() => plantilla?.id ?? nuevoId())
  const fuentes = data.fuentes ?? []
  const medios = useMemo(() => sortMedios(data.medios.filter(m => m.activo).map(m => m.nombre)), [data.medios])
  const monedas = (data.config.monedas || 'PEN,USD').split(',').map(s => s.trim()).filter(Boolean)
  const [origen, setOrigen] = useState(plantilla?.origenId ?? origenId ?? '')
  const [desdeExistente, setDesdeExistente] = useState(!!existente || !!origenId)
  const [nombre, setNombre] = useState(base ? (clonDe ? `${clonDe.nombre.slice(0, 31)} (Copia)` : base.nombre) : '')
  const [monto, setMonto] = useState(base ? String(base.monto) : '')
  const [moneda, setMoneda] = useState(base?.moneda || data.config.moneda || 'PEN')
  const [elegidos, setElegidos] = useState<string[]>(base ? mediosDeFuente(base.medios) : [])
  const [recurrencia, setRecurrencia] = useState<'mensual' | 'unica'>(base?.recurrencia ?? 'mensual')
  const [campo, setCampo] = useState<Alcance>((base?.campo as Alcance) || 'Categoría')
  const [valor, setValor] = useState(base?.valor ?? '')
  const [descripcion, setDescripcion] = useState(base?.descripcion ?? '')
  const [activo, setActivo] = useState(base ? base.activo : true)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Rellena desde una fuente/subcaja existente (editable antes de guardar).
  function cargarDesde(oid: string) {
    setOrigen(oid)
    setErrors({})
    if (tipo === 'fuente') {
      const f = fuentes.find(x => x.id === oid)
      if (!f) return
      setNombre(f.nombre); setMonto(String(f.monto)); setMoneda(f.moneda); setElegidos(mediosDeFuente(f.medioPago)); setRecurrencia(f.recurrencia)
    } else {
      const c = data.cajas.find(x => x.id === oid)
      if (!c) return
      setNombre(c.nombre); setMonto(String(c.presupuesto)); setCampo(c.filtroCampo as Alcance); setValor(c.filtroValor); setDescripcion(c.descripcion ?? '')
    }
  }
  useEffect(() => { if (origenId && !plantilla) cargarDesde(origenId) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const yaVinculada = origen ? todas.find(p => p.origenId === origen && p.id !== id) : undefined
  const entidades = tipo === 'fuente' ? fuentes.map(f => ({ id: f.id, nombre: f.nombre, look: fuenteLook(f, fuentes) })) : data.cajas.filter(c => c.filtroCampo !== 'Todos').map(c => ({ id: c.id, nombre: c.nombre, look: cajaLook(c, data.catalogo) }))
  const opcionesExistente: Opcion[] = entidades.map(x => ({ value: x.id, label: x.nombre, Icon: x.look.Icon, color: x.look.color, hint: todas.some(p => p.origenId === x.id) ? 'Ya tiene plantilla' : undefined }))
  const valores = useMemo(() => { const xs = opcionesValor(campo, data.catalogo, medios); return valor && !xs.includes(valor) ? [valor, ...xs] : xs }, [campo, data.catalogo, medios, valor])
  const opcionesCombo = useMemo(() => opcionesAlcanceCombo(valores, campo, data.catalogo), [valores, campo, data.catalogo])
  const mediosOpc = useMemo(() => medios.filter(m => !elegidos.some(e => normName(e) === normName(m))).map(m => { const l = medioLook(m); return { value: m, label: m, Icon: l.Icon, color: l.color } as Opcion }), [medios, elegidos])

  function save() {
    const errs: Record<string, string> = {}
    const n = Number(monto.replace(',', '.'))
    if (!nombre.trim()) errs.nombre = 'Escribe un nombre.'
    else if (todas.some(p => p.id !== id && normName(p.nombre) === normName(nombre))) errs.nombre = `Ya existe una plantilla llamada “${nombre.trim()}”.`
    if (!AMOUNT.test(monto.trim()) || !(n >= 0)) errs.monto = 'Ingresa un monto válido (puede ser 0).'
    if (tipo === 'subcaja' && !valor) errs.valor = 'Elige el valor del alcance.'
    if (yaVinculada) errs.origen = `Ya existe la plantilla “${yaVinculada.nombre}” para este registro.`
    setErrors(errs)
    if (Object.keys(errs).length) return
    const input: PlantillaFinInput = {
      id, tipo, nombre: nombre.trim(), monto: n, moneda: tipo === 'fuente' ? moneda : '', medios: tipo === 'fuente' ? unirMedios(elegidos) : '',
      campo: tipo === 'subcaja' ? campo : '', valor: tipo === 'subcaja' ? valor : '', descripcion: formatearDescripcion(descripcion),
      color: base?.color ?? (origen ? (tipo === 'fuente' ? fuentes.find(f => f.id === origen)?.color : data.cajas.find(c => c.id === origen)?.color) : undefined) ?? '#1e3a8a',
      icono: base?.icono ?? (origen ? (tipo === 'fuente' ? fuentes.find(f => f.id === origen)?.icono : data.cajas.find(c => c.id === origen)?.icono) : undefined) ?? '',
      recurrencia: tipo === 'fuente' ? recurrencia : 'mensual', activo, orden: plantilla?.orden ?? 0, origenId: clonDe ? '' : origen,
    }
    const ok = store.track(`pf:${id}`, { pending: 'Guardando la plantilla…', ok: `Plantilla ${input.nombre} guardada.`, error: 'No se pudo guardar la plantilla.' }, () => store.actions.savePlantillaFin(plantilla ? input : { ...input, orden: undefined }))
    if (ok) onDone()
  }

  return (
    <form id="plantilla-fin-form" className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); save() }}>
      {!plantilla && !clonDe && (
        <div className="space-y-2 rounded-xl bg-bg/70 p-3">
          <Segmented label="Origen de la plantilla" value={desdeExistente ? 'existente' : 'cero'} onChange={v => { setDesdeExistente(v === 'existente'); if (v === 'cero') setOrigen('') }}
            options={[{ value: 'cero', label: 'Desde cero' }, { value: 'existente', label: `Desde ${tipo === 'fuente' ? 'una fuente' : 'una caja'} existente` }]} />
          {desdeExistente && (
            <Field label={`${tipo === 'fuente' ? 'Fuente' : 'Caja'} existente`} htmlFor="pf-origen" error={errors.origen}>
              <Combobox id="pf-origen" label={`${tipo === 'fuente' ? 'Fuente' : 'Caja'} existente`} value={origen} onChange={cargarDesde} searchable options={opcionesExistente} placeholder="Busca y elige…" vacio="No hay registros." />
            </Field>
          )}
          {yaVinculada && (
            <p className="flex flex-wrap items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning" role="alert" data-testid="pf-ya-vinculada">
              <AlertTriangle className="size-4 shrink-0" /> <span className="min-w-0 flex-1">Ya existe la plantilla <b>{yaVinculada.nombre}</b> vinculada a este registro. No se creará otra.</span>
              <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => onEditar(yaVinculada)}>Editar plantilla</Button>
            </p>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre" htmlFor="pf-nombre" error={errors.nombre}>
          <input id="pf-nombre" className={`${inputCls} ${errors.nombre ? 'border-danger' : ''}`} maxLength={40} value={nombre} onChange={e => setNombre(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={tipo === 'fuente' ? 'Monto predeterminado' : 'Presupuesto predeterminado'} htmlFor="pf-monto" error={errors.monto}>
          <input id="pf-monto" className={`${inputCls} tabular text-right ${errors.monto ? 'border-danger' : ''}`} inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0.00" autoComplete="off" />
        </Field>
      </div>
      {tipo === 'fuente' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Moneda" htmlFor="pf-moneda"><Combobox id="pf-moneda" label="Moneda" value={moneda} onChange={setMoneda} options={[...new Set([...monedas, moneda])].map(m => ({ value: m, label: m }))} /></Field>
            <Field label="Recurrencia">
              <Segmented label="Recurrencia" value={recurrencia} onChange={setRecurrencia} options={[{ value: 'mensual', label: 'Todos los meses' }, { value: 'unica', label: 'Un solo mes' }]} />
            </Field>
          </div>
          <Field label="Medios de pago asociados (opcional)" htmlFor="pf-medio" hint="Los gastos pagados con esos medios se atribuyen a la fuente. El importe no se divide entre medios.">
            <div className="space-y-2">
              <ul className="flex flex-wrap gap-1.5" aria-label="Medios elegidos" data-testid="pf-medios">
                {!elegidos.length && <li className="rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-muted">Ninguno (fuente libre)</li>}
                {elegidos.map(m => { const l = medioLook(m); return (
                  <li key={m} className="flex items-center gap-1.5 rounded-full py-1 pr-1 pl-2 text-xs font-medium" style={{ background: `${l.color}1A`, color: l.color }}>
                    <l.Icon className="size-3.5" />{m}
                    <button type="button" aria-label={`Quitar ${m}`} onClick={() => setElegidos(xs => xs.filter(x => x !== m))} className="grid size-5 place-items-center rounded-full hover:bg-black/10"><X className="size-3" /></button>
                  </li>) })}
              </ul>
              <Combobox id="pf-medio" label="Agregar medio de pago" value="" onChange={v => setElegidos(xs => [...xs, v])} placeholder="Agregar medio de pago…" options={mediosOpc} vacio="No hay más medios." />
            </div>
          </Field>
        </>
      ) : (
        <>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Alcance</p>
            <Segmented label="Alcance" value={campo} onChange={v => { setCampo(v); setValor('') }} options={ALCANCES_LISTA.map(a => ({ value: a, label: a }))} />
          </div>
          <Field label={`Valor (${campo.toLowerCase()})`} htmlFor="pf-valor" error={errors.valor}>
            <Combobox id="pf-valor" label={`Valor (${campo.toLowerCase()})`} value={valor} onChange={setValor} invalid={!!errors.valor} placeholder="Elige…" descEnTrigger searchable={valores.length > 6} maxHeight={320} options={opcionesCombo} vacio="Sin opciones activas en el catálogo." />
          </Field>
        </>
      )}
      <Field label="Descripción (opcional)" htmlFor="pf-desc">
        <input id="pf-desc" className={inputCls} maxLength={200} value={descripcion} onChange={e => setDescripcion(e.target.value)} onBlur={() => setDescripcion(formatearDescripcion(descripcion))} autoComplete="off" />
      </Field>
      <Switch checked={activo} onChange={setActivo} label="Plantilla activa" />
      {clonDe && <p className="text-[11px] text-muted">Se creará una plantilla nueva (ID nuevo, sin vínculo). La original no cambia y no se copia ningún movimiento.</p>}
    </form>
  )
}

