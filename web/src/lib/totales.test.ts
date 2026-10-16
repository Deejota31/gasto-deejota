// P5: el total de la lista de Gastos usa la misma conversión que el motor (Dashboard) y no suma los anulados.
import { describe, expect, it } from 'vitest'
import { totalesLista } from './totales'
import { aggregate } from './engine'
import { ratesFromConfig } from './money'
import { demoTransport } from './demo'
import { createApi } from './api'
import type { Gasto } from './types'

const g = (id: string, monto: number, moneda: string, estado: Gasto['estado'] = 'Activo'): Gasto => ({
  fecha: '2026-10-05', monto, moneda, categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: id, medioPago: 'Yape', tipoGasto: 'Variable',
  ambito: 'Personal', esRecurrente: false, estado, origen: 'web', comprobanteUrl: '', id, creadoEn: 't', actualizadoEn: 't',
})
const RATES = { USD: 3.75 }

describe('totalesLista', () => {
  it('convierte el USD con el tipo de cambio y avisa de que es aproximado', () => {
    const t = totalesLista([g('a', 100, 'PEN'), g('b', 10, 'USD')], 'PEN', RATES)
    expect(t.cents).toBe(10000 + 3750)
    expect(t.convertido).toBe(true)
    expect(t.sinCambio).toEqual([])
  })
  it('solo moneda base: no es aproximado', () => {
    const t = totalesLista([g('a', 12.34, 'PEN')], 'PEN', RATES)
    expect(t).toMatchObject({ cents: 1234, convertido: false, anuladosCents: 0 })
  })
  it('los anulados no suman al total: se informan aparte', () => {
    const t = totalesLista([g('a', 100, 'PEN'), g('b', 40, 'PEN', 'Anulado'), g('c', 2, 'USD', 'Anulado')], 'PEN', RATES)
    expect(t.cents).toBe(10000)
    expect(t.anuladosCents).toBe(4000 + 750)
    expect(t.nAnulados).toBe(2)
  })
  it('sin tipo de cambio: no se suma ese movimiento y se avisa de qué moneda falta', () => {
    const t = totalesLista([g('a', 100, 'PEN'), g('b', 10, 'EUR'), g('c', 5, 'EUR')], 'PEN', RATES)
    expect(t.cents).toBe(10000)
    expect(t.sinCambio).toEqual(['EUR'])
    expect(t.nSinCambio).toBe(2)
  })
  it('coincide con el total del motor que usa el Dashboard (misma conversión, solo activos, mismas exclusiones)', async () => {
    const api = createApi(demoTransport('2026-10-09', 120, 0))
    const d = await api.getData(true)
    const rates = ratesFromConfig(d.config)
    expect(d.gastos.some(x => x.moneda === 'USD')).toBe(true)                      // la demo trae gastos en USD
    for (const r of [rates, {}]) {                                                  // con y sin tipo de cambio
      const motor = aggregate(d.gastos, { preset: 'custom', desde: '2000-01-01', hasta: '2099-12-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] },
        { base: 'PEN', rates: r, today: '2026-10-09', cajas: [], presupuestos: [] })
      const lista = totalesLista(d.gastos, 'PEN', r)
      expect(lista.cents).toBe(motor.total)
      expect(lista.nSinCambio).toBe(motor.excluidosSinTipoCambio)
    }
  })
})
