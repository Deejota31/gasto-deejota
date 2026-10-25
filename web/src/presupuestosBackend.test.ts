import { beforeEach, describe, expect, it } from 'vitest'
import { gasto, load } from './testing/backendHarness'
import { createApi } from './lib/api'
import { asignarMes, REGLA_LIBRE, validarAsignacion, validarMedioGasto, validarRegla } from './lib/presupuesto'
import type { Fondo, ReglaFondo } from './lib/types'

/**
 * Presupuestos v1.28 en el backend real (Code.gs en la VM con hojas simuladas): reglas versionadas, medio restringido,
 * asignaciones manuales, renombres del catálogo, retiro de las hojas de cajas y paridad de validaciones con la web.
 */
type B = ReturnType<typeof load>
const R = (r: Partial<ReglaFondo> = {}): ReglaFondo => ({ ...REGLA_LIBRE, ...r })
const SODEXO = R({ medios: 'solo', listaMedios: ['Sodexo'], cobertura: 'categoria', rutas: [{ ambito: '', categoria: 'Alimentación', subcategoria: '' }], restringeMedio: true })
const GENERAL = R({ medios: 'excepto', listaMedios: ['Sodexo'] })
const gid = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`
const filas = (b: B, h: string) => (b.ss.getSheetByName(h)?.rows ?? []).slice(1).filter(r => r.some(c => c !== '' && c !== undefined))
const fondo = (b: B, id: string, nombre: string, monto: number, reglas?: ReglaFondo[], o: Record<string, unknown> = {}) =>
  b.post('saveFondo', { id, nombre, monto, moneda: 'PEN', color: '#1e3a8a', orden: 1, recurrencia: 'mensual', mes: '', ...(reglas ? { reglas } : {}), ...o })

describe('reglas de fondos en la hoja', () => {
  let b: B
  beforeEach(() => { b = load(); b.g.setup() })

  it('se guardan versionadas en la columna Reglas y la columna histórica «Medio de pago» se rellena para webs anteriores', () => {
    expect(fondo(b, 'f-sodexo', 'Sodexo', 280, [SODEXO]).ok).toBe(true)
    const f = filas(b, 'FONDOS_PRESUPUESTO')[0]
    expect(f[10]).toBe('Sodexo')
    expect(JSON.parse(String(f[14]))).toEqual([SODEXO])
    const d = b.post('data', { fresh: true }).data
    expect(JSON.parse(d.fondos[0][14])).toEqual([SODEXO])
  })

  it('un fondo anterior (sin reglas) se lee con reglas equivalentes a su medio, sin escribir nada', () => {
    fondo(b, 'f-sodexo', 'Sodexo', 280, undefined, { medioPago: 'Sodexo' })
    fondo(b, 'f-general', 'General', 3000)
    const w = b.ss.getSheetByName('FONDOS_PRESUPUESTO')!.writes
    const d = b.post('data', { fresh: true }).data
    expect(d.fondos.map((r: unknown[]) => JSON.parse(String(r[14])))).toEqual([[R({ medios: 'solo', listaMedios: ['Sodexo'] })], [R()]])
    expect(filas(b, 'FONDOS_PRESUPUESTO').map(r => r[14])).toEqual(['', ''])
    expect(b.ss.getSheetByName('FONDOS_PRESUPUESTO')!.writes).toBe(w)
  })

  it('guardar desde una web anterior (sin `reglas`) conserva las reglas guardadas', () => {
    fondo(b, 'f-sodexo', 'Sodexo', 280, [SODEXO])
    fondo(b, 'f-sodexo', 'Sodexo', 300, undefined, { medioPago: 'Sodexo' })
    expect(JSON.parse(String(filas(b, 'FONDOS_PRESUPUESTO')[0][14]))).toEqual([SODEXO])
    expect(filas(b, 'FONDOS_PRESUPUESTO')[0][2]).toBe(300)
  })

  it('rechaza reglas incoherentes con los mismos mensajes que la web (paridad)', () => {
    const malas: Partial<ReglaFondo>[] = [
      { medios: 'solo' }, { medios: 'excepto' }, { cobertura: 'categoria' }, { cobertura: 'todos', rutas: [{ ambito: 'A', categoria: '', subcategoria: '' }] },
      { cobertura: 'ambito', rutas: [{ ambito: 'A', categoria: 'C', subcategoria: '' }] }, { cobertura: 'categoria', rutas: [{ ambito: 'A', categoria: 'C', subcategoria: 'S' }] },
      { cobertura: 'subcategoria', rutas: [{ ambito: 'A', categoria: 'C', subcategoria: '' }] }, { cobertura: 'personalizada', rutas: [{ ambito: '', categoria: '', subcategoria: 'S' }] },
      { cobertura: 'personalizada', rutas: [{ ambito: '', categoria: '', subcategoria: '' }] }, { restringeMedio: true, medios: 'excepto', listaMedios: ['X'] },
      { restringeMedio: true, medios: 'solo', listaMedios: ['X'] }, { desde: '2026-13' }, { medios: 'solo', listaMedios: ['A|B'] },
    ]
    for (const m of malas) {
      const r = R(m)
      const web = validarRegla(r)
      expect(web, JSON.stringify(m)).not.toBeNull()
      const gs = fondo(b, 'f-x', 'X', 1, [r])
      expect(gs.error?.message, JSON.stringify(m)).toBe(web)
    }
    expect(filas(b, 'FONDOS_PRESUPUESTO')).toHaveLength(0)
    expect(fondo(b, 'f-x', 'X', 1, [R(), R({ desde: '' })]).error.message).toMatch(/mismo mes/)
  })
})

describe('medio restringido: se bloquea en el backend (web, lote y atajo)', () => {
  let b: B
  beforeEach(() => { b = load(); b.g.setup(); fondo(b, 'f-sodexo', 'Sodexo', 280, [SODEXO]); fondo(b, 'f-general', 'General', 3000, [GENERAL]) })
  const g = (n: number, o: Record<string, unknown>) => gasto({ id: gid(n), medioPago: 'Sodexo', ...o })

  it('Alimentación con Sodexo se guarda; Gasolina con Sodexo se rechaza con el mensaje pedido y no se escribe', () => {
    expect(b.post('saveGasto', g(1, { categoria: 'Alimentación', subcategoria: 'Almuerzo' })).ok).toBe(true)
    const r = b.post('saveGasto', g(2, { categoria: 'Auto', subcategoria: 'Gasolina' }))
    expect(r.error).toEqual({ code: 'MEDIO_RESTRINGIDO', message: 'El medio Sodexo no está permitido para esta categoría según la configuración de tus presupuestos.' })
    expect(filas(b, 'GASTOS')).toHaveLength(1)
  })

  it('no reclasifica: el gasto válido queda tal cual se envió', () => {
    b.post('saveGasto', g(1, { ambito: 'Familia', categoria: 'Alimentación', subcategoria: 'Mercado', descripcion: 'Mercado' }))
    const f = filas(b, 'GASTOS')[0]
    expect([f[8], f[3], f[4], f[5], f[6]]).toEqual(['Familia', 'Alimentación', 'Mercado', 'Mercado', 'Sodexo'])
  })

  it('al editar solo se revalida si cambia el medio, la clasificación o el mes (un gasto anterior a la regla se sigue pudiendo editar)', () => {
    const viejo = g(3, { categoria: 'Auto', subcategoria: 'Gasolina', fecha: '2026-10-02' })
    fondo(b, 'f-sodexo', 'Sodexo', 280, [{ ...SODEXO, restringeMedio: false }])
    expect(b.post('saveGasto', viejo).ok).toBe(true)
    fondo(b, 'f-sodexo', 'Sodexo', 280, [SODEXO])
    expect(b.post('saveGasto', { ...viejo, mode: 'update', descripcion: 'Grifo', monto: 55 }).ok).toBe(true)
    expect(b.post('saveGasto', { ...viejo, mode: 'update', subcategoria: 'Peaje' }).error.code).toBe('MEDIO_RESTRINGIDO')
    expect(b.post('saveGasto', { ...viejo, mode: 'update', medioPago: 'Yape' }).ok).toBe(true)
  })

  it('un reintento de un alta ya guardada no se revalida (idempotencia intacta)', () => {
    const x = g(4, { categoria: 'Alimentación' })
    b.post('saveGasto', x)
    fondo(b, 'f-sodexo', 'Sodexo', 280, [{ ...SODEXO, rutas: [{ ambito: '', categoria: 'Salud', subcategoria: '' }] }])
    expect(b.post('saveGasto', x).ok).toBe(true)
    expect(filas(b, 'GASTOS')).toHaveLength(1)
  })

  it('lote: todo o nada; el error dice qué gasto falla', () => {
    const lote = [g(5, { categoria: 'Alimentación', descripcion: 'Menú' }), g(6, { categoria: 'Auto', subcategoria: 'Gasolina', descripcion: 'Grifo' })].map(x => ({ ...x, mode: undefined }))
    const r = b.post('saveGastosBatch', { loteId: 'lote-00000000-0000-4000-8000-000000000001', gastos: lote })
    expect(r.error.code).toBe('MEDIO_RESTRINGIDO')
    expect(r.error.message).toBe('Gasto 2 (Grifo): El medio Sodexo no está permitido para esta categoría según la configuración de tus presupuestos.')
    expect(filas(b, 'GASTOS')).toHaveLength(0)
  })

  it('atajo de iPhone: también se rechaza y no se escribe', () => {
    const tk = (b.g as unknown as { crearTokenAtajo: () => string }).crearTokenAtajo()
    const post = (p: Record<string, unknown>) => JSON.parse(b.g.doPost({ postData: { contents: JSON.stringify({ token: tk, action: 'atajoGasto', payload: p }) } }).body)
    const base = { clave: 'atajo-20261010-0001', ambito: 'Personal', categoria: 'Auto', subcategoria: 'Gasolina', monto: '40', moneda: 'PEN', medioPago: 'Sodexo', fecha: '2026-10-10' }
    expect(post(base).error.code).toBe('MEDIO_RESTRINGIDO')
    expect(post({ ...base, clave: 'atajo-20261010-0002', categoria: 'Alimentación', subcategoria: 'Almuerzo' }).ok).toBe(true)
    expect(filas(b, 'GASTOS')).toHaveLength(1)
  })

  it('un fondo inactivo o de otro mes no restringe', () => {
    fondo(b, 'f-sodexo', 'Sodexo', 280, [SODEXO], { activo: false })
    expect(b.post('saveGasto', g(7, { categoria: 'Auto', subcategoria: 'Gasolina' })).ok).toBe(true)
    fondo(b, 'f-sodexo', 'Sodexo', 280, [SODEXO], { recurrencia: 'unica', mes: '2026-12' })
    expect(b.post('saveGasto', g(8, { categoria: 'Auto', subcategoria: 'Gasolina' })).ok).toBe(true)
  })

  it('paridad: la web y el backend aceptan y rechazan exactamente los mismos gastos', () => {
    const fondos = (b.post('data', { fresh: true }).data.fondos as unknown[][]).map(r => ({
      id: r[0], nombre: r[1], monto: r[2], moneda: r[3], activo: r[6], orden: r[7], recurrencia: r[8], mes: r[9], medioPago: r[10], reglas: JSON.parse(String(r[14])),
    })) as unknown as Fondo[]
    const casos = [['Personal', 'Alimentación', 'Almuerzo', 'Sodexo'], ['Familia', 'Alimentación', 'Mercado', 'Sodexo'], ['Personal', 'Auto', 'Gasolina', 'Sodexo'],
      ['Personal', 'Auto', 'Gasolina', 'Yape'], ['Familia', 'Servicios', 'Luz', 'sodexo'], ['Personal', 'alimentación', 'x', 'SODEXO']]
    casos.forEach(([ambito, categoria, subcategoria, medioPago], i) => {
      const x = gasto({ id: gid(100 + i), ambito, categoria, subcategoria, medioPago })
      const web = validarMedioGasto(x, fondos).ok
      expect(b.post('saveGasto', x).ok, JSON.stringify(x)).toBe(web)
    })
  })
})

describe('asignación manual (ASIGNACIONES_GASTOS)', () => {
  let b: B
  const AUTO = R({ cobertura: 'categoria', rutas: [{ ambito: '', categoria: 'Auto', subcategoria: '' }] })
  beforeEach(() => {
    b = load(); b.g.setup()
    fondo(b, 'f-auto', 'Auto', 400, [AUTO]); fondo(b, 'f-general', 'General', 3000)
    fondo(b, 'f-salud', 'Salud', 100, [R({ cobertura: 'categoria', rutas: [{ ambito: '', categoria: 'Salud', subcategoria: '' }] })])
    b.post('saveGasto', gasto({ id: gid(1), categoria: 'Auto', subcategoria: 'Taller', monto: 200 }))
  })

  it('guarda, se lee, se reemplaza (upsert) y se quita; nunca toca GASTOS', () => {
    const g0 = JSON.stringify(filas(b, 'GASTOS'))
    expect(b.post('saveAsignacion', { gastoId: gid(1), partes: [{ fondoId: 'f-general', monto: 150 }, { fondoId: 'f-auto', monto: 50 }] }).ok).toBe(true)
    expect(b.post('saveAsignacion', { gastoId: gid(1).toUpperCase(), partes: [{ fondoId: 'f-general', monto: 200 }] }).ok).toBe(true)
    expect(filas(b, 'ASIGNACIONES_GASTOS')).toHaveLength(1)
    expect(b.post('data', { fresh: true }).data.asignaciones).toEqual([[gid(1), JSON.stringify([{ fondoId: 'f-general', monto: 200 }])]])
    expect(b.post('saveAsignacion', { gastoId: gid(1), partes: [] }).ok).toBe(true)
    expect(filas(b, 'ASIGNACIONES_GASTOS')).toHaveLength(0)
    expect(JSON.stringify(filas(b, 'GASTOS'))).toBe(g0)
  })

  it('rechaza fondos incompatibles, sumas distintas, repetidos e inexistentes con los mismos mensajes que la web', () => {
    const casos = [[{ fondoId: 'f-salud', monto: 200 }], [{ fondoId: 'f-auto', monto: 199.99 }], [{ fondoId: 'f-auto', monto: 100 }, { fondoId: 'f-auto', monto: 100 }],
      [{ fondoId: 'nope', monto: 200 }], [{ fondoId: 'f-auto', monto: 0 }, { fondoId: 'f-general', monto: 200 }], [{ fondoId: 'f-auto', monto: 100.001 }, { fondoId: 'f-general', monto: 99.999 }]]
    const d = b.post('data', { fresh: true }).data
    const fondos = (d.fondos as unknown[][]).map(r => ({ id: r[0], nombre: r[1], monto: r[2], moneda: r[3], activo: r[6], orden: r[7], recurrencia: r[8], mes: r[9], medioPago: r[10], reglas: JSON.parse(String(r[14])) })) as unknown as Fondo[]
    const x = gasto({ id: gid(1), categoria: 'Auto', subcategoria: 'Taller', monto: 200 })
    for (const partes of casos) {
      const web = validarAsignacion({ ...x, estado: 'Activo', origen: 'web', creadoEn: '', actualizadoEn: '' } as never, partes, fondos, { fondosMeses: [], aislarDesde: '2026-11' })
      expect(web, JSON.stringify(partes)).not.toBeNull()
      expect(b.post('saveAsignacion', { gastoId: gid(1), partes }).error.message).toBe(web)
    }
    expect(filas(b, 'ASIGNACIONES_GASTOS')).toHaveLength(0)
    expect(b.post('saveAsignacion', { gastoId: gid(99), partes: [] }).error.code).toBe('NOT_FOUND')
  })

  it('no se asigna un gasto eliminado', () => {
    b.post('setEstado', { id: gid(1), estado: 'Anulado' })
    expect(b.post('saveAsignacion', { gastoId: gid(1), partes: [{ fondoId: 'f-general', monto: 200 }] }).error.message).toMatch(/restáuralo/)
  })

  it('de punta a punta: la web lee la asignación y el motor la aplica antes que las automáticas', async () => {
    b.post('saveAsignacion', { gastoId: gid(1), partes: [{ fondoId: 'f-general', monto: 200 }] })
    const api = createApi(async (a, p) => { const r = b.post(a, p); if (!r.ok) throw new Error(r.error.message); return r.data })
    const d = await api.getData(true)
    expect(d.asignaciones).toEqual({ [gid(1)]: [{ fondoId: 'f-general', monto: 200 }] })
    const res = asignarMes('2026-10', d.gastos, d.fondos!, { base: 'PEN', rates: {}, fondosMeses: [], aislarDesde: '2026-11', asignaciones: d.asignaciones })
    expect(res.porGasto.get(gid(1))!.partes).toEqual([{ fondoId: 'f-general', cents: 20000, tipo: 'manual' }])
    await api.saveAsignacion(gid(1), [])
    expect((await api.getData(true)).asignaciones).toEqual({})
  })
})

describe('catálogo y coberturas', () => {
  let b: B
  beforeEach(() => { b = load(); b.g.setup() })
  it('renombrar una categoría en un ámbito renombra las rutas de ese ámbito (todas las versiones) y no las de "todos los ámbitos"', () => {
    fondo(b, 'f-a', 'A', 100, [R({ cobertura: 'personalizada', rutas: [{ ambito: 'Personal', categoria: 'Auto', subcategoria: 'Gasolina' }, { ambito: '', categoria: 'Auto', subcategoria: '' }] }),
      R({ desde: '2026-11', cobertura: 'categoria', rutas: [{ ambito: 'Personal', categoria: 'Auto', subcategoria: '' }] })])
    const r = b.post('renameCatalogo', { nivel: 'categoria', ambito: 'Personal', categoria: 'Auto', nuevo: 'Vehículo' })
    expect(r.data).toMatchObject({ fondos: 1 })
    const v = JSON.parse(String(filas(b, 'FONDOS_PRESUPUESTO')[0][14]))
    expect(v[0].rutas).toEqual([{ ambito: 'Personal', categoria: 'Vehículo', subcategoria: 'Gasolina' }, { ambito: '', categoria: 'Auto', subcategoria: '' }])
    expect(v[1].rutas).toEqual([{ ambito: 'Personal', categoria: 'Vehículo', subcategoria: '' }])
  })
})

describe('retirarCajas (migración de hojas, solo con token de administración)', () => {
  let b: B
  const admin = () => { (b.g as unknown as { crearTokenAdmin: () => string }).crearTokenAdmin() }
  const hojaCajas = () => {
    b.ss.insertSheet('CAJAS').rows = [['ID', 'Nombre', 'Presupuesto', 'Filtro campo', 'Filtro valor', 'Color', 'Orden', 'Activo', 'Descripción', 'Icono'],
      ['general', 'Caja general', 3500, 'Todos', '', '#1e3a8a', 1, true, '', ''], ['auto', 'Caja Auto', 250, 'Categoría', 'Auto', '#64748b', 2, true, '', '']]
    b.ss.insertSheet('PRESUPUESTOS').rows = [['Periodo', 'Caja ID', 'Monto'], ['2026-09', 'general', 3200], ['2026-09', 'auto', 300]]
  }
  beforeEach(() => { b = load(); b.g.setup(); admin() })

  it('sin token de administración no hace nada', () => {
    hojaCajas()
    const ad = b.props.get('ADMIN_TOKEN')!
    expect(b.post('retirarCajas', {}, undefined, 'x'.repeat(ad.length)).error.code).toBe('ADMIN_UNAUTHORIZED')
  })

  it('simulación por defecto: inventario sin escribir nada', () => {
    hojaCajas()
    const antes = JSON.stringify([...b.ss.sheets.entries()].map(([n, s]) => [n, s.rows]))
    const r = b.post('retirarCajas', {})
    expect(r.data).toMatchObject({ simulacion: true, inventario: { cajas: 2, subcajas: 1, ajustesMensuales: 2, fondos: 0, cajaGeneral: { nombre: 'Caja general', presupuesto: 3500 } } })
    expect(r.data.inventario.acciones).toHaveLength(3)
    expect(JSON.stringify([...b.ss.sheets.entries()].map(([n, s]) => [n, s.rows]))).toBe(antes)
    expect(b.ss.copies).toHaveLength(0)
  })

  it('sin fondos: crea General con el importe y los ajustes de la caja general (el presupuesto de cada mes no cambia) y archiva las hojas', () => {
    hojaCajas()
    const r = b.post('retirarCajas', { aplicar: true })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(b.ss.copies.length).toBeGreaterThanOrEqual(1)
    expect(b.ss.getSheetByName('CAJAS')).toBeNull()
    expect(b.ss.getSheetByName('ARCHIVO_CAJAS')!.rows).toHaveLength(3)                    // nada se borró
    expect(b.ss.getSheetByName('ARCHIVO_PRESUPUESTOS')!.rows).toHaveLength(3)
    expect(filas(b, 'FONDOS_PRESUPUESTO').map(f => [f[0], f[1], f[2]])).toEqual([['fondo-general', 'General', 3500]])
    expect(filas(b, 'FONDOS_PRESUPUESTO_MESES').map(f => f.slice(0, 4))).toEqual([['fondo-general', '2026-09', 3200, 'solo']])
    expect(b.post('retirarCajas', { aplicar: true }).data).toMatchObject({ hecho: [] })     // idempotente
  })

  it('con fondos ya existentes no crea nada: solo archiva', () => {
    hojaCajas(); fondo(b, 'f-1', 'Mi general', 3000)
    expect(b.post('retirarCajas', { aplicar: true }).data.hecho).toEqual(['CAJAS → ARCHIVO_CAJAS', 'PRESUPUESTOS → ARCHIVO_PRESUPUESTOS'])
    expect(filas(b, 'FONDOS_PRESUPUESTO')).toHaveLength(1)
  })
})

describe('limpieza de hojas obsoletas (v1.30)', () => {
  let b: B
  const admin = () => { (b.g as unknown as { crearTokenAdmin: () => string }).crearTokenAdmin() }
  const cajas = () => {
    b.ss.insertSheet('CAJAS').rows = [['ID', 'Nombre', 'Presupuesto', 'Filtro campo', 'Filtro valor', 'Color', 'Orden', 'Activo', 'Descripción', 'Icono'],
      ['general', 'Caja general', 3500, 'Todos', '', '#1e3a8a', 1, true, '', '']]
    b.ss.insertSheet('PRESUPUESTOS').rows = [['Periodo', 'Caja ID', 'Monto'], ['2026-09', 'general', 3200]]
  }
  beforeEach(() => { b = load(); b.g.setup(); admin() })

  it('setup y repararHojas nunca crean CAJAS ni PRESUPUESTOS', () => {
    b.g.setup(); b.post('repararHojas', {})
    for (const n of ['CAJAS', 'PRESUPUESTOS', 'ARCHIVO_CAJAS', 'ARCHIVO_PRESUPUESTOS']) expect(b.ss.getSheetByName(n)).toBeNull()
  })

  it('la matriz lista todas las hojas con su acción y marca las obsoletas y las desconocidas', () => {
    cajas(); b.ss.insertSheet('MIS_NOTAS').rows = [['x'], ['y']]
    const r = b.post('auditarHojas', {}).data
    const por = Object.fromEntries(r.hojas.map((h: { hoja: string }) => [h.hoja, h]))
    expect(por.GASTOS).toMatchObject({ estado: 'vigente', accion: 'Conservar' })
    expect(por.CAJAS).toMatchObject({ estado: 'obsoleta', registros: 1 })
    expect(por.MIS_NOTAS).toMatchObject({ estado: 'desconocida', accion: 'Revisar manualmente (no se toca)' })
    expect(r.obsoletas.sort()).toEqual(['CAJAS', 'PRESUPUESTOS'])
    expect(r.vigentes).toContain('REVISIONES_PRESUPUESTO')
    expect(r.vigentes).not.toContain('CAJAS')
  })

  it('simulación por defecto: no escribe ni crea respaldo', () => {
    cajas()
    const r = b.post('limpiarHojasObsoletas', {}).data
    expect(r.simulacion).toBe(true)
    expect(b.ss.getSheetByName('CAJAS')).not.toBeNull()
    expect(b.ss.copies).toHaveLength(0)
  })

  it('con importe en la caja general y sin fondos queda pendiente: no elimina nada', () => {
    cajas()
    const r = b.post('limpiarHojasObsoletas', { aplicar: true }).data
    expect(r.pendientes.map((x: { hoja: string }) => x.hoja)).toContain('CAJAS')
    expect(b.ss.getSheetByName('CAJAS')).not.toBeNull()
  })

  it('tras retirarCajas: respaldo verificado, elimina las obsoletas y no reaparecen al reinicializar', () => {
    cajas()
    b.post('retirarCajas', { aplicar: true })
    const antes = b.ss.copies.length
    const r = b.post('limpiarHojasObsoletas', { aplicar: true }).data
    expect(b.ss.copies.length).toBe(antes + 1)
    expect(r.eliminadas.sort()).toEqual(['ARCHIVO_CAJAS', 'ARCHIVO_PRESUPUESTOS'])
    expect(r.verificacion).toEqual({ reaparecen: [], faltan: [], ok: true })
    b.g.setup(); b.post('repararHojas', {})
    expect(b.ss.getSheets().filter(s => /CAJAS|^PRESUPUESTOS/.test(s.name))).toHaveLength(0)
    expect(filas(b, 'FONDOS_PRESUPUESTO')).toHaveLength(1)           // los datos migrados siguen
  })

  it('no toca hojas desconocidas ni vigentes', () => {
    b.ss.insertSheet('MIS_NOTAS').rows = [['x']]
    cajas(); fondo(b, 'f-1', 'General', 3000)
    b.post('limpiarHojasObsoletas', { aplicar: true })
    expect(b.ss.getSheetByName('MIS_NOTAS')).not.toBeNull()
    expect(b.ss.getSheetByName('GASTOS')).not.toBeNull()
  })

  it('exige token de administración', () => {
    const ad = b.props.get('ADMIN_TOKEN')!
    expect(b.post('limpiarHojasObsoletas', { aplicar: true }, undefined, 'x'.repeat(ad.length)).error.code).toBe('ADMIN_UNAUTHORIZED')
  })
})
