// Dashboard: orden definitivo, solo cuatro KPIs no duplicados y cifras idénticas a las del motor con y sin filtros.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { aggregate, aislaDesde } from '../lib/engine'
import { createApi } from '../lib/api'
import { demoTransport } from '../lib/demo'
import { presetRange } from '../lib/dates'
import { formatMoney, ratesFromConfig } from '../lib/money'
import type { AppStore } from '../lib/store'
import type { AppData, Filters } from '../lib/types'
import Dashboard from './Dashboard'

const TODAY = '2026-10-09'
const norm = (s: string) => s.replace(/ /g, ' ')

beforeAll(() => {
  // jsdom no trae ResizeObserver (lo usan los gráficos).
  if (!('ResizeObserver' in globalThis)) {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  }
})
afterEach(cleanup)

async function datos(): Promise<AppData> {
  return createApi(demoTransport(TODAY, 120, 0, 0, 3)).getData(true)
}
const filtros = (over: Partial<Filters> = {}): Filters => ({ preset: 'mes', ...presetRange('mes', TODAY), ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [], ...over })
const montar = (data: AppData, filters: Filters) => {
  const store = { data, error: null, refresh: () => {} } as unknown as AppStore
  return render(<Dashboard store={store} filters={filters} setFilters={() => {}} today={TODAY} onNuevoGasto={() => {}} onGastosMensuales={() => {}} />)
}
const motor = (data: AppData, filters: Filters) => aggregate(data.gastos, filters, {
  base: data.config.moneda || 'PEN', rates: ratesFromConfig(data.config), today: TODAY, cajas: data.cajas, presupuestos: data.presupuestos,
  fuentes: data.fuentes ?? [], fuentesMeses: data.fuentesMeses ?? [], aislarDesde: aislaDesde(data.config),
})
const celda = (id: string) => norm(within(screen.getByTestId(`cons-${id}`)).getAllByText(/.*/, { selector: 'p' })[1].textContent ?? '')

describe('Dashboard: Presupuesto consolidado y KPIs', () => {
  it('los cuatro KPIs viven dentro del Presupuesto consolidado, al final, y no hay sección separada', async () => {
    montar(await datos(), filtros())
    const consolidado = screen.getByTestId('consolidado')
    const kpis = screen.getByTestId('kpis')
    expect(consolidado.contains(kpis)).toBe(true)
    expect(screen.getAllByTestId('kpis')).toHaveLength(1)
    const etiquetas = [...kpis.children].map(t => t.querySelector('p')!.textContent)
    expect(etiquetas).toEqual(['Promedio diario', 'Promedio por movimiento', 'Mayor gasto', 'Movimientos'])
    // nivel 4 va después del nivel 3 (secundarios)
    const consumido = screen.getByTestId('cons-consumido')
    expect(!!(consumido.compareDocumentPosition(kpis) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    // ninguna duplicada como tarjeta
    for (const l of ['Presupuesto', 'Caja mensual', 'Total gastado', 'Disponible']) expect(within(kpis).queryByText(l, { exact: true }), l).toBeNull()
    expect(screen.queryByText('Total gastado')).toBeNull()
  })

  it('las cuatro métricas son compactas, comparten estilo, conservan subtítulo e icono de información', async () => {
    montar(await datos(), filtros())
    const kpis = screen.getByTestId('kpis')
    expect(kpis.className).toContain('lg:grid-cols-4')
    expect(kpis.className).toContain('grid-cols-2')
    const tarjetas = [...kpis.children] as HTMLElement[]
    expect(tarjetas).toHaveLength(4)
    expect(new Set(tarjetas.map(t => t.className)).size).toBe(1)
    for (const t of tarjetas) {
      expect(t.className).not.toContain('p-4')
      expect(t.querySelectorAll('p')[1].className).toContain('text-sm')                      // valor pequeño, no compite con los principales
    }
    for (const l of ['Promedio diario', 'Promedio por movimiento', 'Mayor gasto', 'Movimientos']) {
      expect(screen.getByRole('button', { name: `Información: ${l}` }), l).toBeTruthy()
    }
    expect(within(kpis).getByText('Ticket promedio')).toBeTruthy()
  })

  it('los 12 indicadores del Presupuesto consolidado tienen icono a la izquierda del título', async () => {
    montar(await datos(), filtros())
    const ids = ['cons-presupuesto-consolidado', 'cons-gastado-del-período', 'cons-disponible-consolidado', 'cons-reservado-en-cajas', 'cons-libre-inicial', 'cons-gastado-fuera-de-reservas', 'cons-saldo-libre-actual', 'cons-consumido',
      'kpi-promedio-diario', 'kpi-promedio-por-movimiento', 'kpi-mayor-gasto', 'kpi-movimientos']
    for (const id of ids) {
      const cel = screen.getByTestId(id)
      const icono = cel.querySelector('span[aria-hidden="true"] > svg')
      expect(icono, id).toBeTruthy()
      const titulo = cel.querySelector('p')!
      expect(!!(icono!.compareDocumentPosition(titulo) & Node.DOCUMENT_POSITION_FOLLOWING), `${id}: icono antes del título`).toBe(true)
    }
    for (const [id, clase] of [['cons-libre-inicial', 'lucide-wallet'], ['cons-gastado-fuera-de-reservas', 'lucide-arrow-up-right'], ['cons-saldo-libre-actual', 'lucide-scale'], ['cons-consumido', 'lucide-gauge']]) {
      expect(screen.getByTestId(id).querySelector(`svg.${clase}`), id).toBeTruthy()
    }
  })

  it('orden: Presupuesto consolidado (con KPIs) → Fuentes de dinero y Cajas / reservas → gráficos', async () => {
    montar(await datos(), filtros())
    const orden = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const cons = screen.getByTestId('caja-general'), acordeones = screen.getByTestId('resumen-cajas'), kpis = screen.getByTestId('kpis')
    const grafico = screen.getByText(/^Gasto acumulado/)
    expect(cons.contains(kpis)).toBe(true)
    expect(orden(cons, acordeones)).toBe(true)
    expect(orden(acordeones, grafico)).toBe(true)
    expect(orden(kpis, acordeones)).toBe(true)
    expect(screen.getByRole('button', { name: /^Fuentes de dinero/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Cajas \/ reservas/ })).toBeTruthy()
  })

  it('el Presupuesto consolidado muestra los mismos importes que el motor (regresión con el mismo fixture)', async () => {
    const data = await datos()
    const f = filtros()
    montar(data, f)
    const c = motor(data, f).cajas
    const m = (n: number) => norm(formatMoney(n, data.config.moneda || 'PEN'))
    expect(celda('presupuesto-consolidado')).toBe(m(c.presupuesto))
    expect(celda('gastado-del-período')).toBe(m(c.gastadoPeriodo))
    expect(celda('disponible-consolidado')).toBe(m(c.disponible))
    expect(celda('reservado-en-cajas')).toBe(m(c.reservado))
    expect(celda('libre-inicial')).toBe(m(c.libreInicial))
    expect(celda('gastado-fuera-de-reservas')).toBe(m(c.gastadoLibre))
    expect(celda('saldo-libre-actual')).toBe(m(c.saldoLibre))
    expect(celda('consumido')).toBe(c.pct === null ? '—' : `${c.pct}%`)
    expect(c.disponible).toBe(c.presupuesto - c.gastadoPeriodo)
  })

  it('con filtros, el presupuesto no cambia (período completo) y los KPIs sí', async () => {
    const data = await datos()
    const sin = filtros(), con = filtros({ ambitos: ['Personal'] })
    const a0 = motor(data, sin), a1 = motor(data, con)
    expect(a1.count).toBeLessThan(a0.count)                                              // el filtro realmente recorta
    expect(a1.cajas).toEqual(a0.cajas)                                                   // el presupuesto consolidado ignora los filtros de dimensión

    const { unmount } = montar(data, sin)
    const base = celda('gastado-del-período'), movimientos0 = within(screen.getByTestId('kpis')).getByText(String(a0.count), { exact: true })
    expect(movimientos0).toBeTruthy()
    unmount()

    montar(data, con)
    expect(celda('gastado-del-período')).toBe(base)
    const k = screen.getByTestId('kpis')
    expect(within(k).getByText(String(a1.count), { exact: true })).toBeTruthy()
    const m = (n: number) => norm(formatMoney(n, data.config.moneda || 'PEN'))
    expect(within(k).getByText(m(a1.promedioMovimiento), { exact: false }).textContent).toBeTruthy()
  })

  it('sin errores de consola al renderizar', async () => {
    const errores = vi.spyOn(console, 'error').mockImplementation(() => {})
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {})
    montar(await datos(), filtros())
    const llamadas = [...errores.mock.calls, ...avisos.mock.calls].map(c => String(c[0]))
    // Recharts avisa de un ancho 0 en jsdom (no hay layout): no es un error de la aplicación.
    expect(llamadas.filter(t => !/width\(0\)|height\(0\)|ResponsiveContainer/.test(t))).toEqual([])
    errores.mockRestore(); avisos.mockRestore()
  })
})
