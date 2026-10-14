import { describe, expect, it } from 'vitest'
import { acotar, cuadriculaDelMes, diaSemana, fechaLarga, moverMeses, nombreMes } from './calendario'

describe('calendario', () => {
  it('la semana empieza en lunes', () => {
    expect(diaSemana('2026-10-12')).toBe(0) // lunes
    expect(diaSemana('2026-10-18')).toBe(6) // domingo
  })
  it('cuadrícula de 42 celdas con los días del mes marcados', () => {
    const c = cuadriculaDelMes('2026-10')
    expect(c).toHaveLength(42)
    expect(c[0].iso).toBe('2026-09-28')
    expect(c.filter(x => x.enMes)).toHaveLength(31)
    expect(c.find(x => x.iso === '2026-10-01')?.enMes).toBe(true)
  })
  it('febrero bisiesto y cambio de año', () => {
    expect(cuadriculaDelMes('2028-02').filter(x => x.enMes)).toHaveLength(29)
    expect(moverMeses('2026-12-31', 1)).toBe('2027-01-31')
    expect(moverMeses('2026-03-31', -1)).toBe('2026-02-28')
  })
  it('textos y límites sin corrimientos de zona', () => {
    expect(fechaLarga('2026-10-03')).toBe('3 de octubre de 2026')
    expect(nombreMes('2026-10').toLowerCase()).toContain('octubre')
    expect(acotar('2026-10-20', '2026-10-01', '2026-10-10')).toBe('2026-10-10')
    expect(acotar('2026-09-20', '2026-10-01')).toBe('2026-10-01')
  })
})
