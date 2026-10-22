import { describe, expect, it } from 'vitest'
import { aggregate, aislaDesde, budgetCents, fondoMontoMes, type Ctx } from './engine'
import type { Caja, Filters, Fondo, FondoMes, Gasto, Presupuesto } from './types'

/**
 * Regresión de frontera de meses (auditoría 2026-10-22, RN-01..RN-13): octubre conserva el comportamiento histórico,
 * noviembre y diciembre aíslan por mes. Tolerancia monetaria CERO: todo se compara en céntimos enteros con toBe.
 */
const f = (id: string, monto: number, over: Partial<Fondo> = {}): Fondo => ({
  id, nombre: id, monto, moneda: 'PEN', color: '#000', icono: '', activo: true, orden: 1, recurrencia: 'mensual', mes: '', medioPago: '', tipo: 'mensual', creadoEn: '', actualizadoEn: '', ...over,
})
const caja = (id: string, presupuesto: number, filtroCampo: Caja['filtroCampo'] = 'Todos', filtroValor = ''): Caja => ({ id, nombre: id, presupuesto, filtroCampo, filtroValor, color: '#000', orden: 1 })
const mes = (m: string, hasta = '28'): Filters => ({ preset: 'custom', desde: `${m}-01`, hasta: `${m}-${hasta}`, ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] })
let n = 0
const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '', medioPago: 'Yape', tipoGasto: 'Variable',
  ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web', comprobanteUrl: '', id: `g${++n}`, creadoEn: '', actualizadoEn: '', ...over,
})
const FONDOS = [f('general', 3500), f('sodexo', 280, { medioPago: 'Sodexo' }), f('extra', 1000, { tipo: 'extra', recurrencia: 'unica', mes: '2026-10' })]
const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  base: 'PEN', rates: {}, today: '2026-10-22', cajas: [caja('general-caja', 99999), caja('auto', 250, 'Categoría', 'Auto')], presupuestos: [], fondos: FONDOS, fondosMeses: [], aislarDesde: aislaDesde(), ...over,
})
const C = (gs: Gasto[], m: string, c = ctx()) => aggregate(gs, mes(m), c).cajas

describe('frontera octubre → noviembre → diciembre 2026', () => {
  it('RN-01 el corte por defecto es 2026-11 y es configurable', () => {
    expect(aislaDesde()).toBe('2026-11')
    expect(aislaDesde({ aislamiento_desde: '2027-01' })).toBe('2027-01')
    expect(aislaDesde({ aislamiento_desde: 'basura' })).toBe('2026-11')
  })
  it('RN-02 octubre arrastra fondos mensuales y suma el extra de su mes, al céntimo', () => {
    expect(C([], '2026-10').presupuesto).toBe((3500 + 280 + 1000) * 100)
  })
  it('RN-03 noviembre sin aplicación explícita NO hereda el importe mensual: presupuesto 0', () => {
    expect(C([], '2026-11').presupuesto).toBe(0)
    expect(C([], '2026-12').presupuesto).toBe(0)
  })
  it('RN-04 noviembre solo cuenta lo aplicado a ese mes y no contamina diciembre', () => {
    const fm: FondoMes[] = [{ fondoId: 'general', mes: '2026-11', monto: 3600, modo: 'solo' }, { fondoId: 'sodexo', mes: '2026-11', monto: 280, modo: 'solo' }]
    const c = ctx({ fondosMeses: fm })
    expect(C([], '2026-11', c).presupuesto).toBe((3600 + 280) * 100)
    expect(C([], '2026-12', c).presupuesto).toBe(0)
    expect(C([], '2026-10', c).presupuesto).toBe((3500 + 280 + 1000) * 100)
  })
  it('RN-05 un fondo "desde" no se propaga tras el corte (solo manda "solo ese mes")', () => {
    const r = fondoMontoMes(FONDOS[0], '2026-12', [{ fondoId: 'general', mes: '2026-10', monto: 9999, modo: 'desde' }], '2026-11')
    expect(r).toEqual({ monto: 0, ajustado: false, aplicada: false })
    expect(fondoMontoMes(FONDOS[0], '2026-10', [{ fondoId: 'general', mes: '2026-10', monto: 4000, modo: 'desde' }], '2026-11').monto).toBe(4000)
  })
  it('RN-06 el fondo único solo existe en su mes (octubre sí, noviembre y diciembre no)', () => {
    for (const [m, esperado] of [['2026-10', 1000], ['2026-11', 0], ['2026-12', 0]] as const) expect(fondoMontoMes(FONDOS[2], m, [], '2026-11').monto).toBe(esperado)
  })
  it('RN-07 una subcaja no reserva en noviembre si no se aplicó; con aplicación explícita reserva exactamente lo aplicado', () => {
    const auto = caja('auto', 250, 'Categoría', 'Auto')
    expect(budgetCents(auto, '2026-11', [], '2026-11')).toBe(0)
    expect(budgetCents(auto, '2026-10', [], '2026-11')).toBe(25000)
    const p: Presupuesto[] = [{ periodo: '2026-11', cajaId: 'auto', monto: 120.5 }]
    expect(budgetCents(auto, '2026-11', p, '2026-11')).toBe(12050)
    expect(budgetCents(auto, '2026-12', p, '2026-11')).toBe(0)
  })
  it('RN-08 las cajas no duplican presupuesto: reservado ≤ presupuesto y libre = P − R', () => {
    const c = C([], '2026-10')
    expect(c.presupuesto).toBe(478000)
    expect(c.reservado).toBe(25000)
    expect(c.libreInicial).toBe(c.presupuesto - c.reservado)
  })
  it('RN-09 el cuadre se mantiene con gastos: disponible = P − gastado y = saldoLibre + reservasSinUsar', () => {
    const gs = [g({ monto: 33.33 }), g({ categoria: 'Auto', subcategoria: 'Gasolina', monto: 100.1 }), g({ categoria: 'Auto', subcategoria: 'Peaje', monto: 200.2 })]
    const c = C(gs, '2026-10')
    expect(c.gastadoPeriodo).toBe(3333 + 10010 + 20020)
    expect(c.disponible).toBe(c.presupuesto - c.gastadoPeriodo)
    expect(c.disponible).toBe(c.saldoLibre + c.reservasSinUsar)
    expect(c.excesoSubcajas).toBe(20020 + 10010 - 25000)
  })
  it('RN-10 los gastos anulados y los de otro mes no entran al período', () => {
    const gs = [g({ monto: 50, estado: 'Anulado' }), g({ monto: 70, fecha: '2026-11-02' }), g({ monto: 5, fecha: '2026-09-30' }), g({ monto: 11 })]
    expect(C(gs, '2026-10').gastadoPeriodo).toBe(1100)
    expect(C(gs, '2026-11', ctx({ fondosMeses: [{ fondoId: 'general', mes: '2026-11', monto: 100, modo: 'solo' }] })).gastadoPeriodo).toBe(7000)
  })
  it('RN-11 el último día de octubre y el primero de noviembre caen en su mes, sin doble conteo', () => {
    const gs = [g({ fecha: '2026-10-31', monto: 1.01 }), g({ fecha: '2026-11-01', monto: 2.02 })]
    const oct = aggregate(gs, mes('2026-10', '31'), ctx()).cajas.gastadoPeriodo
    const nov = aggregate(gs, mes('2026-11', '30'), ctx()).cajas.gastadoPeriodo
    expect(oct).toBe(101)
    expect(nov).toBe(202)
    expect(aggregate(gs, { ...mes('2026-10'), hasta: '2026-11-30' }, ctx()).cajas.gastadoPeriodo).toBe(303)
  })
  it('RN-12 editar noviembre o diciembre no altera ni un céntimo de octubre', () => {
    const gs = [g({ monto: 12.34 })]
    const base = C(gs, '2026-10')
    const editado = ctx({ fondosMeses: [{ fondoId: 'general', mes: '2026-11', monto: 1, modo: 'solo' }, { fondoId: 'general', mes: '2026-12', monto: 2, modo: 'solo' }] })
    const c = C(gs, '2026-10', editado)
    expect([c.presupuesto, c.gastadoPeriodo, c.disponible, c.reservado]).toEqual([base.presupuesto, base.gastadoPeriodo, base.disponible, base.reservado])
  })
  it('RN-13 sumas decimales sin deriva: 0.1 × 30 gastos = 3.00 exacto', () => {
    const gs = Array.from({ length: 30 }, () => g({ monto: 0.1 }))
    expect(C(gs, '2026-10').gastadoPeriodo).toBe(300)
  })
})
