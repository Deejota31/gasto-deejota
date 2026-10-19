import { describe, expect, it } from 'vitest'
import { aggregate } from './engine'
import { movimientosPorDia } from './diario'
import type { Filters, Gasto } from './types'

const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const f: Filters = { preset: 'mes', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
const ctx = { base: 'PEN', rates: { USD: 3.8 }, today: '2026-10-19', cajas: [], presupuestos: [] }

describe('movimientosPorDia', () => {
  const GASTOS = [
    g({ fecha: '2026-10-05', monto: 10 }), g({ fecha: '2026-10-05', monto: 30, categoria: 'Auto', ambito: 'Trabajo' }), g({ fecha: '2026-10-07', monto: 5, moneda: 'USD' }),
    g({ fecha: '2026-10-07', monto: 99, estado: 'Anulado' }), g({ fecha: '2026-09-30', monto: 77 }), g({ fecha: '2026-11-01', monto: 66 }), g({ fecha: '2026-10-09', monto: 8, moneda: 'EUR' }),
  ]
  it('agrupa por fecha con las mismas reglas del motor: sin anulados, fuera de rango ni monedas sin tipo de cambio', () => {
    const m = movimientosPorDia(GASTOS, f, 'PEN', ctx.rates)
    expect([...m.keys()].sort()).toEqual(['2026-10-05', '2026-10-07'])
    expect(m.get('2026-10-05')!.map(x => x.cents)).toEqual([3000, 1000])           // ordenados de mayor a menor
    expect(m.get('2026-10-07')![0].cents).toBe(1900)                                // 5 USD × 3.8
  })
  it('cada día suma exactamente la serie diaria del motor (gasto diario ≠ acumulado) y no inventa fechas', () => {
    const a = aggregate(GASTOS, f, ctx)
    const m = movimientosPorDia(GASTOS, f, 'PEN', ctx.rates)
    for (const d of a.dias) expect((m.get(d.date) ?? []).reduce((s, x) => s + x.cents, 0), d.date).toBe(d.diario)
    expect(m.has('2026-10-25')).toBe(false)                                         // fecha futura proyectada: sin movimientos
    expect(m.has('2026-10-06')).toBe(false)                                         // día sin gastos: sin registros ficticios
  })
  it('respeta los filtros de dimensión', () => {
    const m = movimientosPorDia(GASTOS, { ...f, ambitos: ['Trabajo'] }, 'PEN', ctx.rates)
    expect([...m.keys()]).toEqual(['2026-10-05'])
    expect(m.get('2026-10-05')).toHaveLength(1)
    const a = aggregate(GASTOS, { ...f, ambitos: ['Trabajo'] }, ctx)
    expect(a.dias.find(d => d.date === '2026-10-05')!.diario).toBe(3000)
  })
})
