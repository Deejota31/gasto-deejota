import { describe, expect, it } from 'vitest'
import {
  asignarMes, cobertura, conflictosConfig, imputacionesDe, reglaEn, reglasLegado, REGLA_LIBRE, validarAsignacion, validarMedioGasto, validarRegla, versionarReglas,
  type CtxReparto, type Imputacion,
} from './presupuesto'
import { aggregate } from './engine'
import type { Filters, Fondo, Gasto, ReglaFondo } from './types'

/**
 * Motor de Presupuestos (v1.28). Cifras exactas en céntimos (tolerancia cero). Los nombres de fondos, medios y categorías son
 * datos de prueba: el motor no conoce ninguno (ver "sin nombres en el código").
 */
let orden = 0
const R = (r: Partial<ReglaFondo> = {}): ReglaFondo => ({ ...REGLA_LIBRE, ...r })
const fondo = (id: string, monto: number, regla: Partial<ReglaFondo> = {}, over: Partial<Fondo> = {}): Fondo => ({
  id, nombre: id, monto, moneda: 'PEN', color: '', icono: '', activo: true, orden: ++orden, recurrencia: 'mensual', mes: '', tipo: 'mensual',
  medioPago: '', reglas: [R(regla)], creadoEn: '', actualizadoEn: '', ...over,
})
let n = 0
const g = (monto: number, o: Partial<Gasto> = {}): Gasto => ({
  fecha: '2026-10-10', monto, moneda: 'PEN', ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '', medioPago: 'Yape',
  tipoGasto: 'Variable', esRecurrente: false, estado: 'Activo', origen: 'web', comprobanteUrl: '', id: `g-${String(++n).padStart(4, '0')}`, creadoEn: `2026-10-10T00:00:${String(n % 60).padStart(2, '0')}Z`, actualizadoEn: '', ...o,
})
const CTX: CtxReparto = { base: 'PEN', rates: { USD: 3.75 }, fondosMeses: [], aislarDesde: '2099-01' }
const run = (gs: Gasto[], fs: Fondo[], c: Partial<CtxReparto> = {}) => asignarMes('2026-10', gs, fs, { ...CTX, ...c })
const partes = (imp: Imputacion | undefined) => Object.fromEntries((imp?.partes ?? []).map(p => [`${p.fondoId}:${p.tipo}`, p.cents]))
const suma = (imp: Imputacion) => imp.partes.reduce((s, p) => s + p.cents, 0) + imp.sinFondo

const sodexoRegla = { medios: 'solo' as const, listaMedios: ['Sodexo'], cobertura: 'categoria' as const, rutas: [{ ambito: '', categoria: 'Alimentación', subcategoria: '' }], restringeMedio: true }
const generalRegla = { medios: 'excepto' as const, listaMedios: ['Sodexo'] }

describe('cobertura y medios', () => {
  it('1) General cubre cualquier categoría compatible', () => {
    const gen = fondo('general', 3000, generalRegla)
    const r = run([g(10, { categoria: 'Auto', subcategoria: 'Gasolina' }), g(20, { ambito: 'Familia', categoria: 'Bebé', subcategoria: 'Pañales' })], [gen])
    expect(r.porFondo.get('general')!.imputado).toBe(3000)
    expect(r.sinFondo).toEqual({ cents: 0, count: 0 })
  })
  it('2) General excluye el medio configurado: un gasto con ese medio no cae en General', () => {
    const r = run([g(10, { medioPago: 'Sodexo' })], [fondo('general', 3000, generalRegla)])
    expect(r.porFondo.get('general')!.imputado).toBe(0)
    expect(r.sinFondo).toEqual({ cents: 1000, count: 1 })
  })
  it('3-5) por ámbito, por categoría y por subcategoría; gana el más específico', () => {
    const fs = [fondo('gen', 1000), fondo('amb', 1000, { cobertura: 'ambito', rutas: [{ ambito: 'Familia', categoria: '', subcategoria: '' }] }),
      fondo('cat', 1000, { cobertura: 'categoria', rutas: [{ ambito: 'Familia', categoria: 'Servicios', subcategoria: '' }] }),
      fondo('sub', 1000, { cobertura: 'subcategoria', rutas: [{ ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Luz' }] })]
    const luz = g(5, { ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Luz' })
    const agua = g(6, { ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Agua' })
    const pañal = g(7, { ambito: 'Familia', categoria: 'Bebé', subcategoria: 'Pañales' })
    const taxi = g(8, { ambito: 'Personal', categoria: 'Transporte', subcategoria: 'Taxi' })
    const r = run([luz, agua, pañal, taxi], fs)
    expect(partes(r.porGasto.get(luz.id))).toEqual({ 'sub:automatica': 500 })
    expect(partes(r.porGasto.get(agua.id))).toEqual({ 'cat:automatica': 600 })
    expect(partes(r.porGasto.get(pañal.id))).toEqual({ 'amb:automatica': 700 })
    expect(partes(r.porGasto.get(taxi.id))).toEqual({ 'gen:automatica': 800 })
  })
  it('6-7) cobertura personalizada: la unión de varias rutas', () => {
    const f = fondo('serv', 400, { cobertura: 'personalizada', rutas: [{ ambito: 'Hogar', categoria: 'Servicios', subcategoria: 'Luz' }, { ambito: 'Hogar', categoria: 'Servicios', subcategoria: 'Agua' }, { ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Internet' }] })
    const r = R(f.reglas[0])
    expect(cobertura(r, { ambito: 'Hogar', categoria: 'Servicios', subcategoria: 'Agua' })).toBe(3)
    expect(cobertura(r, { ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Internet' })).toBe(3)
    expect(cobertura(r, { ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Luz' })).toBeNull()
  })
  it('8) categorías homónimas entre ámbitos: con ámbito elegido no se mezclan; con "todos los ámbitos" se unen', () => {
    const soloPersonal = R({ cobertura: 'categoria', rutas: [{ ambito: 'Personal', categoria: 'Alimentación', subcategoria: '' }] })
    const todos = R({ cobertura: 'categoria', rutas: [{ ambito: '', categoria: 'Alimentación', subcategoria: '' }] })
    const fam = { ambito: 'Familia', categoria: 'Alimentación', subcategoria: 'Mercado' }
    expect(cobertura(soloPersonal, fam)).toBeNull()
    expect(cobertura(todos, fam)).toBe(2)
  })
})

describe('restricción de medio (configurada, nunca por nombre)', () => {
  const sodexo = fondo('sodexo', 280, sodexoRegla)
  const gen = fondo('general', 3000, generalRegla)
  it('9-10) Sodexo configurado para Alimentación en todos los ámbitos: Alimentación con Sodexo es compatible y va a Sodexo', () => {
    const x = g(25, { medioPago: 'Sodexo', ambito: 'Familia', categoria: 'Alimentación', subcategoria: 'Mercado' })
    expect(validarMedioGasto(x, [sodexo, gen])).toEqual({ ok: true })
    expect(partes(run([x], [gen, sodexo]).porGasto.get(x.id))).toEqual({ 'sodexo:automatica': 2500 })
  })
  it('11-12) Gasolina con Sodexo es incompatible: se bloquea con el mensaje pedido', () => {
    const x = g(50, { medioPago: 'Sodexo', categoria: 'Auto', subcategoria: 'Gasolina' })
    expect(validarMedioGasto(x, [sodexo, gen])).toEqual({ ok: false, medio: 'Sodexo', fondos: ['sodexo'], mensaje: 'El medio Sodexo no está permitido para esta categoría según la configuración de tus presupuestos.' })
  })
  it('13) validar no modifica el gasto (no reclasifica)', () => {
    const x = g(50, { medioPago: 'Sodexo', categoria: 'Auto', subcategoria: 'Gasolina' })
    const copia = structuredClone(x)
    validarMedioGasto(x, [sodexo]); run([x], [sodexo, gen])
    expect(x).toEqual(copia)
  })
  it('14) cambiar la configuración del fondo cambia el resultado: la restricción vive en los datos', () => {
    const x = g(50, { medioPago: 'Sodexo', categoria: 'Auto', subcategoria: 'Gasolina' })
    const sinRestriccion = { ...sodexo, reglas: [R({ ...sodexoRegla, restringeMedio: false })] }
    expect(validarMedioGasto(x, [sinRestriccion]).ok).toBe(true)
    const otroMedio = { ...sodexo, reglas: [R({ ...sodexoRegla, listaMedios: ['Edenred'] })] }
    expect(validarMedioGasto(x, [otroMedio]).ok).toBe(true)
    expect(validarMedioGasto({ ...x, medioPago: 'Edenred' }, [otroMedio]).ok).toBe(false)
  })
  it('restricciones simultáneas: la unión de coberturas; un fondo que solo acepta el medio no la anula; inactivo no restringe', () => {
    const transp = fondo('transp', 100, { medios: 'solo', listaMedios: ['Sodexo'], cobertura: 'categoria', rutas: [{ ambito: '', categoria: 'Transporte', subcategoria: '' }], restringeMedio: true })
    const todoMedio = fondo('libre', 100, { medios: 'solo', listaMedios: ['Sodexo'] })
    const taxi = g(9, { medioPago: 'Sodexo', categoria: 'Transporte', subcategoria: 'Taxi' })
    const nafta = g(9, { medioPago: 'Sodexo', categoria: 'Auto', subcategoria: 'Gasolina' })
    expect(validarMedioGasto(taxi, [sodexo, transp, todoMedio]).ok).toBe(true)
    expect(validarMedioGasto(nafta, [sodexo, transp, todoMedio]).ok).toBe(false)
    expect(validarMedioGasto(nafta, [{ ...sodexo, activo: false }]).ok).toBe(true)
  })
  it('un gasto ya guardado que viola la regla queda sin fondo asignable y marcado como incompatible (no desaparece)', () => {
    const x = g(50, { medioPago: 'Sodexo', categoria: 'Auto', subcategoria: 'Gasolina' })
    const r = run([x], [gen, sodexo])
    expect(r.porGasto.get(x.id)).toMatchObject({ sinFondo: 5000, incompatible: true })
    expect(r.incompatibles).toBe(1)
  })
  it('conflicto de configuración: un fondo que acepta Sodexo para Auto mientras otro lo restringe a Alimentación', () => {
    const auto = fondo('auto', 100, { medios: 'solo', listaMedios: ['Sodexo'], cobertura: 'categoria', rutas: [{ ambito: '', categoria: 'Auto', subcategoria: '' }] })
    expect(conflictosConfig([sodexo, auto], '2026-10')).toEqual([expect.stringContaining('auto acepta Sodexo')])
    expect(conflictosConfig([sodexo, gen], '2026-10')).toEqual([])
  })
})

describe('varios fondos, desbordes y sobregiros', () => {
  const autoR = { cobertura: 'categoria' as const, rutas: [{ ambito: '', categoria: 'Auto', subcategoria: '' }] }
  const base = () => { orden = 0; return [fondo('auto1', 400, autoR), fondo('auto2', 300, autoR), fondo('general', 3000)] }
  const auto = (m: number, d = '2026-10-10') => g(m, { categoria: 'Auto', subcategoria: 'Gasolina', fecha: d })

  it('15, 19-21) Caso A: dos fondos de Auto suman S/ 700 y se consumen en orden manual', () => {
    const a = auto(550)
    const r = run([a], base())
    expect(partes(r.porGasto.get(a.id))).toEqual({ 'auto1:automatica': 40000, 'auto2:automatica': 15000 })
    expect(r.porGasto.get(a.id)!.excedente).toBe(0)
    expect(r.porFondo.get('auto2')!.cupo - r.porFondo.get('auto2')!.imputado).toBe(15000)
  })
  it('22-24) Caso B: Auto agotado → los S/ 100 restantes van a General y queda trazado el desborde', () => {
    const a = auto(550, '2026-10-05'), b = auto(250, '2026-10-12')
    const r = run([b, a], base())
    expect(partes(r.porGasto.get(b.id))).toEqual({ 'auto2:automatica': 15000, 'general:desborde': 10000 })
    expect(r.porGasto.get(b.id)).toMatchObject({ excedente: 10000, origen: ['auto1', 'auto2'], destino: ['general'] })
    expect(r.porFondo.get('auto2')!.enviado).toBe(10000)
    expect(r.porFondo.get('general')!.recibido).toBe(10000)
  })
  it('22) un fondo general primero en la lista no consume antes que el específico', () => {
    orden = 0
    const fs = [fondo('general', 3000), fondo('auto1', 400, autoR)]
    const a = auto(100)
    expect(partes(run([a], fs).porGasto.get(a.id))).toEqual({ 'auto1:automatica': 10000 })
  })
  it('Viajes S/ 200 y gasto de S/ 500: 200 a Viajes y 300 a General, sin bloquear', () => {
    orden = 0
    const fs = [fondo('viajes', 200, { cobertura: 'categoria', rutas: [{ ambito: 'Personal', categoria: 'Viajes', subcategoria: '' }] }, { recurrencia: 'unica', mes: '2026-10', tipo: 'extra' }), fondo('general', 3000)]
    const v = g(500, { categoria: 'Viajes', subcategoria: 'Hotel' })
    expect(partes(run([v], fs).porGasto.get(v.id))).toEqual({ 'viajes:automatica': 20000, 'general:desborde': 30000 })
  })
  it('25-26) General también agotado: el resto va a General y su saldo queda negativo', () => {
    orden = 0
    const fs = [fondo('auto1', 400, autoR), fondo('general', 50)]
    const a = auto(650)
    const r = run([a], fs)
    expect(partes(r.porGasto.get(a.id))).toEqual({ 'auto1:automatica': 40000, 'general:desborde': 5000, 'general:sobregiro': 20000 })
    const c = r.porFondo.get('general')!
    expect(c.cupo - c.imputado).toBe(-20000)
  })
  it('27-28) respaldo incompatible: si General excluye el medio, el exceso queda como sobregiro del fondo exclusivo', () => {
    orden = 0
    const fs = [fondo('general', 3000, generalRegla), fondo('sodexo', 280, sodexoRegla)]
    const x = g(300, { medioPago: 'Sodexo' })
    const r = run([x], fs)
    expect(partes(r.porGasto.get(x.id))).toEqual({ 'sodexo:automatica': 28000, 'sodexo:sobregiro': 2000 })
    expect(r.porFondo.get('general')!.imputado).toBe(0)
  })
  it('29) gasto sin fondo asignable: no se atribuye arbitrariamente a General, sigue contando', () => {
    orden = 0
    const fs = [fondo('auto1', 400, autoR)]
    const x = g(40, { categoria: 'Salud', subcategoria: 'Farmacia' })
    const r = run([x], fs)
    expect(r.porGasto.get(x.id)).toMatchObject({ sinFondo: 4000, partes: [] })
  })
  it('30) un gasto distribuido entre tres fondos sigue siendo un solo movimiento y suma exacto', () => {
    orden = 0
    const fs = [fondo('a1', 100, autoR), fondo('a2', 100, autoR), fondo('general', 100)]
    const x = auto(250.37)
    const imp = run([x], fs).porGasto.get(x.id)!
    expect(imp.partes).toHaveLength(3)
    expect(suma(imp)).toBe(25037)
    expect(imp.total).toBe(25037)
  })
  it('31) gastos duplicados (mismo importe y fecha) se imputan cada uno una vez', () => {
    const fs = base()
    const a = auto(100), b = auto(100)
    const r = run([a, b], fs)
    expect(r.porFondo.get('auto1')!.imputado).toBe(20000)
    expect(r.porFondo.get('auto1')!.count).toBe(2)
  })
  it('59-60) fondo sin disponibilidad y gasto mayor que todos los presupuestos compatibles', () => {
    orden = 0
    const fs = [fondo('a1', 0, autoR), fondo('general', 10)]
    const x = auto(5000)
    const imp = run([x], fs).porGasto.get(x.id)!
    expect(partes(imp)).toEqual({ 'general:desborde': 1000, 'general:sobregiro': 499000 })
    expect(suma(imp)).toBe(500000)
  })
  it('procesamiento determinístico: el orden de entrada no cambia el resultado', () => {
    const gs = [auto(300, '2026-10-02'), auto(300, '2026-10-01'), auto(300, '2026-10-01'), g(80, { fecha: '2026-10-03' })]
    const a = run(gs, base()), b = run([...gs].reverse(), base())
    expect([...a.porGasto.entries()].sort()).toEqual([...b.porGasto.entries()].sort())
    expect([...a.porFondo.entries()]).toEqual([...b.porFondo.entries()])
  })
  it('41-42) anulados no se imputan; restaurar los vuelve a imputar', () => {
    const x = auto(100)
    expect(run([{ ...x, estado: 'Anulado' }], base()).porFondo.get('auto1')!.imputado).toBe(0)
    expect(run([x], base()).porFondo.get('auto1')!.imputado).toBe(10000)
  })
  it('43-44) desactivar un fondo lo saca del reparto; reactivarlo lo devuelve', () => {
    const [a1, a2, gen] = base()
    const x = auto(100)
    expect(partes(run([x], [{ ...a1, activo: false }, a2, gen]).porGasto.get(x.id))).toEqual({ 'auto2:automatica': 10000 })
    expect(partes(run([x], [a1, a2, gen]).porGasto.get(x.id))).toEqual({ 'auto1:automatica': 10000 })
  })
  it('46) cambiar la prioridad (orden manual) cambia qué fondo del mismo nivel consume primero', () => {
    const [a1, a2, gen] = base()
    const x = auto(100)
    expect(partes(run([x], [{ ...a1, orden: 5 }, a2, gen]).porGasto.get(x.id))).toEqual({ 'auto2:automatica': 10000 })
  })
  it('35-40) cambiar monto, clasificación, medio o fecha re-imputa (no hay imputación guardada)', () => {
    const fs = base()
    const x = auto(100)
    expect(partes(run([{ ...x, monto: 900 }], fs).porGasto.get(x.id))).toEqual({ 'auto1:automatica': 40000, 'auto2:automatica': 30000, 'general:desborde': 20000 })
    expect(partes(run([{ ...x, categoria: 'Salud' }], fs).porGasto.get(x.id))).toEqual({ 'general:automatica': 10000 })
    expect(run([{ ...x, fecha: '2026-11-03' }], fs).porGasto.get(x.id)).toBeUndefined()
  })
})

describe('asignación manual', () => {
  orden = 0
  const autoR = { cobertura: 'categoria' as const, rutas: [{ ambito: '', categoria: 'Auto', subcategoria: '' }] }
  const fs = [fondo('a1', 400, autoR), fondo('general', 3000), fondo('salud', 100, { cobertura: 'categoria', rutas: [{ ambito: '', categoria: 'Salud', subcategoria: '' }] })]
  const x = g(200, { categoria: 'Auto', subcategoria: 'Taller', id: 'aaaaaaaa-0000-4000-8000-000000000001' })
  it('32) asignación manual compatible: se aplica tal cual y antes que las automáticas', () => {
    const asignaciones = { [x.id]: [{ fondoId: 'general', monto: 150 }, { fondoId: 'a1', monto: 50 }] }
    const otro = g(400, { categoria: 'Auto', subcategoria: 'Gasolina', fecha: '2026-10-01' })
    const r = run([otro, x], fs, { asignaciones })
    expect(partes(r.porGasto.get(x.id))).toEqual({ 'general:manual': 15000, 'a1:manual': 5000 })
    expect(r.porGasto.get(x.id)!.manual).toBe(true)
    expect(partes(r.porGasto.get(otro.id))).toEqual({ 'a1:automatica': 35000, 'general:desborde': 5000 })
  })
  it('33) asignación manual incompatible (fondo que no cubre la categoría o suma distinta): se rechaza', () => {
    expect(validarAsignacion(x, [{ fondoId: 'salud', monto: 200 }], fs, CTX)).toBe('salud no cubre Auto › Taller.')
    expect(validarAsignacion(x, [{ fondoId: 'a1', monto: 199.99 }], fs, CTX)).toBe('La asignación suma 199.99 y el gasto es de 200.00.')
    expect(validarAsignacion(x, [{ fondoId: 'a1', monto: 100 }, { fondoId: 'a1', monto: 100 }], fs, CTX)).toBe('Un fondo aparece dos veces en la asignación.')
  })
  it('34) restaurar la automática = sin asignación guardada; una manual que dejó de ser válida se marca en conflicto y no se reinterpreta en silencio', () => {
    const r = run([{ ...x, monto: 250 }], fs, { asignaciones: { [x.id]: [{ fondoId: 'a1', monto: 200 }] } })
    expect(r.porGasto.get(x.id)).toMatchObject({ manual: false, conflicto: 'La asignación suma 200.00 y el gasto es de 250.00.' })
    expect(r.conflictos).toBe(1)
    expect(partes(run([x], fs).porGasto.get(x.id))).toEqual({ 'a1:automatica': 20000 })
  })
  it('una manual puede dejar un fondo en negativo (sobregiro permitido, se advierte en la interfaz)', () => {
    const r = run([x], fs, { asignaciones: { [x.id]: [{ fondoId: 'salud', monto: 200 }] } })
    expect(r.porGasto.get(x.id)!.conflicto).toBe('salud no cubre Auto › Taller.')
    const ok = run([g(500, { categoria: 'Salud', id: 'aaaaaaaa-0000-4000-8000-000000000002' })], fs, { asignaciones: { 'aaaaaaaa-0000-4000-8000-000000000002': [{ fondoId: 'salud', monto: 500 }] } })
    expect(ok.porFondo.get('salud')!.cupo - ok.porFondo.get('salud')!.imputado).toBe(-40000)
  })
})

describe('meses, tipos de fondo y monedas', () => {
  orden = 0
  const ctxIso: Partial<CtxReparto> = { aislarDesde: '2026-11' }
  it('47-49) cada mes se reparte por separado: un gasto de noviembre no consume octubre', () => {
    const fs = [fondo('general', 100)]
    const gs = [g(80, { fecha: '2026-10-31' }), g(80, { fecha: '2026-11-01' })]
    const oct = asignarMes('2026-10', gs, fs, { ...CTX }), nov = asignarMes('2026-11', gs, fs, { ...CTX })
    expect(oct.porFondo.get('general')).toMatchObject({ cupo: 10000, imputado: 8000 })
    expect(nov.porFondo.get('general')).toMatchObject({ cupo: 10000, imputado: 8000 })
  })
  it('aislamiento desde noviembre: un fondo mensual sin aplicar no recibe gastos; aplicado sí', () => {
    const fs = [fondo('general', 100)]
    const x = g(10, { fecha: '2026-11-05' })
    expect(asignarMes('2026-11', [x], fs, { ...CTX, ...ctxIso }).porGasto.get(x.id)!.sinFondo).toBe(1000)
    const ap = asignarMes('2026-11', [x], fs, { ...CTX, ...ctxIso, fondosMeses: [{ fondoId: 'general', mes: '2026-11', monto: 50, modo: 'solo' }] })
    expect(ap.porFondo.get('general')).toMatchObject({ cupo: 5000, imputado: 1000 })
  })
  it('50-52) extra solo en su mes; mensual todos los meses; ahorro asignado se comporta como cualquier fondo de su cobertura', () => {
    const fs = [fondo('extra', 100, {}, { recurrencia: 'unica', mes: '2026-10', tipo: 'extra' }), fondo('ahorro', 50, {}, { tipo: 'ahorro_asignado', recurrencia: 'unica', mes: '2026-12' })]
    expect(asignarMes('2026-10', [], fs, CTX).porFondo.get('extra')!.cupo).toBe(10000)
    expect(asignarMes('2026-11', [], fs, CTX).porFondo.get('extra')!.cupo).toBe(0)
    const dic = g(70, { fecha: '2026-12-02' })
    expect(partes(asignarMes('2026-12', [dic], fs, CTX).porGasto.get(dic.id))).toEqual({ 'ahorro:automatica': 5000, 'ahorro:sobregiro': 2000 })
  })
  it('53-57) PEN y USD: el fondo en USD aporta convertido y los céntimos cuadran sin deriva', () => {
    const fs = [fondo('usd', 10, {}, { moneda: 'USD' })]
    const gs = [g(0.1), g(0.1), g(0.1), g(1, { moneda: 'USD' })]
    const r = run(gs, fs)
    expect(r.porFondo.get('usd')!.cupo).toBe(3750)
    expect(r.porFondo.get('usd')!.imputado).toBe(30 + 375)
    for (const imp of r.porGasto.values()) expect(suma(imp)).toBe(imp.total)
  })
  it('58) un gasto sin tipo de cambio no se imputa (el motor de agregados lo informa aparte)', () => {
    const x = g(5, { moneda: 'EUR' })
    expect(run([x], [fondo('gen', 10)]).porGasto.get(x.id)).toBeUndefined()
  })
})

describe('reglas versionadas y compatibilidad', () => {
  it('48) editar las reglas desde noviembre no cambia octubre', () => {
    const v = versionarReglas([R()], { ...R({ cobertura: 'categoria', rutas: [{ ambito: '', categoria: 'Auto', subcategoria: '' }] }) }, '2026-11')
    const f = fondo('f', 100, {}, { reglas: v })
    expect(reglaEn(f, '2026-10').cobertura).toBe('todos')
    expect(reglaEn(f, '2026-12').cobertura).toBe('categoria')
    const x = g(10, { categoria: 'Salud', fecha: '2026-10-05' }), y = g(10, { categoria: 'Salud', fecha: '2026-11-05' })
    expect(asignarMes('2026-10', [x], [f], CTX).porGasto.get(x.id)!.sinFondo).toBe(0)
    expect(asignarMes('2026-11', [y], [f], CTX).porGasto.get(y.id)!.sinFondo).toBe(1000)
  })
  it('versionar en el mismo mes reemplaza esa versión; sin cambios no crea versiones', () => {
    const a = versionarReglas([R()], R({ medios: 'solo', listaMedios: ['Yape'] }), '2026-11')
    const b = versionarReglas(a, R({ medios: 'solo', listaMedios: ['Plin'] }), '2026-11')
    expect(b.map(x => [x.desde, x.listaMedios])).toEqual([['', []], ['2026-11', ['Plin']]])
    expect(versionarReglas(b, R({ medios: 'solo', listaMedios: ['Plin'] }), '2026-12')).toBe(b)
  })
  it('fondos anteriores a v1.28: medio de pago → solo ese medio y cobertura total; sin medio → todos (mismo comportamiento que antes)', () => {
    expect(reglasLegado('Sodexo')).toEqual([R({ medios: 'solo', listaMedios: ['Sodexo'] })])
    expect(reglasLegado('Libre')).toEqual([R()])
    const f = fondo('s', 280, {}, { reglas: [], medioPago: 'Sodexo' })
    expect(reglaEn(f, '2026-10')).toEqual(R({ medios: 'solo', listaMedios: ['Sodexo'] }))
  })
  it('validarRegla rechaza combinaciones inválidas', () => {
    expect(validarRegla(R({ medios: 'solo' }))).toBe('Elige al menos un medio de pago.')
    expect(validarRegla(R({ cobertura: 'categoria' }))).toBe('Elige qué gastos cubre el fondo.')
    expect(validarRegla(R({ cobertura: 'ambito', rutas: [{ ambito: 'A', categoria: 'C', subcategoria: '' }] }))).toBe('La cobertura por ámbito solo lleva ámbitos.')
    expect(validarRegla(R({ restringeMedio: true, medios: 'excepto', listaMedios: ['X'] }))).toMatch(/Solo seleccionados/)
    expect(validarRegla(R({ restringeMedio: true, medios: 'solo', listaMedios: ['X'] }))).toMatch(/no restringe nada/)
    expect(validarRegla(R({ ...sodexoRegla }))).toBeNull()
  })
})

describe('integración con el motor de agregados (tolerancia cero)', () => {
  const filtros: Filters = { preset: 'custom', desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
  it('repartir no cambia el presupuesto consolidado, el gastado ni el disponible', () => {
    orden = 0
    const autoR = { cobertura: 'categoria' as const, rutas: [{ ambito: '', categoria: 'Auto', subcategoria: '' }] }
    const fs = [fondo('general', 3000), fondo('auto1', 400, autoR), fondo('sodexo', 280, sodexoRegla)]
    const gs = [g(550, { categoria: 'Auto' }), g(300, { medioPago: 'Sodexo' }), g(12.34), g(7, { moneda: 'USD' })]
    const a = aggregate(gs, filtros, { base: 'PEN', rates: { USD: 3.75 }, today: '2026-10-20', fondos: fs, fondosMeses: [], aislarDesde: '2099-01' })
    const p = a.presupuesto
    expect(p.presupuesto).toBe(368000)
    expect(p.gastadoPeriodo).toBe(55000 + 30000 + 1234 + 2625)
    expect(p.disponible).toBe(p.presupuesto - p.gastadoPeriodo)
    expect(p.fondos.reduce((s, r) => s + r.gastado, 0) + p.sinFondo.cents).toBe(p.gastadoPeriodo)
    expect(p.fondos.find(r => r.fondo.id === 'auto1')).toMatchObject({ gastado: 40000, enviado: 15000, estado: 'agotado' })
    // General acepta todos los medios: el exceso de Sodexo pasa a General (desborde), no queda en negativo.
    expect(p.fondos.find(r => r.fondo.id === 'sodexo')).toMatchObject({ gastado: 28000, estado: 'agotado', enviado: 2000 })
    expect(p.desbordados).toBe(2)
  })
  it('imputacionesDe devuelve el reparto por gasto para la tabla de Gastos', () => {
    orden = 0
    const fs = [fondo('general', 10)]
    const x = g(25)
    const m = imputacionesDe([x], fs, CTX)
    expect(m.get(x.id)).toMatchObject({ total: 2500, sinFondo: 0 })
  })
})

describe('sin nombres en el código', () => {
  it('el motor no contiene nombres de medios, categorías ni fondos', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(`${process.cwd()}/src/lib/presupuesto.ts`, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    for (const nombre of ['Sodexo', 'Alimentación', 'Auto', 'Bebé', 'Viajes', 'Servicios', 'Gasolina', 'Yape', 'Plin', 'general', 'General']) {
      expect(src, nombre).not.toMatch(new RegExp(`(^|[^\\p{L}])${nombre}($|[^\\p{L}])`, 'u'))
    }
  })
})
