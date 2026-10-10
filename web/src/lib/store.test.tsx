// Operaciones no bloqueantes: la escritura no espera al backend, informa su resultado real
// y una lectura tardía no pisa un cambio ya confirmado.
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createApi, type Transport } from './api'
import { useAppData } from './store'
import { dismiss, showToast, useToasts } from './toast'

const gastoRow = (id: string, monto = 10) => ['2026-10-09', monto, 'PEN', 'Alimentación', 'Cena', id, 'Yape', 'Variable', 'Personal', false, 'Activo', 'web', '', id, 't', 't']
const base = (gastos: unknown[][] = []) => ({ version: 't', sheetUrl: '', gastos, catalogo: [], medios: [], cajas: [], presupuestos: [], config: {} })

/** Backend falso: cada llamada queda pendiente hasta que la prueba la resuelve o la rechaza. */
function deferredBackend() {
  const calls: { action: string; payload: Record<string, unknown>; resolve: (v: unknown) => void; reject: (e: Error) => void }[] = []
  const t: Transport = (action, payload) => new Promise((resolve, reject) => { calls.push({ action, payload: payload as Record<string, unknown>, resolve, reject }) })
  return { calls, api: createApi(t) }
}

function setup() {
  const be = deferredBackend()
  const hook = renderHook(() => ({ store: useAppData(null, be.api), toasts: useToasts() }))
  return { be, hook }
}

const input = (id: string, monto = 10) => ({ id, fecha: '2026-10-09', monto, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Cena', descripcion: id,
  medioPago: 'Yape', tipoGasto: 'Variable' as const, ambito: 'Personal', esRecurrente: false, comprobanteUrl: '' })
const MSG = { pending: 'Guardando gasto…', ok: 'Gasto registrado correctamente.', error: 'No se pudo registrar el gasto.' }


describe('operaciones con Google Sheets sin bloquear', () => {
  it('track vuelve de inmediato, muestra "Guardando…" y solo confirma con la respuesta real', async () => {
    const { be, hook } = setup()
    await act(async () => { be.calls[0].resolve(base()) })
    let accepted = false
    act(() => { accepted = hook.result.current.store.track('gasto:a', MSG, () => hook.result.current.store.actions.saveGasto(input('a'), 'create')) })
    expect(accepted).toBe(true)
    expect(hook.result.current.store.pending.has('gasto:a')).toBe(true)
    expect(hook.result.current.toasts.at(-1)).toMatchObject({ kind: 'pending', message: 'Guardando gasto…' })
    expect(hook.result.current.store.data!.gastos).toHaveLength(0) // nada de éxito anticipado

    // Un segundo envío de la misma operación se rechaza (no duplica).
    act(() => { expect(hook.result.current.store.track('gasto:a', MSG, async () => {})).toBe(false) })
    expect(be.calls.filter(c => c.action === 'saveGasto')).toHaveLength(1)

    await act(async () => { be.calls[1].resolve(gastoRow('a')) })
    await waitFor(() => expect(hook.result.current.store.pending.size).toBe(0))
    expect(hook.result.current.store.data!.gastos.map(g => g.id)).toEqual(['a'])
    expect(hook.result.current.toasts.find(t => t.message === MSG.ok)?.kind).toBe('success')
    hook.result.current.toasts.forEach(t => dismiss(t.id))
  })

  it('si falla, la notificación pasa a error con "Reintentar" y el reintento usa el mismo ID', async () => {
    const { be, hook } = setup()
    await act(async () => { be.calls[0].resolve(base()) })
    act(() => { hook.result.current.store.track('gasto:b', MSG, () => hook.result.current.store.actions.saveGasto(input('b'), 'create')) })
    await act(async () => { be.calls[1].reject(Object.assign(new Error('No se pudo conectar con Apps Script.'), { code: 'NETWORK' })) })
    const err = hook.result.current.toasts.find(t => t.kind === 'error')!
    expect(err.message).toContain('No se pudo registrar el gasto.')
    expect(hook.result.current.store.data!.gastos).toHaveLength(0)
    act(() => { err.actions!.find(a => a.label === 'Reintentar')!.run() })
    expect(be.calls[2].action).toBe('saveGasto')
    expect(be.calls[2].payload.id).toBe('b')
    await act(async () => { be.calls[2].resolve(gastoRow('b')) })
    await waitFor(() => expect(hook.result.current.store.data!.gastos.map(g => g.id)).toEqual(['b']))
    hook.result.current.toasts.forEach(t => dismiss(t.id))
  })

  it('operaciones simultáneas se resuelven por separado y una lectura tardía no pisa lo confirmado', async () => {
    const { be, hook } = setup()
    await act(async () => { be.calls[0].resolve(base([gastoRow('x', 5)])) })
    // 1) empieza una lectura completa (Actualizar) que tardará
    act(() => { void hook.result.current.store.refresh() })
    const lectura = be.calls[1]
    // 2) dos altas en paralelo; responde primero la segunda
    act(() => {
      hook.result.current.store.track('gasto:c', MSG, () => hook.result.current.store.actions.saveGasto(input('c'), 'create'))
      hook.result.current.store.track('gasto:d', MSG, () => hook.result.current.store.actions.saveGasto(input('d'), 'create'))
    })
    await act(async () => { be.calls[3].resolve(gastoRow('d')) })
    await act(async () => { be.calls[2].resolve(gastoRow('c')) })
    // 3) llega la lectura vieja (sin c ni d): no debe borrar lo confirmado
    await act(async () => { lectura.resolve(base([gastoRow('x', 5)])) })
    await waitFor(() => expect(hook.result.current.store.loading).toBe(false))
    expect(hook.result.current.store.data!.gastos.map(g => g.id).sort()).toEqual(['c', 'd', 'x'])
    expect(hook.result.current.store.pending.size).toBe(0)
    hook.result.current.toasts.forEach(t => dismiss(t.id))
  })

  it('con muchas notificaciones se descartan primero las de éxito; los errores quedan hasta cerrarlos', async () => {
    const { hook } = setup()
    let errId = 0
    act(() => { errId = showToast('error', 'Error importante'); for (let i = 0; i < 8; i++) showToast('success', `ok ${i}`) })
    expect(hook.result.current.toasts).toHaveLength(6)
    expect(hook.result.current.toasts.some(t => t.id === errId)).toBe(true)
    act(() => { hook.result.current.toasts.forEach(t => dismiss(t.id)) })
  })
})

describe('orden personalizado (v1.4)', () => {
  const rank = (m: Map<string, number>, ids: string[]) => ids.map(id => m.get(id))

  it('dos reordenamientos seguidos: el segundo espera al primero y se guarda; un fallo vuelve al último confirmado', async () => {
    const { be, hook } = setup()
    await act(async () => { be.calls[0].resolve(base()) })
    const st = () => hook.result.current.store
    act(() => { st().reorderGastos(['a', 'b', 'c']) })
    act(() => { st().reorderGastos(['b', 'a', 'c']) })
    expect(rank(st().ordenGastos, ['a', 'b', 'c'])).toEqual([2, 1, 3])               // se ve al instante
    expect(be.calls.filter(c => c.action === 'reorderGastos')).toHaveLength(1)        // el segundo queda en cola
    await act(async () => { be.calls.at(-1)!.resolve({}) })
    await waitFor(() => expect(be.calls.filter(c => c.action === 'reorderGastos')).toHaveLength(2))
    expect(be.calls.at(-1)!.payload.ids).toEqual(['b', 'a', 'c'])                    // se envía el más reciente
    // una lectura completa que termina mientras tanto no pisa el orden local
    act(() => { void st().refresh() })
    const lectura = be.calls.at(-1)!
    expect(lectura.action).toBe('data')
    await act(async () => { be.calls.find(c => c.action === 'reorderGastos' && (c.payload.ids as string[])[0] === 'b')!.resolve({}) })
    await act(async () => { lectura.resolve({ ...base(), ordenGastos: [['a', 1], ['b', 2], ['c', 3]] }) })
    expect(rank(st().ordenGastos, ['a', 'b', 'c'])).toEqual([2, 1, 3])
    await waitFor(() => expect(st().pending.size).toBe(0))
    // fallo: vuelve al último orden confirmado (b, a, c)
    act(() => { st().reorderGastos(['c', 'b', 'a']) })
    expect(rank(st().ordenGastos, ['a', 'b', 'c'])).toEqual([3, 2, 1])
    await act(async () => { be.calls.at(-1)!.reject(new Error('Sin conexión')) })
    await waitFor(() => expect(rank(st().ordenGastos, ['a', 'b', 'c'])).toEqual([2, 1, 3]))
    expect(hook.result.current.toasts.some(t => t.kind === 'error' && t.message.includes('Se restauró el anterior'))).toBe(true)
    hook.result.current.toasts.forEach(t => dismiss(t.id))
  })
})

describe('plantillas sin bloquear (v1.6)', () => {
  it('una lectura de plantillas que llega tarde no pisa una plantilla ya confirmada', async () => {
    const { be, hook } = setup()
    await act(async () => { be.calls[0].resolve(base()) })
    const st = () => hook.result.current.store
    act(() => { void st().loadPlantillas() })
    const lectura = be.calls.at(-1)!
    expect(lectura.action).toBe('plantillas')
    const pid = 'pl-00000000-0000-4000-8000-000000000099'
    let saved: Promise<void> = Promise.resolve()
    act(() => { saved = st().plantillaActions.save({ id: pid, ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Luz', descripcion: 'Luz', monto: 55, moneda: 'PEN', medioPago: 'Plin' }, 'create') })
    await act(async () => { be.calls.at(-1)!.resolve([pid, 'Familia', 'Servicios', 'Luz', 'Luz', 't', 't', 55, 'PEN', 'Plin', 1, false]); await saved })
    await act(async () => { lectura.resolve([]) })   // respuesta antigua, sin la plantilla nueva
    expect(st().plantillas.items.map(p => [p.id, p.monto, p.medioPago])).toEqual([[pid, 55, 'Plin']])
  })
})
