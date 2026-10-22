import { describe, expect, it } from 'vitest'
import { diasDelMes, estadoDesdeEtapas, fechaRecordatorio, leerAnio, leerEstadoPlan, proximasFechas, recordatoriosPendientes, recordatorioDeMes, serializarAnio, serializarEstadoPlan, sumarMeses, validarAnio } from './plan'

describe('planificación mensual: fechas y recordatorios', () => {
  it('febrero respeta años bisiestos y los días se validan por mes', () => {
    expect(diasDelMes('2027-02')).toBe(28); expect(diasDelMes('2028-02')).toBe(29); expect(diasDelMes('2026-11')).toBe(30)
    const base = Array.from({ length: 12 }, () => ({ dia: 1, activo: true }))
    expect(validarAnio(2027, base)).toBeNull()
    expect(validarAnio(2027, base.map((m, i) => i === 1 ? { ...m, dia: 29 } : m))).toMatch(/Febrero 2027 solo tiene 28/)
    expect(validarAnio(2028, base.map((m, i) => i === 1 ? { ...m, dia: 29 } : m))).toBeNull()
    expect(validarAnio(2026, base.map((m, i) => i === 3 ? { ...m, dia: 31 } : m))).toMatch(/Abril/)
  })
  it('sumarMeses cruza de diciembre a enero', () => {
    expect(sumarMeses('2026-12', 1)).toBe('2027-01'); expect(sumarMeses('2027-01', -1)).toBe('2026-12'); expect(sumarMeses('2026-11', -2)).toBe('2026-09')
  })
  it('día por mes: el del año si existe, si no el predeterminado acotado al largo del mes', () => {
    const cfg = { plan_dia: '31', plan_dias_2027: serializarAnio(Array.from({ length: 12 }, (_, i) => ({ dia: i === 10 ? 2 : 1, activo: i !== 5 }))) }
    expect(recordatorioDeMes(cfg, '2027-11')).toEqual({ dia: 2, activo: true, propio: true })
    expect(recordatorioDeMes(cfg, '2027-06').activo).toBe(false)
    expect(recordatorioDeMes(cfg, '2026-11')).toEqual({ dia: 30, activo: true, propio: false })   // 31 acotado a 30
    expect(fechaRecordatorio(cfg, '2027-11')).toBe('2027-11-02')
    expect(leerAnio(cfg, 2027)[10]).toEqual({ dia: 2, activo: true })
  })
  it('el aviso aparece al llegar la fecha, no antes; no muestra meses futuros', () => {
    const cfg = { plan_dias_2026: serializarAnio(Array.from({ length: 12 }, (_, i) => ({ dia: i === 10 ? 2 : 1, activo: true }))) }
    expect(recordatoriosPendientes(cfg, '2026-11-01').map(r => r.mes)).not.toContain('2026-11')   // día 2 configurado: todavía no
    expect(recordatoriosPendientes(cfg, '2026-11-02')[0]).toMatchObject({ mes: '2026-11', actual: true })
    expect(recordatoriosPendientes(cfg, '2026-11-20').map(r => r.mes)).not.toContain('2026-12')
  })
  it('no avalancha: solo el mes actual y hasta 2 anteriores; completado/descartado/pospuesto no se muestran', () => {
    const hoy = '2026-11-10'
    expect(recordatoriosPendientes({}, hoy).map(r => r.mes)).toEqual(['2026-11', '2026-10', '2026-09'])
    expect(recordatoriosPendientes({ 'plan_est_2026-11': 'c|111|' }, hoy).map(r => r.mes)).toEqual(['2026-10', '2026-09'])
    expect(recordatoriosPendientes({ 'plan_est_2026-11': 'd|000|', 'plan_est_2026-10': 'c|111|' }, hoy).map(r => r.mes)).toEqual(['2026-09'])
    expect(recordatoriosPendientes({ 'plan_est_2026-11': 'p|000|2026-11-12' }, hoy).map(r => r.mes)).not.toContain('2026-11')
    expect(recordatoriosPendientes({ 'plan_est_2026-11': 'p|000|2026-11-12' }, '2026-11-12').map(r => r.mes)).toContain('2026-11')   // vuelve el día pospuesto
    expect(recordatoriosPendientes({ plan_activo: 'false' }, hoy)).toEqual([])
  })
  it('estado por etapas: omitida no cuenta como ejecutada; completada solo si ninguna queda pendiente', () => {
    const p = leerEstadoPlan({ 'plan_est_2026-11': 'e|120|' }, '2026-11')
    // v1.28: sin etapa de subcajas. El dígito del medio se conserva (siempre 2 = omitida) para leer estados guardados antes.
    expect(p.etapas).toEqual({ fondos: 1, gastos: 0 }); expect(p.estado).toBe('en_progreso')
    expect(estadoDesdeEtapas({ fondos: 1, gastos: 0 })).toBe('en_progreso')
    expect(estadoDesdeEtapas({ fondos: 1, gastos: 2 })).toBe('completada')
    expect(estadoDesdeEtapas({ fondos: 0, gastos: 0 })).toBe('pendiente')
    expect(serializarEstadoPlan(p)).toBe('e|120|')
    expect(serializarEstadoPlan(leerEstadoPlan({ 'plan_est_2026-11': 'e|101|' }, '2026-11'))).toBe('e|121|')
  })
  it('próximas fechas parten de hoy y saltan meses desactivados', () => {
    const cfg = { plan_dias_2026: serializarAnio(Array.from({ length: 12 }, (_, i) => ({ dia: 1, activo: i !== 10 }))) }
    expect(proximasFechas(cfg, '2026-10-15', 3).map(x => x.fecha)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01'])
  })
})
