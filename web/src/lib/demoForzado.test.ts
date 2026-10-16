import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApi } from './store'

const conn = { url: 'https://script.google.com/macros/s/x/exec', token: 't'.repeat(32) }

describe('?demo fuerza el transporte de demostración', () => {
  afterEach(() => { history.pushState({}, '', '/'); vi.restoreAllMocks(); localStorage.clear() })

  it('con una conexión guardada, ?demo no llama a Apps Script ni toca la conexión', async () => {
    localStorage.setItem('gd.connection', JSON.stringify(conn))
    const antes = JSON.stringify({ ...localStorage })
    const f = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no debe usarse la red'))
    history.pushState({}, '', '/?demo=20&latencia=0')
    const data = await buildApi(conn).getData()
    expect(data.gastos.length).toBeGreaterThan(0)
    expect(f).not.toHaveBeenCalled()
    expect(JSON.stringify({ ...localStorage })).toBe(antes)
  })

  it('sin ?demo, la conexión guardada sí usa Apps Script', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>x</html>', { status: 403 }))
    await buildApi(conn).getData().catch(() => undefined)
    expect(f).toHaveBeenCalled()
  })
})
