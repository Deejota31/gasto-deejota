import { describe, expect, it } from 'vitest'
import { candidatos, estadoRealPlantilla, idEntidadPlantilla, operacionPlantilla, recordatoriosVigentes, resumenMes, resumenReal, verificarEntidadesAplicadas, verificarPlantillasAplicadas } from './planificar'
import type { AppData, Caja, Fuente, PlantillaFin } from './types'

const f = (id: string, extra: Partial<Fuente> = {}): Fuente => ({ id, nombre: id, monto: 1000, moneda: 'PEN', color: '', icono: '', activo: true, orden: 1, recurrencia: 'mensual', mes: '', medioPago: '', ...extra } as Fuente)
const caja = (id: string, extra: Partial<Caja> = {}): Caja => ({ id, nombre: id, presupuesto: 300, filtroCampo: 'Categoría', filtroValor: 'X', color: '', icono: '', orden: 1, activo: true, ...extra } as Caja)
const data = (over: Partial<AppData> = {}): AppData => ({
  gastos: [], cajas: [caja('c1'), caja('g', { filtroCampo: 'Todos' })], presupuestos: [], fuentes: [f('f1'), f('f2', { recurrencia: 'unica', mes: '2026-11' })], fuentesMeses: [],
  config: { moneda: 'PEN' }, ...over,
} as unknown as AppData)

describe('planificar: candidatos y resumen por mes', () => {
  it('antes del corte todo cuenta como aplicado; desde el corte solo lo aplicado explícitamente', () => {
    const d = data()
    expect(candidatos(d, 'fuente', '2026-10').map(c => [c.id, c.aplicada])).toEqual([['f1', true]])
    const nov = candidatos(d, 'fuente', '2026-11')
    expect(nov).toEqual([{ id: 'f1', nombre: 'f1', moneda: 'PEN', aplicada: false, monto: 1000, previo: 1000 }])   // sugiere el mes anterior; no aplica nada
    expect(candidatos(d, 'subcaja', '2026-11')[0]).toMatchObject({ id: 'c1', aplicada: false, monto: 300, previo: 300 })
  })
  it('lo aplicado a noviembre no cambia octubre ni diciembre', () => {
    const d = data({ fuentesMeses: [{ fuenteId: 'f1', mes: '2026-11', monto: 1500, modo: 'solo' }], presupuestos: [{ periodo: '2026-11', cajaId: 'c1', monto: 450 }] })
    expect(candidatos(d, 'fuente', '2026-11')[0]).toMatchObject({ aplicada: true, monto: 1500 })
    expect(candidatos(d, 'fuente', '2026-12')[0]).toMatchObject({ aplicada: false, previo: 1500 })
    expect(candidatos(d, 'fuente', '2026-10')[0]).toMatchObject({ aplicada: true, monto: 1000 })
    expect(candidatos(d, 'subcaja', '2026-11')[0]).toMatchObject({ aplicada: true, monto: 450 })
    expect(candidatos(d, 'subcaja', '2026-12')[0]).toMatchObject({ aplicada: false, previo: 450 })
  })
  it('resumen cuenta aplicadas y gastos reales del mes', () => {
    const d = data({ gastos: [{ fecha: '2026-11-03' }, { fecha: '2026-10-30' }] as never })
    expect(resumenMes(d, '2026-11')).toMatchObject({ fuentes: 0, subcajas: 0, gastos: 1 })
    expect(resumenMes(d, '2026-10')).toMatchObject({ fuentes: 1, subcajas: 1, gastos: 1 })
  })
  it('recordatorios: no se avisa por meses anteriores al corte de aislamiento', () => {
    const d = data()
    expect(recordatoriosVigentes(d, '2026-11-01').map(r => r.mes)).toEqual(['2026-11'])
    expect(recordatoriosVigentes(d, '2026-12-05').map(r => r.mes)).toEqual(['2026-12', '2026-11'])
  })
})

const pl = (over: Partial<PlantillaFin> = {}): PlantillaFin => ({ id: 'pf-1', tipo: 'fuente', nombre: 'f1', monto: 1000, moneda: 'PEN', medios: '', campo: '', valor: '', descripcion: '', color: '', icono: '', recurrencia: 'mensual', activo: true, orden: 1, origenId: 'f1', estados: {}, creadoEn: '', actualizadoEn: '', ...over })

describe('v1.20: estado real, operación y verificación de plantillas', () => {
  it('idEntidadPlantilla respeta prefijo y límite (fuente 60, subcaja 40) y quita el pf- si no cabe', () => {
    expect(idEntidadPlantilla({ id: 'pf-abc', tipo: 'fuente' })).toBe('f-pf-abc')
    const largo = 'pf-' + 'a'.repeat(50)
    expect(idEntidadPlantilla({ id: largo, tipo: 'subcaja' })).toHaveLength(40)
    expect(idEntidadPlantilla({ id: largo, tipo: 'subcaja' }).startsWith('c-a')).toBe(true)
  })
  it('estado real: depende de la aplicación en el mes, no de la marca; omitida gana; mes histórico no se altera', () => {
    const d = data({ fuentesMeses: [{ fuenteId: 'f1', mes: '2026-11', monto: 1500, modo: 'solo' }] })
    expect(estadoRealPlantilla(pl(), '2026-11', d)).toBe('aplicada')
    expect(estadoRealPlantilla(pl(), '2026-12', d)).toBe('pendiente')              // sin aplicación en diciembre
    expect(estadoRealPlantilla(pl({ estados: { '2026-12': { e: 'omitida', m: 0 } } }), '2026-12', d)).toBe('omitida')
    expect(estadoRealPlantilla(pl(), '2026-10', d)).toBe('historica')              // anterior al corte: no se reescribe
    expect(estadoRealPlantilla(pl({ origenId: '', id: 'zz' }), '2026-11', d)).toBe('pendiente')   // sin entidad
  })
  it('operación: crear / actualizar / sin cambios', () => {
    const d = data({ fuentesMeses: [{ fuenteId: 'f1', mes: '2026-11', monto: 1500, modo: 'solo' }] })
    expect(operacionPlantilla(pl(), '2026-11', 1500, d).op).toBe('sin_cambios')
    expect(operacionPlantilla(pl(), '2026-11', 1600, d)).toMatchObject({ op: 'actualizar', actual: 150000 })
    expect(operacionPlantilla(pl(), '2026-12', 1500, d).op).toBe('crear')
    expect(operacionPlantilla(pl({ origenId: '', id: 'zz' }), '2026-11', 10, d)).toMatchObject({ op: 'crear', entidadExiste: false })
  })
  it('verificación contra datos releídos: detecta lo que no quedó guardado', () => {
    const vacio = data()
    const ok = data({ fuentesMeses: [{ fuenteId: 'f1', mes: '2026-11', monto: 1500, modo: 'solo' }] })
    expect(verificarPlantillasAplicadas(ok, [{ plantilla: pl(), monto: 1500 }], '2026-11')).toEqual([])
    expect(verificarPlantillasAplicadas(vacio, [{ plantilla: pl(), monto: 1500 }], '2026-11')[0]).toMatch(/no quedó aplicada/)
    expect(verificarPlantillasAplicadas(ok, [{ plantilla: pl(), monto: 999 }], '2026-11')[0]).toMatch(/importe guardado no coincide/)
    expect(verificarPlantillasAplicadas(ok, [{ plantilla: pl({ origenId: '', id: 'zz' }), monto: 1 }], '2026-11')[0]).toMatch(/no se encontró/)
    expect(verificarEntidadesAplicadas(ok, 'fuente', '2026-11', [{ id: 'f1', monto: 1500 }])).toEqual([])
    expect(verificarEntidadesAplicadas(vacio, 'fuente', '2026-11', [{ id: 'f1', monto: 1500 }])[0]).toMatch(/no quedó aplicada/)
    expect(verificarEntidadesAplicadas(ok, 'fuente', '2026-11', [{ id: 'nope', monto: 1 }])[0]).toMatch(/No se encontró/)
  })
  it('resumen real: cuenta solo lo aplicado y los gastos activos del mes', () => {
    const d = data({
      fuentesMeses: [{ fuenteId: 'f1', mes: '2026-11', monto: 1500, modo: 'solo' }], presupuestos: [{ periodo: '2026-11', cajaId: 'c1', monto: 450 }],
      gastos: [{ fecha: '2026-11-03', monto: 10.5, moneda: 'PEN', estado: 'Activo' }, { fecha: '2026-11-04', monto: 5, moneda: 'PEN', estado: 'Anulado' }, { fecha: '2026-10-30', monto: 7, moneda: 'PEN', estado: 'Activo' }] as never,
    })
    const r = resumenReal(d, '2026-11')
    expect(r.fuentes).toEqual({ n: 1, totales: { PEN: 150000 } })
    expect(r.subcajas).toEqual({ n: 1, reservado: 45000 })
    expect(r.gastos).toEqual({ n: 1, totales: { PEN: 1050 } })
    expect(resumenReal(data(), '2026-11')).toMatchObject({ fuentes: { n: 0 }, subcajas: { n: 0 }, gastos: { n: 0 } })   // omitido/sin hacer ≠ ejecutado
  })
})
