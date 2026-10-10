import { describe, expect, it } from 'vitest'
import { aggregate, fuenteMontoMes, type Ctx } from './engine'
import { calcularCompromisos, calcularPresupuesto } from './salud'
import type { Caja, Filters, Fuente, FuenteMes, Gasto } from './types'

// Pruebas matemáticas de fuentes de dinero (v1.8): el caso real de la especificación y sus variantes.
const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const fu = (id: string, monto: number, over: Partial<Fuente> = {}): Fuente => ({
  id, nombre: id, monto, moneda: 'PEN', color: '#000000', icono: '', activo: true, orden: 1, recurrencia: 'mensual', mes: '', medioPago: '',
  creadoEn: '', actualizadoEn: '', ...over,
})
const caja = (id: string, presupuesto: number, filtroCampo: Caja['filtroCampo'] = 'Todos', filtroValor = '', orden = 1): Caja =>
  ({ id, nombre: id, presupuesto, filtroCampo, filtroValor, color: '#000000', orden })
const oct: Filters = { preset: 'mes', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
const nov: Filters = { ...oct, desde: '2026-11-01', hasta: '2026-11-30' }
const dic: Filters = { ...oct, desde: '2026-12-01', hasta: '2026-12-31' }

const GENERAL = fu('general', 3500, { orden: 1 })
const SODEXO = fu('sodexo', 280, { orden: 2, medioPago: 'Sodexo' })
const EXTRA1 = fu('extra1', 1000, { orden: 3, recurrencia: 'unica', mes: '2026-10' })
const ctx = (fuentes: Fuente[], over: Partial<Ctx> = {}): Ctx => ({
  base: 'PEN', rates: { USD: 3.8 }, today: '2026-10-10', cajas: [caja('general-caja', 9999), caja('auto', 250, 'Categoría', 'Auto', 2), caja('bebe', 700, 'Categoría', 'Bebé', 3)],
  presupuestos: [], fuentes, fuentesMeses: [], ...over,
})

describe('fuentes de dinero: presupuesto consolidado', () => {
  it('General 3500 + Sodexo 280 = 3780; con Extra 1 (1000) = 4780; sin fuentes sigue la caja general', () => {
    expect(aggregate([], oct, ctx([GENERAL, SODEXO])).cajas.presupuesto).toBe(378000)
    const c = aggregate([], oct, ctx([GENERAL, SODEXO, EXTRA1])).cajas
    expect(c.presupuesto).toBe(478000)
    expect(c.origen).toBe('fuentes')
    expect(c.fuentes.lista.map(x => x.aporta)).toEqual([350000, 28000, 100000])
    const sin = aggregate([], oct, ctx([])).cajas
    expect(sin.origen).toBe('caja-general')
    expect(sin.presupuesto).toBe(999900)
  })

  it('desactivar Extra 1 → 3780 (queda guardada, muestra lo que aportaría); reactivar → 4780', () => {
    const off = aggregate([], oct, ctx([GENERAL, SODEXO, { ...EXTRA1, activo: false }])).cajas
    expect(off.presupuesto).toBe(378000)
    expect(off.fuentes.lista).toHaveLength(3)
    expect(off.fuentes.lista[2]).toMatchObject({ asignado: 100000, aporta: 0 })
    expect(off.fuentes.activas).toBe(2)
    expect(aggregate([], oct, ctx([GENERAL, SODEXO, EXTRA1])).cajas.presupuesto).toBe(478000)
  })

  it('todas las fuentes inactivas → presupuesto 0 (no vuelve en silencio a la caja general)', () => {
    const c = aggregate([g({ monto: 50 })], oct, ctx([{ ...GENERAL, activo: false }])).cajas
    expect(c.presupuesto).toBe(0)
    expect(c.origen).toBe('fuentes')
    expect(c.disponible).toBe(-5000)
    expect(c.fuentes.gastadoSinFuente).toBe(5000)
  })

  it('gasto de 500 → disponible 4280; reservas Auto 250 + Bebé 700 = 950 no cambian los 4780', () => {
    const gastos = [g({ monto: 300, categoria: 'Auto' }), g({ monto: 200 })]
    const c = aggregate(gastos, oct, ctx([GENERAL, SODEXO, EXTRA1])).cajas
    expect(c.presupuesto).toBe(478000)
    expect(c.gastadoSubcajas + c.gastadoLibre).toBe(50000)
    expect(c.disponible).toBe(428000)
    expect(c.reservado).toBe(95000)
    expect(c.libreInicial).toBe(478000 - 95000)
    // Auto se excede en 50: sale del saldo libre
    expect(c.excesoSubcajas).toBe(5000)
    expect(c.saldoLibre).toBe(478000 - 95000 - 20000 - 5000)
  })

  it('por mes: Extra 1 solo en octubre; nov 0; dic 500 con importe propio; no se arrastra ni pisa otros meses', () => {
    const meses: FuenteMes[] = [{ fuenteId: 'extra1', mes: '2026-12', monto: 500, modo: 'solo' }]
    const all = [GENERAL, SODEXO, EXTRA1]
    expect(aggregate([], oct, ctx(all, { fuentesMeses: meses })).cajas.presupuesto).toBe(478000)
    expect(aggregate([], nov, ctx(all, { fuentesMeses: meses })).cajas.presupuesto).toBe(378000)
    expect(aggregate([], dic, ctx(all, { fuentesMeses: meses })).cajas.presupuesto).toBe(428000)
    // rango de 3 meses = suma de cada mes, sin doble conteo
    expect(aggregate([], { ...oct, hasta: '2026-12-31' }, ctx(all, { fuentesMeses: meses })).cajas.presupuesto).toBe(478000 + 378000 + 428000)
  })

  it('importe "desde un mes": cambia ese mes y los siguientes, no los anteriores; "solo" manda sobre "desde"', () => {
    const meses: FuenteMes[] = [{ fuenteId: 'general', mes: '2026-11', monto: 3800, modo: 'desde' }, { fuenteId: 'general', mes: '2027-01', monto: 3000, modo: 'solo' }]
    const m = (mes: string) => fuenteMontoMes(GENERAL, mes, meses).monto
    expect([m('2026-10'), m('2026-11'), m('2026-12'), m('2027-01'), m('2027-02')]).toEqual([3500, 3800, 3800, 3000, 3800])
    // fuente mensual con mes de aplicación: no aporta antes
    const desdeNov = fu('bono', 200, { mes: '2026-11' })
    expect([fuenteMontoMes(desdeNov, '2026-10', []).monto, fuenteMontoMes(desdeNov, '2027-05', []).monto]).toEqual([0, 200])
    // una fuente única ignora "desde": un ingreso extraordinario nunca se vuelve recurrente
    expect(fuenteMontoMes(EXTRA1, '2026-11', [{ fuenteId: 'extra1', mes: '2026-10', monto: 9, modo: 'desde' }]).monto).toBe(0)
  })

  it('cada gasto se atribuye a UNA fuente: Sodexo por medio de pago, el resto a la principal; total sin duplicar', () => {
    const gastos = [g({ monto: 100, medioPago: 'Sodexo' }), g({ monto: 40, medioPago: 'sodexo ' }), g({ monto: 60, medioPago: 'Yape' }), g({ monto: 30, medioPago: 'Plin' })]
    const c = aggregate(gastos, oct, ctx([GENERAL, SODEXO, EXTRA1])).cajas
    const por = Object.fromEntries(c.fuentes.lista.map(x => [x.fuente.id, x.gastado]))
    expect(por).toEqual({ general: 9000, sodexo: 14000, extra1: 0 })
    expect(c.fuentes.lista.reduce((s, x) => s + x.gastado, 0)).toBe(23000)
    expect(c.gastadoSubcajas + c.gastadoLibre).toBe(23000)
    expect(c.fuentes.lista.find(x => x.principal)!.fuente.id).toBe('general')
  })

  it('Sodexo inactiva con gastos: no aporta, sus gastos siguen descontando y se informan aparte (no pasan a General)', () => {
    const gastos = [g({ monto: 100, medioPago: 'Sodexo' }), g({ monto: 60 })]
    const c = aggregate(gastos, oct, ctx([GENERAL, { ...SODEXO, activo: false }])).cajas
    expect(c.presupuesto).toBe(350000)
    expect(c.disponible).toBe(350000 - 16000)
    expect(c.fuentes.gastadoInactivas).toBe(10000)
    expect(c.fuentes.countInactivas).toBe(1)
    expect(c.fuentes.lista.find(x => x.fuente.id === 'general')!.gastado).toBe(6000)
  })

  it('fuente en USD se convierte; sin tipo de cambio no aporta y se marca', () => {
    const usd = fu('usd', 100, { moneda: 'USD', orden: 4 })
    expect(aggregate([], oct, ctx([GENERAL, usd])).cajas.presupuesto).toBe(350000 + 38000)
    const sin = aggregate([], oct, ctx([GENERAL, usd], { rates: {} })).cajas
    expect(sin.presupuesto).toBe(350000)
    expect(sin.fuentes.lista[1].sinTipoCambio).toBe(true)
  })

  it('20 fuentes: el total es la suma exacta de las activas', () => {
    const muchas = Array.from({ length: 20 }, (_, i) => fu(`f${i}`, 10 * (i + 1), { orden: i, activo: i % 5 !== 0 }))
    const esperado = muchas.filter(x => x.activo).reduce((s, x) => s + x.monto * 100, 0)
    expect(aggregate([], oct, ctx(muchas)).cajas.presupuesto).toBe(esperado)
  })

  it('Salud financiera usa el mismo resultado: presupuesto 4780, gastado 500, disponible 4280', () => {
    const gastos = [g({ monto: 500 })]
    const a = aggregate(gastos, oct, ctx([GENERAL, SODEXO, EXTRA1]))
    const comp = calcularCompromisos({ gastos, plantillas: [], vinculos: new Map(), desde: oct.desde, hasta: oct.hasta, base: 'PEN', rates: {} })
    const p = calcularPresupuesto(a, comp)
    expect([p.presupuesto, p.gastado, p.disponible]).toEqual([478000, 50000, 428000])
    expect(a.cajas.disponible).toBe(p.disponible)
  })
})

describe('invariantes del presupuesto consolidado (mismas cifras en todas las pestañas)', () => {
  const inv = (c: ReturnType<typeof aggregate>['cajas']) => {
    expect(c.disponible).toBe(c.presupuesto - c.gastadoPeriodo)
    expect(c.libreInicial).toBe(c.presupuesto - c.reservado)
    expect(c.gastadoPeriodo).toBe(c.gastadoSubcajas + c.gastadoLibre)
    expect(c.saldoLibre).toBe(c.libreInicial - c.gastadoLibre - c.excesoSubcajas)
    // conciliación: lo disponible es lo libre más lo reservado que aún no se usó
    expect(c.disponible).toBe(c.saldoLibre + c.reservasSinUsar)
    expect(c.reservado).toBe(c.subcajas.reduce((s, x) => s + x.asignado, 0))
    for (const x of c.subcajas) expect(x.disponible).toBe(x.asignado - x.gastado)
  }

  it('escenario de regresión: 3,392.65 − 2,808.57 = 584.08; reservado 950; saldo libre 453.85', () => {
    const fs = [fu('general', 3110, { orden: 1 }), fu('sodexo', 282.65, { orden: 2, medioPago: 'Sodexo' })]
    const cajas = [caja('g', 0), caja('auto', 500, 'Categoría', 'Auto', 2), caja('bebe', 450, 'Categoría', 'Bebé', 3)]
    const gastos = [g({ monto: 400, categoria: 'Auto' }), g({ monto: 419.77, categoria: 'Bebé' }), g({ monto: 1988.80, medioPago: 'Plin' })]
    const c = aggregate(gastos, oct, ctx(fs, { cajas })).cajas
    expect([c.presupuesto, c.gastadoPeriodo, c.disponible, c.reservado, c.saldoLibre]).toEqual([339265, 280857, 58408, 95000, 45385])
    inv(c)
  })

  it('aleatorio: 200 escenarios con reservas excedidas, solapes, USD, anulados y fuentes apagadas cumplen las identidades', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const cats = ['Auto', 'Bebé', 'Alimentación', 'Salud', 'Plan Nube']
    for (let k = 0; k < 200; k++) {
      const fs = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, i) => fu(`f${i}`, Math.round(rnd() * 400000) / 100, { orden: i, activo: rnd() > 0.2, moneda: rnd() > 0.85 ? 'USD' : 'PEN' }))
      const cajas = [caja('g', 0), ...cats.slice(0, 1 + Math.floor(rnd() * 4)).map((c, i) => caja(`c${i}`, Math.round(rnd() * 80000) / 100, i % 3 === 2 ? 'Ámbito' : 'Categoría', i % 3 === 2 ? 'Familia' : c, i + 2))]
      const gastos = Array.from({ length: Math.floor(rnd() * 40) }, () => g({
        monto: Math.round(rnd() * 50000) / 100, categoria: cats[Math.floor(rnd() * cats.length)], ambito: rnd() > 0.5 ? 'Familia' : 'Personal',
        medioPago: rnd() > 0.7 ? 'Sodexo' : 'Yape', moneda: rnd() > 0.9 ? 'USD' : 'PEN', estado: rnd() > 0.9 ? 'Anulado' : 'Activo',
      }))
      inv(aggregate(gastos, oct, ctx(fs, { cajas })).cajas)
    }
  })
})

describe('ranking Top 5', () => {
  it('subcategorías por ámbito › categoría › subcategoría: homónimos no se mezclan; respeta filtros; empates estables; sin datos = vacío', () => {
    const gastos = [
      g({ monto: 50, ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Otros' }),
      g({ monto: 30, ambito: 'Familia', categoria: 'Alimentación', subcategoria: 'Otros' }),
      g({ monto: 30, ambito: 'Personal', categoria: 'Auto', subcategoria: 'Otros' }),
      g({ monto: 20, ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Otros' }),
      g({ monto: 999, ambito: 'Personal', categoria: 'Auto', subcategoria: 'Gas', estado: 'Anulado' }),
    ]
    const a = aggregate(gastos, oct, ctx([]))
    expect(a.rankingSubcategorias.map(x => [x.name, x.cents, x.count])).toEqual([
      ['Personal › Alimentación › Otros', 7000, 2], ['Familia › Alimentación › Otros', 3000, 1], ['Personal › Auto › Otros', 3000, 1]])
    const soloFamilia = aggregate(gastos, { ...oct, ambitos: ['Familia'] }, ctx([]))
    expect(soloFamilia.rankingSubcategorias.map(x => x.name)).toEqual(['Familia › Alimentación › Otros'])
    expect(aggregate([], oct, ctx([])).rankingSubcategorias).toEqual([])
    expect(aggregate(gastos, oct, ctx([])).porCategoria.slice(0, 5).map(x => x.name)).toEqual(['Alimentación', 'Auto'])
  })
})

describe('rendimiento del motor', () => {
  it('20,000 movimientos con 20 fuentes y 13 cajas: una pasada en < 400 ms', () => {
    const cats = ['Auto', 'Bebé', 'Alimentación', 'Salud', 'Plan Nube', 'Servicios']
    const gastos = Array.from({ length: 20000 }, (_, i) => g({ id: String(i), fecha: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, monto: (i % 97) + 0.5, categoria: cats[i % 6], subcategoria: `S${i % 13}`, medioPago: i % 5 ? 'Yape' : 'Sodexo' }))
    const fs = Array.from({ length: 20 }, (_, i) => fu(`f${i}`, 100 + i, { orden: i, medioPago: i === 1 ? 'Sodexo' : '' }))
    const cajas = [caja('g', 0), ...Array.from({ length: 13 }, (_, i) => caja(`c${i}`, 100, i % 2 ? 'Categoría' : 'Subcategoría', i % 2 ? cats[i % 6] : `${cats[i % 6]} › S${i}`, i + 2))]
    const t0 = performance.now()
    const a = aggregate(gastos, oct, ctx(fs, { cajas }))
    const ms = performance.now() - t0
    expect(a.count).toBe(20000)
    expect(a.cajas.disponible).toBe(a.cajas.saldoLibre + a.cajas.reservasSinUsar)
    expect(ms).toBeLessThan(400)
  })
})
