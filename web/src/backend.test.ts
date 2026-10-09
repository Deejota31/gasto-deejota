// Pruebas de integración del backend: ejecuta apps-script/Code.gs real contra una simulación en memoria
// de SpreadsheetApp, CacheService, LockService y PropertiesService.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { beforeEach, describe, expect, it } from 'vitest'

type Cell = unknown
class FakeSheet {
  rows: Cell[][] = []
  frozen = 0
  filter: object | null = null
  writes = 0
  constructor(public name: string) {}
  getLastRow() { return this.rows.length }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0) }
  getMaxRows() { return Math.max(1000, this.rows.length) }
  setFrozenRows(n: number) { this.frozen = n }
  getFilter() { return this.filter }
  appendRow(row: Cell[]) { this.rows.push([...row]); this.writes++ }
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
  copy(name: string) { return { getUrl: () => `https://copy/${encodeURIComponent(name)}` } }
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

describe('backend Apps Script', () => {
  let b: ReturnType<typeof load>
  beforeEach(() => { b = load(); b.g.setup() })

  it('setup crea las 6 hojas, encabezados de GASTOS con 16 columnas y es idempotente', () => {
    expect([...b.ss.sheets.keys()].sort()).toEqual(['CAJAS', 'CATALOGO', 'CONFIG', 'GASTOS', 'MEDIOS_PAGO', 'PRESUPUESTOS'])
    expect(b.ss.getSheetByName('GASTOS')!.rows[0]).toHaveLength(16)
    expect(b.ss.getSheetByName('CATALOGO')!.rows.slice(1).map(r => r[0])).toEqual(['Personal', 'Trabajo', 'Pareja', 'Familia', 'Amigos'])
    b.g.setup()
    expect(b.created()).toBe(1)
    expect(b.ss.getSheetByName('CATALOGO')!.rows).toHaveLength(6)
    expect(b.ss.getSheetByName('GASTOS')!.frozen).toBe(1)
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
    b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Comida', subcategoria: 'Almuerzo', activo: true })
    b.post('saveCatalogo', { ambito: 'Personal', categoria: 'Comida', subcategoria: 'Almuerzo', activo: false })
    b.post('saveMedio', { nombre: 'yape', activo: false })
    b.post('saveCaja', { id: 'auto', nombre: 'Caja Auto', presupuesto: 500, filtroCampo: 'Categoría', filtroValor: 'Auto', color: '#64748b', orden: 2 })
    b.post('savePresupuesto', { periodo: '2026-10', cajaId: 'auto', monto: 300 })
    b.post('savePresupuesto', { periodo: '2026-10', cajaId: 'auto', monto: 350 })
    b.post('saveConfig', { clave: 'tipo_cambio_USD', valor: '3.75' })
    const d = b.post('data').data
    expect(d.catalogo.filter((c: unknown[]) => c[2] === 'Almuerzo')).toEqual([['Personal', 'Comida', 'Almuerzo', false]])
    expect(d.medios.find((m: unknown[]) => String(m[0]).toLowerCase() === 'yape')[1]).toBe(false)
    expect(d.medios).toHaveLength(6)
    expect(d.cajas.find((c: unknown[]) => c[0] === 'auto')[2]).toBe(500)
    expect(d.presupuestos).toEqual([['2026-10', 'auto', 350]])
    expect(d.config.tipo_cambio_USD).toBe('3.75')
  })
})
