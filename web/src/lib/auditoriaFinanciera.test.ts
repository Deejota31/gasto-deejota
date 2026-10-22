import { describe, expect, it } from 'vitest'
import { aggregate, type Ctx } from './engine'
import type { Filters, Fondo, FondoMes, Gasto } from './types'

/**
 * Auditoría integral (casos límite). Los valores esperados se calcularon a mano, sin usar el motor:
 * todos los importes están en céntimos para evitar errores de coma flotante.
 */
const f = (id: string, monto: number, over: Partial<Fondo> = {}): Fondo => ({
  id, nombre: id, monto, moneda: 'PEN', color: '#000', icono: '', activo: true, orden: 1, recurrencia: 'mensual', mes: '', medioPago: '', tipo: 'mensual', creadoEn: '', actualizadoEn: '', reglas: [], ...over,
})
const mes = (m: string): Filters => ({ preset: 'custom', desde: `${m}-01`, hasta: `${m}-28`, ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] })
const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '', medioPago: 'Yape', tipoGasto: 'Variable',
  ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web', comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const ctx = (fondos: Fondo[], over: Partial<Ctx> = {}, meses: FondoMes[] = []): Ctx => ({
  base: 'PEN', rates: { USD: 4 }, today: '2026-10-19', fondos, fondosMeses: meses, aislarDesde: '2099-01', ...over,
})

describe('auditoría financiera: casos límite con cálculo independiente', () => {
  it('presupuesto cero: no hay porcentaje ni división entre cero y el disponible es el gasto en negativo', () => {
    const a = aggregate([g({ monto: 50 })], mes('2026-10'), ctx([]))
    expect(a.presupuesto.presupuesto).toBe(0)
    expect(a.presupuesto.disponible).toBe(-5000)
    expect(Number.isFinite(a.presupuesto.disponible)).toBe(true)
  })
  it('presupuesto agotado exacto: disponible 0', () => {
    const a = aggregate([g({ monto: 300 }), g({ monto: 200 })], mes('2026-10'), ctx([f('a', 500)]))
    expect(a.presupuesto.disponible).toBe(0)
  })
  it('sobregasto: 500 de presupuesto y 620.50 gastados → disponible −120.50', () => {
    const a = aggregate([g({ monto: 620.5 })], mes('2026-10'), ctx([f('a', 500)]))
    expect(a.presupuesto.disponible).toBe(-12050)
  })
  it('un fondo inactivo no suma al presupuesto', () => {
    const a = aggregate([], mes('2026-10'), ctx([f('a', 500), f('b', 300, { activo: false })]))
    expect(a.presupuesto.presupuesto).toBe(50000)
  })
  it('un fondo de un solo mes no aparece en el mes anterior ni en el siguiente', () => {
    const fondos = [f('base', 1000), f('extra', 250, { recurrencia: 'unica', mes: '2026-10', tipo: 'extra' })]
    expect(aggregate([], mes('2026-09'), ctx(fondos)).presupuesto.presupuesto).toBe(100000)
    expect(aggregate([], mes('2026-10'), ctx(fondos)).presupuesto.presupuesto).toBe(125000)
  })
  it('un gasto anulado no cuenta; editar su fecha lo mueve de período sin cambiar el otro', () => {
    const anulado = g({ monto: 80, estado: 'Anulado' })
    const movido = g({ monto: 40, fecha: '2026-09-20' })
    const oct = aggregate([anulado, movido, g({ monto: 10 })], mes('2026-10'), ctx([f('a', 500)]))
    const sep = aggregate([anulado, movido, g({ monto: 10 })], mes('2026-09'), ctx([f('a', 500)]))
    expect(oct.total).toBe(1000)
    expect(sep.total).toBe(4000)
  })
  it('decimales: 0.10 + 0.20 suma exactamente 30 céntimos', () => {
    const a = aggregate([g({ monto: 0.1 }), g({ monto: 0.2 })], mes('2026-10'), ctx([f('a', 1)]))
    expect(a.total).toBe(30)
    expect(a.presupuesto.disponible).toBe(70)
  })
  it('moneda distinta: USD 9 con tipo de cambio 4 equivale a PEN 36', () => {
    const a = aggregate([g({ monto: 9, moneda: 'USD' })], mes('2026-10'), ctx([f('a', 100)]))
    expect(a.total).toBe(3600)
    expect(a.presupuesto.disponible).toBe(6400)
  })
  it('USD sin tipo de cambio: se excluye y se informa, nunca se suma como PEN', () => {
    const a = aggregate([g({ monto: 9, moneda: 'USD' })], mes('2026-10'), ctx([f('a', 100)], { rates: {} }))
    expect(a.total).toBe(0)
    expect(a.excluidosSinTipoCambio).toBe(1)
  })
  it('montos elevados (9,999,999.99) conservan los céntimos', () => {
    const a = aggregate([g({ monto: 9999999.99 })], mes('2026-10'), ctx([f('a', 10000000)]))
    expect(a.total).toBe(999999999)
    expect(a.presupuesto.disponible).toBe(1)
  })
  it('gastos duplicados idénticos se suman (la detección es una alerta, no una exclusión)', () => {
    const a = aggregate([g({ monto: 100 }), g({ monto: 100 })], mes('2026-10'), ctx([f('a', 500)]))
    expect(a.total).toBe(20000)
  })
  it('dos fondos con la misma cobertura suman su capacidad: P = suma de fondos y el gasto se imputa una vez', () => {
    const auto = f('auto', 250, { orden: 2, reglas: [{ desde: '', medios: 'todos', listaMedios: [], cobertura: 'categoria', rutas: [{ ambito: '', categoria: 'Auto', subcategoria: '' }], restringeMedio: false }] })
    const a = aggregate([g({ monto: 30, categoria: 'Auto', subcategoria: 'Gas' })], mes('2026-10'), ctx([f('a', 1000), auto]))
    expect(a.presupuesto.presupuesto).toBe(125000)
    expect(a.presupuesto.disponible).toBe(122000)
    expect(a.presupuesto.fondos.map(x => x.gastado)).toEqual([0, 3000])
  })
})
