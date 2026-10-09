/**
 * Gasto Deejota — backend Google Apps Script (V8).
 * Una sola hoja de movimientos (GASTOS) + catálogos y configuración.
 * API: GET (sin token) = ping de salud. POST (text/plain JSON) {token, action, payload} para todo lo demás,
 * así el token nunca viaja en la URL.
 */

var APP_VERSION = '1.0.0';
var SPREADSHEET_NAME = 'Gasto Deejota - Base de Datos';

var SHEETS = {
  GASTOS: ['Fecha', 'Monto', 'Moneda', 'Categoría', 'Subcategoría', 'Descripción', 'Medio de pago',
    'Tipo de gasto', 'Ámbito', 'Es recurrente', 'Estado', 'Origen', 'Comprobante URL', 'ID',
    'Creado en', 'Actualizado en'],
  CATALOGO: ['Ámbito', 'Categoría', 'Subcategoría', 'Activo'],
  MEDIOS_PAGO: ['Nombre', 'Activo'],
  CAJAS: ['ID', 'Nombre', 'Presupuesto', 'Filtro campo', 'Filtro valor', 'Color', 'Orden'],
  PRESUPUESTOS: ['Periodo', 'Caja ID', 'Monto'],
  CONFIG: ['Clave', 'Valor']
};

// Columnas de GASTOS (índice base 0).
var G = { FECHA: 0, MONTO: 1, MONEDA: 2, CAT: 3, SUB: 4, DESC: 5, MEDIO: 6, TIPO: 7, AMBITO: 8,
  RECURRENTE: 9, ESTADO: 10, ORIGEN: 11, URL: 12, ID: 13, CREADO: 14, ACTUALIZADO: 15 };

var AMBITOS_INICIALES = ['Personal', 'Trabajo', 'Pareja', 'Familia', 'Amigos'];

// Catálogo completo pendiente de recibir del usuario: no se inventa. Formato: [ámbito, categoría, subcategoría].
var CATALOGO_INICIAL = [];

var MEDIOS_INICIALES = ['Efectivo', 'Tarjeta de débito', 'Tarjeta de crédito', 'Yape', 'Plin', 'Transferencia'];

var CAJAS_INICIALES = [
  ['general', 'Caja general', 0, 'Todos', '', '#1e3a8a', 1],
  ['auto', 'Caja Auto', 0, 'Categoría', 'Auto', '#64748b', 2],
  ['bebe', 'Caja Bebé', 0, 'Categoría', 'Bebé', '#ec4899', 3],
  ['plan-nube', 'Caja Plan Nube', 0, 'Categoría', 'Plan Nube', '#8b5cf6', 4]
];

var CONFIG_INICIAL = [
  ['moneda', 'PEN'],
  ['monedas', 'PEN,USD'],
  ['tipo_cambio_USD', ''],
  ['zona_horaria', 'America/Lima'],
  ['formato_fecha', 'dd/MM/yyyy'],
  ['tema', 'claro'],
  ['notificaciones', 'true']
];

var TIPOS_GASTO = ['Fijo', 'Variable', 'Extraordinario'];
var CACHE_KEY = 'data';
var CACHE_TTL = 600;  // 10 min: acota cuánto puede tardar en verse una edición hecha a mano en la hoja
var CHUNK = 90000;     // CacheService admite 100 KB por valor

/* ===================== Instalador (idempotente) ===================== */

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_TOKEN')) {
    props.setProperty('API_TOKEN', Utilities.getUuid().replace(/-/g, ''));
  }
  var ss = openSpreadsheet_(true);
  Object.keys(SHEETS).forEach(function (name) { ensureSheet_(ss, name, SHEETS[name]); });

  seedIfEmpty_(ss, 'CATALOGO', AMBITOS_INICIALES.map(function (a) { return [a, '', '', true]; })
    .concat(CATALOGO_INICIAL.map(function (r) { return [r[0], r[1], r[2], true]; })));
  seedIfEmpty_(ss, 'MEDIOS_PAGO', MEDIOS_INICIALES.map(function (m) { return [m, true]; }));
  seedIfEmpty_(ss, 'CAJAS', CAJAS_INICIALES);
  seedIfEmpty_(ss, 'CONFIG', CONFIG_INICIAL);

  var g = ss.getSheetByName('GASTOS');
  g.getRange('A:A').setNumberFormat('@');            // fechas ISO como texto: sin desfases de zona horaria
  g.getRange('B:B').setNumberFormat('#,##0.00');
  g.getRange('J2:J').insertCheckboxes();
  if (!g.getFilter()) g.getRange(1, 1, g.getMaxRows(), SHEETS.GASTOS.length).createFilter();
  ss.getSheetByName('CATALOGO').getRange('D2:D').insertCheckboxes();
  ss.getSheetByName('MEDIOS_PAGO').getRange('B2:B').insertCheckboxes();
  ss.getSheetByName('PRESUPUESTOS').getRange('A:A').setNumberFormat('@');
  ss.setSpreadsheetTimeZone('America/Lima');
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Hoja 1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  invalidateCache_();
  Logger.log('Spreadsheet: ' + ss.getUrl());
  Logger.log('API_TOKEN: ' + props.getProperty('API_TOKEN'));
}

function openSpreadsheet_(create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  if (!create) throw appError_('NOT_INSTALLED', 'Ejecuta setup() en Apps Script antes de usar la app.');
  var ss = SpreadsheetApp.create(SPREADSHEET_NAME);
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var current = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  if (!current.join('')) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e2e8f0');
  } else if (current.slice(0, headers.length).join('|') !== headers.join('|')) {
    // No sobrescribir datos ajenos: el instalador se detiene si la estructura no coincide.
    throw new Error('La hoja ' + name + ' tiene encabezados distintos a los esperados. Revisa antes de continuar.');
  }
  sh.setFrozenRows(1);
  return sh;
}

function seedIfEmpty_(ss, name, rows) {
  var sh = ss.getSheetByName(name);
  if (sh.getLastRow() > 1 || !rows.length) return;
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

/* ===================== HTTP ===================== */

function doGet() {
  return handle_(function () { return { app: 'Gasto Deejota', version: APP_VERSION, time: new Date().toISOString() }; });
}

function doPost(e) {
  return handle_(function () {
    var body;
    try { body = JSON.parse((e && e.postData && e.postData.contents) || ''); }
    catch (err) { throw appError_('BAD_JSON', 'Cuerpo de la petición inválido.'); }
    checkToken_(body.token);
    var fn = ACTIONS[body.action];
    if (!fn) throw appError_('BAD_ACTION', 'Acción no válida: ' + body.action);
    if (READ_ONLY[body.action]) return fn(body.payload || {});
    return withLock_(function () {
      var result = fn(body.payload || {});
      invalidateCache_();
      return result;
    });
  });
}

function handle_(fn) {
  var started = Date.now();
  var out;
  try {
    out = { ok: true, data: fn() };
  } catch (err) {
    var msg = String(err.message || err);
    var code = err.appCode || (/too many times|quota|cuota/i.test(msg) ? 'QUOTA'
      : /permission|permiso|authoriz/i.test(msg) ? 'PERMISSION' : 'SERVER_ERROR');
    out = { ok: false, error: { code: code, message: err.appCode ? msg : 'Error de Apps Script: ' + msg } };
    if (!err.appCode) console.error(err.stack || err);
  }
  out.ms = Date.now() - started;
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function appError_(code, message) {
  var e = new Error(message);
  e.appCode = code;
  return e;
}

function checkToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected) throw appError_('NOT_INSTALLED', 'Ejecuta setup() en Apps Script antes de usar la app.');
  if (typeof token !== 'string' || token !== expected) throw appError_('UNAUTHORIZED', 'Token inválido.');
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw appError_('BUSY', 'La hoja está ocupada. Intenta de nuevo en unos segundos.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ===================== Lectura (una lectura por hoja + caché) ===================== */

function getData_(fresh) {
  var gen = cacheGen_();
  var cached = fresh ? null : readCache_(gen);
  if (cached) { cached.cache = true; return cached; }
  var ss = openSpreadsheet_(false);
  var tz = 'America/Lima';
  var data = {
    version: APP_VERSION,
    sheetUrl: ss.getUrl(),
    gastos: readRows_(ss, 'GASTOS').map(function (r) { return normalizeGastoRow_(r, tz); }),
    catalogo: readRows_(ss, 'CATALOGO').map(function (r) { return [str_(r[0]), str_(r[1]), str_(r[2]), r[3] !== false]; }),
    medios: readRows_(ss, 'MEDIOS_PAGO').map(function (r) { return [str_(r[0]), r[1] !== false]; }),
    cajas: readRows_(ss, 'CAJAS').map(function (r) { return [str_(r[0]), str_(r[1]), num_(r[2]), str_(r[3]), str_(r[4]), str_(r[5]), num_(r[6])]; }),
    presupuestos: readRows_(ss, 'PRESUPUESTOS').map(function (r) { return [periodo_(r[0], tz), str_(r[1]), num_(r[2])]; }),
    config: readRows_(ss, 'CONFIG').reduce(function (acc, r) { acc[str_(r[0])] = str_(r[1]); return acc; }, {})
  };
  writeCache_(data, gen);
  data.cache = false;
  return data;
}

function readRows_(ss, name) {
  var sh = ss.getSheetByName(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, SHEETS[name].length).getValues().filter(function (r) {
    return r.join('') !== '';
  });
}

function normalizeGastoRow_(r, tz) {
  var row = r.slice();
  row[G.FECHA] = fecha_(r[G.FECHA], tz);
  row[G.MONTO] = num_(r[G.MONTO]);
  row[G.RECURRENTE] = r[G.RECURRENTE] === true || String(r[G.RECURRENTE]).toUpperCase() === 'TRUE';
  row[G.ESTADO] = str_(r[G.ESTADO]) || 'Activo';
  [G.CREADO, G.ACTUALIZADO].forEach(function (i) {
    row[i] = r[i] instanceof Date ? r[i].toISOString() : str_(r[i]);
  });
  [G.MONEDA, G.CAT, G.SUB, G.DESC, G.MEDIO, G.TIPO, G.AMBITO, G.ORIGEN, G.URL, G.ID].forEach(function (i) {
    row[i] = str_(r[i]).replace(/^'/, '');
  });
  return row;
}

function fecha_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return str_(v).slice(0, 10);
}

function periodo_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM');
  return str_(v).slice(0, 7);
}

function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function num_(v) { var n = Number(v); return isFinite(n) ? n : 0; }

// La caché se versiona con una "generación": cada escritura crea una nueva, así una lectura lenta
// que empezó antes de la escritura no puede dejar datos viejos en la caché vigente.
function cacheGen_() {
  return CacheService.getScriptCache().get(CACHE_KEY + ':gen') || '0';
}

function readCache_(gen) {
  var cache = CacheService.getScriptCache();
  var prefix = CACHE_KEY + ':' + gen + ':';
  var n = Number(cache.get(prefix + 'n'));
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(prefix + i);
  var parts = cache.getAll(keys);
  var json = '';
  for (var j = 0; j < n; j++) {
    if (parts[keys[j]] == null) return null; // algún trozo expiró: se reconstruye
    json += parts[keys[j]];
  }
  try { return JSON.parse(json); } catch (e) { return null; }
}

function writeCache_(data, gen) {
  var json = JSON.stringify(data);
  var prefix = CACHE_KEY + ':' + gen + ':';
  var values = {};
  var n = Math.ceil(json.length / CHUNK);
  for (var i = 0; i < n; i++) values[prefix + i] = json.slice(i * CHUNK, (i + 1) * CHUNK);
  try {
    var cache = CacheService.getScriptCache();
    if (cacheGen_() !== gen) return; // hubo una escritura mientras se leía: no guardar datos viejos
    cache.putAll(values, CACHE_TTL);
    cache.put(prefix + 'n', String(n), CACHE_TTL);
  } catch (e) {
    console.warn('No se pudo guardar caché: ' + e.message); // la app sigue funcionando sin caché
  }
}

function invalidateCache_() {
  CacheService.getScriptCache().put(CACHE_KEY + ':gen', Utilities.getUuid(), 21600);
}

/* ===================== Escritura ===================== */

var READ_ONLY = { data: true, diagnose: true, backup: true };

var ACTIONS = {
  data: function (p) { return getData_(p.fresh === true); },
  saveGasto: saveGasto_,
  setEstado: setEstado_,
  saveCatalogo: saveCatalogo_,
  saveMedio: saveMedio_,
  saveCaja: saveCaja_,
  savePresupuesto: savePresupuesto_,
  saveConfig: saveConfig_,
  diagnose: diagnose_,
  backup: backup_
};

function saveGasto_(p) {
  var ss = openSpreadsheet_(false);
  var sh = ss.getSheetByName('GASTOS');
  var g = validateGasto_(p);
  var rowIndex = findRowById_(sh, G.ID + 1, g.id);
  var now = new Date().toISOString();

  if (p.mode === 'create') {
    if (rowIndex) {
      // Reintento de un alta ya guardada: se devuelve el registro existente en lugar de duplicarlo.
      return normalizeGastoRow_(sh.getRange(rowIndex, 1, 1, SHEETS.GASTOS.length).getValues()[0], 'America/Lima');
    }
    var row = gastoToRow_(g, 'Activo', 'web', now, now);
    sh.appendRow(row);
    return normalizeGastoRow_(row, 'America/Lima');
  }
  if (p.mode === 'update') {
    if (!rowIndex) throw appError_('NOT_FOUND', 'El gasto ya no existe en la hoja.');
    var range = sh.getRange(rowIndex, 1, 1, SHEETS.GASTOS.length);
    var prev = range.getValues()[0];
    var updated = gastoToRow_(g, str_(prev[G.ESTADO]) || 'Activo', str_(prev[G.ORIGEN]) || 'web',
      prev[G.CREADO] instanceof Date ? prev[G.CREADO].toISOString() : str_(prev[G.CREADO]), now);
    range.setValues([updated]);
    return normalizeGastoRow_(updated, 'America/Lima');
  }
  throw appError_('VALIDATION', 'mode debe ser create o update.');
}

function setEstado_(p) {
  if (p.estado !== 'Activo' && p.estado !== 'Anulado') throw appError_('VALIDATION', 'Estado inválido.');
  var sh = openSpreadsheet_(false).getSheetByName('GASTOS');
  var rowIndex = findRowById_(sh, G.ID + 1, requireId_(p.id));
  if (!rowIndex) throw appError_('NOT_FOUND', 'El gasto ya no existe en la hoja.');
  var now = new Date().toISOString();
  sh.getRange(rowIndex, G.ESTADO + 1).setValue(p.estado);
  sh.getRange(rowIndex, G.ACTUALIZADO + 1).setValue(now);
  return { id: p.id, estado: p.estado, actualizadoEn: now };
}

function saveCatalogo_(p) {
  var ambito = text_(p.ambito, 'Ámbito', 40, true);
  var categoria = text_(p.categoria, 'Categoría', 60, false);
  var sub = text_(p.subcategoria, 'Subcategoría', 60, false);
  if (sub && !categoria) throw appError_('VALIDATION', 'Una subcategoría necesita categoría.');
  var activo = p.activo !== false;
  var sh = openSpreadsheet_(false).getSheetByName('CATALOGO');
  var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues() : [];
  var key = [ambito, categoria, sub].join('|').toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].map(str_).join('|').toLowerCase() === key) {
      sh.getRange(i + 2, 4).setValue(activo);
      return [ambito, categoria, sub, activo];
    }
  }
  sh.appendRow([ambito, categoria, sub, activo]);
  return [ambito, categoria, sub, activo];
}

function saveMedio_(p) {
  var nombre = text_(p.nombre, 'Medio de pago', 40, true);
  var activo = p.activo !== false;
  var sh = openSpreadsheet_(false).getSheetByName('MEDIOS_PAGO');
  var row = findRowByValue_(sh, 1, nombre);
  if (row) sh.getRange(row, 2).setValue(activo); else sh.appendRow([nombre, activo]);
  return [nombre, activo];
}

function saveCaja_(p) {
  var id = text_(p.id, 'ID de caja', 40, true);
  var campo = p.filtroCampo || 'Todos';
  if (['Todos', 'Ámbito', 'Categoría', 'Subcategoría', 'Medio de pago'].indexOf(campo) < 0) {
    throw appError_('VALIDATION', 'Filtro de caja inválido.');
  }
  var row = [id, text_(p.nombre, 'Nombre', 40, true), amount_(p.presupuesto, true), campo,
    campo === 'Todos' ? '' : text_(p.filtroValor, 'Valor del filtro', 60, true),
    /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#1e3a8a', num_(p.orden)];
  var sh = openSpreadsheet_(false).getSheetByName('CAJAS');
  var idx = findRowByValue_(sh, 1, id);
  if (idx) sh.getRange(idx, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
  return row;
}

function savePresupuesto_(p) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.periodo || '')) throw appError_('VALIDATION', 'Periodo inválido (AAAA-MM).');
  var cajaId = text_(p.cajaId, 'Caja', 40, true);
  var monto = amount_(p.monto, true);
  var sh = openSpreadsheet_(false).getSheetByName('PRESUPUESTOS');
  var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues() : [];
  for (var i = 0; i < rows.length; i++) {
    if (periodo_(rows[i][0], 'America/Lima') === p.periodo && str_(rows[i][1]) === cajaId) {
      sh.getRange(i + 2, 3).setValue(monto);
      return [p.periodo, cajaId, monto];
    }
  }
  sh.appendRow([p.periodo, cajaId, monto]);
  return [p.periodo, cajaId, monto];
}

function saveConfig_(p) {
  var allowed = CONFIG_INICIAL.map(function (r) { return r[0]; });
  if (allowed.indexOf(p.clave) < 0) throw appError_('VALIDATION', 'Clave de configuración no permitida.');
  var valor = text_(p.valor, 'Valor', 200, false);
  var sh = openSpreadsheet_(false).getSheetByName('CONFIG');
  var idx = findRowByValue_(sh, 1, p.clave);
  if (idx) sh.getRange(idx, 2).setValue(valor); else sh.appendRow([p.clave, valor]);
  return [p.clave, valor];
}

function diagnose_() {
  var t0 = Date.now();
  var ss = openSpreadsheet_(false);
  var counts = {};
  Object.keys(SHEETS).forEach(function (n) { counts[n] = Math.max(ss.getSheetByName(n).getLastRow() - 1, 0); });
  return { version: APP_VERSION, sheetUrl: ss.getUrl(), filas: counts, cacheActiva: !!CacheService.getScriptCache().get(CACHE_KEY + ':' + cacheGen_() + ':n'), lecturaMs: Date.now() - t0 };
}

function backup_() {
  var ss = openSpreadsheet_(false);
  var name = SPREADSHEET_NAME + ' - Respaldo ' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HH:mm');
  var copy = ss.copy(name);
  return { nombre: name, url: copy.getUrl() };
}

/* ===================== Validación ===================== */

function validateGasto_(p) {
  var fecha = String(p.fecha || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(Date.parse(fecha + 'T00:00:00Z')) ||
      new Date(fecha + 'T00:00:00Z').toISOString().slice(0, 10) !== fecha) {
    throw appError_('VALIDATION', 'Fecha inválida (AAAA-MM-DD).');
  }
  var moneda = String(p.moneda || '');
  if (!/^[A-Z]{3}$/.test(moneda)) throw appError_('VALIDATION', 'Moneda inválida.');
  var tipo = p.tipoGasto || 'Variable';
  if (TIPOS_GASTO.indexOf(tipo) < 0) throw appError_('VALIDATION', 'Tipo de gasto inválido.');
  var url = str_(p.comprobanteUrl);
  if (url && !/^https:\/\/\S{3,500}$/.test(url)) throw appError_('VALIDATION', 'El comprobante debe ser una URL https.');
  return {
    id: requireId_(p.id),
    fecha: fecha,
    monto: amount_(p.monto, false),
    moneda: moneda,
    categoria: text_(p.categoria, 'Categoría', 60, true),
    subcategoria: text_(p.subcategoria, 'Subcategoría', 60, false),
    descripcion: text_(p.descripcion, 'Descripción', 200, false),
    medio: text_(p.medioPago, 'Medio de pago', 40, true),
    tipo: tipo,
    ambito: text_(p.ambito, 'Ámbito', 40, true),
    recurrente: p.esRecurrente === true,
    url: url
  };
}

function requireId_(id) {
  if (!/^[0-9a-fA-F-]{8,64}$/.test(String(id || ''))) throw appError_('VALIDATION', 'ID inválido.');
  return String(id);
}

function amount_(v, allowZero) {
  var n = Number(v);
  if (!isFinite(n) || n < 0 || (!allowZero && n === 0) || n > 1e9) throw appError_('VALIDATION', 'Monto inválido.');
  return Math.round(n * 100) / 100;
}

function text_(v, label, max, required) {
  var s = str_(v);
  if (required && !s) throw appError_('VALIDATION', label + ' es obligatorio.');
  if (s.length > max) throw appError_('VALIDATION', label + ' supera ' + max + ' caracteres.');
  return safeCell_(s);
}

// Evita que un texto se interprete como fórmula en Sheets (inyección de fórmulas).
function safeCell_(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }

function gastoToRow_(g, estado, origen, creado, actualizado) {
  return [g.fecha, g.monto, g.moneda, g.categoria, g.subcategoria, g.descripcion, g.medio, g.tipo,
    g.ambito, g.recurrente, estado, origen, g.url, g.id, creado, actualizado];
}

function findRowById_(sh, col, id) { return findRowByValue_(sh, col, id); }

function findRowByValue_(sh, col, value) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var vals = sh.getRange(2, col, last - 1, 1).getValues();
  var target = String(value).toLowerCase();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).toLowerCase() === target) return i + 2;
  return 0;
}
