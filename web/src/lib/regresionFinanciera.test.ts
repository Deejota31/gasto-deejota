import { describe, expect, it } from 'vitest'
import { aggregate, type Ctx } from './engine'
import { createApi, type Transport } from './api'
import type { Filters, Fondo, FondoMes, Gasto } from './types'

/**
 * Regresión del modelo vigente: con los mismos fondos (importes, meses y reglas),
 * los cálculos deben mantenerse y el tipo de fondo no modifica el dinero.
 * Caso real: General 3,500 · Sodexo 280 · Carpeta Tésis 1,900 y Viaje a Ica 1,414 (ahorros asignados) · Extra 1 de 1,000 solo en octubre.
 * v1.28: los fondos son la única estructura; una respuesta 1.27 con cajas se lee igual y las cajas se ignoran.
 */
const f = (id: string, nombre: string, monto: number, over: Partial<Fondo> = {}): Fondo => ({
  id, nombre, monto, moneda: 'PEN', color: '#000', icono: '', activo: true, orden: 1, recurrencia: 'mensual', mes: '', medioPago: '', tipo: 'mensual', creadoEn: '', actualizadoEn: '', reglas: [], ...over,
})
const mes = (m: string): Filters => ({ preset: 'custom', desde: `${m}-01`, hasta: `${m}-28`, ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] })
const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '', medioPago: 'Yape', tipoGasto: 'Variable',
  ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web', comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const FONDOS: Fondo[] = [
  f('general', 'General', 3500), f('sodexo', 'Sodexo', 280, { medioPago: 'Sodexo' }),
  f('tesis', 'Carpeta Tésis', 1900, { tipo: 'ahorro_asignado', recurrencia: 'unica', mes: '2026-10' }),
  f('ica', 'Viaje a Ica', 1414, { tipo: 'ahorro_asignado', recurrencia: 'unica', mes: '2026-10' }),
  f('extra1', 'Extra 1', 1000, { tipo: 'extra', recurrencia: 'unica', mes: '2026-10' }),
]
const ctx = (fondos: Fondo[], fondosMeses: FondoMes[] = []): Ctx => ({ base: 'PEN', rates: {}, today: '2026-10-19', fondos, fondosMeses, aislarDesde: '2099-01' })
const P = (gs: Gasto[], m: string, c: Ctx) => aggregate(gs, mes(m), c).presupuesto

describe('regresión financiera: invariantes del presupuesto vigente', () => {
  it('el tipo de fondo no cambia el dinero: el consolidado de octubre es la suma de los fondos aplicados', () => {
    const sinTipo = FONDOS.map(x => ({ ...x, tipo: 'mensual' as const }))
    const a = P([g({ monto: 120 })], '2026-10', ctx(FONDOS)), b = P([g({ monto: 120 })], '2026-10', ctx(sinTipo))
    expect(a.presupuesto).toBe(b.presupuesto)
    expect(a.presupuesto).toBe((3500 + 280 + 1900 + 1414 + 1000) * 100)
    expect(a.fondos.map(x => x.gastado)).toEqual(b.fondos.map(x => x.gastado))
  })
  it('extras y ahorros de un mes solo cuentan en su período; el historial de octubre no cambia al editar noviembre', () => {
    const oct = P([g({ monto: 100 })], '2026-10', ctx(FONDOS))
    expect(P([], '2026-11', ctx(FONDOS)).presupuesto).toBe((3500 + 280) * 100)
    const novEditado = ctx(FONDOS, [{ fondoId: 'general', mes: '2026-11', monto: 4000, modo: 'solo' }])
    expect(P([], '2026-11', novEditado).presupuesto).toBe((4000 + 280) * 100)
    expect(P([g({ monto: 100 })], '2026-10', novEditado).presupuesto).toBe(oct.presupuesto)
    expect(P([g({ monto: 100 })], '2026-10', novEditado).gastadoPeriodo).toBe(oct.gastadoPeriodo)
  })
  it('una regla nueva desde noviembre no cambia el reparto de octubre (reglas versionadas)', () => {
    const sodexoRestringido = { ...FONDOS[1], reglas: [
      { desde: '', medios: 'solo' as const, listaMedios: ['Sodexo'], cobertura: 'todos' as const, rutas: [], restringeMedio: false },
      { desde: '2026-11', medios: 'solo' as const, listaMedios: ['Sodexo'], cobertura: 'categoria' as const, rutas: [{ ambito: '', categoria: 'Alimentación', subcategoria: '' }], restringeMedio: true },
    ] }
    const fs = [FONDOS[0], sodexoRestringido]
    const oct = P([g({ monto: 50, medioPago: 'Sodexo', categoria: 'Auto' })], '2026-10', ctx(fs))
    expect(oct.fondos.find(x => x.fondo.id === 'sodexo')!.gastado).toBe(5000)   // octubre conserva su regla: cubre todo
    const nov = P([g({ fecha: '2026-11-05', monto: 50, medioPago: 'Sodexo', categoria: 'Auto' })], '2026-11', ctx(fs))
    expect(nov.incompatibles).toBe(1)                                          // noviembre: el medio quedó restringido a Alimentación
    expect(nov.sinFondo.cents).toBe(5000)
  })
  it('el contrato 1.27 (con cajas) se sigue leyendo: las cajas se ignoran y el consolidado no cambia', async () => {
    const fila = (id: string, nombre: string, monto: number, rec: string, m: string, tipo: string) =>
      [id, nombre, monto, 'PEN', '#000', '', true, 1, rec, m, 'Libre', '', '', tipo]
    const base = { version: '1.27.0', sheetUrl: '', gastos: [], catalogo: [], medios: [], cajas: [['general-caja', 'General', 99999, 'Todos', '', '#000', 1]], presupuestos: [], config: { moneda: 'PEN' } }
    const actual: Transport = async () => ({ ...base, fondos: [
      fila('general', 'General', 3500, 'mensual', '', 'mensual'),
      fila('tesis', 'Carpeta Tésis', 1900, 'unica', '2026-10', 'ahorro_asignado'),
      fila('ica', 'Viaje a Ica', 1414, 'unica', '2026-10', 'ahorro_asignado'),
    ], fondosMeses: [] })
    const datos = await createApi(actual).getData(true)
    expect(P([], '2026-10', ctx(datos.fondos!)).presupuesto).toBe((3500 + 1900 + 1414) * 100)
    expect(datos.fondos!.map(x => x.tipo)).toEqual(['mensual', 'ahorro_asignado', 'ahorro_asignado'])
    expect(datos).not.toHaveProperty('cajas')
  })
})
