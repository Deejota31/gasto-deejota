import { describe, expect, it } from 'vitest'
import { mesesEntre, periodoPorDefecto, validarPrueba } from './datosPrueba'

describe('datos de prueba: validación', () => {
  it('lista los meses del rango cruzando el año', () => {
    expect(mesesEntre('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(mesesEntre('2025-07', '2025-07')).toEqual(['2025-07'])
  })
  it('acepta 60 registros de julio a diciembre de 2025', () => {
    expect(validarPrueba({ cantidad: '60', desde: '2025-07', hasta: '2025-12' })).toEqual({ ok: true, valor: { cantidad: 60, desde: '2025-07', hasta: '2025-12' }, meses: 6 })
  })
  it('rechaza cantidades no enteras, vacías, cero o por encima de 500', () => {
    for (const c of ['', '0', '501', '2.5', '-3', 'abc', '1e2']) {
      const r = validarPrueba({ cantidad: c, desde: '2025-07', hasta: '2025-08' })
      expect(r.ok, c).toBe(false)
      if (!r.ok) expect(r.errores.cantidad).toMatch(/entre 1 y 500/)
    }
    expect(validarPrueba({ cantidad: 500, desde: '2025-07', hasta: '2025-08' }).ok).toBe(true)
  })
  it('rechaza el rango invertido, mal formado o de más de 24 meses', () => {
    const e = (desde: string, hasta: string) => { const r = validarPrueba({ cantidad: 10, desde, hasta }); return r.ok ? '' : r.errores.periodo }
    expect(e('2025-12', '2025-07')).toMatch(/no puede ser posterior/)
    expect(e('', '2025-07')).toMatch(/Elige el mes/)
    expect(e('2025-13', '2025-14')).toMatch(/Elige el mes/)
    expect(e('2024-01', '2026-01')).toMatch(/máximo 24 meses/)
    expect(e('2024-01', '2025-12')).toBe('')
  })
  it('el período por defecto son los últimos 6 meses hasta el mes actual', () => {
    expect(periodoPorDefecto('2026-10-19')).toEqual({ desde: '2026-05', hasta: '2026-10' })
    expect(periodoPorDefecto('2026-02-03')).toEqual({ desde: '2025-09', hasta: '2026-02' })
  })
})
