// Explorador de gasto acumulado y diario: estado compartido de fecha, detalle, teclado y restablecimiento. (El clic real sobre los
// gráficos se prueba en e2e/v125.spec.ts; jsdom no tiene layout.)
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { aggregate } from '../lib/engine'
import type { Filters, Gasto } from '../lib/types'
import { AcumuladoChart } from './charts'

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(cleanup)

const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const GASTOS = [
  g({ fecha: '2026-10-05', monto: 10, descripcion: 'Menú' }), g({ fecha: '2026-10-05', monto: 30.5, categoria: 'Auto', subcategoria: 'Gasolina', ambito: 'Trabajo', descripcion: 'Grifo', medioPago: 'Plin' }),
  g({ fecha: '2026-10-08', monto: 20 }), g({ fecha: '2026-09-15', monto: 5 }),
]
const f = (over: Partial<Filters> = {}): Filters => ({ preset: 'mes', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [], ...over })
const ctx = { base: 'PEN', rates: {}, today: '2026-10-10', cajas: [], presupuestos: [] }
const nbsp = (s: string | null) => (s ?? '').replace(/ /g, ' ')

function montar(filtros = f(), gastos = GASTOS) {
  const a = aggregate(gastos, filtros, ctx)
  const ui = (a2 = a, fl = filtros) => <AcumuladoChart a={a2} currency="PEN" gastos={gastos} filters={fl} rates={{}} />
  const r = render(ui())
  return { a, r, ui }
}
const grupo = () => screen.getByRole('group', { name: /Gasto acumulado y gasto diario/ })

describe('AcumuladoChart interactivo', () => {
  it('sin selección: pista y sin panel; el grupo es accesible por teclado', () => {
    montar()
    expect(screen.getByTestId('detalle-dia-ayuda')).toBeTruthy()
    expect(screen.queryByTestId('detalle-dia')).toBeNull()
    expect(grupo().getAttribute('tabindex')).toBe('0')
    expect(screen.queryByRole('button', { name: 'Limpiar selección' })).toBeNull()
    expect(screen.getByTestId('detalle-dia-region').getAttribute('aria-live')).toBe('polite')
  })

  it('→ selecciona el último día real; ← → mueven; Inicio/Fin saltan; Esc limpia', () => {
    montar()
    fireEvent.keyDown(grupo(), { key: 'ArrowRight' })
    expect(screen.getByTestId('detalle-dia').getAttribute('data-fecha')).toBe('2026-10-10')       // hoy (último día real)
    fireEvent.keyDown(grupo(), { key: 'ArrowLeft' })
    expect(screen.getByTestId('detalle-dia').getAttribute('data-fecha')).toBe('2026-10-09')
    fireEvent.keyDown(grupo(), { key: 'Home' })
    expect(screen.getByTestId('detalle-dia').getAttribute('data-fecha')).toBe('2026-10-01')
    fireEvent.keyDown(grupo(), { key: 'End' })
    expect(screen.getByTestId('detalle-dia').getAttribute('data-fecha')).toBe('2026-10-31')
    fireEvent.keyDown(grupo(), { key: 'Escape' })
    expect(screen.queryByTestId('detalle-dia')).toBeNull()
  })

  it('día con varios gastos: cantidad, gasto del día ≠ acumulado, categorías y lista con los campos pedidos', () => {
    montar()
    fireEvent.keyDown(grupo(), { key: 'Home' })
    for (let i = 0; i < 4; i++) fireEvent.keyDown(grupo(), { key: 'ArrowRight' })               // 5 de octubre
    const p = within(screen.getByTestId('detalle-dia'))
    expect(screen.getByTestId('detalle-dia').getAttribute('data-fecha')).toBe('2026-10-05')
    expect(p.getByTestId('detalle-dia-cantidad').textContent).toBe('2')
    expect(nbsp(p.getByTestId('detalle-dia-gasto').textContent)).toBe('S/ 40.50')
    expect(nbsp(p.getByTestId('detalle-dia-acumulado').textContent)).toBe('S/ 40.50')             // primer día con gasto: acumulado = día
    const cats = p.getByTestId('detalle-dia-categorias').textContent!
    expect(cats).toContain('Alimentación'); expect(cats).toContain('Auto')
    const filas = p.getAllByTestId('detalle-dia-mov')
    expect(filas).toHaveLength(2)
    expect(filas[0].textContent).toContain('Grifo')                                                // mayor importe primero
    for (const t of ['Trabajo', 'Auto › Gasolina', 'Plin']) expect(filas[0].textContent).toContain(t)
    expect(nbsp(filas[0].textContent)).toContain('S/ 30.50')
    // el 8 sí suma al acumulado y el gasto del día no se confunde con él
    fireEvent.keyDown(grupo(), { key: 'ArrowRight' }); fireEvent.keyDown(grupo(), { key: 'ArrowRight' }); fireEvent.keyDown(grupo(), { key: 'ArrowRight' })
    expect(screen.getByTestId('detalle-dia').getAttribute('data-fecha')).toBe('2026-10-08')
    expect(nbsp(screen.getByTestId('detalle-dia-gasto').textContent)).toBe('S/ 20.00')
    expect(nbsp(screen.getByTestId('detalle-dia-acumulado').textContent)).toBe('S/ 60.50')
  })

  it('día sin gastos: estado vacío y el acumulado se mantiene; no hay lista', () => {
    montar()
    fireEvent.keyDown(grupo(), { key: 'Home' })
    fireEvent.keyDown(grupo(), { key: 'ArrowRight' })                                              // 2 de octubre
    expect(screen.getByTestId('detalle-dia-vacio')).toBeTruthy()
    expect(screen.queryByTestId('detalle-dia-lista')).toBeNull()
    expect(nbsp(screen.getByTestId('detalle-dia-gasto').textContent)).toBe('S/ 0.00')
  })

  it('día futuro: marcado como proyección, sin movimientos ni cantidad inventados', () => {
    montar()
    fireEvent.keyDown(grupo(), { key: 'End' })
    expect(screen.getByTestId('detalle-dia-proyeccion').textContent).toMatch(/sin movimientos reales/)
    expect(screen.queryByTestId('detalle-dia-mov')).toBeNull()
    expect(screen.queryByTestId('detalle-dia-cantidad')).toBeNull()
  })

  it('«Limpiar selección» deselecciona y el filtro de ámbito recorta el detalle', () => {
    const filtros = f({ ambitos: ['Trabajo'] })
    montar(filtros)
    fireEvent.keyDown(grupo(), { key: 'Home' })
    for (let i = 0; i < 4; i++) fireEvent.keyDown(grupo(), { key: 'ArrowRight' })
    expect(screen.getAllByTestId('detalle-dia-mov')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }))
    expect(screen.queryByTestId('detalle-dia')).toBeNull()
  })

  it('al cambiar el período principal la selección se restablece', () => {
    const { r, ui } = montar()
    fireEvent.keyDown(grupo(), { key: 'Home' })
    expect(screen.getByTestId('detalle-dia')).toBeTruthy()
    const f2 = f({ desde: '2026-09-01', hasta: '2026-09-30' })
    r.rerender(ui(aggregate(GASTOS, f2, ctx), f2))
    expect(screen.queryByTestId('detalle-dia')).toBeNull()
    expect(screen.getByTestId('detalle-dia-ayuda')).toBeTruthy()
  })
})
