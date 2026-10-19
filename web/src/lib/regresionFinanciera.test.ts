import { describe, expect, it } from 'vitest'
import { aggregate, type Ctx } from './engine'
import { createApi, type Transport } from './api'
import type { Caja, Filters, Fondo, FondoMes, Gasto } from './types'

/**
 * Regresión financiera ANTES/DESPUÉS de la migración a Fondos del presupuesto. El motor no cambió de fórmulas: con los mismos
 * fondos (mismos importes, meses y reglas) debe dar exactamente las mismas cifras, y el tipo de fondo no mueve dinero.
 * Caso real: General 3,500 · Sodexo 280 · Carpeta Tésis 1,900 y Viaje a Ica 1,414 (ahorros asignados) · Extra 1 de 1,000 solo en octubre.
 */
const f = (id: string, nombre: string, monto: number, over: Partial<Fondo> = {}): Fondo => ({
  id, nombre, monto, moneda: 'PEN', color: '#000', icono: '', activo: true, orden: 1, recurrencia: 'mensual', mes: '', medioPago: '', tipo: 'mensual', creadoEn: '', actualizadoEn: '', ...over,
})
const caja = (id: string, presupuesto: number, filtroCampo: Caja['filtroCampo'] = 'Todos', filtroValor = ''): Caja => ({ id, nombre: id, presupuesto, filtroCampo, filtroValor, color: '#000', orden: 1 })
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
const ctx = (fondos: Fondo[], fondosMeses: FondoMes[] = []): Ctx => ({
  base: 'PEN', rates: {}, today: '2026-10-19', cajas: [caja('general-caja', 99999), caja('auto', 250, 'Categoría', 'Auto')], presupuestos: [], fondos, fondosMeses, aislarDesde: '2099-01',
})

describe('regresión financiera: antes y después de migrar', () => {
  it('el tipo de fondo no cambia el dinero: el consolidado de octubre es la suma de los fondos aplicados', () => {
    const sinTipo = FONDOS.map(x => ({ ...x, tipo: 'mensual' as const }))
    const a = aggregate([], mes('2026-10'), ctx(FONDOS)).cajas, b = aggregate([], mes('2026-10'), ctx(sinTipo)).cajas
    expect(a.presupuesto).toBe(b.presupuesto)
    expect(a.presupuesto).toBe((3500 + 280 + 1900 + 1414 + 1000) * 100)
    expect(a.libreInicial).toBe(b.libreInicial)
  })
  it('extras y ahorros de un mes solo cuentan en su período; el historial de octubre no cambia al editar noviembre', () => {
    const oct = aggregate([g({ monto: 100 })], mes('2026-10'), ctx(FONDOS)).cajas
    const nov = aggregate([], mes('2026-11'), ctx(FONDOS)).cajas
    expect(nov.presupuesto).toBe((3500 + 280) * 100)
    const novEditado = ctx(FONDOS, [{ fondoId: 'general', mes: '2026-11', monto: 4000, modo: 'solo' }])
    expect(aggregate([], mes('2026-11'), novEditado).cajas.presupuesto).toBe((4000 + 280) * 100)
    expect(aggregate([g({ monto: 100 })], mes('2026-10'), novEditado).cajas.presupuesto).toBe(oct.presupuesto)
    expect(aggregate([g({ monto: 100 })], mes('2026-10'), novEditado).cajas.gastadoPeriodo).toBe(oct.gastadoPeriodo)
  })
  it('las cajas son distribuciones internas: reservar no agrega presupuesto', () => {
    const a = aggregate([], mes('2026-10'), ctx(FONDOS)).cajas
    expect(a.presupuesto).toBe(aggregate([], mes('2026-10'), { ...ctx(FONDOS), cajas: [caja('general-caja', 1)] }).cajas.presupuesto)
    expect(a.reservado).toBe(25000)
    expect(a.libreInicial).toBe(a.presupuesto - a.reservado)
  })
  it('migración de datos: la misma hoja antes (sin tipo, nombres anteriores) y después da el mismo presupuesto y deduce el tipo', async () => {
    const fila = (id: string, nombre: string, monto: number, rec: string, m: string) => [id, nombre, monto, 'PEN', '#000', '', true, 1, rec, m, 'Libre', '', '']
    const base = { version: '1.25.1', sheetUrl: '', gastos: [], catalogo: [], medios: [], cajas: [['general-caja', 'General', 99999, 'Todos', '', '#000', 1]], presupuestos: [], config: { moneda: 'PEN' } }
    const antes: Transport = async () => ({ ...base, fuentes: [fila('general', 'General', 3500, 'mensual', ''), fila('tesis', 'Carpeta Tésis', 1900, 'unica', '2026-10'), fila('ica', 'Viaje a Ica', 1414, 'unica', '2026-10')], fuentesMeses: [] })
    const despues: Transport = async () => ({ ...base, fondos: [fila('general', 'General', 3500, 'mensual', ''), [...fila('tesis', 'Carpeta Tésis', 1900, 'unica', '2026-10'), 'ahorro_asignado'], [...fila('ica', 'Viaje a Ica', 1414, 'unica', '2026-10'), 'ahorro_asignado']], fondosMeses: [] })
    const A = await createApi(antes).getData(true), D = await createApi(despues).getData(true)
    const total = (d: typeof A) => aggregate([], mes('2026-10'), ctx(d.fondos!)).cajas.presupuesto
    expect(total(A)).toBe(total(D)); expect(total(D)).toBe((3500 + 1900 + 1414) * 100)
    expect(A.fondos!.map(x => x.tipo)).toEqual(['mensual', 'ahorro_asignado', 'ahorro_asignado'])
    expect(D.fondos!.map(x => x.tipo)).toEqual(['mensual', 'ahorro_asignado', 'ahorro_asignado'])
  })
})
