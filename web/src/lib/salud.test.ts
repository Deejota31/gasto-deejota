// Salud de datos y salud financiera: cálculos puros sobre los datos en memoria.
import { describe, expect, it } from 'vitest'
import { marcarIds } from './api'
import { aggregate } from './engine'
import {
  calcularCompromisos, calcularPresupuesto, clasificar, compararPeriodos, esDiscrecional, evaluarCalidad, gruposSimilares, indexarCatalogo,
  nivelPresupuesto, oportunidadesAhorro, periodosEquivalentes, periodosMeses,
} from './salud'
import type { Caja, CatalogoItem, Filters, Gasto, Medio, Plantilla, Revision } from './types'

let seq = 0
const hex = () => `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, '0')}`
const g = (p: Partial<Gasto> = {}): Gasto => ({
  id: hex(), fecha: '2026-10-05', monto: 10, moneda: 'PEN', ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Almuerzo',
  descripcion: 'Menú', medioPago: 'Yape', tipoGasto: 'Variable', esRecurrente: false, estado: 'Activo', origen: 'web', comprobanteUrl: '',
  creadoEn: 't', actualizadoEn: 't', ...p,
})
const f = (p: Partial<Filters> = {}): Filters => ({ preset: 'mes', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [], ...p })
const cat = (a: string, c = '', s = '', activo = true): CatalogoItem => ({ ambito: a, categoria: c, subcategoria: s, activo })
const CATALOGO: CatalogoItem[] = [
  cat('Personal'), cat('Familia'),
  cat('Personal', 'Alimentación', 'Almuerzo'), cat('Personal', 'Alimentación', 'Delivery'), cat('Personal', 'Alimentación', 'Snack / Antojos'),
  cat('Personal', 'Alimentación', 'Antojos', false), cat('Personal', 'Suscripciones', 'ChatGPT'), cat('Personal', 'Transporte', 'Moto Taxi'),
  cat('Familia', 'Servicios', 'Internet'), cat('Familia', 'Servicios', 'Luz'), cat('Familia', 'Bebé', 'Cuidado Infantil'), cat('Familia', 'Bebé', 'Leche'),
  cat('Familia', 'Apoyo Familiar', 'Madre'), cat('Personal', 'Servicios', 'Línea Celular'),
]
const MEDIOS: Medio[] = ['Yape', 'Plin', 'Efectivo', 'Transferencia'].map(nombre => ({ nombre, activo: true }))
const base = { catalogo: CATALOGO, medios: MEDIOS, monedas: ['PEN', 'USD'], revisiones: [] as Revision[] }
const rates = { USD: 3.75 }
const caja = (id: string, presupuesto: number, filtroCampo: Caja['filtroCampo'] = 'Todos', filtroValor = '', orden = 1): Caja =>
  ({ id, nombre: id, presupuesto, filtroCampo, filtroValor, color: '#000', orden })
const pl = (p: Partial<Plantilla> = {}): Plantilla => ({
  id: `pl-${hex()}`, ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Luz', descripcion: 'Luz', creadoEn: '', actualizadoEn: '',
  monto: 120, moneda: 'PEN', medioPago: 'Yape', orden: 1, esCompromiso: true, ...p,
})

describe('salud de datos', () => {
  it('caso Propina Madre: tres movimientos idénticos y legítimos se conservan, suman S/ 300 y no bajan la calidad', () => {
    const propinas = [0, 1, 2].map(() => g({ fecha: '2026-10-06', monto: 100, descripcion: 'Propina Madre', ambito: 'Familia', categoria: 'Apoyo Familiar', subcategoria: 'Madre', medioPago: 'Yape' }))
    const gastos = [...propinas, g()]
    const c0 = evaluarCalidad({ gastos, f: f(), ...base })
    expect(c0.similares).toHaveLength(1)
    expect(c0.similares[0].gastos).toHaveLength(3)
    expect(c0.similares[0].estado).toBe('sin-revisar')                    // aparece como posible coincidencia…
    expect(c0.duplicados).toBe(100)                                        // …pero no penaliza
    expect(c0.indice).toBe(100)
    expect(c0.pendientes).toBe(1)
    expect(aggregate(gastos, f({ categorias: ['Apoyo Familiar'] }), { base: 'PEN', rates, today: '2026-10-09', cajas: [], presupuestos: [] }).total).toBe(30000)
    // marcar como legítima: deja de estar pendiente y sigue sin penalizar; los tres registros siguen ahí
    const legit: Revision = { id: 'rev-1', tipo: 'duplicado', ids: c0.similares[0].ids, estado: 'legitimo', firma: c0.similares[0].clave, creadoEn: '', actualizadoEn: '' }
    const c1 = evaluarCalidad({ gastos, f: f(), ...base, revisiones: [legit] })
    expect(c1.similares[0].estado).toBe('legitimo')
    expect(c1.pendientes).toBe(0)
    expect(c1.indice).toBe(100)
    expect(gastos).toHaveLength(4)
    // confirmar como duplicado sí penaliza (2 de 4 sobran) pero no elimina nada
    const c2 = evaluarCalidad({ gastos, f: f(), ...base, revisiones: [{ ...legit, estado: 'duplicado' }] })
    expect(c2.duplicados).toBe(50)
    expect(c2.indice).toBe(90)
    expect(gastos).toHaveLength(4)
  })

  it('si un movimiento revisado cambia, solo esa alerta se reevalúa', () => {
    const a = [0, 1, 2].map(() => g({ descripcion: 'Propina', monto: 100 }))
    const otra = [0, 1].map(() => g({ descripcion: 'Taxi', subcategoria: 'Moto Taxi', categoria: 'Transporte', monto: 5 }))
    const grupos = gruposSimilares([...a, ...otra], [])
    const revs: Revision[] = grupos.map((x, i) => ({ id: `r${i}`, tipo: 'duplicado', ids: x.ids, estado: 'legitimo', firma: x.clave, creadoEn: '', actualizadoEn: '' }))
    // se edita el monto de una propina: su grupo cambia (quedan 2), el de Taxi sigue revisado
    const editado = [{ ...a[0], monto: 120 }, a[1], a[2], ...otra]
    const r = gruposSimilares(editado, revs)
    expect(r.find(x => x.gastos[0].descripcion === 'Propina')!.estado).toBe('sin-revisar')
    expect(r.find(x => x.gastos[0].descripcion === 'Taxi')!.estado).toBe('legitimo')
    // la misma composición con otra firma (p. ej. cambió la fecha de todos) también vuelve a revisión
    const movidos = otra.map(x => ({ ...x, fecha: '2026-10-07' }))
    expect(gruposSimilares(movidos, revs)[0].estado).toBe('sin-revisar')
  })

  it('integridad: IDs repetidos, monto, moneda, medio, estado y fecha inválida (aunque esté fuera del período)', () => {
    const dupId = hex()
    const gastos = marcarIds([
      g({ id: dupId }), g({ id: dupId, descripcion: 'otro' }), g({ monto: 0 }), g({ moneda: 'EUR' }), g({ medioPago: 'Bitcoin' }),
      g({ estadoHoja: 'Pendiente' }), g({ fecha: '2026-02-30' }), g({ id: 'abc' }), g(), g({ descripcion: '' }),
    ])
    const c = evaluarCalidad({ gastos, f: f(), ...base })
    const por = (code: string) => c.conProblemas.filter(x => x.problemas.includes(code as never)).length
    expect(c.evaluados).toBe(10)
    expect(por('id-repetido')).toBe(2)
    expect(por('monto')).toBe(1)
    expect(por('moneda')).toBe(1)
    expect(por('medio')).toBe(1)
    expect(por('estado')).toBe(1)
    expect(por('fecha')).toBe(1)
    expect(por('id')).toBe(1)
    expect(c.conProblemas).toHaveLength(8)       // descripción vacía no es error
    const sub = evaluarCalidad({ gastos: [g({ subcategoria: 'Inventada' })], f: f(), ...base })
    expect(sub.pendientes).toBe(1)                // integridad + clasificación del mismo gasto = 1 alerta
    expect(c.integridad).toBe(20)
  })

  it('clasificación: válida, histórica (catálogo inactivo o equivalencia) e inválida con sugerencia; nunca por la descripción', () => {
    const ix = indexarCatalogo(CATALOGO)
    expect(clasificar({ ambito: 'Personal', categoria: 'Transporte', subcategoria: 'Moto Taxi' }, ix).estado).toBe('valida')
    expect(clasificar({ ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Antojos' }, ix).estado).toBe('historica')
    const darielita = clasificar({ ambito: 'Familia', categoria: 'Bebé', subcategoria: 'Cuidado Darielita' }, ix)
    expect(darielita).toMatchObject({ estado: 'historica', sugerencia: { subcategoria: 'Cuidado Infantil' } })
    const mal = clasificar({ ambito: 'Personal', categoria: 'Servicios', subcategoria: 'Internet' }, ix)
    expect(mal).toMatchObject({ estado: 'invalida', sugerencia: { ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Internet' } })
    // una descripción de comida en otra categoría válida no es un error
    const c = evaluarCalidad({ gastos: [g({ descripcion: 'Pollo a la brasa', ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Luz' })], f: f(), ...base })
    expect(c.invalidas).toHaveLength(0)
    expect(c.clasificacion).toBe(100)
  })

  it('consistencia del catálogo: filas repetidas y medios repetidos; respeta filtros de período y dimensión', () => {
    const c = evaluarCalidad({ gastos: [g(), g({ fecha: '2026-09-01' }), g({ ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Luz' })], f: f({ ambitos: ['Personal'] }),
      ...base, catalogo: [...CATALOGO, cat('Personal', 'Alimentación', ' almuerzo ')], medios: [...MEDIOS, { nombre: 'yape', activo: true }] })
    expect(c.catalogo.map(x => x.tipo).sort()).toEqual(['medio-repetido', 'repetida'])
    expect(c.evaluados).toBe(1)
    expect(c.consistencia).toBeLessThan(100)
  })

  it('sin movimientos no hay índice (no divide entre cero)', () => {
    expect(evaluarCalidad({ gastos: [], f: f(), ...base }).indice).toBeNull()
  })
})

describe('compromisos y presupuesto', () => {
  const ctx = (cajas: Caja[]) => ({ base: 'PEN', rates, today: '2026-10-09', cajas, presupuestos: [] })

  it('pagos parciales se suman; anular deja de cubrir y restaurar vuelve a cubrir; un pago de más no cubre otro mes', () => {
    const apoyo = pl({ categoria: 'Apoyo Familiar', subcategoria: 'Madre', descripcion: 'Apoyo Madre', monto: 300 })
    const pagos = [0, 1, 2].map(() => g({ monto: 100, ambito: 'Familia', categoria: 'Apoyo Familiar', subcategoria: 'Madre' }))
    const vinc = new Map(pagos.map(x => [x.id.toLowerCase(), apoyo.id]))
    const run = (gs: Gasto[], desde = '2026-10-01', hasta = '2026-10-31') =>
      calcularCompromisos({ gastos: gs, plantillas: [apoyo], vinculos: vinc, desde, hasta, base: 'PEN', rates })
    expect(run(pagos.slice(0, 1))).toMatchObject({ previsto: 30000, cubierto: 10000, pendiente: 20000, nPendientes: 1 })
    expect(run(pagos)).toMatchObject({ previsto: 30000, cubierto: 30000, pendiente: 0, nCubiertos: 1, nPendientes: 0 })
    const anulado = [{ ...pagos[0], estado: 'Anulado' as const }, pagos[1], pagos[2]]
    expect(run(anulado).pendiente).toBe(10000)
    expect(run(pagos).pendiente).toBe(0)        // restaurado
    // dos meses: el pago de octubre no cubre septiembre
    const dosMeses = run(pagos, '2026-09-01', '2026-10-31')
    expect(dosMeses).toMatchObject({ previsto: 60000, cubierto: 30000, pendiente: 30000 })
    // un pago extra (S/ 400 en el mes) no cuenta más de lo previsto
    expect(run([...pagos, { ...pagos[0], id: hex() }].map(x => (vinc.set(x.id.toLowerCase(), apoyo.id), x)))).toMatchObject({ cubierto: 30000, pendiente: 0 })
  })

  it('solo cuentan plantillas marcadas como compromiso y vínculos reales (no descripciones parecidas); USD convertido; sin monto aparte', () => {
    const luz = pl(), netflix = pl({ subcategoria: 'Netflix', descripcion: 'Netflix', esCompromiso: false }), claude = pl({ monto: 20, moneda: 'USD', descripcion: 'Claude' })
    const sinMonto = pl({ monto: null, descripcion: 'Agua' })
    const pagoLuz = g({ monto: 120, descripcion: 'Luz' }), parecido = g({ monto: 120, descripcion: 'Luz' })
    const c = calcularCompromisos({ gastos: [pagoLuz, parecido], plantillas: [luz, netflix, claude, sinMonto], vinculos: new Map([[pagoLuz.id.toLowerCase(), luz.id]]),
      desde: '2026-10-01', hasta: '2026-10-31', base: 'PEN', rates })
    expect(c.n).toBe(3)
    expect(c.sinMonto).toBe(1)
    expect(c.previsto).toBe(12000 + 7500)
    expect(c.cubierto).toBe(12000)           // el gasto "parecido" sin vínculo no cubre nada
    expect(c.pendiente).toBe(7500)
  })

  it('no hay doble conteo: pagar S/ 100 de un compromiso sube lo gastado y baja lo pendiente; el disponible tras compromisos no cambia', () => {
    const cajas = [caja('general', 3000)]
    const compromiso = pl({ monto: 400, categoria: 'Apoyo Familiar', subcategoria: 'Madre' })
    const gastado = g({ monto: 2000 })
    const antes = calcularPresupuesto(aggregate([gastado], f(), ctx(cajas)),
      calcularCompromisos({ gastos: [gastado], plantillas: [compromiso], vinculos: new Map(), desde: '2026-10-01', hasta: '2026-10-31', base: 'PEN', rates }))
    expect(antes).toMatchObject({ presupuesto: 300000, gastado: 200000, pendiente: 40000, disponible: 100000, disponibleTrasCompromisos: 60000, pctUsado: 66.7 })
    const pago = g({ monto: 100, ambito: 'Familia', categoria: 'Apoyo Familiar', subcategoria: 'Madre' })
    const vinc = new Map([[pago.id.toLowerCase(), compromiso.id]])
    const gs = [gastado, pago]
    const despues = calcularPresupuesto(aggregate(gs, f(), ctx(cajas)),
      calcularCompromisos({ gastos: gs, plantillas: [compromiso], vinculos: vinc, desde: '2026-10-01', hasta: '2026-10-31', base: 'PEN', rates }))
    expect(despues).toMatchObject({ gastado: 210000, pendiente: 30000, disponibleTrasCompromisos: 60000 })
    // editar el monto del pago (100 → 150): sigue sin doble conteo
    const editado = [gastado, { ...pago, monto: 150 }]
    const e = calcularPresupuesto(aggregate(editado, f(), ctx(cajas)),
      calcularCompromisos({ gastos: editado, plantillas: [compromiso], vinculos: vinc, desde: '2026-10-01', hasta: '2026-10-31', base: 'PEN', rates }))
    expect(e).toMatchObject({ gastado: 215000, pendiente: 25000, disponibleTrasCompromisos: 60000 })
    // clonar el pago (ID nuevo, sin vínculo): es un gasto más, no crea ni cubre compromisos
    const clon = [gastado, pago, { ...pago, id: hex() }]
    const cl = calcularPresupuesto(aggregate(clon, f(), ctx(cajas)),
      calcularCompromisos({ gastos: clon, plantillas: [compromiso], vinculos: vinc, desde: '2026-10-01', hasta: '2026-10-31', base: 'PEN', rates }))
    expect(cl).toMatchObject({ gastado: 220000, pendiente: 30000, disponibleTrasCompromisos: 50000 })
  })

  it('subcajas: no se suman al general, muestran su pendiente y respetan ajustes mensuales; presupuesto sin gastos y excedido', () => {
    const cajas = [caja('general', 3000), caja('bebe', 700, 'Categoría', 'Bebé', 2)]
    const leche = pl({ categoria: 'Bebé', subcategoria: 'Leche', descripcion: 'Leche', monto: 200 })
    const c0 = calcularCompromisos({ gastos: [], plantillas: [leche], vinculos: new Map(), desde: '2026-10-01', hasta: '2026-10-31', base: 'PEN', rates })
    const vacio = calcularPresupuesto(aggregate([], f(), { ...ctx(cajas), presupuestos: [{ periodo: '2026-10', cajaId: 'general', monto: 3500 }] }), c0)
    expect(vacio).toMatchObject({ presupuesto: 350000, gastado: 0, disponible: 350000, disponibleTrasCompromisos: 330000, nivel: 'ok' })
    expect(vacio.cajas[0]).toMatchObject({ asignado: 70000, pendiente: 20000, disponibleTrasCompromisos: 50000 })
    const excedido = calcularPresupuesto(aggregate([g({ monto: 3100 })], f(), ctx(cajas)), c0)
    expect(excedido.nivel).toBe('excedido')
    expect(excedido.disponible).toBe(-10000)
    expect(calcularPresupuesto(aggregate([], f(), ctx([])), c0).nivel).toBe('sin-presupuesto')
  })

  it('un compromiso se imputa a una sola subcaja (la primera que coincide, como el motor)', () => {
    const cajas = [caja('general', 3000), caja('bebe', 700, 'Categoría', 'Bebé', 2), caja('yape', 500, 'Medio de pago', 'Yape', 3)]
    const leche = pl({ categoria: 'Bebé', subcategoria: 'Leche', descripcion: 'Leche', monto: 200, medioPago: 'Yape' })
    const c = calcularCompromisos({ gastos: [], plantillas: [leche], vinculos: new Map(), desde: '2026-10-01', hasta: '2026-10-31', base: 'PEN', rates })
    const p = calcularPresupuesto(aggregate([], f(), ctx(cajas)), c)
    expect(p.cajas.map(x => x.pendiente)).toEqual([20000, 0])
  })

  it('alertas por porcentaje: <70 ok, 70–90 atención, 90–100 cerca, ≥100 excedido', () => {
    expect([0, 69.9, 70, 89.9, 90, 99.9, 100, 140].map(nivelPresupuesto)).toEqual(['ok', 'ok', 'atencion', 'atencion', 'cerca', 'cerca', 'excedido', 'excedido'])
  })
})

describe('evolución y ahorro', () => {
  it('mes en curso contra los mismos días del anterior; fin de mes largo contra uno corto; meses completos', () => {
    expect(periodosEquivalentes('2026-10', '2026-10-09')).toEqual({ actual: { desde: '2026-10-01', hasta: '2026-10-09' }, anterior: { desde: '2026-09-01', hasta: '2026-09-09' }, parcial: true })
    expect(periodosEquivalentes('2027-03', '2027-03-31').anterior.hasta).toBe('2027-02-28')
    expect(periodosEquivalentes('2026-09', '2026-10-09')).toMatchObject({ actual: { hasta: '2026-09-30' }, anterior: { hasta: '2026-08-31' }, parcial: false })
    expect(periodosMeses('2026-09', '2026-07', '2026-10-09')).toEqual({ actual: { desde: '2026-09-01', hasta: '2026-09-30' }, anterior: { desde: '2026-07-01', hasta: '2026-07-31' }, parcial: false })
    expect(periodosMeses('2026-10', '2026-08', '2026-10-09').anterior.hasta).toBe('2026-08-09')
  })

  it('variaciones positivas y negativas, nuevos sin base (sin dividir entre cero), promedios y filtros', () => {
    const gastos = [
      g({ fecha: '2026-10-02', monto: 150, subcategoria: 'Delivery' }), g({ fecha: '2026-09-03', monto: 100, subcategoria: 'Delivery' }),
      g({ fecha: '2026-10-04', monto: 50, subcategoria: 'Almuerzo' }), g({ fecha: '2026-09-05', monto: 80, subcategoria: 'Almuerzo' }), g({ fecha: '2026-09-05', monto: 20, subcategoria: 'Almuerzo' }),
      g({ fecha: '2026-10-06', monto: 30, categoria: 'Suscripciones', subcategoria: 'ChatGPT' }),
      g({ fecha: '2026-09-20', monto: 999 }),                                   // fuera del tramo equivalente
      g({ fecha: '2026-10-07', monto: 500, ambito: 'Familia' }),                // excluido por el filtro de ámbito
    ]
    const { actual, anterior } = periodosEquivalentes('2026-10', '2026-10-09')
    const e = compararPeriodos({ gastos, f: f({ ambitos: ['Personal'] }), actual, anterior, nivel: 'subcategoria', base: 'PEN', rates })
    const fila = (n: string) => e.filas.find(r => r.nombre === n)!
    expect(fila('Delivery')).toMatchObject({ actual: 15000, anterior: 10000, diferencia: 5000, variacion: 50 })
    expect(fila('Almuerzo')).toMatchObject({ actual: 5000, anterior: 10000, variacion: -50, nAnterior: 2, promedioAnterior: 5000 })
    expect(fila('ChatGPT')).toMatchObject({ anterior: 0, variacion: null })
    expect(e.aumentaron.map(r => r.nombre)).toEqual(['Delivery'])
    expect(e.disminuyeron.map(r => r.nombre)).toEqual(['Almuerzo'])
    expect(e.nuevos.map(r => r.nombre)).toEqual(['ChatGPT'])
    expect(e.totalAnterior).toBe(20000)
    expect(e.hayHistorial).toBe(true)
    const solo = compararPeriodos({ gastos: gastos.filter(x => x.fecha >= '2026-10-01'), f: f(), actual, anterior, nivel: 'categoria', base: 'PEN', rates })
    expect(solo.hayHistorial).toBe(false)
    expect(solo.filas.every(r => r.variacion === null)).toBe(true)
  })

  it('ahorro: solo discrecionales y con montos relevantes; simulación del 15 %; nunca leche, pañales, medicamentos ni servicios', () => {
    expect(esDiscrecional({ categoria: 'Alimentación', subcategoria: 'Snack / Antojos' })).toBe(true)
    expect(esDiscrecional({ categoria: 'Suscripciones', subcategoria: 'Netflix' })).toBe(true)
    expect(esDiscrecional({ categoria: 'Compras', subcategoria: 'Perfumes' })).toBe(true)
    for (const [c, s] of [['Bebé', 'Leche'], ['Bebé', 'Pañales'], ['Salud', 'Medicamentos'], ['Salud', 'Consultas Médicas'], ['Servicios', 'Internet'], ['Alimentación', 'Almuerzo']]) {
      expect(esDiscrecional({ categoria: c, subcategoria: s })).toBe(false)
    }
    const o = oportunidadesAhorro({ gastos: [g({ monto: 200, subcategoria: 'Snack / Antojos' }), g({ monto: 10, subcategoria: 'Delivery' }), g({ monto: 300, categoria: 'Bebé', subcategoria: 'Leche' })],
      f: f(), rango: { desde: '2026-10-01', hasta: '2026-10-31' }, base: 'PEN', rates })
    expect(o).toEqual([expect.objectContaining({ nombre: 'Snack / Antojos', cents: 20000, ahorro: 3000 })])
  })
})
