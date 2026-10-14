import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDescripcionSub } from './Clasificacion'

describe('descripción dinámica según la subcategoría (v1.15)', () => {
  it('vacía → se completa sola con la subcategoría y la sigue mientras no se toque', () => {
    const { result } = renderHook(() => useDescripcionSub('', ''))
    act(() => result.current.alCambiarSub('Almuerzo'))
    expect(result.current.descripcion).toBe('Almuerzo')
    act(() => result.current.alCambiarSub('Cena'))
    expect(result.current.descripcion).toBe('Cena')
    expect(result.current.pendiente).toBeNull()
  })
  it('texto personalizado: no se pisa, pide confirmación; Reemplazar y Conservar funcionan', () => {
    const { result } = renderHook(() => useDescripcionSub('', ''))
    act(() => result.current.alCambiarSub('Almuerzo'))
    act(() => result.current.escribir('Almuerzo con Ana'))
    act(() => result.current.alCambiarSub('Cena'))
    expect(result.current.descripcion).toBe('Almuerzo con Ana')
    expect(result.current.pendiente).toMatchObject({ sub: 'Cena', nueva: 'Cena' })
    act(() => result.current.conservar())
    expect(result.current.descripcion).toBe('Almuerzo con Ana')
    expect(result.current.pendiente).toBeNull()
    act(() => result.current.alCambiarSub('Cena'))
    act(() => result.current.reemplazar())
    expect(result.current.descripcion).toBe('Cena')
  })
  it('al abrir (editar/clonar) no sobrescribe: la descripción cargada se conserva', () => {
    const { result } = renderHook(() => useDescripcionSub('Pago de luz de octubre', 'Luz'))
    expect(result.current.descripcion).toBe('Pago de luz de octubre')
    expect(result.current.pendiente).toBeNull()
  })
  it('si lo cargado coincide con la subcategoría original, sigue siendo automática', () => {
    const { result } = renderHook(() => useDescripcionSub('Luz', 'Luz'))
    act(() => result.current.alCambiarSub('Agua'))
    expect(result.current.descripcion).toBe('Agua')
  })
  it('una subcategoría genérica (“Otros”) no borra el texto del usuario', () => {
    const { result } = renderHook(() => useDescripcionSub('Taxi al aeropuerto', 'Taxi'))
    act(() => result.current.alCambiarSub('Otros'))
    expect(result.current.descripcion).toBe('Taxi al aeropuerto')
    expect(result.current.pendiente).toBeNull()
  })
})
