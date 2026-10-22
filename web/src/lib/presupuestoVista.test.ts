// Presupuesto consolidado (Dashboard): estado financiero y reparto de la barra. Todo parte de aggregate() sin tocar sus fórmulas.
// v1.28: P = suma de los fondos; la barra se reparte en gastado imputado a fondos + gastado sin fondo asignable + disponible.
import { describe, expect, it } from 'vitest'
import { aggregate, type Ctx } from './engine'
import { barraPresupuesto, estadoPresupuesto } from './presupuestoVista'
import { formatMoney } from './money'
import type { Filters, Fondo, Gasto, ReglaFondo } from './types'

const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const porCat = (categoria: string): ReglaFondo[] => [{ desde: '', medios: 'todos', listaMedios: [], cobertura: 'categoria', rutas: [{ ambito: '', categoria, subcategoria: '' }], restringeMedio: false }]
const soloPersonal: ReglaFondo[] = [{ desde: '', medios: 'todos', listaMedios: [], cobertura: 'ambito', rutas: [{ ambito: 'Personal', categoria: '', subcategoria: '' }], restringeMedio: false }]
const fondo = (id: string, monto: number, orden: number, reglas: ReglaFondo[] = []): Fondo => ({
  id, nombre: id, monto, moneda: 'PEN', color: '#000000', icono: '', activo: true, orden, recurrencia: 'mensual', mes: '', medioPago: '', tipo: 'mensual', creadoEn: '', actualizadoEn: '', reglas,
})
// P = 5.000: General 3.800 + Bebé 600 + Auto 400 + Plan Nube 200.
const FONDOS = [fondo('general', 3800, 1), fondo('bebe', 600, 2, porCat('Bebé')), fondo('auto', 400, 3, porCat('Auto')), fondo('plan-nube', 200, 4, porCat('Plan Nube'))]
const f = (over: Partial<Filters> = {}): Filters => ({ preset: 'mes', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [], ...over })
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ base: 'PEN', rates: { USD: 3.8 }, today: '2026-10-10', fondos: FONDOS, fondosMeses: [], ...over })
const money = (c: number) => formatMoney(c, 'PEN')
const presDe = (gastos: Gasto[], over: Partial<Ctx> = {}) => aggregate(gastos, f(), ctx(over)).presupuesto

const ESCENARIOS: Record<string, Gasto[]> = {
  'sin gastos': [],
  'menos de 70 %': [g({ categoria: 'Bebé', monto: 100 }), g({ categoria: 'Alimentación', monto: 150 })],
  'entre 70 % y 100 %': [g({ categoria: 'Alimentación', monto: 3700 }), g({ categoria: 'Bebé', monto: 300 })],
  'exactamente 100 %': [g({ categoria: 'Alimentación', monto: 3800 }), g({ categoria: 'Bebé', monto: 600 }), g({ categoria: 'Auto', monto: 400 }), g({ categoria: 'Plan Nube', monto: 200 })],
  'más de 100 %': [g({ categoria: 'Alimentación', monto: 5000 }), g({ categoria: 'Bebé', monto: 347.25 })],
  'excedente de un fondo': [g({ categoria: 'Plan Nube', monto: 260 })],
}

describe('identidad de la barra: los segmentos conservan las magnitudes del motor', () => {
  for (const [nombre, gastos] of Object.entries(ESCENARIOS)) {
    it(`${nombre}: importes idénticos al motor y ancho acotado a 100 %`, () => {
      const c = presDe(gastos)
      const b = barraPresupuesto(c)
      const v = (k: string) => b.segmentos.find(s => s.clave === k)!.valor
      expect(v('fondos')).toBe(c.fondos.reduce((s, x) => s + x.gastado, 0))
      expect(v('sinFondo')).toBe(c.sinFondo.cents)
      expect(v('disponible')).toBe(Math.max(0, c.disponible))
      expect(b.segmentos.reduce((s, x) => s + x.ancho, 0)).toBeLessThanOrEqual(100 + 1e-9)
      for (const s of b.segmentos) { expect(s.ancho).toBeGreaterThanOrEqual(0); expect(s.ancho).toBeLessThanOrEqual(100) }
    })
  }

  it('sin exceso la barra se llena exactamente: imputado + sin fondo + disponible = presupuesto', () => {
    for (const k of ['sin gastos', 'menos de 70 %', 'entre 70 % y 100 %', 'exactamente 100 %', 'excedente de un fondo']) {
      const c = presDe(ESCENARIOS[k])
      const b = barraPresupuesto(c)
      expect(b.segmentos.reduce((s, x) => s + x.valor, 0), k).toBe(c.presupuesto)
      expect(b.excedido, k).toBe(false)
      expect(b.limite, k).toBeNull()
      expect(b.segmentos.reduce((s, x) => s + x.ancho, 0), k).toBeCloseTo(100, 6)
    }
  })

  it('con consumo mayor a 100 % no desborda y marca dónde estaba el límite del presupuesto', () => {
    const c = presDe(ESCENARIOS['más de 100 %'])
    expect(c.pct).toBeGreaterThan(100)
    const b = barraPresupuesto(c)
    expect(b.excedido).toBe(true)
    expect(b.limite!).toBeGreaterThan(0)
    expect(b.limite!).toBeLessThan(100)
    expect(b.segmentos.reduce((s, x) => s + x.ancho, 0)).toBeLessThanOrEqual(100 + 1e-9)
    expect(b.segmentos.find(s => s.clave === 'disponible')!.valor).toBe(0)
  })

  it('gasto sin fondo asignable: tiene su propio tramo y sigue contando en el gastado', () => {
    const fs = [fondo('personal', 1000, 1, soloPersonal)]
    const c = presDe([g({ monto: 100 }), g({ monto: 40, ambito: 'Familia' })], { fondos: fs })
    expect(c.sinFondo).toEqual({ cents: 4000, count: 1 })
    const b = barraPresupuesto(c)
    expect(b.segmentos.map(s => [s.clave, s.valor])).toEqual([['fondos', 10000], ['sinFondo', 4000], ['disponible', 86000]])
  })

  it('sin presupuesto no hay barra', () => {
    const c = presDe([g({ monto: 50 })], { fondos: [] })
    expect(c.presupuesto).toBe(0)
    expect(barraPresupuesto(c).segmentos).toEqual([])
  })

  it('porcentaje de cada tramo respecto del presupuesto', () => {
    const c = presDe(ESCENARIOS['menos de 70 %'])
    const s = barraPresupuesto(c).segmentos.find(x => x.clave === 'fondos')!
    expect(s.pctPresupuesto).toBe(Math.round((25000 / c.presupuesto) * 1000) / 10)
  })
})

describe('estado financiero consolidado', () => {
  it('dentro del presupuesto (< 70 %)', () => {
    expect(estadoPresupuesto(presDe(ESCENARIOS['menos de 70 %']), money)).toMatchObject({ tono: 'ok', exceso: 0 })
  })
  it('cerca del límite (70 % a menos de 100 %) incluye el porcentaje calculado', () => {
    const c = presDe(ESCENARIOS['entre 70 % y 100 %'])
    const e = estadoPresupuesto(c, money)
    expect(e.tono).toBe('atencion')
    expect(e.etiqueta).toContain(`${c.pct}%`)
  })
  it('exactamente 100 %: agotado (advertencia, no excedido)', () => {
    const c = presDe(ESCENARIOS['exactamente 100 %'])
    expect(c.pct).toBe(100)
    expect(c.disponible).toBe(0)
    expect(estadoPresupuesto(c, money)).toMatchObject({ tono: 'atencion', etiqueta: 'Presupuesto agotado' })
  })
  it('excedido: usa el importe calculado, nunca uno fijo', () => {
    const c = presDe(ESCENARIOS['más de 100 %'])
    const e = estadoPresupuesto(c, money)
    expect(e.tono).toBe('alerta')
    expect(e.exceso).toBe(-c.disponible)
    expect(e.exceso).toBe(34725)
    expect(c.exceso).toBe(34725)
    expect(e.etiqueta).toBe(`Presupuesto excedido en ${money(34725)}`)
    expect(estadoPresupuesto(presDe([g({ categoria: 'Alimentación', monto: 5100 })]), money).etiqueta).toBe(`Presupuesto excedido en ${money(10000)}`)
  })
  it('sin presupuesto: estado neutro, nunca "excedido"', () => {
    expect(estadoPresupuesto(presDe([g({ monto: 50 })], { fondos: [] }), money)).toMatchObject({ tono: 'neutro', etiqueta: 'Sin presupuesto definido', exceso: 0 })
  })
})

describe('regresión de fórmulas', () => {
  for (const [nombre, gastos] of Object.entries(ESCENARIOS)) {
    it(`${nombre}: disponible = P − gastado e imputado + sin fondo = gastado`, () => {
      const c = presDe(gastos)
      expect(c.disponible).toBe(c.presupuesto - c.gastadoPeriodo)
      expect(c.fondos.reduce((s, x) => s + x.gastado, 0) + c.sinFondo.cents).toBe(c.gastadoPeriodo)
      expect(c.presupuesto).toBe(500000)
    })
  }
})
