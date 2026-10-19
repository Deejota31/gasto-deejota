// Presupuesto consolidado rediseñado: conserva los 8 indicadores y sus valores, jerarquía de dos niveles, barra y tooltips.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { aggregate, type Ctx } from '../lib/engine'
import { formatMoney } from '../lib/money'
import type { Caja, Filters, Gasto } from '../lib/types'
import { PresupuestoConsolidado } from './PresupuestoConsolidado'

const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const caja = (id: string, presupuesto: number, filtroCampo: Caja['filtroCampo'] = 'Todos', filtroValor = '', orden = 1): Caja =>
  ({ id, nombre: id, presupuesto, filtroCampo, filtroValor, color: '#000000', orden })
const CAJAS = [caja('general', 5000), caja('bebe', 600, 'Categoría', 'Bebé', 2), caja('auto', 400, 'Categoría', 'Auto', 3), caja('plan-nube', 200, 'Categoría', 'Plan Nube', 4)]
const f: Filters = { preset: 'mes', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ base: 'PEN', rates: { USD: 3.8 }, today: '2026-10-10', cajas: CAJAS, presupuestos: [], ...over })
const money = (c: number) => formatMoney(c, 'PEN')
const norm = (s: string) => s.replace(/\u00a0/g, ' ')
const texto = (el: HTMLElement) => norm(el.textContent ?? '')
const m = (c: number) => norm(money(c))

const celdaValor = (id: string) => within(screen.getByTestId(`cons-${id}`)).getAllByText(/.*/, { selector: 'p' })[1]
const montaje = (gastos: Gasto[], over: Partial<Ctx> = {}) => {
  const c = aggregate(gastos, f, ctx(over)).cajas
  render(<PresupuestoConsolidado c={c} money={money} periodo="octubre 2026" />)
  return c
}

afterEach(cleanup)

const SIN_EXCESO = [g({ categoria: 'Bebé', monto: 100 }), g({ categoria: 'Alimentación', monto: 150 })]
const EXCEDIDO = [g({ categoria: 'Alimentación', monto: 5000 }), g({ categoria: 'Bebé', monto: 347.25 })]

describe('PresupuestoConsolidado', () => {
  it('conserva los ocho indicadores con los mismos nombres y los mismos valores del motor', () => {
    const c = montaje(SIN_EXCESO)
    const esperado: [string, string][] = [
      ['presupuesto-consolidado', m(c.presupuesto)],
      ['gastado-del-período', m(c.gastadoPeriodo)],
      ['disponible-consolidado', m(c.disponible)],
      ['reservado-en-cajas', m(c.reservado)],
      ['libre-inicial', m(c.libreInicial)],
      ['gastado-fuera-de-reservas', m(c.gastadoLibre)],
      ['saldo-libre-actual', m(c.saldoLibre)],
      ['consumido', `${c.pct}%`],
    ]
    const celdas = within(screen.getByTestId('consolidado')).getAllByTestId(/^cons-/)
    expect(celdas).toHaveLength(8)
    for (const [id, valor] of esperado) expect(texto(celdaValor(id)), id).toBe(valor)
    // contrato con e2e y Salud financiera: cada celda tiene exactamente dos <p> (etiqueta y valor)
    for (const cel of celdas) expect(cel.querySelectorAll('p')).toHaveLength(2)
  })

  it('jerarquía de dos niveles: cuatro indicadores principales y cuatro secundarios, los principales con mayor tamaño', () => {
    montaje(SIN_EXCESO)
    const principal = ['presupuesto-consolidado', 'gastado-del-período', 'disponible-consolidado', 'reservado-en-cajas']
    const secundario = ['libre-inicial', 'gastado-fuera-de-reservas', 'saldo-libre-actual', 'consumido']
    for (const id of principal) expect(celdaValor(id).className, id).toMatch(/text-(lg|xl|2xl)/)
    for (const id of secundario) expect(celdaValor(id).className, id).toContain('text-sm')
    // los principales aparecen antes que los secundarios en el documento
    const orden = within(screen.getByTestId('consolidado')).getAllByTestId(/^cons-/).map(e => e.getAttribute('data-testid')!.slice(5))
    expect(orden).toEqual([...principal, ...secundario])
  })

  it('encabezado: título, cantidad de fuentes o caja general, período e icono de información', () => {
    montaje(SIN_EXCESO)
    expect(screen.getByRole('heading', { name: 'Presupuesto consolidado' })).toBeTruthy()
    expect(screen.getByTestId('consolidado-subtitulo').textContent).toMatch(/octubre 2026/)
    expect(screen.getByRole('button', { name: 'Información: Cómo se calcula' })).toBeTruthy()
  })

  it('dentro del presupuesto: estado en texto y sin advertencia de exceso', () => {
    montaje(SIN_EXCESO)
    const estado = screen.getByTestId('consolidado-estado')
    expect(estado.getAttribute('data-tono')).toBe('ok')
    expect(estado.textContent).toBe('Dentro del presupuesto')
    expect(screen.queryByTestId('barra-limite')).toBeNull()
  })

  it('excedido: advertencia con el importe calculado, saldo negativo en rojo y barra acotada con marca de límite', () => {
    const c = montaje(EXCEDIDO)
    expect(c.pct).toBeGreaterThan(100)
    const estado = screen.getByTestId('consolidado-estado')
    expect(estado.getAttribute('data-tono')).toBe('alerta')
    expect(texto(estado)).toBe(`Presupuesto excedido en ${m(-c.disponible)}`)
    expect(texto(estado)).toContain('347.25')
    expect(celdaValor('disponible-consolidado').style.color).toBe('var(--danger)')
    expect(texto(celdaValor('disponible-consolidado'))).toBe(m(c.disponible))        // el valor negativo se sigue mostrando
    expect(texto(celdaValor('consumido'))).toBe(`${c.pct}%`)
    const barra = within(screen.getByTestId('barra-presupuesto'))
    expect(barra.getByTestId('barra-limite')).toBeTruthy()
    const anchos = [...document.querySelectorAll<HTMLElement>('[data-segmento]')].map(e => parseFloat(e.parentElement!.style.width))
    expect(anchos.reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(100.0001)
    // el progreso de "Consumido" no pasa de 100 %
    const pb = screen.getByRole('progressbar', { name: 'Consumido' })
    expect(pb.getAttribute('aria-valuenow')).toBe(String(c.pct))
    expect((pb.firstElementChild as HTMLElement).style.width).toBe('100%')
  })

  it('exactamente 100 %: agotado, en advertencia y no en rojo', () => {
    const c = montaje([g({ categoria: 'Alimentación', monto: 3800 }), g({ categoria: 'Bebé', monto: 600 }), g({ categoria: 'Auto', monto: 400 }), g({ categoria: 'Plan Nube', monto: 200 })])
    expect(c.pct).toBe(100)
    expect(screen.getByTestId('consolidado-estado').getAttribute('data-tono')).toBe('atencion')
    expect(screen.getByTestId('consolidado-estado').textContent).toBe('Presupuesto agotado')
  })

  it('saldos negativos: libre inicial y saldo libre muestran su valor negativo en rojo', () => {
    const c = montaje([g({ categoria: 'Alimentación', monto: 4200 })])
    expect(c.saldoLibre).toBeLessThan(0)
    expect(texto(celdaValor('saldo-libre-actual'))).toBe(m(c.saldoLibre))
    expect(celdaValor('saldo-libre-actual').style.color).toBe('var(--danger)')
  })

  it('Disponible consolidado y Saldo libre actual son importes distintos y cada uno explica su definición', () => {
    const c = montaje(SIN_EXCESO)
    expect(c.disponible).not.toBe(c.saldoLibre)
    fireEvent.click(screen.getByRole('button', { name: 'Información: Disponible consolidado' }))
    expect(screen.getByRole('tooltip').textContent).toMatch(/disponible = saldo libre \+ reservas sin utilizar/i)
    cleanup()
    montaje(SIN_EXCESO)
    fireEvent.click(screen.getByRole('button', { name: 'Información: Saldo libre actual' }))
    expect(screen.getByRole('tooltip').textContent).toMatch(/Libre inicial − gastado fuera de reservas − excesos/)
  })

  it('el icono de información del encabezado explica presupuesto, gastado, reservado, disponible vs saldo libre y consumido', () => {
    montaje(SIN_EXCESO)
    fireEvent.click(screen.getByRole('button', { name: 'Información: Cómo se calcula' }))
    const t = screen.getByRole('tooltip').textContent!
    for (const frag of ['fuentes activas', 'Gastado', 'Reservado en cajas', 'Disponible consolidado', 'Saldo libre', 'Consumido']) expect(t, frag).toContain(frag)
  })

  it('barra: un segmento por tramo con importe, tooltip al enfocar y leyenda; los tramos suman el presupuesto', () => {
    const c = montaje(SIN_EXCESO)
    const segs = [...document.querySelectorAll<HTMLElement>('[data-segmento]')]
    expect(segs.map(s => s.getAttribute('data-segmento'))).toEqual(['fuera', 'cajas', 'reservas', 'libre'])
    const fuera = segs[0]
    expect(norm(fuera.getAttribute('aria-label')!)).toBe(`Gastado fuera de reservas: ${m(c.gastadoLibre)}`)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(fuera)
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toContain('Gastado fuera de reservas')
    expect(texto(tip)).toContain(m(c.gastadoLibre))
    fireEvent.keyDown(screen.getByRole('group', { name: 'Distribución del presupuesto consolidado' }), { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    const leyenda = within(screen.getByRole('list', { name: 'Leyenda de la distribución' }))
    for (const n of ['Gastado fuera de reservas', 'Gastado en cajas', 'Reservas sin utilizar', 'Saldo libre']) expect(leyenda.getByText(new RegExp(n))).toBeTruthy()
  })

  it('sin presupuesto: valores con guion, estado neutro y sin barra', () => {
    montaje([g({ monto: 50 })], { cajas: [] })
    expect(texto(celdaValor('presupuesto-consolidado'))).toBe('—')
    expect(texto(celdaValor('disponible-consolidado'))).toBe('—')
    expect(screen.getByTestId('consolidado-estado').getAttribute('data-tono')).toBe('neutro')
    expect(screen.queryByTestId('barra-presupuesto')).toBeNull()
  })

  it('muestra el botón de acción que le pasa el Dashboard (Ajustar caja)', () => {
    const c = aggregate(SIN_EXCESO, f, ctx()).cajas
    render(<PresupuestoConsolidado c={c} money={money} periodo="octubre 2026" accion={<button type="button">Ajustar caja</button>} />)
    expect(screen.getByRole('button', { name: 'Ajustar caja' })).toBeTruthy()
  })
})
