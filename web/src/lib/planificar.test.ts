import { describe, expect, it } from 'vitest'
import { candidatos, recordatoriosVigentes, resumenMes } from './planificar'
import type { AppData, Caja, Fuente } from './types'

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
