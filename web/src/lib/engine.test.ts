import { describe, expect, it } from 'vitest'
import { aggregate, budgetCents, diasDelPeriodo, type Ctx } from './engine'
import { percent, ratesFromConfig, toBaseCents, toCents } from './money'
import { daysInMonth, formatDate, shiftMonth, todayIn } from './dates'
import type { Caja, Filters, Gasto } from './types'

const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Comida', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})

const cajas: Caja[] = [
  { id: 'general', nombre: 'Caja general', presupuesto: 1000, filtroCampo: 'Todos', filtroValor: '', color: '#000000', orden: 1 },
  { id: 'auto', nombre: 'Caja Auto', presupuesto: 200, filtroCampo: 'Categoría', filtroValor: 'Auto', color: '#000000', orden: 2 },
]
const f = (over: Partial<Filters> = {}): Filters => ({ periodo: '2026-10', ambito: '', categoria: '', subcategoria: '', medioPago: '', tipoGasto: '', ...over })
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ base: 'PEN', rates: { USD: 3.8 }, today: '2026-10-10', cajas, presupuestos: [], ...over })

describe('dinero', () => {
  it('evita errores de coma flotante sumando en céntimos', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3))
  })
  it('convierte a la moneda base y devuelve null sin tipo de cambio', () => {
    expect(toBaseCents(10, 'USD', 'PEN', { USD: 3.8 })).toBe(3800)
    expect(toBaseCents(10, 'EUR', 'PEN', { USD: 3.8 })).toBeNull()
    expect(toBaseCents(19.99, 'PEN', 'PEN', {})).toBe(1999)
  })
  it('porcentaje con divisor cero es null', () => {
    expect(percent(50, 0)).toBeNull()
    expect(percent(1, 3)).toBe(33.3)
  })
  it('lee tipos de cambio de la configuración ignorando vacíos', () => {
    expect(ratesFromConfig({ tipo_cambio_USD: '3.75', tipo_cambio_EUR: '', moneda: 'PEN' })).toEqual({ USD: 3.75 })
  })
})

describe('fechas', () => {
  it('calcula días del mes, incluido febrero bisiesto', () => {
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2026-02')).toBe(28)
  })
  it('desplaza meses cruzando el año', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })
  it('hoy en Lima difiere de UTC después de las 19:00', () => {
    expect(todayIn('America/Lima', new Date('2026-10-10T02:00:00Z'))).toBe('2026-10-09')
  })
  it('formatea según configuración', () => {
    expect(formatDate('2026-10-05')).toBe('05/10/2026')
    expect(formatDate('2026-10-05', 'yyyy-MM-dd')).toBe('2026-10-05')
  })
  it('días del periodo: actual hasta hoy, pasado completo, futuro cero', () => {
    expect(diasDelPeriodo('2026-10', '2026-10-10')).toBe(10)
    expect(diasDelPeriodo('2026-09', '2026-10-10')).toBe(30)
    expect(diasDelPeriodo('2026-11', '2026-10-10')).toBe(0)
  })
})

describe('motor de agregación', () => {
  const data = [
    g({ monto: 100, fecha: '2026-10-01' }),
    g({ monto: 50.5, fecha: '2026-10-03', categoria: 'Auto', subcategoria: 'Gasolina', ambito: 'Familia', medioPago: 'Tarjeta' }),
    g({ monto: 10, moneda: 'USD', fecha: '2026-10-04' }),
    g({ monto: 999, fecha: '2026-10-04', estado: 'Anulado' }),
    g({ monto: 5, moneda: 'EUR', fecha: '2026-10-04' }),
    g({ monto: 70, fecha: '2026-09-15' }),
  ]

  it('calcula los KPIs del mes excluyendo anulados y monedas sin tipo de cambio', () => {
    const a = aggregate(data, f(), ctx())
    expect(a.total).toBe(10000 + 5050 + 3800)
    expect(a.count).toBe(3)
    expect(a.excluidosSinTipoCambio).toBe(1)
    expect(a.maxCents).toBe(10000)
    expect(a.cajaMensual).toBe(100000)
    expect(a.disponible).toBe(100000 - a.total)
    expect(a.consumidoPct).toBe(18.9)
    expect(a.promedioMovimiento).toBe(Math.round(a.total / 3))
    expect(a.promedioDiario).toBe(Math.round(a.total / 10))
  })

  it('todas las distribuciones reconcilian con el total', () => {
    const a = aggregate(data, f(), ctx())
    const sum = (xs: { cents: number }[]) => xs.reduce((s, x) => s + x.cents, 0)
    expect(sum(a.porAmbito)).toBe(a.total)
    expect(sum(a.porCategoria)).toBe(a.total)
    expect(sum(a.porMedio)).toBe(a.total)
    expect(sum(a.jerarquia)).toBe(a.total)
    expect(a.sankey.links.reduce((s, l) => s + l.value, 0)).toBe(a.total)
    expect(a.dias.filter(d => d.acumulado !== null).at(-1)!.acumulado).toBe(a.total)
    expect(a.meses.at(-1)!.cents).toBe(a.total)
  })

  it('los filtros afectan KPIs y gráficos por igual', () => {
    const a = aggregate(data, f({ categoria: 'Auto' }), ctx())
    expect(a.total).toBe(5050)
    expect(a.porAmbito).toEqual([{ name: 'Familia', cents: 5050, count: 1 }])
    expect(a.meses.at(-2)!.cents).toBe(0) // septiembre sin gastos de Auto: cero, porque ya hay historial
  })

  it('meses anteriores al primer registro son "sin datos", no cero', () => {
    const a = aggregate(data, f(), ctx())
    expect(a.meses.map(m => m.cents)).toEqual([null, null, null, null, 7000, a.total])
  })

  it('anular y restaurar cambia el resultado de forma reversible', () => {
    const one = g({ monto: 30 })
    expect(aggregate([one], f(), ctx()).total).toBe(3000)
    expect(aggregate([{ ...one, estado: 'Anulado' }], f(), ctx()).total).toBe(0)
    expect(aggregate([{ ...one, estado: 'Activo' }], f(), ctx()).total).toBe(3000)
  })

  it('cajas: presupuesto del mes con override y sin doble conteo dentro de cada caja', () => {
    const a = aggregate(data, f(), ctx({ presupuestos: [{ periodo: '2026-10', cajaId: 'auto', monto: 300 }] }))
    const auto = a.cajas.find(c => c.caja.id === 'auto')!
    expect(auto.presupuesto).toBe(30000)
    expect(auto.gastado).toBe(5050)
    expect(auto.pct).toBe(16.8)
    expect(a.cajas[0].gastado).toBe(a.total)
    expect(budgetCents(cajas[1], '2026-11', [])).toBe(20000)
  })

  it('presupuesto no configurado: porcentaje null y sin serie ideal', () => {
    const sinPresupuesto = cajas.map(c => ({ ...c, presupuesto: 0 }))
    const a = aggregate(data, f(), ctx({ cajas: sinPresupuesto }))
    expect(a.consumidoPct).toBeNull()
    expect(a.dias[0].ideal).toBeNull()
  })

  it('proyección termina en total + ritmo diario × días restantes', () => {
    const a = aggregate(data, f(), ctx())
    const last = a.dias.at(-1)!
    expect(last.proyeccion).toBe(Math.round(a.total + (a.total / 10) * 21))
    expect(a.dias[9].acumulado).toBe(a.total)
    expect(a.dias[10].acumulado).toBeNull()
  })

  it('periodo sin movimientos no divide entre cero', () => {
    const a = aggregate([], f(), ctx())
    expect(a.total).toBe(0)
    expect(a.promedioMovimiento).toBe(0)
    expect(a.promedioDiario).toBe(0)
    expect(a.max).toBeNull()
  })

  it('top subcategorías limita a 10', () => {
    const many = Array.from({ length: 15 }, (_, i) => g({ subcategoria: `S${i}`, monto: i + 1 }))
    expect(aggregate(many, f(), ctx()).porSubcategoria).toHaveLength(10)
  })
})
