import { describe, expect, it } from 'vitest'
import { aggregate, type Ctx } from './engine'
import { dependenciasCaja, dependenciasFuente } from './dependencias'
import type { AppData, Caja, Filters, Fuente, FuenteMes, Gasto } from './types'

const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const fu = (id: string, monto: number, over: Partial<Fuente> = {}): Fuente => ({
  id, nombre: id, monto, moneda: 'PEN', color: '#000000', icono: '', activo: true, orden: 1, recurrencia: 'mensual', mes: '', medioPago: '',
  creadoEn: '', actualizadoEn: '', ...over,
})
const caja = (id: string, presupuesto: number, filtroCampo: Caja['filtroCampo'], filtroValor: string, orden = 2): Caja =>
  ({ id, nombre: id, presupuesto, filtroCampo, filtroValor, color: '#000000', orden })
const data = (over: Partial<AppData>): AppData => ({
  version: 't', sheetUrl: '', gastos: [], catalogo: [], medios: [], cajas: [], presupuestos: [], config: { moneda: 'PEN' }, fuentes: [], fuentesMeses: [], vinculos: [], revisiones: [], ...over,
} as AppData)
const HOY = '2026-10-10'

describe('dependencias antes de eliminar (v1.12)', () => {
  it('fuente con medio de pago: cuenta los gastos de TODO el historial atribuidos a ella; sin gastos, 0', () => {
    const d = data({ fuentes: [fu('general', 3500), fu('sodexo', 280, { medioPago: 'Sodexo', orden: 2 }), fu('vacia', 10, { medioPago: 'Plin', orden: 3 })],
      gastos: [g({ medioPago: 'Sodexo', fecha: '2025-03-01' }), g({ medioPago: 'Sodexo' }), g({ medioPago: 'Yape' }), g({ medioPago: 'Sodexo', estado: 'Anulado' })] })
    expect(dependenciasFuente(d.fuentes![1], d, HOY).gastos).toBe(2)       // el anulado no cuenta; el de 2025 sí
    expect(dependenciasFuente(d.fuentes![2], d, HOY).gastos).toBe(0)
    expect(dependenciasFuente(d.fuentes![0], d, HOY).gastos).toBe(1)       // General (principal) recibe lo que no es de Sodexo/Plin
  })

  it('fuente libre secundaria: solo tiene gastos si la cascada le llegó; los importes por mes se cuentan aparte', () => {
    const meses: FuenteMes[] = [{ fuenteId: 'ica', mes: '2026-10', monto: 50, modo: 'solo' }, { fuenteId: 'otra', mes: '2026-10', monto: 5, modo: 'solo' }]
    const poco = data({ fuentes: [fu('general', 3500), fu('ica', 1000, { orden: 2 })], fuentesMeses: meses, gastos: [g({ monto: 100 })] })
    expect(dependenciasFuente(poco.fuentes![1], poco, HOY)).toEqual({ gastos: 0, ajustes: 1 })
    const mucho = { ...poco, gastos: [g({ monto: 4000 })] }                 // agota General y pasa a Ica
    expect(dependenciasFuente(mucho.fuentes![1], mucho, HOY).gastos).toBe(1)
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
  const ctx = (fuentes: Fuente[], fuentesMeses: FuenteMes[]): Ctx => ({ base: 'PEN', rates: {}, today: HOY, cajas: [], presupuestos: [], fuentes, fuentesMeses })

  it('un ajuste del mes cambia solo ese mes (Sodexo 280 → 282.90 y Carpeta Tesis 1,000 → 1,900) y se marca como ajustado', () => {
    const fuentes = [fu('sodexo', 280, { medioPago: 'Sodexo' }), fu('tesis', 1000, { orden: 2 })]
    const meses: FuenteMes[] = [{ fuenteId: 'sodexo', mes: '2026-10', monto: 282.9, modo: 'solo' }, { fuenteId: 'tesis', mes: '2026-10', monto: 1900, modo: 'solo' }]
    const o = aggregate([], oct, ctx(fuentes, meses)).cajas.fuentes.lista
    expect(o.map(x => [x.fuente.id, x.asignado, x.ajustado])).toEqual([['sodexo', 28290, true], ['tesis', 190000, true]])
    const n = aggregate([], nov, ctx(fuentes, meses)).cajas.fuentes.lista
    expect(n.map(x => [x.fuente.id, x.asignado, x.ajustado])).toEqual([['sodexo', 28000, false], ['tesis', 100000, false]])   // la hoja FUENTES (base) sigue en 280 y 1,000
  })
})
