// A-10 / T-03 — Contrato entre el modo demo (demo.ts) y el backend real (Code.gs ejecutado en un vm):
//  1. Misma lista de acciones: nada que la web use existe solo en un lado.
//  2. Mismo resultado financiero: la misma secuencia de operaciones deja los mismos datos y los mismos importes mensuales
//     (octubre, noviembre y diciembre de 2026, con el aislamiento mensual desde noviembre).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ApiError, createApi } from './lib/api'
import type { Transport } from './lib/api'
import { demoTransport } from './lib/demo'
import { aislaDesde, fondoMontoMes } from './lib/engine'
import { load } from './testing/backendHarness'

const leer = (ruta: string) => readFileSync(resolve(__dirname, ruta), 'utf8')
const claves = (texto: string, desde: string, sangria: number) => {
  const ini = texto.indexOf(desde)
  const fin = texto.indexOf('\n' + ' '.repeat(Math.max(0, sangria - 2)) + '}', ini)
  return [...texto.slice(ini, fin).matchAll(new RegExp(`^ {${sangria}}(\\w+):`, 'gm'))].map(m => m[1])
}

describe('contrato demo ↔ backend: acciones', () => {
  const backend = claves(leer('../../apps-script/Code.gs'), 'var ACTIONS = {', 2)
  const demo = claves(leer('./lib/demo.ts'), 'const handlers: Record', 4)

  it('se leyeron las acciones de ambos lados', () => {
    expect(backend.length).toBeGreaterThan(40)
    expect(demo.length).toBeGreaterThan(40)
  })
  it('toda acción del backend existe en el modo demo (la web nunca llama a una acción que la demo no entiende)', () => {
    expect(backend.filter(a => !demo.includes(a))).toEqual([])
  })
  it('toda acción de la demo existe en el backend (la demo no inventa operaciones)', () => {
    expect(demo.filter(a => !backend.includes(a))).toEqual([])
  })
})

describe('contrato demo ↔ backend: misma secuencia, mismos datos e importes', () => {
  const HOY = '2026-10-19'
  const ids = { g1: '11111111-2222-4333-8444-000000000001', g2: '11111111-2222-4333-8444-000000000002' }
  const g = (id: string, o: Record<string, unknown>) => ({ id, fecha: '2026-10-05', monto: 25.5, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo',
    descripcion: 'Menú', medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, comprobanteUrl: '', mode: 'create', ...o })
  const SECUENCIA: [string, Record<string, unknown>][] = [
    ['saveGasto', g(ids.g1, {})],
    ['saveGasto', g(ids.g1, { monto: 30.25, mode: 'update' })],
    ['saveGasto', g(ids.g1, {})],                                       // reintento del alta: no duplica
    ['saveGasto', g(ids.g2, { fecha: '2026-11-03', monto: 100, moneda: 'USD' })],
    ['setEstado', { id: ids.g2, estado: 'Anulado' }],
    ['setEstado', { id: ids.g2, estado: 'Activo' }],
    ['saveFondo', { id: 'f-base', nombre: 'Base', monto: 3000, moneda: 'PEN', orden: 1, recurrencia: 'mensual', mes: '2026-10', tipo: 'mensual' }],
    ['saveFondo', { id: 'f-extra', nombre: 'Extra', monto: 500, moneda: 'PEN', orden: 2, recurrencia: 'unica', mes: '2026-11', tipo: 'extra' }],
    ['saveFondo', { id: 'f-ahorro', nombre: 'Ahorro', monto: 800, moneda: 'PEN', orden: 3, recurrencia: 'mensual', mes: '2026-10', tipo: 'ahorro_asignado' }],
    ['saveFondoMes', { fondoId: 'f-base', mes: '2026-11', modo: 'solo', monto: 3200 }],
    ['saveFondoMes', { fondoId: 'f-base', mes: '2026-12', modo: 'desde', monto: 3500 }],
    ['saveFondo', { id: 'f-ahorro', nombre: 'Ahorro', monto: 800, moneda: 'PEN', orden: 3, recurrencia: 'mensual', mes: '2026-10', tipo: 'ahorro_asignado', activo: false }],
  ]

  async function correr(t: Transport) {
    for (const [accion, payload] of SECUENCIA) await t(accion, payload)
    const d = await createApi(t).getData()
    const cfg = d.config
    const aislar = aislaDesde(cfg)
    const meses = d.fondosMeses ?? []
    return {
      aislar,
      gastos: d.gastos.map(x => [x.fecha, x.monto, x.moneda, x.categoria, x.subcategoria, x.descripcion, x.medioPago, x.ambito, x.estado, x.id])
        .filter(r => [ids.g1, ids.g2].includes(String(r[9]))).sort((a, b) => String(a[9]).localeCompare(String(b[9]))),
      fondos: (d.fondos ?? []).map(f => [f.id, f.nombre, f.monto, f.moneda, f.activo, f.recurrencia, f.mes, f.tipo]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ajustes: meses.map(m => [m.fondoId, m.mes, m.modo, m.monto]).sort((a, b) => a.join('|').localeCompare(b.join('|'))),
      importes: Object.fromEntries(['2026-10', '2026-11', '2026-12'].map(mes => [mes,
        Object.fromEntries((d.fondos ?? []).map(f => [f.id, f.activo ? fondoMontoMes(f, mes, meses, aislar).monto : 'inactivo']))])),
    }
  }

  it('la demo y Code.gs dejan los mismos gastos, fondos, ajustes mensuales e importes por mes', async () => {
    const b = load(); b.g.setup()
    const backendT: Transport = async (accion, payload) => {
      const r = b.post(accion, payload)
      if (!r.ok) throw new ApiError(r.error.code, r.error.message)
      return r.data
    }
    const delBackend = await correr(backendT)
    const delDemo = await correr(demoTransport(HOY, 0, 0, 0, 0, true))
    expect(delDemo).toEqual(delBackend)
    // Sanidad: el contrato no puede cumplirse "en vacío".
    expect(delBackend.gastos).toHaveLength(2)
    expect(delBackend.fondos).toHaveLength(3)
    expect(delBackend.importes['2026-11']).toMatchObject({ 'f-base': 3200, 'f-extra': 500, 'f-ahorro': 'inactivo' })
    expect(delBackend.importes['2026-12']['f-base']).toBe(0)       // con aislamiento mensual solo cuenta lo aplicado a ese mes
  })

  it('ambos rechazan lo mismo: moneda inválida, importe negativo y fondo de un mes sin mes', async () => {
    const b = load(); b.g.setup()
    const backendT: Transport = async (accion, payload) => { const r = b.post(accion, payload); if (!r.ok) throw new ApiError(r.error.code, r.error.message); return r.data }
    const demoT = demoTransport(HOY, 0, 0, 0, 0, true)
    const malos: [string, Record<string, unknown>][] = [
      ['saveFondo', { id: 'f-x', nombre: 'X', monto: -5, moneda: 'PEN', orden: 1, recurrencia: 'mensual', mes: '2026-10' }],
      ['saveFondo', { id: 'f-y', nombre: 'Y', monto: 5, moneda: 'PEN', orden: 1, recurrencia: 'unica', mes: '' }],
      ['saveFondo', { id: 'f-z', nombre: 'Z', monto: 5, moneda: 'EUR', orden: 1, recurrencia: 'mensual', mes: '2026-10' }],
    ]
    for (const [a, p] of malos) {
      const e1 = await backendT(a, p).catch((e: ApiError) => e.code)
      const e2 = await demoT(a, p).catch((e: ApiError) => e.code)
      expect(e2, `${a} ${JSON.stringify(p)}`).toBe(e1)
      expect(e1).toBe('VALIDATION')
    }
  })
})
