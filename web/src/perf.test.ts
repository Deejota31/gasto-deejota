// Mediciones locales con datos sintéticos (1k/5k/10k). No incluyen la latencia de Apps Script.
import { describe, expect, it } from 'vitest'
import { createApi } from './lib/api'
import { generateGastoRows } from './lib/demo'
import { aggregate } from './lib/engine'
import type { Caja } from './lib/types'

const today = '2026-10-09'
const cajas: Caja[] = [{ id: 'general', nombre: 'General', presupuesto: 7000, filtroCampo: 'Todos', filtroValor: '', color: '#000000', orden: 1 }]
const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]

describe('rendimiento local', () => {
  for (const n of [1000, 5000, 10000]) {
    it(`${n} movimientos`, async () => {
      const raw = { version: 'x', sheetUrl: '', gastos: generateGastoRows(n, today), catalogo: [], medios: [], cajas: [], presupuestos: [], config: {} }
      const json = JSON.stringify(raw)
      const parseT: number[] = [], aggT: number[] = []
      let data = null as Awaited<ReturnType<ReturnType<typeof createApi>['getData']>> | null
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now()
        data = await createApi(async () => JSON.parse(json)).getData()
        parseT.push(performance.now() - t0)
        const t1 = performance.now()
        aggregate(data.gastos, { periodo: '2026-10', ambito: '', categoria: '', subcategoria: '', medioPago: '', tipoGasto: '' },
          { base: 'PEN', rates: { USD: 3.75 }, today, cajas, presupuestos: [] })
        aggT.push(performance.now() - t1)
      }
      const r = { n, payloadKB: Math.round(json.length / 1024), parseYValidarMs: +median(parseT).toFixed(1), agregacionMs: +median(aggT).toFixed(2) }
      console.log(JSON.stringify(r))
      expect(r.agregacionMs).toBeLessThan(100) // presupuesto: recalcular filtros sin bloquear la UI
    })
  }
})
