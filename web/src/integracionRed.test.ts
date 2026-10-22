// Integridad ante fallos de red (auditoría 2026-10-22, §7): el cliente HTTP real (reintentos incluidos) contra el Code.gs real.
// Escenario clave: Apps Script ESCRIBE la hoja pero la respuesta se pierde; el cliente reintenta y no debe duplicar nada.
import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError, createApi, httpTransport } from './lib/api'
import { gasto, load } from './testing/backendHarness'

type B = ReturnType<typeof load>
const sinEspera = () => Promise.resolve()

/** fetch que atiende a Code.gs; `perder` respuestas se descartan DESPUÉS de que el backend ya escribió. */
function conRed(b: B, plan: { perder?: number; busy?: number } = {}) {
  const estado = { ...plan, llamadas: 0 }
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    estado.llamadas++
    if (estado.busy) { estado.busy--; b.setLock(false) } else b.setLock(true)
    const cuerpo = b.g.doPost({ postData: { contents: init.body } }).body
    b.setLock(true)
    if (estado.perder) { estado.perder--; throw new TypeError('fetch failed') }
    return new Response(cuerpo, { status: 200 })
  }) as unknown as typeof fetch
  const conn = { url: 'https://script.google.com/macros/s/PRUEBA/exec', token: b.props.get('API_TOKEN')! }
  return { api: createApi(httpTransport(conn, fetchImpl, sinEspera)), estado }
}

const filasDe = (b: B, hoja: string) => (b.ss.getSheetByName(hoja)?.rows ?? []).slice(1).filter(r => r.some(c => c !== '' && c !== undefined))
const gid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`
const entrada = (n: number, o: Record<string, unknown> = {}) => {
  const { mode: _m, ...g } = gasto({ id: gid(n), ...o }) as Record<string, unknown>
  void _m
  return g as never
}

describe('respuesta perdida tras una escritura exitosa', () => {
  let b: B
  beforeEach(() => { b = load(); b.g.setup() })

  it('alta de gasto: el reintento no duplica y el cliente recibe el registro guardado', async () => {
    const { api, estado } = conRed(b, { perder: 2 })
    const g = await api.saveGasto(entrada(1, { monto: 40 }), 'create')
    expect(estado.llamadas).toBe(3)
    expect(filasDe(b, 'GASTOS')).toHaveLength(1)
    expect(g).toMatchObject({ id: gid(1), monto: 40, estado: 'Activo' })
  })

  it('edición con respuesta perdida: queda el último valor y una sola fila', async () => {
    const { api } = conRed(b)
    await api.saveGasto(entrada(1, { monto: 10 }), 'create')
    const { api: lenta, estado } = conRed(b, { perder: 1 })
    await lenta.saveGasto(entrada(1, { monto: 99 }), 'update')
    expect(estado.llamadas).toBe(2)
    const filas = filasDe(b, 'GASTOS')
    expect(filas).toHaveLength(1)
    expect(filas[0][1]).toBe(99)
  })

  it('anular con respuesta perdida es idempotente; restaurar vuelve a Activo', async () => {
    const { api } = conRed(b)
    await api.saveGasto(entrada(1), 'create')
    const { api: lenta } = conRed(b, { perder: 1 })
    await lenta.setEstado(gid(1), 'Anulado')
    expect(filasDe(b, 'GASTOS')[0][10]).toBe('Anulado')
    await lenta.setEstado(gid(1), 'Activo')
    expect(filasDe(b, 'GASTOS')[0][10]).toBe('Activo')
  })

  it('lote de gastos con respuesta perdida: ninguna fila duplicada y el orden se conserva', async () => {
    const { api, estado } = conRed(b, { perder: 1 })
    const lote = [1, 2, 3].map(n => entrada(n, { descripcion: `G${n}`, monto: n * 10 }))
    const r = await api.saveGastosBatch('lote-00000000-0000-4000-8000-0000000000aa', lote)
    expect(estado.llamadas).toBe(2)
    expect(r.confirmados).toBe(3)
    expect(filasDe(b, 'GASTOS').map(f => f[5])).toEqual(['G1', 'G2', 'G3'])
  })

  it('fondo, ajuste mensual y asignación manual con respuesta perdida: un solo registro de cada uno', async () => {
    const { api } = conRed(b, { perder: 1 })
    await api.saveFondo({ id: 'f-uno', nombre: 'Uno', monto: 100, moneda: 'PEN', orden: 1, recurrencia: 'mensual', mes: '2026-10', tipo: 'mensual', medioPago: '', color: '#B4693C', icono: '', activo: true } as never)
    const { api: a2 } = conRed(b, { perder: 1 })
    await a2.saveFondoMes({ fondoId: 'f-uno', mes: '2026-11', modo: 'solo', monto: 150 } as never)
    const { api: a3 } = conRed(b, { perder: 1 })
    await a3.saveAsignacion('gasto-no-existe', [{ fondoId: 'f-uno', monto: 10 }]).catch(() => undefined)   // gasto inexistente: se rechaza, no escribe
    expect(filasDe(b, 'FONDOS_PRESUPUESTO').filter(f => f[0] === 'f-uno')).toHaveLength(1)
    expect(filasDe(b, 'FONDOS_PRESUPUESTO_MESES').filter(f => f[0] === 'f-uno' && f[1] === '2026-11')).toHaveLength(1)
    expect(filasDe(b, 'ASIGNACIONES_GASTOS')).toHaveLength(0)
  })
})

describe('hoja ocupada (BUSY) y varias pestañas', () => {
  let b: B
  beforeEach(() => { b = load(); b.g.setup() })

  it('BUSY transitorio: el cliente reintenta y la escritura ocurre exactamente una vez', async () => {
    const { api, estado } = conRed(b, { busy: 2 })
    await api.saveGasto(entrada(1), 'create')
    expect(estado.llamadas).toBe(3)
    expect(filasDe(b, 'GASTOS')).toHaveLength(1)
  })

  it('BUSY permanente: tras agotar los intentos se informa el error y la hoja no cambia', async () => {
    const { api } = conRed(b, { busy: 99 })
    await expect(api.saveGasto(entrada(1), 'create')).rejects.toMatchObject({ code: 'BUSY' })
    expect(filasDe(b, 'GASTOS')).toHaveLength(0)
  })

  it('dos pestañas dan de alta el mismo gasto (mismo ID) y editan después: una sola fila, gana la última edición', async () => {
    const { api: p1 } = conRed(b), { api: p2 } = conRed(b)
    await Promise.all([p1.saveGasto(entrada(7, { monto: 10 }), 'create'), p2.saveGasto(entrada(7, { monto: 10 }), 'create')])
    expect(filasDe(b, 'GASTOS')).toHaveLength(1)
    await p1.saveGasto(entrada(7, { monto: 20 }), 'update')
    await p2.saveGasto(entrada(7, { monto: 30 }), 'update')
    const filas = filasDe(b, 'GASTOS')
    expect(filas).toHaveLength(1)
    expect(filas[0][1]).toBe(30)
  })

  it('editar un gasto que otra pestaña ya no tiene (borrado en la hoja) devuelve NOT_FOUND y no lo recrea', async () => {
    const { api } = conRed(b)
    await expect(api.saveGasto(entrada(9), 'update')).rejects.toBeInstanceOf(ApiError)
    expect(filasDe(b, 'GASTOS')).toHaveLength(0)
  })

  it('token incorrecto: UNAUTHORIZED sin reintentos y sin escribir', async () => {
    const cuerpos: string[] = []
    const fetchImpl = (async (_u: string, init: { body: string }) => { cuerpos.push(init.body); return new Response(b.g.doPost({ postData: { contents: init.body } }).body) }) as unknown as typeof fetch
    const api = createApi(httpTransport({ url: 'https://script.google.com/macros/s/X/exec', token: 'x'.repeat(24) }, fetchImpl, sinEspera))
    await expect(api.saveGasto(entrada(1), 'create')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(cuerpos).toHaveLength(1)
    expect(filasDe(b, 'GASTOS')).toHaveLength(0)
  })
})
