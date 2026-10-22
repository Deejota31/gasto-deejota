import { describe, expect, it } from 'vitest'
import { aggregate, type Ctx } from './engine'
import { mediosDeFondo, tieneMedio, unirMedios } from './fondoMedios'
import type { Fondo, Filters, Gasto } from './types'

// v1.16: un fondo puede tener 0, 1 o varios medios; varios fondos pueden compartir un medio (escenarios A–F).
const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const fu = (id: string, monto: number, orden: number, medioPago = '', over: Partial<Fondo> = {}): Fondo => ({
  id, nombre: id, monto, moneda: 'PEN', color: '#000', icono: '', activo: true, orden, recurrencia: 'mensual', mes: '', medioPago, tipo: 'mensual', creadoEn: '', actualizadoEn: '', reglas: [], ...over,
})
const oct: Filters = { preset: 'mes', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
const run = (fondos: Fondo[], gastos: Gasto[]) => aggregate(gastos, oct, { base: 'PEN', rates: {}, today: '2026-10-10', fondos, fondosMeses: [] } as Ctx).presupuesto
const por = (r: ReturnType<typeof run>) => Object.fromEntries(r.fondos.map(x => [x.fondo.id, [x.aporta, x.gastado]]))

describe('medios de un fondo', () => {
  it('parsea, limpia y compara', () => {
    expect(mediosDeFondo('')).toEqual([])
    expect(mediosDeFondo('Libre')).toEqual([])
    expect(mediosDeFondo('Sodexo')).toEqual(['Sodexo']) // valor antiguo
    expect(mediosDeFondo(' Yape | plin |YAPE|Libre')).toEqual(['Yape', 'plin'])
    expect(unirMedios(['Yape', 'yape', 'Plin'])).toBe('Yape|Plin')
    expect(tieneMedio('Yape|Plin', 'plín')).toBe(true)
    expect(tieneMedio('Yape', 'Plin')).toBe(false)
  })
})

describe('atribución con varios medios (A–F)', () => {
  it('A: 0 medios = fondo libre, igual que antes', () => {
    const r = run([fu('gen', 1000, 1)], [g({ monto: 100 })])
    expect(por(r).gen).toEqual([100000, 10000])
  })
  it('B: 1 medio se comporta igual que el modelo anterior', () => {
    const r = run([fu('gen', 1000, 1), fu('sod', 280, 2, 'Sodexo')], [g({ monto: 100, medioPago: 'Sodexo' })])
    expect(por(r)).toEqual({ gen: [100000, 0], sod: [28000, 10000] })
  })
  it('C: varios medios en un fondo: el importe no se multiplica y atribuye cualquiera de sus medios', () => {
    const r = run([fu('gen', 1000, 1), fu('bil', 300, 2, 'Yape|Plin')], [g({ monto: 50, medioPago: 'Yape' }), g({ monto: 70, medioPago: 'Plin' }), g({ monto: 5, medioPago: 'Efectivo' })])
    expect(r.total).toBe(130000)                       // 1000 + 300, no 1000 + 600
    expect(por(r)).toEqual({ gen: [100000, 500], bil: [30000, 12000] })
  })
  it('D: dos fondos con el mismo medio: primero la de menor orden hasta su tope, luego la siguiente, sin doble conteo', () => {
    const r = run([fu('a', 100, 1, 'Sodexo'), fu('b', 100, 2, 'Sodexo')], [g({ monto: 150, medioPago: 'Sodexo' })])
    expect(por(r)).toEqual({ a: [10000, 10000], b: [10000, 5000] })
    expect(r.fondos.reduce((s, x) => s + x.gastado, 0)).toBe(15000)   // cada centavo una sola vez
    expect(r.fondos.map(x => x.count)).toEqual([1, 1])               // el movimiento cuenta una vez en cada fondo que toca
  })
  it('E: el exceso pasa al fondo que cubre todos los gastos; si no hay, queda como sobregiro en el primer fondo del medio', () => {
    const conLibre = run([fu('a', 100, 1, 'Sodexo'), fu('b', 100, 2, 'Sodexo'), fu('gen', 1000, 3)], [g({ monto: 250, medioPago: 'Sodexo' })])
    expect(por(conLibre)).toEqual({ a: [10000, 10000], b: [10000, 10000], gen: [100000, 5000] })
    const sinLibre = run([fu('a', 100, 1, 'Sodexo'), fu('b', 100, 2, 'Sodexo')], [g({ monto: 250, medioPago: 'Sodexo' })])
    expect(por(sinLibre)).toEqual({ a: [10000, 15000], b: [10000, 10000] })
  })
  it('F: si todos los fondos de un medio están inactivos el gasto lo cubre el fondo general; si uno está activo, ese lo recibe', () => {
    const inact = run([fu('gen', 1000, 1), fu('a', 100, 2, 'Plin', { activo: false }), fu('b', 100, 3, 'Plin', { activo: false })], [g({ monto: 40, medioPago: 'Plin' })])
    expect(inact.fondos.find(x => x.fondo.id === 'gen')!.gastado).toBe(4000)
    expect(inact.sinFondo.cents).toBe(0)
    const solo = run([fu('a', 100, 2, 'Plin', { activo: false })], [g({ monto: 40, medioPago: 'Plin' })])
    expect(solo.sinFondo).toEqual({ cents: 4000, count: 1 })
    const mixta = run([fu('a', 100, 1, 'Plin', { activo: false }), fu('b', 100, 2, 'Plin')], [g({ monto: 40, medioPago: 'Plin' })])
    expect(por(mixta).b).toEqual([10000, 4000])
    expect(mixta.sinFondo.cents).toBe(0)
  })
  it('el total atribuido siempre es igual al gastado (al azar, medios compartidos y múltiples)', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const medios = ['Yape', 'Plin', 'Sodexo', 'Efectivo']
    for (let k = 0; k < 200; k++) {
      const fs = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, i) =>
        fu(`f${i}`, Math.round(rnd() * 50000) / 100, i, rnd() > 0.4 ? unirMedios(medios.filter(() => rnd() > 0.6)) : '', { activo: rnd() > 0.2 }))
      const gs = Array.from({ length: Math.floor(rnd() * 25) }, () => g({ monto: Math.round(rnd() * 20000) / 100, medioPago: medios[Math.floor(rnd() * 4)] }))
      const r = run(fs, gs)
      expect(r.fondos.reduce((s, x) => s + x.gastado, 0) + r.sinFondo.cents).toBe(gs.reduce((s, x) => s + Math.round(x.monto * 100), 0))
    }
  })
})
