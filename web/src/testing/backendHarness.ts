// Simulación en memoria de SpreadsheetApp, CacheService, LockService, PropertiesService y Drive para ejecutar el Code.gs REAL
// dentro de un `vm` de Node. La usan las pruebas de integración, de contrato y de medición del backend.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'

type Cell = unknown
export class FakeSheet {
  rows: Cell[][] = []
  frozen = 0
  filter: object | null = null
  writes = 0
  /** Lecturas de una columna entera (varias filas, una columna): lo que el TextFinder evita. */
  colReads = 0
  constructor(public name: string) {}
  getName() { return this.name }
  // Como Sheets: la última fila con cualquier valor (un FALSE de casilla cuenta, una celda vacía no).
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i]?.some(v => v !== '' && v !== undefined)) return i + 1
    return 0
  }
  setName(n: string) { this.ss?.sheets.delete(this.name); this.name = n; this.ss?.sheets.set(n, this) }
  ss?: FakeSpreadsheet
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0) }
  getMaxRows() { return Math.max(1000, this.rows.length) }
  setFrozenRows(n: number) { this.frozen = n }
  getFilter() { return this.filter }
  appendRow(row: Cell[]) { this.rows.push([...row]); this.writes++ }
  deleteRow(n: number) { this.rows.splice(n - 1, 1); this.writes++ }
  deleteRows(n: number, k: number) { this.rows.splice(n - 1, k); this.writes++ }
  getRange(a: number | string, c?: number, nr = 1, nc = 1): FakeRange {
    if (typeof a === 'string') return new FakeRange(this, 1, 1, 0, 0)
    return new FakeRange(this, a, c!, nr, nc)
  }
}
class FakeRange {
  constructor(private s: FakeSheet, private r: number, private c: number, private nr: number, private nc: number) {}
  getValues() {
    if (this.nr > 1 && this.nc === 1) this.s.colReads++
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
  getRow() { return this.r }
  /** Como el TextFinder de Sheets: sin distinguir mayúsculas salvo matchCase(true); matchEntireCell exige igualdad con la celda completa. */
  createTextFinder(txt: string) {
    const o = { entera: false, mayus: false }
    const f = {
      matchEntireCell: (b: boolean) => { o.entera = b; return f },
      matchCase: (b: boolean) => { o.mayus = b; return f },
      findNext: () => {
        const norm = (v: unknown) => (o.mayus ? String(v) : String(v).toLowerCase())
        for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) {
          const v = this.s.rows[this.r - 1 + i]?.[this.c - 1 + j]
          if (v === undefined || v === '') continue
          if (o.entera ? norm(v) === norm(txt) : norm(v).includes(norm(txt))) return new FakeRange(this.s, this.r + i, this.c + j, 1, 1)
        }
        return null
      },
    }
    return f
  }
}
class FakeSpreadsheet {
  sheets = new Map<string, FakeSheet>([['Sheet1', new FakeSheet('Sheet1')]])
  getId() { return 'ss-1' }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/ss-1' }
  getSheetByName(n: string) { return this.sheets.get(n) ?? null }
  insertSheet(n: string) { const s = new FakeSheet(n); s.ss = this; this.sheets.set(n, s); return s }
  getSheets() { return [...this.sheets.values()] }
  deleteSheet(s: FakeSheet) { this.sheets.delete(s.name) }
  setSpreadsheetTimeZone() {}
  copies: string[] = []
  copy(name: string) { this.copies.push(name); return { getUrl: () => `https://copy/${encodeURIComponent(name)}` } }
}

class FakeFolder {
  files: string[] = []
  children: FakeFolder[] = []
  constructor(public id: string, public name: string) {}
  getId() { return this.id }
  getName() { return this.name }
  getUrl() { return `https://drive.google.com/drive/folders/${this.id}` }
  getFoldersByName(n: string) { const xs = this.children.filter(c => c.name === n); return { hasNext: () => xs.length > 0, next: () => xs.shift()! } }
  createFolder(n: string) { const f = new FakeFolder(`folder-${n}-${this.children.length + 1}xxxxxx`, n); this.children.push(f); allFolders.set(f.id, f); return f }
}
const allFolders = new Map<string, FakeFolder>()

export function load() {
  const ss = new FakeSpreadsheet()
  allFolders.clear()
  const microApps = new FakeFolder('folder-microapps-0001', 'MicroApps')
  const root = new FakeFolder('folder-root-000001', 'Mi unidad')
  const otra = new FakeFolder('folder-otra-0000001', 'Respaldos personales')
  for (const f of [microApps, root, otra]) allFolders.set(f.id, f)
  const props = new Map<string, string>()
  const cache = new Map<string, string>()
  let created = 0
  const snapshots = new Map<string, FakeSpreadsheet>()
  let lockFree = true
  let uuid = 0
  const ctx = {
    SpreadsheetApp: { create: () => { created++; return ss }, openById: () => ss, openByUrl: (url: string) => { const c = snapshots.get(url); if (!c) throw new Error('No se pudo abrir ' + url); return c } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v), deleteProperty: (k: string) => props.delete(k) }) },
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
      formatDate: (d: Date, _tz?: string, fmt?: string) => d.toISOString().slice(0, fmt === 'yyyy-MM' ? 7 : 10),
      DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg: string, s: string) => [...createHash(alg).update(s, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
    },
    DriveApp: {
      getFileById: () => ({
        makeCopy: (name: string, folder: FakeFolder) => {
          ss.copies.push(name); folder.files.push(name)
          const url = `https://copy/${encodeURIComponent(name)}`
          const snap = new FakeSpreadsheet(); snap.sheets.clear()          // instantánea: el respaldo conserva las hojas tal como estaban
          for (const [n, sh] of ss.sheets) { const c = new FakeSheet(n); c.ss = snap; c.rows = sh.rows.map(r => [...r]); snap.sheets.set(n, c) }
          snapshots.set(url, snap)
          return { getUrl: () => url }
        },
        getParents: () => { let done = false; return { hasNext: () => !done, next: () => { done = true; return microApps } } },
      }),
      getRootFolder: () => root,
      getFolderById: (id: string) => { const f = allFolders.get(id); if (!f) throw new Error('No item with the given ID could be found'); return f },
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s: string) => ({ setMimeType: () => ({ body: s }) }) },
    Logger: { log: () => {} },
    console: { error: () => {}, warn: () => {}, log: () => {} },
    Date, JSON, Math, Number, String, Object, Array, isFinite, isNaN, Error,
  }
  vm.createContext(ctx)
  vm.runInContext(readFileSync(resolve(__dirname, '../../../apps-script/Code.gs'), 'utf8'), ctx)
  const g = ctx as unknown as Record<string, (...a: unknown[]) => { body: string }> & { setup: () => void }
  const token = () => props.get('API_TOKEN')!
  // El token de administración (S-04) se adjunta solo si existe: las pruebas que lo necesitan llaman antes a b.admin().
  const post = (action: string, payload: unknown = {}, tk = token(), adminToken: string | null = props.get('ADMIN_TOKEN') ?? null) =>
    JSON.parse(g.doPost({ postData: { contents: JSON.stringify({ token: tk, action, payload, adminToken }) } }).body)
  const admin = () => (g as unknown as { crearTokenAdmin: () => string }).crearTokenAdmin()
  return { ss, props, cache, g, post, admin, created: () => created, setLock: (v: boolean) => { lockFree = v }, folders: { microApps, root, otra } }
}

export const gasto = (over: Record<string, unknown> = {}) => ({
  id: '11111111-2222-4333-8444-555555555555', fecha: '2026-10-05', monto: 25.5, moneda: 'PEN', categoria: 'Comida',
  subcategoria: 'Almuerzo', descripcion: 'Menú', medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal',
  esRecurrente: false, comprobanteUrl: '', mode: 'create', ...over,
})

// Simula una hoja creada con la versión anterior: casillas en toda la columna (FALSE hasta la fila 1000).
export function legacyCheckboxes(sheet: FakeSheet, col: number) {
  for (let r = 1; r < 1000; r++) { const row = (sheet.rows[r] ??= []); if (row[col] === undefined || row[col] === '') row[col] = false }
}
