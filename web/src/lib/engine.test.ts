import { describe, expect, it } from 'vitest'
import { aggregate, budgetCents, diasDelPeriodo, subKey, type Ctx } from './engine'
import { percent, ratesFromConfig, toBaseCents, toCents } from './money'
import { daysBetween, daysInMonth, formatDate, monthsInRange, presetRange, rangeLabel, shiftMonth, singleMonth, todayIn } from './dates'
import { sortMedios } from './visual'
import type { Caja, Filters, Gasto } from './types'

const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})

const caja = (id: string, presupuesto: number, filtroCampo: Caja['filtroCampo'] = 'Todos', filtroValor = '', orden = 1): Caja =>
  ({ id, nombre: id, presupuesto, filtroCampo, filtroValor, color: '#000000', orden })

const CAJAS = [caja('general', 5000), caja('bebe', 600, 'Categoría', 'Bebé', 2), caja('auto', 400, 'Categoría', 'Auto', 3), caja('plan-nube', 200, 'Categoría', 'Plan Nube', 4)]
const f = (over: Partial<Filters> = {}): Filters => ({ preset: 'mes', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [], ...over })
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ base: 'PEN', rates: { USD: 3.8 }, today: '2026-10-10', cajas: CAJAS, presupuestos: [], ...over })

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

describe('fechas y períodos', () => {
  it('días del mes, incluido febrero bisiesto', () => {
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
  it('presets: este mes, mes anterior, 3 y 6 meses, año', () => {
    expect(presetRange('mes', '2026-10-10')).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' })
    expect(presetRange('mes-anterior', '2026-01-15')).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' })
    expect(presetRange('3m', '2026-10-10')).toEqual({ desde: '2026-08-01', hasta: '2026-10-31' })
    expect(presetRange('6m', '2026-03-10')).toEqual({ desde: '2025-10-01', hasta: '2026-03-31' })
    expect(presetRange('anio', '2026-10-10')).toEqual({ desde: '2026-01-01', hasta: '2026-12-31' })
  })
  it('rangos y etiquetas', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(31)
    expect(monthsInRange('2026-08-15', '2026-10-02')).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(singleMonth('2026-10-01', '2026-10-31')).toBe('2026-10')
    expect(singleMonth('2026-10-01', '2026-10-30')).toBeNull()
    expect(rangeLabel({ desde: '2026-10-01', hasta: '2026-10-31' })).toBe('Octubre 2026')
  })
  it('días del período: en curso hasta hoy, pasado completo, futuro cero', () => {
    expect(diasDelPeriodo('2026-10-01', '2026-10-31', '2026-10-10')).toBe(10)
    expect(diasDelPeriodo('2026-09-01', '2026-09-30', '2026-10-10')).toBe(30)
    expect(diasDelPeriodo('2026-11-01', '2026-11-30', '2026-10-10')).toBe(0)
  })
  it('medios en el orden pedido, los demás al final', () => {
    expect(sortMedios(['Efectivo', 'Tarjeta de crédito', 'Yape', 'Otros', 'Plin', 'Transferencia', 'Sodexo']))
      .toEqual(['Yape', 'Plin', 'Sodexo', 'Transferencia', 'Efectivo', 'Otros', 'Tarjeta de crédito'])
  })
})

describe('cajas: la general es el total y las subcajas son reservas (casos 4, 5 y 6)', () => {
  it('caso 4: P 5.000 con reservas 600 + 400 + 200 → libre inicial 3.800, no 6.200', () => {
    const c = aggregate([], f(), ctx()).cajas
    expect(c.presupuesto).toBe(500000)
    expect(c.reservado).toBe(120000)
    expect(c.libreInicial).toBe(380000)
    expect(c.saldoLibre).toBe(380000)
    expect(c.disponible).toBe(500000)
  })
  it('caso 5: S/ 100 de Bebé baja Bebé a 500 y el global a 4.900; el saldo libre sigue en 3.800', () => {
    const c = aggregate([g({ categoria: 'Bebé', monto: 100, ambito: 'Familia' })], f(), ctx()).cajas
    const bebe = c.subcajas.find(s => s.caja.id === 'bebe')!
    expect(bebe.disponible).toBe(50000)
    expect(c.saldoLibre).toBe(380000)
    expect(c.disponible).toBe(490000)
  })
  it('caso 6: S/ 150 sin subcaja baja el saldo libre a 3.650 y el global a 4.750', () => {
    const c = aggregate([g({ categoria: 'Bebé', monto: 100 }), g({ categoria: 'Alimentación', monto: 150 })], f(), ctx()).cajas
    expect(c.saldoLibre).toBe(365000)
    expect(c.disponible).toBe(475000)
    expect(c.gastadoLibre).toBe(15000)
    expect(c.gastadoSubcajas).toBe(10000)
  })
  it('el exceso de una subcaja sale del saldo libre y la suma sigue cuadrando', () => {
    const c = aggregate([g({ categoria: 'Plan Nube', monto: 260 })], f(), ctx()).cajas
    const nube = c.subcajas.find(s => s.caja.id === 'plan-nube')!
    expect(nube.excedido).toBe(true)
    expect(nube.disponible).toBe(-6000)
    expect(c.saldoLibre).toBe(380000 - 6000)
    const subDisponible = c.subcajas.reduce((s, x) => s + Math.max(0, x.disponible), 0)
    expect(c.saldoLibre + subDisponible).toBe(c.disponible)
  })
  it('un gasto se imputa a una sola subcaja aunque coincida con dos', () => {
    const doble = [...CAJAS, caja('familia', 300, 'Ámbito', 'Familia', 5)]
    const c = aggregate([g({ categoria: 'Bebé', ambito: 'Familia', monto: 50 })], f(), ctx({ cajas: doble })).cajas
    expect(c.subcajas.find(s => s.caja.id === 'bebe')!.gastado).toBe(5000)
    expect(c.subcajas.find(s => s.caja.id === 'familia')!.gastado).toBe(0)
    expect(c.disponible).toBe(500000 - 5000)
  })
  it('detecta reservas mayores que el presupuesto general', () => {
    expect(aggregate([], f(), ctx({ cajas: [caja('general', 1000), caja('bebe', 1500, 'Categoría', 'Bebé', 2)] })).cajas.sobreasignado).toBe(true)
  })
  it('presupuesto del mes con override y suma de meses en rangos', () => {
    expect(budgetCents(CAJAS[1], '2026-11', [{ periodo: '2026-11', cajaId: 'bebe', monto: 700 }])).toBe(70000)
    const c = aggregate([], f({ desde: '2026-09-01', hasta: '2026-10-31' }), ctx({ presupuestos: [{ periodo: '2026-10', cajaId: 'general', monto: 6000 }] })).cajas
    expect(c.presupuesto).toBe(500000 + 600000)
  })
  it('los filtros de dimensión no cambian presupuesto ni cajas', () => {
    const data = [g({ categoria: 'Bebé', monto: 100 }), g({ monto: 150 })]
    const a = aggregate(data, f({ categorias: ['Bebé'] }), ctx())
    expect(a.total).toBe(10000)
    expect(a.totalPeriodo).toBe(25000)
    expect(a.cajas.disponible).toBe(475000)
    expect(a.filtrado).toBe(true)
  })
})

describe('motor de agregación', () => {
  const data = [
    g({ monto: 100, fecha: '2026-10-01' }),
    g({ monto: 50.5, fecha: '2026-10-03', categoria: 'Auto', subcategoria: 'Gasolina', ambito: 'Familia', medioPago: 'Efectivo' }),
    g({ monto: 10, moneda: 'USD', fecha: '2026-10-04' }),
    g({ monto: 999, fecha: '2026-10-04', estado: 'Anulado' }),
    g({ monto: 5, moneda: 'EUR', fecha: '2026-10-04' }),
    g({ monto: 70, fecha: '2026-09-15' }),
  ]

  it('KPIs del período excluyendo anulados y monedas sin tipo de cambio', () => {
    const a = aggregate(data, f(), ctx())
    expect(a.total).toBe(10000 + 5050 + 3800)
    expect(a.count).toBe(3)
    expect(a.excluidosSinTipoCambio).toBe(1)
    expect(a.maxCents).toBe(10000)
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
    expect(sum(a.porSubcategoria)).toBe(a.total)
    expect(a.sankey.links.reduce((s, l) => s + l.value, 0)).toBe(a.total)
    expect(a.dias.filter(d => d.acumulado !== null).at(-1)!.acumulado).toBe(a.total)
  })

  it('caso 10: filtros múltiples (Familia + Auto + Efectivo) afectan KPIs y gráficos por igual', () => {
    const a = aggregate(data, f({ ambitos: ['Familia'], categorias: ['Auto'], medios: ['Efectivo'] }), ctx())
    expect(a.total).toBe(5050)
    expect(a.porAmbito).toEqual([{ name: 'Familia', cents: 5050, count: 1 }])
    expect(aggregate(data, f({ ambitos: ['Familia', 'Personal'] }), ctx()).count).toBe(3)
  })

  it('filtra subcategorías por categoría (Otros existe en varias)', () => {
    const d = [g({ categoria: 'Otros', subcategoria: 'Otros', monto: 1 }), g({ categoria: 'Compras', subcategoria: 'Otros', monto: 2 })]
    expect(aggregate(d, f({ subcategorias: [subKey('Compras', 'Otros')] }), ctx()).total).toBe(200)
  })

  it('anular y restaurar es reversible', () => {
    const one = g({ monto: 30 })
    expect(aggregate([one], f(), ctx()).total).toBe(3000)
    expect(aggregate([{ ...one, estado: 'Anulado' }], f(), ctx()).total).toBe(0)
    expect(aggregate([{ ...one, estado: 'Activo' }], f(), ctx()).total).toBe(3000)
  })

  it('proyección solo en período en curso; ninguna en pasado o futuro', () => {
    const a = aggregate(data, f(), ctx())
    expect(a.estado).toBe('en-curso')
    expect(a.dias.at(-1)!.proyeccion).toBe(Math.round(a.total + (a.total / 10) * 21))
    expect(a.dias[10].acumulado).toBeNull()
    const pasado = aggregate(data, f(), ctx({ today: '2026-11-05' }))
    expect(pasado.estado).toBe('pasado')
    expect(pasado.dias.every(d => d.proyeccion === null)).toBe(true)
    expect(pasado.dias.at(-1)!.acumulado).toBe(pasado.total)
    const futuro = aggregate(data, f({ desde: '2026-11-01', hasta: '2026-11-30' }), ctx())
    expect(futuro.estado).toBe('futuro')
    expect(futuro.dias.every(d => d.acumulado === null && d.proyeccion === null)).toBe(true)
  })

  it('ritmo ideal llega al presupuesto el último día y no existe sin presupuesto', () => {
    expect(aggregate(data, f(), ctx()).dias.at(-1)!.ideal).toBe(500000)
    expect(aggregate(data, f(), ctx({ cajas: [] })).dias[0].ideal).toBeNull()
  })

  it('rango de varios meses: una serie diaria continua', () => {
    const a = aggregate(data, f({ preset: '3m', desde: '2026-08-01', hasta: '2026-10-31' }), ctx())
    expect(a.dias).toHaveLength(92)
    expect(a.total).toBe(10000 + 5050 + 3800 + 7000)
  })

  it('período sin movimientos no divide entre cero', () => {
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
