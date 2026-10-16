// P1: la fecha de "hoy" no se congela: cambia al pasar la medianoche (zona configurada) y al volver a la pestaña.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { msHastaMedianoche, useHoy } from './useHoy'

const LIMA = 'America/Lima'
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
afterEach(() => { vi.useRealTimers() })

describe('msHastaMedianoche', () => {
  it('calcula los ms que faltan en la zona indicada', () => {
    expect(msHastaMedianoche(LIMA, new Date('2026-10-16T04:59:00Z'))).toBe(60_000)     // 23:59 en Lima
    expect(msHastaMedianoche(LIMA, new Date('2026-10-16T05:00:00Z'))).toBe(86_400_000) // 00:00 exacto → un día completo
    expect(msHastaMedianoche('Asia/Tokyo', new Date('2026-10-15T14:30:00Z'))).toBe(30 * 60_000) // 23:30 en Tokio
  })
})

describe('useHoy', () => {
  it('pasa de 23:59 a 00:01 en America/Lima sin recargar', () => {
    vi.setSystemTime(new Date('2026-10-16T04:59:00Z'))              // 15/10 23:59 Lima
    const { result } = renderHook(() => useHoy(LIMA))
    expect(result.current).toBe('2026-10-15')
    act(() => { vi.advanceTimersByTime(2 * 60_000) })                // 00:01 del 16/10
    expect(result.current).toBe('2026-10-16')
  })
  it('avanza también al mes siguiente (31/10 → 01/11)', () => {
    vi.setSystemTime(new Date('2026-11-01T04:59:30Z'))
    const { result } = renderHook(() => useHoy(LIMA))
    expect(result.current).toBe('2026-10-31')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current).toBe('2026-11-01')
  })
  it('se corrige al volver a la pestaña (visibilitychange / focus) aunque el temporizador se haya dormido', () => {
    vi.setSystemTime(new Date('2026-10-15T23:35:00Z'))               // 15/10 18:35 Lima
    const { result } = renderHook(() => useHoy(LIMA))
    expect(result.current).toBe('2026-10-15')
    vi.setSystemTime(new Date('2026-10-16T14:27:00Z'))               // día siguiente, sin que corriera el timeout
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(result.current).toBe('2026-10-16')
    vi.setSystemTime(new Date('2026-10-17T14:27:00Z'))
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(result.current).toBe('2026-10-17')
  })
  it('recalcula si cambia la zona horaria y limpia sus temporizadores al desmontar', () => {
    vi.setSystemTime(new Date('2026-10-16T03:30:00Z'))               // 15/10 22:30 Lima; 16/10 12:30 Tokio
    const { result, rerender, unmount } = renderHook(({ tz }) => useHoy(tz), { initialProps: { tz: LIMA } })
    expect(result.current).toBe('2026-10-15')
    rerender({ tz: 'Asia/Tokyo' })
    expect(result.current).toBe('2026-10-16')
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('una zona inválida no rompe: usa la zona por defecto', () => {
    vi.setSystemTime(new Date('2026-10-16T12:00:00Z'))
    const { result } = renderHook(() => useHoy('Zona/Invalida'))
    expect(result.current).toBe('2026-10-16')
  })
})
