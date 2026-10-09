import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApi, httpTransport, marcarIds } from './api'
import { demoTransport } from './demo'

const conn = { url: 'https://script.google.com/macros/s/x/exec', token: 't'.repeat(32) }
const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200 })
const fail = (code: string) => new Response(JSON.stringify({ ok: false, error: { code, message: code } }), { status: 200 })
const noSleep = () => Promise.resolve()

describe('cliente HTTP de Apps Script', () => {
  it('envía POST text/plain con token en el cuerpo, nunca en la URL', async () => {
    const f = vi.fn().mockResolvedValue(ok({ pong: 1 }))
    await httpTransport(conn, f, noSleep)('ping', {})
    const [url, init] = f.mock.calls[0]
    expect(url).toBe(conn.url)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toMatch(/text\/plain/)
    expect(JSON.parse(init.body).token).toBe(conn.token)
  })

  it('reintenta errores de red y BUSY hasta 3 intentos', async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(fail('BUSY')).mockResolvedValueOnce(ok(1))
    await expect(httpTransport(conn, f, noSleep)('data', {})).resolves.toBe(1)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('no reintenta para siempre: falla tras 3 intentos', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(httpTransport(conn, f, noSleep)('data', {})).rejects.toMatchObject({ code: 'NETWORK' })
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('no reintenta errores de validación, permisos ni cuota', async () => {
    for (const code of ['VALIDATION', 'UNAUTHORIZED', 'QUOTA']) {
      const f = vi.fn().mockResolvedValue(fail(code))
      await expect(httpTransport(conn, f, noSleep)('saveGasto', {})).rejects.toMatchObject({ code })
      expect(f).toHaveBeenCalledTimes(1)
    }
  })

  it('una página HTML (despliegue mal configurado) da un error comprensible', async () => {
    const f = vi.fn().mockResolvedValue(new Response('<html>Sign in</html>', { status: 200 }))
    await expect(httpTransport(conn, f, noSleep)('data', {})).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('timeout aborta la petición', async () => {
    vi.useFakeTimers()
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => {
      init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const p = httpTransport(conn, f as unknown as typeof fetch, noSleep)('data', {}).catch(e => e)
    await vi.advanceTimersByTimeAsync(31_000 * 3)
    const err = await p
    vi.useRealTimers()
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('TIMEOUT')
  })

  it('respuestas con forma inesperada se rechazan', async () => {
    const api = createApi(async () => ({ version: '1', gastos: 'no' }))
    await expect(api.getData()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('lecturas simultáneas comparten una sola petición', async () => {
    const t = vi.fn(demoTransport('2026-10-09', 10, 0))
    const api = createApi(t)
    const [a, b] = await Promise.all([api.getData(), api.getData()])
    expect(a).toBe(b)
    expect(t).toHaveBeenCalledTimes(1)
  })

  it('el modo demo respeta idempotencia de altas', async () => {
    const api = createApi(demoTransport('2026-10-09', 0, 0))
    const g = { id: 'abc', fecha: '2026-10-09', monto: 5, moneda: 'PEN', categoria: 'C', subcategoria: '', descripcion: '', medioPago: 'Yape', tipoGasto: 'Variable' as const, ambito: 'Personal', esRecurrente: false, comprobanteUrl: '' }
    await api.saveGasto(g, 'create')
    await api.saveGasto(g, 'create')
    expect((await api.getData()).gastos.filter(x => x.id === 'abc')).toHaveLength(1)
  })

  it('marca IDs repetidos o inválidos y da a cada fila una clave única para la interfaz', () => {
    const g = (id: string) => ({ id } as unknown as Parameters<typeof marcarIds>[0][number])
    const r = marcarIds([g('5d1d6822-e84c-41f0-0b0d-aa2cf573c62A'), g('5d1d6822-e84c-41f0-0b0d-aa2cf573c62a'), g('5d1d6822-e84c-41f0-0b0d-aa2cf573c62P'), g('00488880-85fb-4805-a7f0-5962625e15b1')])
    expect(r.map(x => x.problemaId)).toEqual(['duplicado', 'duplicado', 'invalido', undefined])
    expect(new Set(r.map(x => x.uid)).size).toBe(4)
  })
})
