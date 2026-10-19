import { describe, expect, it } from 'vitest'
import { ApiError, conCompatibilidad, type Transport } from './api'

describe('compatibilidad con un Apps Script anterior a v1.26', () => {
  const viejo = (llamadas: [string, unknown][]): Transport => async (action, payload) => {
    llamadas.push([action, payload])
    if (['saveFondo', 'saveFondoMes', 'savePlantillaFin_nuevo'].includes(action)) throw new ApiError('BAD_ACTION', 'Acción no válida')
    return { ok: true }
  }
  it('repite con el nombre anterior cuando el backend no conoce la acción nueva y traduce los datos', async () => {
    const calls: [string, unknown][] = []
    await conCompatibilidad(viejo(calls))('saveFondoMes', { fondoId: 'f1', mes: '2026-10', monto: 5, modo: 'solo' })
    expect(calls.map(c => c[0])).toEqual(['saveFondoMes', 'saveFuenteMes'])
    expect(calls[1][1]).toEqual({ fuenteId: 'f1', mes: '2026-10', monto: 5, modo: 'solo' })
  })
  it('traduce tipo «fondo» en las plantillas solo cuando hace falta', async () => {
    const calls: [string, unknown][] = []
    const t: Transport = async (a, p) => { calls.push([a, p]); if (a === 'aplicarEntidadesMes' && calls.length === 1) throw new ApiError('BAD_ACTION', 'x'); return 1 }
    await conCompatibilidad(t)('aplicarEntidadesMes', { tipo: 'fondo', mes: '2026-10', items: [] })
    expect(calls).toHaveLength(2)
    expect((calls[1][1] as { tipo: string }).tipo).toBe('fuente')
  })
  it('no reintenta otros errores ni acciones sin equivalente anterior', async () => {
    const calls: string[] = []
    const t: Transport = async a => { calls.push(a); throw new ApiError('MIGRACION_PENDIENTE', 'migra') }
    await expect(conCompatibilidad(t)('saveFondo', {})).rejects.toMatchObject({ code: 'MIGRACION_PENDIENTE' })
    const t2: Transport = async a => { calls.push(a); throw new ApiError('BAD_ACTION', 'x') }
    await expect(conCompatibilidad(t2)('saveRevisionPresupuesto', {})).rejects.toMatchObject({ code: 'BAD_ACTION' })
    expect(calls).toEqual(['saveFondo', 'saveRevisionPresupuesto'])
  })
})
