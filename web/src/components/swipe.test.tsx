import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SwipeFila } from './swipe'

/**
 * Regresión (auditoría 2026-10): al soltar, SwipeFila decidía con el estado de React `arrastre`. Si los eventos de puntero llegan
 * en el mismo lote que el soltar (render pendiente), el estado aún era null y un gesto lento de cerrar dejaba la fila abierta.
 */
const acciones = ['a', 'b', 'c'].map(k => ({ key: k, label: k, onClick: () => {}, icon: null }))
const montar = () => {
  render(<SwipeFila nombre="Fondo" acciones={acciones} testId="fila"><div data-testid="contenido">contenido</div></SwipeFila>)
  return screen.getByTestId('contenido').parentElement!.parentElement!   // el contenedor que recibe los punteros
}
const gesto = (el: Element, x1: number, x2: number, ms: number) => {
  // Todo en un único act(): no hay render entre los eventos, igual que un dispositivo que emite más rápido de lo que renderiza.
  act(() => {
    fireEvent.pointerDown(el, { clientX: x1, clientY: 10, pointerId: 1, pointerType: 'touch' })
    for (let i = 1; i <= 8; i++) fireEvent.pointerMove(el, { clientX: x1 + (x2 - x1) * i / 8, clientY: 10, pointerId: 1, pointerType: 'touch' })
    vi.advanceTimersByTime(ms)                                                                // gesto lento: la velocidad queda por debajo del umbral
    fireEvent.pointerUp(el, { clientX: x2, clientY: 10, pointerId: 1, pointerType: 'touch' })
  })
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'performance'] }) })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('SwipeFila: decisión al soltar', () => {
  it('un deslizamiento lento hacia la izquierda más allá del umbral abre las acciones', () => {
    const el = montar()
    gesto(el, 300, 100, 2000)
    expect(screen.getByTestId('fila').getAttribute('data-swipe-abierto')).toBe('true')
  })
  it('un deslizamiento lento hacia la derecha sobre una fila abierta la cierra aunque el render vaya atrasado', () => {
    const el = montar()
    gesto(el, 300, 100, 2000)
    expect(screen.getByTestId('fila').getAttribute('data-swipe-abierto')).toBe('true')
    gesto(el, 100, 300, 2000)
    expect(screen.getByTestId('fila').getAttribute('data-swipe-abierto')).toBeNull()
  })
  it('un deslizamiento lento y corto no abre (queda por debajo del 40 %)', () => {
    const el = montar()
    gesto(el, 300, 270, 2000)
    expect(screen.getByTestId('fila').getAttribute('data-swipe-abierto')).toBeNull()
  })
})
