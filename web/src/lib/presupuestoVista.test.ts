// Presupuesto consolidado (Dashboard): estado financiero y reparto de la barra. Todo parte de aggregate() sin tocar sus fórmulas.
import { describe, expect, it } from 'vitest'
import { aggregate, type Ctx } from './engine'
import { barraPresupuesto, estadoPresupuesto } from './presupuestoVista'
import { formatMoney } from './money'
import type { Caja, Filters, Gasto } from './types'

const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const caja = (id: string, presupuesto: number, filtroCampo: Caja['filtroCampo'] = 'Todos', filtroValor = '', orden = 1): Caja =>
  ({ id, nombre: id, presupuesto, filtroCampo, filtroValor, color: '#000000', orden })
const CAJAS = [caja('general', 5000), caja('bebe', 600, 'Categoría', 'Bebé', 2), caja('auto', 400, 'Categoría', 'Auto', 3), caja('plan-nube', 200, 'Categoría', 'Plan Nube', 4)]
const f = (over: Partial<Filters> = {}): Filters => ({ preset: 'mes', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [], ...over })
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ base: 'PEN', rates: { USD: 3.8 }, today: '2026-10-10', cajas: CAJAS, presupuestos: [], ...over })
const money = (c: number) => formatMoney(c, 'PEN')
const cajasDe = (gastos: Gasto[], over: Partial<Ctx> = {}) => aggregate(gastos, f(), ctx(over)).cajas

// Escenarios con los mismos datos: P = 5.000, reservado = 1.200 (bebé 600 + auto 400 + plan nube 200), libre inicial = 3.800.
const ESCENARIOS: Record<string, Gasto[]> = {
  'sin gastos': [],
  'menos de 70 %': [g({ categoria: 'Bebé', monto: 100 }), g({ categoria: 'Alimentación', monto: 150 })],
  'entre 70 % y 100 %': [g({ categoria: 'Alimentación', monto: 3700 }), g({ categoria: 'Bebé', monto: 300 })],
  // todas las cajas agotadas + gasto libre = presupuesto: consumo 100 % con saldo libre en 0
  'exactamente 100 %': [g({ categoria: 'Alimentación', monto: 3800 }), g({ categoria: 'Bebé', monto: 600 }), g({ categoria: 'Auto', monto: 400 }), g({ categoria: 'Plan Nube', monto: 200 })],
  'más de 100 %': [g({ categoria: 'Alimentación', monto: 5000 }), g({ categoria: 'Bebé', monto: 347.25 })],
  'exceso en una caja': [g({ categoria: 'Plan Nube', monto: 260 })],
  'saldo libre negativo con reservas sin usar': [g({ categoria: 'Alimentación', monto: 4200 })],
}

describe('identidad de la barra: los segmentos conservan las magnitudes del motor', () => {
  for (const [nombre, gastos] of Object.entries(ESCENARIOS)) {
    it(`${nombre}: importes idénticos al motor y ancho acotado a 100 %`, () => {
      const c = cajasDe(gastos)
      const b = barraPresupuesto(c)
      const v = (k: string) => b.segmentos.find(s => s.clave === k)!.valor
      expect(v('fuera')).toBe(c.gastadoLibre)
      expect(v('cajas')).toBe(c.gastadoSubcajas)
      expect(v('reservas')).toBe(c.reservasSinUsar)
      expect(v('libre')).toBe(Math.max(0, c.saldoLibre))
      const ancho = b.segmentos.reduce((s, x) => s + x.ancho, 0)
      expect(ancho).toBeLessThanOrEqual(100 + 1e-9)
      for (const s of b.segmentos) { expect(s.ancho).toBeGreaterThanOrEqual(0); expect(s.ancho).toBeLessThanOrEqual(100) }
    })
  }

  it('con saldo libre ≥ 0 la barra se llena exactamente: gastado fuera + en cajas + reservas sin usar + saldo libre = presupuesto', () => {
    for (const k of ['sin gastos', 'menos de 70 %', 'entre 70 % y 100 %', 'exactamente 100 %', 'exceso en una caja']) {
      const c = cajasDe(ESCENARIOS[k])
      const b = barraPresupuesto(c)
      expect(b.segmentos.reduce((s, x) => s + x.valor, 0), k).toBe(c.presupuesto)
      expect(b.excedido, k).toBe(false)
      expect(b.limite, k).toBeNull()
      expect(b.segmentos.reduce((s, x) => s + x.ancho, 0), k).toBeCloseTo(100, 6)
    }
  })

  it('con consumo mayor a 100 % no desborda y marca dónde estaba el límite del presupuesto', () => {
    const c = cajasDe(ESCENARIOS['más de 100 %'])
    expect(c.pct).toBeGreaterThan(100)
    const b = barraPresupuesto(c)
    expect(b.excedido).toBe(true)
    expect(b.limite).not.toBeNull()
    expect(b.limite!).toBeGreaterThan(0)
    expect(b.limite!).toBeLessThan(100)
    expect(b.segmentos.reduce((s, x) => s + x.ancho, 0)).toBeLessThanOrEqual(100 + 1e-9)
    expect(b.segmentos.find(s => s.clave === 'libre')!.valor).toBe(0)                    // el saldo libre negativo no se dibuja
  })

  it('el saldo libre negativo no genera un segmento negativo: las reservas sin usar quedan más allá del límite', () => {
    const c = cajasDe(ESCENARIOS['saldo libre negativo con reservas sin usar'])
    expect(c.saldoLibre).toBeLessThan(0)
    expect(c.disponible).toBeGreaterThan(0)                                          // aún hay disponible consolidado, pero ya no está libre
    const b = barraPresupuesto(c)
    expect(b.segmentos.every(s => s.valor >= 0 && s.ancho >= 0)).toBe(true)
    expect(b.excedido).toBe(true)
    expect(b.limite).not.toBeNull()
  })

  it('sin presupuesto no hay barra', () => {
    const c = cajasDe([g({ monto: 50 })], { cajas: [] })
    expect(c.presupuesto).toBe(0)
    expect(barraPresupuesto(c).segmentos).toEqual([])
  })

  it('porcentaje de cada tramo respecto del presupuesto', () => {
    const c = cajasDe(ESCENARIOS['menos de 70 %'])
    const fuera = barraPresupuesto(c).segmentos.find(s => s.clave === 'fuera')!
    expect(fuera.pctPresupuesto).toBe(Math.round((c.gastadoLibre / c.presupuesto) * 1000) / 10)
  })
})

describe('estado financiero consolidado', () => {
  it('dentro del presupuesto (< 70 %)', () => {
    const e = estadoPresupuesto(cajasDe(ESCENARIOS['menos de 70 %']), money)
    expect(e).toMatchObject({ tono: 'ok', exceso: 0 })
  })
  it('cerca del límite (70 % a menos de 100 %) incluye el porcentaje calculado', () => {
    const c = cajasDe(ESCENARIOS['entre 70 % y 100 %'])
    const e = estadoPresupuesto(c, money)
    expect(e.tono).toBe('atencion')
    expect(e.etiqueta).toContain(`${c.pct}%`)
  })
  it('exactamente 100 %: agotado (advertencia, no excedido)', () => {
    const c = cajasDe(ESCENARIOS['exactamente 100 %'])
    expect(c.pct).toBe(100)
    expect(c.disponible).toBe(0)
    expect(estadoPresupuesto(c, money)).toMatchObject({ tono: 'atencion', etiqueta: 'Presupuesto agotado' })
  })
  it('excedido: usa el importe calculado, nunca uno fijo', () => {
    const c = cajasDe(ESCENARIOS['más de 100 %'])
    const e = estadoPresupuesto(c, money)
    expect(e.tono).toBe('alerta')
    expect(e.exceso).toBe(-c.disponible)
    expect(e.exceso).toBe(34725)
    expect(e.etiqueta).toBe(`Presupuesto excedido en ${money(34725)}`)
    // otro importe → otra etiqueta
    const otro = estadoPresupuesto(cajasDe([g({ categoria: 'Alimentación', monto: 5100 })]), money)
    expect(otro.etiqueta).toBe(`Presupuesto excedido en ${money(10000)}`)
  })
  it('sin presupuesto: estado neutro, nunca "excedido"', () => {
    const e = estadoPresupuesto(cajasDe([g({ monto: 50 })], { cajas: [] }), money)
    expect(e).toMatchObject({ tono: 'neutro', etiqueta: 'Sin presupuesto definido', exceso: 0 })
  })
})

describe('regresión de fórmulas: Disponible consolidado ≠ Saldo libre', () => {
  for (const [nombre, gastos] of Object.entries(ESCENARIOS)) {
    it(`${nombre}: las definiciones del motor siguen intactas`, () => {
      const c = cajasDe(gastos)
      expect(c.libreInicial).toBe(c.presupuesto - c.reservado)
      expect(c.disponible).toBe(c.presupuesto - c.gastadoSubcajas - c.gastadoLibre)
      expect(c.gastadoPeriodo).toBe(c.gastadoSubcajas + c.gastadoLibre)
      expect(c.saldoLibre).toBe(c.presupuesto - c.reservado - c.gastadoLibre - c.excesoSubcajas)
      expect(c.saldoLibre + c.reservasSinUsar).toBe(c.disponible)
    })
  }
  it('son importes distintos cuando hay reservas sin usar', () => {
    const c = cajasDe(ESCENARIOS['menos de 70 %'])
    expect(c.disponible).not.toBe(c.saldoLibre)
    expect(c.disponible - c.saldoLibre).toBe(c.reservasSinUsar)
  })
})
