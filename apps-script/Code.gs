/**
 * Gasto Deejota — backend Google Apps Script (V8).
 * Una sola hoja de movimientos (GASTOS) + catálogos y configuración.
 * API: GET (sin token) = ping de salud. POST (text/plain JSON) {token, action, payload} para todo lo demás,
 * así el token nunca viaja en la URL.
 */

var APP_VERSION = '1.4.0';
var SPREADSHEET_NAME = 'Gasto Deejota - Base de Datos';

var SHEETS = {
  GASTOS: ['Fecha', 'Monto', 'Moneda', 'Categoría', 'Subcategoría', 'Descripción', 'Medio de pago',
    'Tipo de gasto', 'Ámbito', 'Es recurrente', 'Estado', 'Origen', 'Comprobante URL', 'ID',
    'Creado en', 'Actualizado en'],
  CATALOGO: ['Ámbito', 'Categoría', 'Subcategoría', 'Activo', 'Icono', 'Color', 'Orden'],
  MEDIOS_PAGO: ['Nombre', 'Activo'],
  CAJAS: ['ID', 'Nombre', 'Presupuesto', 'Filtro campo', 'Filtro valor', 'Color', 'Orden'],
  PRESUPUESTOS: ['Periodo', 'Caja ID', 'Monto'],
  CONFIG: ['Clave', 'Valor'],
  // Plantillas de gastos frecuentes: solo configuración reutilizable, nunca movimientos ni montos.
  PLANTILLAS_MENSUALES: ['ID', 'Ámbito', 'Categoría', 'Subcategoría', 'Descripción', 'Creado en', 'Actualizado en',
    'Monto', 'Moneda', 'Medio de pago', 'Orden'],
  // Orden personalizado de la tabla de Gastos (por ID). Hoja aparte: reordenar nunca mueve ni reescribe GASTOS.
  ORDEN_GASTOS: ['ID', 'Orden']
};

// Columna que identifica una fila real en cada hoja (índice base 0). Una fila sin clave no es un registro.
var KEY_COL = { GASTOS: 13, CATALOGO: 0, MEDIOS_PAGO: 0, CAJAS: 0, PRESUPUESTOS: 0, CONFIG: 0, PLANTILLAS_MENSUALES: 0, ORDEN_GASTOS: 0 };

// Columnas de GASTOS (índice base 0).
var G = { FECHA: 0, MONTO: 1, MONEDA: 2, CAT: 3, SUB: 4, DESC: 5, MEDIO: 6, TIPO: 7, AMBITO: 8,
  RECURRENTE: 9, ESTADO: 10, ORIGEN: 11, URL: 12, ID: 13, CREADO: 14, ACTUALIZADO: 15 };

// Catálogo inicial: ámbito → categoría → subcategorías. Es la misma lista que web/src/lib/catalogo.ts.
var CATALOGO_INICIAL = {
  "Personal": {
    "Alimentación": [
      "Desayuno",
      "Almuerzo",
      "Cena",
      "Delivery",
      "Snack / Antojos",
      "Bebidas",
      "Otros"
    ],
    "Auto": [
      "Gasolina",
      "Gas",
      "Car Wash",
      "Estacionamiento",
      "Mantenimiento",
      "Repuestos",
      "Seguro Vehicular",
      "SOAT",
      "Revisión Técnica",
      "Multas",
      "Otros"
    ],
    "Transporte": [
      "Taxi",
      "Moto Taxi",
      "Bus / Micro",
      "Otros"
    ],
    "Servicios": [
      "Línea Celular",
      "Otros"
    ],
    "Suscripciones": [
      "Juegos",
      "ChatGPT",
      "Claude",
      "Cluely",
      "Google",
      "Spotify",
      "Netflix",
      "HBO Max",
      "Prime Video",
      "Crunchyroll",
      "Otros"
    ],
    "Compras": [
      "Tecnología",
      "Perfumes",
      "Accesorios",
      "Ropa",
      "Calzado",
      "Regalos",
      "Electrodomésticos",
      "Muebles",
      "Otros"
    ],
    "Salud": [
      "Consultas Médicas",
      "Medicamentos",
      "Exámenes Médicos",
      "Odontología",
      "Otros"
    ],
    "Cuidado Personal": [
      "Barbería / Peluquería",
      "Higiene Personal",
      "Gimnasio",
      "Otros"
    ],
    "Educación": [
      "Maestría",
      "Matrícula",
      "Libros",
      "Certificaciones",
      "Plataformas Educativas",
      "Cursos",
      "Otros"
    ],
    "Otros": [
      "Imprevistos",
      "Trámites",
      "Por Clasificar",
      "Otros"
    ]
  },
  "Trabajo": {
    "Alimentación": [
      "Desayuno",
      "Almuerzo",
      "Cena",
      "Delivery",
      "Snack / Antojos",
      "Bebidas",
      "Otros"
    ],
    "Transporte": [
      "Taxi",
      "Moto Taxi",
      "Bus / Micro",
      "Otros"
    ],
    "Herramientas y Equipamiento": [
      "Software Laboral",
      "Equipos de Trabajo",
      "Accesorios",
      "Otros"
    ],
    "Otros": [
      "Imprevistos",
      "Trámites",
      "Por Clasificar",
      "Otros"
    ]
  },
  "Pareja": {
    "Alimentación": [
      "Desayuno",
      "Almuerzo",
      "Cena",
      "Delivery",
      "Snack / Antojos",
      "Bebidas",
      "Otros"
    ],
    "Plan Nube": [
      "Hospedaje",
      "Cuidado Íntimo",
      "Otros"
    ],
    "Transporte": [
      "Taxi",
      "Moto Taxi",
      "Bus / Micro",
      "Otros"
    ],
    "Regalos": [
      "Detalle Mensual",
      "Fecha Especial",
      "Aniversario",
      "Sorpresas",
      "Otros"
    ],
    "Compras": [
      "Tecnología",
      "Perfumes",
      "Accesorios",
      "Ropa",
      "Calzado",
      "Electrodomésticos",
      "Muebles",
      "Otros"
    ],
    "Salidas": [
      "Paseos",
      "Cine",
      "Juegos",
      "Diversión",
      "Restaurantes",
      "Actividades Recreativas",
      "Otros"
    ],
    "Otros": [
      "Imprevistos",
      "Trámites",
      "Por Clasificar",
      "Otros"
    ]
  },
  "Familia": {
    "Alimentación": [
      "Desayuno",
      "Almuerzo",
      "Cena",
      "Delivery",
      "Snack / Antojos",
      "Bebidas",
      "Otros"
    ],
    "Bebé": [
      "Leche",
      "Pañales",
      "Pañitos",
      "Ropa",
      "Alimentación",
      "Juguetes",
      "Accesorios",
      "Consultas Médicas",
      "Medicamentos",
      "Cuidado Infantil",
      "Otros"
    ],
    "Hogar": [
      "Supermercado",
      "Limpieza",
      "Reparaciones",
      "Mantenimiento",
      "Electrodomésticos",
      "Muebles",
      "Otros"
    ],
    "Servicios": [
      "Luz",
      "Agua",
      "Gas",
      "Internet",
      "Línea Celular",
      "Otros"
    ],
    "Transporte": [
      "Taxi",
      "Moto Taxi",
      "Bus / Micro",
      "Otros"
    ],
    "Compras": [
      "Tecnología",
      "Perfumes",
      "Accesorios",
      "Ropa",
      "Calzado",
      "Regalos",
      "Electrodomésticos",
      "Muebles",
      "Otros"
    ],
    "Apoyo Familiar": [
      "Padre",
      "Madre",
      "Pareja",
      "Hija",
      "Hermanos",
      "Apoyo Económico",
      "Regalo Familiar",
      "Otros"
    ],
    "Salud Familiar": [
      "Consultas Médicas",
      "Medicamentos",
      "Exámenes Médicos",
      "Emergencias",
      "Otros"
    ],
    "Educación": [
      "Maestría",
      "Matrícula",
      "Libros",
      "Certificaciones",
      "Plataformas Educativas",
      "Cursos",
      "Otros"
    ],
    "Otros": [
      "Imprevistos",
      "Trámites",
      "Por Clasificar",
      "Otros"
    ]
  },
  "Amigos": {
    "Alimentación": [
      "Desayuno",
      "Almuerzo",
      "Cena",
      "Delivery",
      "Snack / Antojos",
      "Bebidas",
      "Otros"
    ],
    "Transporte": [
      "Taxi",
      "Moto Taxi",
      "Bus / Micro",
      "Otros"
    ],
    "Salidas": [
      "Cine",
      "Paseos",
      "Juegos",
      "Diversión",
      "Reuniones",
      "Actividades Deportivas",
      "Otros"
    ],
    "Regalos": [
      "Cumpleaños",
      "Fechas Especiales",
      "Otros"
    ],
    "Otros": [
      "Imprevistos",
      "Trámites",
      "Por Clasificar",
      "Otros"
    ]
  }
};

// Orden de presentación de los medios de pago (es el orden de las filas en MEDIOS_PAGO).
var MEDIOS_INICIALES = ['Yape', 'Plin', 'Sodexo', 'Transferencia', 'Efectivo', 'Otros'];

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

  seedCatalogo_(ss);
  seedMedios_(ss);
  seedIfEmpty_(ss, 'CAJAS', CAJAS_INICIALES);
  seedIfEmpty_(ss, 'CONFIG', CONFIG_INICIAL);

  var g = ss.getSheetByName('GASTOS');
  g.getRange('A:A').setNumberFormat('@');            // fechas ISO como texto: sin desfases de zona horaria
  g.getRange('B:B').setNumberFormat('#,##0.00');
  // Sin casillas de verificación: insertCheckboxes() escribe FALSE en las 999 filas vacías y getLastRow()
  // pasa a ser 1000, por eso los registros se insertaban desde la fila 1001.
  if (!g.getFilter()) g.getRange(1, 1, g.getMaxRows(), SHEETS.GASTOS.length).createFilter();
  ss.getSheetByName('PRESUPUESTOS').getRange('A:A').setNumberFormat('@');
  ss.setSpreadsheetTimeZone('America/Lima');
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Hoja 1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  invalidateCache_();
  Logger.log('Spreadsheet: ' + ss.getUrl());
  Logger.log('API_TOKEN: ' + props.getProperty('API_TOKEN'));
}

/**
 * Muestra en el registro dónde está todo (ejecútala desde el editor): este proyecto de Apps Script,
 * la hoja que usa la API y la URL /exec. No modifica nada.
 */
function misArchivos() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  Logger.log('Proyecto Apps Script: https://script.google.com/d/' + ScriptApp.getScriptId() + '/edit');
  if (id) {
    var ss = SpreadsheetApp.openById(id);
    Logger.log('Hoja que usa la API: ' + ss.getName() + ' → ' + ss.getUrl());
    Logger.log('SPREADSHEET_ID: ' + id);
  } else {
    Logger.log('Este proyecto todavía no tiene hoja: ejecuta setup() o define SPREADSHEET_ID en Propiedades del script.');
  }
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { /* sin implementación */ }
  Logger.log('URL de la API (/exec): ' + (url || 'sin implementación web todavía'));
  Logger.log('Respaldos: busca "' + SPREADSHEET_NAME + ' - Respaldo" en Google Drive.');
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
  var isPrefix = current.length < headers.length && current.join('|') === headers.slice(0, current.length).join('|');
  if (!current.join('') || isPrefix) {
    // Hoja nueva, o versión anterior con menos columnas: se agregan solo los encabezados que faltan.
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e2e8f0');
  } else if (current.slice(0, headers.length).join('|') !== headers.join('|')) {
    // No sobrescribir datos ajenos: el instalador se detiene si la estructura no coincide.
    throw new Error('La hoja ' + name + ' tiene encabezados distintos a los esperados. Revisa antes de continuar.');
  }
  sh.setFrozenRows(1);
  return sh;
}

// Compara nombres ignorando mayúsculas y espacios extra: "Otros", " otros " y "OTROS" son la misma opción.
function norm_(v) { return str_(v).replace(/\s+/g, ' ').toLowerCase(); }
function catKey_(a, c, s) { return [norm_(a), norm_(c), norm_(s)].join('|'); }

// Orden de presentación: ámbito × 10000 + categoría × 100 + subcategoría. "Otros" se ubica al final en la web
// sin importar este número; el resto respeta el orden del catálogo (o el que pongas a mano en la columna Orden).
function ordenCanonico_() {
  var out = {};
  Object.keys(CATALOGO_INICIAL).forEach(function (a, i) {
    var base = (i + 1) * 10000;
    out[catKey_(a, '', '')] = base;
    Object.keys(CATALOGO_INICIAL[a]).forEach(function (c, j) {
      var cb = base + (j + 1) * 100;
      out[catKey_(a, c, '')] = cb;
      CATALOGO_INICIAL[a][c].forEach(function (s, k) { out[catKey_(a, c, s)] = cb + k + 1; });
    });
  });
  return out;
}

function canonicalRows_() {
  var rows = [];
  Object.keys(CATALOGO_INICIAL).forEach(function (a) {
    rows.push([a, '', '']);
    Object.keys(CATALOGO_INICIAL[a]).forEach(function (c) {
      CATALOGO_INICIAL[a][c].forEach(function (s) { rows.push([a, c, s]); });
    });
  });
  return rows;
}

// Agrega solo lo que falte (por ámbito|categoría|subcategoría): no duplica, no reactiva lo que desactivaste
// y respeta lo que agregaste a mano. Se puede volver a ejecutar sin riesgo.
function seedCatalogo_(ss) {
  var sh = ss.getSheetByName('CATALOGO');
  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) { existing[catKey_(r[0], r[1], r[2])] = true; });
  }
  var orden = ordenCanonico_();
  var rows = [];
  canonicalRows_().forEach(function (r) {
    var key = catKey_(r[0], r[1], r[2]);
    if (!existing[key]) { existing[key] = true; rows.push([r[0], r[1], r[2], true, '', '', orden[key]]); }
  });
  appendRows_(sh, rows); // una sola escritura
}

// Siguiente número de orden para una opción nueva, al final de su grupo (antes de "Otros", que la web siempre pone último).
function nextOrden_(rows, a, c, sub) {
  var max = function (pred) {
    var m = null;
    rows.forEach(function (r) { var o = Number(r[6]); if (str_(r[6]) !== '' && isFinite(o) && pred(r) && (m === null || o > m)) m = o; });
    return m;
  };
  if (sub) {
    var m1 = max(function (r) { return norm_(r[0]) === norm_(a) && norm_(r[1]) === norm_(c); });
    if (m1 !== null) return m1 + 1;
  }
  if (c) {
    var m2 = max(function (r) { return norm_(r[0]) === norm_(a); });
    if (m2 !== null) return (Math.floor(m2 / 100) + 1) * 100 + (sub ? 1 : 0);
  }
  var m3 = max(function () { return true; });
  return m3 === null ? '' : (Math.floor(m3 / 10000) + 1) * 10000 + (c ? 100 : 0) + (sub ? 1 : 0);
}

// Medios en el orden pedido. Agrega los que falten y respeta los existentes (no reactiva desactivados).
function seedMedios_(ss) {
  var sh = ss.getSheetByName('MEDIOS_PAGO');
  var existing = {};
  readRows_(ss, 'MEDIOS_PAGO').forEach(function (r) { existing[str_(r[0]).toLowerCase()] = true; });
  appendRows_(sh, MEDIOS_INICIALES.filter(function (m) { return !existing[m.toLowerCase()]; })
    .map(function (m) { return [m, true]; }));
}

function seedIfEmpty_(ss, name, rows) {
  var sh = ss.getSheetByName(name);
  if (readRows_(ss, name).length || !rows.length) return;
  appendRows_(sh, rows);
}

/* ===================== Filas: detección y escritura seguras ===================== */

// Una celda tiene contenido si no está vacía y no es el FALSE que deja una casilla sin marcar.
function hasContent_(r) {
  for (var i = 0; i < r.length; i++) if (r[i] !== '' && r[i] !== false && r[i] !== null) return true;
  return false;
}

// Última fila con contenido real (1 si solo hay encabezados). Una sola lectura del área usada.
function lastDataRow_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return 1;
  var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  for (var i = values.length - 1; i >= 0; i--) if (hasContent_(values[i])) return i + 2;
  return 1;
}

// Escribe las filas justo después del último registro real, en un bloque. Las filas que siguen
// solo pueden tener residuos (vacíos o FALSE), nunca datos, así que nada legítimo se sobrescribe.
function appendRows_(sh, rows) {
  if (!rows.length) return 0;
  var start = lastDataRow_(sh) + 1;
  sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
  return start;
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
      if (!KEEP_CACHE[body.action]) invalidateCache_();
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
    catalogo: readRows_(ss, 'CATALOGO').map(function (r) { return [str_(r[0]), str_(r[1]), str_(r[2]), r[3] !== false && String(r[3]).toUpperCase() !== 'FALSE', str_(r[4]), str_(r[5]), str_(r[6]) === '' ? '' : num_(r[6])]; }),
    medios: readRows_(ss, 'MEDIOS_PAGO').map(function (r) { return [str_(r[0]), r[1] !== false && String(r[1]).toUpperCase() !== 'FALSE']; }),
    cajas: readRows_(ss, 'CAJAS').map(function (r) { return [str_(r[0]), str_(r[1]), num_(r[2]), str_(r[3]), str_(r[4]), str_(r[5]), num_(r[6])]; }),
    presupuestos: readRows_(ss, 'PRESUPUESTOS').map(function (r) { return [periodo_(r[0], tz), str_(r[1]), num_(r[2])]; }),
    config: readRows_(ss, 'CONFIG').reduce(function (acc, r) { acc[str_(r[0])] = str_(r[1]); return acc; }, {}),
    ordenGastos: ss.getSheetByName('ORDEN_GASTOS') ? readRows_(ss, 'ORDEN_GASTOS').map(function (r) { return [str_(r[0]), num_(r[1])]; }) : []
  };
  writeCache_(data, gen);
  data.cache = false;
  return data;
}

function readRows_(ss, name) {
  var sh = ss.getSheetByName(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var key = KEY_COL[name];
  return sh.getRange(2, 1, last - 1, SHEETS[name].length).getValues().filter(function (r) {
    return str_(r[key]) !== ''; // filas sin clave (vacías o con FALSE residual) no son registros
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

var READ_ONLY = { data: true, diagnose: true, backup: true, plantillas: true };
// Escrituras que no cambian los datos del dashboard: no invalidan su caché.
var KEEP_CACHE = { savePlantilla: true, deletePlantilla: true, reorderPlantillas: true };

var ACTIONS = {
  data: function (p) { return getData_(p.fresh === true); },
  saveGasto: saveGasto_,
  setEstado: setEstado_,
  saveCatalogo: saveCatalogo_,
  renameCatalogo: renameCatalogo_,
  saveMedio: saveMedio_,
  saveCaja: saveCaja_,
  savePresupuesto: savePresupuesto_,
  saveConfig: saveConfig_,
  diagnose: diagnose_,
  backup: backup_,
  plantillas: listPlantillas_,
  savePlantilla: savePlantilla_,
  deletePlantilla: deletePlantilla_,
  reorderPlantillas: reorderPlantillas_,
  saveGastosBatch: saveGastosBatch_,
  reorderGastos: reorderGastos_
};

function saveGasto_(p) {
  var ss = openSpreadsheet_(false);
  var sh = ss.getSheetByName('GASTOS');
  var g = validateGasto_(p);
  var rowIndex = findRowById_(sh, G.ID + 1, g.id);
  var now = new Date().toISOString();

  if (p.mode === 'create') {
    if (rowIndex) {
      // Reintento de un alta ya guardada: nunca se duplica. Si el alta no se editó después (Creado = Actualizado),
      // se aplican los datos del reintento (p. ej. corregidos tras "Abrir formulario"); si ya se editó, gana lo guardado.
      var exRange = sh.getRange(rowIndex, 1, 1, SHEETS.GASTOS.length);
      var ex = exRange.getValues()[0];
      var creado = ex[G.CREADO] instanceof Date ? ex[G.CREADO].toISOString() : str_(ex[G.CREADO]);
      var actualizado = ex[G.ACTUALIZADO] instanceof Date ? ex[G.ACTUALIZADO].toISOString() : str_(ex[G.ACTUALIZADO]);
      if (creado !== actualizado) return normalizeGastoRow_(ex, 'America/Lima');
      var redo = gastoToRow_(g, str_(ex[G.ESTADO]) || 'Activo', str_(ex[G.ORIGEN]) || 'web', creado, creado);
      exRange.setValues([redo]);
      return normalizeGastoRow_(redo, 'America/Lima');
    }
    var row = gastoToRow_(g, 'Activo', 'web', now, now);
    appendRows_(sh, [row]);
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
  var icono = p.icono === undefined ? null : str_(p.icono);
  var color = p.color === undefined ? null : str_(p.color);
  if (icono && !/^[a-z0-9-]{1,30}$/.test(icono)) throw appError_('VALIDATION', 'Icono inválido.');
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw appError_('VALIDATION', 'Color inválido.');
  var sh = openSpreadsheet_(false).getSheetByName('CATALOGO');
  var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues() : [];
  var key = catKey_(ambito, categoria, sub);
  for (var i = 0; i < rows.length; i++) {
    if (catKey_(rows[i][0], rows[i][1], rows[i][2]) === key) {
      // null = no cambiar el icono/color guardado. Una opción existente conserva su nombre y su orden.
      var row = [rows[i][0], rows[i][1], rows[i][2], activo, icono === null ? str_(rows[i][4]) : icono, color === null ? str_(rows[i][5]) : color];
      sh.getRange(i + 2, 4, 1, 3).setValues([row.slice(3)]);
      return [str_(row[0]), str_(row[1]), str_(row[2]), activo, row[4], row[5], str_(rows[i][6]) === '' ? '' : num_(rows[i][6])];
    }
  }
  var nuevo = [ambito, categoria, sub, activo, icono || '', color || '', nextOrden_(rows, ambito, categoria, sub)];
  appendRows_(sh, [nuevo]);
  return nuevo;
}

function saveMedio_(p) {
  var nombre = text_(p.nombre, 'Medio de pago', 40, true);
  var activo = p.activo !== false;
  var sh = openSpreadsheet_(false).getSheetByName('MEDIOS_PAGO');
  var row = findRowByValue_(sh, 1, nombre);
  if (row) sh.getRange(row, 2).setValue(activo); else appendRows_(sh, [[nombre, activo]]);
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
  if (idx) sh.getRange(idx, 1, 1, row.length).setValues([row]); else appendRows_(sh, [row]);
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
  appendRows_(sh, [[p.periodo, cajaId, monto]]);
  return [p.periodo, cajaId, monto];
}

function saveConfig_(p) {
  var allowed = CONFIG_INICIAL.map(function (r) { return r[0]; });
  if (allowed.indexOf(p.clave) < 0) throw appError_('VALIDATION', 'Clave de configuración no permitida.');
  var valor = text_(p.valor, 'Valor', 200, false);
  var sh = openSpreadsheet_(false).getSheetByName('CONFIG');
  var idx = findRowByValue_(sh, 1, p.clave);
  if (idx) sh.getRange(idx, 2).setValue(valor); else appendRows_(sh, [[p.clave, valor]]);
  return [p.clave, valor];
}

function diagnose_() {
  var t0 = Date.now();
  var ss = openSpreadsheet_(false);
  var counts = {};
  Object.keys(SHEETS).forEach(function (n) { var sh = ss.getSheetByName(n); counts[n] = sh ? Math.max(sh.getLastRow() - 1, 0) : 0; });
  return { version: APP_VERSION, sheetUrl: ss.getUrl(), filas: counts, cacheActiva: !!CacheService.getScriptCache().get(CACHE_KEY + ':' + cacheGen_() + ':n'), lecturaMs: Date.now() - t0 };
}

function backup_() {
  var ss = openSpreadsheet_(false);
  var name = SPREADSHEET_NAME + ' - Respaldo ' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HH:mm');
  var copy = ss.copy(name);
  return { nombre: name, url: copy.getUrl() };
}

// Renombra un ámbito, categoría o subcategoría en el catálogo y en los gastos que la usan,
// para que el historial siga clasificado igual. Lee GASTOS una vez y escribe solo las columnas afectadas.
function renameCatalogo_(p) {
  var nivel = p.nivel;
  if (['ambito', 'categoria', 'subcategoria'].indexOf(nivel) < 0) throw appError_('VALIDATION', 'Nivel inválido.');
  var ambito = text_(p.ambito, 'Ámbito', 40, true);
  var categoria = nivel === 'ambito' ? '' : text_(p.categoria, 'Categoría', 60, true);
  var sub = nivel === 'subcategoria' ? text_(p.subcategoria, 'Subcategoría', 60, true) : '';
  var nuevo = text_(p.nuevo, 'Nuevo nombre', nivel === 'ambito' ? 40 : 60, true);
  var col = { ambito: 0, categoria: 1, subcategoria: 2 }[nivel];
  var actual = [ambito, categoria, sub][col];
  if (actual === nuevo) return { catalogo: 0, gastos: 0 };
  var ss = openSpreadsheet_(false);

  var cat = ss.getSheetByName('CATALOGO');
  var n = Math.max(cat.getLastRow() - 1, 0);
  var crow = n ? cat.getRange(2, 1, n, 3).getValues() : [];
  var match = function (a, c, s2) {
    return a === ambito && (nivel === 'ambito' || c === categoria) && (nivel !== 'subcategoria' || s2 === sub);
  };
  var dup = crow.some(function (r) {
    var x = r.map(norm_);
    return x[0] === norm_(nivel === 'ambito' ? nuevo : ambito) && (nivel === 'ambito' || x[1] === norm_(nivel === 'categoria' ? nuevo : categoria)) &&
      (nivel !== 'subcategoria' || x[2] === norm_(nuevo)) && !match(str_(r[0]), str_(r[1]), str_(r[2]));
  });
  if (dup) throw appError_('VALIDATION', 'Ya existe una opción con ese nombre.');
  var catChanged = 0;
  crow.forEach(function (r) { if (match(str_(r[0]), str_(r[1]), str_(r[2]))) { r[col] = nuevo; catChanged++; } });
  if (!catChanged) throw appError_('NOT_FOUND', 'La opción ya no existe en el catálogo.');
  cat.getRange(2, 1, n, 3).setValues(crow);

  var gs = ss.getSheetByName('GASTOS');
  var gn = Math.max(gs.getLastRow() - 1, 0);
  var changed = 0;
  if (gn) {
    var de = gs.getRange(2, G.CAT + 1, gn, 2).getValues();   // Categoría, Subcategoría
    var amb = gs.getRange(2, G.AMBITO + 1, gn, 1).getValues();
    for (var i = 0; i < gn; i++) {
      if (match(str_(amb[i][0]), str_(de[i][0]), str_(de[i][1]))) {
        if (col === 0) amb[i][0] = nuevo; else de[i][col - 1] = nuevo;
        changed++;
      }
    }
    if (changed) {
      if (col === 0) gs.getRange(2, G.AMBITO + 1, gn, 1).setValues(amb);
      else gs.getRange(2, G.CAT + 1, gn, 2).setValues(de);
    }
  }
  return { catalogo: catChanged, gastos: changed };
}

/* ===================== Plantillas de gastos mensuales ===================== */
// Lectura liviana: solo la hoja de plantillas (no toca GASTOS ni la caché del dashboard).
// Columnas: 0 ID, 1-4 clasificación y descripción, 5-6 marcas de tiempo, 7 Monto, 8 Moneda, 9 Medio de pago, 10 Orden.

var PL_ID = /^pl-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var PL_COLS = 11;

function plantillaRow_(r) {
  var ts = function (v) { return v instanceof Date ? v.toISOString() : str_(v); };
  var opt = function (v) { return str_(v) === '' ? '' : num_(v); };
  return [str_(r[0]), str_(r[1]), str_(r[2]), str_(r[3]), str_(r[4]).replace(/^'/, ''), ts(r[5]), ts(r[6]),
    opt(r[7]), str_(r[8]) || 'PEN', str_(r[9]).replace(/^'/, ''), opt(r[10])];
}

// Orden estable: por la columna Orden; las filas sin orden (versión anterior) quedan después, en orden de creación.
function plantillasOrdenadas_(rows) {
  return rows.map(function (r, i) { return { r: r, i: i, o: str_(r[10]) === '' ? Infinity : num_(r[10]) }; })
    .sort(function (a, b) { return (a.o - b.o) || (a.i - b.i); });
}

function listPlantillas_() {
  var ss = openSpreadsheet_(false);
  if (!ss.getSheetByName('PLANTILLAS_MENSUALES')) return []; // se crea con la primera plantilla
  return plantillasOrdenadas_(readRows_(ss, 'PLANTILLAS_MENSUALES')).map(function (x) { return plantillaRow_(x.r); });
}

function plantillasSheet_() {
  var ss = openSpreadsheet_(false);
  var sh = ss.getSheetByName('PLANTILLAS_MENSUALES');
  // Hoja de la versión anterior (7 columnas): se agregan Monto, Moneda, Medio de pago y Orden sin tocar los datos.
  return ensureSheet_(ss, 'PLANTILLAS_MENSUALES', SHEETS.PLANTILLAS_MENSUALES) || sh;
}

function leerPlantillas_(sh) {
  var n = Math.max(lastDataRow_(sh) - 1, 0);
  return n ? sh.getRange(2, 1, n, PL_COLS).getValues() : [];
}

// Reescribe la columna Orden (1..n) en una sola escritura, según la lista de índices de fila ya ordenada.
function escribirOrdenPlantillas_(sh, rows, indicesOrdenados) {
  if (!rows.length) return;
  var orden = rows.map(function (r) { return [r[10]]; });
  indicesOrdenados.forEach(function (idx, pos) { orden[idx] = [pos + 1]; });
  sh.getRange(2, 11, rows.length, 1).setValues(orden);
}

function savePlantilla_(p) {
  var id = str_(p.id);
  if (!PL_ID.test(id)) throw appError_('VALIDATION', 'ID de plantilla inválido.');
  var ambito = text_(p.ambito, 'Ámbito', 40, true);
  var categoria = text_(p.categoria, 'Categoría', 60, true);
  var sub = text_(p.subcategoria, 'Subcategoría', 60, true);
  var desc = text_(p.descripcion, 'Descripción', 200, true);
  var monto = (p.monto === '' || p.monto === null || p.monto === undefined) ? '' : amount_(p.monto, true); // vacío o >= 0
  var moneda = str_(p.moneda) || 'PEN';
  if (!/^[A-Z]{3}$/.test(moneda)) throw appError_('VALIDATION', 'Moneda inválida.');
  var medio = text_(p.medioPago, 'Medio de pago', 40, false);
  var sh = plantillasSheet_();
  var rows = leerPlantillas_(sh);
  var plain = function (v) { return norm_(str_(v).replace(/^'/, '')); }; // ignora el apóstrofo anti-fórmulas
  var montoKey = function (v) { return str_(v) === '' ? '' : String(Math.round(num_(v) * 100)); };
  var key = [plain(ambito), plain(categoria), plain(sub), plain(desc), montoKey(monto), plain(moneda), plain(medio)].join('|');
  var idx = -1;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i][0]) === id) { idx = i; continue; }
    var k = [plain(rows[i][1]), plain(rows[i][2]), plain(rows[i][3]), plain(rows[i][4]), montoKey(rows[i][7]), plain(str_(rows[i][8]) || 'PEN'), plain(rows[i][9])].join('|');
    if (str_(rows[i][0]) && k === key) throw appError_('VALIDATION', 'La plantilla ya existe. Modifica al menos uno de sus valores para guardar una copia.');
  }
  var now = new Date().toISOString();
  if (idx >= 0) { // edición (o reintento de un alta ya guardada): conserva creación y orden
    var prev = rows[idx];
    var upd = [id, ambito, categoria, sub, desc, plantillaRow_(prev)[5], now, monto, moneda, medio, prev[10]];
    sh.getRange(idx + 2, 1, 1, PL_COLS).setValues([upd]);
    return plantillaRow_(upd);
  }
  if (p.mode === 'update') throw appError_('NOT_FOUND', 'La plantilla ya no existe.');
  var row = [id, ambito, categoria, sub, desc, now, now, monto, moneda, medio, ''];
  appendRows_(sh, [row]);
  // Nueva al final; una copia (afterId), justo después de la original. Se renumera en una sola escritura.
  rows.push(row);
  var orden = plantillasOrdenadas_(rows).map(function (x) { return x.i; }).filter(function (i) { return i !== rows.length - 1 && str_(rows[i][0]); });
  var after = str_(p.afterId);
  var pos = orden.length;
  if (after) { for (var j = 0; j < orden.length; j++) if (str_(rows[orden[j]][0]) === after) pos = j + 1; }
  orden.splice(pos, 0, rows.length - 1);
  escribirOrdenPlantillas_(sh, rows, orden);
  row[10] = pos + 1;
  return plantillaRow_(row);
}

// Guarda el orden manual (arrastrar y soltar) en una sola escritura de la columna Orden.
function reorderPlantillas_(p) {
  var ids = Array.isArray(p.ids) ? p.ids.map(str_) : [];
  if (!ids.length || ids.some(function (x) { return !PL_ID.test(x); })) throw appError_('VALIDATION', 'Orden de plantillas inválido.');
  var sh = openSpreadsheet_(false).getSheetByName('PLANTILLAS_MENSUALES');
  if (!sh) throw appError_('NOT_FOUND', 'No hay plantillas.');
  var rows = leerPlantillas_(sh);
  var pos = {};
  rows.forEach(function (r, i) { pos[str_(r[0])] = i; });
  var orden = [];
  ids.forEach(function (x) { if (pos[x] !== undefined && orden.indexOf(pos[x]) < 0) orden.push(pos[x]); });
  plantillasOrdenadas_(rows).forEach(function (x) { if (str_(x.r[0]) && orden.indexOf(x.i) < 0) orden.push(x.i); }); // las no enviadas, al final
  escribirOrdenPlantillas_(sh, rows, orden);
  return { ok: true, total: orden.length };
}

// Elimina solo la fila de la plantilla. No toca gastos, presupuestos ni cajas.
function deletePlantilla_(p) {
  var id = str_(p.id);
  if (!PL_ID.test(id)) throw appError_('VALIDATION', 'ID de plantilla inválido.');
  var sh = openSpreadsheet_(false).getSheetByName('PLANTILLAS_MENSUALES');
  var row = sh ? findRowByValue_(sh, 1, id) : 0;
  if (!row) return { id: id, eliminada: false }; // ya no estaba: el resultado es el mismo
  sh.deleteRow(row);
  return { id: id, eliminada: true };
}

/* ===================== Registro de varios gastos en una sola petición ===================== */

/**
 * Valida TODO el lote antes de escribir; si un gasto no es válido no se inserta ninguno y el error dice cuál.
 * Inserta las filas nuevas en el orden recibido con una sola escritura (setValues sobre un rango contiguo).
 * Idempotente: cada gasto trae su ID generado en el navegador; si el lote se reintenta, los que ya existen
 * no se vuelven a insertar. Sheets no tiene transacciones: si la escritura falla a mitad, reintentar el mismo
 * lote completa lo que falte sin duplicar.
 */
function saveGastosBatch_(p) {
  var loteId = str_(p.loteId);
  if (!/^lote-[0-9a-f-]{36}$/.test(loteId)) throw appError_('VALIDATION', 'ID de lote inválido.');
  var lista = Array.isArray(p.gastos) ? p.gastos : [];
  if (!lista.length || lista.length > 100) throw appError_('VALIDATION', 'El lote debe tener entre 1 y 100 gastos.');
  var vistos = {};
  var gastos = lista.map(function (x, i) {
    try {
      var g = validateGasto_(x);
      if (vistos[g.id.toLowerCase()]) throw appError_('VALIDATION', 'ID repetido en el lote.');
      vistos[g.id.toLowerCase()] = true;
      return g;
    } catch (e) {
      throw appError_('VALIDATION', 'Gasto ' + (i + 1) + ' (' + (str_(x && x.descripcion) || 'sin descripción') + '): ' + e.message);
    }
  });
  var sh = openSpreadsheet_(false).getSheetByName('GASTOS');
  var last = lastDataRow_(sh);
  var existentes = {}; // id → número de fila
  if (last > 1) sh.getRange(2, G.ID + 1, last - 1, 1).getValues().forEach(function (r, i) { existentes[str_(r[0]).toLowerCase()] = i + 2; });
  var now = new Date().toISOString();
  var nuevas = [];
  var filas = gastos.map(function (g) {
    var fila = existentes[g.id.toLowerCase()];
    // Reintento de un lote ya escrito: no se duplica ni se modifica; se devuelve lo que realmente está en la hoja.
    if (fila) return sh.getRange(fila, 1, 1, SHEETS.GASTOS.length).getValues()[0];
    var row = gastoToRow_(g, 'Activo', 'web', now, now);
    nuevas.push(row);
    return row;
  });
  appendRows_(sh, nuevas); // una sola escritura
  return {
    estado: 'confirmado', loteId: loteId, solicitados: gastos.length, confirmados: gastos.length,
    nuevos: nuevas.length, yaExistian: gastos.length - nuevas.length,
    ids: gastos.map(function (g) { return g.id; }),
    gastos: filas.map(function (r) { return normalizeGastoRow_(r, 'America/Lima'); }),
    mensaje: 'Se registraron ' + gastos.length + ' gastos.'
  };
}

/* ===================== Orden personalizado de la tabla de Gastos ===================== */

// Recibe los IDs del conjunto reordenado, en su nuevo orden. Escribe solo la hoja ORDEN_GASTOS:
// actualiza en bloque los que ya tenían orden y agrega al final los que no (máximo dos escrituras).
function reorderGastos_(p) {
  var ids = Array.isArray(p.ids) ? p.ids.map(str_) : [];
  if (!ids.length || ids.length > 5000 || ids.some(function (x) { return !/^[0-9a-fA-F-]{8,64}$/.test(x); })) throw appError_('VALIDATION', 'Orden inválido.');
  var ss = openSpreadsheet_(false);
  var sh = ss.getSheetByName('ORDEN_GASTOS') || ensureSheet_(ss, 'ORDEN_GASTOS', SHEETS.ORDEN_GASTOS);
  var n = Math.max(lastDataRow_(sh) - 1, 0);
  var rows = n ? sh.getRange(2, 1, n, 2).getValues() : [];
  var idx = {};
  rows.forEach(function (r, i) { idx[str_(r[0]).toLowerCase()] = i; });
  var nuevos = [];
  ids.forEach(function (id, pos) {
    var k = id.toLowerCase();
    if (idx[k] !== undefined) rows[idx[k]][1] = pos + 1; else nuevos.push([id, pos + 1]);
  });
  if (n) sh.getRange(2, 1, n, 2).setValues(rows);
  appendRows_(sh, nuevos);
  return { ok: true, total: ids.length };
}

/**
 * Aplica el catálogo de CATALOGO_INICIAL a tu hoja (ejecútala a mano desde el editor). Primero crea un respaldo.
 * - Agrega las opciones que falten y las deja activas, con su orden.
 * - Filas de versiones anteriores (sin Orden): las de la lista quedan activas y numeradas; las que ya no están quedan
 *   INACTIVAS (no se borran): dejan de ofrecerse para gastos nuevos, pero tus gastos antiguos las conservan.
 * - Filas con Orden (ya migradas o creadas desde la app) no se tocan: respeta lo que activaste, desactivaste o reordenaste.
 * - No toca la hoja GASTOS ni cambia nombres, iconos o colores. Se puede volver a ejecutar sin riesgo.
 */
function actualizarCatalogo() {
  var ss = openSpreadsheet_(false);
  var backup = backup_(); // antes de cualquier cambio
  Logger.log('Respaldo creado: ' + backup.url);
  ensureSheet_(ss, 'CATALOGO', SHEETS.CATALOGO); // agrega la columna Orden si falta
  var res = withLock_(function () {
    var sh = ss.getSheetByName('CATALOGO');
    var n = Math.max(lastDataRow_(sh) - 1, 0);
    var rows = n ? sh.getRange(2, 1, n, 7).getValues() : [];
    var orden = ordenCanonico_();
    var seen = {};
    var stats = { agregadas: 0, reactivadas: 0, desactivadas: 0, sinCambios: 0 };
    var log = { reactivadas: [], desactivadas: [] };
    var label = function (r) { return [str_(r[0]), str_(r[1]), str_(r[2])].filter(String).join(' › '); };
    // Regla: una fila SIN Orden viene de una versión anterior y se ajusta a la lista oficial. Una fila CON Orden ya
    // fue migrada o la creaste desde la app: se respeta tal cual (activa/inactiva y orden), así volver a ejecutar
    // esta función no deshace tus cambios manuales.
    var vals = rows.map(function (r) {
      if (!hasContent_(r)) return [r[3], r[6]];
      var key = catKey_(r[0], r[1], r[2]);
      var oficial = Object.prototype.hasOwnProperty.call(orden, key) && !seen[key];
      seen[key] = true;
      var activo = r[3] !== false && String(r[3]).toUpperCase() !== 'FALSE';
      if (str_(r[6]) !== '') { stats.sinCambios++; return [r[3], r[6]]; }
      if (oficial) {
        if (!activo) { stats.reactivadas++; log.reactivadas.push(label(r)); } else stats.sinCambios++;
        return [true, orden[key]];
      }
      if (activo) { stats.desactivadas++; log.desactivadas.push(label(r)); }
      return [false, r[6]];
    });
    if (n) {
      sh.getRange(2, 4, n, 1).setValues(vals.map(function (v) { return [v[0]]; }));
      sh.getRange(2, 7, n, 1).setValues(vals.map(function (v) { return [v[1]]; }));
    }
    var nuevas = [];
    canonicalRows_().forEach(function (r) {
      var key = catKey_(r[0], r[1], r[2]);
      if (!seen[key]) { seen[key] = true; nuevas.push([r[0], r[1], r[2], true, '', '', orden[key]]); }
    });
    appendRows_(sh, nuevas);
    stats.agregadas = nuevas.length;
    invalidateCache_();
    return { stats: stats, log: log };
  });
  Logger.log('Catálogo actualizado: ' + JSON.stringify(res.stats));
  if (res.log.desactivadas.length) Logger.log('Quedaron inactivas (se conservan para tus gastos antiguos): ' + res.log.desactivadas.join(', '));
  if (res.log.reactivadas.length) Logger.log('Reactivadas: ' + res.log.reactivadas.join(', '));
  return res.stats;
}

/**
 * Repara IDs de gastos (ejecútala a mano desde el editor). Primero crea un respaldo.
 * Asigna un ID nuevo solo a filas cuyo ID está vacío, tiene caracteres no válidos o está REPETIDO
 * (la primera aparición conserva el suyo). No cambia ningún otro dato: fecha, monto, descripción, estado y fechas
 * de creación quedan igual. Sin esto, editar o eliminar uno de dos gastos con el mismo ID modificaría el otro.
 */
function repararIds() {
  var ss = openSpreadsheet_(false);
  var backup = backup_();
  Logger.log('Respaldo creado: ' + backup.url);
  var cambios = withLock_(function () {
    var sh = ss.getSheetByName('GASTOS');
    var n = Math.max(lastDataRow_(sh) - 1, 0);
    if (!n) return [];
    var rows = sh.getRange(2, 1, n, SHEETS.GASTOS.length).getValues();
    var seen = {};
    var out = [];
    var ids = rows.map(function (r, i) {
      var id = str_(r[G.ID]);
      if (!hasContent_(r)) return [r[G.ID]];
      var k = id.toLowerCase();
      if (!id || !/^[0-9a-fA-F-]{8,64}$/.test(id) || seen[k]) {
        var nuevo = Utilities.getUuid();
        seen[nuevo.toLowerCase()] = true;
        out.push('Fila ' + (i + 2) + ' (' + str_(r[G.DESC]) + ', ' + num_(r[G.MONTO]) + '): ' + (id || '(vacío)') + ' → ' + nuevo);
        return [nuevo];
      }
      seen[k] = true;
      return [r[G.ID]];
    });
    if (out.length) { sh.getRange(2, G.ID + 1, n, 1).setValues(ids); invalidateCache_(); }
    return out;
  });
  Logger.log(cambios.length ? 'IDs reparados:\n' + cambios.join('\n') : 'Todos los IDs están bien. No se cambió nada.');
  return cambios;
}

/**
 * Reparación opcional y explícita (ejecútala a mano desde el editor). Crea un respaldo y luego, en cada hoja:
 * quita las casillas de verificación que dejaban FALSE en filas vacías, mueve los registros reales al inicio
 * (fila 2 en adelante) conservando su orden, y asigna ID a los gastos escritos a mano que no lo tenían.
 * No borra ningún registro con contenido.
 */
function repararHojas() {
  var ss = openSpreadsheet_(false);
  var backup = backup_();
  Logger.log('Respaldo creado: ' + backup.url);
  withLock_(function () {
    Object.keys(SHEETS).forEach(function (name) { ensureSheet_(ss, name, SHEETS[name]); }); // agrega Icono/Color si faltan
    Object.keys(SHEETS).forEach(function (name) {
      var sh = ss.getSheetByName(name);
      var last = sh.getLastRow();
      var width = Math.max(SHEETS[name].length, sh.getLastColumn());
      var rows = last > 1 ? sh.getRange(2, 1, last - 1, width).getValues().filter(hasContent_) : [];
      var ids = 0;
      if (name === 'GASTOS') {
        var now = new Date().toISOString();
        rows.forEach(function (r) {
          if (!str_(r[G.ID]) && str_(r[G.FECHA]) && str_(r[G.MONTO])) {
            r[G.ID] = Utilities.getUuid();
            r[G.ESTADO] = str_(r[G.ESTADO]) || 'Activo';
            r[G.ORIGEN] = str_(r[G.ORIGEN]) || 'manual';
            r[G.CREADO] = r[G.CREADO] || now;
            r[G.ACTUALIZADO] = now;
            ids++;
          }
        });
      }
      if (name === 'MEDIOS_PAGO') {
        // Orden pedido: primero la lista definida, luego los demás tal como estaban.
        var pos = function (r) { var i = MEDIOS_INICIALES.map(function (m) { return m.toLowerCase(); }).indexOf(str_(r[0]).toLowerCase()); return i < 0 ? 999 : i; };
        rows = rows.map(function (r, i) { return { r: r, i: i }; })
          .sort(function (a, b) { return pos(a.r) - pos(b.r) || a.i - b.i; }).map(function (x) { return x.r; });
      }
      if (last > 1) {
        var area = sh.getRange(2, 1, sh.getMaxRows() - 1, width);
        area.clearDataValidations();
        area.clearContent();
      }
      if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows);
      Logger.log(name + ': ' + rows.length + ' registros desde la fila 2' + (ids ? ' (' + ids + ' ID asignados)' : ''));
    });
    seedMedios_(ss);
    invalidateCache_();
  });
  return backup;
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
