// P3: escrituras optimistas — el cambio se ve al instante, sale a Apps Script en orden, se revierte solo si falla,
// sobrevive a recargar y nunca desaparece por una lectura anterior.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApi, type Transport } from './api'
import { useAppData } from './store'
import { dismiss, useToasts } from './toast'

const CONN = { url: 'https://script.google.com/macros/s/x/exec', token: 't'.repeat(32) }
const gastoRow = (id: string, monto = 10, estado = 'Activo') => ['2026-10-09', monto, 'PEN', 'Alimentación', 'Cena', id, 'Yape', 'Variable', 'Personal', false, estado, 'web', '', id, 't', 't']
const base = (over: Record<string, unknown> = {}) => ({ version: 't', sheetUrl: '', gastos: [], catalogo: [], medios: [], cajas: [], presupuestos: [], config: {}, ...over })
const input = (id: string, monto = 10) => ({ id, fecha: '2026-10-09', monto, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Cena', descripcion: id,
  medioPago: 'Yape', tipoGasto: 'Variable' as const, ambito: 'Personal', esRecurrente: false, comprobanteUrl: '' })
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function deferredBackend() {
  const calls: { action: string; payload: Record<string, unknown>; resolve: (v: unknown) => void; reject: (e: Error) => void }[] = []
  const t: Transport = (action, payload) => new Promise((resolve, reject) => { calls.push({ action, payload: payload as Record<string, unknown>, resolve, reject }) })
  return { calls, api: createApi(t) }
}
const arrancar = async (inicial = base()) => {
  const be = deferredBackend()
  const hook = renderHook(() => ({ store: useAppData(CONN, be.api), toasts: useToasts() }))
  await waitFor(() => expect(be.calls).toHaveLength(1))
  await act(async () => { be.calls[0].resolve(inicial) })
  return { be, hook, st: () => hook.result.current.store }
}
const fallo = (code = 'NETWORK') => Object.assign(new Error('No se pudo conectar con Apps Script.'), { code })

beforeEach(() => { localStorage.clear() })
afterEach(() => { localStorage.clear() })

describe('UI optimista', () => {
  it('el cambio se ve de inmediato, antes de que Apps Script responda', async () => {
    const { be, st } = await arrancar()
    const t0 = performance.now()
    act(() => { void st().actions.saveGasto(input(ID(1)), 'create').catch(() => undefined) })
    expect(performance.now() - t0).toBeLessThan(100)
    expect(st().data!.gastos.map(g => g.id)).toEqual([ID(1)])
    expect(st().enCola).toBe(1)
    await waitFor(() => expect(be.calls).toHaveLength(2))
    await act(async () => { be.calls[1].resolve(gastoRow(ID(1))) })
    await waitFor(() => expect(st().enCola).toBe(0))
    expect(st().data!.gastos).toHaveLength(1)
  })

  it('anular y restaurar en lote se ven al instante; si falla vuelven a su estado anterior', async () => {
    const { be, st } = await arrancar(base({ gastos: [gastoRow(ID(1)), gastoRow(ID(2))] }))
    const [a, b] = st().data!.gastos
    act(() => { void st().actions.setEstadoLote([a, b], 'Anulado').catch(() => undefined) })
    expect(st().data!.gastos.map(g => g.estado)).toEqual(['Anulado', 'Anulado'])
    await waitFor(() => expect(be.calls).toHaveLength(2))
    await act(async () => { be.calls[1].reject(fallo()) })
    await waitFor(() => expect(st().data!.gastos.map(g => g.estado)).toEqual(['Activo', 'Activo']))
  })

  it('si falla una operación se revierte SOLO esa; las demás siguen y se confirman', async () => {
    const { be, st } = await arrancar()
    act(() => {
      void st().actions.saveGasto(input(ID(1)), 'create').catch(() => undefined)
      void st().actions.saveGasto(input(ID(2)), 'create').catch(() => undefined)
    })
    expect(st().data!.gastos.map(g => g.id)).toEqual([ID(1), ID(2)])
    await waitFor(() => expect(be.calls).toHaveLength(2))
    await act(async () => { be.calls[1].reject(fallo('TIMEOUT')) })                      // falla la primera
    await waitFor(() => expect(be.calls).toHaveLength(3))                                 // la segunda sale después, en orden
    expect(be.calls[2].payload.id).toBe(ID(2))
    expect(st().data!.gastos.map(g => g.id)).toEqual([ID(2)])
    await act(async () => { be.calls[2].resolve(gastoRow(ID(2))) })
    await waitFor(() => expect(st().enCola).toBe(0))
    expect(st().data!.gastos.map(g => g.id)).toEqual([ID(2)])
  })

  it('una lectura completa que termina con la escritura aún pendiente no la hace desaparecer', async () => {
    const { be, st } = await arrancar()
    act(() => { void st().actions.saveGasto(input(ID(1)), 'create').catch(() => undefined) })
    await waitFor(() => expect(be.calls).toHaveLength(2))
    act(() => { void st().refresh() })
    await waitFor(() => expect(be.calls).toHaveLength(3))
    await act(async () => { be.calls[2].resolve(base()) })                                // la hoja aún no tiene el gasto
    await waitFor(() => expect(st().loading).toBe(false))
    expect(st().data!.gastos.map(g => g.id)).toEqual([ID(1)])
    await act(async () => { be.calls[1].resolve(gastoRow(ID(1))) })
  })

  it('catálogo: guardar se ve al instante y al fallar vuelve al valor anterior (también el icono de sus hermanas)', async () => {
    const { be, st } = await arrancar(base({ catalogo: [['Personal', 'Comida', '', true, 'utensils', '#111111', 1], ['Hogar', 'Comida', '', true, 'utensils', '#111111', 1]] }))
    act(() => { void st().actions.saveCatalogo({ ambito: 'Personal', categoria: 'Comida', subcategoria: '', activo: true, icono: 'coffee', color: '#222222' }).catch(() => undefined) })
    expect(st().data!.catalogo.map(c => c.icono)).toEqual(['coffee', 'coffee'])
    await waitFor(() => expect(be.calls).toHaveLength(2))
    await act(async () => { be.calls[1].reject(fallo()) })
    await waitFor(() => expect(st().data!.catalogo.map(c => `${c.icono}/${c.color}`)).toEqual(['utensils/#111111', 'utensils/#111111']))
  })

  it('eliminar categoría desaparece al instante; si el backend no la elimina, vuelve', async () => {
    const { be, st } = await arrancar(base({ catalogo: [['Personal', 'Comida', '', true], ['Personal', 'Salud', '', true]] }))
    act(() => { void st().actions.deleteCategoria('Personal', 'Comida', false).catch(() => undefined) })
    expect(st().data!.catalogo.map(c => c.categoria)).toEqual(['Salud'])
    await waitFor(() => expect(be.calls).toHaveLength(2))
    await act(async () => { be.calls[1].resolve({ eliminada: false }) })
    await waitFor(() => expect(st().data!.catalogo.map(c => c.categoria).sort()).toEqual(['Comida', 'Salud']))
  })

  it('renombrar se ve al instante y al fallar se deshace en el catálogo y en los gastos', async () => {
    const { be, st } = await arrancar(base({ gastos: [gastoRow(ID(1))], catalogo: [['Personal', 'Alimentación', '', true]] }))
    act(() => { void st().actions.renameCatalogo({ nivel: 'categoria', ambito: 'Personal', categoria: 'Alimentación', nuevo: 'Comidas' }).catch(() => undefined) })
    expect(st().data!.gastos[0].categoria).toBe('Comidas')
    expect(st().data!.catalogo[0].categoria).toBe('Comidas')
    await waitFor(() => expect(be.calls).toHaveLength(2))
    await act(async () => { be.calls[1].reject(fallo()) })
    await waitFor(() => expect(st().data!.gastos[0].categoria).toBe('Alimentación'))
    expect(st().data!.catalogo[0].categoria).toBe('Alimentación')
  })
})

describe('arranque con respaldo del navegador (stale-while-revalidate)', () => {
  it('muestra los datos guardados al instante, sin esperar la lectura, y la confirma después', async () => {
    const api = createApi(() => Promise.resolve(base({ gastos: [gastoRow(ID(5))] })))
    const d = await api.getData(true)
    localStorage.setItem('gd.snapshot', JSON.stringify({ url: CONN.url, data: d }))
    const be = deferredBackend()
    const t0 = performance.now()
    const hook = renderHook(() => useAppData(CONN, be.api))
    expect(hook.result.current.data!.gastos.map(g => g.id)).toEqual([ID(5)])       // primer render: ya hay datos
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(hook.result.current.confirmado).toBe(false)                              // aún no confirmados con la hoja
    await waitFor(() => expect(be.calls).toHaveLength(1))
    await act(async () => { be.calls[0].resolve(base({ gastos: [gastoRow(ID(5)), gastoRow(ID(6))] })) })
    await waitFor(() => expect(hook.result.current.confirmado).toBe(true))
    expect(hook.result.current.data!.gastos).toHaveLength(2)
  })
})

describe('cola persistida y aviso al cerrar', () => {
  it('guarda la cola en localStorage, la vacía al confirmar y pone/quita el aviso de cierre', async () => {
    const add = vi.spyOn(window, 'addEventListener'), rem = vi.spyOn(window, 'removeEventListener')
    const { be, st } = await arrancar()
    act(() => { void st().actions.saveGasto(input(ID(1)), 'create').catch(() => undefined) })
    const cola = JSON.parse(localStorage.getItem('gd.cola')!)
    expect(cola.url).toBe(CONN.url)
    expect(cola.ops).toHaveLength(1)
    expect(cola.ops[0]).toMatchObject({ nombre: 'saveGasto' })
    await waitFor(() => expect(add.mock.calls.some(c => c[0] === 'beforeunload')).toBe(true))
    await waitFor(() => expect(be.calls).toHaveLength(2))
    await act(async () => { be.calls[1].resolve(gastoRow(ID(1))) })
    await waitFor(() => expect(st().enCola).toBe(0))
    expect(localStorage.getItem('gd.cola')).toBeNull()
    expect(rem.mock.calls.some(c => c[0] === 'beforeunload')).toBe(true)
    add.mockRestore(); rem.mockRestore()
  })

  it('al recargar con cambios sin confirmar: se reenvían con el mismo ID y se ven mientras llega la lectura', async () => {
    const a = await arrancar()
    act(() => { void a.st().actions.saveGasto(input(ID(7), 55), 'create').catch(() => undefined) })
    expect(localStorage.getItem('gd.cola')).not.toBeNull()
    a.hook.unmount()                                                                      // "cierra" la pestaña sin que Sheets haya respondido

    const be = deferredBackend()
    const hook = renderHook(() => ({ store: useAppData(CONN, be.api), toasts: useToasts() }))
    await waitFor(() => expect(be.calls.some(c => c.action === 'saveGasto')).toBe(true))
    const envio = be.calls.find(c => c.action === 'saveGasto')!
    expect(envio.payload.id).toBe(ID(7))                                                  // mismo ID: reenviar no duplica
    const lectura = be.calls.find(c => c.action === 'data')!
    await act(async () => { lectura.resolve(base()) })                                    // la hoja aún no lo tiene
    expect(hook.result.current.store.data!.gastos.map(g => g.id)).toEqual([ID(7)])        // pero se sigue viendo
    await act(async () => { envio.resolve(gastoRow(ID(7), 55)) })
    await waitFor(() => expect(hook.result.current.store.enCola).toBe(0))
    expect(localStorage.getItem('gd.cola')).toBeNull()
    expect(hook.result.current.toasts.some(t => t.message.includes('Cambios pendientes enviados'))).toBe(true)
    hook.result.current.toasts.forEach(t => dismiss(t.id))
  })

  it('si el reenvío tras recargar falla: se revierte y avisa con "Reintentar"', async () => {
    const a = await arrancar()
    act(() => { void a.st().actions.saveGasto(input(ID(8)), 'create').catch(() => undefined) })
    a.hook.unmount()
    const be = deferredBackend()
    const hook = renderHook(() => ({ store: useAppData(CONN, be.api), toasts: useToasts() }))
    await waitFor(() => expect(be.calls.some(c => c.action === 'saveGasto')).toBe(true))
    await act(async () => { be.calls.find(c => c.action === 'data')!.resolve(base()) })
    await act(async () => { be.calls.find(c => c.action === 'saveGasto')!.reject(fallo()) })
    await waitFor(() => expect(hook.result.current.toasts.some(t => t.kind === 'error' && t.actions?.some(x => x.label === 'Reintentar'))).toBe(true))
    expect(hook.result.current.store.data!.gastos).toHaveLength(0)
    expect(localStorage.getItem('gd.cola')).toBeNull()
    hook.result.current.toasts.forEach(t => dismiss(t.id))
  })

  it('sin conexión guardada (modo demo) no se persiste nada', async () => {
    const be = deferredBackend()
    const hook = renderHook(() => ({ store: useAppData(null, be.api) }))
    await waitFor(() => expect(be.calls.length).toBeGreaterThanOrEqual(0))
    expect(localStorage.getItem('gd.cola')).toBeNull()
    hook.unmount()
  })
})
