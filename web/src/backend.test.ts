// Pruebas de integración del backend: ejecuta apps-script/Code.gs real contra una simulación en memoria
// de SpreadsheetApp, CacheService, LockService y PropertiesService.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { beforeEach, describe, expect, it } from 'vitest'
import { CATALOGO_INICIAL } from './lib/catalogo'

type Cell = unknown
class FakeSheet {
  rows: Cell[][] = []
  frozen = 0
  filter: object | null = null
  writes = 0
  constructor(public name: string) {}
  // Como Sheets: la última fila con cualquier valor (un FALSE de casilla cuenta, una celda vacía no).
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i]?.some(v => v !== '' && v !== undefined)) return i + 1
    return 0
  }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0) }
  getMaxRows() { return Math.max(1000, this.rows.length) }
  setFrozenRows(n: number) { this.frozen = n }
  getFilter() { return this.filter }
  appendRow(row: Cell[]) { this.rows.push([...row]); this.writes++ }
  deleteRow(n: number) { this.rows.splice(n - 1, 1); this.writes++ }
  getRange(a: number | string, c?: number, nr = 1, nc = 1): FakeRange {
    if (typeof a === 'string') return new FakeRange(this, 1, 1, 0, 0)
    return new FakeRange(this, a, c!, nr, nc)
  }
}
class FakeRange {
  constructor(private s: FakeSheet, private r: number, private c: number, private nr: number, private nc: number) {}
  getValues() {
    return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => this.s.rows[this.r - 1 + i]?.[this.c - 1 + j] ?? ''))
  }
  setValues(v: Cell[][]) {
    this.s.writes++
    v.forEach((row, i) => { const target = (this.s.rows[this.r - 1 + i] ??= []); row.forEach((x, j) => { target[this.c - 1 + j] = x }) })
    return this
  }
  setValue(x: Cell) { return this.setValues([[x]]) }
  clearDataValidations() { return this }
  clearContent() {
    for (let i = 0; i < this.nr; i++) { const row = this.s.rows[this.r - 1 + i]; if (row) for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = '' }
    return this
  }
  setNumberFormat() { return this }
  insertCheckboxes() { return this }
  setFontWeight() { return this }
  setBackground() { return this }
  createFilter() { this.s.filter = {}; return this }
}
class FakeSpreadsheet {
  sheets = new Map<string, FakeSheet>([['Sheet1', new FakeSheet('Sheet1')]])
  getId() { return 'ss-1' }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/ss-1' }
  getSheetByName(n: string) { return this.sheets.get(n) ?? null }
  insertSheet(n: string) { const s = new FakeSheet(n); this.sheets.set(n, s); return s }
  getSheets() { return [...this.sheets.values()] }
  deleteSheet(s: FakeSheet) { this.sheets.delete(s.name) }
  setSpreadsheetTimeZone() {}
  copies: string[] = []
  copy(name: string) { this.copies.push(name); return { getUrl: () => `https://copy/${encodeURIComponent(name)}` } }
}

function load() {
  const ss = new FakeSpreadsheet()
  const props = new Map<string, string>()
  const cache = new Map<string, string>()
  let created = 0
  let lockFree = true
  let uuid = 0
  const ctx = {
    SpreadsheetApp: { create: () => { created++; return ss }, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v) }) },
    CacheService: { getScriptCache: () => ({
      get: (k: string) => cache.get(k) ?? null,
      getAll: (ks: string[]) => Object.fromEntries(ks.filter(k => cache.has(k)).map(k => [k, cache.get(k)])),
      put: (k: string, v: string) => cache.set(k, v),
      putAll: (o: Record<string, string>) => Object.entries(o).forEach(([k, v]) => cache.set(k, v)),
      remove: (k: string) => cache.delete(k),
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => lockFree, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
      formatDate: (d: Date) => d.toISOString().slice(0, 10),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s: string) => ({ setMimeType: () => ({ body: s }) }) },
    Logger: { log: () => {} },
    console: { error: () => {}, warn: () => {}, log: () => {} },
    Date, JSON, Math, Number, String, Object, Array, isFinite, isNaN, Error,
  }
  vm.createContext(ctx)
  vm.runInContext(readFileSync(resolve(__dirname, '../../apps-script/Code.gs'), 'utf8'), ctx)
  const g = ctx as unknown as Record<string, (...a: unknown[]) => { body: string }> & { setup: () => void }
  const token = () => props.get('API_TOKEN')!
  const post = (action: string, payload: unknown = {}, tk = token()) =>
    JSON.parse(g.doPost({ postData: { contents: JSON.stringify({ token: tk, action, payload }) } }).body)
  return { ss, props, cache, g, post, created: () => created, setLock: (v: boolean) => { lockFree = v } }
}

const gasto = (over: Record<string, unknown> = {}) => ({
  id: '11111111-2222-4333-8444-555555555555', fecha: '2026-10-05', monto: 25.5, moneda: 'PEN', categoria: 'Comida',
  subcategoria: 'Almuerzo', descripcion: 'Menú', medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal',
  esRecurrente: false, comprobanteUrl: '', mode: 'create', ...over,
})

// Simula una hoja creada con la versión anterior: casillas en toda la columna (FALSE hasta la fila 1000).
function legacyCheckboxes(sheet: FakeSheet, col: number) {
  for (let r = 1; r < 1000; r++) { const row = (sheet.rows[r] ??= []); if (row[col] === undefined || row[col] === '') row[col] = false }
}

describe('backend Apps Script', () => {
  let b: ReturnType<typeof load>
  beforeEach(() => { b = load(); b.g.setup() })

  it('setup crea las 6 hojas, encabezados de GASTOS con 16 columnas y es idempotente', () => {
    expect([...b.ss.sheets.keys()].sort()).toEqual(['CAJAS', 'CATALOGO', 'CONFIG', 'GASTOS', 'MEDIOS_PAGO', 'ORDEN_GASTOS', 'PLANTILLAS_MENSUALES', 'PRESUPUESTOS'])
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

  it('actualizarCatalogo: respalda, agrega lo nuevo, desactiva lo obsoleto sin borrarlo y no toca GASTOS', () => {
    const cat = b.ss.getSheetByName('CATALOGO')!
    // Hoja de la versión anterior: 6 columnas, sin Orden, con valores viejos y un "Otros" repetido.
    cat.rows = [['Ámbito', 'Categoría', 'Subcategoría', 'Activo', 'Icono', 'Color'],
      ['Personal', '', '', true, '', ''],
      ['Personal', 'Alimentación', 'Antojos', true, '', ''],
      ['Personal', 'Alimentación', 'Desayuno', false, '', ''],
      ['Familia', 'Bebé', 'Cuidado Darielita', true, '', ''],
      ['Pareja', 'Salidas', '', true, 'users', '#8B7CF6'],
      ['Personal', 'Alimentación', 'Otros', true, '', ''],
      ['Personal', 'Alimentación', ' otros', true, '', '']]
    const gs = b.ss.getSheetByName('GASTOS')!
    b.post('saveGasto', gasto({ ambito: 'Familia', categoria: 'Bebé', subcategoria: 'Cuidado Darielita' }))
    const gastosAntes = JSON.stringify(gs.rows)
    const r = b.g.actualizarCatalogo() as unknown as Record<string, number>
    expect(b.ss.copies).toHaveLength(1)
    expect(JSON.stringify(gs.rows)).toBe(gastosAntes)
    expect(cat.rows[0]).toEqual(['Ámbito', 'Categoría', 'Subcategoría', 'Activo', 'Icono', 'Color', 'Orden'])
    const byKey = (a: string, c: string, s: string) => cat.rows.filter(x => x[0] === a && x[1] === c && String(x[2]).trim() === s)
    expect(byKey('Personal', 'Alimentación', 'Antojos')[0][3]).toBe(false)       // obsoleto: inactivo, no borrado
    expect(byKey('Familia', 'Bebé', 'Cuidado Darielita')[0][3]).toBe(false)
    expect(byKey('Personal', 'Alimentación', 'Desayuno')[0][3]).toBe(true)        // vigente: reactivado
    expect(byKey('Pareja', 'Salidas', '')[0].slice(3, 6)).toEqual([true, 'users', '#8B7CF6']) // conserva icono/color
    const otros = cat.rows.filter(x => x[0] === 'Personal' && x[1] === 'Alimentación' && String(x[2]).trim().toLowerCase() === 'otros')
    expect(otros.map(x => x[3])).toEqual([true, false])                           // el duplicado lógico queda inactivo
    expect(byKey('Familia', 'Bebé', 'Cuidado Infantil')[0][3]).toBe(true)        // nuevo agregado
    expect(r.agregadas).toBeGreaterThan(200)
    const d = b.post('data', { fresh: true }).data
    expect(d.gastos[0][4]).toBe('Cuidado Darielita')                             // el histórico se sigue leyendo igual
    expect((b.g.actualizarCatalogo() as unknown as Record<string, number>).agregadas).toBe(0) // idempotente
  })

  it('actualizarCatalogo respeta los cambios manuales hechos después (activo, orden y opciones propias)', () => {
    b.g.actualizarCatalogo()
    const cat = b.ss.getSheetByName('CATALOGO')!
    const row = (a: string, c: string, s: string) => cat.rows.find(x => x[0] === a && x[1] === c && x[2] === s)!
    row('Personal', 'Auto', 'SOAT')[3] = false            // la desactivé a mano
    row('Personal', 'Auto', 'Gas')[6] = 10200.5            // la reordené a mano
    b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Auto', subcategoria: 'Peajes', activo: true }) // creada desde la app
    const antes = JSON.stringify(cat.rows)
    const r = b.g.actualizarCatalogo() as unknown as Record<string, number>
    expect(r).toMatchObject({ agregadas: 0, reactivadas: 0, desactivadas: 0 })
    expect(JSON.stringify(cat.rows)).toBe(antes)
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

  it('sin la hoja de plantillas (hoja antigua) la lectura devuelve vacío y la primera plantilla la crea', () => {
    b.ss.sheets.delete('PLANTILLAS_MENSUALES')
    expect(b.post('plantillas').data).toEqual([])
    expect(b.post('diagnose').ok).toBe(true)
    b.post('savePlantilla', { id: 'pl-11111111-2222-4333-8444-555555555555', mode: 'create', ambito: 'Familia', categoria: 'Servicios', subcategoria: 'Internet', descripcion: 'Internet' })
    expect(b.ss.getSheetByName('PLANTILLAS_MENSUALES')!.rows[0]).toEqual(['ID', 'Ámbito', 'Categoría', 'Subcategoría', 'Descripción', 'Creado en', 'Actualizado en', 'Monto', 'Moneda', 'Medio de pago', 'Orden'])
    expect(b.post('plantillas').data).toHaveLength(1)
  })

  it('plantillas v1.4: monto, moneda y medio; copia justo después de la original; reordenar en una escritura', () => {
    const id = (n: number) => `pl-11111111-2222-4333-8444-${String(n).padStart(12, '0')}`
    const base = { ambito: 'Familia', categoria: 'Servicios', descripcion: '', moneda: 'PEN', medioPago: 'Yape' }
    const mk = (n: number, sub: string, monto: number | '', extra: Record<string, unknown> = {}) =>
      b.post('savePlantilla', { id: id(n), mode: 'create', ...base, subcategoria: sub, descripcion: sub, monto, ...extra })
    expect(mk(1, 'Luz', 120).data.slice(7)).toEqual([120, 'PEN', 'Yape', 1])
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
    const sh = b.ss.getSheetByName('PLANTILLAS_MENSUALES')!
    const w = sh.writes
    b.post('reorderPlantillas', { ids: [id(3), id(1), id(2), id(6), id(4)] })
    expect(sh.writes - w).toBe(1)                                                 // una sola escritura
    expect(nombres()).toEqual(['Internet/Yape', 'Luz/Yape', 'Agua/Yape', 'Agua/Plin', 'Gas/Yape'])
    // editar conserva el orden
    b.post('savePlantilla', { id: id(1), mode: 'update', ...base, subcategoria: 'Luz', descripcion: 'Luz', monto: 130 })
    expect(b.post('plantillas').data[1].slice(7)).toEqual([130, 'PEN', 'Yape', 2])
  })

  it('plantillas: una hoja de la versión anterior (7 columnas) se amplía sin perder datos', () => {
    const sh = b.ss.getSheetByName('PLANTILLAS_MENSUALES')!
    sh.rows = [['ID', 'Ámbito', 'Categoría', 'Subcategoría', 'Descripción', 'Creado en', 'Actualizado en'],
      ['pl-11111111-2222-4333-8444-000000000001', 'Personal', 'Suscripciones', 'ChatGPT', 'ChatGPT', 't', 't']]
    expect(b.post('plantillas').data[0]).toEqual(['pl-11111111-2222-4333-8444-000000000001', 'Personal', 'Suscripciones', 'ChatGPT', 'ChatGPT', 't', 't', '', 'PEN', '', ''])
    b.post('savePlantilla', { id: 'pl-11111111-2222-4333-8444-000000000002', mode: 'create', ambito: 'Personal', categoria: 'Suscripciones', subcategoria: 'Spotify', descripcion: 'Spotify', monto: 25, moneda: 'PEN', medioPago: 'Yape' })
    expect(sh.rows[0]).toHaveLength(11)
    expect(sh.rows[1].slice(0, 5)).toEqual(['pl-11111111-2222-4333-8444-000000000001', 'Personal', 'Suscripciones', 'ChatGPT', 'ChatGPT'])
    expect(b.post('plantillas').data.map((r: unknown[]) => r[4])).toEqual(['ChatGPT', 'Spotify'])
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
    b.ss.getSheetByName('CAJAS')!.rows[0] = ['otra', 'cosa']
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
    expect(b.ss.getSheetByName('GASTOS')!.rows[1][5]).toBe('\'=IMPORTXML("http://x")')
    expect(b.post('data').data.gastos[0][5]).toBe('=IMPORTXML("http://x")')
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

  it('catálogo, medios, cajas, presupuestos y configuración hacen upsert sin duplicar', () => {
    b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Almuerzo', activo: true })
    b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Almuerzo', activo: false })
    b.post('saveMedio', { nombre: 'yape', activo: false })
    b.post('saveCaja', { id: 'auto', nombre: 'Caja Auto', presupuesto: 500, filtroCampo: 'Categoría', filtroValor: 'Auto', color: '#64748b', orden: 2 })
    b.post('savePresupuesto', { periodo: '2026-10', cajaId: 'auto', monto: 300 })
    b.post('savePresupuesto', { periodo: '2026-10', cajaId: 'auto', monto: 350 })
    b.post('saveConfig', { clave: 'tipo_cambio_USD', valor: '3.75' })
    const d = b.post('data').data
    expect(d.catalogo.filter((c: unknown[]) => c[0] === 'Personal' && c[2] === 'Almuerzo')).toEqual([['Personal', 'Alimentación', 'Almuerzo', false, '', '', 10102]])
    expect(d.medios.find((m: unknown[]) => String(m[0]).toLowerCase() === 'yape')[1]).toBe(false)
    expect(d.medios).toHaveLength(6)
    expect(d.medios[0][0]).toBe('Yape')
    expect(d.cajas.find((c: unknown[]) => c[0] === 'auto')[2]).toBe(500)
    expect(d.presupuestos).toEqual([['2026-10', 'auto', 350]])
    expect(d.config.tipo_cambio_USD).toBe('3.75')
  })
})
