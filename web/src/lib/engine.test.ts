import { describe, expect, it } from 'vitest'
import { aggregate, diasDelPeriodo, subKey, type Ctx } from './engine'
import { percent, ratesFromConfig, toBaseCents, toCents } from './money'
import { daysBetween, daysInMonth, formatDate, monthsInRange, presetRange, rangeLabel, shiftMonth, singleMonth, todayIn } from './dates'
import { sortMedios } from './visual'
import type { Filters, Fondo, Gasto, ReglaFondo, Ruta } from './types'

const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})

// v1.28: los fondos son la única estructura de presupuesto (las cajas y subcajas se retiraron).
const regla = (cobertura: ReglaFondo['cobertura'], rutas: Partial<Ruta>[] = []): ReglaFondo[] =>
  [{ desde: '', medios: 'todos', listaMedios: [], cobertura, rutas: rutas.map(r => ({ ambito: '', categoria: '', subcategoria: '', ...r })), restringeMedio: false }]
const fondo = (id: string, monto: number, orden: number, reglas: ReglaFondo[] = []): Fondo => ({
  id, nombre: id, monto, moneda: 'PEN', color: '#000000', icono: '', activo: true, orden, recurrencia: 'mensual', mes: '', medioPago: '', tipo: 'mensual', creadoEn: '', actualizadoEn: '', reglas,
})
const FONDOS = [fondo('general', 5000, 1), fondo('bebe', 600, 2, regla('categoria', [{ categoria: 'Bebé' }])), fondo('auto', 400, 3, regla('categoria', [{ categoria: 'Auto' }])),
  fondo('plan-nube', 200, 4, regla('categoria', [{ categoria: 'Plan Nube' }]))]
const f = (over: Partial<Filters> = {}): Filters => ({ preset: 'mes', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [], ...over })
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ base: 'PEN', rates: { USD: 3.8 }, today: '2026-10-10', fondos: [FONDOS[0]], fondosMeses: [], ...over })

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
  it('medios en el orden pedido, los agregados después y "Otros" siempre al final', () => {
    expect(sortMedios(['Efectivo', 'Tarjeta de crédito', 'Yape', 'Otros', 'Plin', 'Transferencia', 'Sodexo']))
      .toEqual(['Yape', 'Plin', 'Sodexo', 'Transferencia', 'Efectivo', 'Tarjeta de crédito', 'Otros'])
  })
})

describe('fondos: el presupuesto es la suma de los fondos y cada gasto va al fondo más específico', () => {
  const c4 = () => ctx({ fondos: FONDOS })
  it('P = suma de los fondos activos (5.000 + 600 + 400 + 200 = 6.200); no hay reservas que resten', () => {
    const p = aggregate([], f(), c4()).presupuesto
    expect([p.presupuesto, p.disponible, p.activos]).toEqual([620000, 620000, 4])
  })
  it('S/ 100 de Bebé baja Bebé a 500 y el global a 6.100; General no se toca', () => {
    const p = aggregate([g({ categoria: 'Bebé', monto: 100, ambito: 'Familia' })], f(), c4()).presupuesto
    const por = Object.fromEntries(p.fondos.map(x => [x.fondo.id, x.disponible]))
    expect([por.bebe, por.general, p.disponible]).toEqual([50000, 500000, 610000])
  })
  it('S/ 150 sin fondo específico va a General (cubre todos los gastos)', () => {
    const p = aggregate([g({ categoria: 'Bebé', monto: 100 }), g({ categoria: 'Alimentación', monto: 150 })], f(), c4()).presupuesto
    expect(p.fondos.find(x => x.fondo.id === 'general')!.gastado).toBe(15000)
    expect(p.fondos.find(x => x.fondo.id === 'bebe')!.gastado).toBe(10000)
  })
  it('el exceso de un fondo específico pasa a General como excedente y la suma sigue cuadrando', () => {
    const p = aggregate([g({ categoria: 'Plan Nube', monto: 260 })], f(), c4()).presupuesto
    const nube = p.fondos.find(x => x.fondo.id === 'plan-nube')!
    expect([nube.gastado, nube.disponible, nube.enviado, nube.destinos]).toEqual([20000, 0, 6000, ['general']])
    expect(p.fondos.find(x => x.fondo.id === 'general')!.recibido).toBe(6000)
    expect(p.fondos.reduce((s, x) => s + x.gastado, 0)).toBe(26000)
  })
  it('un gasto se imputa al fondo más específico aunque coincida con varios', () => {
    const doble = [...FONDOS, fondo('familia', 300, 5, regla('ambito', [{ ambito: 'Familia' }]))]
    const p = aggregate([g({ categoria: 'Bebé', ambito: 'Familia', monto: 50 })], f(), ctx({ fondos: doble })).presupuesto
    expect(p.fondos.find(x => x.fondo.id === 'bebe')!.gastado).toBe(5000)
    expect(p.fondos.find(x => x.fondo.id === 'familia')!.gastado).toBe(0)
  })
  it('prioridad por especificidad: Subcategoría > Categoría > Ámbito > Todos, sin importar el orden manual', () => {
    const fs = [fondo('todos', 100, 1), fondo('amb', 100, 2, regla('ambito', [{ ambito: 'Familia' }])), fondo('cat', 100, 3, regla('categoria', [{ categoria: 'Servicios' }])),
      fondo('sub', 100, 4, regla('subcategoria', [{ categoria: 'Servicios', subcategoria: 'Línea Celular' }]))]
    const quien = (gs: Partial<Gasto>) => aggregate([g({ monto: 10, ...gs })], f(), ctx({ fondos: fs })).presupuesto.fondos.find(x => x.gastado > 0)!.fondo.id
    expect(quien({ ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Línea Celular' })).toBe('sub')
    expect(quien({ ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Agua' })).toBe('cat')
    expect(quien({ ambito: 'Familia', categoria: 'Auto' })).toBe('amb')
    expect(quien({ ambito: 'Personal', categoria: 'Auto' })).toBe('todos')
  })
  it('un fondo inactivo no suma ni toma gastos', () => {
    const fs = [FONDOS[0], { ...FONDOS[1], activo: false }]
    const p = aggregate([g({ categoria: 'Bebé', monto: 40 })], f(), ctx({ fondos: fs })).presupuesto
    expect(p.presupuesto).toBe(500000)
    expect(p.fondos.find(x => x.fondo.id === 'general')!.gastado).toBe(4000)
  })
  it('rango de varios meses: suma el presupuesto de cada mes', () => {
    expect(aggregate([], f({ desde: '2026-09-01', hasta: '2026-10-31' }), c4()).presupuesto.presupuesto).toBe(620000 * 2)
  })
  it('los filtros de dimensión no cambian presupuesto ni fondos', () => {
    const data = [g({ categoria: 'Bebé', monto: 100 }), g({ monto: 150 })]
    const a = aggregate(data, f({ categorias: ['Bebé'] }), ctx())
    expect(a.total).toBe(10000)
    expect(a.totalPeriodo).toBe(25000)
    expect(a.presupuesto.disponible).toBe(475000)
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
    expect(sum(a.sankey.medios)).toBe(a.total)
    expect(sum(a.sankey.ambitos)).toBe(a.total)
    expect(sum(a.frecuencia)).toBe(a.total)
    expect(sum(a.jerarquia)).toBe(a.total)
    expect(sum(a.porSubcategoria)).toBe(a.total)
    expect(sum(a.sankey.links)).toBe(a.total)
    const cnt = (xs: { count: number }[]) => xs.reduce((s, x) => s + x.count, 0)
    expect(cnt(a.sankey.links)).toBe(a.count)
    expect(cnt(a.sankey.medios)).toBe(a.count)
    expect(cnt(a.jerarquia)).toBe(a.count)
    // Cada enlace suma a su medio y a su ámbito.
    for (const m of a.sankey.medios) expect(sum(a.sankey.links.filter(l => l.medio === m.name))).toBe(m.cents)
    for (const x of a.sankey.ambitos) expect(sum(a.sankey.links.filter(l => l.ambito === x.name))).toBe(x.cents)
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
    expect(aggregate(data, f(), ctx({ fondos: [] })).dias[0].ideal).toBeNull()
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
    expect(a.resumen).toEqual({ primerFecha: null, ultimaFecha: null, diaMax: null, medioDominante: null, monedas: [] })
    expect(a.sankey.links).toEqual([])
  })

  it('resumen del período para el análisis: fechas, día de mayor gasto, medio dominante y monedas', () => {
    const a = aggregate(data, f(), ctx())
    expect(a.resumen.primerFecha).toBe('2026-10-01')
    expect(a.resumen.ultimaFecha).toBe('2026-10-04')
    expect(a.resumen.diaMax).toEqual({ date: '2026-10-01', cents: 10000 })
    expect(a.resumen.medioDominante?.name).toBe(a.sankey.medios[0].name)
    expect(a.resumen.monedas).toEqual(['PEN', 'USD'])   // EUR sin tipo de cambio queda fuera
    const auto = a.frecuencia.find(x => x.name === 'Auto')!
    expect(auto).toMatchObject({ count: 1, cents: 5050, ambitos: ['Familia'] })
  })

  it('top subcategorías limita a 10', () => {
    const many = Array.from({ length: 15 }, (_, i) => g({ subcategoria: `S${i}`, monto: i + 1 }))
    expect(aggregate(many, f(), ctx()).porSubcategoria).toHaveLength(10)
  })
})
