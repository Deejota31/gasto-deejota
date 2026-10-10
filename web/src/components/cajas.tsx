import { useState } from 'react'
import {
  Baby, Bike, Briefcase, Bus, Car, Cloud, Gamepad2, GraduationCap, HeartPulse, House, Plane, ShoppingBag, Siren, Smartphone, Tv, Users, Utensils, Wallet,
} from 'lucide-react'
import { monthLabel } from '../lib/dates'
import type { CajasResumen } from '../lib/engine'
import type { AppStore } from '../lib/store'
import type { Caja } from '../lib/types'
import { Button, ErrorBox, Field, inputCls, Modal, Switch } from './ui'

/** Piezas compartidas de cajas (Dashboard y pestaña Cajas). */

const CAJA_STYLE: Record<string, { bg: string; fg: string }> = {
  auto: { bg: 'linear-gradient(135deg, #F1F5F9, #E2E8F0)', fg: '#475569' },
  bebe: { bg: 'linear-gradient(135deg, #FDF0F6, #FCE1EE)', fg: '#C2457F' },
  nube: { bg: 'linear-gradient(135deg, #F4F1FF, #E9E3FF)', fg: '#6D5BD0' },
}
export const styleFor = (c: Caja) => {
  const k = `${c.id} ${c.filtroValor}`.toLowerCase()
  return k.includes('auto') ? CAJA_STYLE.auto : k.includes('beb') ? CAJA_STYLE.bebe : k.includes('nube') ? CAJA_STYLE.nube : { bg: `linear-gradient(135deg, ${c.color}14, ${c.color}29)`, fg: c.color }
}

const ICONOS: [RegExp, typeof Wallet][] = [
  [/auto|carro|gasolina/, Car], [/beb|infantil|pañal/, Baby], [/nube/, Cloud], [/salud|médic|medic|farmac/, HeartPulse],
  [/transporte|taxi|bus/, Bus], [/stream|netflix|suscrip|spotify/, Tv], [/familia|pareja|amigos/, Users], [/celular|línea|linea|internet/, Smartphone],
  [/delivery|moto/, Bike], [/viaje|vuelo/, Plane], [/educ|maestr|curso/, GraduationCap], [/emergencia|imprevist/, Siren], [/sodexo|alimenta|comida|restaur/, Utensils],
  [/hogar|casa/, House], [/compras|ropa/, ShoppingBag], [/trabajo/, Briefcase], [/juego|salida/, Gamepad2],
]
export const cajaIcon = (c: Caja) => {
  const k = `${c.id} ${c.nombre} ${c.filtroValor}`.toLowerCase()
  return ICONOS.find(([re]) => re.test(k))?.[1] ?? Wallet
}

export function CajaModal({ store, target, cajas, mes, money, onClose }: {
  store: AppStore; target: { caja: Caja; asignado: number }; cajas: CajasResumen; mes: string | null; money: (n: number) => string; onClose: () => void
}) {
  const esGeneral = target.caja.filtroCampo === 'Todos'
  const [monto, setMonto] = useState(String(target.asignado / 100))
  // Siempre empieza en ON (solo el mes elegido) cada vez que se abre; si lo apagas, se respeta mientras esté abierto.
  const [soloMes, setSoloMes] = useState(true)
  const [error, setError] = useState('')
  const n = Number(monto)
  const cents = Math.round(n * 100)
  const otrasReservas = cajas.reservado - (esGeneral ? 0 : target.asignado)
  const aviso = !Number.isFinite(n) ? '' : esGeneral
    ? cents < cajas.reservado ? `Las reservas de subcajas (${money(cajas.reservado)}) superarían este presupuesto.` : ''
    : otrasReservas + cents > cajas.presupuesto ? `Con este monto las reservas sumarían ${money(otrasReservas + cents)}, más que la caja general (${money(cajas.presupuesto)}).` : ''

  // No bloquea: valida, cierra y la escritura sigue en segundo plano con su notificación de resultado.
  function save() {
    if (!/^\d+(\.\d{1,2})?$/.test(monto.trim()) || n < 0) return setError('Ingresa un monto válido (hasta 2 decimales, sin negativos).')
    if (soloMes && !mes) return setError('Para ajustar solo un mes, elige un único mes en el filtro de período, o apaga “Solo este mes” para cambiar el presupuesto base.')
    const ok = store.track(`caja:${target.caja.id}`, { pending: `Guardando ${target.caja.nombre}…`, ok: `${target.caja.nombre} actualizada correctamente.`, error: `No se pudo guardar ${target.caja.nombre}.` },
      () => soloMes && mes ? store.actions.savePresupuesto({ periodo: mes, cajaId: target.caja.id, monto: n }) : store.actions.saveCaja({ ...target.caja, presupuesto: n }))
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`Ajustar ${target.caja.nombre}`} icon={<Wallet className="size-5" />}
      subtitle={esGeneral ? 'Presupuesto mensual total' : 'Reserva mensual dentro de la caja general'}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save}>Guardar</Button></>}>
      <div className="space-y-3">
        <Field label={esGeneral ? 'Presupuesto mensual' : 'Monto asignado'} htmlFor="caja-monto">
          <div className="relative">
            <span className="pointer-events-none absolute top-2 left-3 text-sm font-semibold text-muted">S/</span>
            <input id="caja-monto" className={`${inputCls} tabular pl-9 text-base font-semibold`} inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} />
          </div>
        </Field>
        <Switch checked={soloMes} onChange={setSoloMes} label={mes ? `Solo para ${monthLabel(mes, true)}` : 'Solo este mes (elige un mes en el período)'} />
        {!mes && soloMes && <p className="text-xs text-muted">Para un ajuste puntual, primero elige un único mes en el filtro de período.</p>}
        {!esGeneral && <p className="text-xs text-muted">Incluye gastos con {target.caja.filtroCampo} = “{target.caja.filtroValor}”. Asignar dinero aquí no crea ningún gasto.</p>}
        {aviso && <ErrorBox tone="warning" message={aviso} />}
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  )
}
