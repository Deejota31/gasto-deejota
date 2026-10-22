// Pruebas de integración del backend: ejecuta apps-script/Code.gs real contra una simulación en memoria
// de SpreadsheetApp, CacheService, LockService y PropertiesService.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { gasto, legacyCheckboxes, load } from './testing/backendHarness'
import { CATALOGO_INICIAL } from './lib/catalogo'
import { configurarExcepciones, formatearDescripcion } from './lib/texto'
import { createApi } from './lib/api'
import { aggregate, aislaDesde, fondoMontoMes } from './lib/engine'
import { ratesFromConfig } from './lib/money'
import { calcularCompromisos, compararPeriodos, estadoCompromiso, evaluarCalidad } from './lib/salud'

describe('backend Apps Script', () => {
  let b: ReturnType<typeof load>
  beforeEach(() => { b = load(); b.g.setup() })

  it('setup crea las hojas (sin CAJAS ni PRESUPUESTOS desde v1.28), encabezados de GASTOS con 16 columnas y es idempotente', () => {
    expect([...b.ss.sheets.keys()].sort()).toEqual(['ASIGNACIONES_GASTOS', 'CATALOGO', 'CONFIG', 'FONDOS_PRESUPUESTO', 'FONDOS_PRESUPUESTO_MESES', 'GASTOS', 'MEDIOS_PAGO', 'ORDEN_GASTOS', 'PLANTILLAS_FINANCIERAS', 'REVISIONES_CALIDAD', 'REVISIONES_PRESUPUESTO', 'VINCULOS_PLANTILLAS'])
    expect(b.ss.getSheetByName('GASTOS')!.rows[0]).toHaveLength(16)
    const cat = b.ss.getSheetByName('CATALOGO')!.rows.slice(1)
    expect([...new Set(cat.map(r => r[0]))]).toEqual(['Personal', 'Trabajo', 'Pareja', 'Familia', 'Amigos'])
    expect(cat.filter(r => r[2])).toHaveLength(214)
    b.g.setup()
    expect(b.created()).toBe(1)
    expect(b.ss.getSheetByName('CATALOGO')!.rows).toHaveLength(cat.length + 1)
    expect(b.ss.getSheetByName('GASTOS')!.frozen).toBe(1)
  })

  it('el catálogo del backend es idéntico al del frontend', () => {
    const gs = (b.g as unknown as { CATALOGO_INICIAL: unknown }).CATALOGO_INICIAL
    expect(JSON.parse(JSON.stringify(gs))).toEqual(CATALOGO_INICIAL)
  })

  it('las subcategorías dependen del ámbito y la categoría', () => {
    const rows = b.ss.getSheetByName('CATALOGO')!.rows.slice(1)
    const subs = (a: string, c: string) => rows.filter(r => r[0] === a && r[1] === c).map(r => r[2])
    expect(subs('Familia', 'Bebé')).toContain('Pañales')
    expect(subs('Personal', 'Bebé')).toEqual([])
    expect(subs('Amigos', 'Transporte')).toEqual(['Taxi', 'Moto Taxi', 'Bus / Micro', 'Otros'])
  })

  it('volver a ejecutar setup agrega lo que falta sin reactivar lo desactivado ni borrar lo manual', () => {
    b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Auto', subcategoria: 'SOAT', activo: false })
    b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Mascotas', subcategoria: 'Veterinario', activo: true })
    const sheet = b.ss.getSheetByName('CATALOGO')!
    sheet.rows = sheet.rows.filter(r => !(r[1] === 'Suscripciones' && r[2] === 'Claude')) // simula una fila borrada
    b.g.setup()
    const rows = sheet.rows.slice(1)
    expect(rows.find(r => r[1] === 'Auto' && r[2] === 'SOAT')![3]).toBe(false)
    expect(rows.some(r => r[2] === 'Veterinario')).toBe(true)
    expect(rows.filter(r => r[1] === 'Suscripciones' && r[2] === 'Claude')).toHaveLength(1)
  })

  it('caso 1-2: el primer gasto va en la fila 2 y los siguientes en 3 y 4', () => {
    for (let i = 1; i <= 3; i++) b.post('saveGasto', gasto({ id: `bbbbbbbb-0000-4000-8000-00000000000${i}` }))
    const rows = b.ss.getSheetByName('GASTOS')!.rows
    expect(rows[1][13]).toBe('bbbbbbbb-0000-4000-8000-000000000001')
    expect(rows[2][13]).toBe('bbbbbbbb-0000-4000-8000-000000000002')
    expect(rows[3][13]).toBe('bbbbbbbb-0000-4000-8000-000000000003')
    expect(b.ss.getSheetByName('GASTOS')!.getLastRow()).toBe(4)
  })

  it('setup ya no crea casillas que llenen 999 filas', () => {
    expect(b.ss.getSheetByName('GASTOS')!.getLastRow()).toBe(1)
    expect(b.ss.getSheetByName('MEDIOS_PAGO')!.getLastRow()).toBe(7)
  })

  it('caso 3: con la hoja antigua (FALSE hasta la fila 1000 y datos en 1001) no sobrescribe e inserta después del último registro', () => {
    const sh = b.ss.getSheetByName('GASTOS')!
    legacyCheckboxes(sh, 9)
    for (let i = 0; i < 4; i++) sh.rows[1000 + i] = ['2026-10-09', 10 + i, 'PEN', 'Alimentación', 'Almuerzo', '', 'Efectivo', 'Variable', 'Personal', false, 'Activo', 'web', '', `cccccccc-0000-4000-8000-00000000000${i}`, '', '']
    legacyCheckboxes(b.ss.getSheetByName('MEDIOS_PAGO')!, 1)
    b.post('saveGasto', gasto())
    expect(sh.rows[1004][13]).toBe(gasto().id)
    for (let i = 0; i < 4; i++) expect(sh.rows[1000 + i][13]).toBe(`cccccccc-0000-4000-8000-00000000000${i}`)
    const d = b.post('data', { fresh: true }).data
    expect(d.gastos).toHaveLength(5)
    expect(d.medios.map((m: unknown[]) => m[0])).toEqual(['Yape', 'Plin', 'Sodexo', 'Transferencia', 'Efectivo', 'Otros'])
  })

  it('repararHojas: respalda, compacta desde la fila 2, conserva todo y asigna ID a filas manuales', () => {
    const sh = b.ss.getSheetByName('GASTOS')!
    legacyCheckboxes(sh, 9)
    for (let i = 0; i < 3; i++) sh.rows[1000 + i] = ['2026-10-09', 10 + i, 'PEN', 'Alimentación', 'Almuerzo', `g${i}`, 'Efectivo', 'Variable', 'Personal', false, 'Activo', 'web', '', `cccccccc-0000-4000-8000-00000000000${i}`, '', '']
    sh.rows[1005] = ['2026-10-08', 7, 'PEN', 'Otros', 'Otros', 'a mano', 'Yape', 'Variable', 'Trabajo', false, '', '', '', '', '', '']
    const med = b.ss.getSheetByName('MEDIOS_PAGO')!
    med.rows = [['Nombre', 'Activo'], ['Efectivo', true], ['Tarjeta de crédito', true], ['Yape', true], ['Plin', true]]
    const res = b.g.repararHojas() as unknown as { url: string }
    expect(res.url).toMatch(/^https:\/\/copy\//)
    expect(b.ss.copies).toHaveLength(1)
    expect(sh.getLastRow()).toBe(5)
    expect(sh.rows.slice(1, 5).map(r => r[5])).toEqual(['g0', 'g1', 'g2', 'a mano'])
    expect(String(sh.rows[4][13])).toMatch(/^[0-9a-f-]{36}$/)
    expect(sh.rows[4][11]).toBe('manual')
    expect(med.rows.slice(1, med.getLastRow()).map(r => r[0])).toEqual(['Yape', 'Plin', 'Efectivo', 'Tarjeta de crédito', 'Sodexo', 'Transferencia', 'Otros'])
    b.post('saveGasto', gasto())
    expect(sh.rows[5][13]).toBe(gasto().id)
  })

  it('renombrar una categoría actualiza catálogo y gastos de ese ámbito, no los de otros', () => {
    b.post('saveGasto', gasto({ ambito: 'Familia', categoria: 'Bebé', subcategoria: 'Pañales' }))
    b.post('saveGasto', gasto({ id: '22222222-2222-4333-8444-555555555555', ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Almuerzo' }))
    const r = b.post('renameCatalogo', { nivel: 'categoria', ambito: 'Familia', categoria: 'Bebé', nuevo: 'Hija' }).data
    expect(r.gastos).toBe(1)
    expect(r.catalogo).toBe(11) // las 11 subcategorías de Bebé
    const d = b.post('data', { fresh: true }).data
    expect(d.gastos.map((g: unknown[]) => g[3])).toEqual(['Hija', 'Alimentación'])
    expect(d.catalogo.some((c: unknown[]) => c[0] === 'Familia' && c[1] === 'Bebé')).toBe(false)
    expect(b.post('renameCatalogo', { nivel: 'categoria', ambito: 'Familia', categoria: 'Hija', nuevo: 'Hogar' }).error.code).toBe('VALIDATION')
  })

  it('guarda icono y color sin perderlos al desactivar', () => {
    b.post('saveCatalogo', { ambito: 'Familia', categoria: 'Bebé', subcategoria: '', icono: 'baby', color: '#f472b6' })
    b.post('saveCatalogo', { ambito: 'Familia', categoria: 'Bebé', subcategoria: '', activo: false })
    const row = b.post('data', { fresh: true }).data.catalogo.find((c: unknown[]) => c[0] === 'Familia' && c[1] === 'Bebé' && c[2] === '')
    expect(row.slice(0, 6)).toEqual(['Familia', 'Bebé', '', false, 'baby', '#f472b6'])
    expect(b.post('saveCatalogo', { ambito: 'X', icono: 'Bad Icon!' }).error.code).toBe('VALIDATION')
  })

  it('catálogo nuevo: 5 ámbitos, Transporte y Alimentación uniformes, Personal → Servicios', () => {
    const cat = b.post('data', { fresh: true }).data.catalogo as unknown[][]
    const ambitos = [...new Set(cat.map(r => r[0]))]
    expect(ambitos).toEqual(['Personal', 'Trabajo', 'Pareja', 'Familia', 'Amigos'])
    const subs = (a: string, c: string) => cat.filter(r => r[0] === a && r[1] === c && r[2]).map(r => r[2])
    for (const a of ambitos as string[]) {
      expect(subs(a, 'Transporte')).toEqual(['Taxi', 'Moto Taxi', 'Bus / Micro', 'Otros'])
      expect(subs(a, 'Alimentación')).toContain('Snack / Antojos')
      expect(subs(a, 'Alimentación')).not.toContain('Antojos')
    }
    expect(subs('Personal', 'Servicios')).toEqual(['Línea Celular', 'Otros'])
    // cada fila trae su orden; "Otros" se ordena al final en la web, no depende de este número
    expect(cat.every(r => typeof r[6] === 'number')).toBe(true)
  })

  it('saveCatalogo: "Otros" con otras mayúsculas o espacios no se duplica; lo nuevo va al final de su grupo', () => {
    const before = b.post('data', { fresh: true }).data.catalogo.length
    b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Alimentación', subcategoria: '  OTROS ', activo: true })
    expect(b.post('data', { fresh: true }).data.catalogo).toHaveLength(before)
    const nueva = b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Merienda', activo: true }).data
    expect(nueva[6]).toBe(10108) // después de las 7 existentes (10101…10107)
    const cat = b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Mascotas', subcategoria: '', activo: true }).data
    expect(cat[6]).toBe(11100) // nueva categoría tras las 10 de Personal
    const sub = b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Mascotas', subcategoria: 'Comida', activo: true }).data
    expect(sub[6]).toBe(11101)
  })

  it('reintento de un alta: no duplica y aplica la corrección solo si el gasto no se editó después', () => {
    b.post('saveGasto', gasto())
    const corregido = b.post('saveGasto', gasto({ monto: 30 })).data
    expect(corregido[1]).toBe(30)
    expect(b.post('data', { fresh: true }).data.gastos).toHaveLength(1)
    b.post('saveGasto', gasto({ mode: 'update', monto: 40 }))
    const sh = b.ss.getSheetByName('GASTOS')!
    sh.rows[1][15] = '2099-01-01T00:00:00.000Z' // fue editado después del alta
    expect(b.post('saveGasto', gasto({ monto: 99 })).data[1]).toBe(40)  // un reintento tardío no pisa la edición
    expect(b.post('data', { fresh: true }).data.gastos).toHaveLength(1)
  })

  it('P2: la respuesta de un reintento normaliza lo que Sheets devuelva (Date, número como texto, "TRUE", fechas ISO)', () => {
    b.post('saveGasto', gasto())
    b.post('saveGasto', gasto({ mode: 'update', monto: 40 }))          // ya editado: el reintento devuelve la fila guardada
    const sh = b.ss.getSheetByName('GASTOS')!
    sh.rows[1][0] = new Date('2026-10-09T05:00:00.000Z')               // fecha como Date
    sh.rows[1][1] = '40.50'                                            // monto como texto
    sh.rows[1][9] = 'TRUE'                                             // booleano como texto
    sh.rows[1][14] = new Date('2026-10-09T10:00:00.000Z')              // creado como Date
    sh.rows[1][15] = new Date('2026-10-09T11:00:00.000Z')              // actualizado como Date
    const r = b.post('saveGasto', gasto()).data
    expect(r[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(r[1]).toBe(40.5)
    expect(r[9]).toBe(true)
    expect(r[14]).toBe('2026-10-09T10:00:00.000Z')
    expect(r[15]).toBe('2026-10-09T11:00:00.000Z')
    expect(r).toHaveLength(16)
    expect(r.every((v: unknown, i: number) => i === 1 ? typeof v === 'number' : i === 9 ? typeof v === 'boolean' : typeof v === 'string')).toBe(true)
  })

  it('repararIds: respalda y cambia solo los IDs repetidos, vacíos o inválidos (el primero conserva el suyo)', () => {
    const sh = b.ss.getSheetByName('GASTOS')!
    const row = (id: string, desc: string, monto: number) => ['2026-10-01', monto, 'PEN', 'Auto', 'Gas', desc, 'Plin', 'Variable', 'Personal', false, 'Activo', 'web', '', id, 't0', 't0']
    sh.rows.push(row('5d1d6822-e84c-41f0-0b0d-aa2cf573c62A', 'Gas', 39.21), row('5d1d6822-e84c-41f0-0b0d-aa2cf573c62a', 'Enfamil', 187.2),
      row('5d1d6822-e84c-41f0-0b0d-aa2cf573c62P', 'Doritos', 2), row('00488880-85fb-4805-a7f0-5962625e15b1', 'Papitas', 4))
    const antes = sh.rows.map(r => r.filter((_, j) => j !== 13))
    const cambios = b.g.repararIds() as unknown as string[]
    expect(b.ss.copies).toHaveLength(1)
    expect(cambios).toHaveLength(2)
    expect(sh.rows[1][13]).toBe('5d1d6822-e84c-41f0-0b0d-aa2cf573c62A')          // primera aparición: igual
    expect(sh.rows[2][13]).not.toBe('5d1d6822-e84c-41f0-0b0d-aa2cf573c62a')      // repetido (sin importar mayúsculas)
    expect(sh.rows[3][13]).toMatch(/^[0-9a-f-]{36}$/)                            // inválido
    expect(sh.rows[4][13]).toBe('00488880-85fb-4805-a7f0-5962625e15b1')
    expect(sh.rows.map(r => r.filter((_, j) => j !== 13))).toEqual(antes)        // ningún otro dato cambió
    expect(new Set(sh.rows.slice(1).map(r => String(r[13]).toLowerCase())).size).toBe(4)
    expect(b.g.repararIds() as unknown as string[]).toHaveLength(0)              // idempotente
  })

  it('plantillas: crear, listar, editar, evitar duplicados y eliminar sin tocar GASTOS ni la caché del dashboard', () => {
    const id1 = 'pl-11111111-2222-4333-8444-555555555555', id2 = 'pl-11111111-2222-4333-8444-666666666666'
    b.post('saveGasto', gasto())
    const gastosAntes = JSON.stringify(b.ss.getSheetByName('GASTOS')!.rows)
    b.post('data', {})                                               // llena la caché del dashboard
    const genAntes = b.cache.get('data:gen')
    expect(genAntes).toBeTruthy()
    const p = { ambito: 'Personal', categoria: 'Suscripciones', subcategoria: 'ChatGPT', descripcion: 'ChatGPT' }
    const r1 = b.post('savePlantilla', { id: id1, mode: 'create', ...p })
    expect(r1.ok).toBe(true)
    expect(r1.data.slice(0, 5)).toEqual([id1, 'Personal', 'Suscripciones', 'ChatGPT', 'ChatGPT'])
    expect(b.post('savePlantilla', { id: id1, mode: 'create', ...p }).ok).toBe(true)   // reintento: no duplica
    expect(b.post('plantillas').data).toHaveLength(1)
    // duplicado exacto (ignora mayúsculas y espacios) → rechazado; misma subcategoría con otra descripción → permitido
    expect(b.post('savePlantilla', { id: id2, mode: 'create', ...p, descripcion: '  chatgpt ' }).error.code).toBe('VALIDATION')
    expect(b.post('savePlantilla', { id: id2, mode: 'create', ...p, subcategoria: 'Google', descripcion: 'Google One' }).ok).toBe(true)
    expect(b.post('savePlantilla', { id: id2, mode: 'update', ...p, subcategoria: 'Google', descripcion: 'Google Workspace' }).data[4]).toBe('Google Workspace')
    expect(b.post('savePlantilla', { id: 'abc', mode: 'create', ...p }).error.code).toBe('VALIDATION')           // ID de gasto no sirve
    expect(b.post('savePlantilla', { id: id2, mode: 'create', ...p, descripcion: '' }).error.code).toBe('VALIDATION') // 4 campos obligatorios
    expect(b.post('deletePlantilla', { id: id1 }).data.eliminada).toBe(true)
    expect(b.post('plantillas').data.map((x: unknown[]) => x[0])).toEqual([id2])
    expect(JSON.stringify(b.ss.getSheetByName('GASTOS')!.rows)).toBe(gastosAntes)
    expect(b.cache.get('data:gen')).toBe(genAntes)                   // las plantillas no invalidan los datos del dashboard
    expect(b.post('setEstado', { id: id2, estado: 'Anulado' }).error.code).toBe('VALIDATION') // un ID de plantilla no es ID de gasto
  })

  it('sin plantillas la lectura devuelve vacío y la primera plantilla de gasto se guarda en PLANTILLAS_FINANCIERAS (Tipo gasto + Datos JSON)', () => {
    b.ss.sheets.delete('PLANTILLAS_FINANCIERAS')
    expect(b.post('plantillas').data).toEqual([])
    expect(b.ss.getSheetByName('PLANTILLAS_FINANCIERAS')).toBeNull()      // leer no crea hojas
    expect(b.post('diagnose').ok).toBe(true)
    b.post('savePlantilla', { id: 'pl-11111111-2222-4333-8444-555555555555', mode: 'create', ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Internet', descripcion: 'Internet', monto: 95, medioPago: 'Yape', esCompromiso: true, tipoGasto: 'Fijo' })
    const sh = b.ss.getSheetByName('PLANTILLAS_FINANCIERAS')!
    expect(sh.rows[0]).toEqual(['ID', 'Tipo', 'Nombre', 'Monto', 'Moneda', 'Medios', 'Alcance', 'Valor', 'Descripción', 'Color', 'Icono', 'Recurrencia', 'Activo', 'Orden', 'Origen ID', 'Estados', 'Creado en', 'Actualizado en', 'Datos'])
    const f = sh.rows[1]
    expect([f[0], f[1], f[2], f[3], f[4], f[5], f[8], f[12], f[13]]).toEqual(['pl-11111111-2222-4333-8444-555555555555', 'gasto', 'Internet', 95, 'PEN', 'Yape', 'Internet', true, 1])
    expect(JSON.parse(String(f[18]))).toEqual({ ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Internet', tipoGasto: 'Fijo', esCompromiso: true, esRecurrente: false })
    expect(b.post('plantillas').data).toHaveLength(1)
    expect(b.ss.getSheetByName('PLANTILLAS_MENSUALES')).toBeNull()        // ya no existe esa hoja en instalaciones nuevas
  })

  it('plantillas v1.4: monto, moneda y medio; copia justo después de la original; reordenar en una escritura', () => {
    const id = (n: number) => `pl-11111111-2222-4333-8444-${String(n).padStart(12, '0')}`
    const base = { ambito: 'Familia', categoria: 'Servicios', descripcion: '', moneda: 'PEN', medioPago: 'Yape' }
    const mk = (n: number, sub: string, monto: number | '', extra: Record<string, unknown> = {}) =>
      b.post('savePlantilla', { id: id(n), mode: 'create', ...base, subcategoria: sub, descripcion: sub, monto, ...extra })
    expect(mk(1, 'Luz', 120).data.slice(7)).toEqual([120, 'PEN', 'Yape', 1, false, 'Variable', false])
    mk(2, 'Agua', 60); mk(3, 'Internet', 100)
    expect(mk(4, 'Gas', '').data[7]).toBe('')                                     // monto vacío permitido
    expect(b.post('savePlantilla', { id: id(5), mode: 'create', ...base, subcategoria: 'Luz', descripcion: 'Luz', monto: -1 }).error.code).toBe('VALIDATION')
    // duplicado exacto de las 7 propiedades → mensaje claro; con otro monto sí se permite
    expect(b.post('savePlantilla', { id: id(5), mode: 'create', ...base, subcategoria: 'Agua', descripcion: 'agua', monto: 60 }).error.message).toMatch(/ya existe/)
    // clonar Agua con otro medio: queda justo después de Agua
    const clon = b.post('savePlantilla', { id: id(6), mode: 'create', ...base, subcategoria: 'Agua', descripcion: 'Agua', monto: 60, medioPago: 'Plin', afterId: id(2) })
    expect(clon.ok).toBe(true)
    const nombres = () => b.post('plantillas').data.map((r: unknown[]) => `${r[4]}/${r[9]}`)
    expect(nombres()).toEqual(['Luz/Yape', 'Agua/Yape', 'Agua/Plin', 'Internet/Yape', 'Gas/Yape'])
    const sh = b.ss.getSheetByName('PLANTILLAS_FINANCIERAS')!
    const w = sh.writes
    b.post('reorderPlantillas', { ids: [id(3), id(1), id(2), id(6), id(4)] })
    expect(sh.writes - w).toBe(1)                                                 // una sola escritura
    expect(nombres()).toEqual(['Internet/Yape', 'Luz/Yape', 'Agua/Yape', 'Agua/Plin', 'Gas/Yape'])
    // editar conserva el orden
    b.post('savePlantilla', { id: id(1), mode: 'update', ...base, subcategoria: 'Luz', descripcion: 'Luz', monto: 130 })
    expect(b.post('plantillas').data[1].slice(7)).toEqual([130, 'PEN', 'Yape', 2, false, 'Variable', false])
  })

  describe('plantillas de gastos mensuales en PLANTILLAS_FINANCIERAS (v1.19.2)', () => {
    const id = (n: number) => `pl-11111111-2222-4333-8444-${String(n).padStart(12, '0')}`
    const nuevaHoja = () => b.ss.getSheetByName('PLANTILLAS_FINANCIERAS')!
    const lista = () => b.post('plantillas').data as unknown[][]
    it('gastos y fondos conviven en una hoja sin pisarse (y una fila subcaja antigua se ignora): reordenar, eliminar y listar actúan solo sobre su Tipo', () => {
      b.post('savePlantilla', { id: id(1), mode: 'create', ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Luz', descripcion: 'Luz', monto: '', moneda: 'PEN', medioPago: 'Plin' })
      b.post('savePlantilla', { id: id(2), mode: 'create', ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Agua', descripcion: 'Agua', monto: 80, moneda: 'PEN', medioPago: 'Plin' })
      const f1 = b.post('savePlantillaFin', { id: 'pf-aaaaaaaa-0000-4000-8000-000000000001', tipo: 'fondo', nombre: 'General', monto: 3000, moneda: 'PEN', medios: '', recurrencia: 'unica' }).data[0]
      const f2 = b.post('savePlantillaFin', { id: 'pf-aaaaaaaa-0000-4000-8000-000000000002', tipo: 'fondo', nombre: 'Sodexo', monto: 280, moneda: 'PEN', medios: 'Sodexo', recurrencia: 'unica' }).data[0]
      expect(b.post('savePlantillaFin', { id: 'pf-aaaaaaaa-0000-4000-8000-000000000003', tipo: 'subcaja', nombre: 'Mascotas', monto: 700, campo: 'Categoría', valor: 'Mascotas' }).error.code).toBe('VALIDATION')
      const s1 = 'pf-aaaaaaaa-0000-4000-8000-000000000003'
      nuevaHoja().rows.push([s1, 'subcaja', 'Mascotas', 700, '', '', 'Categoría', 'Mascotas', '', '#1e3a8a', 'auto', 'mensual', true, 1, '', '', '', '', ''])   // fila anterior a v1.28
      expect(nuevaHoja().rows.slice(1).map(r => r[1])).toEqual(['gasto', 'gasto', 'fondo', 'fondo', 'subcaja'])
      expect(b.post('data', { fresh: true }).data.plantillasFin.map((p: unknown[]) => p[0]).sort()).toEqual([f1, f2].sort())  // ni gastos ni subcajas antiguas
      expect(lista().map(x => x[0])).toEqual([id(1), id(2)])
      const ordenDe = (idp: string) => nuevaHoja().rows.find(r => r[0] === idp)![13]
      expect(b.post('reorderPlantillasFin', { tipo: 'fondo', ids: [f2, f1] }).ok).toBe(true)
      expect([ordenDe(f2), ordenDe(f1), ordenDe(id(1)), ordenDe(id(2)), ordenDe(s1)]).toEqual([1, 2, 1, 2, 1])
      expect(b.post('reorderPlantillas', { ids: [id(2), id(1)] }).ok).toBe(true)
      expect([ordenDe(id(2)), ordenDe(id(1)), ordenDe(f2), ordenDe(f1)]).toEqual([1, 2, 1, 2])
      expect(lista().map(x => x[0])).toEqual([id(2), id(1)])
      expect(b.post('deletePlantilla', { id: id(1) }).data.eliminada).toBe(true)
      expect(b.post('deletePlantilla', { id: f1 }).error.code).toBe('VALIDATION')          // un ID de fondo no es plantilla de gasto
      expect(b.post('deletePlantillaFin', { id: f1 }).data.eliminada).toBe(true)
      expect(nuevaHoja().rows.slice(1).map(r => r[1]).sort()).toEqual(['fondo', 'gasto', 'subcaja'])
      // el ID de un gasto no puede reutilizarse como fondo
      expect(b.post('savePlantillaFin', { id: id(2), tipo: 'fondo', nombre: 'X', monto: 1, moneda: 'PEN', medios: '', recurrencia: 'mensual' }).ok).toBe(false)
    })

    it('hoja PLANTILLAS_FINANCIERAS de 18 columnas (v1.17–v1.19): se agrega Datos sin perder filas, y los fondos se pueden aplicar', () => {
      const cols = ['ID', 'Tipo', 'Nombre', 'Monto', 'Moneda', 'Medios', 'Alcance', 'Valor', 'Descripción', 'Color', 'Icono', 'Recurrencia', 'Activo', 'Orden', 'Origen ID', 'Estados', 'Creado en', 'Actualizado en']
      const fila = (i: string, tipo: string, nombre: string) => [i, tipo, nombre, 400, 'PEN', 'Libre', tipo === 'subcaja' ? 'Categoría' : '', tipo === 'subcaja' ? nombre : '', '', '#1e3a8a', 'auto', 'unica', true, 1, '', '', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z']
      const sh = nuevaHoja()
      sh.rows = [cols, fila('pf-f555815c-fb2d-48e5-9d08-5b4c07027f19', 'fondo', 'Sodexo'), fila('pf-4e870b82-7519-44dc-b406-8bad102c664e', 'subcaja', 'Mascotas')]
      expect(b.post('data', { fresh: true }).data.plantillasFin).toHaveLength(1)   // la subcaja antigua no se lee (tampoco se borra)
      expect(b.post('savePlantillaFin', { id: 'pf-aaaaaaaa-0000-4000-8000-000000000009', tipo: 'fondo', nombre: 'Extra 1', monto: 500, moneda: 'PEN', medios: '', recurrencia: 'unica' }).ok).toBe(true)
      expect(sh.rows[0][18]).toBe('Datos')
      expect(sh.rows.slice(1).map(r => r[0]).slice(0, 2)).toEqual(['pf-f555815c-fb2d-48e5-9d08-5b4c07027f19', 'pf-4e870b82-7519-44dc-b406-8bad102c664e'])
      expect(b.post('aplicarPlantillasFin', { mes: '2026-10', items: [{ id: 'pf-4e870b82-7519-44dc-b406-8bad102c664e', accion: 'aplicar', monto: 700 }] }).error.code).toBe('NOT_FOUND')
      const ap = b.post('aplicarPlantillasFin', { mes: '2026-10', items: [{ id: 'pf-f555815c-fb2d-48e5-9d08-5b4c07027f19', accion: 'aplicar', monto: 280 }] })
      expect(ap.ok, JSON.stringify(ap)).toBe(true)
      expect(b.post('data', { fresh: true }).data.fondos.some((f: unknown[]) => f[1] === 'Sodexo')).toBe(true)
      expect(sh.rows.some(r => r[1] === 'subcaja')).toBe(true)
    })
  })

  it('saveGastosBatch: valida todo antes de escribir, respeta el orden, una escritura e idempotente', () => {
    const gid = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
    const g = (n: number, desc: string, monto: number) => ({ ...gasto({ id: gid(n), descripcion: desc, monto }), mode: undefined })
    const sh = b.ss.getSheetByName('GASTOS')!
    // un gasto inválido → no se inserta ninguno y el error dice cuál
    const malo = b.post('saveGastosBatch', { loteId: 'lote-00000000-0000-4000-8000-000000000001', gastos: [g(1, 'Luz', 120), g(2, 'Agua', 0)] })
    expect(malo.error.code).toBe('VALIDATION')
    expect(malo.error.message).toMatch(/Gasto 2 \(Agua\)/)
    expect(sh.getLastRow()).toBe(1)
    const lote = { loteId: 'lote-00000000-0000-4000-8000-000000000002', gastos: [g(1, 'Luz', 120), g(2, 'Agua', 60), g(3, 'Internet', 110)] }
    const w = sh.writes
    const r = b.post('saveGastosBatch', lote).data
    expect(sh.writes - w).toBe(1)
    expect(r).toMatchObject({ estado: 'confirmado', solicitados: 3, confirmados: 3, nuevos: 3, ids: [gid(1), gid(2), gid(3)] })
    expect(sh.rows.slice(1, 4).map(x => x[5])).toEqual(['Luz', 'Agua', 'Internet'])  // orden recibido
    // reintento del mismo lote (respuesta perdida): no duplica
    expect(b.post('saveGastosBatch', lote).data).toMatchObject({ confirmados: 3, nuevos: 0, yaExistian: 3 })
    expect(sh.getLastRow()).toBe(4)
    // reintento con un monto editado: la hoja no cambia y la respuesta trae lo que realmente quedó guardado
    const editado = { ...lote, gastos: [g(1, 'Luz', 999), g(4, 'Gas', 45)] }
    const r2 = b.post('saveGastosBatch', editado).data
    expect(r2).toMatchObject({ nuevos: 1, yaExistian: 1 })
    expect(r2.gastos.map((x: unknown[]) => [x[5], x[1]])).toEqual([['Luz', 120], ['Gas', 45]])
    expect(sh.getLastRow()).toBe(5)
    expect(b.post('saveGastosBatch', { loteId: 'x', gastos: [] }).error.code).toBe('VALIDATION')
  })

  it('v1.5 compromisos: marcar plantilla, vincular al crear, en lote (también en reintento) y a mano, sin tocar GASTOS', () => {
    const pl = 'pl-11111111-2222-4333-8444-000000000009'
    const base = { ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Luz', descripcion: 'Luz', monto: 120, moneda: 'PEN', medioPago: 'Yape' }
    expect(b.post('savePlantilla', { id: pl, mode: 'create', ...base, esCompromiso: true }).data[11]).toBe(true)
    // editar sin enviar esCompromiso lo conserva; enviarlo lo cambia
    expect(b.post('savePlantilla', { id: pl, mode: 'update', ...base, monto: 130 }).data[11]).toBe(true)
    expect(b.post('savePlantilla', { id: pl, mode: 'update', ...base, esCompromiso: 'si' }).error.code).toBe('VALIDATION')
    const gid = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`
    // alta individual con plantilla → vínculo; plantilla inválida → no se escribe nada
    const gs = b.ss.getSheetByName('GASTOS')!
    expect(b.post('saveGasto', gasto({ id: gid(9), plantillaId: 'pl-malo' })).error.code).toBe('VALIDATION')
    expect(gs.getLastRow()).toBe(1)
    b.post('saveGasto', gasto({ id: gid(1), plantillaId: pl }))
    // editar no crea vínculos nuevos ni quita el existente
    b.post('saveGasto', gasto({ id: gid(1), monto: 99, mode: 'update', plantillaId: 'pl-11111111-2222-4333-8444-000000000777' }))
    // lote: el gasto 3 sin plantilla
    const lote = { loteId: 'lote-00000000-0000-4000-8000-000000000009', gastos: [
      { ...gasto({ id: gid(2) }), mode: undefined, plantillaId: pl }, { ...gasto({ id: gid(3) }), mode: undefined }] }
    expect(b.post('saveGastosBatch', lote).ok).toBe(true)
    const vin = b.ss.getSheetByName('VINCULOS_PLANTILLAS')!
    vin.rows = vin.rows.filter(r => r[0] !== gid(2))  // simula que la vez anterior el vínculo no alcanzó a escribirse
    b.post('saveGastosBatch', lote)                    // reintento: completa el vínculo sin duplicar gastos
    expect(gs.getLastRow()).toBe(4)
    let d = b.post('data', { fresh: true }).data
    expect(d.vinculos.sort()).toEqual([[gid(1), pl], [gid(2), pl]])
    // asociar a mano un movimiento histórico y luego quitar el vínculo
    const antes = JSON.stringify(gs.rows)
    expect(b.post('vincularGasto', { gastoId: gid(3), plantillaId: pl }).data).toEqual([gid(3), pl])
    expect(b.post('vincularGasto', { gastoId: gid(1), plantillaId: '' }).ok).toBe(true)
    expect(b.post('vincularGasto', { gastoId: 'dddddddd-0000-4000-8000-000000000000', plantillaId: pl }).error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(gs.rows)).toBe(antes)       // GASTOS no cambia
    d = b.post('data', {}).data                       // la caché se invalidó con el vínculo
    expect(d.vinculos.sort()).toEqual([[gid(2), pl], [gid(3), pl]])
    expect(vin.rows.slice(1).filter(r => r[0])).toHaveLength(3) // sin filas repetidas
  })

  it('v1.5 revisiones de calidad: upsert por conjunto de IDs, valida estado y no toca GASTOS', () => {
    const ids = ['eeeeeeee-0000-4000-8000-000000000002', 'EEEEEEEE-0000-4000-8000-000000000001']
    const r1 = b.post('saveRevision', { id: 'rev-00000000-0000-4000-8000-000000000001', tipo: 'duplicado', ids, estado: 'legitimo', firma: 'k1' })
    expect(r1.data.slice(1, 5)).toEqual(['duplicado', 'eeeeeeee-0000-4000-8000-000000000001,eeeeeeee-0000-4000-8000-000000000002', 'legitimo', 'k1'])
    // mismo grupo en otro orden → actualiza (no duplica) y conserva el ID original
    const r2 = b.post('saveRevision', { id: 'rev-00000000-0000-4000-8000-000000000002', tipo: 'duplicado', ids: [...ids].reverse(), estado: 'duplicado', firma: 'k2' })
    expect(r2.data[0]).toBe('rev-00000000-0000-4000-8000-000000000001')
    expect(b.post('data', {}).data.revisiones).toHaveLength(1)
    expect(b.post('data', {}).data.revisiones[0][3]).toBe('duplicado')
    expect(b.post('saveRevision', { id: 'rev-00000000-0000-4000-8000-000000000003', tipo: 'duplicado', ids, estado: 'borrar', firma: 'k' }).error.code).toBe('VALIDATION')
    expect(b.post('saveRevision', { id: 'rev-00000000-0000-4000-8000-000000000003', tipo: 'duplicado', ids: [ids[0]], estado: 'legitimo', firma: 'k' }).error.code).toBe('VALIDATION')
    expect(b.ss.getSheetByName('GASTOS')!.getLastRow()).toBe(1)
  })

  it('v1.10 plantillas: tipo de gasto y recurrente se guardan, se conservan al editar sin enviarlos y se validan', () => {
    const id = 'pl-11111111-2222-4333-8444-0000000000a1'
    const base = { id, ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Luz', descripcion: 'Luz', moneda: 'PEN', medioPago: 'Yape' }
    const r = b.post('savePlantilla', { ...base, mode: 'create', monto: 100, tipoGasto: 'Fijo', esRecurrente: true })
    expect(r.data.slice(11)).toEqual([false, 'Fijo', true])
    // editar sin mandar tipo ni recurrente los conserva
    expect(b.post('savePlantilla', { ...base, mode: 'update', monto: 110 }).data.slice(11)).toEqual([false, 'Fijo', true])
    // y se pueden cambiar
    expect(b.post('savePlantilla', { ...base, mode: 'update', monto: 110, tipoGasto: 'Extraordinario', esRecurrente: false }).data.slice(11)).toEqual([false, 'Extraordinario', false])
    expect(b.post('savePlantilla', { ...base, mode: 'update', tipoGasto: 'Raro' }).error.code).toBe('VALIDATION')
    expect(b.post('savePlantilla', { ...base, mode: 'update', esRecurrente: 'si' }).error.code).toBe('VALIDATION')
    expect(b.post('plantillas').data.find((x: unknown[]) => x[0] === id).slice(11)).toEqual([false, 'Extraordinario', false])
  })

  describe('v1.11 categorías compartidas entre ámbitos', () => {
    const cat = () => b.ss.getSheetByName('CATALOGO')!.rows.slice(1)
    const cabeza = (nombre: string) => cat().filter(r => r[1] === nombre && r[2] === '')
    const sub = (c: string, s: string) => cat().filter(r => r[1] === c && r[2] === s)

    // Las categorías no tienen fila propia hasta que se edita su aspecto: se crean las de tres ámbitos como las crea la web.
    const conCabezas = () => { for (const a of ['Personal', 'Trabajo', 'Amigos']) b.post('saveCatalogo', { ambito: a, categoria: 'Alimentación', subcategoria: '', activo: true }) }

    it('editar el icono y color de una categoría en un ámbito lo escribe en todos; el estado (activo) sigue siendo de cada ámbito', () => {
      conCabezas()
      expect(cabeza('Alimentación')).toHaveLength(3)
      const w = b.ss.getSheetByName('CATALOGO')!.writes
      const r = b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Alimentación', subcategoria: '', activo: false, icono: 'rocket', color: '#E5484D' })
      expect(r.ok).toBe(true)
      expect(b.ss.getSheetByName('CATALOGO')!.writes - w).toBe(2)               // la fila editada + una sola escritura para las demás
      for (const row of cabeza('Alimentación')) { expect(row[4]).toBe('rocket'); expect(row[5]).toBe('#E5484D') }
      const estados = cabeza('Alimentación').map(row => [row[0], row[3]])
      expect(estados.find(x => x[0] === 'Personal')![1]).toBe(false)
      expect(estados.filter(x => x[0] !== 'Personal').every(x => x[1] === true)).toBe(true)
      // las subcategorías y los ámbitos no se tocan
      expect(sub('Alimentación', 'Almuerzo').every(row => row[4] === '')).toBe(true)
      expect(cat().filter(row => row[1] === '').every(row => row[4] !== 'rocket')).toBe(true)
    })

    it('una subcategoría comparte su icono entre ámbitos; ámbitos distintos no comparten nada', () => {
      expect(sub('Alimentación', 'Almuerzo').length).toBeGreaterThan(1)
      b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Almuerzo', icono: 'gift' })
      for (const row of sub('Alimentación', 'Almuerzo')) expect(row[4]).toBe('gift')
      expect(sub('Alimentación', 'Cena').every(row => row[4] === '')).toBe(true)
      b.post('saveCatalogo', { ambito: 'Personal', icono: 'star', color: '#4F7BE8' })
      expect(cat().filter(row => row[1] === '' && row[0] !== 'Personal').every(row => row[4] !== 'star')).toBe(true)
    })

    it('al crear una categoría o subcategoría que ya existe en otro ámbito hereda su aspecto en vez de pisarlo', () => {
      conCabezas()
      b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Alimentación', subcategoria: '', icono: 'rocket', color: '#E5484D' })
      const r = b.post('saveCatalogo', { ambito: 'Nuevo ámbito', categoria: 'Alimentación', subcategoria: '', icono: 'tag', color: '#4F7BE8' })
      expect(r.data.slice(4, 6)).toEqual(['rocket', '#E5484D'])
      expect(cabeza('Alimentación').every(row => row[4] === 'rocket' && row[5] === '#E5484D')).toBe(true)
      // una categoría realmente nueva usa lo que se envía
      const n = b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Categoría inventada', subcategoria: '', icono: 'gift', color: '#6366F1' })
      expect(n.data.slice(4, 6)).toEqual(['gift', '#6366F1'])
    })
  })

  describe('v1.11 hoja sin celdas vacías', () => {
    it('fondos: Icono = auto y Medio de pago = Libre en la hoja; la web los recibe vacíos', () => {
      const f = b.post('saveFondo', { id: 'f-ica', nombre: 'Viaje a Ica', monto: 1000, moneda: 'PEN', color: '#B4693C', orden: 2, recurrencia: 'unica', mes: '2026-10' })
      expect(f.ok).toBe(true)
      const fila = b.ss.getSheetByName('FONDOS_PRESUPUESTO')!.rows.find(r => r[0] === 'f-ica')!
      expect([fila[5], fila[10]]).toEqual(['auto', 'Libre'])
      expect([f.data[5], f.data[10]]).toEqual(['', ''])
      const d = b.post('data', { fresh: true }).data
      expect(d.fondos.find((x: unknown[]) => x[0] === 'f-ica').filter((_: unknown, i: number) => i === 5 || i === 10)).toEqual(['', ''])
      // volver a guardar con un medio real y con "Libre" explícito
      expect(b.post('saveFondo', { id: 'f-ica', nombre: 'Viaje a Ica', monto: 1000, moneda: 'PEN', orden: 2, recurrencia: 'unica', mes: '2026-10', medioPago: 'Libre' }).data[10]).toBe('')
      expect(b.post('saveFondo', { id: 'f-ica', nombre: 'Viaje a Ica', monto: 1000, moneda: 'PEN', orden: 2, recurrencia: 'unica', mes: '2026-10', medioPago: 'Yape' }).data[10]).toBe('Yape')
      expect(b.ss.getSheetByName('FONDOS_PRESUPUESTO')!.rows.find(r => r[0] === 'f-ica')![10]).toBe('Yape')
      // "Libre" no se puede usar como medio de pago real
      expect(b.post('saveMedio', { nombre: 'Libre' }).error.code).toBe('VALIDATION')
      expect(b.post('saveMedio', { nombre: ' libre ' }).error.code).toBe('VALIDATION')
    })

    it('completarVacios rellena solo lo vacío (fondos, catálogo, config), no pisa nada, es idempotente y ya no toca cajas', () => {
      const cajas = b.ss.insertSheet('CAJAS')   // hoja anterior a v1.28: queda intacta
      cajas.rows = [['ID', 'Nombre', 'Presupuesto', 'Filtro campo', 'Filtro valor', 'Color', 'Orden', 'Activo', 'Descripción', 'Icono'], ['general', 'Caja general', 3000, 'Todos', '', '#1e3a8a', 1, '', '']]
      const cajas0 = JSON.stringify(cajas.rows)
      b.post('saveFondo', { id: 'f-1', nombre: 'General', monto: 3109.75, moneda: 'PEN', color: '#1E3A8A', orden: 1, recurrencia: 'unica', mes: '2026-10' })
      const f = b.ss.getSheetByName('FONDOS_PRESUPUESTO')!.rows.find(r => r[0] === 'f-1')!
      f[5] = ''; f[10] = ''                                                    // celdas vacías, como las que tenías
      const cat = b.ss.getSheetByName('CATALOGO')!
      const antes = JSON.stringify(cat.rows.map(r => [r[4], r[5]]))
      cat.rows[2][3] = ''                                                       // Activo vacío = activo
      const r = b.post('completarVacios', { catalogo: [
        { ambito: 'Personal', categoria: '', subcategoria: '', icono: 'user', color: '#4F7BE8' },
        { ambito: 'Personal', categoria: 'Auto', subcategoria: '', icono: 'car', color: '#64748B' },
        { ambito: 'Personal', categoria: 'Auto', subcategoria: 'Gasolina', icono: 'fuel', color: '#64748B' },
        { ambito: 'Nada', categoria: '', subcategoria: '', icono: 'x', color: '#000000' },
        { ambito: 'Personal', categoria: 'Auto', subcategoria: 'SOAT', icono: 'Bad Icon!', color: 'rojo' },
      ] })
      expect(r.ok).toBe(true)
      expect(r.data.cajas).toBe(0)
      expect(JSON.stringify(cajas.rows)).toBe(cajas0)
      expect(r.data.fondos).toBe(1)
      expect(r.data.catalogo).toBeGreaterThan(0)
      expect([f[5], f[10]]).toEqual(['auto', 'Libre'])
      const personal = cat.rows.find(x => x[0] === 'Personal' && x[1] === '')!
      expect([personal[3], personal[4], personal[5]]).toEqual([true, 'user', '#4F7BE8'])
      const gasolina = cat.rows.find(x => x[0] === 'Personal' && x[2] === 'Gasolina')!
      expect([gasolina[4], gasolina[5]]).toEqual(['fuel', '#64748B'])
      const soat = cat.rows.find(x => x[0] === 'Personal' && x[2] === 'SOAT')!
      expect([soat[4], soat[5]]).toEqual(['', ''])                                           // datos inválidos no se escriben
      expect(cat.rows[2][3]).toBe(true)
      expect(JSON.stringify(cat.rows.map(x => [x[4], x[5]])) === antes).toBe(false)
      // config: la clave nueva se agrega con su valor
      expect(b.ss.getSheetByName('CONFIG')!.rows.some(x => x[0] === 'refresco_segundos' && x[1] === '300')).toBe(true)
      // idempotente: la segunda vez no cambia nada
      const w = [cajas.writes, cat.writes, b.ss.getSheetByName('FONDOS_PRESUPUESTO')!.writes]
      const r2 = b.post('completarVacios', { catalogo: [{ ambito: 'Personal', categoria: '', subcategoria: '', icono: 'star', color: '#000000' }] })
      expect(r2.data).toEqual({ cajas: 0, fondos: 0, catalogo: 0, config: 0, medios: 0 })
      expect([cajas.writes, cat.writes, b.ss.getSheetByName('FONDOS_PRESUPUESTO')!.writes]).toEqual(w)
      expect(personal[4]).toBe('user')                                                       // no pisó lo ya relleno
    })

    it('la lectura ya no trae cajas ni presupuestos (listas vacías solo por compatibilidad con la web 1.27)', () => {
      b.ss.insertSheet('CAJAS').rows = [['ID'], ['general', 'Caja general', 3000, 'Todos', '', '#1e3a8a', 1]]
      const d = b.post('data', { fresh: true }).data
      expect([d.cajas, d.presupuestos]).toEqual([[], []])
    })
  })

  describe('v1.8 fondos del presupuesto', () => {
    // Instalación anterior a v1.8: todavía no existen las hojas de fondos.
    beforeEach(() => { b.admin(); b.ss.sheets.delete('FONDOS_PRESUPUESTO'); b.ss.sheets.delete('FONDOS_PRESUPUESTO_MESES') })
    const fondo = (o: Record<string, unknown>) => b.post('saveFondo', { nombre: 'X', monto: 0, moneda: 'PEN', color: '#16A085', orden: 1, recurrencia: 'mensual', mes: '', ...o })

    it('el primer fondo crea las hojas con respaldo previo (una sola vez) sin tocar GASTOS ni el catálogo', () => {
      b.post('saveGasto', gasto())
      const otras = ['GASTOS', 'CATALOGO'].map(n => JSON.stringify(b.ss.getSheetByName(n)!.rows))
      expect(b.post('data', { fresh: true }).data.fondos).toEqual([])
      const r = fondo({ id: 'f-sodexo', nombre: 'Sodexo', monto: 280, medioPago: 'Sodexo' })
      expect(r.ok).toBe(true)
      expect(b.ss.copies).toHaveLength(1)
      expect(b.ss.getSheetByName('FONDOS_PRESUPUESTO')!.rows[0]).toHaveLength(15)
      expect(b.ss.getSheetByName('FONDOS_PRESUPUESTO_MESES')!.rows[0]).toEqual(['Fondo ID', 'Mes', 'Monto', 'Modo', 'Actualizado en'])
      fondo({ id: 'f-extra1', nombre: 'Extra 1', monto: 1000, recurrencia: 'unica', mes: '2026-10' })
      expect(b.ss.copies).toHaveLength(1)                      // idempotente: no vuelve a respaldar
      expect(['GASTOS', 'CATALOGO'].map(n => JSON.stringify(b.ss.getSheetByName(n)!.rows))).toEqual(otras)
      const d = b.post('data', { fresh: true }).data
      expect(d.fondos.map((f: unknown[]) => [f[0], f[1], f[2], f[6], f[8], f[9], f[10]])).toEqual([
        ['f-sodexo', 'Sodexo', 280, true, 'mensual', '', 'Sodexo'], ['f-extra1', 'Extra 1', 1000, true, 'unica', '2026-10', '']])
    })

    it('upsert por ID (doble clic no duplica), conserva Creado en, valida y desactiva sin borrar', () => {
      const a = fondo({ id: 'f-extra1', nombre: 'Extra 1', monto: 1000, recurrencia: 'unica', mes: '2026-10' })
      const b2 = fondo({ id: 'f-extra1', nombre: 'Extra 1', monto: 1000, recurrencia: 'unica', mes: '2026-10' })
      expect(b.ss.getSheetByName('FONDOS_PRESUPUESTO')!.rows.slice(1).filter(r => r[0] === 'f-extra1')).toHaveLength(1)
      expect(b2.data[11]).toBe(a.data[11])
      expect(fondo({ id: 'f-otra', nombre: ' extra  1 ' }).error.message).toMatch(/Ya existe un fondo/)
      expect(fondo({ id: 'f-x', nombre: '' }).error.code).toBe('VALIDATION')
      expect(fondo({ id: 'f-x', monto: -5 }).error.code).toBe('VALIDATION')
      expect(fondo({ id: 'f-x', moneda: 'EUR' }).error.message).toMatch(/no permitida/)
      expect(fondo({ id: 'f-x', moneda: 'pen' }).error.code).toBe('VALIDATION')
      expect(fondo({ id: 'f-x', mes: '2026-13' }).error.code).toBe('VALIDATION')
      expect(fondo({ id: 'f-x', recurrencia: 'unica', mes: '' }).error.code).toBe('VALIDATION')
      expect(fondo({ id: 'f x!' }).error.code).toBe('VALIDATION')
      expect(fondo({ id: 'f-usd', nombre: 'Dólares', moneda: 'USD' }).ok).toBe(true)
      // v1.16: varias fondos (activas) pueden compartir un medio; la clave es el ID, no el medio
      expect(fondo({ id: 'f-s1', nombre: 'Sodexo', medioPago: 'Sodexo' }).ok).toBe(true)
      expect(fondo({ id: 'f-s2', nombre: 'Sodexo 2', medioPago: 'sodexo' }).ok).toBe(true)
      expect(fondo({ id: 'f-s2', nombre: 'Sodexo 2', medioPago: 'sodexo', activo: false }).ok).toBe(true)
      // un fondo con varios medios: se guardan separados por "|", sin repetidos ni 'Libre'
      expect(fondo({ id: 'f-m', nombre: 'Multi', medioPago: ' Yape | plin |YAPE|Libre' }).data[10]).toBe('Yape|plin')
      expect(fondo({ id: 'f-m', nombre: 'Multi', medioPago: 'Libre' }).data[10]).toBe('')
      expect(b.post('saveMedio', { nombre: 'A|B' }).error.code).toBe('VALIDATION')
      const off = fondo({ id: 'f-extra1', nombre: 'Extra 1', monto: 1000, recurrencia: 'unica', mes: '2026-10', activo: false })
      expect(off.data[6]).toBe(false)
      expect(b.post('data', { fresh: true }).data.fondos.some((f: unknown[]) => f[0] === 'f-extra1')).toBe(true)
    })

    it('importes por mes: upsert por fondo+mes+modo, no pisa otros meses, quitar borra solo ese ajuste', () => {
      fondo({ id: 'f-extra1', nombre: 'Extra 1', monto: 1000, recurrencia: 'unica', mes: '2026-10' })
      const mes = (o: Record<string, unknown>) => b.post('saveFondoMes', { fondoId: 'f-extra1', modo: 'solo', ...o })
      expect(mes({ mes: '2026-12', monto: 500 }).ok).toBe(true)
      expect(mes({ mes: '2026-11', monto: 0 }).ok).toBe(true)
      expect(mes({ mes: '2026-12', monto: 600 }).ok).toBe(true)          // re-guardar = actualizar
      expect(mes({ mes: '2026-12', monto: 700, modo: 'desde' }).ok).toBe(true)
      expect(mes({ mes: '2026-1', monto: 1 }).error.code).toBe('VALIDATION')
      expect(mes({ mes: '2026-10', monto: -1 }).error.code).toBe('VALIDATION')
      expect(b.post('saveFondoMes', { fondoId: 'nada', mes: '2026-10', monto: 1 }).error.code).toBe('NOT_FOUND')
      let d = b.post('data', { fresh: true }).data
      expect(d.fondosMeses).toEqual([['f-extra1', '2026-12', 600, 'solo'], ['f-extra1', '2026-11', 0, 'solo'], ['f-extra1', '2026-12', 700, 'desde']])
      expect(mes({ mes: '2026-11', quitar: true }).data.quitado).toBe(true)
      d = b.post('data', { fresh: true }).data
      expect(d.fondosMeses).toEqual([['f-extra1', '2026-12', 600, 'solo'], ['f-extra1', '2026-12', 700, 'desde']])
    })

    it('reordenar en una escritura', () => {
      fondo({ id: 'f-a', nombre: 'A' }); fondo({ id: 'f-b', nombre: 'B' }); fondo({ id: 'f-c', nombre: 'C' })
      const sh = b.ss.getSheetByName('FONDOS_PRESUPUESTO')!
      const w = sh.writes
      expect(b.post('reorderFondos', { ids: ['f-c', 'f-a'] }).ok).toBe(true)
      expect(sh.writes - w).toBe(1)
      expect(['f-a', 'f-b', 'f-c'].map(id => sh.rows.find(r => r[0] === id)![7])).toEqual([2, 3, 1])
    })

  })

  describe('v1.9 atajo de iPhone', () => {
    const atajo = (action: string, payload: unknown, token = b.props.get('ATAJO_TOKEN')!) =>
      JSON.parse(b.g.doPost({ postData: { contents: JSON.stringify({ token, action, payload }) } }).body)
    const ok = { clave: 'atajo-20261010-1234', ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Almuerzo', monto: '25.5', moneda: 'PEN', medioPago: 'Yape', fecha: '2026-10-10' }

    it('sin token creado está deshabilitado; el token de la web no sirve para el atajo ni el del atajo para la web', () => {
      expect(atajo('atajoCatalogo', {}, b.props.get('API_TOKEN')!).error.code).toBe('NOT_ENABLED')
      ;(b.g as unknown as { crearTokenAtajo: () => string }).crearTokenAtajo()
      expect(atajo('atajoCatalogo', {}, b.props.get('API_TOKEN')!).error.code).toBe('UNAUTHORIZED')
      expect(b.post('data', {}, b.props.get('ATAJO_TOKEN')!).error.code).toBe('UNAUTHORIZED')
      expect(b.post('saveGasto', gasto(), b.props.get('ATAJO_TOKEN')!).error.code).toBe('UNAUTHORIZED')
      expect(atajo('atajoCatalogo', {}).ok).toBe(true)
    })

    it('catálogo: solo activos, dependiente por ámbito y categoría, "Otros" al final, sin movimientos', () => {
      ;(b.g as unknown as { crearTokenAtajo: () => string }).crearTokenAtajo()
      b.post('saveGasto', gasto())
      b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Cena', activo: false })
      b.post('saveMedio', { nombre: 'Plin', activo: false })
      const c = atajo('atajoCatalogo', {}).data
      expect(Object.keys(c).sort()).toEqual(['ambitos', 'categorias', 'hoy', 'medios', 'moneda', 'monedas', 'subcategorias', 'version'])
      expect(JSON.stringify(c)).not.toContain('11111111-2222')                 // ningún gasto ni ID de movimiento
      expect(c.ambitos).toEqual(['Personal', 'Trabajo', 'Pareja', 'Familia', 'Amigos'])
      expect(c.categorias.Personal).toContain('Alimentación')
      const subs = c.subcategorias['Personal|Alimentación']
      expect(subs).toContain('Almuerzo')
      expect(subs).not.toContain('Cena')
      expect(subs.at(-1)).toBe('Otros')
      expect(c.subcategorias['Familia|Bebé']).toContain('Pañales')
      expect(c.medios).not.toContain('Plin')
      expect(c.medios.at(-1)).toBe('Otros')
      expect(c.monedas).toEqual(['PEN', 'USD'])
    })

    it('registrar: valida todo contra el catálogo, una escritura, origen "atajo"; la misma clave no duplica', () => {
      ;(b.g as unknown as { crearTokenAtajo: () => string }).crearTokenAtajo()
      const sh = b.ss.getSheetByName('GASTOS')!
      const r1 = atajo('atajoGasto', ok)
      expect(r1.ok).toBe(true)
      expect(r1.data.estado).toBe('registrado')
      expect(r1.data.mensaje).toContain('S/ 25.50')
      const filas = () => sh.rows.slice(1).filter(x => x[13])
      expect(filas()).toHaveLength(1)
      expect(filas()[0].slice(0, 12)).toEqual(['2026-10-10', 25.5, 'PEN', 'Alimentación', 'Almuerzo', 'Almuerzo', 'Yape', 'Variable', 'Personal', false, 'Activo', 'atajo'])
      const r2 = atajo('atajoGasto', ok)                                         // reintento / doble toque
      expect(r2.data.estado).toBe('ya-registrado')
      expect(r2.data.id).toBe(r1.data.id)
      expect(filas()).toHaveLength(1)
      expect(atajo('atajoGasto', { ...ok, clave: 'atajo-20261010-9999', descripcion: 'Menú del día' }).data.estado).toBe('registrado')
      expect(filas()).toHaveLength(2)
      // la web lo ve igual que cualquier gasto
      expect(b.post('data', { fresh: true }).data.gastos).toHaveLength(2)
    })

    it('rechaza datos inválidos sin escribir', () => {
      ;(b.g as unknown as { crearTokenAtajo: () => string }).crearTokenAtajo()
      const sh = b.ss.getSheetByName('GASTOS')!
      const w = sh.writes
      const bad = (o: Record<string, unknown>) => atajo('atajoGasto', { ...ok, ...o }).error
      expect(bad({ clave: 'x' }).code).toBe('VALIDATION')
      expect(bad({ ambito: 'Nada' }).message).toMatch(/Ámbito no válido/)
      expect(bad({ categoria: 'Bebé' }).message).toMatch(/Categoría no válida para Personal/)
      expect(bad({ subcategoria: 'Pañales' }).message).toMatch(/Subcategoría no válida/)
      expect(bad({ medioPago: 'Bitcoin' }).message).toMatch(/Medio de pago no válido/)
      expect(bad({ moneda: 'EUR' }).message).toMatch(/Moneda no permitida/)
      for (const m of ['0', '-3', 'abc', '1.234', '']) expect(bad({ monto: m }).code).toBe('VALIDATION')
      expect(bad({ fecha: '2026-02-30' }).code).toBe('VALIDATION')
      expect(sh.writes).toBe(w)
      expect(atajo('atajoGasto', { ...ok, monto: '12,40', fecha: '' }).data.mensaje).toContain('S/ 12.40')
    })

    it('token inválido repetido bloquea SOLO a los inválidos: el atajo legítimo sigue entrando (S-03); revocar deshabilita', () => {
      ;(b.g as unknown as { crearTokenAtajo: () => string }).crearTokenAtajo()
      for (let i = 0; i < 10; i++) expect(atajo('atajoCatalogo', {}, 'atj_malo').error.code).toBe('UNAUTHORIZED')
      expect(atajo('atajoCatalogo', {}, 'atj_malo').error.code).toBe('LOCKED')   // el undécimo inválido ya no se procesa
      expect(atajo('atajoCatalogo', {}).ok).toBe(true)                            // el token correcto NO queda bloqueado
      expect(atajo('atajoGasto', ok).ok).toBe(true)
      b.cache.delete('atajo:fallos')
      expect(atajo('atajoCatalogo', {}).ok).toBe(true)
      ;(b.g as unknown as { revocarTokenAtajo: () => void }).revocarTokenAtajo()
      expect(atajo('atajoCatalogo', {}, 'atj_x').error.code).toBe('NOT_ENABLED')
    })
  })

  it('respaldos: van a la carpeta "Backup" junto a la hoja (la crea una vez); la carpeta se puede cambiar y volver', () => {
    const r1 = b.post('backup')
    expect(r1.ok).toBe(true)
    expect(r1.data.carpeta).toBe('Backup')
    const backup = b.folders.microApps.children.find(c => c.name === 'Backup')!
    expect(backup.files).toHaveLength(1)
    b.post('backup')
    expect(b.folders.microApps.children.filter(c => c.name === 'Backup')).toHaveLength(1)   // no crea otra carpeta
    expect(backup.files).toHaveLength(2)
    expect(b.folders.root.files).toHaveLength(0)                                            // nada en Mi unidad
    expect(b.post('carpetaRespaldo').data).toMatchObject({ nombre: 'Backup', personalizada: false })
    // cambiar por enlace de Drive
    const otra = b.post('saveCarpetaRespaldo', { carpeta: 'https://drive.google.com/drive/folders/folder-otra-0000001?usp=sharing' })
    expect(otra.data).toMatchObject({ nombre: 'Respaldos personales', personalizada: true })
    b.post('backup')
    expect(b.folders.otra.files).toHaveLength(1)
    // inválida o inexistente: no cambia nada
    expect(b.post('saveCarpetaRespaldo', { carpeta: 'hola mundo' }).error.code).toBe('VALIDATION')
    expect(b.post('saveCarpetaRespaldo', { carpeta: 'https://drive.google.com/drive/folders/noexiste123456' }).error.code).toBe('NOT_FOUND')
    expect(b.post('carpetaRespaldo').data.nombre).toBe('Respaldos personales')
    // vacío = volver a la de junto a la hoja
    expect(b.post('saveCarpetaRespaldo', { carpeta: '' }).data).toMatchObject({ nombre: 'Backup', personalizada: false })
    b.post('backup')
    expect(backup.files).toHaveLength(3)
  })

  it('datos de prueba jul–sep: ≥20 gastos por mes, todas las casuísticas de salud, y borrarDatosPrueba deja todo como estaba', async () => {
    b.post('saveGasto', gasto())                                                               // un gasto "real" que no se debe tocar
    const fotos = () => JSON.stringify([...b.ss.sheets.entries()].map(([n, sh]) => [n, sh.rows.filter(r => r.some(v => v !== '' && v !== undefined))]))
    const antes = fotos()
    const gen = b.g as unknown as { generarCasosEspecialesPrueba: () => Record<string, number>; borrarDatosPrueba: () => Record<string, number> }
    const r = gen.generarCasosEspecialesPrueba()
    expect(r.gastos).toBeGreaterThanOrEqual(75)
    expect(() => gen.generarCasosEspecialesPrueba()).toThrow(/Ya hay datos de prueba/)              // no duplica
    const api = createApi(async (action, payload) => { const x = b.post(action, payload); if (!x.ok) throw new Error(x.error.message); return x.data })
    const d = await api.getData(true)
    const porMes = (m: string) => d.gastos.filter(x => x.origen === 'prueba' && x.fecha.startsWith(m)).length
    for (const m of ['2026-07', '2026-08', '2026-09']) expect(porMes(m)).toBeGreaterThanOrEqual(20)
    const plantillas = await api.getPlantillas()
    const vinculos = new Map(d.vinculos!)
    const rates = { ...ratesFromConfig(d.config), USD: 3.7 }
    const sep = { preset: 'custom' as const, desde: '2026-09-01', hasta: '2026-09-30', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }
    const ago = { ...sep, desde: '2026-08-01', hasta: '2026-08-31' }
    // Compromisos: cubiertos, parciales, pendientes, sin monto (estimado / por confirmar), en USD y con exceso
    const est = (f: typeof sep) => Object.fromEntries(calcularCompromisos({ gastos: d.gastos, plantillas, vinculos, desde: f.desde, hasta: f.hasta, base: 'PEN', rates })
      .items.filter(i => i.plantilla.descripcion.includes('(prueba)')).map(i => [i.plantilla.descripcion, estadoCompromiso(i)]))
    expect(est(sep)).toMatchObject({ 'Luz (prueba)': 'parcial', 'Internet (prueba)': 'cubierto', 'Gimnasio (prueba)': 'pendiente', 'Seguro auto (prueba)': 'pagado-estimado',
      'Cuidado infantil (prueba)': 'pendiente', 'Claude (prueba)': 'cubierto', 'Netflix (prueba)': 'cubierto' })
    expect(est(ago)).toMatchObject({ 'Gimnasio (prueba)': 'parcial', 'Seguro auto (prueba)': 'por-confirmar', 'Luz (prueba)': 'cubierto' })
    // Calidad de datos: integridad, clasificación inválida e histórica, catálogo repetido y duplicados
    const calidad = (f: typeof sep) => evaluarCalidad({ gastos: d.gastos, f, catalogo: d.catalogo, medios: d.medios, monedas: ['PEN', 'USD'], revisiones: [] })
    const cs = calidad(sep), ca = calidad(ago), cj = calidad({ ...sep, desde: '2026-07-01', hasta: '2026-07-31' })
    const problemas = new Set([...cs.conProblemas, ...ca.conProblemas, ...cj.conProblemas].flatMap(x => x.problemas))
    for (const pr of ['id', 'id-repetido', 'fecha', 'monto', 'moneda', 'ambito', 'medio', 'estado']) expect(problemas.has(pr as never), pr).toBe(true)
    expect(cs.invalidas.some(x => x.c.sugerencia?.ambito === 'Familia')).toBe(true)
    expect(cj.historicas.length).toBeGreaterThan(0)
    expect(cs.catalogo.some(x => x.tipo === 'repetida')).toBe(true)
    expect(ca.similares.length).toBeGreaterThanOrEqual(1)
    expect(cs.indice!).toBeLessThan(100)
    // Presupuesto por fondo de prueba (sep excedido) y evolución con cambios entre meses
    const ctx = { base: 'PEN', rates, today: '2026-10-12', fondos: d.fondos, fondosMeses: d.fondosMeses }
    const aSep = aggregate(d.gastos, sep, ctx)
    expect(aSep.presupuesto.fondos.find(x => x.fondo.id === 'f-prueba-presupuesto')!.aporta).toBe(150000)
    expect(aSep.presupuesto.disponible).toBeLessThan(0)
    const evo = compararPeriodos({ gastos: d.gastos, f: sep, actual: { desde: sep.desde, hasta: sep.hasta }, anterior: { desde: ago.desde, hasta: ago.hasta }, nivel: 'categoria', base: 'PEN', rates })
    expect(evo.hayHistorial).toBe(true)
    expect(evo.aumentaron.some(f => f.nombre === 'Alimentación')).toBe(true)
    expect(evo.disminuyeron.length + evo.aumentaron.length).toBeGreaterThan(2)
    // borrar: vuelve exactamente al estado anterior (el gasto real queda intacto)
    const out = gen.borrarDatosPrueba()
    expect(out.gastos).toBe(r.gastos)
    expect(fotos()).toBe(antes)
    expect(b.props.get('PRUEBA_DATOS')).toBeUndefined()
  })

  it('reorderGastos: guarda el orden en su propia hoja sin tocar GASTOS', () => {
    b.post('saveGasto', gasto())
    const antes = JSON.stringify(b.ss.getSheetByName('GASTOS')!.rows)
    const a = '11111111-2222-4333-8444-555555555555', c = 'cccccccc-0000-4000-8000-000000000001'
    b.post('reorderGastos', { ids: [c, a] })
    b.post('reorderGastos', { ids: [a, c] })
    expect(b.post('data', { fresh: true }).data.ordenGastos).toEqual([[c, 2], [a, 1]])
    expect(JSON.stringify(b.ss.getSheetByName('GASTOS')!.rows)).toBe(antes)
    expect(b.post('reorderGastos', { ids: ['pl-x'] }).error.code).toBe('VALIDATION')
  })

  it('setup se detiene si una hoja tiene encabezados distintos (no sobrescribe)', () => {
    b.ss.getSheetByName('ORDEN_GASTOS')!.rows[0] = ['otra', 'cosa']
    expect(() => b.g.setup()).toThrow(/encabezados distintos/)
  })

  it('rechaza token inválido', () => {
    expect(b.post('data', {}, 'malo').error.code).toBe('UNAUTHORIZED')
  })

  it('el GET de salud no expone datos', () => {
    const r = JSON.parse(b.g.doGet().body)
    expect(r.ok).toBe(true)
    expect(r.data.gastos).toBeUndefined()
  })

  it('crea un gasto y un reintento con el mismo ID no lo duplica', () => {
    expect(b.post('saveGasto', gasto()).ok).toBe(true)
    const again = b.post('saveGasto', gasto())
    expect(again.ok).toBe(true)
    expect(b.ss.getSheetByName('GASTOS')!.rows).toHaveLength(2)
    expect(b.post('data').data.gastos).toHaveLength(1)
  })

  it('edita, anula y restaura conservando la fecha de creación', () => {
    const created = b.post('saveGasto', gasto()).data
    const upd = b.post('saveGasto', gasto({ mode: 'update', monto: 30, descripcion: 'Cena' })).data
    expect(upd[1]).toBe(30)
    expect(upd[14]).toBe(created[14])
    expect(b.post('setEstado', { id: gasto().id, estado: 'Anulado' }).ok).toBe(true)
    expect(b.post('data').data.gastos[0][10]).toBe('Anulado')
    b.post('setEstado', { id: gasto().id, estado: 'Activo' })
    expect(b.post('data').data.gastos[0][10]).toBe('Activo')
  })

  it('eliminación masiva: todo o nada, baja lógica recuperable y sin tocar otros gastos', () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
    ids.forEach(id => b.post('saveGasto', gasto({ id })))
    const estados = () => b.post('data', { fresh: true }).data.gastos.map((r: unknown[]) => [r[13], r[10]])
    // un ID inexistente → error y ningún cambio
    expect(b.post('setEstadoLote', { ids: [ids[0], '99999999-9999-4999-8999-999999999999'], estado: 'Anulado' }).error.code).toBe('NOT_FOUND')
    expect(estados().every((e: unknown[]) => e[1] === 'Activo')).toBe(true)
    // validaciones
    expect(b.post('setEstadoLote', { ids: [], estado: 'Anulado' }).error.code).toBe('VALIDATION')
    expect(b.post('setEstadoLote', { ids: [ids[0], ids[0]], estado: 'Anulado' }).error.code).toBe('VALIDATION')
    expect(b.post('setEstadoLote', { ids: [ids[0]], estado: 'Borrado' }).error.code).toBe('VALIDATION')
    // lote válido: solo los elegidos pasan a Anulado
    expect(b.post('setEstadoLote', { ids: [ids[0], ids[2]], estado: 'Anulado' }).ok).toBe(true)
    expect(estados()).toEqual([[ids[0], 'Anulado'], [ids[1], 'Activo'], [ids[2], 'Anulado']])
    // se puede restaurar
    expect(b.post('setEstadoLote', { ids: [ids[0], ids[2]], estado: 'Activo' }).ok).toBe(true)
    expect(estados().every((e: unknown[]) => e[1] === 'Activo')).toBe(true)
    // repetir el mismo lote es idempotente
    b.post('setEstadoLote', { ids: [ids[1]], estado: 'Anulado' }); b.post('setEstadoLote', { ids: [ids[1]], estado: 'Anulado' })
    expect(estados()[1]).toEqual([ids[1], 'Anulado'])
  })

  it('P3: buscar un gasto por ID no lee la columna entera (TextFinder) y el comportamiento no cambia', () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
    ids.forEach(id => b.post('saveGasto', gasto({ id })))
    const sh = b.ss.getSheetByName('GASTOS')!
    sh.colReads = 0
    expect(b.post('setEstado', { id: ids[1].toUpperCase(), estado: 'Anulado' }).ok).toBe(true)         // sin distinguir mayúsculas, como antes
    const t0 = Date.now(); while (Date.now() === t0) { /* el alta y la edición deben tener marcas de tiempo distintas */ }
    expect(b.post('saveGasto', gasto({ id: ids[0], mode: 'update', monto: 33 })).data[1]).toBe(33)
    expect(b.post('saveGasto', gasto({ id: ids[0], monto: 44 })).data[1]).toBe(33)                     // reintento de alta tras una edición: gana lo guardado, sin duplicar
    expect(sh.colReads).toBe(0)
    expect(b.post('data', { fresh: true }).data.gastos.map((r: unknown[]) => [r[13], r[10]])).toEqual([[ids[0], 'Activo'], [ids[1], 'Anulado']])
    expect(b.post('setEstado', { id: '99999999-9999-4999-8999-999999999999', estado: 'Anulado' }).error.code).toBe('NOT_FOUND')
  })

  it('P3: eliminar/restaurar en lote escribe en bloque (no celda por celda)', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`)
    ids.forEach(id => b.post('saveGasto', gasto({ id })))
    const sh = b.ss.getSheetByName('GASTOS')!
    const antes = sh.writes
    for (const t0 = Date.now(); Date.now() - t0 < 3;) { /* garantiza una marca de tiempo distinta a la del alta */ }
    expect(b.post('setEstadoLote', { ids: [ids[1], ids[4], ids[7]], estado: 'Anulado' }).ok).toBe(true)
    expect(sh.writes - antes).toBeLessThanOrEqual(2)                                                  // antes: 2 escrituras por gasto
    const est = b.post('data', { fresh: true }).data.gastos.map((r: unknown[]) => r[10])
    expect(est).toEqual(['Activo', 'Anulado', 'Activo', 'Activo', 'Anulado', 'Activo', 'Activo', 'Anulado'])
    const act = b.post('data', { fresh: true }).data.gastos.map((r: unknown[]) => r[15])
    expect(act[1]).toBe(act[4]); expect(act[1]).toBe(act[7]); expect(act[0]).not.toBe(act[1])           // solo cambia "actualizado" de los elegidos
  })

  it('valida entradas en el límite de confianza', () => {
    const bad = (over: Record<string, unknown>) => b.post('saveGasto', gasto(over)).error?.code
    expect(bad({ monto: -1 })).toBe('VALIDATION')
    expect(bad({ monto: 0 })).toBe('VALIDATION')
    expect(bad({ fecha: '2026-02-30' })).toBe('VALIDATION')
    expect(bad({ moneda: 'soles' })).toBe('VALIDATION')
    expect(bad({ categoria: '' })).toBe('VALIDATION')
    expect(bad({ tipoGasto: 'Otro' })).toBe('VALIDATION')
    expect(bad({ id: '../../x' })).toBe('VALIDATION')
    expect(bad({ comprobanteUrl: 'javascript:alert(1)' })).toBe('VALIDATION')
    expect(b.post('saveGasto', gasto({ mode: 'update', id: '99999999-2222-4333-8444-555555555555' })).error.code).toBe('NOT_FOUND')
    expect(b.post('saveConfig', { clave: 'API_TOKEN', valor: 'x' }).error.code).toBe('VALIDATION')
  })

  it('neutraliza textos que Sheets interpretaría como fórmula', () => {
    b.post('saveGasto', gasto({ descripcion: '=IMPORTXML("http://x")' }))
    expect(b.ss.getSheetByName('GASTOS')!.rows[1][5]).toBe("'=Importxml(\"http://X\")")
    expect(b.post('data').data.gastos[0][5]).toBe('=Importxml("http://X")')
  })

  it('usa caché en lecturas y la invalida tras escribir', () => {
    expect(b.post('data').data.cache).toBe(false)
    expect(b.post('data').data.cache).toBe(true)
    b.post('saveGasto', gasto())
    const after = b.post('data').data
    expect(after.cache).toBe(false)
    expect(after.gastos).toHaveLength(1)
  })

  it('Actualizar (fresh) salta la caché y ve ediciones hechas a mano en la hoja', () => {
    b.post('data')
    b.ss.getSheetByName('GASTOS')!.rows.push(['2026-10-01', 9, 'PEN', 'Comida', '', 'a mano', 'Yape', 'Variable', 'Personal', false, 'Activo', 'manual', '', 'manual-1', '', ''])
    expect(b.post('data').data.gastos).toHaveLength(0)
    expect(b.post('data', { fresh: true }).data.gastos).toHaveLength(1)
  })

  it('una lectura que termina después de una escritura no deja caché vieja', () => {
    const g = b.g as unknown as Record<string, (...a: unknown[]) => unknown>
    const gen = g.cacheGen_()
    const staleData = { gastos: [] }
    g.invalidateCache_() // ocurre una escritura mientras la lectura estaba en curso
    g.writeCache_(staleData, gen)
    expect(g.readCache_(g.cacheGen_())).toBeNull()
  })

  it('una lectura completa toca la hoja una vez por pestaña, no por fila', () => {
    for (let i = 0; i < 50; i++) b.post('saveGasto', gasto({ id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}` }))
    const sheet = b.ss.getSheetByName('GASTOS')!
    const spy = { n: 0 }
    const orig = sheet.getRange.bind(sheet)
    sheet.getRange = ((...a: Parameters<typeof orig>) => { spy.n++; return orig(...a) }) as typeof sheet.getRange
    b.cache.clear()
    expect(b.post('data').data.gastos).toHaveLength(50)
    expect(spy.n).toBe(1)
  })

  it('responde BUSY si no obtiene el lock y no escribe', () => {
    b.setLock(false)
    expect(b.post('saveGasto', gasto()).error.code).toBe('BUSY')
    expect(b.ss.getSheetByName('GASTOS')!.rows).toHaveLength(1)
  })

  it('catálogo, medios y configuración hacen upsert sin duplicar; las acciones de cajas ya no existen', () => {
    b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Almuerzo', activo: true })
    b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Almuerzo', activo: false })
    b.post('saveMedio', { nombre: 'yape', activo: false })
    for (const a of ['saveCaja', 'deleteCaja', 'reorderCajas', 'savePresupuesto', 'migrarGeneralAFondo']) expect(b.post(a, { id: 'auto' }).error.code).toBe('BAD_ACTION')
    b.post('saveConfig', { clave: 'tipo_cambio_USD', valor: '3.75' })
    const d = b.post('data').data
    expect(d.catalogo.filter((c: unknown[]) => c[0] === 'Personal' && c[2] === 'Almuerzo')).toEqual([['Personal', 'Alimentación', 'Almuerzo', false, '', '', 10102]])
    expect(d.medios.find((m: unknown[]) => String(m[0]).toLowerCase() === 'yape')[1]).toBe(false)
    expect(d.medios).toHaveLength(6)
    expect(d.medios[0][0]).toBe('Yape')
    expect(d.config.tipo_cambio_USD).toBe('3.75')
  })

  describe('v1.12 medios de pago con icono y color', () => {
    it('la hoja nace con Icono y Color y los medios iniciales traen su aspecto', () => {
      const sh = b.ss.getSheetByName('MEDIOS_PAGO')!
      expect(sh.rows[0]).toEqual(['Nombre', 'Activo', 'Icono', 'Color'])
      expect(sh.rows[1]).toEqual(['Yape', true, 'smartphone', '#7B3FA0'])
      const d = b.post('data', { fresh: true }).data
      expect(d.medios[2]).toEqual(['Sodexo', true, 'ticket', '#D2463C'])
    })

    it('saveMedio guarda icono y color, valida y conserva lo guardado al solo activar/desactivar', () => {
      const r = b.post('saveMedio', { nombre: 'Lemon', activo: true, icono: 'rocket', color: '#112233' })
      expect(r.data).toEqual(['Lemon', true, 'rocket', '#112233'])
      expect(b.ss.getSheetByName('MEDIOS_PAGO')!.rows.find(x => x[0] === 'Lemon')).toEqual(['Lemon', true, 'rocket', '#112233'])
      expect(b.post('saveMedio', { nombre: 'Lemon', activo: false }).data).toEqual(['Lemon', false, 'rocket', '#112233'])
      expect(b.post('saveMedio', { nombre: 'Lemon', activo: true, color: 'rojo' }).error.code).toBe('VALIDATION')
      expect(b.post('saveMedio', { nombre: 'Lemon', activo: true, icono: 'Cohete!' }).error.code).toBe('VALIDATION')
      // sin icono ni color la hoja no queda vacía: usa el predeterminado
      expect(b.post('saveMedio', { nombre: 'Tarjeta BCP' }).data).toEqual(['Tarjeta BCP', true, 'credit-card', '#475569'])
      expect(b.post('saveMedio', { nombre: 'Yape', color: '#000000' }).data).toEqual(['Yape', true, 'smartphone', '#000000'])
      expect(b.post('data', { fresh: true }).data.medios.find((m: unknown[]) => m[0] === 'Lemon')).toEqual(['Lemon', false, 'rocket', '#112233'])
    })

    it('hoja anterior de 2 columnas: se amplía al guardar y completarVacios rellena los vacíos sin pisar', () => {
      const sh = b.ss.getSheetByName('MEDIOS_PAGO')!
      sh.rows = [['Nombre', 'Activo'], ['Yape', true], ['Plin', true], ['Mi banco', true], ['Otros', true]]
      const d0 = b.post('data', { fresh: true }).data
      expect(d0.medios.map((m: unknown[]) => [m[0], m[2], m[3]])).toEqual([['Yape', '', ''], ['Plin', '', ''], ['Mi banco', '', ''], ['Otros', '', '']])
      b.post('saveMedio', { nombre: 'Plin', activo: true, icono: 'star', color: '#123456' })
      expect(sh.rows[0]).toEqual(['Nombre', 'Activo', 'Icono', 'Color'])
      const r = b.post('completarVacios', {}).data
      expect(r.medios).toBeGreaterThan(0)
      const filas = Object.fromEntries(sh.rows.slice(1).map(x => [x[0], [x[2], x[3]]]))
      expect(filas['Plin']).toEqual(['star', '#123456'])
      expect(filas['Yape']).toEqual(['smartphone', '#7B3FA0'])
      expect(filas['Mi banco']).toEqual(['wallet', '#64748B'])
      expect(b.post('completarVacios', {}).data.medios).toBe(0)
    })
  })

  describe('v1.12 funciones de mantenimiento desde la web', () => {
    beforeEach(() => { b.admin() })
    it('crearTokenAtajo / revocarTokenAtajo devuelven su respuesta y exigen el token de la web', () => {
      const r = b.post('crearTokenAtajo').data
      expect(r.token).toMatch(/^atj_[0-9a-f]{48}$/)
      expect(b.post('revocarTokenAtajo').data).toEqual({ revocado: true })
      expect(b.post('crearTokenAtajo', {}, 'malo').error.code).toBe('UNAUTHORIZED')
    })


    it('setup devuelve la URL de la hoja y el token; repararIds y generar/borrar datos de prueba responden sin BUSY', () => {
      const s = b.post('setup').data
      expect(s.apiToken).toBeTruthy()
      expect(s.hojas).toBeGreaterThan(5)
      expect(b.post('repararIds').error).toBeUndefined()
      const g = b.post('generarCasosEspecialesPrueba')
      expect(g.error, JSON.stringify(g.error)).toBeUndefined()
      expect(b.post('generarCasosEspecialesPrueba').error).toBeTruthy()            // ya hay datos de prueba
      const d = b.post('borrarDatosPrueba')
      expect(d.error, JSON.stringify(d.error)).toBeUndefined()
      expect(d.data.gastos).toBeGreaterThanOrEqual(0)
    })
  })

  describe('v1.12 sincronización con la hoja y administración de fondos/subcajas', () => {
    const fu = (id: string, nombre: string, orden: number, extra: Record<string, unknown> = {}) =>
      b.post('saveFondo', { id, nombre, monto: 100, moneda: 'PEN', color: '#1E3A8A', orden, recurrencia: 'mensual', mes: '', ...extra })

    it('una edición manual en la hoja se ve con fresh:true y NO se queda en la caché; la lectura normal sigue siendo la del servidor', () => {
      for (const [id, n, o] of [['f-1', 'General', 1], ['f-2', 'Sodexo', 2], ['f-3', 'Carpeta Tesis', 3], ['f-4', 'Viaje a Ica', 4], ['f-5', 'hola', 5], ['f-6', 'bono', 6]] as const) fu(id, n, o)
      expect(b.post('data', { fresh: true }).data.fondos).toHaveLength(6)
      b.post('data')                                           // llena la caché
      const sh = b.ss.getSheetByName('FONDOS_PRESUPUESTO')!
      // El usuario borra "hola" y "bono" directamente en Google Sheets (sin pasar por la web).
      for (const id of ['f-5', 'f-6']) sh.deleteRow(sh.rows.findIndex(r => r[0] === id) + 1)
      expect(b.post('data').data.fondos).toHaveLength(6)      // caché del servidor: por eso la web ya no la usa al abrir
      const fresco = b.post('data', { fresh: true }).data
      expect(fresco.fondos.map((f: unknown[]) => f[1])).toEqual(['General', 'Sodexo', 'Carpeta Tesis', 'Viaje a Ica'])
      expect(b.post('data').data.fondos).toHaveLength(4)      // y la lectura fresca renueva la caché
    })

    it('cambios manuales: monto, TRUE/FALSE, orden, alta externa y borrado de varias filas se reflejan por ID', () => {
      fu('f-1', 'General', 1); fu('f-2', 'Sodexo', 2); fu('f-3', 'Tesis', 3); fu('f-4', 'Ica', 4)
      const sh = b.ss.getSheetByName('FONDOS_PRESUPUESTO')!
      const fila = (id: string) => sh.rows.find(r => r[0] === id)!
      fila('f-2')[2] = 282.9          // monto
      fila('f-3')[6] = false          // activo
      fila('f-1')[7] = 9              // orden
      sh.rows.push(['f-9', 'Alta manual', 55, 'PEN', '#16A085', 'auto', true, 5, 'mensual', '', 'Libre', '', ''])
      sh.deleteRow(sh.rows.findIndex(r => r[0] === 'f-4') + 1)
      const d = b.post('data', { fresh: true }).data.fondos as unknown[][]
      expect(d.map(f => f[0]).sort()).toEqual(['f-1', 'f-2', 'f-3', 'f-9'])
      expect(d.find(f => f[0] === 'f-2')![2]).toBe(282.9)
      expect(d.find(f => f[0] === 'f-3')![6]).toBe(false)
      expect(d.find(f => f[0] === 'f-1')![7]).toBe(9)
      expect(d.find(f => f[0] === 'f-9')!.slice(0, 11)).toEqual(['f-9', 'Alta manual', 55, 'PEN', '#16A085', '', true, 5, 'mensual', '', ''])
    })

    it('deleteFondo quita el fondo y sus importes por mes, es idempotente y no toca gastos ni otros fondos', () => {
      fu('f-1', 'General', 1); fu('f-2', 'Sodexo', 2, { medioPago: 'Sodexo' })
      b.post('saveFondoMes', { fondoId: 'f-2', mes: '2026-10', monto: 282.9, modo: 'solo' })
      b.post('saveFondoMes', { fondoId: 'f-1', mes: '2026-10', monto: 150, modo: 'solo' })
      b.post('saveGasto', gasto({ medioPago: 'Sodexo' }))
      const r = b.post('deleteFondo', { id: 'f-2' })
      expect(r.data).toEqual({ id: 'f-2', eliminada: true, ajustes: 1 })
      expect(b.post('deleteFondo', { id: 'f-2' }).data).toEqual({ id: 'f-2', eliminada: false, ajustes: 0 })
      const d = b.post('data', { fresh: true }).data
      expect(d.fondos.map((f: unknown[]) => f[0])).toEqual(['f-1'])
      expect(d.fondosMeses.map((m: unknown[]) => m[0])).toEqual(['f-1'])
      expect(d.gastos).toHaveLength(1)
      expect(b.post('deleteFondo', {}).error.code).toBe('VALIDATION')
      expect(b.post('deleteFondo', { id: 'f-1' }, 'malo').error.code).toBe('UNAUTHORIZED')
    })

    it('clonar = guardar otro fondo con ID nuevo: no copia gastos ni importes por mes y un reintento con el mismo ID no duplica', () => {
      fu('f-1', 'Sodexo', 1, { medioPago: 'Sodexo' })
      b.post('saveFondoMes', { fondoId: 'f-1', mes: '2026-10', monto: 300, modo: 'solo' })
      b.post('saveGasto', gasto({ medioPago: 'Sodexo' }))
      for (let n = 0; n < 3; n++) fu('f-copia', 'Sodexo (Copia)', 2, { activo: false })     // reintentos / doble clic
      const d = b.post('data', { fresh: true }).data
      expect(d.fondos.map((f: unknown[]) => f[1])).toEqual(['Sodexo', 'Sodexo (Copia)'])
      expect(d.fondos.find((f: unknown[]) => f[0] === 'f-copia')[6]).toBe(false)           // nace inactiva
      expect(d.fondosMeses.filter((m: unknown[]) => m[0] === 'f-copia')).toHaveLength(0)
      expect(d.gastos).toHaveLength(1)
      expect(fu('f-otra', 'sodexo (copia)', 3).error.code).toBe('VALIDATION')              // el nombre sigue siendo único
    })

    it('el orden y el ON/OFF de los fondos se guardan en la hoja y sobreviven a una lectura fresca', () => {
      fu('f-1', 'A', 1); fu('f-2', 'B', 2); fu('f-3', 'C', 3)
      b.post('reorderFondos', { ids: ['f-3', 'f-1', 'f-2'] })
      fu('f-2', 'B', 3, { activo: false })
      const d = b.post('data', { fresh: true }).data
      const orden = (xs: unknown[][], k: number) => [...xs].sort((x, y) => Number(x[k]) - Number(y[k])).map(x => x[0])
      expect(orden(d.fondos, 7)).toEqual(['f-3', 'f-1', 'f-2'])
      expect(d.fondos.find((f: unknown[]) => f[0] === 'f-2')[6]).toBe(false)
      expect(b.ss.getSheetByName('FONDOS_PRESUPUESTO')!.rows.find(r => r[0] === 'f-2')![6]).toBe(false)   // TRUE/FALSE real en la hoja
    })

  })

  describe('v1.15 categorías: orden manual y eliminación segura', () => {
    const cat = () => (b.post('data', { fresh: true }).data.catalogo as unknown[][])
    // Las categorías del catálogo inicial no tienen fila propia: su posición es la del menor Orden de sus filas.
    const ordenDe = (a: string) => {
      const min = new Map<string, number>()
      for (const r of cat()) if (r[0] === a && r[1]) min.set(r[1] as string, Math.min(min.get(r[1] as string) ?? Infinity, Number(r[6])))
      return [...min.entries()].sort((x, y) => x[1] - y[1]).map(x => x[0])
    }

    it('reorderCategorias reescribe solo la columna Orden del ámbito: IDs, activos, íconos y otros ámbitos no cambian', () => {
      const antes = cat()
      const familiaAntes = ordenDe('Familia')
      expect(familiaAntes.slice(0, 3)).toEqual(['Alimentación', 'Bebé', 'Hogar'])
      const r = b.post('reorderCategorias', { ambito: 'Familia', categorias: ['Hogar', 'Bebé', ...familiaAntes.filter(c => !['Hogar', 'Bebé'].includes(c))] })
      expect(r.error).toBeUndefined()
      expect(ordenDe('Familia').slice(0, 3)).toEqual(['Hogar', 'Bebé', 'Alimentación'])
      const despues = cat()
      expect(despues).toHaveLength(antes.length)
      // Nada distinto de Orden cambió, y los demás ámbitos quedaron idénticos.
      expect(despues.map(r => r.slice(0, 6))).toEqual(antes.map(r => r.slice(0, 6)))
      expect(despues.filter(r => r[0] !== 'Familia')).toEqual(antes.filter(r => r[0] !== 'Familia'))
      // Las subcategorías conservan su orden relativo dentro de su categoría.
      const subs = despues.filter(r => r[0] === 'Familia' && r[1] === 'Bebé' && r[2]).sort((x, y) => Number(x[6]) - Number(y[6])).map(r => r[2])
      expect(subs).toEqual(CATALOGO_INICIAL.Familia['Bebé'])
      // Es idempotente: repetir el mismo orden no cambia nada.
      expect(b.post('reorderCategorias', { ambito: 'Familia', categorias: ordenDe('Familia') }).data.cambios).toBe(0)
    })

    it('desactivar una categoría sin fila propia crea su fila sin cambiarla de posición', () => {
      const antes = ordenDe('Personal')
      const medio = antes[1]
      expect(b.post('saveCatalogo', { ambito: 'Personal', categoria: medio, subcategoria: '', activo: false }).error).toBeUndefined()
      expect(ordenDe('Personal')).toEqual(antes)
      const fila = cat().find(r => r[0] === 'Personal' && r[1] === medio && r[2] === '')!
      expect(fila[3]).toBe(false)
      // Reactivar tampoco la mueve.
      b.post('saveCatalogo', { ambito: 'Personal', categoria: medio, subcategoria: '', activo: true })
      expect(ordenDe('Personal')).toEqual(antes)
    })

    it('el orden persiste tras releer y una categoría nueva se agrega al final de su ámbito', () => {
      b.post('reorderCategorias', { ambito: 'Personal', categorias: ['Salud', 'Auto'] })
      expect(ordenDe('Personal').slice(0, 2)).toEqual(['Salud', 'Auto'])
      b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Mascotas', subcategoria: '', activo: true })
      const o = ordenDe('Personal')
      expect(o.at(-1)).toBe('Mascotas')
      expect(o.slice(0, 2)).toEqual(['Salud', 'Auto'])
    })

    it('valida entradas y reporta ámbitos inexistentes', () => {
      expect(b.post('reorderCategorias', { ambito: 'Personal', categorias: [] }).error.code).toBe('VALIDATION')
      expect(b.post('reorderCategorias', { ambito: 'Nada', categorias: ['x'] }).error.code).toBe('NOT_FOUND')
      expect(b.post('reorderCategorias', { ambito: 'Personal', categorias: ['Salud'] }, 'malo').error.code).toBe('UNAUTHORIZED')
    })

    it('coincide con la versión del navegador (ordenTrasReordenarCategorias) para el mismo catálogo', async () => {
      const { ordenTrasReordenarCategorias } = await import('./lib/orden')
      const filas = cat().map(r => ({ ambito: r[0] as string, categoria: r[1] as string, subcategoria: r[2] as string, orden: r[6] === '' ? undefined : Number(r[6]) }))
      const pedido = ['Hogar', 'Servicios', 'Bebé']
      const esperado = ordenTrasReordenarCategorias(filas, 'Familia', pedido)
      b.post('reorderCategorias', { ambito: 'Familia', categorias: pedido })
      expect(cat().map(r => (r[6] === '' ? undefined : Number(r[6])))).toEqual(esperado)
    })

    it('deleteCategoria: sin dependencias y sin subcategorías se elimina de verdad; con subcategorías exige cascada autorizada', () => {
      b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Prueba', subcategoria: '', activo: true })
      expect(b.post('deleteCategoria', { ambito: 'Personal', categoria: 'Prueba' }).data).toMatchObject({ eliminada: true, subcategorias: 0 })
      expect(cat().some(r => r[0] === 'Personal' && r[1] === 'Prueba')).toBe(false)
      const e = b.post('deleteCategoria', { ambito: 'Personal', categoria: 'Salud' })
      expect(e.error.code).toBe('IN_USE')
      expect(e.error.message).toMatch(/subcategoría/)
      expect(cat().some(r => r[0] === 'Personal' && r[1] === 'Salud')).toBe(true)
      const ok = b.post('deleteCategoria', { ambito: 'Personal', categoria: 'Salud', cascada: true })
      expect(ok.data).toMatchObject({ eliminada: true, subcategorias: 5 })
      expect(cat().some(r => r[0] === 'Personal' && r[1] === 'Salud')).toBe(false)
      expect(cat().some(r => r[0] === 'Familia' && r[1] === 'Salud Familiar')).toBe(true)    // otros ámbitos intactos
      expect(b.post('deleteCategoria', { ambito: 'Personal', categoria: 'Salud', cascada: true }).data.eliminada).toBe(false)   // idempotente
      // Un fondo que cubre "Personal › Auto" la protege: no se puede eliminar aunque se pida la cascada.
      b.post('saveFondo', { id: 'f-auto', nombre: 'Auto', monto: 400, moneda: 'PEN', recurrencia: 'mensual', mes: '', reglas: [{ desde: '', medios: 'todos', listaMedios: [], cobertura: 'categoria', rutas: [{ ambito: 'Personal', categoria: 'Auto', subcategoria: '' }], restringeMedio: false }] })
      expect(b.post('deleteCategoria', { ambito: 'Personal', categoria: 'Auto', cascada: true }).error.message).toMatch(/1 fondo\(s\) del presupuesto/)
    })

    it('deleteCategoria se niega si hay gastos, plantillas (o compromisos) o fondos que la cubren, aunque se pida la cascada; los datos no cambian', () => {
      const total = () => b.ss.getSheetByName('CATALOGO')!.rows.length
      const n0 = total()
      b.post('saveGasto', gasto({ ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Luz' }))
      let e = b.post('deleteCategoria', { ambito: 'Familia', categoria: 'Servicios', cascada: true })
      expect(e.error.code).toBe('IN_USE'); expect(e.error.message).toMatch(/1 gasto/)
      b.post('deleteGasto', { id: gasto().id }); b.post('saveGasto', gasto({ estado: 'Anulado', ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Luz' }))
      b.post('savePlantilla', { id: 'pl-00000000-0000-4000-8000-000000000001', mode: 'create', ambito: 'Familia', categoria: 'Hogar', subcategoria: 'Limpieza', descripcion: 'Limpieza', monto: 10, moneda: 'PEN', medioPago: 'Yape', esCompromiso: true })
      e = b.post('deleteCategoria', { ambito: 'Familia', categoria: 'Hogar', cascada: true })
      expect(e.error.code).toBe('IN_USE'); expect(e.error.message).toMatch(/1 plantilla\(s\) \(1 compromiso/)
      // Una versión ANTERIOR de las reglas también cuenta: borrar la categoría dejaría ese mes sin cobertura.
      b.post('saveFondo', { id: 'f-edu', nombre: 'Salud', monto: 50, moneda: 'PEN', recurrencia: 'mensual', mes: '', reglas: [
        { desde: '', medios: 'todos', listaMedios: [], cobertura: 'categoria', rutas: [{ ambito: 'Familia', categoria: 'Salud Familiar', subcategoria: '' }], restringeMedio: false },
        { desde: '2026-11', medios: 'todos', listaMedios: [], cobertura: 'todos', rutas: [], restringeMedio: false }] })
      e = b.post('deleteCategoria', { ambito: 'Familia', categoria: 'Salud Familiar', cascada: true })
      expect(e.error.code).toBe('IN_USE'); expect(e.error.message).toMatch(/1 fondo/)
      expect(total()).toBe(n0)
      expect(b.post('data', { fresh: true }).data.gastos).toHaveLength(1)                    // ningún gasto se tocó
    })

    it('una categoría que existe también en otro ámbito se puede eliminar de uno aunque un fondo la cubra en "todos los ámbitos" (sigue funcionando en el otro)', () => {
      b.post('saveFondo', { id: 'f-alim', nombre: 'Alimentación', monto: 50, moneda: 'PEN', recurrencia: 'mensual', mes: '', reglas: [{ desde: '', medios: 'todos', listaMedios: [], cobertura: 'categoria', rutas: [{ ambito: '', categoria: 'Alimentación', subcategoria: '' }], restringeMedio: false }] })
      const r = b.post('deleteCategoria', { ambito: 'Amigos', categoria: 'Alimentación', cascada: true })
      expect(r.error).toBeUndefined()
      expect(r.data.eliminada).toBe(true)
      expect(cat().some(x => x[0] === 'Personal' && x[1] === 'Alimentación')).toBe(true)
    })

    it('desactivar una categoría o un ámbito solo cambia su fila: las subcategorías conservan su estado y reactivar lo restablece', () => {
      b.post('saveCatalogo', { ambito: 'Familia', categoria: 'Hogar', subcategoria: 'Limpieza', activo: false })
      b.post('saveCatalogo', { ambito: 'Familia', categoria: 'Hogar', subcategoria: '', activo: false })
      let c = cat().filter(r => r[0] === 'Familia' && r[1] === 'Hogar')
      expect(c.find(r => !r[2])![3]).toBe(false)
      expect(c.find(r => r[2] === 'Limpieza')![3]).toBe(false)
      expect(c.find(r => r[2] === 'Supermercado')![3]).toBe(true)
      b.post('saveCatalogo', { ambito: 'Familia', categoria: 'Hogar', subcategoria: '', activo: true })
      c = cat().filter(r => r[0] === 'Familia' && r[1] === 'Hogar')
      expect(c.find(r => !r[2])![3]).toBe(true)
      expect(c.find(r => r[2] === 'Limpieza')![3]).toBe(false)     // respeta el estado individual anterior
      b.post('saveCatalogo', { ambito: 'Amigos', categoria: '', subcategoria: '', activo: false })
      expect(cat().filter(r => r[0] === 'Amigos' && r[1]).every(r => r[3] === true)).toBe(true)
    })

    it('desactivar un medio de pago no toca los gastos que lo usan', () => {
      b.post('saveGasto', gasto({ medioPago: 'Plin' }))
      b.post('saveMedio', { nombre: 'Plin', activo: false })
      const d = b.post('data', { fresh: true }).data
      expect(d.medios.find((m: unknown[]) => m[0] === 'Plin')[1]).toBe(false)
      expect(d.gastos[0][6]).toBe('Plin')
    })
  })
})

describe('plantillas de fondos (v1.17)', () => {
  let b: ReturnType<typeof load>
  beforeEach(() => { b = load(); b.g.setup() })
  const fondo = (o: Record<string, unknown> = {}) => b.post('saveFondo', { id: 'f-general', nombre: 'General', monto: 3500, moneda: 'PEN', color: '#1E3A8A', orden: 1, recurrencia: 'mensual', mes: '', ...o })
  const plF = (o: Record<string, unknown> = {}) => b.post('savePlantillaFin', { id: 'pf-1', tipo: 'fondo', nombre: 'Aporte de Pareja', monto: 1000, moneda: 'PEN', medios: '', recurrencia: 'mensual', ...o })
  const plG = (o: Record<string, unknown> = {}) => b.post('savePlantillaFin', { id: 'ps-1', tipo: 'fondo', nombre: 'General mensual', monto: 3500, moneda: 'PEN', medios: '', recurrencia: 'mensual', origenId: 'f-general', ...o })
  const meses = () => datos().fondosMeses.map((m: unknown[]) => m.slice(0, 3))
  const datos = () => b.post('data', { fresh: true }).data
  const snapshot = () => { const d = datos(); return JSON.stringify({ f: d.fondos, fm: d.fondosMeses, c: d.cajas, p: d.presupuestos, g: d.gastos }) }

  it('A: una plantilla desde un fondo existente crea la definición vinculada, no otro fondo', () => {
    fondo()
    const antes = snapshot()
    const r = plF({ id: 'pf-g', nombre: 'General (plantilla)', monto: 3500, origenId: 'f-general' })
    expect(r.ok).toBe(true)
    expect(r.data[14]).toBe('f-general')
    expect(snapshot()).toBe(antes)                                    // I: presupuesto, fondos, cajas y gastos idénticos
    expect(datos().plantillasFin).toHaveLength(1)
  })

  it('v1.29: la plantilla guarda la configuración completa y al aplicarla crea el fondo con sus reglas (idempotente)', () => {
    const datos29 = { tipo: 'ahorro_asignado', vigencia: '', regla: { medios: 'solo', listaMedios: ['Sodexo'], cobertura: 'categoria', rutas: [{ ambito: 'Personal', categoria: 'Alimentación', subcategoria: '' }], restringeMedio: true } }
    const r = plF({ id: 'pf-v29', nombre: 'Almuerzos', monto: 280, medios: 'Sodexo', datos: datos29 })
    expect(r.ok).toBe(true)
    expect(r.data[18]).toMatchObject({ tipo: 'ahorro_asignado', regla: { medios: 'solo', cobertura: 'categoria', restringeMedio: true } })
    const aplicar = () => b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: 'pf-v29', accion: 'aplicar', monto: 280 }] })
    expect(aplicar().ok).toBe(true)
    expect(aplicar().ok).toBe(true)                                                   // reintento: sin duplicados
    const fs = datos().fondos.filter((f: unknown[]) => f[1] === 'Almuerzos')
    expect(fs).toHaveLength(1)
    expect(fs[0][13]).toBe('ahorro_asignado')
    expect(JSON.parse(fs[0][14])[0]).toMatchObject({ medios: 'solo', listaMedios: ['Sodexo'], cobertura: 'categoria', restringeMedio: true })
    // validaciones: medios "solo" sin lista, restricción con cobertura "todos" y tipo inválido se rechazan
    expect(plF({ id: 'pf-m1', nombre: 'M1', datos: { tipo: 'mensual', vigencia: '', regla: { medios: 'solo', listaMedios: [], cobertura: 'todos', rutas: [], restringeMedio: false } } }).ok).toBe(false)
    expect(plF({ id: 'pf-m2', nombre: 'M2', datos: { tipo: 'mensual', vigencia: '', regla: { medios: 'solo', listaMedios: ['Yape'], cobertura: 'todos', rutas: [], restringeMedio: true } } }).ok).toBe(false)
    expect(plF({ id: 'pf-m3', nombre: 'M3', datos: { tipo: 'otro', vigencia: '' } }).ok).toBe(false)
    // una plantilla de 1.28 (sin datos) sigue funcionando y no guarda configuración extra
    expect(plF({ id: 'pf-old', nombre: 'Vieja' }).data[18]).toBeNull()
  })

  it('no duplica la plantilla de un mismo registro ni por nombre', () => {
    fondo()
    plF({ id: 'pf-g', nombre: 'General (plantilla)', origenId: 'f-general' })
    const dup = plF({ id: 'pf-otra', nombre: 'Otro nombre', origenId: 'f-general' })
    expect(dup.ok).toBe(false)
    expect(dup.error.code).toBe('DUPLICATE')
    expect(plF({ id: 'pf-n', nombre: 'general (PLANTILLA)' }).ok).toBe(false)
    expect(plF({ id: 'pf-x', origenId: 'no-existe' }).ok).toBe(false)
    expect(datos().plantillasFin).toHaveLength(1)
  })

  it('C: aplicar 450 en noviembre solo modifica noviembre y es idempotente (D)', () => {
    fondo()
    plG()
    const r1 = b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: 'ps-1', accion: 'aplicar', monto: 450 }] })
    expect(r1.ok).toBe(true)
    expect(meses()).toEqual([['f-general', '2026-11', 450]])
    expect(datos().fondos.find((f: unknown[]) => f[0] === 'f-general')[2]).toBe(3500)   // el habitual no cambia
    const w = b.ss.getSheetByName('FONDOS_PRESUPUESTO_MESES')!.writes, nFondos = datos().fondos.length
    b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: 'ps-1', accion: 'aplicar', monto: 450 }] })
    b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: 'ps-1', accion: 'aplicar', monto: 450 }] })
    expect(b.ss.getSheetByName('FONDOS_PRESUPUESTO_MESES')!.writes).toBe(w)           // la repetición no escribe
    expect(meses()).toHaveLength(1)
    expect(datos().fondos).toHaveLength(nFondos)                              // no se duplicó el fondo
    const est = datos().plantillasFin[0][15]
    expect(est['2026-11']).toEqual({ e: 'aplicada', m: 450 })
  })

  it('aplicar con el mismo importe habitual antes del corte no escribe; desde el corte deja constancia; cambiar el importe actualiza sin duplicar', () => {
    fondo(); plG()
    b.post('aplicarPlantillasFin', { mes: '2026-12', items: [{ id: 'ps-1', accion: 'aplicar', monto: 3500 }] })
    expect(meses()).toEqual([['f-general', '2026-12', 3500]])    // v1.19: desde el corte, aplicar SIEMPRE deja constancia del mes
    b.post('aplicarPlantillasFin', { mes: '2026-10', items: [{ id: 'ps-1', accion: 'aplicar', monto: 3500 }] })
    expect(meses()).toEqual([['f-general', '2026-12', 3500]])    // antes del corte (comportamiento histórico): mismo importe, sin escribir
    b.post('aplicarPlantillasFin', { mes: '2026-12', items: [{ id: 'ps-1', accion: 'aplicar', monto: 500 }] })
    b.post('aplicarPlantillasFin', { mes: '2026-12', items: [{ id: 'ps-1', accion: 'aplicar', monto: 520 }] })
    expect(meses()).toEqual([['f-general', '2026-12', 520]])
  })

  it('volver a Pendiente restaura lo que había antes; omitir no escribe importes', () => {
    fondo(); plG()
    b.post('saveFondoMes', { fondoId: 'f-general', mes: '2026-11', modo: 'solo', monto: 380 })      // ajuste manual previo
    b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: 'ps-1', accion: 'aplicar', monto: 450 }] })
    expect(meses()).toEqual([['f-general', '2026-11', 450]])
    b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: 'ps-1', accion: 'pendiente' }] })
    expect(meses()).toEqual([['f-general', '2026-11', 380]])
    expect(datos().plantillasFin[0][15]['2026-11']).toBeUndefined()
    b.post('aplicarPlantillasFin', { mes: '2026-10', items: [{ id: 'ps-1', accion: 'omitir' }] })
    expect(datos().plantillasFin[0][15]['2026-10'].e).toBe('omitida')
    expect(meses()).toEqual([['f-general', '2026-11', 380]])
  })

  it('plantilla de fondo sin fondo enlazado: la crea una sola vez con ID estable y solo ajusta ese mes', () => {
    fondo()
    plF({ monto: 1000 })
    const total = () => datos().fondos.length
    b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: 'pf-1', accion: 'aplicar', monto: 1200 }] })
    expect(total()).toBe(2)
    const f = datos().fondos.find((x: unknown[]) => x[1] === 'Aporte de Pareja')
    expect(f[0]).toBe('f-pf-1'); expect(f[2]).toBe(1000); expect(f[9]).toBe('2026-11')
    expect(datos().fondosMeses).toEqual([['f-pf-1', '2026-11', 1200, 'solo']])
    b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: 'pf-1', accion: 'aplicar', monto: 1200 }] })
    b.post('aplicarPlantillasFin', { mes: '2026-12', items: [{ id: 'pf-1', accion: 'aplicar', monto: 1000 }] })
    expect(total()).toBe(2)
    expect(datos().fondosMeses).toEqual([['f-pf-1', '2026-11', 1200, 'solo'], ['f-pf-1', '2026-12', 1000, 'solo']])   // v1.19: cada mes aplicado deja su propia fila
    expect(datos().plantillasFin.find((p: unknown[]) => p[0] === 'pf-1')[14]).toBe('f-pf-1')
  })

  it('lote todo o nada: una plantilla inválida o inactiva no aplica ninguna', () => {
    fondo(); plF({ origenId: 'f-general', nombre: 'General plantilla', monto: 3500 })
    b.post('savePlantillaFin', { id: 'ps-1', tipo: 'fondo', nombre: 'Inactiva', monto: 400, moneda: 'PEN', medios: '', recurrencia: 'mensual', activo: false })
    const antes = snapshot()
    const r = b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: 'pf-1', accion: 'aplicar', monto: 3600 }, { id: 'ps-1', accion: 'aplicar', monto: 450 }] })
    expect(r.ok).toBe(false)
    expect(snapshot()).toBe(antes)
    expect(b.post('aplicarPlantillasFin', { mes: '2026-13', items: [{ id: 'pf-1' }] }).ok).toBe(false)
  })

  it('E: clonar crea una definición nueva sin vínculo, sin fondo, sin gastos ni dinero', () => {
    fondo(); plG()
    const antes = snapshot()
    expect(plG({ id: 'ps-copia', nombre: 'General mensual (Copia)', origenId: '' }).ok).toBe(true)
    const pls = datos().plantillasFin
    expect(pls).toHaveLength(2)
    expect(pls.find((p: unknown[]) => p[0] === 'ps-copia')[14]).toBe('')
    expect(snapshot()).toBe(antes)
  })

  it('G: un reintento con el mismo ID no duplica la plantilla; H: el orden persiste sin tocar datos', () => {
    plF(); plF(); expect(datos().plantillasFin).toHaveLength(1)
    plF({ id: 'pf-2', nombre: 'Sodexo' }); plF({ id: 'pf-3', nombre: 'Extra' })
    const antes = snapshot()
    expect(b.post('reorderPlantillasFin', { tipo: 'fondo', ids: ['pf-3', 'pf-1', 'pf-2'] }).ok).toBe(true)
    const orden = datos().plantillasFin.sort((a: unknown[], c: unknown[]) => (a[13] as number) - (c[13] as number)).map((p: unknown[]) => p[0])
    expect(orden).toEqual(['pf-3', 'pf-1', 'pf-2'])
    expect(snapshot()).toBe(antes)
  })

  it('eliminar una plantilla solo borra la definición (no el fondo ni lo aplicado)', () => {
    fondo(); plG()
    b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: 'ps-1', accion: 'aplicar', monto: 450 }] })
    expect(b.post('deletePlantillaFin', { id: 'ps-1' }).data.eliminada).toBe(true)
    expect(b.post('deletePlantillaFin', { id: 'ps-1' }).data.eliminada).toBe(false)     // idempotente
    expect(datos().plantillasFin).toHaveLength(0)
    expect(datos().fondos.some((f: unknown[]) => f[0] === 'f-general')).toBe(true)
    expect(meses()).toEqual([['f-general', '2026-11', 450]])
  })
})

describe('normalización de descripciones en el backend (v1.19)', () => {
  let b: ReturnType<typeof load>
  beforeEach(() => { b = load(); b.g.setup(); configurarExcepciones('') })
  const CASOS = ['arroz con pollo', 'ARROZ CON POLLO', 'tallarines al horno con papa a la huancaina', 'PAGO DE INTERNET PARA LA CASA', 'seguro de mi papa',
    'compra para mi hija', 'luz y agua de la casa', 'suscripcion de netflix', 'gastos de viaje a ica', 'papa rellena', 'pago de chatgpt plus', 'FUNDA PARA IPHONE',
    '  bebé   y   mamá 🎉 ', 'recarga 4g (30 días), plan "max"', 'menú del día: s/ 12.50', 'de compras con el equipo', 'regalo para ella', 'llamada api', 'año nuevo', '', '   ']
  const gs = (t: string) => (b.g as unknown as Record<string, (x: string) => string>).normalizarDescripcion_(t)

  it('el backend y el frontend producen exactamente el mismo resultado (y es idempotente)', () => {
    for (const t of CASOS) {
      expect(gs(t), JSON.stringify(t)).toBe(formatearDescripcion(t))
      expect(gs(gs(t))).toBe(gs(t))
    }
  })

  it('crear, editar y clonar un gasto guardan la descripción normalizada en la hoja, sin tocar lo demás', () => {
    const id = 'bbbbbbbb-0000-4000-8000-000000000001', id2 = 'bbbbbbbb-0000-4000-8000-000000000002'
    const r = b.post('saveGasto', gasto({ id, descripcion: 'ARROZ CON POLLO' }))
    expect(r.ok).toBe(true)
    const fila = () => b.ss.getSheetByName('GASTOS')!.rows[1]
    expect(fila()[5]).toBe('Arroz con Pollo')
    const antes = [...fila()]
    b.post('saveGasto', gasto({ id, mode: 'update', descripcion: 'pago de internet para la casa' }))
    expect(fila()[5]).toBe('Pago de Internet para la Casa')
    expect(fila().filter((_, i) => i !== 5 && i !== 14 && i !== 15)).toEqual(antes.filter((_, i) => i !== 5 && i !== 14 && i !== 15))   // monto, fecha, moneda, categoría, medio, ID: iguales
    b.post('saveGasto', gasto({ id: id2, descripcion: 'tallarines al horno con papa a la huancaina' }))   // clonar = crear con otro ID
    expect(b.ss.getSheetByName('GASTOS')!.rows[2][5]).toBe('Tallarines al Horno con papa a la Huancaina')
    expect(b.ss.getSheetByName('GASTOS')!.rows).toHaveLength(3)
  })

  it('gastos por lote, plantilla de gasto y plantilla financiera normalizan igual', () => {
    const g = (n: number, d: string) => ({ ...gasto({ id: `bbbbbbbb-0000-4000-8000-00000000010${n}`, descripcion: d }), mode: undefined })
    const lb = b.post('saveGastosBatch', { loteId: 'lote-00000000-0000-4000-8000-000000000009', gastos: [g(1, 'LUZ Y AGUA'), g(2, 'seguro de mi papa')] }); expect(lb.error).toBeUndefined()
    const rows = b.ss.getSheetByName('GASTOS')!.rows
    expect([rows[1][5], rows[2][5]]).toEqual(['Luz y Agua', 'Seguro de mi Papa'])
    const pl = b.post('savePlantilla', { id: 'pl-11111111-2222-4333-8444-555555555555', mode: 'create', ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Internet', descripcion: 'PAGO DE INTERNET' })
    expect(pl.data[4]).toBe('Pago de Internet')
    const pf = b.post('savePlantillaFin', { id: 'pf-aaaaaaaa-0000-4000-8000-000000000001', tipo: 'fondo', nombre: 'Auto', monto: 250, moneda: 'PEN', medios: '', recurrencia: 'mensual', descripcion: 'MANTENIMIENTO DEL AUTO' })
    expect(pf.ok).toBe(true)
    expect(b.ss.getSheetByName('PLANTILLAS_FINANCIERAS')!.rows.at(-1)![8]).toBe('Mantenimiento del Auto')
  })

  it('las excepciones configuradas en CONFIG aplican en el backend y no reescriben registros antiguos', () => {
    const id = 'bbbbbbbb-0000-4000-8000-000000000001'
    b.post('saveGasto', gasto({ id, descripcion: 'Cena' }))
    b.post('saveConfig', { clave: 'desc_excepciones', valor: 'Pollo a la Brasa' })
    expect(gs('cena de pollo a la brasa')).toBe('Cena de Pollo a la Brasa')
    b.post('saveGasto', gasto({ id: 'bbbbbbbb-0000-4000-8000-000000000002', descripcion: 'cena de POLLO A LA BRASA' }))
    expect(b.ss.getSheetByName('GASTOS')!.rows[2][5]).toBe('Cena de Pollo a la Brasa')
    expect(b.ss.getSheetByName('GASTOS')!.rows[1][5]).toBe('Cena')   // el histórico no se toca
  })
})


describe('aislamiento mensual de fondos (v1.19)', () => {
  let b: ReturnType<typeof load>
  const datos = () => b.post('data').data
  beforeEach(() => {
    b = load(); b.g.setup()
    b.post('saveFondo', { id: 'f-general', nombre: 'General', monto: 3000, moneda: 'PEN', color: '#1e3a8a', icono: 'auto', recurrencia: 'mensual', mes: '2026-10', activo: true, medioPago: '', orden: 1 })
  })
  const efectivo = (mes: string) => {
    const d = datos()
    const f = d.fondos.map((r: unknown[]) => ({ id: r[0], mes: r[9], monto: r[2], recurrencia: r[8], nombre: r[1], moneda: r[3] }))
    return f.map((x: { id: string; mes: string; monto: number; recurrencia: string }) =>
      fondoMontoMes({ ...x, activo: true, orden: 0, color: '', icono: '', medioPago: '', creadoEn: '', actualizadoEn: '' } as never, mes,
        d.fondosMeses.map((m: unknown[]) => ({ fondoId: m[0], mes: m[1], monto: m[2], modo: m[3] })), aislaDesde({})).monto)
  }

  it('A. un fondo de octubre sigue en octubre (histórico intacto) y NO aparece en noviembre ni diciembre', () => {
    expect(efectivo('2026-10')).toEqual([3000])
    expect(efectivo('2026-09')).toEqual([0])           // antes de su mes de aplicación
    expect(efectivo('2026-11')).toEqual([0])
    expect(efectivo('2026-12')).toEqual([0])
  })

  it('B. aplicar a noviembre no cambia octubre ni diciembre; reaplicar no duplica; "desde" ya no arrastra', () => {
    b.post('aplicarEntidadesMes', { tipo: 'fondo', mes: '2026-11', items: [{ id: 'f-general', monto: 3500 }] })
    b.post('aplicarEntidadesMes', { tipo: 'fondo', mes: '2026-11', items: [{ id: 'f-general', monto: 3500 }] })
    expect(datos().fondosMeses).toEqual([['f-general', '2026-11', 3500, 'solo']])
    expect(efectivo('2026-10')).toEqual([3000]); expect(efectivo('2026-11')).toEqual([3500]); expect(efectivo('2026-12')).toEqual([0])
  })

  it('todo o nada: un ID inexistente o un monto inválido no escribe nada; el consolidado no cambia', () => {
    const antes = JSON.stringify([datos().fondos, datos().fondosMeses, datos().cajas, datos().presupuestos])
    expect(b.post('aplicarEntidadesMes', { tipo: 'fondo', mes: '2026-11', items: [{ id: 'f-general', monto: 10 }, { id: 'nope', monto: 5 }] }).error.code).toBe('NOT_FOUND')
    expect(b.post('aplicarEntidadesMes', { tipo: 'fondo', mes: '2026-11', items: [{ id: 'f-general', monto: -1 }] }).error.code).toBe('VALIDATION')
    expect(b.post('aplicarEntidadesMes', { tipo: 'fondo', mes: '2026-13', items: [{ id: 'f-general', monto: 1 }] }).error.code).toBe('VALIDATION')
    expect(b.post('aplicarEntidadesMes', { tipo: 'subcaja', mes: '2026-11', items: [{ id: 'f-general', monto: 1 }] }).error.message).toMatch(/solo se aplican fondos/)
    expect(JSON.stringify([datos().fondos, datos().fondosMeses, datos().cajas, datos().presupuestos])).toBe(antes)
  })

  it('un mes con gastos y sin configuración conserva los gastos y muestra presupuesto 0 (sin dividir entre cero)', () => {
    b.post('saveGasto', gasto({ id: 'bbbbbbbb-0000-4000-8000-000000000001', fecha: '2026-11-05', categoria: 'Servicios', monto: 80 }))
    const d = datos()
    const gastos = d.gastos.length
    expect(gastos).toBe(1)
    expect(efectivo('2026-11')).toEqual([0])
  })
})

describe('planificación mensual y recordatorios en CONFIG (v1.19)', () => {
  let b: ReturnType<typeof load>
  const cfg = () => b.post('data').data.config as Record<string, string>
  beforeEach(() => { b = load(); b.g.setup() })
  it('guarda y recupera día por mes, estado de planificación y activación (persistencia entre dispositivos = releer la hoja)', () => {
    const anio = Array.from({ length: 12 }, (_, i) => `${i === 10 ? 2 : 1}:1`).join(',')
    expect(b.post('saveConfig', { clave: 'plan_dias_2026', valor: anio }).ok).toBe(true)
    expect(b.post('saveConfig', { clave: 'plan_est_2026-11', valor: 'e|100|' }).ok).toBe(true)
    expect(b.post('saveConfig', { clave: 'plan_activo', valor: 'true' }).ok).toBe(true)
    expect(b.post('saveConfig', { clave: 'plan_est_2026-11', valor: 'c|111|' }).ok).toBe(true)     // actualiza, no duplica
    expect(cfg().plan_dias_2026).toBe(anio); expect(cfg().plan_est_2026_11 ?? cfg()['plan_est_2026-11']).toBe('c|111|')
    const filas = b.ss.getSheetByName('CONFIG')!.rows.filter(r => r[0] === 'plan_est_2026-11')
    expect(filas).toHaveLength(1)
  })
  it('rechaza días inexistentes (febrero no bisiesto, 31 de abril), formatos raros y claves ajenas', () => {
    const base = (f: (i: number) => string) => Array.from({ length: 12 }, (_, i) => f(i)).join(',')
    expect(b.post('saveConfig', { clave: 'plan_dias_2027', valor: base(i => i === 1 ? '29:1' : '1:1') }).error.code).toBe('VALIDATION')
    expect(b.post('saveConfig', { clave: 'plan_dias_2028', valor: base(i => i === 1 ? '29:1' : '1:1') }).ok).toBe(true)   // bisiesto
    expect(b.post('saveConfig', { clave: 'plan_dias_2026', valor: base(i => i === 3 ? '31:1' : '1:1') }).error.code).toBe('VALIDATION')
    expect(b.post('saveConfig', { clave: 'plan_dias_2026', valor: '1:1,2:1' }).error.code).toBe('VALIDATION')
    expect(b.post('saveConfig', { clave: 'plan_est_2026-13', valor: 'p|000|' }).error.code).toBe('VALIDATION')
    expect(b.post('saveConfig', { clave: 'plan_est_2026-11', valor: 'x|000|' }).error.code).toBe('VALIDATION')
    expect(b.post('saveConfig', { clave: 'plan_dia', valor: '32' }).error.code).toBe('VALIDATION')
    expect(b.post('saveConfig', { clave: 'cualquier_cosa', valor: '1' }).error.code).toBe('VALIDATION')
  })
  it('cambiar la planificación no escribe nada financiero', () => {
    const antes = JSON.stringify(['FONDOS_PRESUPUESTO', 'FONDOS_PRESUPUESTO_MESES', 'ASIGNACIONES_GASTOS', 'GASTOS'].map(n => b.ss.getSheetByName(n)!.rows))
    b.post('saveConfig', { clave: 'plan_est_2026-11', valor: 'd|000|' })
    expect(JSON.stringify(['FONDOS_PRESUPUESTO', 'FONDOS_PRESUPUESTO_MESES', 'ASIGNACIONES_GASTOS', 'GASTOS'].map(n => b.ss.getSheetByName(n)!.rows))).toBe(antes)
  })
})

describe('plantillas de fondos: hoja propia e IDs reales (v1.19)', () => {
  let b: ReturnType<typeof load>
  beforeEach(() => { b = load(); b.g.setup() })
  const uuid = () => `pf-${crypto.randomUUID()}`                       // el ID que genera la web: 39 caracteres
  const plF = (o: Record<string, unknown> = {}) => b.post('savePlantillaFin', { id: uuid(), tipo: 'fondo', nombre: 'Aporte de Pareja', monto: 1000, moneda: 'PEN', medios: '', recurrencia: 'mensual', ...o })
  const datos = () => b.post('data', { fresh: true }).data
  const filas = (hoja: string) => (b.ss.getSheetByName(hoja)?.rows ?? []).slice(1)

  it('aplicar TODAS (3 fondos en un solo pedido) funciona, es idempotente y no duplica nada', () => {
    const f = ['A', 'B', 'C'].map(n => plF({ nombre: `Fondo ${n}`, monto: 100 }).data[0])
    const items = f.map(id => ({ id, accion: 'aplicar', monto: undefined }))
    const r1 = b.post('aplicarPlantillasFin', { mes: '2026-10', items })
    expect(r1.ok, JSON.stringify(r1)).toBe(true)
    const antes = JSON.stringify([datos().fondos, datos().fondosMeses])
    const r2 = b.post('aplicarPlantillasFin', { mes: '2026-10', items })
    expect(r2.ok).toBe(true)
    expect(JSON.stringify([datos().fondos, datos().fondosMeses])).toBe(antes)
    expect(datos().fondos).toHaveLength(3)
    expect(new Set(datos().fondos.map((c: unknown[]) => c[0])).size).toBe(3)
  })

  it('aplicar a noviembre (aislado) y a otro mes no se cruzan, también con IDs largos', () => {
    const id = plF().data[0]
    expect(b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id, accion: 'aplicar', monto: 800 }] }).ok).toBe(true)
    expect(b.post('aplicarPlantillasFin', { mes: '2026-12', items: [{ id, accion: 'aplicar', monto: 900 }] }).ok).toBe(true)
    const fid = datos().fondos.find((c: unknown[]) => c[1] === 'Aporte de Pareja')[0]
    expect(fid.length).toBeLessThanOrEqual(60)
    expect(datos().fondosMeses.filter((p: unknown[]) => p[0] === fid).map((p: unknown[]) => p.slice(0, 3)).sort()).toEqual([[fid, '2026-11', 800], [fid, '2026-12', 900]])
  })

  it('los fondos se guardan en PLANTILLAS_FINANCIERAS con su Tipo; una plantilla de subcaja nueva se rechaza', () => {
    const f = plF().data[0], s = plF({ nombre: 'Otro' }).data[0]
    expect(b.post('savePlantillaFin', { id: uuid(), tipo: 'subcaja', nombre: 'Mascotas', monto: 700, campo: 'Categoría', valor: 'Mascotas' }).error.code).toBe('VALIDATION')
    expect(filas('PLANTILLAS_FINANCIERAS').map(r => [r[0], r[1]])).toEqual([[f, 'fondo'], [s, 'fondo']])
    expect(b.ss.getSheetByName('PLANTILLAS_FINANCIERAS')!.rows[0]).toContain('Tipo')
    for (const h of ['PLANTILLAS_FONDOS_PRESUPUESTO', 'PLANTILLAS_SUBCAJAS', 'PLANTILLAS_MENSUALES']) expect(b.ss.getSheetByName(h)).toBeNull()
    expect(datos().plantillasFin.map((p: unknown[]) => p[0]).sort()).toEqual([f, s].sort())
  })

  it('el estado aplicada/omitida queda en la fila de cada plantilla y sobrevive a una nueva lectura', () => {
    const s = plF({ nombre: 'Otro' }).data[0], f = plF().data[0]
    b.post('aplicarPlantillasFin', { mes: '2026-10', items: [{ id: s, accion: 'aplicar', monto: 700 }, { id: f, accion: 'omitir' }] })
    const fila = (id: string) => filas('PLANTILLAS_FINANCIERAS').find(r => r[0] === id)!
    expect(JSON.parse(String(fila(s)[15]))['2026-10'].e).toBe('aplicada')
    expect(JSON.parse(String(fila(f)[15]))['2026-10'].e).toBe('omitida')
    const d = datos().plantillasFin
    expect(d.find((p: unknown[]) => p[0] === s)[15]['2026-10'].e).toBe('aplicada')
  })

  it('eliminar y reordenar actúan por Tipo (una fila subcaja antigua no se toca); el ID no puede cambiar de tipo', () => {
    const f1 = plF().data[0], f2 = plF({ nombre: 'Sodexo' }).data[0], s = uuid()
    b.ss.getSheetByName('PLANTILLAS_FINANCIERAS')!.rows.push([s, 'subcaja', 'Mascotas', 700, '', '', 'Categoría', 'Mascotas', '', '#1e3a8a', 'auto', 'mensual', true, 7, '', '', '', '', ''])
    expect(b.post('reorderPlantillasFin', { tipo: 'fondo', ids: [f2, f1] }).ok).toBe(true)
    expect(filas('PLANTILLAS_FINANCIERAS').find(r => r[0] === f2)![13]).toBe(1)
    expect(filas('PLANTILLAS_FINANCIERAS').find(r => r[0] === s)![13]).toBe(7)
    expect(b.post('deletePlantillaFin', { id: s }).data.eliminada).toBe(false)     // las subcajas antiguas ni se leen ni se borran
    expect(filas('PLANTILLAS_FINANCIERAS').map(r => r[1])).toEqual(['fondo', 'fondo', 'subcaja'])
    expect(b.post('savePlantillaFin', { id: f1, tipo: 'subcaja', nombre: 'X', monto: 1, campo: 'Categoría', valor: 'Y' }).ok).toBe(false)
  })

  it('una plantilla nueva no pisa ni duplica las existentes', () => {
    const f = plF().data[0]
    expect(plF({ id: f, monto: 1200 }).ok).toBe(true)                      // mismo ID: actualiza
    expect(filas('PLANTILLAS_FINANCIERAS')).toHaveLength(1)
    expect(Number(filas('PLANTILLAS_FINANCIERAS')[0][3])).toBe(1200)
    expect(plF({ nombre: 'aporte de pareja' }).ok).toBe(false)             // nombre repetido sigue prohibido
  })
})

describe('v1.20: el frontend deduce el mismo ID de entidad que crea el backend (idEntidadPlantilla ↔ pfIdSeguro_)', () => {
  let b: ReturnType<typeof load>
  beforeEach(() => { b = load(); b.g.setup() })
  const ids = ['pf-4e870b82-7519-44dc-b406-8bad102c664e', 'pf-f555815c-fb2d-48e5-9d08-5b4c07027f19', 'ps-1', 'pf-' + 'x'.repeat(58), 'pf-ok_con-guion']
  for (const tipo of ['fondo'] as const) {
    it(`${tipo}: crea la entidad con el ID que predice el frontend, y las plantillas aplicadas figuran «aplicadas» sin recalcular`, async () => {
      const { idEntidadPlantilla, estadoRealPlantilla, operacionPlantilla } = await import('./lib/planificar')
      ids.forEach((id, i) => {
        const r = b.post('savePlantillaFin', { id, tipo, nombre: `Fondo ${i}`, monto: 100 + i, moneda: 'PEN', medios: '', recurrencia: 'mensual' })
        expect(r.ok, JSON.stringify(r)).toBe(true)
      })
      expect(b.post('aplicarPlantillasFin', { mes: '2026-11', items: ids.map((id, i) => ({ id, accion: 'aplicar', monto: 100 + i })) }).ok).toBe(true)
      const fresco = b.post('data', { fresh: true }).data
      const entidades: string[] = fresco.fondos.map((x: unknown[]) => String(x[0]))
      ids.forEach(id => expect(entidades, id).toContain(idEntidadPlantilla({ id, tipo })))
      // Y con la lectura real (ya parseada por el frontend) el estado y la operación salen coherentes.
      const api = createApi(async (action, payload) => { const x = b.post(action, payload); if (!x.ok) throw new Error(x.error.message); return x.data })
      const parsed = await api.getData(true)
      const pls = parsed.plantillasFin ?? []
      expect(pls).toHaveLength(ids.length)
      for (const p of pls) {
        expect(estadoRealPlantilla(p, '2026-11', parsed)).toBe('aplicada')
        expect(operacionPlantilla(p, '2026-11', p.monto, parsed).op).toBe('sin_cambios')
        expect(operacionPlantilla(p, '2026-11', p.monto + 1, parsed).op).toBe('actualizar')
        expect(estadoRealPlantilla(p, '2026-12', parsed)).toBe('pendiente')
      }
    })
  }
})

describe('v1.20.1: aplicar plantillas cuando la hoja quedó con marcas «aplicada» pero sin el fondo (caso real)', () => {
  let b: ReturnType<typeof load>
  beforeEach(() => { b = load(); b.g.setup() })
  const F = 'pf-880ed1f8-57b4-44c3-a2f2-9981fc3dc2c4'
  const datos = () => b.post('data', { fresh: true }).data
  const vaciar = () => { for (const n of ['FONDOS_PRESUPUESTO', 'FONDOS_PRESUPUESTO_MESES']) { const sh = b.ss.getSheetByName(n)!; sh.rows.splice(1, sh.rows.length) } }
  for (const mes of ['2026-10', '2026-11']) {
    it(`${mes}: tras borrar FONDOS_PRESUPUESTO e importes del mes, volver a aplicar recrea todo y deja lo aplicado verificable`, async () => {
      b.post('savePlantillaFin', { id: F, tipo: 'fondo', nombre: 'General', monto: 3000, moneda: 'PEN', medios: '', recurrencia: 'mensual' })
      const items = [{ id: F, accion: 'aplicar', monto: 3000 }]
      expect(b.post('aplicarPlantillasFin', { mes, items }).ok).toBe(true)
      expect(datos().fondos).toHaveLength(1)
      vaciar()                                                         // las marcas «aplicada» de PLANTILLAS_FINANCIERAS siguen ahí
      expect(datos().fondos).toHaveLength(0)
      const r = b.post('aplicarPlantillasFin', { mes, items })
      expect(r.ok, JSON.stringify(r)).toBe(true)
      expect(datos().fondos).toHaveLength(1)
      const { createApi } = await import('./lib/api'), { verificarPlantillasAplicadas } = await import('./lib/planificar')
      const api = createApi(async (a, p) => { const x = b.post(a, p); if (!x.ok) throw new Error(x.error.message); return x.data })
      const fresco = await api.getData(true), pls = await api.getPlantillas()
      const problemas = verificarPlantillasAplicadas(fresco, pls.filter(p => p.id === F).map(p => ({ plantilla: p, monto: 3000 })), mes)
      expect(problemas).toEqual([])
      // Idempotente: una tercera vez no duplica ni escribe de más.
      b.post('aplicarPlantillasFin', { mes, items })
      expect(datos().fondos).toHaveLength(1)
    })
  }
  it('si solo falta el importe del mes (FONDOS_PRESUPUESTO_MESES vacía) en un mes aislado, también se reescribe', () => {
    b.post('savePlantillaFin', { id: F, tipo: 'fondo', nombre: 'General', monto: 3000, moneda: 'PEN', medios: '', recurrencia: 'mensual' })
    b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: F, accion: 'aplicar', monto: 650 }] })
    expect(datos().fondosMeses).toHaveLength(1)
    const sh = b.ss.getSheetByName('FONDOS_PRESUPUESTO_MESES')!; sh.rows.splice(1, sh.rows.length)
    b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: F, accion: 'aplicar', monto: 650 }] })
    expect(datos().fondosMeses).toEqual([[expect.any(String), '2026-11', 650, 'solo']])
  })
  it('una plantilla sana y ya aplicada sigue sin escribir nada (no hay regresión del atajo)', () => {
    b.post('savePlantillaFin', { id: F, tipo: 'fondo', nombre: 'General', monto: 3000, moneda: 'PEN', medios: '', recurrencia: 'mensual' })
    b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: F, accion: 'aplicar', monto: 3000 }] })
    const w = ['FONDOS_PRESUPUESTO', 'FONDOS_PRESUPUESTO_MESES', 'PLANTILLAS_FINANCIERAS'].map(n => b.ss.getSheetByName(n)!.writes)
    b.post('aplicarPlantillasFin', { mes: '2026-11', items: [{ id: F, accion: 'aplicar', monto: 3000 }] })
    expect(['FONDOS_PRESUPUESTO', 'FONDOS_PRESUPUESTO_MESES', 'PLANTILLAS_FINANCIERAS'].map(n => b.ss.getSheetByName(n)!.writes)).toEqual(w)
  })
})

describe('v1.26 revisión del presupuesto (backend)', () => {
  let b: ReturnType<typeof load>
  const mesActual = () => new Date().toISOString().slice(0, 7)
  const id = (n: number) => `rev-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const rev = (n: number, over: Record<string, unknown> = {}) => ({ id: id(n), periodo: mesActual(), estado: 'completo', pendientes: '', observacion: '', ...over })
  const snapshot = () => JSON.stringify(['GASTOS', 'FONDOS_PRESUPUESTO', 'FONDOS_PRESUPUESTO_MESES', 'CAJAS', 'PRESUPUESTOS', 'VINCULOS_PLANTILLAS', 'PLANTILLAS_FINANCIERAS', 'CONFIG', 'CATALOGO']
    .map(n => b.ss.getSheetByName(n)?.rows))
  beforeEach(() => { b = load(); b.g.setup() })

  it('guarda una revisión y la devuelve al recargar (persistencia real)', () => {
    const r = b.post('saveRevisionPresupuesto', rev(1, { estado: 'con_gastos_anteriores', pendientes: 'Almuerzos del 3 y 4', observacion: 'Falta el pasaje' }))
    expect(r.ok).toBe(true)
    expect(r.data.slice(0, 5)).toEqual([id(1), mesActual(), 'con_gastos_anteriores', 'Almuerzos del 3 y 4', 'Falta el pasaje'])
    expect(b.post('data', { fresh: true }).data.revisionesPresupuesto).toHaveLength(1)
  })

  it('guardar NO toca fondos, gastos, cajas, presupuestos, compromisos ni configuración', () => {
    b.post('saveGasto', gasto({ fecha: `${mesActual()}-01` }))
    const antes = snapshot()
    expect(b.post('saveRevisionPresupuesto', rev(1)).ok).toBe(true)
    expect(b.post('saveRevisionPresupuesto', rev(2, { estado: 'revisado_con_observaciones', observacion: 'ok' })).ok).toBe(true)
    expect(snapshot()).toBe(antes)
    expect(b.ss.getSheetByName('GASTOS')!.getLastRow()).toBe(2)
  })

  it('es idempotente por ID y no admite saldos: doble clic no duplica', () => {
    b.post('saveRevisionPresupuesto', rev(1)); b.post('saveRevisionPresupuesto', rev(1)); b.post('saveRevisionPresupuesto', rev(1))
    expect(b.post('data', {}).data.revisionesPresupuesto).toHaveLength(1)
    expect(b.ss.getSheetByName('REVISIONES_PRESUPUESTO')!.rows.slice(1).filter(r => r[0])).toHaveLength(1)
    expect(b.ss.getSheetByName('REVISIONES_PRESUPUESTO')!.rows[0].join('|')).not.toMatch(/saldo/i)
  })

  it('rechaza estado, período e ID inválidos, notas largas, peticiones sin token y escritura bloqueada', () => {
    expect(b.post('saveRevisionPresupuesto', rev(1, { estado: 'conciliada' })).error.code).toBe('VALIDATION')
    expect(b.post('saveRevisionPresupuesto', rev(1, { periodo: '2026-13' })).error.code).toBe('VALIDATION')
    expect(b.post('saveRevisionPresupuesto', rev(1, { id: 'x' })).error.code).toBe('VALIDATION')
    expect(b.post('saveRevisionPresupuesto', rev(1, { observacion: 'a'.repeat(501) })).error.code).toBe('VALIDATION')
    expect(b.post('saveRevisionPresupuesto', rev(1), 'token-malo').error.code).toBe('UNAUTHORIZED')
    b.setLock(false)
    expect(b.post('saveRevisionPresupuesto', rev(1)).error.code).toBe('BUSY')
    b.setLock(true)
    expect(b.post('data', { fresh: true }).data.revisionesPresupuesto).toHaveLength(0)
  })

  it('una nota que empieza con = no se interpreta como fórmula', () => {
    b.post('saveRevisionPresupuesto', rev(1, { observacion: '=HYPERLINK("x")' }))
    expect(b.ss.getSheetByName('REVISIONES_PRESUPUESTO')!.rows[1][4]).toBe("'=HYPERLINK(\"x\")")
  })
})

/* Contrato vigente: solo fondos y revisiones del presupuesto. */
describe('backend: contrato actual de fondos', () => {
  let b: ReturnType<typeof load>
  beforeEach(() => { b = load(); b.g.setup(); b.admin() })

  it('entrega las colecciones actuales sin estado de migración', () => {
    const r = b.post('data', { fresh: true })
    expect(r.ok).toBe(true)
    expect(r.data).toHaveProperty('fondos')
    expect(r.data).toHaveProperty('fondosMeses')
    expect(r.data).toHaveProperty('revisionesPresupuesto')
    expect(r.data).not.toHaveProperty('migracion')
  })

  it('guarda tipos de fondo explícitos y conserva el tipo al editar sin enviarlo', () => {
    const r = b.post('saveFondo', { id: 'f-ahorro', nombre: 'Ahorro viaje', monto: 500, moneda: 'PEN', recurrencia: 'mensual', tipo: 'ahorro_asignado', color: '#123456' })
    expect(r.ok).toBe(true)
    expect(r.data[13]).toBe('ahorro_asignado')
    expect(r.data[8]).toBe('mensual')
    expect(b.post('saveFondo', { id: 'f-x', nombre: 'X', monto: 1, moneda: 'PEN', recurrencia: 'mensual', tipo: 'otro' }).error.code).toBe('VALIDATION')
    expect(b.post('saveFondo', { id: 'f-ahorro', nombre: 'Ahorro viaje', monto: 600, moneda: 'PEN', recurrencia: 'mensual' }).data[13]).toBe('ahorro_asignado')
  })

  it('la simulación crea fondos con tipo vigente', () => {
    const r = b.post('generarCasosEspecialesPrueba')
    expect(r.ok).toBe(true)
    const d = b.post('data', { fresh: true })
    expect(d.ok).toBe(true)
    expect(d.data.fondos.every((f: unknown[]) => ['mensual', 'extra', 'ahorro_asignado'].includes(String(f[13])))).toBe(true)
  })
})

/**
 * Integración Web ↔ Code.gs ↔ Sheets con el esquema y los datos del Sheet de producción (leído en solo lectura el 2026-10-19).
 * La capa web real (createApi + zod) habla con el Code.gs real; la comprobación de persistencia se hace sobre las filas crudas de la hoja.
 */
describe('integración web ↔ Code.gs ↔ Sheets con el perfil de producción', () => {
  let b: ReturnType<typeof load>
  const api = () => createApi(async (action, payload) => { const x = b.post(action, payload); if (!x.ok) throw Object.assign(new Error(x.error.message), { code: x.error.code }); return x.data })
  const filas = (n: string) => b.ss.sheets.get(n)!.rows.slice(1).filter(r => r.some(v => v !== '' && v !== undefined))
  const FONDOS_PROD = [
    ['f-pf-880ed1f8-57b4-44c3-a2f2-9981fc3dc2c4', 'General', 3000, 'PEN', '#1e3a8a', 'auto', true, 1, 'mensual', '2026-10', 'Libre', '2026-10-15T20:59:26.873Z', '2026-10-15T20:59:26.873Z', 'mensual'],
    ['f-pf-ff3df993-1c66-4937-b70a-58fe76f74c8a', 'Aporte Pareja', 200, 'PEN', '#0B9EA8', 'auto', true, 2, 'mensual', '2026-10', 'Plin', '2026-10-15T20:59:32.641Z', '2026-10-19T21:00:31.399Z', 'mensual'],
    ['f-pf-d00c07b1-5fce-4228-b4ec-72bcaa0a0eec', 'Sodexo', 280, 'PEN', '#1e3a8a', 'auto', true, 3, 'mensual', '2026-10', 'Sodexo', '2026-10-15T20:59:38.128Z', '2026-10-15T20:59:38.128Z', 'mensual'],
    ['f-340b9ebe-953b-45c9-ab40-c52e2bb3974b', 'Carpeta Tésis', 1900, 'PEN', '#3B6FD9', 'auto', true, 4, 'unica', '2026-10', 'Transferencia', '2026-10-15T22:28:55.919Z', '2026-10-15T22:28:55.919Z', 'ahorro_asignado'],
    ['f-eda22309-23f1-4fb8-934e-85022ba5d799', 'Viaje a Ica', 1414, 'PEN', '#1E3A8A', 'auto', true, 5, 'unica', '2026-10', 'Libre', '2026-10-16T02:14:57.515Z', '2026-10-19T18:38:30.607Z', 'ahorro_asignado'],
  ]
  const CTX = (d: Awaited<ReturnType<ReturnType<typeof api>['getData']>>) => ({ base: 'PEN', rates: { USD: 4.07 }, today: '2026-10-19', fondos: d.fondos, fondosMeses: d.fondosMeses, asignaciones: d.asignaciones })
  const oct = { preset: 'custom' as const, desde: '2026-10-01', hasta: '2026-10-31', ambitos: [], categorias: [], subcategorias: [], medios: [], tipos: [] }

  beforeEach(() => {
    b = load(); b.g.setup()
    const sh = b.ss.sheets.get('FONDOS_PRESUPUESTO')!
    FONDOS_PROD.forEach((r, i) => { sh.rows[i + 1] = [...r] })
    b.ss.sheets.get('REVISIONES_PRESUPUESTO')!.rows[1] = ['rev-b4f10e20-002c-4c60-92cc-f85b78594319', '2026-10', 'revisado_con_observaciones', '', 'excedente por cuentas de meses atrás', '', '2026-10-19T21:49:35.524Z']
  })

  it('lee el esquema de producción: 5 fondos con tipos, la revisión existente, y octubre suma 3000+200+280+1900+1414', async () => {
    const d = await api().getData(true)
    expect(d.fondos.map(f => [f.nombre, f.tipo])).toEqual([['General', 'mensual'], ['Aporte Pareja', 'mensual'], ['Sodexo', 'mensual'], ['Carpeta Tésis', 'ahorro_asignado'], ['Viaje a Ica', 'ahorro_asignado']])
    expect(d.revisionesPresupuesto).toHaveLength(1)
    expect(d.revisionesPresupuesto[0]).toMatchObject({ periodo: '2026-10', estado: 'revisado_con_observaciones' })
    expect(aggregate([], oct, CTX(d)).presupuesto.presupuesto).toBe((3000 + 200 + 280 + 1900 + 1414) * 100)
  })

  it('crear → editar → anular → restaurar un gasto persiste en la hoja y se refleja en el cálculo, sin duplicar', async () => {
    const a = api()
    const g = { ...gasto({ id: 'aaaaaaaa-1111-4222-8333-444444444444', monto: 100, categoria: 'Alimentación', subcategoria: 'Almuerzo' }), mode: undefined } as never
    const creado = await a.saveGasto(g, 'create')
    expect(filas('GASTOS')).toHaveLength(1)
    await a.saveGasto(g, 'create')                                                          // reintento tras respuesta perdida: idempotente
    expect(filas('GASTOS')).toHaveLength(1)
    await a.saveGasto({ ...creado, monto: 150 } as never, 'update')
    expect(filas('GASTOS')[0][1]).toBe(150)
    let d = await a.getData(true)
    expect(aggregate(d.gastos, oct, CTX(d)).presupuesto.disponible).toBe((6794 - 150) * 100)
    await a.setEstado(creado.id, 'Anulado')
    d = await a.getData(true)
    expect(filas('GASTOS')[0][10]).toBe('Anulado')
    expect(aggregate(d.gastos, oct, CTX(d)).presupuesto.disponible).toBe(6794 * 100)
    await a.setEstado(creado.id, 'Activo')
    d = await a.getData(true)
    expect(aggregate(d.gastos, oct, CTX(d)).presupuesto.disponible).toBe((6794 - 150) * 100)
  })

  it('fondos: crear, editar, desactivar y modificar el importe de un mes persisten sin tocar los demás', async () => {
    const a = api()
    const antes = JSON.stringify(filas('FONDOS_PRESUPUESTO').slice(0, 5))
    const nuevo = await a.saveFondo({ id: 'f-nuevo', nombre: 'Extra prueba', monto: 100, moneda: 'PEN', color: '#112233', icono: '', activo: true, orden: 6, recurrencia: 'unica', mes: '2026-10', medioPago: '', tipo: 'extra' })
    expect(nuevo.tipo).toBe('extra')
    expect(filas('FONDOS_PRESUPUESTO')).toHaveLength(6)
    expect(JSON.stringify(filas('FONDOS_PRESUPUESTO').slice(0, 5))).toBe(antes)
    await a.saveFondo({ ...nuevo, monto: 120 })
    expect(filas('FONDOS_PRESUPUESTO')[5][2]).toBe(120)
    await a.saveFondo({ ...nuevo, monto: 120, activo: false })
    let d = await a.getData(true)
    expect(aggregate([], oct, CTX(d)).presupuesto.presupuesto).toBe(679400)                       // inactivo: no suma
    await a.saveFondoMes({ fondoId: 'f-pf-880ed1f8-57b4-44c3-a2f2-9981fc3dc2c4', mes: '2026-12', monto: 3300, modo: 'solo' })
    d = await a.getData(true)
    expect(d.fondosMeses).toHaveLength(1)
    expect(filas('FONDOS_PRESUPUESTO')[0][2]).toBe(3000)                                    // el fondo base no cambia
    await a.deleteFondo('f-nuevo')
    expect(filas('FONDOS_PRESUPUESTO')).toHaveLength(5)
  })

  it('revisión del presupuesto: registra una nueva revisión sin borrar la anterior y es idempotente por ID', async () => {
    const a = api()
    const i = { id: 'rev-0b0b0b0b-0000-4000-8000-000000000001', periodo: '2026-10', estado: 'completo' as const, pendientes: '', observacion: '' }
    await a.saveRevisionPresupuesto(i)
    await a.saveRevisionPresupuesto(i)
    expect(filas('REVISIONES_PRESUPUESTO')).toHaveLength(2)
    const d = await a.getData(true)
    expect(d.revisionesPresupuesto.map(r => r.estado)).toContain('completo')
    expect(d.revisionesPresupuesto.map(r => r.estado)).toContain('revisado_con_observaciones')
  })

  it('configuración: guarda una clave y la devuelve; un token incorrecto no escribe nada', async () => {
    const a = api()
    await a.saveConfig('tema', 'oscuro')
    expect((await a.getData(true)).config.tema).toBe('oscuro')
    const antes = JSON.stringify(filas('CONFIG'))
    expect(b.post('saveConfig', { clave: 'tema', valor: 'claro' }, 'token-malo').error.code).toBe('UNAUTHORIZED')
    expect(JSON.stringify(filas('CONFIG'))).toBe(antes)
  })

  it('con el lock ocupado la escritura falla con BUSY y no deja filas a medias', async () => {
    const a = api()
    b.setLock(false)
    await expect(a.saveGasto(gasto({ id: 'bbbbbbbb-1111-4222-8333-444444444444' }) as never, 'create')).rejects.toMatchObject({ code: 'BUSY' })
    b.setLock(true)
    expect(filas('GASTOS')).toHaveLength(0)
  })
})

describe('backend: generarDatosPrueba con cantidad y período', () => {
  let b: ReturnType<typeof load>
  beforeEach(() => { b = load(); b.g.setup(); b.admin() })
  const filas = (n: string) => b.ss.sheets.get(n)!.rows.slice(1).filter(r => r.some(v => v !== '' && v !== undefined))
  const prueba = () => filas('GASTOS').filter(r => r[11] === 'prueba')

  it('60 registros de julio a diciembre de 2025: reparte 10 por mes, solo fechas del rango y combinaciones válidas del catálogo', () => {
    const r = b.post('generarDatosPrueba', { cantidad: 60, desde: '2025-07', hasta: '2025-12' })
    expect(r.ok, JSON.stringify(r.error)).toBe(true)
    expect(r.data).toMatchObject({ gastos: 60, desde: '2025-07', hasta: '2025-12', meses: 6 })
    const gs = prueba()
    expect(gs).toHaveLength(60)
    const porMes: Record<string, number> = {}
    for (const g of gs) { const m = String(g[0]).slice(0, 7); porMes[m] = (porMes[m] ?? 0) + 1 }
    expect(porMes).toEqual({ '2025-07': 10, '2025-08': 10, '2025-09': 10, '2025-10': 10, '2025-11': 10, '2025-12': 10 })
    const cat = new Set(filas('CATALOGO').filter(c => c[1] && c[2] && c[3] !== false).map(c => `${c[0]}|${c[1]}|${c[2]}`))
    const medios = new Set(filas('MEDIOS_PAGO').filter(m => m[1] !== false).map(m => m[0]))
    for (const g of gs) {
      expect(/^2025-(0[7-9]|1[0-2])-\d\d$/.test(String(g[0]))).toBe(true)
      expect(cat.has(`${g[8]}|${g[3]}|${g[4]}`)).toBe(true)
      expect(medios.has(g[6])).toBe(true)
      expect(g[1]).toBeGreaterThanOrEqual(3)
      expect(g[1]).toBeLessThanOrEqual(300)
      expect(g[2]).toBe('PEN')
      expect(g[10]).toBe('Activo')
    }
    expect(new Set(gs.map(g => g[13])).size).toBe(60)                                        // IDs únicos
  })
  it('un solo mes: desde = hasta', () => {
    const r = b.post('generarDatosPrueba', { cantidad: 30, desde: '2026-03', hasta: '2026-03' })
    expect(r.data.meses).toBe(1)
    expect(prueba()).toHaveLength(30)
    expect(prueba().every(g => String(g[0]).startsWith('2026-03-'))).toBe(true)
  })
  it('crea un fondo de prueba con un presupuesto por mes del rango, mayor que lo gastado, y la web lo lee', async () => {
    b.post('generarDatosPrueba', { cantidad: 40, desde: '2025-07', hasta: '2025-09' })
    expect(filas('FONDOS_PRESUPUESTO').filter(f => f[0] === 'f-prueba-presupuesto')).toHaveLength(1)
    const meses = filas('FONDOS_PRESUPUESTO_MESES').filter(m => m[0] === 'f-prueba-presupuesto')
    expect(meses.map(m => m[1]).sort()).toEqual(['2025-07', '2025-08', '2025-09'])
    for (const m of meses) {
      const gastado = prueba().filter(g => String(g[0]).startsWith(String(m[1]))).reduce((s, g) => s + Number(g[1]), 0)
      expect(Number(m[2])).toBeGreaterThanOrEqual(gastado)
      expect(Number(m[2]) % 50).toBe(0)
    }
    const api = createApi(async (action, payload) => { const x = b.post(action, payload); if (!x.ok) throw new Error(x.error.message); return x.data })
    const d = await api.getData(true)
    expect(d.gastos.filter(g => g.origen === 'prueba')).toHaveLength(40)
    expect(d.fondos.find(f => f.id === 'f-prueba-presupuesto')?.tipo).toBe('extra')
  })
  it('sin parámetros (editor de Apps Script): 60 registros de julio a septiembre de 2026', () => {
    const r = (b.g as unknown as { generarDatosPrueba: () => Record<string, unknown> }).generarDatosPrueba()
    expect(r).toMatchObject({ gastos: 60, desde: '2026-07', hasta: '2026-09' })
  })
  it('rechaza parámetros inválidos sin escribir nada ni crear respaldo', () => {
    const antes = JSON.stringify(filas('GASTOS'))
    const casos: [Record<string, unknown>, RegExp][] = [
      [{ cantidad: 0 }, /entero entre 1 y 500/], [{ cantidad: 501 }, /entero entre 1 y 500/], [{ cantidad: 2.5 }, /entero entre 1 y 500/], [{ cantidad: 'abc' }, /entero entre 1 y 500/],
      [{ cantidad: 10, desde: '2025-12', hasta: '2025-07' }, /no puede ser posterior/],
      [{ cantidad: 10, desde: '2025-13', hasta: '2025-14' }, /AAAA-MM/], [{ cantidad: 10, desde: 'julio', hasta: 'diciembre' }, /AAAA-MM/],
      [{ cantidad: 10, desde: '2024-01', hasta: '2026-01' }, /máximo 24 meses/],
    ]
    for (const [p, re] of casos) {
      const r = b.post('generarDatosPrueba', p)
      expect(r.ok, JSON.stringify(p)).toBe(false)
      expect(r.error.code).toBe('VALIDATION')
      expect(r.error.message).toMatch(re)
    }
    expect(JSON.stringify(filas('GASTOS'))).toBe(antes)
    expect(b.ss.copies).toHaveLength(0)
  })
  it('se puede agregar más de una vez: suma gastos, no duplica el fondo y actualiza (no repite) los meses', () => {
    b.post('generarDatosPrueba', { cantidad: 12, desde: '2025-07', hasta: '2025-08' })
    b.post('generarDatosPrueba', { cantidad: 12, desde: '2025-08', hasta: '2025-09' })
    expect(prueba()).toHaveLength(24)
    expect(filas('FONDOS_PRESUPUESTO').filter(f => f[0] === 'f-prueba-presupuesto')).toHaveLength(1)
    expect(filas('FONDOS_PRESUPUESTO_MESES').filter(m => m[0] === 'f-prueba-presupuesto').map(m => m[1]).sort()).toEqual(['2025-07', '2025-08', '2025-09'])
  })
  it('borrarDatosPrueba elimina lo generado y conserva los gastos reales', () => {
    b.post('saveGasto', gasto({ id: 'cccccccc-1111-4222-8333-444444444444', fecha: '2025-08-10' }))
    b.post('generarDatosPrueba', { cantidad: 30, desde: '2025-07', hasta: '2025-09' })
    expect(filas('GASTOS')).toHaveLength(31)
    const d = b.post('borrarDatosPrueba')
    expect(d.ok, JSON.stringify(d.error)).toBe(true)
    expect(d.data.gastos).toBe(30)
    expect(filas('GASTOS')).toHaveLength(1)
    expect(filas('GASTOS')[0][13]).toBe('cccccccc-1111-4222-8333-444444444444')
    expect(filas('FONDOS_PRESUPUESTO').filter(f => f[0] === 'f-prueba-presupuesto')).toHaveLength(0)
    expect(filas('FONDOS_PRESUPUESTO_MESES').filter(m => m[0] === 'f-prueba-presupuesto')).toHaveLength(0)
  })
  it('con el catálogo sin subcategorías activas falla con un mensaje claro y no escribe', () => {
    const cat = b.ss.sheets.get('CATALOGO')!
    cat.rows = [cat.rows[0]]
    const r = b.post('generarDatosPrueba', { cantidad: 10 })
    expect(r.ok).toBe(false)
    expect(r.error.message).toMatch(/catálogo no tiene subcategorías activas/)
    expect(prueba()).toHaveLength(0)
  })
})

/* ============ Seguridad (auditoría 2026-10-22): S-03 atajo, S-04 administración, S-05 fórmulas ============ */
describe('seguridad del backend', () => {
  let b: ReturnType<typeof load>
  beforeEach(() => { b = load(); b.g.setup() })
  const ADMIN = ['setup', 'crearTokenAtajo', 'revocarTokenAtajo', 'generarDatosPrueba', 'generarCasosEspecialesPrueba', 'borrarDatosPrueba',
    'repararIds', 'repararHojas', 'retirarCajas']
  // Acciones de uso diario (no administrativas), clasificadas a propósito: una acción nueva sin clasificar rompe esta prueba.
  const DIARIAS = ['data', 'saveGasto', 'setEstado', 'setEstadoLote', 'saveCatalogo', 'renameCatalogo', 'reorderCategorias', 'deleteCategoria',
    'saveMedio', 'saveAsignacion', 'saveConfig', 'diagnose', 'backup', 'plantillas', 'savePlantilla',
    'deletePlantilla', 'reorderPlantillas', 'saveGastosBatch', 'reorderGastos', 'vincularGasto', 'saveRevision', 'saveRevisionPresupuesto',
    'saveFondo', 'saveFondoMes', 'reorderFondos', 'savePlantillaFin', 'deletePlantillaFin', 'reorderPlantillasFin', 'aplicarPlantillasFin',
    'aplicarEntidadesMes', 'deleteFondo', 'completarVacios', 'carpetaRespaldo', 'saveCarpetaRespaldo', 'misArchivos', 'autorizarRespaldos']
  const instantanea = () => JSON.stringify([...b.ss.sheets.entries()].map(([n, s]) => [n, s.rows]))

  it('toda acción de ACTIONS está clasificada como administrativa o de uso diario', () => {
    const src = readFileSync(resolve(__dirname, '../../apps-script/Code.gs'), 'utf8')
    const bloque = src.slice(src.indexOf('var ACTIONS = {'), src.indexOf('\n};', src.indexOf('var ACTIONS = {')))
    const acciones = [...bloque.matchAll(/^  (\w+):/gm)].map(m => m[1])
    expect(acciones.length).toBeGreaterThan(40)
    expect(acciones.filter(a => !ADMIN.includes(a) && !DIARIAS.includes(a))).toEqual([])
    expect([...ADMIN, ...DIARIAS].filter(a => !acciones.includes(a))).toEqual([])
  })

  describe('S-04: separación de privilegios', () => {
    it('sin token de administración creado, las acciones administrativas responden NOT_ENABLED y no tocan nada', () => {
      const antes = instantanea()
      for (const a of ADMIN) expect(b.post(a, {}).error?.code, a).toBe('NOT_ENABLED')
      expect(instantanea()).toBe(antes)
      expect(b.props.get('ATAJO_TOKEN')).toBeUndefined()
    })

    it('el token diario (solo o repetido como administrador) no basta; el atajo ni el administrador solo sirven', () => {
      b.admin()
      const antes = instantanea()
      const api = b.props.get('API_TOKEN')!
      for (const a of ADMIN) {
        expect(b.post(a, {}, api, null).error?.code, `${a} sin adminToken`).toBe('ADMIN_UNAUTHORIZED')
        expect(b.post(a, {}, api, 'adm_incorrecto').error?.code, `${a} adminToken falso`).toBe('ADMIN_UNAUTHORIZED')
        expect(b.post(a, {}, api, api).error?.code, `${a} token diario como administrador`).toBe('ADMIN_UNAUTHORIZED')
        expect(b.post(a, {}, 'malo', b.props.get('ADMIN_TOKEN')!).error?.code, `${a} sin token diario`).toBe('UNAUTHORIZED')
      }
      expect(instantanea()).toBe(antes)
      expect(b.props.get('ATAJO_TOKEN')).toBeUndefined()
    })

    it('con ambos tokens funcionan, y las acciones de uso diario no piden el de administración', () => {
      const adm = b.admin()
      expect(b.post('crearTokenAtajo', {}, b.props.get('API_TOKEN')!, adm).data.token).toMatch(/^atj_/)
      expect(b.post('revocarTokenAtajo', {}, b.props.get('API_TOKEN')!, adm).data).toEqual({ revocado: true })
      b.props.delete('ADMIN_TOKEN')
      expect(b.post('data', {}).ok).toBe(true)
      expect(b.post('saveGasto', gasto()).ok).toBe(true)
      expect(b.post('completarVacios', {}).ok).toBe(true)
    })

    it('revocarTokenAdmin las vuelve a deshabilitar y crearTokenAdmin reemplaza al anterior', () => {
      const t1 = b.admin(), t2 = b.admin()
      expect(t1).not.toBe(t2)
      expect(b.post('repararIds', {}, b.props.get('API_TOKEN')!, t1).error.code).toBe('ADMIN_UNAUTHORIZED')
      expect(b.post('repararIds', {}, b.props.get('API_TOKEN')!, t2).ok).toBe(true)
      ;(b.g as unknown as { revocarTokenAdmin: () => void }).revocarTokenAdmin()
      expect(b.post('repararIds', {}, b.props.get('API_TOKEN')!, t2).error.code).toBe('NOT_ENABLED')
    })

    it('S-02: rotarTokenApi invalida el token anterior al instante y el nuevo funciona; no es accesible por la API', () => {
      const viejo = b.props.get('API_TOKEN')!
      expect(b.post('data', {}, viejo).ok).toBe(true)
      expect(b.post('rotarTokenApi', {}, viejo).error.code).toBe('BAD_ACTION')
      const nuevo = (b.g as unknown as { rotarTokenApi: () => string }).rotarTokenApi()
      expect(nuevo).not.toBe(viejo)
      expect(nuevo.length).toBeGreaterThanOrEqual(32)
      expect(b.post('data', {}, viejo).error.code).toBe('UNAUTHORIZED')
      expect(b.post('data', {}, nuevo).ok).toBe(true)
    })

    it('el token de administración no aparece en ninguna respuesta de uso diario ni en la de setup', () => {
      const adm = b.admin()
      const respuestas = JSON.stringify([b.post('data', {}), b.post('diagnose', {}), b.post('misArchivos', {}), b.post('setup', {}, b.props.get('API_TOKEN')!, adm)])
      expect(respuestas).not.toContain(adm)
    })
  })

  describe('S-03: el atajo legítimo no se bloquea desde fuera pero conserva su límite por minuto', () => {
    const atajo = (action: string, payload: unknown, token: string) =>
      JSON.parse(b.g.doPost({ postData: { contents: JSON.stringify({ token, action, payload }) } }).body)
    const nuevo = (n: number) => ({ clave: `atajo-20261010-${1000 + n}`, ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Almuerzo', monto: '10', moneda: 'PEN', medioPago: 'Yape', fecha: '2026-10-10' })

    it('tras un ataque de tokens inválidos, el atajo sigue registrando; el límite de 20 por minuto sigue vigente', () => {
      const tk = (b.g as unknown as { crearTokenAtajo: () => string }).crearTokenAtajo()
      for (let i = 0; i < 15; i++) atajo('atajoCatalogo', {}, 'atj_adivinando_' + i)
      expect(atajo('atajoCatalogo', {}, 'atj_otro').error.code).toBe('LOCKED')
      for (let i = 0; i < 20; i++) expect(atajo('atajoGasto', nuevo(i), tk).ok, `registro ${i}`).toBe(true)
      expect(atajo('atajoGasto', nuevo(99), tk).error.code).toBe('RATE_LIMIT')       // el token válido no se salta el límite
      expect(atajo('atajoCatalogo', {}, tk).ok).toBe(true)                            // el catálogo (solo lectura) sigue disponible
    })

    it('un token inválido nunca llega a escribir', () => {
      ;(b.g as unknown as { crearTokenAtajo: () => string }).crearTokenAtajo()
      const antes = b.ss.sheets.get('GASTOS')!.rows.length
      expect(atajo('atajoGasto', nuevo(1), 'atj_falso').error.code).toBe('UNAUTHORIZED')
      expect(b.ss.sheets.get('GASTOS')!.rows.length).toBe(antes)
    })
  })

  describe('S-05: ningún texto del usuario queda interpretable como fórmula', () => {
    const HOSTILES = ['=HYPERLINK("http://malo.example","clic")', '+1+1', '-2+3', '@SUM(1)', '\t=1+1', '\r=1+1', '\n=1+1']
    const peligrosas = () => {
      const out: string[] = []
      for (const [nombre, sh] of b.ss.sheets) sh.rows.forEach((r, i) => { if (i > 0) r.forEach((c, j) => { if (typeof c === 'string' && /^[=+\-@\t\r\n]/.test(c)) out.push(`${nombre}!${i + 1}:${j + 1} ${JSON.stringify(c)}`) }) })
      return out
    }

    it('línea base: una base recién instalada no tiene celdas con aspecto de fórmula', () => {
      expect(peligrosas()).toEqual([])
    })

    it('cada acción de escritura neutraliza los valores hostiles en todos sus campos de texto', () => {
      const api = b.props.get('API_TOKEN')!
      const atajoTk = (b.g as unknown as { crearTokenAtajo: () => string }).crearTokenAtajo()
      const hex = (n: number) => String(n).padStart(12, '0')
      let n = 0
      for (const h of HOSTILES) {
        n++
        b.post('saveGasto', gasto({ id: `aaaaaaaa-0000-4000-8000-${hex(n)}`, descripcion: h, subcategoria: h, medioPago: h, ambito: h, categoria: h }))
        b.post('saveGastosBatch', { loteId: `lote-00000000-0000-4000-8000-${hex(n)}`, gastos: [{ ...gasto({ id: `bbbbbbbb-0000-4000-8000-${hex(n)}`, descripcion: h }), mode: undefined }] })
        b.post('saveCatalogo', { ambito: h, categoria: h, subcategoria: h, activo: true })
        b.post('saveMedio', { nombre: h })
        b.post('saveFondo', { id: `f-r${n}`, nombre: `R${n}`, monto: 10, moneda: 'PEN', orden: 1, recurrencia: 'mensual', mes: '', reglas: [{ desde: '', medios: 'solo', listaMedios: [h.replace(/\|/g, '')].filter(Boolean), cobertura: 'personalizada', rutas: [{ ambito: h, categoria: h, subcategoria: h }], restringeMedio: false }] })
        b.post('saveConfig', { clave: 'nota_' + n, valor: h })
        b.post('savePlantilla', { id: `pl-aaaaaaaa-0000-4000-8000-${hex(n)}`, mode: 'create', ambito: h, categoria: h, subcategoria: h, descripcion: h, monto: '', medioPago: h })
        b.post('savePlantillaFin', { id: `pf-aaaaaaaa-0000-4000-8000-${hex(n)}`, tipo: 'fondo', nombre: h, monto: 10, moneda: 'PEN', medios: h, recurrencia: 'mensual' })
        b.post('saveFondo', { id: `f-${n}`, nombre: h, monto: 10, moneda: 'PEN', orden: 1, recurrencia: 'unica', mes: '2026-10', medioPago: h })
        b.post('saveRevision', { id: `rev-00000000-0000-4000-8000-${hex(n)}`, tipo: 'duplicado', ids: [], estado: 'legitimo', firma: h })
        b.post('saveRevisionPresupuesto', { id: `rev-00000000-0000-4000-8000-${hex(100 + n)}`, periodo: '2026-10', estado: 'completo', pendientes: h, observacion: h })
        b.post('saveCarpetaRespaldo', { carpeta: h })
        JSON.parse(b.g.doPost({ postData: { contents: JSON.stringify({ token: atajoTk, action: 'atajoGasto', payload: { clave: `atajo-20261010-${2000 + n}`, ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Almuerzo', monto: '1', moneda: 'PEN', medioPago: 'Yape', fecha: '2026-10-10', descripcion: h } }) } }).body)
      }
      void api
      expect(peligrosas()).toEqual([])
      // La prueba tiene que haber llegado a escribir algo (si todo se rechazara, pasaría en vacío).
      const guardado = JSON.stringify([...b.ss.sheets.values()].map(s => s.rows))
      expect(guardado).toContain('HYPERLINK')
      expect(guardado).toContain("'=HYPERLINK")
    })
  })
})
