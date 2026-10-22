import { describe, expect, it } from 'vitest'
import { candidatos, estadoRealPlantilla, idEntidadPlantilla, operacionPlantilla, recordatoriosVigentes, resumenMes, resumenReal, verificarFondosAplicados, verificarPlantillasAplicadas } from './planificar'
import type { AppData, Fondo, PlantillaFin } from './types'

// v1.28: la planificación mensual solo aplica fondos (la etapa de subcajas se retiró con las cajas).
const f = (id: string, extra: Partial<Fondo> = {}): Fondo => ({ id, nombre: id, monto: 1000, moneda: 'PEN', color: '', icono: '', activo: true, orden: 1, recurrencia: 'mensual', mes: '', medioPago: '', tipo: 'mensual', reglas: [], ...extra } as Fondo)
const data = (over: Partial<AppData> = {}): AppData => ({
  gastos: [], fondos: [f('f1'), f('f2', { recurrencia: 'unica', mes: '2026-11' })], fondosMeses: [], config: { moneda: 'PEN' }, ...over,
} as unknown as AppData)

describe('planificar: candidatos y resumen por mes', () => {
  it('antes del corte todo cuenta como aplicado; desde el corte solo lo aplicado explícitamente', () => {
    const d = data()
    expect(candidatos(d, '2026-10').map(c => [c.id, c.aplicada])).toEqual([['f1', true]])
    expect(candidatos(d, '2026-11')).toEqual([{ id: 'f1', nombre: 'f1', moneda: 'PEN', aplicada: false, monto: 1000, previo: 1000 }])   // sugiere el mes anterior; no aplica nada
  })
  it('lo aplicado a noviembre no cambia octubre ni diciembre', () => {
    const d = data({ fondosMeses: [{ fondoId: 'f1', mes: '2026-11', monto: 1500, modo: 'solo' }] })
    expect(candidatos(d, '2026-11')[0]).toMatchObject({ aplicada: true, monto: 1500 })
    expect(candidatos(d, '2026-12')[0]).toMatchObject({ aplicada: false, previo: 1500 })
    expect(candidatos(d, '2026-10')[0]).toMatchObject({ aplicada: true, monto: 1000 })
  })
  it('resumen cuenta fondos aplicados y gastos reales del mes', () => {
    const d = data({ gastos: [{ fecha: '2026-11-03' }, { fecha: '2026-10-30' }] as never })
    expect(resumenMes(d, '2026-11')).toMatchObject({ fondos: 0, gastos: 1 })
    expect(resumenMes(d, '2026-10')).toMatchObject({ fondos: 1, gastos: 1 })
    expect(resumenMes(d, '2026-10')).not.toHaveProperty('subcajas')
  })
  it('recordatorios: no se avisa por meses anteriores al corte de aislamiento', () => {
    const d = data()
    expect(recordatoriosVigentes(d, '2026-11-01').map(r => r.mes)).toEqual(['2026-11'])
    expect(recordatoriosVigentes(d, '2026-12-05').map(r => r.mes)).toEqual(['2026-12', '2026-11'])
  })
})

const pl = (over: Partial<PlantillaFin> = {}): PlantillaFin => ({ id: 'pf-1', tipo: 'fondo', nombre: 'f1', monto: 1000, moneda: 'PEN', medios: '', descripcion: '', color: '', icono: '', recurrencia: 'mensual', activo: true, orden: 1, origenId: 'f1', estados: {}, creadoEn: '', actualizadoEn: '', ...over } as PlantillaFin)

describe('v1.20: estado real, operación y verificación de plantillas', () => {
  it('idEntidadPlantilla usa el prefijo de fondo y el límite de 60 caracteres', () => {
    expect(idEntidadPlantilla({ id: 'pf-abc', tipo: 'fondo' })).toBe('f-pf-abc')
    const largo = 'pf-' + 'a'.repeat(80)
    expect(idEntidadPlantilla({ id: largo, tipo: 'fondo' }).length).toBeLessThanOrEqual(60)
    expect(idEntidadPlantilla({ id: largo, tipo: 'fondo' }).startsWith('f-')).toBe(true)
  })
  it('estado real: depende de la aplicación en el mes, no de la marca; omitida gana; mes histórico no se altera', () => {
    const d = data({ fondosMeses: [{ fondoId: 'f1', mes: '2026-11', monto: 1500, modo: 'solo' }] })
    expect(estadoRealPlantilla(pl(), '2026-11', d)).toBe('aplicada')
    expect(estadoRealPlantilla(pl(), '2026-12', d)).toBe('pendiente')
    expect(estadoRealPlantilla(pl({ estados: { '2026-12': { e: 'omitida', m: 0 } } }), '2026-12', d)).toBe('omitida')
    expect(estadoRealPlantilla(pl(), '2026-10', d)).toBe('historica')
    expect(estadoRealPlantilla(pl({ origenId: '', id: 'zz' }), '2026-11', d)).toBe('pendiente')
  })
  it('operación: crear / actualizar / sin cambios', () => {
    const d = data({ fondosMeses: [{ fondoId: 'f1', mes: '2026-11', monto: 1500, modo: 'solo' }] })
    expect(operacionPlantilla(pl(), '2026-11', 1500, d).op).toBe('sin_cambios')
    expect(operacionPlantilla(pl(), '2026-11', 1600, d)).toMatchObject({ op: 'actualizar', actual: 150000 })
    expect(operacionPlantilla(pl(), '2026-12', 1500, d).op).toBe('crear')
    expect(operacionPlantilla(pl({ origenId: '', id: 'zz' }), '2026-11', 10, d)).toMatchObject({ op: 'crear', entidadExiste: false })
  })
  it('verificación contra datos releídos: detecta lo que no quedó guardado', () => {
    const vacio = data()
    const ok = data({ fondosMeses: [{ fondoId: 'f1', mes: '2026-11', monto: 1500, modo: 'solo' }] })
    expect(verificarPlantillasAplicadas(ok, [{ plantilla: pl(), monto: 1500 }], '2026-11')).toEqual([])
    expect(verificarPlantillasAplicadas(vacio, [{ plantilla: pl(), monto: 1500 }], '2026-11')[0]).toMatch(/no quedó aplicada/)
    expect(verificarPlantillasAplicadas(ok, [{ plantilla: pl(), monto: 999 }], '2026-11')[0]).toMatch(/importe guardado no coincide/)
    expect(verificarPlantillasAplicadas(ok, [{ plantilla: pl({ origenId: '', id: 'zz' }), monto: 1 }], '2026-11')[0]).toMatch(/no se encontró/)
    expect(verificarFondosAplicados(ok, '2026-11', [{ id: 'f1', monto: 1500 }])).toEqual([])
    expect(verificarFondosAplicados(vacio, '2026-11', [{ id: 'f1', monto: 1500 }])[0]).toMatch(/no quedó aplicad/)
    expect(verificarFondosAplicados(ok, '2026-11', [{ id: 'nope', monto: 1 }])[0]).toMatch(/No se encontró/)
  })
  it('resumen real: cuenta solo lo aplicado y los gastos activos del mes', () => {
    const d = data({
      fondosMeses: [{ fondoId: 'f1', mes: '2026-11', monto: 1500, modo: 'solo' }],
      gastos: [{ fecha: '2026-11-03', monto: 10.5, moneda: 'PEN', estado: 'Activo' }, { fecha: '2026-11-04', monto: 5, moneda: 'PEN', estado: 'Anulado' }, { fecha: '2026-10-30', monto: 7, moneda: 'PEN', estado: 'Activo' }] as never,
    })
    const r = resumenReal(d, '2026-11')
    expect(r.fondos).toEqual({ n: 1, totales: { PEN: 150000 } })
    expect(r.gastos).toEqual({ n: 1, totales: { PEN: 1050 } })
    expect(resumenReal(data(), '2026-11')).toMatchObject({ fondos: { n: 0 }, gastos: { n: 0 } })
  })
})
