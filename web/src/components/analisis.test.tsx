// Análisis detallado: vistas, estado vacío y funciones de diseño (sin navegador).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { aggregate } from '../lib/engine'
import type { Filters, Gasto } from '../lib/types'
import { AnalisisDetallado, jitter, layoutSankey, niceMax, SIN_DATOS } from './analisis'

const f: Filters = { preset: 'custom', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
const ctx = { base: 'PEN', rates: { USD: 3.75 }, today: '2026-10-09', cajas: [], presupuestos: [] }
let n = 0
const g = (p: Partial<Gasto>): Gasto => ({
  id: `id-${++n}`, fecha: '2026-10-02', monto: 10, moneda: 'PEN', ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Almuerzo',
  descripcion: 'x', medioPago: 'Yape', tipoGasto: 'Variable', esRecurrente: false, estado: 'Activo', origen: 'web', comprobanteUrl: '',
  creadoEn: 't', actualizadoEn: 't', ...p,
} as Gasto)

const datos = [
  g({ monto: 100, medioPago: 'Yape', ambito: 'Personal' }),
  g({ monto: 50, medioPago: 'Yape', ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Luz', fecha: '2026-10-05' }),
  g({ monto: 30, medioPago: 'Efectivo', ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Agua', fecha: '2026-10-05' }),
  g({ monto: 20, moneda: 'USD', medioPago: 'Transferencia', ambito: 'Personal', categoria: 'Suscripciones', subcategoria: 'Claude', fecha: '2026-10-07' }),
]
const periodo = { nombre: 'octubre 2026', desde: f.desde, hasta: f.hasta }

afterEach(cleanup)

describe('Análisis detallado', () => {
  it('solo tres pestañas: ya no existe "Por medio de pago"', () => {
    render(<AnalisisDetallado a={aggregate(datos, f, ctx)} currency="PEN" catalogo={[]} periodo={periodo} filtros={[]} onPickCategoria={() => {}} />)
    const tabs = screen.getAllByRole('tab').map(t => t.getAttribute('aria-label'))
    expect(tabs).toEqual(['Jerarquía', 'Flujo de medios de pago', 'Frecuencia vs monto'])
    expect(screen.queryByText(/Por medio de pago/)).toBeNull()
  })

  it('encabezado con período, movimientos, monedas y filtros', () => {
    render(<AnalisisDetallado a={aggregate(datos, f, ctx)} currency="PEN" catalogo={[]} periodo={periodo} filtros={['Personal']} onPickCategoria={() => {}} />)
    const c = screen.getByTestId('analisis-contexto')
    expect(c.textContent).toContain('01/10/2026 – 31/10/2026')
    expect(c.textContent).toContain('4 movimientos')
    expect(c.textContent).toContain('PEN y USD')
    expect(c.textContent).toContain('Filtros: Personal')
  })

  it('jerarquía: totales y porcentajes por nivel; expandir y contraer', () => {
    render(<AnalisisDetallado a={aggregate(datos, f, ctx)} currency="PEN" catalogo={[]} periodo={periodo} filtros={[]} onPickCategoria={() => {}} />)
    // Personal = 100 + 75 = 175 de 255 → 68.6 %; Familia = 80 → 31.4 %
    const personal = screen.getByRole('button', { name: /Personal/ })
    expect(personal.textContent).toContain('68.6%')
    expect(personal.getAttribute('aria-expanded')).toBe('true')       // el más importante abierto por defecto
    const familia = screen.getByRole('button', { name: /Familia/ })
    expect(familia.textContent).toContain('31.4%')
    expect(familia.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(familia)
    expect(familia.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTitle(/Luz: S\/ 50\.00 · 62.5% de Servicios/)).toBeTruthy()
  })

  it('estado vacío elegante en las tres vistas', () => {
    const vacio = aggregate([], f, ctx)
    render(<AnalisisDetallado a={vacio} currency="PEN" catalogo={[]} periodo={periodo} filtros={[]} onPickCategoria={() => {}} />)
    for (const t of ['Jerarquía', 'Flujo de medios de pago', 'Frecuencia vs monto']) {
      fireEvent.click(screen.getByRole('tab', { name: t }))
      expect(screen.getByText(SIN_DATOS)).toBeTruthy()
    }
  })

  it('sankey: nodos proporcionales y enlaces apilados sin salirse de su nodo', () => {
    const a = aggregate(datos, f, ctx)
    const L = layoutSankey(a.sankey, 600, 300, 120, () => '#000', () => '#111')
    expect(L.medios.map(m => m.name)).toEqual(['Yape', 'Transferencia', 'Efectivo'])
    expect(L.ambitos.map(m => m.name)).toEqual(['Personal', 'Familia'])
    for (const nd of [...L.medios, ...L.ambitos]) {
      expect(nd.y).toBeGreaterThanOrEqual(0)
      expect(nd.y + nd.h).toBeLessThanOrEqual(300.0001)
    }
    for (const l of L.links) {
      const m = L.medios.find(x => x.name === l.medio)!, t = L.ambitos.find(x => x.name === l.ambito)!
      expect(l.y0).toBeGreaterThanOrEqual(m.y); expect(l.y0).toBeLessThanOrEqual(m.y + m.h)
      expect(l.y1).toBeGreaterThanOrEqual(t.y); expect(l.y1).toBeLessThanOrEqual(t.y + t.h)
    }
    // Yape → Personal: 100 de 150 de Yape (66,7 %) y 100 de 175 de Personal
    const yp = a.sankey.links.find(l => l.medio === 'Yape' && l.ambito === 'Personal')!
    expect(yp).toMatchObject({ cents: 10000, count: 1 })
  })

  it('frecuencia: separa puntos superpuestos y el eje Y usa valores redondos', () => {
    expect(jitter([{ count: 1, cents: 100 }, { count: 1, cents: 101 }, { count: 2, cents: 100 }], 1000)).toEqual([-6, 6, 0])
    expect(jitter([{ count: 1, cents: 100 }, { count: 1, cents: 900 }], 1000)).toEqual([0, 0])
    expect(niceMax(35800)).toBe(40000)
    expect(niceMax(17)).toBe(20)
    expect(niceMax(0)).toBe(100)
  })
})
