// Presupuesto consolidado (v1.28): ocho indicadores con los valores del motor de fondos, jerarquía de dos niveles, barra y tooltips.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { aggregate, type Ctx } from '../lib/engine'
import { formatMoney } from '../lib/money'
import type { Filters, Fondo, Gasto, ReglaFondo } from '../lib/types'
import { PresupuestoConsolidado } from './PresupuestoConsolidado'

const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const porCat = (categoria: string): ReglaFondo[] => [{ desde: '', medios: 'todos', listaMedios: [], cobertura: 'categoria', rutas: [{ ambito: '', categoria, subcategoria: '' }], restringeMedio: false }]
const fondo = (id: string, monto: number, orden: number, reglas: ReglaFondo[] = []): Fondo => ({
  id, nombre: id, monto, moneda: 'PEN', color: '#000000', icono: '', activo: true, orden, recurrencia: 'mensual', mes: '', medioPago: '', tipo: 'mensual', creadoEn: '', actualizadoEn: '', reglas,
})
const FONDOS = [fondo('general', 3800, 1), fondo('bebe', 600, 2, porCat('Bebé')), fondo('auto', 400, 3, porCat('Auto')), fondo('plan-nube', 200, 4, porCat('Plan Nube'))]
const f: Filters = { preset: 'mes', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ base: 'PEN', rates: { USD: 3.8 }, today: '2026-10-10', fondos: FONDOS, fondosMeses: [], ...over })
const money = (c: number) => formatMoney(c, 'PEN')
const norm = (s: string) => s.replace(/ /g, ' ')
const texto = (el: HTMLElement) => norm(el.textContent ?? '')
const m = (c: number) => norm(money(c))

const celdaValor = (id: string) => within(screen.getByTestId(`cons-${id}`)).getAllByText(/.*/, { selector: 'p' })[1]
const montaje = (gastos: Gasto[], over: Partial<Ctx> = {}) => {
  const c = aggregate(gastos, f, ctx(over)).presupuesto
  render(<PresupuestoConsolidado c={c} money={money} periodo="octubre 2026" />)
  return c
}

afterEach(cleanup)

const SIN_EXCESO = [g({ categoria: 'Bebé', monto: 100 }), g({ categoria: 'Alimentación', monto: 150 })]
const EXCEDIDO = [g({ categoria: 'Alimentación', monto: 5000 }), g({ categoria: 'Bebé', monto: 347.25 })]

describe('PresupuestoConsolidado', () => {
  it('ocho indicadores con los valores del motor', () => {
    const c = montaje(SIN_EXCESO)
    const esperado: [string, string][] = [
      ['presupuesto-consolidado', m(c.presupuesto)], ['gastado-del-período', m(c.gastadoPeriodo)], ['disponible-consolidado', m(c.disponible)], ['exceso', m(0)],
      ['fondos-activos', '4'], ['fondos-con-excedente', '0'], ['sin-fondo-asignable', m(0)], ['consumido', `${c.pct}%`],
    ]
    const celdas = within(screen.getByTestId('consolidado')).getAllByTestId(/^cons-/)
    expect(celdas).toHaveLength(8)
    for (const [id, valor] of esperado) expect(texto(celdaValor(id)), id).toBe(valor)
    for (const cel of celdas) expect(cel.querySelectorAll('p')).toHaveLength(2)   // contrato: etiqueta y valor
  })

  it('cifras clave en línea y cuatro indicadores con el mismo diseño (icono a la izquierda, título + ⓘ, valor)', () => {
    montaje(SIN_EXCESO)
    const resumen = screen.getByTestId('consolidado-resumen')
    expect(within(resumen).getAllByTestId(/^cons-/).map(e => e.getAttribute('data-testid')!.slice(5))).toEqual(['presupuesto-consolidado', 'gastado-del-período', 'disponible-consolidado', 'exceso'])
    for (const id of ['presupuesto-consolidado', 'gastado-del-período', 'disponible-consolidado']) expect(celdaValor(id).className, id).not.toMatch(/text-(lg|xl|2xl)/)
    const fila = within(screen.getByTestId('indicadores')).getAllByTestId(/^cons-/)
    expect(fila.map(e => e.getAttribute('data-testid')!.slice(5))).toEqual(['fondos-activos', 'fondos-con-excedente', 'sin-fondo-asignable', 'consumido'])
    expect(new Set(fila.map(e => e.className)).size).toBe(1)
    for (const e of fila) {
      expect(e.className).toContain('items-center')
      const icono = e.firstElementChild as HTMLElement
      expect(icono.getAttribute('aria-hidden')).toBe('true')
      expect(icono.className).toContain('size-9')
      expect(e.querySelector('button[aria-label^="Información:"]')).toBeTruthy()
    }
  })

  it('encabezado: título, cantidad de fondos activos, período e icono de información', () => {
    montaje(SIN_EXCESO)
    expect(screen.getByRole('heading', { name: 'Presupuesto consolidado' })).toBeTruthy()
    expect(screen.getByTestId('consolidado-subtitulo').textContent).toBe('4 fondos activos · octubre 2026')
    expect(screen.getByRole('button', { name: 'Información: Cómo se calcula' })).toBeTruthy()
  })

  it('dentro del presupuesto: estado en texto y sin advertencia de exceso', () => {
    montaje(SIN_EXCESO)
    const estado = screen.getByTestId('consolidado-estado')
    expect(estado.getAttribute('data-tono')).toBe('ok')
    expect(estado.textContent).toBe('Dentro del presupuesto')
    expect(screen.queryByTestId('barra-limite')).toBeNull()
  })

  it('excedido: advertencia con el importe calculado, disponible negativo en rojo, exceso y barra acotada con marca de límite', () => {
    const c = montaje(EXCEDIDO)
    expect(c.pct).toBeGreaterThan(100)
    const estado = screen.getByTestId('consolidado-estado')
    expect(estado.getAttribute('data-tono')).toBe('alerta')
    expect(texto(estado)).toBe(`Presupuesto excedido en ${m(-c.disponible)}`)
    expect(celdaValor('disponible-consolidado').style.color).toBe('var(--danger)')
    expect(texto(celdaValor('disponible-consolidado'))).toBe(m(c.disponible))
    expect(texto(celdaValor('exceso'))).toBe(m(34725))
    expect(within(screen.getByTestId('barra-presupuesto')).getByTestId('barra-limite')).toBeTruthy()
    const anchos = [...document.querySelectorAll<HTMLElement>('[data-segmento]')].map(e => parseFloat(e.parentElement!.style.width))
    expect(anchos.reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(100.0001)
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

  it('fondos con excedente y gastos sin fondo asignable se cuentan en sus indicadores', () => {
    const fs = [FONDOS[3], fondo('general', 3800, 1, [{ desde: '', medios: 'todos', listaMedios: [], cobertura: 'ambito', rutas: [{ ambito: 'Personal', categoria: '', subcategoria: '' }], restringeMedio: false }])]
    montaje([g({ categoria: 'Plan Nube', monto: 260 }), g({ ambito: 'Familia', monto: 40 })], { fondos: fs })
    expect(texto(celdaValor('fondos-con-excedente'))).toBe('1')
    expect(texto(celdaValor('sin-fondo-asignable'))).toBe(m(4000))
  })

  it('el icono de información del encabezado explica presupuesto, gastado, disponible y consumido', () => {
    montaje(SIN_EXCESO)
    fireEvent.click(screen.getByRole('button', { name: 'Información: Cómo se calcula' }))
    const t = screen.getByRole('tooltip').textContent!
    for (const frag of ['fondos activos', 'Gastado', 'Disponible consolidado', 'sin fondo asignable', 'Consumido']) expect(t, frag).toContain(frag)
    expect(t).not.toMatch(/caja|reserva/i)
  })

  it('barra: un segmento por tramo con importe, tooltip al enfocar y leyenda; los tramos suman el presupuesto', () => {
    const c = montaje(SIN_EXCESO)
    const segs = [...document.querySelectorAll<HTMLElement>('[data-segmento]')]
    expect(segs.map(s => s.getAttribute('data-segmento'))).toEqual(['fondos', 'disponible'])   // sin fondo = 0: no se dibuja
    expect(norm(segs[0].getAttribute('aria-label')!)).toBe(`Gastado en fondos: ${m(25000)}`)
    fireEvent.focus(segs[0])
    expect(texto(screen.getByRole('tooltip'))).toContain(m(25000))
    fireEvent.keyDown(screen.getByRole('group', { name: 'Distribución del presupuesto consolidado' }), { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    const leyenda = within(screen.getByRole('list', { name: 'Leyenda de la distribución' }))
    for (const n of ['Gastado en fondos', 'Gastado sin fondo asignable', 'Disponible']) expect(leyenda.getAllByText(new RegExp(n)).length).toBeGreaterThan(0)
    expect(c.presupuesto).toBe(500000)
  })

  it('sin fondos: valores con guion, estado neutro y sin barra', () => {
    montaje([g({ monto: 50 })], { fondos: [] })
    expect(texto(celdaValor('presupuesto-consolidado'))).toBe('—')
    expect(texto(celdaValor('disponible-consolidado'))).toBe('—')
    expect(screen.getByTestId('consolidado-subtitulo').textContent).toMatch(/Sin fondos registrados/)
    expect(screen.getByTestId('consolidado-estado').getAttribute('data-tono')).toBe('neutro')
    expect(screen.queryByTestId('barra-presupuesto')).toBeNull()
  })

  it('métricas complementarias: al final del bloque, compactas y sin sumar celdas cons-*', () => {
    const c = aggregate(SIN_EXCESO, f, ctx()).presupuesto
    const comp = ['Promedio diario', 'Promedio por movimiento', 'Mayor gasto', 'Movimientos'].map((etiqueta, i) => ({ etiqueta, valor: `S/ ${i}`, pista: `pista ${i}`, info: <p>info</p>, icono: <span /> }))
    render(<PresupuestoConsolidado c={c} money={money} periodo="octubre 2026" complementarios={comp} />)
    const bloque = screen.getByTestId('consolidado')
    expect(within(bloque).getAllByTestId(/^cons-/)).toHaveLength(8)
    const kpis = within(bloque).getByTestId('kpis')
    expect(kpis.children).toHaveLength(4)
    expect(bloque.lastElementChild).toBe(kpis)
    expect(within(kpis).getByText('pista 2')).toBeTruthy()
  })
})
