import { describe, expect, it } from 'vitest'
import { aggregate, fondoMontoMes, type Ctx } from './engine'
import { calcularCompromisos, calcularPresupuesto } from './salud'
import type { Filters, Fondo, FondoMes, Gasto } from './types'

// Pruebas matemáticas de fondos del presupuesto (v1.8, adaptadas a v1.28: los fondos son la única estructura; sin cajas).
// Fondos sin reglas guardadas (anteriores a v1.28) usan reglasLegado: «solo» sus medios y cobertura «todos los gastos».
const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const fu = (id: string, monto: number, over: Partial<Fondo> = {}): Fondo => ({
  id, nombre: id, monto, moneda: 'PEN', color: '#000000', icono: '', activo: true, orden: 1, recurrencia: 'mensual', mes: '', medioPago: '', tipo: 'mensual',
  creadoEn: '', actualizadoEn: '', reglas: [], ...over,
})
const oct: Filters = { preset: 'mes', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
const nov: Filters = { ...oct, desde: '2026-11-01', hasta: '2026-11-30' }
const dic: Filters = { ...oct, desde: '2026-12-01', hasta: '2026-12-31' }

const GENERAL = fu('general', 3500, { orden: 1 })
const SODEXO = fu('sodexo', 280, { orden: 2, medioPago: 'Sodexo' })
const EXTRA1 = fu('extra1', 1000, { orden: 3, recurrencia: 'unica', mes: '2026-10' })
const ctx = (fondos: Fondo[], over: Partial<Ctx> = {}): Ctx => ({
  base: 'PEN', rates: { USD: 3.8 }, today: '2026-10-10', fondos, fondosMeses: [], ...over,
})

describe('fondos del presupuesto: presupuesto consolidado', () => {
  const P = (gs: Gasto[], f: Filters, c: Ctx) => aggregate(gs, f, c).presupuesto
  it('General 3500 + Sodexo 280 = 3780; con Extra 1 (1000) = 4780; sin fondos el presupuesto es 0 (ya no hay caja general)', () => {
    expect(P([], oct, ctx([GENERAL, SODEXO])).presupuesto).toBe(378000)
    const c = P([], oct, ctx([GENERAL, SODEXO, EXTRA1]))
    expect(c.presupuesto).toBe(478000)
    expect(c.fondos.map(x => x.aporta)).toEqual([350000, 28000, 100000])
    const sin = P([g({ monto: 20 })], oct, ctx([]))
    expect([sin.presupuesto, sin.disponible, sin.pct]).toEqual([0, -2000, null])
    expect(sin.sinFondo).toEqual({ cents: 2000, count: 1 })
  })

  it('desactivar Extra 1 → 3780 (queda guardado, muestra lo que aportaría); reactivar → 4780', () => {
    const off = P([], oct, ctx([GENERAL, SODEXO, { ...EXTRA1, activo: false }]))
    expect(off.presupuesto).toBe(378000)
    expect(off.fondos).toHaveLength(3)
    expect(off.fondos[2]).toMatchObject({ asignado: 100000, aporta: 0, estado: 'inactivo' })
    expect(off.activos).toBe(2)
    expect(P([], oct, ctx([GENERAL, SODEXO, EXTRA1])).presupuesto).toBe(478000)
  })

  it('todos los fondos inactivos → presupuesto 0; el gasto queda sin fondo asignable y sigue descontando', () => {
    const c = P([g({ monto: 50 })], oct, ctx([{ ...GENERAL, activo: false }]))
    expect(c.presupuesto).toBe(0)
    expect(c.disponible).toBe(-5000)
    expect(c.sinFondo.cents).toBe(5000)
  })

  it('gasto de 500 → disponible 4280; el gasto se imputa una sola vez', () => {
    const gastos = [g({ monto: 300, categoria: 'Auto' }), g({ monto: 200 })]
    const c = P(gastos, oct, ctx([GENERAL, SODEXO, EXTRA1]))
    expect(c.presupuesto).toBe(478000)
    expect(c.disponible).toBe(428000)
    expect(c.fondos.reduce((s, x) => s + x.gastado, 0) + c.sinFondo.cents).toBe(50000)
  })

  it('por mes: Extra 1 solo en octubre; nov 0; dic 500 con importe propio; no se arrastra ni pisa otros meses', () => {
    const meses: FondoMes[] = [{ fondoId: 'extra1', mes: '2026-12', monto: 500, modo: 'solo' }]
    const all = [GENERAL, SODEXO, EXTRA1]
    expect(P([], oct, ctx(all, { fondosMeses: meses })).presupuesto).toBe(478000)
    expect(P([], nov, ctx(all, { fondosMeses: meses })).presupuesto).toBe(378000)
    expect(P([], dic, ctx(all, { fondosMeses: meses })).presupuesto).toBe(428000)
    // rango de 3 meses = suma de cada mes, sin doble conteo
    expect(P([], { ...oct, hasta: '2026-12-31' }, ctx(all, { fondosMeses: meses })).presupuesto).toBe(478000 + 378000 + 428000)
  })

  it('importe "desde un mes": cambia ese mes y los siguientes, no los anteriores; "solo" manda sobre "desde"', () => {
    const meses: FondoMes[] = [{ fondoId: 'general', mes: '2026-11', monto: 3800, modo: 'desde' }, { fondoId: 'general', mes: '2027-01', monto: 3000, modo: 'solo' }]
    const m = (mes: string) => fondoMontoMes(GENERAL, mes, meses).monto
    expect([m('2026-10'), m('2026-11'), m('2026-12'), m('2027-01'), m('2027-02')]).toEqual([3500, 3800, 3800, 3000, 3800])
    const desdeNov = fu('bono', 200, { mes: '2026-11' })
    expect([fondoMontoMes(desdeNov, '2026-10', []).monto, fondoMontoMes(desdeNov, '2027-05', []).monto]).toEqual([0, 200])
    expect(fondoMontoMes(EXTRA1, '2026-11', [{ fondoId: 'extra1', mes: '2026-10', monto: 9, modo: 'desde' }]).monto).toBe(0)
  })

  it('cada gasto va primero al fondo dedicado a su medio (Sodexo) y el resto a los fondos generales en tu orden; total sin duplicar', () => {
    const gastos = [g({ monto: 100, medioPago: 'Sodexo' }), g({ monto: 40, medioPago: 'sodexo ' }), g({ monto: 60, medioPago: 'Yape' }), g({ monto: 30, medioPago: 'Plin' })]
    const c = P(gastos, oct, ctx([GENERAL, SODEXO, EXTRA1]))
    expect(Object.fromEntries(c.fondos.map(x => [x.fondo.id, x.gastado]))).toEqual({ general: 9000, sodexo: 14000, extra1: 0 })
    expect(c.fondos.reduce((s, x) => s + x.gastado, 0)).toBe(23000)
  })

  it('mismo nivel: lo que excede a General pasa al siguiente fondo de igual cobertura (en tu orden), sin excedente', () => {
    const general = fu('general', 3109.75, { orden: 1 })
    const ica = fu('ica', 1000, { orden: 2, recurrencia: 'unica', mes: '2026-10' })
    const gastos = [g({ monto: 3000, fecha: '2026-10-02' }), g({ monto: 100, medioPago: 'Plin', fecha: '2026-10-05' }), g({ monto: 63.87, fecha: '2026-10-14' })]
    const c = P(gastos, oct, ctx([general, ica]))
    const por = Object.fromEntries(c.fondos.map(x => [x.fondo.id, [x.gastado, x.disponible]]))
    expect(por.general).toEqual([310975, 0])
    expect(por.ica).toEqual([5412, 94588])
    expect(c.fondos.reduce((s, x) => s + x.disponible, 0)).toBe(c.disponible)
    expect(c.fondos.reduce((s, x) => s + x.gastado, 0)).toBe(c.gastadoPeriodo)
    expect(c.desbordados).toBe(0)
  })

  it('un gasto que cruza el tope se reparte entre fondos y cuenta una sola vez como movimiento por fondo', () => {
    const a = fu('a', 100, { orden: 1 }), b = fu('b', 100, { orden: 2 })
    const c = P([g({ monto: 80, fecha: '2026-10-01' }), g({ monto: 50, fecha: '2026-10-02' })], oct, ctx([a, b]))
    expect(Object.fromEntries(c.fondos.map(x => [x.fondo.id, [x.gastado, x.count]]))).toEqual({ a: [10000, 2], b: [3000, 1] })
  })

  it('el exceso de Sodexo pasa al fondo que cubre todos los gastos (excedente); si nada alcanza, General queda en negativo', () => {
    const c1 = P([g({ monto: 300, medioPago: 'Sodexo' })], oct, ctx([GENERAL, SODEXO]))
    expect(Object.fromEntries(c1.fondos.map(x => [x.fondo.id, x.disponible]))).toEqual({ general: 350000 - 2000, sodexo: 0 })
    const sod = c1.fondos.find(x => x.fondo.id === 'sodexo')!
    expect([sod.enviado, sod.destinos]).toEqual([2000, ['general']])
    expect(c1.desbordados).toBe(1)
    const c2 = P([g({ monto: 5000 })], oct, ctx([GENERAL, EXTRA1]))
    expect(c2.disponible).toBe(450000 - 500000)
    expect(c2.fondos.map(x => x.disponible)).toEqual([-50000, 0])
    expect(c2.sobregirados).toBe(1)
  })

  it('sin fondo general el sobrante de Sodexo queda en su propio fondo (sobregiro); invariantes con 200 escenarios al azar', () => {
    const c = P([g({ monto: 400, medioPago: 'Sodexo' })], oct, ctx([SODEXO]))
    expect(c.fondos[0].disponible).toBe(28000 - 40000)
    let seed = 11
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let k = 0; k < 200; k++) {
      const fs = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, i) => fu(`f${i}`, Math.round(rnd() * 100000) / 100, { orden: i, medioPago: i > 0 && rnd() > 0.6 ? ['Sodexo', 'Plin'][i % 2] : '', activo: rnd() > 0.15 }))
      const gastos = Array.from({ length: Math.floor(rnd() * 30) }, () => g({ monto: Math.round(rnd() * 30000) / 100, medioPago: ['Yape', 'Sodexo', 'Plin'][Math.floor(rnd() * 3)], fecha: `2026-10-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}` }))
      const r = P(gastos, oct, ctx(fs))
      expect(r.fondos.reduce((s, x) => s + x.gastado, 0) + r.sinFondo.cents).toBe(gastos.reduce((s, x) => s + Math.round(x.monto * 100), 0))
      // un fondo general solo queda en negativo cuando el conjunto de fondos generales ya no alcanza, y entonces es UNO solo (el primero)
      const libres = r.fondos.filter(x => x.fondo.activo && !x.fondo.medioPago)
      const cupo = libres.reduce((s, x) => s + x.aporta, 0), gasto = libres.reduce((s, x) => s + x.gastado, 0)
      if (gasto <= cupo) for (const x of libres) expect(x.disponible).toBeGreaterThanOrEqual(0)
      else expect(libres.filter(x => x.disponible < 0)).toHaveLength(1)
    }
  })

  it('Sodexo inactivo: no aporta y sus gastos los cubre el fondo general (acepta todos los medios); nada queda sin contar', () => {
    const gastos = [g({ monto: 100, medioPago: 'Sodexo' }), g({ monto: 60 })]
    const c = P(gastos, oct, ctx([GENERAL, { ...SODEXO, activo: false }]))
    expect(c.presupuesto).toBe(350000)
    expect(c.disponible).toBe(350000 - 16000)
    expect(c.fondos.find(x => x.fondo.id === 'general')!.gastado).toBe(16000)
    expect(c.sinFondo.cents).toBe(0)
  })

  it('fondo en USD se convierte; sin tipo de cambio no aporta y se marca', () => {
    const usd = fu('usd', 100, { moneda: 'USD', orden: 4 })
    expect(P([], oct, ctx([GENERAL, usd])).presupuesto).toBe(350000 + 38000)
    const sin = P([], oct, ctx([GENERAL, usd], { rates: {} }))
    expect(sin.presupuesto).toBe(350000)
    expect(sin.fondos[1].sinTipoCambio).toBe(true)
  })

  it('20 fondos: el total es la suma exacta de los activos', () => {
    const muchas = Array.from({ length: 20 }, (_, i) => fu(`f${i}`, 10 * (i + 1), { orden: i, activo: i % 5 !== 0 }))
    const esperado = muchas.filter(x => x.activo).reduce((s, x) => s + x.monto * 100, 0)
    expect(P([], oct, ctx(muchas)).presupuesto).toBe(esperado)
  })

  it('Salud financiera usa el mismo resultado: presupuesto 4780, gastado 500, disponible 4280', () => {
    const gastos = [g({ monto: 500 })]
    const a = aggregate(gastos, oct, ctx([GENERAL, SODEXO, EXTRA1]))
    const comp = calcularCompromisos({ gastos, plantillas: [], vinculos: new Map(), desde: oct.desde, hasta: oct.hasta, base: 'PEN', rates: {} })
    const p = calcularPresupuesto(a, comp, '2026-10')
    expect([p.presupuesto, p.gastado, p.disponible]).toEqual([478000, 50000, 428000])
    expect(a.presupuesto.disponible).toBe(p.disponible)
  })
})

describe('invariantes del presupuesto consolidado (mismas cifras en todas las pestañas)', () => {
  const inv = (c: ReturnType<typeof aggregate>['presupuesto']) => {
    expect(c.disponible).toBe(c.presupuesto - c.gastadoPeriodo)
    expect(c.exceso).toBe(Math.max(0, -c.disponible))
    // integridad: todo lo gastado queda imputado a un fondo o sin fondo asignable, una sola vez
    expect(c.fondos.reduce((s, x) => s + x.gastado, 0) + c.sinFondo.cents).toBe(c.gastadoPeriodo)
    expect(c.presupuesto).toBe(c.fondos.reduce((s, x) => s + x.aporta, 0))
    for (const x of c.fondos) if (x.fondo.activo && x.aplicada) expect(x.disponible).toBe(x.aporta - x.gastado)
    // lo enviado por desbordes es exactamente lo recibido
    expect(c.fondos.reduce((s, x) => s + x.enviado, 0)).toBe(c.fondos.reduce((s, x) => s + x.recibido, 0))
  }

  it('escenario de regresión: 3,392.65 − 2,808.57 = 584.08', () => {
    const fs = [fu('general', 3110, { orden: 1 }), fu('sodexo', 282.65, { orden: 2, medioPago: 'Sodexo' })]
    const gastos = [g({ monto: 400, categoria: 'Auto' }), g({ monto: 419.77, categoria: 'Bebé' }), g({ monto: 1988.80, medioPago: 'Plin' })]
    const c = aggregate(gastos, oct, ctx(fs)).presupuesto
    expect([c.presupuesto, c.gastadoPeriodo, c.disponible]).toEqual([339265, 280857, 58408])
    inv(c)
  })

  it('aleatorio: 200 escenarios con desbordes, USD, anulados y fondos apagados cumplen las identidades', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const cats = ['Auto', 'Bebé', 'Alimentación', 'Salud', 'Plan Nube']
    for (let k = 0; k < 200; k++) {
      const fs = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, i) => fu(`f${i}`, Math.round(rnd() * 400000) / 100, {
        orden: i, activo: rnd() > 0.2, moneda: rnd() > 0.85 ? 'USD' : 'PEN',
        reglas: rnd() > 0.5 ? [{ desde: '', medios: 'todos', listaMedios: [], cobertura: 'categoria', rutas: [{ ambito: '', categoria: cats[i % cats.length], subcategoria: '' }], restringeMedio: false }] : [],
      }))
      const gastos = Array.from({ length: Math.floor(rnd() * 40) }, () => g({
        monto: Math.round(rnd() * 50000) / 100, categoria: cats[Math.floor(rnd() * cats.length)], ambito: rnd() > 0.5 ? 'Familia' : 'Personal',
        medioPago: rnd() > 0.7 ? 'Sodexo' : 'Yape', moneda: rnd() > 0.9 ? 'USD' : 'PEN', estado: rnd() > 0.9 ? 'Anulado' : 'Activo',
      }))
      inv(aggregate(gastos, oct, ctx(fs)).presupuesto)
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
  it('20,000 movimientos con 20 fondos de distintas coberturas: una pasada en < 400 ms', () => {
    const cats = ['Auto', 'Bebé', 'Alimentación', 'Salud', 'Plan Nube', 'Servicios']
    const gastos = Array.from({ length: 20000 }, (_, i) => g({ id: String(i), fecha: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, monto: (i % 97) + 0.5, categoria: cats[i % 6], subcategoria: `S${i % 13}`, medioPago: i % 5 ? 'Yape' : 'Sodexo' }))
    const fs = Array.from({ length: 20 }, (_, i) => fu(`f${i}`, 100 + i, { orden: i, medioPago: i === 1 ? 'Sodexo' : '',
      reglas: i > 1 ? [{ desde: '', medios: 'todos', listaMedios: [], cobertura: i % 2 ? 'categoria' : 'subcategoria', rutas: [{ ambito: '', categoria: cats[i % 6], subcategoria: i % 2 ? '' : `S${i % 13}` }], restringeMedio: false }] : [] }))
    const t0 = performance.now()
    const a = aggregate(gastos, oct, ctx(fs))
    const ms = performance.now() - t0
    expect(a.count).toBe(20000)
    expect(a.presupuesto.fondos.reduce((s, x) => s + x.gastado, 0) + a.presupuesto.sinFondo.cents).toBe(a.presupuesto.gastadoPeriodo)
    expect(ms).toBeLessThan(400)
  })
})
