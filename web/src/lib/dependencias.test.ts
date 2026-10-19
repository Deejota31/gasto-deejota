import { describe, expect, it } from 'vitest'
import { aggregate, type Ctx } from './engine'
import { dependenciasCaja, dependenciasFondo } from './dependencias'
import type { AppData, Caja, Filters, Fondo, FondoMes, Gasto } from './types'

const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const fu = (id: string, monto: number, over: Partial<Fondo> = {}): Fondo => ({
  id, nombre: id, monto, moneda: 'PEN', color: '#000000', icono: '', activo: true, orden: 1, recurrencia: 'mensual', mes: '', medioPago: '',
  creadoEn: '', actualizadoEn: '', ...over,
})
const caja = (id: string, presupuesto: number, filtroCampo: Caja['filtroCampo'], filtroValor: string, orden = 2): Caja =>
  ({ id, nombre: id, presupuesto, filtroCampo, filtroValor, color: '#000000', orden })
const data = (over: Partial<AppData>): AppData => ({
  version: 't', sheetUrl: '', gastos: [], catalogo: [], medios: [], cajas: [], presupuestos: [], config: { moneda: 'PEN' }, fondos: [], fondosMeses: [], vinculos: [], revisiones: [], ...over,
} as AppData)
const HOY = '2026-10-10'

describe('dependencias antes de eliminar (v1.12)', () => {
  it('fondo con medio de pago: cuenta los gastos de TODO el historial atribuidos a ella; sin gastos, 0', () => {
    const d = data({ fondos: [fu('general', 3500), fu('sodexo', 280, { medioPago: 'Sodexo', orden: 2 }), fu('vacia', 10, { medioPago: 'Plin', orden: 3 })],
      gastos: [g({ medioPago: 'Sodexo', fecha: '2025-03-01' }), g({ medioPago: 'Sodexo' }), g({ medioPago: 'Yape' }), g({ medioPago: 'Sodexo', estado: 'Anulado' })] })
    expect(dependenciasFondo(d.fondos![1], d, HOY).gastos).toBe(2)       // el anulado no cuenta; el de 2025 sí
    expect(dependenciasFondo(d.fondos![2], d, HOY).gastos).toBe(0)
    expect(dependenciasFondo(d.fondos![0], d, HOY).gastos).toBe(1)       // General (principal) recibe lo que no es de Sodexo/Plin
  })

  it('fondo libre secundaria: solo tiene gastos si la cascada le llegó; los importes por mes se cuentan aparte', () => {
    const meses: FondoMes[] = [{ fondoId: 'ica', mes: '2026-10', monto: 50, modo: 'solo' }, { fondoId: 'otra', mes: '2026-10', monto: 5, modo: 'solo' }]
    const poco = data({ fondos: [fu('general', 3500), fu('ica', 1000, { orden: 2 })], fondosMeses: meses, gastos: [g({ monto: 100 })] })
    expect(dependenciasFondo(poco.fondos![1], poco, HOY)).toEqual({ gastos: 0, ajustes: 1 })
    const mucho = { ...poco, gastos: [g({ monto: 4000 })] }                 // agota General y pasa a Ica
    expect(dependenciasFondo(mucho.fondos![1], mucho, HOY).gastos).toBe(1)
  })

  it('subcaja: gastos de todo el historial que coinciden con su alcance y ajustes mensuales', () => {
    const c = caja('c1', 100, 'Categoría', 'Alimentación')
    const d = data({ cajas: [c], presupuestos: [{ periodo: '2026-10', cajaId: 'c1', monto: 90 }], gastos: [g({}), g({ categoria: 'Auto', subcategoria: 'Gasolina' }), g({ estado: 'Anulado' })] })
    expect(dependenciasCaja(c, d)).toEqual({ gastos: 1, presupuestos: 1 })
    expect(dependenciasCaja(caja('c2', 1, 'Categoría', 'Mascotas'), d).gastos).toBe(0)
  })
})

describe('montos: base registrado vs ajuste vs aporte efectivo del período', () => {
  const oct: Filters = { preset: 'mes', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
  const nov: Filters = { ...oct, desde: '2026-11-01', hasta: '2026-11-30' }
  const ctx = (fondos: Fondo[], fondosMeses: FondoMes[]): Ctx => ({ base: 'PEN', rates: {}, today: HOY, cajas: [], presupuestos: [], fondos, fondosMeses })

  it('un ajuste del mes cambia solo ese mes (Sodexo 280 → 282.90 y Carpeta Tesis 1,000 → 1,900) y se marca como ajustado', () => {
    const fondos = [fu('sodexo', 280, { medioPago: 'Sodexo' }), fu('tesis', 1000, { orden: 2 })]
    const meses: FondoMes[] = [{ fondoId: 'sodexo', mes: '2026-10', monto: 282.9, modo: 'solo' }, { fondoId: 'tesis', mes: '2026-10', monto: 1900, modo: 'solo' }]
    const o = aggregate([], oct, ctx(fondos, meses)).cajas.fondos.lista
    expect(o.map(x => [x.fondo.id, x.asignado, x.ajustado])).toEqual([['sodexo', 28290, true], ['tesis', 190000, true]])
    const n = aggregate([], nov, ctx(fondos, meses)).cajas.fondos.lista
    expect(n.map(x => [x.fondo.id, x.asignado, x.ajustado])).toEqual([['sodexo', 28000, false], ['tesis', 100000, false]])   // la hoja FONDOS_PRESUPUESTO (base) sigue en 280 y 1,000
  })
})

import { dependenciasCategoria } from './dependencias'
import type { CatalogoItem, Plantilla } from './types'

describe('dependencias de una categoría (v1.15)', () => {
  const cat = (ambito: string, categoria: string, subcategoria: string): CatalogoItem => ({ ambito, categoria, subcategoria, activo: true })
  const pl = (over: Partial<Plantilla>): Plantilla => ({ id: 'p', ambito: 'Personal', categoria: 'Salud', subcategoria: 'Dentista', descripcion: 'x', creadoEn: '', actualizadoEn: '', monto: null, moneda: 'PEN', medioPago: '', orden: null, esCompromiso: false, tipoGasto: 'Variable', esRecurrente: false, ...over })
  const catalogo = [cat('Personal', 'Salud', 'Dentista'), cat('Personal', 'Salud', 'Farmacia'), cat('Personal', 'Ocio', 'Cine'), cat('Hogar', 'Ocio', 'Juegos')]

  it('cuenta gastos (también anulados), plantillas y compromisos; solo de ese ámbito+categoría', () => {
    const d = data({ catalogo, gastos: [g({ categoria: 'Salud' }), g({ categoria: 'Salud', estado: 'Anulado' }), g({ categoria: 'Ocio' }), g({ categoria: 'Salud', ambito: 'Hogar' })] })
    const r = dependenciasCategoria('Personal', 'Salud', d, [pl({}), pl({ id: 'q', esCompromiso: true }), pl({ id: 'r', categoria: 'Ocio' })])
    expect(r).toMatchObject({ gastos: 2, plantillas: 2, compromisos: 1, cajas: 0, subcategorias: 2 })
  })
  it('subcajas: por categoría o por subcategoría, salvo que esa opción exista también en otro ámbito', () => {
    const d = data({ catalogo, cajas: [caja('c1', 10, 'Categoría', 'Salud'), caja('c2', 10, 'Subcategoría', 'Dentista'), caja('c3', 10, 'Categoría', 'Ocio'), caja('c4', 10, 'Ámbito', 'Personal')] })
    expect(dependenciasCategoria('Personal', 'Salud', d, []).cajas).toBe(2)
    expect(dependenciasCategoria('Personal', 'Ocio', d, []).cajas).toBe(0)   // “Ocio” también existe en Hogar: la subcaja sigue viva
  })
  it('una categoría sin uso devuelve todo en cero', () => {
    expect(dependenciasCategoria('Personal', 'Ocio', data({ catalogo }), [])).toMatchObject({ gastos: 0, plantillas: 0, compromisos: 0, cajas: 0 })
  })
})
