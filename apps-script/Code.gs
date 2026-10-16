/**
 * Gasto Deejota — backend Google Apps Script (V8).
 * Una sola hoja de movimientos (GASTOS) + catálogos y configuración.
 * API: GET (sin token) = ping de salud. POST (text/plain JSON) {token, action, payload} para todo lo demás,
 * así el token nunca viaja en la URL.
 */

var APP_VERSION = '1.23.0';
var SPREADSHEET_NAME = 'Gasto Deejota - Base de Datos';

var PF_COLS_ = ['ID', 'Tipo', 'Nombre', 'Monto', 'Moneda', 'Medios', 'Alcance', 'Valor', 'Descripción', 'Color', 'Icono', 'Recurrencia',
  'Activo', 'Orden', 'Origen ID', 'Estados', 'Creado en', 'Actualizado en', 'Datos'];
// Esquema de la hoja anterior PLANTILLAS_MENSUALES (v1.19.2 la fusiona en PLANTILLAS_FINANCIERAS; solo se lee para migrar).
var PL_COLS_LEGACY = ['ID', 'Ámbito', 'Categoría', 'Subcategoría', 'Descripción', 'Creado en', 'Actualizado en',
  'Monto', 'Moneda', 'Medio de pago', 'Orden', 'Es compromiso', 'Tipo de gasto', 'Es recurrente'];
var SHEETS = {
  GASTOS: ['Fecha', 'Monto', 'Moneda', 'Categoría', 'Subcategoría', 'Descripción', 'Medio de pago',
    'Tipo de gasto', 'Ámbito', 'Es recurrente', 'Estado', 'Origen', 'Comprobante URL', 'ID',
    'Creado en', 'Actualizado en'],
  CATALOGO: ['Ámbito', 'Categoría', 'Subcategoría', 'Activo', 'Icono', 'Color', 'Orden'],
  MEDIOS_PAGO: ['Nombre', 'Activo', 'Icono', 'Color'],
  // Activo y Descripción (v1.7): cajas personalizadas. Una caja inactiva no reserva dinero ni toma gastos.
  // Icono (v1.10): vacío = automático (el de su alcance); si lo eliges, manda junto con el Color.
  CAJAS: ['ID', 'Nombre', 'Presupuesto', 'Filtro campo', 'Filtro valor', 'Color', 'Orden', 'Activo', 'Descripción', 'Icono'],
  PRESUPUESTOS: ['Periodo', 'Caja ID', 'Monto'],
  CONFIG: ['Clave', 'Valor'],
  // Orden personalizado de la tabla de Gastos (por ID). Hoja aparte: reordenar nunca mueve ni reescribe GASTOS.
  ORDEN_GASTOS: ['ID', 'Orden'],
  // Qué gasto pagó qué plantilla (compromiso). Hoja aparte: no cambia el esquema de GASTOS. Plantilla vacía = sin vínculo.
  VINCULOS_PLANTILLAS: ['Gasto ID', 'Plantilla ID', 'Creado en'],
  // Decisiones sobre alertas de calidad (p. ej. "estos movimientos similares son legítimos"). Nunca toca GASTOS.
  REVISIONES_CALIDAD: ['ID revisión', 'Tipo alerta', 'IDs movimientos', 'Estado revisión', 'Firma', 'Creado en', 'Actualizado en'],
  // Fuentes de dinero (v1.8): de dónde sale el presupuesto del mes (General, Sodexo, Extra 1…). Una fuente es
  // configuración reutilizable; su aporte a cada mes se calcula con Recurrencia + Mes de aplicación + FUENTES_MESES.
  FUENTES: ['ID', 'Nombre', 'Monto', 'Moneda', 'Color', 'Icono', 'Activo', 'Orden', 'Recurrencia', 'Mes de aplicación',
    'Medio de pago', 'Creado en', 'Actualizado en'],
  // Importes por mes de cada fuente. Modo "solo" = únicamente ese mes; "desde" = ese mes en adelante (hasta otro "desde").
  // Una fila por fuente + mes + modo: volver a guardar actualiza, nunca duplica ni toca otros meses.
  FUENTES_MESES: ['Fuente ID', 'Mes', 'Monto', 'Modo', 'Actualizado en'],
  // TODAS las plantillas en una sola hoja (v1.19.2). Tipo = fuente | subcaja | gasto (gasto mensual). Solo definiciones
  // reutilizables, nunca movimientos. Estados = JSON por mes (fuente/subcaja). Datos = JSON propio de cada tipo
  // (en 'gasto': ámbito, categoría, subcategoría, tipo de gasto, compromiso, recurrente).
  PLANTILLAS_FINANCIERAS: PF_COLS_,
  // Conciliación de saldos (v1.22): una sola hoja de SOLO AGREGAR. Cada fila es un hecho que nunca se edita ni se borra:
  //  Tipo 'verificacion' = saldo real comprobado vs saldo presupuestario calculado en esa fecha de corte (el calculado es
  //    una foto: no cambia aunque después cambien los gastos); 'seguimiento' = cambio de estado / causa de una verificación
  //    (gana el más reciente); 'grupo' = definición de un grupo de fondos (conjunto de fuentes; gana la más reciente).
  //  Guardar aquí NUNCA toca fuentes, gastos, cajas, presupuestos ni compromisos.
  CONCILIACIONES: ['ID', 'Tipo', 'Conciliación ID', 'Período', 'Fecha de corte', 'Grupo ID', 'Grupo', 'Moneda', 'Saldo presupuestario',
    'Saldo real', 'Diferencia', 'Estado', 'Causa', 'Observación', 'Reemplaza a', 'Referencia', 'Creado en']
};

// Columna que identifica una fila real en cada hoja (índice base 0). Una fila sin clave no es un registro.
var KEY_COL = { GASTOS: 13, CATALOGO: 0, MEDIOS_PAGO: 0, CAJAS: 0, PRESUPUESTOS: 0, CONFIG: 0, PLANTILLAS_FINANCIERAS: 0, ORDEN_GASTOS: 0, VINCULOS_PLANTILLAS: 0, REVISIONES_CALIDAD: 0, FUENTES: 0, FUENTES_MESES: 0, CONCILIACIONES: 0 };

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
// Icono y color predeterminados de los medios conocidos (los mismos que usa la web). Otros medios nuevos los eligen al crearlos.
var MEDIOS_LOOK = {
  yape: ['smartphone', '#7B3FA0'], plin: ['smartphone', '#0B9EA8'], sodexo: ['ticket', '#D2463C'],
  transferencia: ['arrow-left-right', '#3B6FD9'], efectivo: ['banknote', '#22A35A'], otros: ['wallet', '#64748B']
};
function medioLookDef_(nombre) {
  var k = norm_(nombre);
  return MEDIOS_LOOK[k] || (k.indexOf('tarjeta') >= 0 ? ['credit-card', '#475569'] : ['wallet', '#64748B']);
}

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
  ['notificaciones', 'true'],
  ['refresco_segundos', '300'],  // actualización automática de la web (0 = desactivada)
  ['desc_excepciones', '']       // marcas/expresiones con escritura propia para las descripciones, separadas por coma
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
  Object.keys(SHEETS).forEach(function (name) { asegurarHoja_(ss, name); });

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
  return { spreadsheet: ss.getUrl(), apiToken: props.getProperty('API_TOKEN'), hojas: Object.keys(SHEETS).length };
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
  return {
    proyecto: 'https://script.google.com/d/' + ScriptApp.getScriptId() + '/edit',
    spreadsheetId: id || '',
    hoja: id ? SpreadsheetApp.openById(id).getUrl() : '',
    urlApi: url || '',
    respaldos: 'Busca "' + SPREADSHEET_NAME + ' - Respaldo" en Google Drive'
  };
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

// Crea o completa una hoja.
function asegurarHoja_(ss, name) {
  return ensureSheet_(ss, name, SHEETS[name]);
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var current = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  while (current.length && str_(current[current.length - 1]) === '') current.pop(); // celdas vacías al final no son encabezados
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
    .map(function (m) { return [m, true, medioLookDef_(m)[0], medioLookDef_(m)[1]]; }));
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
    // Atajos de iPhone: credencial propia y solo dos acciones (catálogo y registrar un gasto). El token de la web no
    // sirve para ellas y el del atajo no sirve para nada más.
    if (ATAJO_ACTIONS[body.action]) return atajo_(body);
    checkToken_(body.token);
    var fn = ACTIONS[body.action];
    if (!fn) throw appError_('BAD_ACTION', 'Acción no válida: ' + body.action);
    if (READ_ONLY[body.action]) return fn(body.payload || {});
    if (SELF_LOCK[body.action]) { var r = fn(body.payload || {}); invalidateCache_(); return r; }
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
  if (!igualSeguro_(token, expected)) throw appError_('UNAUTHORIZED', 'Token inválido.');
}

// Zona horaria de la app: la de CONFIG (zona_horaria); si falta o no es válida, America/Lima. Se lee una vez por ejecución.
var TZ_ = null;
function tz_() {
  if (TZ_) return TZ_;
  var z = 'America/Lima';
  try {
    var ss = openSpreadsheet_(false);
    if (ss.getSheetByName('CONFIG')) {
      readRows_(ss, 'CONFIG').forEach(function (r) { if (str_(r[0]) === 'zona_horaria' && str_(r[1])) z = str_(r[1]); });
    }
    Utilities.formatDate(new Date(), z, 'yyyy');
  } catch (e) { z = 'America/Lima'; }
  TZ_ = z;
  return z;
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
  var tz = tz_();
  var data = {
    version: APP_VERSION,
    sheetUrl: ss.getUrl(),
    gastos: readRows_(ss, 'GASTOS').map(function (r) { return normalizeGastoRow_(r, tz); }),
    catalogo: readRows_(ss, 'CATALOGO').map(function (r) { return [str_(r[0]), str_(r[1]), str_(r[2]), r[3] !== false && String(r[3]).toUpperCase() !== 'FALSE', str_(r[4]), str_(r[5]), str_(r[6]) === '' ? '' : num_(r[6])]; }),
    medios: readRows_(ss, 'MEDIOS_PAGO').map(function (r) { return [str_(r[0]), r[1] !== false && String(r[1]).toUpperCase() !== 'FALSE', autoVacio_(r[2]), /^#[0-9a-fA-F]{6}$/.test(str_(r[3])) ? str_(r[3]) : '']; }),
    cajas: readRows_(ss, 'CAJAS').map(function (r) { return [str_(r[0]), str_(r[1]), num_(r[2]), str_(r[3]), str_(r[3]) === 'Todos' ? '' : str_(r[4]), str_(r[5]), num_(r[6]), str_(r[7]) === '' ? true : bool_(r[7]), str_(r[8]).replace(/^'/, ''), autoVacio_(r[9])]; }),
    presupuestos: readRows_(ss, 'PRESUPUESTOS').map(function (r) { return [periodo_(r[0], tz), str_(r[1]), num_(r[2])]; }),
    config: readRows_(ss, 'CONFIG').reduce(function (acc, r) { acc[str_(r[0])] = str_(r[1]); return acc; }, {}),
    ordenGastos: ss.getSheetByName('ORDEN_GASTOS') ? readRows_(ss, 'ORDEN_GASTOS').map(function (r) { return [str_(r[0]), num_(r[1])]; }) : [],
    vinculos: ss.getSheetByName('VINCULOS_PLANTILLAS') ? readRows_(ss, 'VINCULOS_PLANTILLAS')
      .filter(function (r) { return str_(r[1]) !== ''; }).map(function (r) { return [str_(r[0]), str_(r[1])]; }) : [],
    revisiones: ss.getSheetByName('REVISIONES_CALIDAD') ? readRows_(ss, 'REVISIONES_CALIDAD').map(function (r) {
      return [str_(r[0]), str_(r[1]), str_(r[2]), str_(r[3]), str_(r[4]).replace(/^'/, ''), r[5] instanceof Date ? r[5].toISOString() : str_(r[5]), r[6] instanceof Date ? r[6].toISOString() : str_(r[6])];
    }) : [],
    fuentes: ss.getSheetByName('FUENTES') ? readRows_(ss, 'FUENTES').map(fuenteOut_) : [],
    fuentesMeses: ss.getSheetByName('FUENTES_MESES') ? readRows_(ss, 'FUENTES_MESES').map(function (r) {
      return [str_(r[0]), periodo_(r[1], tz), num_(r[2]), str_(r[3]) === 'desde' ? 'desde' : 'solo'];
    }) : [],
    plantillasFin: pfTodas_().rows.map(pfOut_),
    conciliaciones: ss.getSheetByName('CONCILIACIONES') ? concLeer_(ss) : []
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

function autoVacio_(v) { v = str_(v).replace(/^'/, ''); return norm_(v) === 'auto' ? '' : v; }  // Icono 'auto' = el automático
// Medios de una fuente: 0, 1 o varios separados por "|". 'Libre' o vacío = ninguno (fuente libre). Sin repetidos.
function libreVacio_(v) {
  var vistos = {}, out = [];
  String(str_(v).replace(/^'/, '')).split('|').forEach(function (x) {
    x = x.trim();
    var k = norm_(x);
    if (!x || k === 'libre' || vistos[k]) return;
    vistos[k] = true; out.push(x);
  });
  return out.join('|');
}
function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
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

var READ_ONLY = { misArchivos: true, autorizarRespaldos: true, data: true, diagnose: true, backup: true, plantillas: true, carpetaRespaldo: true };
// Escrituras que no cambian los datos del dashboard: no invalidan su caché.
var KEEP_CACHE = { savePlantilla: true, deletePlantilla: true, reorderPlantillas: true, saveCarpetaRespaldo: true };

var ACTIONS = {
  data: function (p) { return getData_(p.fresh === true); },
  saveGasto: function (p) { return saveGasto_(p); },
  setEstado: setEstado_,
  setEstadoLote: setEstadoLote_,
  saveCatalogo: saveCatalogo_,
  renameCatalogo: renameCatalogo_,
  reorderCategorias: reorderCategorias_,
  deleteCategoria: deleteCategoria_,
  saveMedio: saveMedio_,
  saveCaja: saveCaja_,
  deleteCaja: deleteCaja_,
  reorderCajas: reorderCajas_,
  savePresupuesto: savePresupuesto_,
  saveConfig: saveConfig_,
  diagnose: diagnose_,
  backup: backup_,
  plantillas: listPlantillas_,
  savePlantilla: savePlantilla_,
  deletePlantilla: deletePlantilla_,
  reorderPlantillas: reorderPlantillas_,
  saveGastosBatch: saveGastosBatch_,
  reorderGastos: reorderGastos_,
  vincularGasto: vincularGasto_,
  saveRevision: saveRevision_,
  saveConciliacion: saveConciliacion_,
  saveSeguimientoConciliacion: saveSeguimientoConciliacion_,
  saveGrupoConciliacion: saveGrupoConciliacion_,
  saveFuente: saveFuente_,
  saveFuenteMes: saveFuenteMes_,
  reorderFuentes: reorderFuentes_,
  savePlantillaFin: savePlantillaFin_,
  deletePlantillaFin: deletePlantillaFin_,
  reorderPlantillasFin: reorderPlantillasFin_,
  aplicarPlantillasFin: aplicarPlantillasFin_,
  aplicarEntidadesMes: aplicarEntidadesMes_,
  deleteFuente: deleteFuente_,
  migrarGeneralAFuente: migrarGeneralAFuente_,
  completarVacios: completarVacios_,
  carpetaRespaldo: carpetaRespaldoInfo_,
  saveCarpetaRespaldo: saveCarpetaRespaldo_,
  // Funciones de mantenimiento: las mismas que se ejecutan desde el editor, ahora también desde Configuración → Funciones del backend.
  setup: function () { return setup(); },
  misArchivos: function () { return misArchivos(); },
  crearTokenAtajo: function () { return { token: crearTokenAtajo() }; },
  revocarTokenAtajo: function () { return revocarTokenAtajo(); },
  autorizarRespaldos: function () { return autorizarRespaldos(); },
  generarDatosPrueba: function () { return generarDatosPrueba(); },
  borrarDatosPrueba: function () { return borrarDatosPrueba(); },
  migrarPlantillas: function () { return migrarPlantillas(); },
  actualizarCatalogo: function () { return actualizarCatalogo(); },
  repararIds: function () { return repararIds(); },
  repararHojas: function () { return repararHojas(); }
};
// Estas ya toman su propio candado (withLock_ no es reentrante): doPost no las envuelve.
var SELF_LOCK = { generarDatosPrueba: true, borrarDatosPrueba: true, migrarPlantillas: true, actualizarCatalogo: true, repararIds: true, repararHojas: true };

function saveGasto_(p, origen) {
  var ss = openSpreadsheet_(false);
  var sh = ss.getSheetByName('GASTOS');
  var g = validateGasto_(p);
  var plId = p.mode === 'create' ? plantillaIdOpcional_(p.plantillaId) : ''; // vínculo solo al crear (clonar o editar no crea compromisos)
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
      if (creado !== actualizado) { if (plId) vincular_(ss, [[g.id, plId]]); return normalizeGastoRow_(ex, tz_()); }
      var redo = gastoToRow_(g, str_(ex[G.ESTADO]) || 'Activo', str_(ex[G.ORIGEN]) || 'web', creado, creado);
      exRange.setValues([redo]);
      if (plId) vincular_(ss, [[g.id, plId]]);
      return normalizeGastoRow_(redo, tz_());
    }
    var row = gastoToRow_(g, 'Activo', origen || 'web', now, now);
    appendRows_(sh, [row]);
    if (plId) vincular_(ss, [[g.id, plId]]);
    return normalizeGastoRow_(row, tz_());
  }
  if (p.mode === 'update') {
    if (!rowIndex) throw appError_('NOT_FOUND', 'El gasto ya no existe en la hoja.');
    var range = sh.getRange(rowIndex, 1, 1, SHEETS.GASTOS.length);
    var prev = range.getValues()[0];
    var updated = gastoToRow_(g, str_(prev[G.ESTADO]) || 'Activo', str_(prev[G.ORIGEN]) || 'web',
      prev[G.CREADO] instanceof Date ? prev[G.CREADO].toISOString() : str_(prev[G.CREADO]), now);
    range.setValues([updated]);
    return normalizeGastoRow_(updated, tz_());
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

// Elimina (Anulado) o restaura varios gastos en UNA petición y una sola lectura de IDs. Todo o nada: si algún ID no existe,
// está repetido o es inválido no se cambia ninguno. Es la misma baja lógica de setEstado_ (recuperable desde "Eliminados").
function setEstadoLote_(p) {
  if (p.estado !== 'Activo' && p.estado !== 'Anulado') throw appError_('VALIDATION', 'Estado inválido.');
  var ids = Array.isArray(p.ids) ? p.ids.map(function (x) { return requireId_(x); }) : [];
  if (!ids.length || ids.length > 200) throw appError_('VALIDATION', 'Elige entre 1 y 200 gastos.');
  var seen = {};
  ids.forEach(function (id) { var k = id.toLowerCase(); if (seen[k]) throw appError_('VALIDATION', 'Hay IDs repetidos en la selección.'); seen[k] = true; });
  var sh = openSpreadsheet_(false).getSheetByName('GASTOS');
  var last = sh.getLastRow();
  var col = last > 1 ? sh.getRange(2, G.ID + 1, last - 1, 1).getValues() : [];
  var filas = {}, veces = {};
  col.forEach(function (r, i) { var k = String(r[0]).toLowerCase(); if (seen[k]) { filas[k] = i + 2; veces[k] = (veces[k] || 0) + 1; } });
  ids.forEach(function (id) {
    var k = id.toLowerCase();
    if (!filas[k]) throw appError_('NOT_FOUND', 'Algún gasto ya no existe en la hoja. Actualiza los datos y vuelve a elegir.');
    if (veces[k] > 1) throw appError_('VALIDATION', 'Un gasto tiene el ID repetido en la hoja. Ejecuta repararIds primero.');
  });
  var now = new Date().toISOString();
  // Dos escrituras en bloque (una por columna) en lugar de dos por gasto: se lee y se escribe el tramo entre la primera y la
  // última fila elegidas, y solo cambian las celdas de los gastos del lote.
  var rows = ids.map(function (id) { return filas[id.toLowerCase()]; });
  var desde = Math.min.apply(null, rows), hasta = Math.max.apply(null, rows);
  [[G.ESTADO + 1, p.estado], [G.ACTUALIZADO + 1, now]].forEach(function (c) {
    var rango = sh.getRange(desde, c[0], hasta - desde + 1, 1);
    var vals = rango.getValues();
    rows.forEach(function (r) { vals[r - desde][0] = c[1]; });
    rango.setValues(vals);
  });
  return { ids: ids, estado: p.estado, actualizadoEn: now };
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
  // Categorías y subcategorías se COMPARTEN entre ámbitos: mismo nombre = mismo icono y color en todos.
  // (Un ámbito es único y no se comparte.) `mismo` identifica las filas hermanas de la que se guarda.
  var compartida = categoria !== '';
  var mismo = function (r) { return norm_(r[1]) === norm_(categoria) && (sub ? norm_(r[2]) === norm_(sub) : str_(r[2]) === ''); };
  for (var i = 0; i < rows.length; i++) {
    if (catKey_(rows[i][0], rows[i][1], rows[i][2]) === key) {
      // null = no cambiar el icono/color guardado. Una opción existente conserva su nombre y su orden.
      var row = [rows[i][0], rows[i][1], rows[i][2], activo, icono === null ? str_(rows[i][4]) : icono, color === null ? str_(rows[i][5]) : color];
      sh.getRange(i + 2, 4, 1, 3).setValues([row.slice(3)]);
      if (compartida && (icono !== null || color !== null)) {
        // Hermanas en los demás ámbitos: reciben el mismo aspecto en una sola escritura de las columnas Icono y Color.
        var cambios = false;
        var aspecto = rows.map(function (r, j) {
          if (j !== i && mismo(r)) {
            var ni = icono === null ? str_(r[4]) : icono, nc = color === null ? str_(r[5]) : color;
            if (ni !== str_(r[4]) || nc !== str_(r[5])) cambios = true;
            return [ni, nc];
          }
          return j === i ? [row[4], row[5]] : [r[4], r[5]];   // la fila editada ya lleva sus valores nuevos
        });
        if (cambios) sh.getRange(2, 5, rows.length, 2).setValues(aspecto);
      }
      return [str_(row[0]), str_(row[1]), str_(row[2]), activo, row[4], row[5], str_(rows[i][6]) === '' ? '' : num_(rows[i][6])];
    }
  }
  if (compartida) {
    // Alta de una categoría/subcategoría que ya existe en otro ámbito: hereda su aspecto (no lo pisa).
    for (var k = 0; k < rows.length; k++) {
      if (mismo(rows[k])) {
        if (str_(rows[k][4])) icono = str_(rows[k][4]);
        if (str_(rows[k][5])) color = str_(rows[k][5]);
        if (str_(rows[k][4]) || str_(rows[k][5])) break;
      }
    }
  }
  // La fila "cabecera" de un ámbito/categoría que ya tiene filas (p. ej. al desactivarla) hereda su Orden mínimo:
  // así no se va al final ni cambia la posición que el usuario le dio.
  var orden = nextOrden_(rows, ambito, categoria, sub);
  if (!sub) {
    var propios = rows.filter(function (r) { return norm_(r[0]) === norm_(ambito) && (!categoria || norm_(r[1]) === norm_(categoria)) && str_(r[6]) !== '' && isFinite(Number(r[6])); });
    if (propios.length) orden = Math.min.apply(null, propios.map(function (r) { return Number(r[6]); }));
  }
  var nuevo = [ambito, categoria, sub, activo, icono || '', color || '', orden];
  appendRows_(sh, [nuevo]);
  return nuevo;
}

// ---- Categorías: orden manual y eliminación segura (v1.15) ----
// El orden de una categoría vive en la columna Orden de CATALOGO (ámbito×10000 + categoría×100 + subcategoría):
// reordenar solo reescribe esa columna de las filas del ámbito. Nunca toca GASTOS, IDs ni relaciones.
function filasDeAmbito_(rows, ambito) { return rows.filter(function (r) { return norm_(r[0]) === norm_(ambito); }); }

function reorderCategorias_(p) {
  var ambito = text_(p.ambito, 'Ámbito', 40, true);
  var nombres = Array.isArray(p.categorias) ? p.categorias.map(str_).filter(Boolean) : [];
  if (!nombres.length || nombres.length > 200) throw appError_('VALIDATION', 'Orden de categorías inválido.');
  var sh = openSpreadsheet_(false).getSheetByName('CATALOGO');
  var n = Math.max(lastDataRow_(sh) - 1, 0);
  if (!n) throw appError_('NOT_FOUND', 'El catálogo está vacío.');
  var rows = sh.getRange(2, 1, n, 7).getValues();
  var delAmbito = [];
  rows.forEach(function (r, i) { if (norm_(r[0]) === norm_(ambito) && str_(r[0]) !== '') delAmbito.push(i); });
  if (!delAmbito.length) throw appError_('NOT_FOUND', 'El ámbito ya no existe. Actualiza los datos.');
  // Base del ámbito: múltiplo de 10000 de su menor Orden; si ninguna fila tiene Orden, el siguiente libre.
  var numeros = delAmbito.map(function (i) { return str_(rows[i][6]) === '' ? null : Number(rows[i][6]); }).filter(function (v) { return v !== null && isFinite(v); });
  var base;
  if (numeros.length) base = Math.floor(Math.min.apply(null, numeros) / 10000) * 10000;
  else {
    var todos = rows.map(function (r) { return Number(r[6]); }).filter(function (v) { return str_(v) !== '' && isFinite(v); });
    base = (todos.length ? Math.floor(Math.max.apply(null, todos) / 10000) + 1 : 1) * 10000;
  }
  // Categorías del ámbito en su orden actual (por Orden y luego por posición) y luego en el orden pedido.
  var actual = [], vistos = {};
  delAmbito.slice().sort(function (a, b) {
    var oa = str_(rows[a][6]) === '' ? Infinity : Number(rows[a][6]), ob = str_(rows[b][6]) === '' ? Infinity : Number(rows[b][6]);
    return (oa - ob) || (a - b);
  }).forEach(function (i) {
    var c = norm_(rows[i][1]);
    if (c && !vistos[c]) { vistos[c] = true; actual.push(c); }
  });
  var pedido = [], usados = {};
  nombres.forEach(function (c) { var k = norm_(c); if (vistos[k] && !usados[k]) { usados[k] = true; pedido.push(k); } });
  actual.forEach(function (k) { if (!usados[k]) { usados[k] = true; pedido.push(k); } });
  var orden = rows.map(function (r) { return [r[6]]; });
  var cambios = 0;
  pedido.forEach(function (k, j) {
    var bloque = base + (j + 1) * 100;
    var filas = delAmbito.filter(function (i) { return norm_(rows[i][1]) === k; });
    var cabeza = filas.filter(function (i) { return str_(rows[i][2]) === ''; });
    var subs = filas.filter(function (i) { return str_(rows[i][2]) !== ''; }).sort(function (a, b) {
      var oa = str_(rows[a][6]) === '' ? Infinity : Number(rows[a][6]), ob = str_(rows[b][6]) === '' ? Infinity : Number(rows[b][6]);
      return (oa - ob) || (a - b);
    });
    cabeza.forEach(function (i) { if (orden[i][0] !== bloque) cambios++; orden[i][0] = bloque; });
    subs.forEach(function (i, m) { if (orden[i][0] !== bloque + m + 1) cambios++; orden[i][0] = bloque + m + 1; });
  });
  if (cambios) sh.getRange(2, 7, n, 1).setValues(orden);
  return { ambito: ambito, categorias: pedido.length, cambios: cambios };
}

function dependenciasCategoria_(ss, ambito, categoria, subs) {
  var amb = norm_(ambito), cat = norm_(categoria);
  var gastos = readRows_(ss, 'GASTOS').filter(function (r) { return norm_(r[G.AMBITO]) === amb && norm_(r[G.CAT]) === cat; }).length;
  var pl = plTodasLectura_(ss).filter(function (r) { return norm_(r[1]) === amb && norm_(r[2]) === cat; });
  var compromisos = pl.filter(function (r) { return bool_(r[11]); }).length;
  // Una subcaja por categoría/subcategoría solo se queda sin gastos si esa opción no existe en otro ámbito.
  var catalogo = readRows_(ss, 'CATALOGO');
  var existeEnOtro = catalogo.some(function (r) { return norm_(r[0]) !== amb && norm_(r[1]) === cat; });
  var nombresSubs = subs.map(norm_);
  var subEnOtro = function (sn) { return catalogo.some(function (r) { return norm_(r[0]) !== amb && norm_(r[2]) === sn; }); };
  var cajas = readRows_(ss, 'CAJAS').filter(function (r) {
    var campo = str_(r[3]), valor = norm_(r[4]);
    if (campo === 'Categoría') return valor === cat && !existeEnOtro;
    if (campo === 'Subcategoría') return nombresSubs.indexOf(valor) >= 0 && !subEnOtro(valor);
    return false;
  }).length;
  return { gastos: gastos, plantillas: pl.length, compromisos: compromisos, cajas: cajas };
}

// Elimina una categoría SOLO si nada la usa. Si tiene subcategorías, hace falta `cascada: true` (autorización expresa).
// Gastos, plantillas, compromisos y subcajas que la usan bloquean la eliminación: en ese caso se desactiva.
function deleteCategoria_(p) {
  var ambito = text_(p.ambito, 'Ámbito', 40, true);
  var categoria = text_(p.categoria, 'Categoría', 60, true);
  var ss = openSpreadsheet_(false);
  var sh = ss.getSheetByName('CATALOGO');
  var filas = readRows_(ss, 'CATALOGO').filter(function (r) { return norm_(r[0]) === norm_(ambito) && norm_(r[1]) === norm_(categoria); });
  if (!filas.length) return { ambito: ambito, categoria: categoria, eliminada: false, subcategorias: 0 };
  var subs = filas.filter(function (r) { return str_(r[2]) !== ''; }).map(function (r) { return str_(r[2]); });
  var deps = dependenciasCategoria_(ss, ambito, categoria, subs);
  if (deps.gastos || deps.plantillas || deps.cajas) {
    var partes = [];
    if (deps.gastos) partes.push(deps.gastos + ' gasto(s)');
    if (deps.plantillas) partes.push(deps.plantillas + ' plantilla(s)' + (deps.compromisos ? ' (' + deps.compromisos + ' compromiso(s))' : ''));
    if (deps.cajas) partes.push(deps.cajas + ' subcaja(s)');
    throw appError_('IN_USE', 'No se puede eliminar “' + categoria + '”: la usan ' + partes.join(', ') + '. Desactívala para conservar el historial.');
  }
  if (subs.length && p.cascada !== true) throw appError_('IN_USE', '“' + categoria + '” tiene ' + subs.length + ' subcategoría(s). Confirma la eliminación en cascada o desactívala.');
  var n = borrarFilasSi_(sh, SHEETS.CATALOGO.length, function (r) { return norm_(r[0]) === norm_(ambito) && norm_(r[1]) === norm_(categoria); });
  return { ambito: ambito, categoria: categoria, eliminada: true, subcategorias: subs.length, filas: n };
}

function saveMedio_(p) {
  var nombre = text_(p.nombre, 'Medio de pago', 40, true);
  if (nombre.indexOf('|') >= 0) throw appError_('VALIDATION', 'El nombre del medio no puede contener “|” (se usa para separar varios medios en una fuente).');
  if (norm_(nombre) === 'libre') throw appError_('VALIDATION', '“Libre” está reservado para las fuentes sin medio de pago. Usa otro nombre.');
  var activo = p.activo !== false;
  var ss = openSpreadsheet_(false);
  var sh = ensureSheet_(ss, 'MEDIOS_PAGO', SHEETS.MEDIOS_PAGO); // hoja anterior (2 columnas): agrega Icono y Color
  var row = findRowByValue_(sh, 1, nombre);
  var actual = row ? sh.getRange(row, 1, 1, 4).getValues()[0] : null;
  var ico = p.icono === undefined ? (actual ? str_(actual[2]) : '') : str_(p.icono).replace(/^'/, '');
  if (norm_(ico) === 'auto') ico = '';
  if (ico && !/^[a-z0-9-]{1,30}$/.test(ico)) throw appError_('VALIDATION', 'Icono inválido.');
  var col = p.color === undefined ? (actual ? str_(actual[3]) : '') : str_(p.color);
  if (col && !/^#[0-9a-fA-F]{6}$/.test(col)) throw appError_('VALIDATION', 'Color inválido.');
  var def = medioLookDef_(nombre);
  var icoSheet = ico || def[0], colSheet = col || def[1];   // la hoja nunca queda con vacíos
  if (row) sh.getRange(row, 2, 1, 3).setValues([[activo, icoSheet, colSheet]]); else appendRows_(sh, [[nombre, activo, icoSheet, colSheet]]);
  return [nombre, activo, icoSheet, colSheet];
}

var CAJA_CAMPOS = ['Todos', 'Ámbito', 'Categoría', 'Subcategoría', 'Medio de pago'];

function cajasSheet_() {
  var ss = openSpreadsheet_(false);
  return ensureSheet_(ss, 'CAJAS', SHEETS.CAJAS); // hoja anterior (7 columnas): agrega Activo y Descripción
}

// Crea o edita una caja. La caja general (Todos) es única y no cambia de alcance. Dos cajas activas no pueden
// tener el mismo alcance y valor (sería ambiguo); los solapamientos entre niveles se resuelven por especificidad.
function saveCaja_(p) {
  var id = text_(p.id, 'ID de caja', 40, true);
  var campo = p.filtroCampo || 'Todos';
  if (CAJA_CAMPOS.indexOf(campo) < 0) throw appError_('VALIDATION', 'Filtro de caja inválido.');
  var activo = p.activo === undefined ? true : p.activo === true;
  var valor = campo === 'Todos' ? '' : text_(p.filtroValor, 'Valor del alcance', 130, true);
  var icono = p.icono === undefined || p.icono === null ? '' : str_(p.icono);
  if (icono && !/^[a-z0-9-]{1,30}$/.test(icono)) throw appError_('VALIDATION', 'Icono inválido.');
  var row = [id, text_(p.nombre, 'Nombre', 40, true), amount_(p.presupuesto, true), campo, campo === 'Todos' ? 'Todos' : valor,
    /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#1e3a8a', num_(p.orden), activo, descText_(p.descripcion, false), icono || 'auto'];
  var sh = cajasSheet_();
  var n = Math.max(lastDataRow_(sh) - 1, 0);
  var rows = n ? sh.getRange(2, 1, n, SHEETS.CAJAS.length).getValues() : [];
  var idx = -1;
  for (var j = 0; j < rows.length; j++) if (str_(rows[j][0]) === id) idx = j;
  if (idx >= 0 && str_(rows[idx][3]) === 'Todos' && campo !== 'Todos') throw appError_('VALIDATION', 'La caja general siempre abarca todos los gastos.');
  for (var i = 0; i < rows.length; i++) {
    var rid = str_(rows[i][0]);
    if (!rid || rid === id) continue;
    var rCampo = str_(rows[i][3]), rActivo = str_(rows[i][7]) === '' ? true : bool_(rows[i][7]);
    if (campo === 'Todos' && rCampo === 'Todos') throw appError_('VALIDATION', 'Ya existe una caja general: solo puede haber una.');
    if (campo !== 'Todos' && activo && rActivo && rCampo === campo && norm_(rows[i][4]) === norm_(valor)) {
      throw appError_('VALIDATION', 'La caja “' + str_(rows[i][1]) + '” ya usa ' + campo + ' = ' + valor + '. Cambia el alcance o desactívala primero.');
    }
  }
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, row.length).setValues([row]); else appendRows_(sh, [row]);
  var out = row.slice();
  out[4] = campo === 'Todos' ? '' : valor;  // lo que lee la web: sin los marcadores de la hoja
  out[9] = autoVacio_(out[9]);
  return out;
}

// Elimina una subcaja (no la general). No toca gastos ni presupuestos: sus gastos pasan a "fuera de subcajas"
// o a otra caja que coincida. Los ajustes mensuales que tuviera quedan en PRESUPUESTOS sin efecto.
function deleteCaja_(p) {
  var id = text_(p.id, 'ID de caja', 40, true);
  var sh = cajasSheet_();
  var row = findRowByValue_(sh, 1, id);
  if (!row) return { id: id, eliminada: false };
  if (str_(sh.getRange(row, 4, 1, 1).getValues()[0][0]) === 'Todos') throw appError_('VALIDATION', 'La caja general no se puede eliminar.');
  sh.deleteRow(row);
  return { id: id, eliminada: true };
}

// Orden manual de las subcajas en una sola escritura de la columna Orden (la general queda primera).
function reorderCajas_(p) {
  var ids = Array.isArray(p.ids) ? p.ids.map(str_) : [];
  if (!ids.length || ids.length > 200) throw appError_('VALIDATION', 'Orden de cajas inválido.');
  var sh = cajasSheet_();
  var n = Math.max(lastDataRow_(sh) - 1, 0);
  if (!n) return { ok: true };
  var rows = sh.getRange(2, 1, n, 7).getValues();
  var pos = {};
  ids.forEach(function (id, i) { pos[id] = i + 2; });
  var extra = ids.length + 2;
  var orden = rows.map(function (r) {
    var id = str_(r[0]);
    if (!id) return [r[6]];
    if (str_(r[3]) === 'Todos') return [1];
    return [pos[id] !== undefined ? pos[id] : extra++];
  });
  sh.getRange(2, 7, n, 1).setValues(orden);
  return { ok: true };
}

function savePresupuesto_(p) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.periodo || '')) throw appError_('VALIDATION', 'Periodo inválido (AAAA-MM).');
  var cajaId = text_(p.cajaId, 'Caja', 40, true);
  var monto = amount_(p.monto, true);
  var sh = openSpreadsheet_(false).getSheetByName('PRESUPUESTOS');
  var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues() : [];
  for (var i = 0; i < rows.length; i++) {
    if (periodo_(rows[i][0], tz_()) === p.periodo && str_(rows[i][1]) === cajaId) {
      sh.getRange(i + 2, 3).setValue(monto);
      return [p.periodo, cajaId, monto];
    }
  }
  appendRows_(sh, [[p.periodo, cajaId, monto]]);
  return [p.periodo, cajaId, monto];
}

/* ===================== Plantillas de fuentes y de subcajas (v1.17) =====================
 * Una plantilla es SOLO configuración reutilizable (hoja PLANTILLAS_FINANCIERAS, Tipo fuente/subcaja). Se distinguen tres cosas:
 *   - la definición de la plantilla (esta hoja),
 *   - la entidad original (FUENTES / CAJAS; se enlaza por "Origen ID"),
 *   - la configuración aplicada a un mes (FUENTES_MESES / PRESUPUESTOS, que ya existían).
 * Guardar o clonar una plantilla nunca crea fuentes, cajas, dinero ni gastos. Aplicarla a un mes escribe solo ese mes
 * y es idempotente. El estado de cada mes (aplicada / omitida) queda en la columna Estados (JSON por mes).
 */
var PF_TIPOS = ['fuente', 'subcaja'];   // tipos "financieros"; los gastos mensuales (Tipo 'gasto') comparten la hoja pero tienen su propio código
var PF_HOJA = 'PLANTILLAS_FINANCIERAS';

function pfRows_(sh) {
  var n = Math.max(lastDataRow_(sh) - 1, 0);
  return n ? sh.getRange(2, 1, n, PF_COLS_.length).getValues() : [];
}

// Hoja única de plantillas, lista para escribir. Si es de una versión anterior (18 columnas) se agrega el encabezado "Datos".
function plantillasFinSheet_() {
  var ss = openSpreadsheet_(false);
  if (!ss.getSheetByName(PF_HOJA)) {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty('PLANTILLAS_FIN_RESPALDO')) props.setProperty('PLANTILLAS_FIN_RESPALDO', backup_().url); // hoja nueva: respaldo previo
  }
  return ensureSheet_(ss, PF_HOJA, PF_COLS_);
}

// Fuentes y subcajas con la hoja y la fila donde viven. No crea la hoja si no existe. Las filas 'gasto' se ignoran.
function pfTodas_() {
  var ss = openSpreadsheet_(false), rows = [], refs = [], sh = ss.getSheetByName(PF_HOJA);
  if (!sh) return { rows: rows, refs: refs };
  pfRows_(sh).forEach(function (r, j) { if (str_(r[0]) && PF_TIPOS.indexOf(str_(r[1])) >= 0) { rows.push(r); refs.push({ sh: sh, fila: j + 2 }); } });
  return { rows: rows, refs: refs };
}

function pfEstados_(raw) {
  try { var o = JSON.parse(str_(raw) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (err) { return {}; }
}

// [id, tipo, nombre, monto, moneda, medios, campo, valor, descripcion, color, icono, recurrencia, activo, orden, origenId, estados, creado, actualizado]
function pfOut_(r) {
  var est = pfEstados_(r[15]), pub = {};
  Object.keys(est).forEach(function (m) { if (est[m] && (est[m].e === 'aplicada' || est[m].e === 'omitida')) pub[m] = { e: est[m].e, m: num_(est[m].m) }; });
  return [str_(r[0]), str_(r[1]), str_(r[2]).replace(/^'/, ''), num_(r[3]), str_(r[4]) || 'PEN', libreVacio_(r[5]), str_(r[6]), str_(r[7]), str_(r[8]),
    str_(r[9]), autoVacio_(r[10]), str_(r[11]) === 'unica' ? 'unica' : 'mensual', str_(r[12]) === '' ? true : bool_(r[12]), num_(r[13]), str_(r[14]), pub, iso_(r[16]), iso_(r[17])];
}

function savePlantillaFin_(p) {
  var id = text_(p.id, 'ID de plantilla', 64, true);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw appError_('VALIDATION', 'ID de plantilla inválido.');
  var tipo = str_(p.tipo);
  if (PF_TIPOS.indexOf(tipo) < 0) throw appError_('VALIDATION', 'Tipo de plantilla inválido.');
  var nombre = text_(p.nombre, 'Nombre de la plantilla', 40, true);
  var monto = amount_(p.monto, true);
  var activo = p.activo === undefined ? true : p.activo === true;
  var origen = str_(p.origenId);
  var ss = openSpreadsheet_(false);
  var moneda = '', medios = '', campo = '', valor = '', recurrencia = 'mensual';
  if (tipo === 'fuente') {
    moneda = monedaPermitida_(ss, p.moneda);
    medios = libreVacio_(text_(p.medios, 'Medios de pago', 400, false));
    recurrencia = p.recurrencia === 'unica' ? 'unica' : 'mensual';
    if (origen && !(ss.getSheetByName('FUENTES') && findRowByValue_(ss.getSheetByName('FUENTES'), 1, origen))) throw appError_('NOT_FOUND', 'La fuente original ya no existe.');
  } else {
    campo = str_(p.campo);
    if (CAJA_CAMPOS.indexOf(campo) < 1) throw appError_('VALIDATION', 'Alcance de subcaja inválido.');
    valor = text_(p.valor, 'Valor del alcance', 130, true);
    if (origen && !(ss.getSheetByName('CAJAS') && findRowByValue_(ss.getSheetByName('CAJAS'), 1, origen))) throw appError_('NOT_FOUND', 'La subcaja original ya no existe.');
  }
  var icono = p.icono === undefined || p.icono === null ? '' : str_(p.icono);
  if (icono && !/^[a-z0-9-]{1,30}$/.test(icono)) throw appError_('VALIDATION', 'Icono inválido.');
  var sh = plantillasFinSheet_();
  var rows = pfRows_(sh);
  var idx = -1, maxOrden = 0;
  for (var i = 0; i < rows.length; i++) {
    var rid = str_(rows[i][0]);
    if (!rid) continue;
    if (str_(rows[i][1]) === tipo) maxOrden = Math.max(maxOrden, num_(rows[i][13]));
    if (rid === id) { idx = i; continue; }
    if (str_(rows[i][1]) !== tipo) continue;
    if (norm_(String(rows[i][2]).replace(/^'/, '')) === norm_(nombre)) throw appError_('VALIDATION', 'Ya existe una plantilla llamada “' + str_(rows[i][2]) + '”.');
    if (origen && str_(rows[i][14]) === origen) throw appError_('DUPLICATE', 'Ya existe una plantilla vinculada a este registro (“' + str_(rows[i][2]) + '”). Edítala en lugar de crear otra.');
  }
  var now = new Date().toISOString(), prev = idx >= 0 ? rows[idx] : null;
  if (prev && str_(prev[1]) !== tipo) throw appError_('VALIDATION', 'No se puede cambiar el tipo de una plantilla.');
  var row = [id, tipo, nombre, monto, moneda, medios || 'Libre', campo, valor, descText_(p.descripcion, false),
    /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#1e3a8a', icono || 'auto', recurrencia, activo,
    prev ? num_(prev[13]) : (p.orden === undefined ? maxOrden + 1 : num_(p.orden)), prev && origen === '' ? str_(prev[14]) : origen,
    prev ? str_(prev[15]) : '', prev ? (iso_(prev[16]) || now) : now, now, prev ? str_(prev[18]) : ''];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, row.length).setValues([row]); else appendRows_(sh, [row]);
  return pfOut_(row);
}

// Elimina solo la definición: no toca la fuente/subcaja original ni lo ya aplicado en meses.
function deletePlantillaFin_(p) {
  var id = text_(p.id, 'ID de plantilla', 64, true);
  var todo = pfTodas_(), i = -1;
  todo.rows.forEach(function (r, k) { if (str_(r[0]) === id) i = k; });
  if (i < 0) return { id: id, eliminada: false };
  todo.refs[i].sh.deleteRow(todo.refs[i].fila);
  return { id: id, eliminada: true };
}

function reorderPlantillasFin_(p) {
  var tipo = str_(p.tipo);
  if (PF_TIPOS.indexOf(tipo) < 0) throw appError_('VALIDATION', 'Tipo de plantilla inválido.');
  var ids = Array.isArray(p.ids) ? p.ids.map(str_) : [];
  if (!ids.length || ids.length > 500) throw appError_('VALIDATION', 'Orden de plantillas inválido.');
  var sh = plantillasFinSheet_();
  var rows = pfRows_(sh);
  if (!rows.length) return { ok: true };
  var pos = {};
  ids.forEach(function (id, i) { pos[id] = i + 1; });
  var extra = ids.length + 1;
  sh.getRange(2, 14, rows.length, 1).setValues(rows.map(function (r) {
    var id = str_(r[0]);
    if (!id || str_(r[1]) !== tipo) return [r[13]];
    return [pos[id] !== undefined ? pos[id] : extra++];
  }));
  return { ok: true };
}

// Importe efectivo de una fuente en un mes (misma regla que la web: "solo" manda; luego "desde"; luego el habitual).
// Mes de corte del aislamiento mensual (CONFIG → aislamiento_desde; por defecto 2026-11). Igual que aislaDesde() en engine.ts.
var AISLAMIENTO_DEFECTO_ = '2026-11';
function aislarDesde_() {
  try {
    var sh = openSpreadsheet_(false).getSheetByName('CONFIG');
    var idx = sh ? findRowByValue_(sh, 1, 'aislamiento_desde') : 0;
    var v = idx ? String(sh.getRange(idx, 2).getValue() || '').trim() : '';
    return /^\d{4}-\d{2}$/.test(v) ? v : AISLAMIENTO_DEFECTO_;
  } catch (e) { return AISLAMIENTO_DEFECTO_; }
}

function fuenteMontoMesGs_(f, mes, meses, aislar) {
  var solo = null, desde = null;
  meses.forEach(function (m) {
    if (m[0] !== f[0]) return;
    if (m[3] === 'solo' && m[1] === mes) solo = m;
    else if (m[3] === 'desde' && m[1] <= mes && (!desde || m[1] > desde[1])) desde = m;
  });
  if (aislar && mes >= aislar) {
    // Desde el corte solo cuenta lo aplicado a ESE mes (importe "solo") o una fuente de un único mes.
    if (solo) return { monto: solo[2], solo: solo[2], aplicada: true };
    var propia = f[8] === 'unica' && mes === f[9];
    return { monto: propia ? f[2] : 0, solo: null, aplicada: propia };
  }
  if (solo) return { monto: solo[2], solo: solo[2], aplicada: true };
  if (f[8] === 'unica') return { monto: mes === f[9] ? f[2] : 0, solo: null, aplicada: true };
  if (desde) return { monto: desde[2], solo: null, aplicada: true };
  return { monto: !f[9] || mes >= f[9] ? f[2] : 0, solo: null, aplicada: true };
}

// ID estable de la fuente/subcaja que nace de una plantilla. Cabe en el límite de cada hoja (caja 40, fuente 64): si el ID de la
// plantilla ("pf-" + UUID = 39) no cabe con el prefijo, se omite su "pf-". Mismo ID de plantilla => mismo ID siempre.
function pfIdSeguro_(prefijo, id, max) {
  var limpio = String(id).replace(/[^A-Za-z0-9_-]/g, '');
  var s = prefijo + limpio;
  if (s.length <= max) return s;
  return (prefijo + limpio.replace(/^pf-/, '')).slice(0, max);
}

/**
 * Aplica, omite o revierte plantillas en UN mes. Todo o nada en la validación; idempotente (aplicar dos veces el mismo
 * importe no cambia nada). Items: [{ id, accion: 'aplicar'|'omitir'|'pendiente', monto }].
 *  - Fuente: si no hay fuente enlazada, la crea una sola vez (ID estable) y enlaza la plantilla. El importe del mes se
 *    guarda en FUENTES_MESES (modo "solo") solo si difiere del que ya rige ese mes.
 *  - Subcaja: igual con CAJAS; el importe del mes va a PRESUPUESTOS. No crea dinero: solo reserva.
 * Se recuerda qué se escribió (w) y el valor previo (p) para poder volver a Pendiente sin perder ajustes anteriores.
 */
function aplicarPlantillasFin_(p) {
  var mes = str_(p.mes);
  if (!MES_RE.test(mes)) throw appError_('VALIDATION', 'Mes inválido (AAAA-MM).');
  var items = Array.isArray(p.items) ? p.items : [];
  if (!items.length || items.length > 60) throw appError_('VALIDATION', 'Selecciona entre 1 y 60 plantillas.');
  var ss = openSpreadsheet_(false);
  var todo = pfTodas_(), rows = todo.rows, refs = todo.refs, porId = {};
  rows.forEach(function (r, i) { if (str_(r[0])) porId[str_(r[0])] = i; });
  var aislar = aislarDesde_();
  var vistos = {};
  var plan = items.map(function (it) {
    var id = text_(it.id, 'ID de plantilla', 64, true);
    if (vistos[id]) throw appError_('VALIDATION', 'Plantilla repetida en la solicitud.');
    vistos[id] = true;
    if (porId[id] === undefined) throw appError_('NOT_FOUND', 'Una plantilla ya no existe. Actualiza los datos.');
    var accion = it.accion === 'omitir' ? 'omitir' : it.accion === 'pendiente' ? 'pendiente' : 'aplicar';
    var r = rows[porId[id]];
    var monto = accion === 'aplicar' ? amount_(it.monto === undefined ? r[3] : it.monto, true) : 0;
    if (accion === 'aplicar' && !(str_(r[12]) === '' ? true : bool_(r[12]))) throw appError_('VALIDATION', 'La plantilla “' + str_(r[2]) + '” está desactivada.');
    return { id: id, idx: porId[id], accion: accion, monto: monto, tipo: str_(r[1]) };
  });
  // Validación previa de lo que habría que crear (para no dejar el lote a medias).
  var fSh = ss.getSheetByName('FUENTES'), cSh = ss.getSheetByName('CAJAS');
  var fRows = fSh ? fuentesRows_(fSh) : [], cRows = cSh ? cSh.getRange(2, 1, Math.max(lastDataRow_(cSh) - 1, 0) || 1, SHEETS.CAJAS.length).getValues() : [];
  plan.forEach(function (it) {
    if (it.accion !== 'aplicar') return;
    var r = rows[it.idx], origen = str_(r[14]);
    if (it.tipo === 'fuente') {
      if (origen && fRows.some(function (x) { return str_(x[0]) === origen; })) return;
      var nom = norm_(String(r[2]).replace(/^'/, ''));
      if (fRows.some(function (x) { return norm_(String(x[1]).replace(/^'/, '')) === nom; }) && !fRows.some(function (x) { return str_(x[0]) === pfIdSeguro_('f-', r[0], 60); }))
        throw appError_('VALIDATION', 'Ya existe una fuente llamada “' + str_(r[2]) + '”. Enlaza la plantilla a esa fuente (Guardar como plantilla desde ella).');
    } else {
      if (origen && cRows.some(function (x) { return str_(x[0]) === origen; })) return;
      if (cRows.some(function (x) { return str_(x[0]) !== pfIdSeguro_('c-', r[0], 40) && (str_(x[7]) === '' ? true : bool_(x[7])) && str_(x[3]) === str_(r[6]) && norm_(x[4]) === norm_(r[7]); }))
        throw appError_('VALIDATION', 'Ya existe una subcaja con el alcance de “' + str_(r[2]) + '”. Enlaza la plantilla a esa subcaja.');
    }
  });

  var mesesRows = function () { return ss.getSheetByName('FUENTES_MESES') ? readRows_(ss, 'FUENTES_MESES').map(function (x) { return [str_(x[0]), periodo_(x[1], tz_()), num_(x[2]), str_(x[3]) === 'desde' ? 'desde' : 'solo']; }) : []; };
  var pres = function (cajaId) {
    var out = readRows_(ss, 'PRESUPUESTOS').filter(function (x) { return periodo_(x[0], tz_()) === mes && str_(x[1]) === cajaId; });
    return out.length ? num_(out[0][2]) : null;
  };
  var revertir = function (r, est) {
    if (!est || est.e !== 'aplicada' || !est.w) return;
    var origen = str_(r[14]);
    // Si la entidad ya no existe no hay nada que revertir (y escribir sobre un ID inexistente fallaría).
    if (str_(r[1]) === 'fuente' ? !fRows.some(function (x) { return str_(x[0]) === origen; }) : !cRows.some(function (x) { return str_(x[0]) === origen; })) return;
    if (str_(r[1]) === 'fuente') {
      if (est.p === null || est.p === undefined) saveFuenteMes_({ fuenteId: origen, mes: mes, modo: 'solo', quitar: true });
      else saveFuenteMes_({ fuenteId: origen, mes: mes, modo: 'solo', monto: est.p });
    } else {
      if (est.p === null || est.p === undefined) {
        var psh = ss.getSheetByName('PRESUPUESTOS');
        borrarFilasSi_(psh, SHEETS.PRESUPUESTOS.length, function (x) { return periodo_(x[0], tz_()) === mes && str_(x[1]) === origen; });
      } else savePresupuesto_({ periodo: mes, cajaId: origen, monto: est.p });
    }
  };

  var salida = [];
  plan.forEach(function (it) {
    var r = rows[it.idx], est = pfEstados_(r[15]), act = est[mes];
    // v1.20.1: la marca "aplicada" de la plantilla NO basta. Solo es "sin cambios" si la fuente/subcaja EXISTE y su importe real del mes
    // coincide; si la hoja quedó sin la entidad (borrada, restaurada, migrada), se vuelve a crear y a aplicar en vez de dar un falso OK.
    var sana = function () {
      var origenS = str_(r[14]) || pfIdSeguro_(it.tipo === 'fuente' ? 'f-' : 'c-', r[0], it.tipo === 'fuente' ? 60 : 40);
      if (it.tipo === 'fuente') {
        var fila = fRows.filter(function (x) { return str_(x[0]) === origenS; })[0];
        if (!fila) return false;
        var e0 = fuenteMontoMesGs_(fuenteOut_(fila), mes, mesesRows(), aislar);
        return !!e0.aplicada && Math.round(it.monto * 100) === Math.round(e0.monto * 100);
      }
      var caja0 = cRows.filter(function (x) { return str_(x[0]) === origenS; })[0];
      if (!caja0) return false;
      var pr = pres(origenS);
      if (mes >= aislar && pr === null) return false;
      return Math.round(it.monto * 100) === Math.round((pr === null ? num_(caja0[2]) : pr) * 100);
    };
    if (it.accion === 'aplicar' && act && act.e === 'aplicada' && num_(act.m) === it.monto && sana()) { salida.push(pfOut_(r)); return; } // ya aplicada igual y verificada: no hace nada
    if (act && act.e === 'aplicada') { revertir(r, act); act = null; }
    if (it.accion === 'pendiente') delete est[mes];
    else if (it.accion === 'omitir') est[mes] = { e: 'omitida', m: 0 };
    else {
      var origen = str_(r[14]), w = false, prev = null;
      if (it.tipo === 'fuente') {
        if (!origen || !fRows.some(function (x) { return str_(x[0]) === origen; })) {
          origen = pfIdSeguro_('f-', r[0], 60);
          fSh = fuentesSheets_().fuentes;
          if (!findRowByValue_(fSh, 1, origen)) saveFuente_({ id: origen, nombre: str_(r[2]).replace(/^'/, ''), monto: num_(r[3]), moneda: str_(r[4]), color: str_(r[9]), icono: autoVacio_(r[10]) || 'auto',
            recurrencia: str_(r[11]) === 'unica' ? 'unica' : 'mensual', mes: mes, activo: true, medioPago: libreVacio_(r[5]), orden: fRows.length + 1 });
          fRows = fuentesRows_(fSh);
        }
        var f = fuenteOut_(fRows.filter(function (x) { return str_(x[0]) === origen; })[0]);
        var ms = mesesRows(), ef = fuenteMontoMesGs_(f, mes, ms, aislar);
        prev = ef.solo;
        if (Math.round(it.monto * 100) !== Math.round(ef.monto * 100) || !ef.aplicada) { saveFuenteMes_({ fuenteId: origen, mes: mes, modo: 'solo', monto: it.monto }); w = true; }
      } else {
        if (!origen || !cRows.some(function (x) { return str_(x[0]) === origen; })) {
          origen = pfIdSeguro_('c-', r[0], 40);
          cSh = cajasSheet_();
          if (!findRowByValue_(cSh, 1, origen)) saveCaja_({ id: origen, nombre: str_(r[2]).replace(/^'/, ''), presupuesto: num_(r[3]), filtroCampo: str_(r[6]), filtroValor: str_(r[7]),
            color: str_(r[9]), icono: autoVacio_(r[10]) || '', activo: true, descripcion: str_(r[8]), orden: cRows.length + 1 });
          cRows = cSh.getRange(2, 1, Math.max(lastDataRow_(cSh) - 1, 0) || 1, SHEETS.CAJAS.length).getValues();
        }
        var caja = cRows.filter(function (x) { return str_(x[0]) === origen; })[0];
        var previo = pres(origen), aisl = mes >= aislar, efc = previo === null ? (aisl ? 0 : num_(caja[2])) : previo;
        prev = previo;
        if (Math.round(it.monto * 100) !== Math.round(efc * 100) || (aisl && previo === null)) { savePresupuesto_({ periodo: mes, cajaId: origen, monto: it.monto }); w = true; }
      }
      est[mes] = { e: 'aplicada', m: it.monto, w: w, p: prev };
      r[14] = origen;
    }
    var meses = Object.keys(est).sort();
    while (meses.length > 36) delete est[meses.shift()];
    r[15] = JSON.stringify(est);
    r[17] = new Date().toISOString();
    refs[it.idx].sh.getRange(refs[it.idx].fila, 1, 1, r.length).setValues([r]);
    salida.push(pfOut_(r));
  });
  return { mes: mes, plantillas: salida };
}

/**
 * Aplica fuentes o subcajas EXISTENTES a un mes (Usar mes anterior, Nueva fuente/subcaja del mes, asistente). Sin plantilla.
 * Items: [{ id, monto }] (id = ID de la fuente o subcaja). Idempotente: si el mes ya tiene ese importe no escribe nada.
 * Todo o nada en la validación. No toca otros meses, gastos ni la definición de la entidad.
 */
function aplicarEntidadesMes_(p) {
  var tipo = str_(p.tipo) === 'subcaja' ? 'subcaja' : str_(p.tipo) === 'fuente' ? 'fuente' : '';
  if (!tipo) throw appError_('VALIDATION', 'Tipo inválido.');
  var mes = str_(p.mes);
  if (!MES_RE.test(mes)) throw appError_('VALIDATION', 'Mes inválido (AAAA-MM).');
  var items = Array.isArray(p.items) ? p.items : [];
  if (!items.length || items.length > 60) throw appError_('VALIDATION', 'Selecciona entre 1 y 60 elementos.');
  var ss = openSpreadsheet_(false), aislar = aislarDesde_();
  var fRows = tipo === 'fuente' ? fuentesRows_(fuentesSheets_().fuentes) : [];
  var cSh = ss.getSheetByName('CAJAS');
  var cRows = tipo === 'subcaja' && cSh ? cSh.getRange(2, 1, Math.max(lastDataRow_(cSh) - 1, 0) || 1, SHEETS.CAJAS.length).getValues() : [];
  var vistos = {};
  var plan = items.map(function (it) {
    var id = text_(it.id, 'ID', 64, true);
    if (vistos[id]) throw appError_('VALIDATION', 'Elemento repetido en la solicitud.');
    vistos[id] = true;
    var fila = (tipo === 'fuente' ? fRows : cRows).filter(function (x) { return str_(x[0]) === id; })[0];
    if (!fila) throw appError_('NOT_FOUND', 'Una ' + tipo + ' ya no existe. Actualiza los datos.');
    return { id: id, fila: fila, monto: amount_(it.monto, true) };
  });
  var escritas = 0;
  var ms = tipo === 'fuente' ? readRows_(ss, 'FUENTES_MESES').map(function (x) { return [str_(x[0]), periodo_(x[1], tz_()), num_(x[2]), str_(x[3]) === 'desde' ? 'desde' : 'solo']; }) : [];
  var presRows = tipo === 'subcaja' ? readRows_(ss, 'PRESUPUESTOS').filter(function (x) { return periodo_(x[0], tz_()) === mes; }) : [];
  plan.forEach(function (it) {
    if (tipo === 'fuente') {
      var f = fuenteOut_(it.fila), ef = fuenteMontoMesGs_(f, mes, ms, aislar);
      if (Math.round(it.monto * 100) !== Math.round(ef.monto * 100) || !ef.aplicada) { saveFuenteMes_({ fuenteId: it.id, mes: mes, modo: 'solo', monto: it.monto }); escritas++; }
    } else {
      var previo = presRows.filter(function (x) { return str_(x[1]) === it.id; })[0];
      var aisl = mes >= aislar, efc = previo ? num_(previo[2]) : (aisl ? 0 : num_(it.fila[2]));
      if (Math.round(it.monto * 100) !== Math.round(efc * 100) || (aisl && !previo)) { savePresupuesto_({ periodo: mes, cajaId: it.id, monto: it.monto }); escritas++; }
    }
  });
  return { tipo: tipo, mes: mes, aplicadas: plan.length, escritas: escritas };
}

/* ===================== Datos de prueba (julio–septiembre 2026) ===================== */
/*
 * generarDatosPrueba(): agrega ~25 gastos por mes en jul/ago/sep 2026 con todas las casuísticas de Salud financiera
 * (compromisos cubiertos, parciales, pendientes, sin monto, en USD y con exceso; errores de calidad; duplicados;
 * clasificación inválida e histórica; nuevos ámbitos, categorías, subcategorías y medios; una fuente de presupuesto).
 * Todo queda marcado: gastos con Origen = "prueba", y lo demás registrado en la propiedad PRUEBA_DATOS.
 * borrarDatosPrueba() elimina exactamente eso y nada más. Ambas hacen un respaldo antes. Ejecútalas desde el editor.
 */
var PRUEBA_ORIGEN = 'prueba';
var PRUEBA_FUENTE = 'f-prueba-presupuesto';

function generarDatosPrueba() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('PRUEBA_DATOS')) throw new Error('Ya hay datos de prueba. Ejecuta borrarDatosPrueba() antes de volver a generarlos.');
  var ss = openSpreadsheet_(false);
  var respaldo = backup_();
  var reg = { plantillas: [], catalogo: [], medios: [], respaldo: respaldo.url };
  return withLock_(function () {
    var now = new Date().toISOString();
    // ---------- Catálogo: un ámbito nuevo, categorías y subcategorías nuevas, una histórica (inactiva) y una fila repetida ----------
    var catSh = ss.getSheetByName('CATALOGO');
    var existentes = {};
    readRows_(ss, 'CATALOGO').forEach(function (r) { existentes[catKey_(r[0], r[1], r[2])] = true; });
    var nuevasCat = [
      ['Mascotas', '', '', true, 'paw-print', '#6B8E23'],
      ['Mascotas', 'Alimento mascota', '', true, 'bone', '#6B8E23'], ['Mascotas', 'Alimento mascota', 'Croquetas', true, '', ''], ['Mascotas', 'Alimento mascota', 'Snacks', true, '', ''],
      ['Mascotas', 'Veterinaria', '', true, 'stethoscope', '#0E8FA8'], ['Mascotas', 'Veterinaria', 'Consultas', true, '', ''], ['Mascotas', 'Veterinaria', 'Vacunas', true, '', ''],
      ['Mascotas', 'Veterinaria', 'Baño antiguo', false, '', ''],                 // inactiva: sus gastos salen como "histórica reconocida"
      ['Personal', 'Gimnasio', '', true, 'dumbbell', '#2F9E6B'], ['Personal', 'Gimnasio', 'Mensualidad', true, '', ''], ['Personal', 'Gimnasio', 'Suplementos', true, '', '']
    ].filter(function (r) { return !existentes[catKey_(r[0], r[1], r[2])]; });
    if (!existentes[catKey_('Mascotas', 'Veterinaria', 'Vacunas')]) nuevasCat.push(['Mascotas', 'Veterinaria', 'Vacunas', true, '', '']); // repetida a propósito: alerta de Catálogo
    var filasCat = nuevasCat.map(function (r) { return r.concat(['']); });
    appendRows_(catSh, filasCat);
    reg.catalogo = filasCat.map(function (r) { return catKey_(r[0], r[1], r[2]); });
    // ---------- Medios de pago: uno nuevo activo y uno inactivo ----------
    var medSh = ss.getSheetByName('MEDIOS_PAGO');
    var medEx = {};
    readRows_(ss, 'MEDIOS_PAGO').forEach(function (r) { medEx[norm_(r[0])] = true; });
    var nuevosMed = [['Tarjeta de crédito', true, 'credit-card', '#475569'], ['BIM', false, 'wallet', '#64748B']].filter(function (m) { return !medEx[norm_(m[0])]; });
    appendRows_(medSh, nuevosMed);
    reg.medios = nuevosMed.map(function (m) { return m[0]; });
    // ---------- Compromisos de prueba (plantillas marcadas como compromiso) ----------
    var plSh = plHoja_(true);
    var pl = {};
    var defs = [
      ['luz', 'Familia', 'Servicios', 'Luz', 'Luz (prueba)', 60, 'PEN', 'Yape'],
      ['internet', 'Familia', 'Servicios', 'Internet', 'Internet (prueba)', 95, 'PEN', 'Yape'],
      ['gym', 'Personal', 'Gimnasio', 'Mensualidad', 'Gimnasio (prueba)', 120, 'PEN', 'Tarjeta de crédito'],
      ['seguro', 'Personal', 'Auto', 'Seguro Vehicular', 'Seguro auto (prueba)', '', 'PEN', 'Transferencia'],
      ['cuidado', 'Familia', 'Bebé', 'Cuidado Infantil', 'Cuidado infantil (prueba)', 480, 'PEN', 'Yape'],
      ['claude', 'Personal', 'Suscripciones', 'Claude', 'Claude (prueba)', 20, 'USD', 'Tarjeta de crédito'],
      ['netflix', 'Personal', 'Suscripciones', 'Netflix', 'Netflix (prueba)', 45, 'PEN', 'Tarjeta de crédito']
    ];
    var ordenBase = plLeer_(plSh).length + 1;
    appendRows_(plSh, defs.map(function (d, i) {
      var id = 'pl-' + Utilities.getUuid();
      pl[d[0]] = id; reg.plantillas.push(id);
      return plGastoAFila_([id, d[1], d[2], d[3], d[4], now, now, d[5], d[6], d[7], ordenBase + i, true, 'Fijo', true]);
    }));
    // ---------- Gastos ----------
    var gastos = [], vinc = [];
    var g = function (fecha, monto, moneda, amb, cat, sub, desc, medio, opts) {
      opts = opts || {};
      var id = opts.id || Utilities.getUuid();
      gastos.push([fecha, monto, moneda, cat, sub, desc, medio, opts.tipo || 'Variable', amb, !!opts.plantilla, opts.estado || 'Activo', PRUEBA_ORIGEN, '', id, now, now]);
      if (opts.plantilla) vinc.push([id, pl[opts.plantilla], now]);
    };
    var meses = ['2026-07', '2026-08', '2026-09'];
    meses.forEach(function (m, k) {
      var d = function (n) { return m + '-' + (n < 10 ? '0' + n : n); };
      // Compromisos: cada mes con un comportamiento distinto
      g(d(3), [58, 61, 55][k], 'PEN', 'Familia', 'Servicios', 'Luz', 'Luz', 'Yape', { tipo: 'Fijo', plantilla: 'luz' });            // jul cubierto, ago exceso, sep parcial
      g(d(4), 95, 'PEN', 'Familia', 'Servicios', 'Internet', 'Internet', 'Yape', { tipo: 'Fijo', plantilla: 'internet' });           // siempre cubierto
      if (k === 0) g(d(5), 120, 'PEN', 'Personal', 'Gimnasio', 'Mensualidad', 'Gimnasio', 'Tarjeta de crédito', { tipo: 'Fijo', plantilla: 'gym' });
      if (k === 1) g(d(5), 60, 'PEN', 'Personal', 'Gimnasio', 'Mensualidad', 'Gimnasio (mitad)', 'Tarjeta de crédito', { tipo: 'Fijo', plantilla: 'gym' }); // parcial; sep pendiente
      if (k !== 1) g(d(8), 150, 'PEN', 'Personal', 'Auto', 'Seguro Vehicular', 'Seguro auto', 'Transferencia', { tipo: 'Fijo', plantilla: 'seguro' }); // sin monto: estimado
      if (k !== 2) g(d(6), 480, 'PEN', 'Familia', 'Bebé', 'Cuidado Infantil', 'Cuidado infantil', 'Yape', { tipo: 'Fijo', plantilla: 'cuidado' }); // sep pendiente
      g(d(10), 20, 'USD', 'Personal', 'Suscripciones', 'Claude', 'Claude Pro', 'Tarjeta de crédito', { tipo: 'Fijo', plantilla: 'claude' }); // en dólares
      g(d(12), 45, 'PEN', 'Personal', 'Suscripciones', 'Netflix', 'Netflix', 'Tarjeta de crédito', { tipo: 'Fijo', plantilla: 'netflix' });
      if (k === 1) g(d(12), 45, 'PEN', 'Personal', 'Suscripciones', 'Netflix', 'Netflix', 'Tarjeta de crédito', { tipo: 'Fijo', plantilla: 'netflix' }); // cobro doble: duplicado + exceso
      // Gastos del día a día (delivery sube, taxi baja, mascotas nuevo, Sodexo, pareja)
      [2, 6, 9, 13, 16, 20, 23, 27].forEach(function (dia, i) { g(d(dia), 12 + ((i * 7 + k * 3) % 9), 'PEN', 'Personal', 'Alimentación', 'Almuerzo', 'Menú', i % 3 ? 'Sodexo' : 'Yape'); });
      for (var x = 0; x < [2, 3, 5][k]; x++) g(d(7 + x * 5), [30, 35, 42][k] + x, 'PEN', 'Personal', 'Alimentación', 'Delivery', 'Delivery', 'Plin');
      for (var y = 0; y < [4, 2, 1][k]; y++) g(d(11 + y * 4), 9 + y, 'PEN', 'Personal', 'Transporte', 'Taxi', 'Taxi', 'Efectivo');
      g(d(14), [180, 210, 260][k], 'PEN', 'Familia', 'Hogar', 'Supermercado', 'Supermercado', 'Tarjeta de crédito');
      g(d(15), 90, 'PEN', 'Mascotas', 'Alimento mascota', 'Croquetas', 'Croquetas Rocco', 'Yape');
      if (k === 1) g(d(18), 70, 'PEN', 'Mascotas', 'Veterinaria', 'Vacunas', 'Vacuna anual', 'Tarjeta de crédito');
      g(d(19), [40, 55, 38][k], 'PEN', 'Personal', 'Auto', 'Gasolina', 'Grifo', 'Plin');
      g(d(21), [35, 0, 70][k] || 25, 'PEN', 'Pareja', 'Salidas', 'Cine', 'Cine', 'Yape');
      g(d(24), 100, 'PEN', 'Familia', 'Apoyo Familiar', 'Madre', 'Propina Madre', 'Yape');
      g(d(25), [18, 22, 30][k], 'PEN', 'Personal', 'Salud', 'Medicamentos', 'Farmacia', 'Efectivo');
    });
    // ---------- Casos para Calidad de datos ----------
    g('2026-07-17', 35, 'PEN', 'Mascotas', 'Veterinaria', 'Baño antiguo', 'Baño Rocco', 'Yape');               // histórica reconocida
    g('2026-07-22', 25, 'PEN', 'Personal', 'Alimentación', 'Cena', 'Cena con BIM', 'BIM');                      // medio inactivo (válido)
    g('2026-07-26', 15, 'PEN', 'Personal', 'Alimentación', 'Snack / Antojos', 'Pago cripto', 'Bitcoin');        // medio desconocido
    g('2026-07-29', 60, 'PEN', 'Pareja', 'Salidas', 'Cine', 'Entrada anulada', 'Yape', { estado: 'Anulado' }); // anulado: no cuenta
    g('2026-08-09', 0, 'PEN', 'Personal', 'Alimentación', 'Bebidas', 'Monto en cero', 'Yape');                  // monto inválido
    g('2026-08-16', 20, 'PEN', 'Personal', 'Alimentación', 'Cena', 'Pendiente de confirmar', 'Yape', { estado: 'Pendiente' }); // estado raro
    g('2026-08-22', 38, 'PEN', 'Pareja', 'Alimentación', 'Cena', 'Norkys', 'Plin');                             // duplicado exacto ↓
    g('2026-08-22', 38, 'PEN', 'Pareja', 'Alimentación', 'Cena', 'Norkys', 'Plin');
    g('2026-09-03', 45, 'PEN', 'Personal', 'Bebé', 'Pañales', 'Pañales (mal clasificado)', 'Yape');            // clasificación inválida
    g('2026-09-11', 12, 'EUR', 'Personal', 'Suscripciones', 'Otros', 'App en euros', 'Tarjeta de crédito');     // moneda no configurada
    g('2026-09-17', 150, 'PEN', 'Vacaciones', 'Viajes', 'Hotel', 'Hotel Paracas', 'Tarjeta de crédito');      // ámbito inexistente
    g('2026-09-31', 22, 'PEN', 'Personal', 'Alimentación', 'Almuerzo', 'Fecha imposible', 'Yape');             // fecha inválida
    g('2026-09-20', 10, 'PEN', 'Personal', 'Alimentación', 'Bebidas', 'ID mal escrito', 'Yape', { id: 'prueba-id-invalido' });
    var repetido = Utilities.getUuid();
    g('2026-09-21', 11, 'PEN', 'Personal', 'Alimentación', 'Bebidas', 'ID repetido A', 'Yape', { id: repetido });
    g('2026-09-22', 13, 'PEN', 'Personal', 'Alimentación', 'Bebidas', 'ID repetido B', 'Yape', { id: repetido });
    appendRows_(ss.getSheetByName('GASTOS'), gastos);
    vincular_(ss, vinc.map(function (v) { return [v[0], v[1]]; }));
    // ---------- Presupuesto de jul–sep: fuente de un solo mes con importes propios (no afecta octubre) ----------
    var h = fuentesSheets_();
    appendRows_(h.fuentes, [[PRUEBA_FUENTE, 'Presupuesto prueba (jul–sep)', 2500, 'PEN', '#6366F1', '', true, 99, 'unica', '2026-07', '', now, now]]);
    appendRows_(h.meses, [[PRUEBA_FUENTE, '2026-08', 2500, 'solo', now], [PRUEBA_FUENTE, '2026-09', 1500, 'solo', now]]);
    props.setProperty('PRUEBA_DATOS', JSON.stringify(reg));
    invalidateCache_();
    var resumen = { gastos: gastos.length, vinculos: vinc.length, compromisos: reg.plantillas.length, catalogo: filasCat.length, medios: reg.medios.length, respaldo: respaldo.url };
    Logger.log('Datos de prueba creados: ' + JSON.stringify(resumen));
    return resumen;
  });
}

// Borra filas que cumplen la condición, de abajo hacia arriba y por bloques contiguos (pocas llamadas).
function borrarFilasSi_(sh, ancho, cumple) {
  var n = Math.max(lastDataRow_(sh) - 1, 0);
  if (!n) return 0;
  var rows = sh.getRange(2, 1, n, ancho).getValues();
  var borradas = 0;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (!cumple(rows[i])) continue;
    var fin = i;
    while (i - 1 >= 0 && cumple(rows[i - 1])) i--;
    sh.deleteRows(i + 2, fin - i + 1);
    borradas += fin - i + 1;
  }
  return borradas;
}

function borrarDatosPrueba() {
  var props = PropertiesService.getScriptProperties();
  var reg = JSON.parse(props.getProperty('PRUEBA_DATOS') || 'null');
  var ss = openSpreadsheet_(false);
  var respaldo = backup_();
  return withLock_(function () {
    var gSh = ss.getSheetByName('GASTOS');
    var ids = {};
    var n = Math.max(lastDataRow_(gSh) - 1, 0);
    (n ? gSh.getRange(2, 1, n, SHEETS.GASTOS.length).getValues() : []).forEach(function (r) { if (str_(r[G.ORIGEN]) === PRUEBA_ORIGEN) ids[str_(r[G.ID]).toLowerCase()] = true; });
    var out = { gastos: borrarFilasSi_(gSh, SHEETS.GASTOS.length, function (r) { return str_(r[G.ORIGEN]) === PRUEBA_ORIGEN; }) };
    var vSh = ss.getSheetByName('VINCULOS_PLANTILLAS');
    var pls = {};
    ((reg && reg.plantillas) || []).forEach(function (id) { pls[id] = true; });
    out.vinculos = vSh ? borrarFilasSi_(vSh, 3, function (r) { return ids[str_(r[0]).toLowerCase()] || pls[str_(r[1])]; }) : 0;
    var plSh = ss.getSheetByName(PF_HOJA);
    out.compromisos = plSh ? borrarFilasSi_(plSh, PF_COLS_.length, function (r) { return str_(r[1]) === 'gasto' && pls[str_(r[0])]; }) : 0;
    var claves = {};
    ((reg && reg.catalogo) || []).forEach(function (k) { claves[k] = true; });
    out.catalogo = borrarFilasSi_(ss.getSheetByName('CATALOGO'), 3, function (r) { return claves[catKey_(r[0], r[1], r[2])]; });
    var medios = {};
    ((reg && reg.medios) || []).forEach(function (m) { medios[norm_(m)] = true; });
    out.medios = borrarFilasSi_(ss.getSheetByName('MEDIOS_PAGO'), 1, function (r) { return medios[norm_(r[0])]; });
    var fSh = ss.getSheetByName('FUENTES'), fmSh = ss.getSheetByName('FUENTES_MESES');
    out.fuentes = fSh ? borrarFilasSi_(fSh, 1, function (r) { return str_(r[0]) === PRUEBA_FUENTE; }) : 0;
    if (fmSh) borrarFilasSi_(fmSh, 1, function (r) { return str_(r[0]) === PRUEBA_FUENTE; });
    props.deleteProperty('PRUEBA_DATOS');
    invalidateCache_();
    out.respaldo = respaldo.url;
    Logger.log('Datos de prueba eliminados: ' + JSON.stringify(out));
    return out;
  });
}

/* ===================== Atajos de iPhone (v1.9) ===================== */
/*
 * Credencial separada (propiedad ATAJO_TOKEN), revocable y de alcance mínimo: solo lee el catálogo activo
 * (sin movimientos) y registra UN gasto validado. Viaja en el cuerpo del POST (nunca en la URL).
 * Créala con crearTokenAtajo() y revócala con revocarTokenAtajo() desde el editor de Apps Script.
 */
var ATAJO_ACTIONS = { atajoCatalogo: true, atajoGasto: true };
var ATAJO_MAX_POR_MIN = 20;      // escrituras por minuto
var ATAJO_MAX_FALLOS = 10;       // tokens inválidos por 10 minutos antes de bloquear

function crearTokenAtajo() {
  var t = 'atj_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  PropertiesService.getScriptProperties().setProperty('ATAJO_TOKEN', t);
  Logger.log('Token del atajo (cópialo solo en tu iPhone; no lo compartas): ' + t);
  return t;
}

function revocarTokenAtajo() {
  PropertiesService.getScriptProperties().deleteProperty('ATAJO_TOKEN');
  Logger.log('Token del atajo revocado: el atajo dejará de funcionar hasta crear uno nuevo.');
  return { revocado: true };
}

function igualSeguro_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function atajo_(body) {
  var cache = CacheService.getScriptCache();
  var fallos = Number(cache.get('atajo:fallos') || 0);
  if (fallos >= ATAJO_MAX_FALLOS) throw appError_('LOCKED', 'Demasiados intentos con un token inválido. Espera 10 minutos.');
  var expected = PropertiesService.getScriptProperties().getProperty('ATAJO_TOKEN');
  if (!expected) throw appError_('NOT_ENABLED', 'El atajo no está habilitado: ejecuta crearTokenAtajo() en Apps Script.');
  if (!igualSeguro_(body.token, expected)) {
    cache.put('atajo:fallos', String(fallos + 1), 600);
    throw appError_('UNAUTHORIZED', 'Token del atajo inválido.');
  }
  if (body.action === 'atajoCatalogo') return atajoCatalogo_();
  var minuto = 'atajo:min:' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(minuto) || 0);
  if (n >= ATAJO_MAX_POR_MIN) throw appError_('RATE_LIMIT', 'Demasiados registros seguidos. Intenta en un minuto.');
  cache.put(minuto, String(n + 1), 120);
  return withLock_(function () {
    var r = atajoGasto_(body.payload || {});
    invalidateCache_();
    return r;
  });
}

// Catálogo activo para los selectores dependientes del atajo. Listas ya ordenadas ("Otros" al final).
function atajoCatalogo_() {
  var ss = openSpreadsheet_(false);
  var rows = readRows_(ss, 'CATALOGO');
  var activo = function (r) { return r[3] !== false && String(r[3]).toUpperCase() !== 'FALSE'; };
  var off = {};
  rows.forEach(function (r) { if (!activo(r)) off[catKey_(r[0], r[1], r[2])] = true; });
  var vigente = function (r) {
    return activo(r) && !off[catKey_(r[0], '', '')] && (!str_(r[1]) || !off[catKey_(r[0], r[1], '')]);
  };
  var orden = function (list) {
    return list.sort(function (a, b) {
      var oa = norm_(a.n) === 'otros' ? 1 : 0, ob = norm_(b.n) === 'otros' ? 1 : 0;
      return oa - ob || a.o - b.o;
    }).map(function (x) { return x.n; });
  };
  var amb = {}, cats = {}, subs = {}, idx = 0;
  rows.filter(vigente).forEach(function (r) {
    var a = str_(r[0]), c = str_(r[1]), s = str_(r[2]);
    var o = str_(r[6]) === '' ? 1e9 + idx : num_(r[6]); idx++;
    if (!amb[a]) amb[a] = { n: a, o: o };
    if (c) { cats[a] = cats[a] || {}; if (!cats[a][c]) cats[a][c] = { n: c, o: o }; }
    if (c && s) { var k = a + '|' + c; subs[k] = subs[k] || {}; if (!subs[k][s]) subs[k][s] = { n: s, o: o }; }
  });
  var values = function (o) { return Object.keys(o).map(function (k) { return o[k]; }); };
  var categorias = {}, subcategorias = {};
  Object.keys(cats).forEach(function (a) { categorias[a] = orden(values(cats[a])); });
  Object.keys(subs).forEach(function (k) { subcategorias[k] = orden(values(subs[k])); });
  var cfg = readRows_(ss, 'CONFIG').reduce(function (acc, r) { acc[str_(r[0])] = str_(r[1]); return acc; }, {});
  var monedas = [cfg.moneda || 'PEN'].concat((cfg.monedas || '').split(',').map(str_)).filter(function (m, i, xs) { return m && xs.indexOf(m) === i; });
  var medios = readRows_(ss, 'MEDIOS_PAGO').filter(function (r) { return r[1] !== false && String(r[1]).toUpperCase() !== 'FALSE' && str_(r[0]); })
    .map(function (r) { return str_(r[0]); });
  var pos = function (m) { var i = MEDIOS_INICIALES.map(norm_).indexOf(norm_(m)); return norm_(m) === 'otros' ? 1000 : i < 0 ? 999 : i; };
  medios.sort(function (x, y) { return pos(x) - pos(y); });
  return {
    version: APP_VERSION,
    hoy: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'),
    monedas: monedas, moneda: monedas[0], medios: medios,
    ambitos: orden(values(amb)).filter(function (a) { return (categorias[a] || []).length; }),
    categorias: categorias, subcategorias: subcategorias
  };
}

// ID del gasto derivado de la clave del atajo: reenviar la misma clave (reintento, doble toque) nunca duplica.
function idDeClave_(clave) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, 'atajo:' + clave, Utilities.Charset.UTF_8);
  var hex = bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16), 'a' + hex.slice(17, 20), hex.slice(20, 32)].join('-');
}

function atajoGasto_(p) {
  var clave = str_(p.clave);
  if (!/^[A-Za-z0-9_.:-]{8,64}$/.test(clave)) throw appError_('VALIDATION', 'Clave del envío inválida (8 a 64 caracteres).');
  var cat = atajoCatalogo_();
  var ambito = str_(p.ambito), categoria = str_(p.categoria), sub = str_(p.subcategoria), medio = str_(p.medioPago);
  if (cat.ambitos.indexOf(ambito) < 0) throw appError_('VALIDATION', 'Ámbito no válido o inactivo: ' + ambito);
  if ((cat.categorias[ambito] || []).indexOf(categoria) < 0) throw appError_('VALIDATION', 'Categoría no válida para ' + ambito + ': ' + categoria);
  if ((cat.subcategorias[ambito + '|' + categoria] || []).indexOf(sub) < 0) throw appError_('VALIDATION', 'Subcategoría no válida para ' + categoria + ': ' + sub);
  if (cat.medios.indexOf(medio) < 0) throw appError_('VALIDATION', 'Medio de pago no válido o inactivo: ' + medio);
  var moneda = str_(p.moneda) || cat.moneda;
  if (cat.monedas.indexOf(moneda) < 0) throw appError_('VALIDATION', 'Moneda no permitida: ' + moneda);
  var montoTxt = String(p.monto === undefined ? '' : p.monto).replace(',', '.').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(montoTxt) || Number(montoTxt) <= 0) throw appError_('VALIDATION', 'Monto inválido: usa un número mayor que 0 con hasta 2 decimales.');
  var fecha = str_(p.fecha).slice(0, 10) || cat.hoy;
  var id = idDeClave_(clave);
  var sh = openSpreadsheet_(false).getSheetByName('GASTOS');
  var existia = !!findRowById_(sh, G.ID + 1, id);
  var row = saveGasto_({
    id: id, mode: 'create', fecha: fecha, monto: Number(montoTxt), moneda: moneda, ambito: ambito, categoria: categoria, subcategoria: sub,
    descripcion: str_(p.descripcion) || sub, medioPago: medio, tipoGasto: 'Variable', esRecurrente: false, comprobanteUrl: ''
  }, 'atajo');
  var montoFmt = (moneda === 'PEN' ? 'S/ ' : moneda + ' ') + Number(row[G.MONTO]).toFixed(2);
  return {
    estado: existia ? 'ya-registrado' : 'registrado', id: id,
    mensaje: (existia ? 'Ya estaba registrado (no se duplicó): ' : 'Gasto registrado: ') + montoFmt + ' · ' + row[G.SUB] + ' · ' + row[G.MEDIO] + ' · ' + row[G.FECHA]
  };
}

/* ===================== Fuentes de dinero (v1.8) ===================== */

var FUENTE_GENERAL_ID = 'fuente-general';
var MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function iso_(v) { return v instanceof Date ? v.toISOString() : str_(v); }

// [id, nombre, monto, moneda, color, icono, activo, orden, recurrencia, mes, medio, creadoEn, actualizadoEn]
function fuenteOut_(r) {
  return [str_(r[0]), str_(r[1]).replace(/^'/, ''), num_(r[2]), str_(r[3]) || 'PEN', str_(r[4]), autoVacio_(r[5]),
    str_(r[6]) === '' ? true : bool_(r[6]), num_(r[7]), str_(r[8]) === 'unica' ? 'unica' : 'mensual',
    periodo_(r[9], tz_()), libreVacio_(r[10]), iso_(r[11]), iso_(r[12])];
}

/**
 * Hojas de fuentes. La primera vez que se crean (migración compatible: solo agrega hojas nuevas, no toca
 * CAJAS, PRESUPUESTOS ni GASTOS) se hace antes un respaldo completo. Es idempotente: si ya existen, solo valida encabezados.
 */
function fuentesSheets_() {
  var ss = openSpreadsheet_(false);
  if (!ss.getSheetByName('FUENTES') || !ss.getSheetByName('FUENTES_MESES')) {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty('FUENTES_RESPALDO')) props.setProperty('FUENTES_RESPALDO', backup_().url);
  }
  return { ss: ss, fuentes: ensureSheet_(ss, 'FUENTES', SHEETS.FUENTES), meses: ensureSheet_(ss, 'FUENTES_MESES', SHEETS.FUENTES_MESES) };
}

function monedaPermitida_(ss, moneda) {
  moneda = str_(moneda) || 'PEN';
  if (!/^[A-Z]{3}$/.test(moneda)) throw appError_('VALIDATION', 'Moneda inválida.');
  var cfg = readRows_(ss, 'CONFIG').reduce(function (acc, r) { acc[str_(r[0])] = str_(r[1]); return acc; }, {});
  var lista = (cfg.monedas || '').split(',').map(str_).filter(Boolean);
  if (cfg.moneda) lista.push(cfg.moneda);
  if (lista.length && lista.indexOf(moneda) < 0) throw appError_('VALIDATION', 'Moneda no permitida: ' + moneda + '. Agrégala en Configuración.');
  return moneda;
}

function fuentesRows_(sh) {
  var n = Math.max(lastDataRow_(sh) - 1, 0);
  return n ? sh.getRange(2, 1, n, SHEETS.FUENTES.length).getValues() : [];
}

// Crea o edita una fuente (upsert por ID: un doble clic con el mismo ID actualiza, no duplica).
// No cambia gastos ni importes de otros meses. Desactivar solo marca Activo = FALSE.
function saveFuente_(p) {
  var id = text_(p.id, 'ID de fuente', 64, true);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw appError_('VALIDATION', 'ID de fuente inválido.');
  var nombre = text_(p.nombre, 'Nombre de la fuente', 40, true);
  var monto = amount_(p.monto, true);
  var recurrencia = p.recurrencia === 'unica' ? 'unica' : 'mensual';
  var mes = str_(p.mes);
  if (mes && !MES_RE.test(mes)) throw appError_('VALIDATION', 'Mes de aplicación inválido (AAAA-MM).');
  if (recurrencia === 'unica' && !mes) throw appError_('VALIDATION', 'Una fuente de un solo mes necesita su mes de aplicación.');
  var activo = p.activo === undefined ? true : p.activo === true;
  var medio = libreVacio_(text_(p.medioPago, 'Medios de pago', 400, false)); // varios medios permitidos; el importe no se divide
  var h = fuentesSheets_();
  var moneda = monedaPermitida_(h.ss, p.moneda);
  var rows = fuentesRows_(h.fuentes);
  var idx = -1;
  for (var i = 0; i < rows.length; i++) {
    var rid = str_(rows[i][0]);
    if (!rid) continue;
    if (rid === id) { idx = i; continue; }
    if (norm_(String(rows[i][1]).replace(/^'/, '')) === norm_(nombre)) throw appError_('VALIDATION', 'Ya existe una fuente llamada “' + str_(rows[i][1]) + '”.');
    // Varias fuentes pueden compartir el mismo medio de pago: el medio no es una clave (la clave es el ID).
  }
  var now = new Date().toISOString();
  var prev = idx >= 0 ? rows[idx] : null;
  var row = [id, nombre, monto, moneda, /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#1e3a8a', text_(p.icono, 'Icono', 30, false) || 'auto',
    activo, p.orden === undefined && prev ? num_(prev[7]) : num_(p.orden), recurrencia, mes, medio || 'Libre', prev ? (iso_(prev[11]) || now) : now, now];
  if (idx >= 0) h.fuentes.getRange(idx + 2, 1, 1, row.length).setValues([row]); else appendRows_(h.fuentes, [row]);
  return fuenteOut_(row);
}

// Importe de una fuente para un mes ("solo") o desde un mes en adelante ("desde"). Upsert por fuente + mes + modo.
// quitar = true borra solo ese ajuste (el mes vuelve a usar el importe habitual); nunca toca otros meses.
function saveFuenteMes_(p) {
  var fuenteId = text_(p.fuenteId, 'Fuente', 64, true);
  var mes = str_(p.mes);
  if (!MES_RE.test(mes)) throw appError_('VALIDATION', 'Mes inválido (AAAA-MM).');
  var modo = p.modo === 'desde' ? 'desde' : 'solo';
  var h = fuentesSheets_();
  if (!findRowByValue_(h.fuentes, 1, fuenteId)) throw appError_('NOT_FOUND', 'La fuente ya no existe. Actualiza los datos.');
  var n = Math.max(lastDataRow_(h.meses) - 1, 0);
  var rows = n ? h.meses.getRange(2, 1, n, SHEETS.FUENTES_MESES.length).getValues() : [];
  var idx = -1;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i][0]) === fuenteId && periodo_(rows[i][1], tz_()) === mes && (str_(rows[i][3]) === 'desde' ? 'desde' : 'solo') === modo) idx = i;
  }
  if (p.quitar === true) {
    if (idx >= 0) h.meses.deleteRow(idx + 2);
    return { fuenteId: fuenteId, mes: mes, modo: modo, quitado: idx >= 0 };
  }
  var row = [fuenteId, mes, amount_(p.monto, true), modo, new Date().toISOString()];
  if (idx >= 0) h.meses.getRange(idx + 2, 1, 1, row.length).setValues([row]); else appendRows_(h.meses, [row]);
  return [fuenteId, mes, row[2], modo];
}

// Elimina una fuente y sus importes por mes (FUENTES_MESES). Ningún gasto guarda el ID de una fuente (la atribución se
// calcula), así que no se toca ningún gasto. La web ya verifica dependencias antes de pedirlo; aquí queda idempotente.
function deleteFuente_(p) {
  var id = text_(p.id, 'ID de fuente', 64, true);
  var h = fuentesSheets_();
  var row = findRowByValue_(h.fuentes, 1, id);
  if (!row) return { id: id, eliminada: false, ajustes: 0 };
  h.fuentes.deleteRow(row);
  var ajustes = borrarFilasSi_(h.meses, SHEETS.FUENTES_MESES.length, function (r) { return str_(r[0]) === id; });
  return { id: id, eliminada: true, ajustes: ajustes };
}

function reorderFuentes_(p) {
  var ids = Array.isArray(p.ids) ? p.ids.map(str_) : [];
  if (!ids.length || ids.length > 500) throw appError_('VALIDATION', 'Orden de fuentes inválido.');
  var sh = fuentesSheets_().fuentes;
  var n = Math.max(lastDataRow_(sh) - 1, 0);
  if (!n) return { ok: true };
  var rows = sh.getRange(2, 1, n, 8).getValues();
  var pos = {};
  ids.forEach(function (id, i) { pos[id] = i + 1; });
  var extra = ids.length + 1;
  sh.getRange(2, 8, n, 1).setValues(rows.map(function (r) {
    var id = str_(r[0]);
    if (!id) return [r[7]];
    return [pos[id] !== undefined ? pos[id] : extra++];
  }));
  return { ok: true };
}

/**
 * Migración explícita (la pide el usuario con un botón): crea la fuente "General" con el presupuesto de la caja
 * general y copia sus ajustes mensuales de PRESUPUESTOS como importes "solo ese mes", para que ningún mes cambie.
 * Respaldo antes de escribir. Idempotente: si la fuente ya existe no hace nada. No convierte Sodexo ni otras cajas.
 */
function migrarGeneralAFuente_() {
  var h = fuentesSheets_();
  if (findRowByValue_(h.fuentes, 1, FUENTE_GENERAL_ID)) return { creada: false, meses: 0 };
  var general = readRows_(h.ss, 'CAJAS').filter(function (r) { return str_(r[3]) === 'Todos'; })[0];
  if (!general) throw appError_('NOT_FOUND', 'No hay caja general que migrar.');
  fuentesRows_(h.fuentes).forEach(function (r) {
    if (str_(r[0]) && norm_(String(r[1]).replace(/^'/, '')) === 'general') throw appError_('VALIDATION', 'Ya tienes una fuente llamada “General”. Revisa sus importes a mano: no se migró nada.');
  });
  var respaldo = backup_();
  var cfg = readRows_(h.ss, 'CONFIG').reduce(function (acc, r) { acc[str_(r[0])] = str_(r[1]); return acc; }, {});
  var now = new Date().toISOString();
  var fila = [FUENTE_GENERAL_ID, 'General', num_(general[2]), cfg.moneda || 'PEN', /^#[0-9a-fA-F]{6}$/.test(str_(general[5])) ? str_(general[5]) : '#1e3a8a', 'auto',
    true, 0, 'mensual', '', 'Libre', now, now];
  appendRows_(h.fuentes, [fila]);
  var ajustes = readRows_(h.ss, 'PRESUPUESTOS').filter(function (r) { return str_(r[1]) === str_(general[0]); })
    .map(function (r) { return [FUENTE_GENERAL_ID, periodo_(r[0], tz_()), num_(r[2]), 'solo', now]; })
    .filter(function (r) { return MES_RE.test(r[1]); });
  appendRows_(h.meses, ajustes);
  return { creada: true, meses: ajustes.length, respaldo: respaldo.url, fuente: fuenteOut_(fila),
    ajustes: ajustes.map(function (r) { return [r[0], r[1], r[2], r[3]]; }) };
}

// Rellena las celdas vacías de la hoja con su valor real, sin pisar nada que ya tenga contenido:
//  - CAJAS: Activo = TRUE, Orden correlativo, Color, Icono = auto y Filtro valor = Todos en la caja general.
//  - FUENTES: Icono = auto, Medio de pago = Libre (fuente libre), Color, Activo, Orden y Recurrencia.
//  - CATALOGO: Activo = TRUE y, con lo que envía la web (`catalogo`), el Icono y el Color de cada fila.
//  - CONFIG: las claves que falten, con su valor predeterminado.
// Escribe por bloques (una escritura por hoja) y es idempotente: repetirla no cambia nada.
function completarVacios_(p) {
  var ss = openSpreadsheet_(false);
  var res = { cajas: 0, fuentes: 0, catalogo: 0, config: 0, medios: 0 };
  var vacio = function (v) { return str_(v) === ''; };

  var cs = cajasSheet_();
  var nc = Math.max(lastDataRow_(cs) - 1, 0);
  if (nc) {
    var cr = cs.getRange(2, 1, nc, SHEETS.CAJAS.length).getValues();
    var ordenMax = 0;
    cr.forEach(function (r) { if (num_(r[6]) > ordenMax) ordenMax = num_(r[6]); });
    var bloque = cr.map(function (r) {
      if (vacio(r[0])) return r.slice(3, 10);
      var o = r.slice(3, 10), antes = JSON.stringify(o);
      if (vacio(o[0])) o[0] = 'Todos';
      if (vacio(o[1])) o[1] = o[0] === 'Todos' ? 'Todos' : o[1];
      if (!/^#[0-9a-fA-F]{6}$/.test(str_(o[2]))) o[2] = '#1e3a8a';
      if (vacio(o[3]) || num_(o[3]) === 0) o[3] = o[0] === 'Todos' ? 1 : ++ordenMax;
      if (vacio(o[4])) o[4] = true;
      if (vacio(o[6])) o[6] = 'auto';
      if (JSON.stringify(o) !== antes) res.cajas++;
      return o;
    });
    if (res.cajas) cs.getRange(2, 4, nc, 7).setValues(bloque);
  }

  var fs = ss.getSheetByName('FUENTES');
  var nf = fs ? Math.max(lastDataRow_(fs) - 1, 0) : 0;
  if (nf) {
    var fr = fs.getRange(2, 1, nf, SHEETS.FUENTES.length).getValues();
    var ordenF = 0;
    fr.forEach(function (r) { if (num_(r[7]) > ordenF) ordenF = num_(r[7]); });
    var bf = fr.map(function (r) {
      var o = r.slice(4, 11), antes = JSON.stringify(o);   // Color, Icono, Activo, Orden, Recurrencia, Mes, Medio
      if (vacio(r[0])) return o;
      if (!/^#[0-9a-fA-F]{6}$/.test(str_(o[0]))) o[0] = '#1e3a8a';
      if (vacio(o[1])) o[1] = 'auto';
      if (vacio(o[2])) o[2] = true;
      if (vacio(o[3])) o[3] = ++ordenF;
      if (vacio(o[4])) o[4] = 'mensual';
      if (vacio(o[6])) o[6] = 'Libre';
      if (JSON.stringify(o) !== antes) res.fuentes++;
      return o;
    });
    if (res.fuentes) fs.getRange(2, 5, nf, 7).setValues(bf);
  }

  var gs = ss.getSheetByName('CATALOGO');
  var ng = gs ? Math.max(lastDataRow_(gs) - 1, 0) : 0;
  if (ng) {
    var defs = {};
    (Array.isArray(p.catalogo) ? p.catalogo : []).slice(0, 2000).forEach(function (d) {
      if (!d || typeof d !== 'object') return;
      var ico = str_(d.icono), col = str_(d.color);
      defs[catKey_(d.ambito, d.categoria, d.subcategoria)] = [/^[a-z0-9-]{1,30}$/.test(ico) ? ico : '', /^#[0-9a-fA-F]{6}$/.test(col) ? col : ''];
    });
    var gr = gs.getRange(2, 1, ng, 7).getValues();
    var bg = gr.map(function (r) {
      var o = [r[3], r[4], r[5]], antes = JSON.stringify(o);
      if (vacio(r[0])) return o;
      var d = defs[catKey_(r[0], r[1], r[2])];
      if (vacio(o[0])) o[0] = true;
      if (vacio(o[1]) && d && d[0]) o[1] = d[0];
      if (vacio(o[2]) && d && d[1]) o[2] = d[1];
      if (JSON.stringify(o) !== antes) res.catalogo++;
      return o;
    });
    if (res.catalogo) gs.getRange(2, 4, ng, 3).setValues(bg);
  }

  var ms = ensureSheet_(ss, 'MEDIOS_PAGO', SHEETS.MEDIOS_PAGO);
  var nm = Math.max(lastDataRow_(ms) - 1, 0);
  if (nm) {
    var mr = ms.getRange(2, 1, nm, 4).getValues();
    var bm = mr.map(function (r) {
      var o = [r[1], r[2], r[3]], antes = JSON.stringify(o);
      if (vacio(r[0])) return o;
      var d = medioLookDef_(r[0]);
      if (vacio(o[0])) o[0] = true;
      if (vacio(o[1]) || norm_(o[1]) === 'auto') o[1] = d[0];
      if (!/^#[0-9a-fA-F]{6}$/.test(str_(o[2]))) o[2] = d[1];
      if (JSON.stringify(o) !== antes) res.medios++;
      return o;
    });
    if (res.medios) ms.getRange(2, 2, nm, 3).setValues(bm);
  }

  var cfg = readRows_(ss, 'CONFIG').reduce(function (acc, r) { acc[str_(r[0])] = true; return acc; }, {});
  var faltan = CONFIG_INICIAL.filter(function (r) { return !cfg[r[0]]; });
  if (faltan.length) { appendRows_(ss.getSheetByName('CONFIG'), faltan); res.config = faltan.length; }
  return res;
}

// Claves de planificación mensual y recordatorios (v1.19): se guardan en CONFIG, sin hojas nuevas. Formato validado aquí.
function validarClavePlan_(clave, valor) {
  var ok = false, m;
  if (clave === 'plan_activo') ok = valor === 'true' || valor === 'false';
  else if (clave === 'plan_dia') ok = /^([1-9]|[12]\d|3[01])$/.test(valor);
  else if (clave === 'aislamiento_desde') ok = /^\d{4}-(0[1-9]|1[0-2])$/.test(valor);
  else if ((m = clave.match(/^plan_dias_(\d{4})$/))) {
    ok = /^([1-9]|[12]\d|3[01]):[01](,([1-9]|[12]\d|3[01]):[01]){11}$/.test(valor);
    if (ok) valor.split(',').forEach(function (x, i) {
      var largo = new Date(Date.UTC(Number(m[1]), i + 1, 0)).getUTCDate();
      if (Number(x.split(':')[0]) > largo) ok = false;
    });
  } else if (/^plan_est_\d{4}-(0[1-9]|1[0-2])$/.test(clave)) ok = /^[pecd]\|[012]{3}\|(\d{4}-\d{2}-\d{2})?$/.test(valor);
  else throw appError_('VALIDATION', 'Clave de configuración no permitida.');
  if (!ok) throw appError_('VALIDATION', 'Valor inválido para ' + clave + '.');
}

function saveConfig_(p) {
  var allowed = CONFIG_INICIAL.map(function (r) { return r[0]; });
  var valor = text_(p.valor, 'Valor', 200, false);
  if (allowed.indexOf(p.clave) < 0) validarClavePlan_(String(p.clave), valor);

  if (p.clave === 'zona_horaria') {
    try { Utilities.formatDate(new Date(), valor, 'yyyy'); } catch (e) { throw appError_('VALIDATION', 'Zona horaria inválida (ej. America/Lima).'); }
    TZ_ = null;
  }
  if (p.clave === 'desc_excepciones') DESC_EXC_CACHE_ = null;
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

/**
 * Respaldo completo del archivo dentro de la carpeta "Backup" que está junto a tu hoja (p. ej. MicroApps/Backup).
 * Si la carpeta no existe, la crea. Para usar otra carpeta, guarda su ID en la propiedad del script BACKUP_FOLDER_ID.
 * Si Drive no está autorizado todavía, cae al comportamiento anterior (copia en Mi unidad) y lo informa.
 */
function backup_() {
  var ss = openSpreadsheet_(false);
  var name = SPREADSHEET_NAME + ' - Respaldo ' + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm');
  try {
    var carpeta = carpetaRespaldos_(ss);
    var copia = DriveApp.getFileById(ss.getId()).makeCopy(name, carpeta);
    return { nombre: name, url: copia.getUrl(), carpeta: carpeta.getName(), carpetaUrl: carpeta.getUrl() };
  } catch (e) {
    console.warn('Respaldo sin carpeta (¿falta autorizar Drive?): ' + e.message);
    var copy = ss.copy(name);
    return { nombre: name, url: copy.getUrl(), carpeta: 'Mi unidad', aviso: 'No se pudo usar la carpeta Backup: ejecuta autorizarRespaldos() en Apps Script.' };
  }
}

function carpetaRespaldos_(ss) {
  var id = PropertiesService.getScriptProperties().getProperty('BACKUP_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  var padres = DriveApp.getFileById(ss.getId()).getParents();
  var padre = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  var existentes = padre.getFoldersByName('Backup');
  var carpeta = existentes.hasNext() ? existentes.next() : padre.createFolder('Backup');
  PropertiesService.getScriptProperties().setProperty('BACKUP_FOLDER_ID', carpeta.getId());
  return carpeta;
}

function carpetaInfo_(c, personalizada) { return { id: c.getId(), nombre: c.getName(), url: c.getUrl(), personalizada: personalizada }; }

// Carpeta donde se guardan los respaldos (solo lectura).
function carpetaRespaldoInfo_() {
  var personalizada = !!PropertiesService.getScriptProperties().getProperty('BACKUP_FOLDER_PERSONALIZADA');
  try { return carpetaInfo_(carpetaRespaldos_(openSpreadsheet_(false)), personalizada); }
  catch (e) { throw appError_('PERMISSION', 'Falta autorizar Drive: ejecuta autorizarRespaldos() en Apps Script.'); }
}

/**
 * Cambia la carpeta de respaldos. Acepta el enlace de una carpeta de Drive (…/folders/ID) o su ID.
 * Vacío = volver a la carpeta "Backup" junto a la hoja. Comprueba que la carpeta exista y sea accesible antes de guardarla.
 */
function saveCarpetaRespaldo_(p) {
  var props = PropertiesService.getScriptProperties();
  var v = str_(p.carpeta);
  if (!v) {
    props.deleteProperty('BACKUP_FOLDER_ID'); props.deleteProperty('BACKUP_FOLDER_PERSONALIZADA');
    return carpetaInfo_(carpetaRespaldos_(openSpreadsheet_(false)), false);
  }
  var m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(v) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(v);
  var id = m ? m[1] : v;
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw appError_('VALIDATION', 'Pega el enlace de una carpeta de Google Drive (…/folders/…) o su ID.');
  var carpeta;
  try { carpeta = DriveApp.getFolderById(id); carpeta.getName(); }
  catch (e) { throw appError_('NOT_FOUND', 'No encuentro esa carpeta o no tienes acceso. Ábrela en Drive y copia el enlace de la barra de direcciones.'); }
  props.setProperty('BACKUP_FOLDER_ID', id);
  props.setProperty('BACKUP_FOLDER_PERSONALIZADA', '1');
  return carpetaInfo_(carpeta, true);
}

/** Ejecútala una vez desde el editor: pide el permiso de Drive y muestra en qué carpeta quedarán los respaldos. */
function autorizarRespaldos() {
  var c = carpetaRespaldos_(openSpreadsheet_(false));
  Logger.log('Los respaldos se guardarán en: ' + c.getName() + ' → ' + c.getUrl());
  return { carpeta: c.getName(), url: c.getUrl() };
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
// Columnas: 0 ID, 1-4 clasificación y descripción, 5-6 marcas de tiempo, 7 Monto, 8 Moneda, 9 Medio de pago, 10 Orden,
// 11 Es compromiso (la decides tú: solo las marcadas cuentan como compromisos mensuales).

var PL_ID = /^pl-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function plantillaRow_(r) {
  var ts = function (v) { return v instanceof Date ? v.toISOString() : str_(v); };
  var opt = function (v) { return str_(v) === '' ? '' : num_(v); };
  return [str_(r[0]), str_(r[1]), str_(r[2]), str_(r[3]), str_(r[4]).replace(/^'/, ''), ts(r[5]), ts(r[6]),
    opt(r[7]), str_(r[8]) || 'PEN', str_(r[9]).replace(/^'/, ''), opt(r[10]), bool_(r[11]),
    TIPOS_GASTO.indexOf(str_(r[12])) >= 0 ? str_(r[12]) : 'Variable', bool_(r[13])];
}

// Orden estable: por la columna Orden; las filas sin orden (versión anterior) quedan después, en orden de creación.
function plantillasOrdenadas_(rows) {
  return rows.map(function (r, i) { return { r: r, i: i, o: str_(r[10]) === '' ? Infinity : num_(r[10]) }; })
    .sort(function (a, b) { return (a.o - b.o) || (a.i - b.i); });
}

/* v1.19.2: las plantillas de gastos mensuales viven en PLANTILLAS_FINANCIERAS con Tipo = 'gasto'. Columnas usadas:
 * ID, Tipo, Nombre (= subcategoría), Monto, Moneda, Medios (= medio de pago), Descripción, Activo, Orden, Creado en,
 * Actualizado en y Datos (JSON: {ambito, categoria, subcategoria, tipoGasto, esCompromiso, esRecurrente}).
 * Internamente el resto del código sigue trabajando con la "forma de 14" de la antigua hoja PLANTILLAS_MENSUALES. */
function plGastoDesdeFila_(v) {
  var d = pfEstados_(v[18]);
  return [v[0], str_(d.ambito), str_(d.categoria), str_(d.subcategoria), v[8], v[16], v[17], v[3], v[4], v[5], v[13],
    d.esCompromiso === true, str_(d.tipoGasto), d.esRecurrente === true];
}

function plGastoAFila_(r) {   // forma de 14 → fila de la hoja (18 + Datos)
  var datos = JSON.stringify({ ambito: str_(r[1]), categoria: str_(r[2]), subcategoria: str_(r[3]),
    tipoGasto: TIPOS_GASTO.indexOf(str_(r[12])) >= 0 ? str_(r[12]) : 'Variable', esCompromiso: bool_(r[11]), esRecurrente: bool_(r[13]) });
  return [r[0], 'gasto', r[3], r[7], str_(r[8]) || 'PEN', r[9], '', '', r[4], '', '', '', true, r[10], '', '', r[5], r[6], datos];
}

// Copia, una sola vez, las plantillas de la hoja anterior PLANTILLAS_MENSUALES. La hoja anterior no se modifica ni se borra.
function plMigrarLegacy_(ss, old, sh) {
  var props = PropertiesService.getScriptProperties();
  var header = old.getRange(1, 1, 1, Math.max(old.getLastColumn(), 1)).getValues()[0];
  if (!PL_COLS_LEGACY.every(function (e, i) { return str_(header[i]) === e; })) migrarPlantillasHoja_(ss, old);   // esquema muy antiguo: se normaliza con respaldo
  else backup_();
  var n = Math.max(lastDataRow_(old) - 1, 0);
  var vals = n ? old.getRange(2, 1, n, PL_COLS_LEGACY.length).getValues() : [];
  var have = {};
  pfRows_(sh).forEach(function (r) { have[str_(r[0])] = true; });
  var ts = function (v) { return v instanceof Date ? v.toISOString() : str_(v); };
  var nuevas = [];
  vals.forEach(function (r) {
    var id = str_(r[0]);
    if (!id || have[id]) return;
    have[id] = true;
    var f = plGastoAFila_(r);
    f[16] = ts(r[5]); f[17] = ts(r[6]);
    nuevas.push(f);
  });
  if (nuevas.length) appendRows_(sh, nuevas);
  props.setProperty('PL_MIGRADO', '1');
}

// Hoja con las plantillas de gastos. crear=false: null si aún no hay nada. Migra PLANTILLAS_MENSUALES una sola vez.
function plHoja_(crear) {
  var ss = openSpreadsheet_(false);
  var sh = ss.getSheetByName(PF_HOJA), old = ss.getSheetByName('PLANTILLAS_MENSUALES');
  var pendiente = !!old && old.getLastRow() > 1 && !PropertiesService.getScriptProperties().getProperty('PL_MIGRADO');
  if (!sh && !crear && !pendiente) return null;
  sh = plantillasFinSheet_();
  if (pendiente) plMigrarLegacy_(ss, old, sh);
  return sh;
}

// Plantillas de gasto: [{ fila, r }] con r en la forma de 14 (la misma que usaba PLANTILLAS_MENSUALES).
function plLeer_(sh) {
  var out = [];
  if (!sh) return out;
  pfRows_(sh).forEach(function (v, i) { if (str_(v[0]) && str_(v[1]) === 'gasto') out.push({ fila: i + 2, r: plGastoDesdeFila_(v) }); });
  return out;
}

function plTodasLectura_(ss) {   // para validaciones de solo lectura (dependencias, limpieza): forma de 14, sin crear hojas
  var sh = plHoja_(false);
  return plLeer_(sh).map(function (x) { return x.r; });
}

function listPlantillas_() {
  return plantillasOrdenadas_(plTodasLectura_()).map(function (x) { return plantillaRow_(x.r); });
}

/* ---------- Migración segura de la hoja anterior PLANTILLAS_MENSUALES ----------
 * Causa del error "encabezados distintos": una versión anterior escribía la columna Orden (K) sin agregar su
 * encabezado, y la validación exigía que la fila 1 coincidiera exactamente. Ahora:
 *  - Cada columna esperada se reconoce por su encabezado (o variantes conocidas: "Monto predeterminado", etc.).
 *  - Una columna esperada SIN encabezado solo se adopta si sus datos tienen el tipo correcto (p. ej. Orden = enteros);
 *    si no, se detiene sin escribir nada y explica qué revisar.
 *  - Un encabezado desconocido o repetido en una posición esperada detiene la operación: nunca se sobrescribe.
 *  - Columnas extra a la derecha se respetan y no se tocan.
 *  - Antes de cambiar encabezados de una hoja con datos se crea un respaldo del archivo. Es idempotente.
 */
var PL_ALIAS = {
  'Monto': ['monto', 'monto predeterminado'],
  'Moneda': ['moneda', 'moneda predeterminada'],
  'Medio de pago': ['medio de pago', 'medio de pago predeterminado', 'medio predeterminado'],
  'Orden': ['orden'],
  'Es compromiso': ['es compromiso', 'es_compromiso', 'compromiso'],
  'Tipo de gasto': ['tipo de gasto', 'tipo'],
  'Es recurrente': ['es recurrente', 'recurrente']
};
var PL_TIPO = {
  'Monto': function (v) { return v === '' || (esNumero_(v) && Number(v) >= 0); },
  'Moneda': function (v) { return v === '' || /^[A-Z]{3}$/.test(str_(v)); },
  'Medio de pago': function (v) { return v === '' || (typeof v === 'string' && str_(v).length <= 40); },
  'Orden': function (v) { return v === '' || (esNumero_(v) && Number(v) >= 0 && Math.floor(Number(v)) === Number(v)); },
  'Es compromiso': function (v) { return v === '' || v === true || v === false || /^(TRUE|FALSE)$/i.test(str_(v)); },
  'Tipo de gasto': function (v) { return v === '' || TIPOS_GASTO.indexOf(str_(v)) >= 0; },
  'Es recurrente': function (v) { return v === '' || v === true || v === false || /^(TRUE|FALSE)$/i.test(str_(v)); }
};

// Número real (o texto numérico como "4"); nunca fechas ni casillas TRUE/FALSE.
function esNumero_(v) { return (typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)); }

function encabezadoEs_(h, esperado) {
  var n = norm_(h);
  if (n === norm_(esperado)) return true;
  return (PL_ALIAS[esperado] || []).indexOf(n) >= 0;
}

function schemaError_(msg) { return appError_('SCHEMA', 'La hoja PLANTILLAS_MENSUALES necesita revisión: ' + msg + ' No se modificó nada.'); }
function colLetra_(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

// Devuelve { cambios: n, detalle: [...] }. Lanza SCHEMA si no puede migrar con seguridad.
function migrarPlantillasHoja_(ss, sh, opts) {
  var esperado = PL_COLS_LEGACY;
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  // Camino rápido (cada escritura): si los encabezados ya son exactamente los esperados, no se lee nada más.
  // Los IDs repetidos se detectan igual al guardar (savePlantilla_ recorre las filas que ya leyó).
  if (esperado.every(function (e, i) { return str_(header[i]) === e; })) return { cambios: 0, detalle: [] };
  var lastRow = lastDataRow_(sh);
  var datos = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, Math.max(lastCol, esperado.length)).getValues() : [];
  var nuevos = [];
  var detalle = [];
  // Encabezados repetidos (por nombre normalizado) entre los esperados: ambiguo, no se adivina.
  var vistos = {};
  header.forEach(function (h, i) {
    if (str_(h) === '') return;
    esperado.forEach(function (e) {
      if (encabezadoEs_(h, e)) {
        if (vistos[e] !== undefined) throw schemaError_('el encabezado “' + e + '” aparece en las columnas ' + colLetra_(vistos[e]) + ' y ' + colLetra_(i) + '.');
        vistos[e] = i;
      }
    });
  });
  for (var i = 0; i < esperado.length; i++) {
    var h = str_(header[i]);
    var e = esperado[i];
    if (h !== '') {
      if (!encabezadoEs_(h, e)) throw schemaError_('la columna ' + colLetra_(i) + ' debería ser “' + e + '” pero se llama “' + h + '”.');
      if (h !== e) detalle.push(colLetra_(i) + ': “' + h + '” reconocida como ' + e);
      nuevos.push(h);
      continue;
    }
    // Columna esperada sin encabezado: ¿tiene datos? ¿son del tipo correcto?
    var col = datos.map(function (r) { return r[i] === null || r[i] === undefined ? '' : r[i]; });
    var conDatos = col.filter(function (v) { return str_(v) !== ''; });
    if (i < 7 && conDatos.length) throw schemaError_('la columna ' + colLetra_(i) + ' (' + e + ') tiene datos pero no tiene encabezado.');
    if (conDatos.length && PL_TIPO[e] && !col.every(PL_TIPO[e])) {
      throw schemaError_('la columna ' + colLetra_(i) + ' no tiene encabezado y sus datos no corresponden a “' + e + '”. Revísala o muévela a otra columna.');
    }
    detalle.push(colLetra_(i) + ': se agrega el encabezado “' + e + '”' + (conDatos.length ? ' (se conservan ' + conDatos.length + ' valores existentes)' : ''));
    nuevos.push(e);
  }
  // IDs únicos: con un ID repetido, editar una plantilla modificaría otra.
  var ids = {};
  if (!(opts && opts.omitirIds)) datos.forEach(function (r, k) {
    var id = str_(r[0]);
    if (!id) return;
    if (ids[id]) throw schemaError_('el ID ' + id + ' está repetido en las filas ' + ids[id] + ' y ' + (k + 2) + '.');
    ids[id] = k + 2;
  });
  var cambios = nuevos.filter(function (h, i) { return h !== str_(header[i]); }).length;
  if (!cambios) return { cambios: 0, detalle: detalle };
  console.log('Migración PLANTILLAS_MENSUALES. Detectado: ' + JSON.stringify(header) + ' → objetivo: ' + JSON.stringify(esperado) + '. ' + detalle.join('; '));
  if (datos.length && !(opts && opts.sinRespaldo)) {
    var r = backup_();
    console.log('Respaldo previo a la migración: ' + r.url);
  }
  sh.getRange(1, 1, 1, esperado.length).setValues([nuevos]).setFontWeight('bold').setBackground('#e2e8f0');
  sh.setFrozenRows(1);
  return { cambios: cambios, detalle: detalle };
}

/** Ejecútala desde el editor: copia las plantillas de gastos de la hoja anterior PLANTILLAS_MENSUALES a PLANTILLAS_FINANCIERAS (una sola vez; no borra nada). */
function migrarPlantillas() {
  var ss = openSpreadsheet_(false);
  if (!ss.getSheetByName('PLANTILLAS_MENSUALES')) { Logger.log('No existe la hoja PLANTILLAS_MENSUALES: las plantillas de gastos ya viven en PLANTILLAS_FINANCIERAS.'); return; }
  var res = withLock_(function () {
    PropertiesService.getScriptProperties().deleteProperty('PL_MIGRADO');   // fuerza la copia; los IDs ya copiados se omiten
    var sh = plantillasFinSheet_();
    plMigrarLegacy_(ss, ss.getSheetByName('PLANTILLAS_MENSUALES'), sh);
    return { plantillas: plLeer_(sh).length };
  });
  Logger.log('Plantillas de gastos en PLANTILLAS_FINANCIERAS: ' + res.plantillas + '. La hoja PLANTILLAS_MENSUALES quedó intacta (ya puedes borrarla).');
  return res;
}

// Reescribe la columna Orden (1..n) de las plantillas de gasto, según la lista de posiciones ya ordenada.
function escribirOrdenPlantillas_(sh, items, indicesOrdenados) {
  var n = Math.max(lastDataRow_(sh) - 1, 0);
  if (!n) return;
  var col = sh.getRange(2, 14, n, 1).getValues();
  indicesOrdenados.forEach(function (idx, pos) { col[items[idx].fila - 2] = [pos + 1]; });
  sh.getRange(2, 14, n, 1).setValues(col);
}

function savePlantilla_(p) {
  var id = str_(p.id);
  if (!PL_ID.test(id)) throw appError_('VALIDATION', 'ID de plantilla inválido.');
  var ambito = text_(p.ambito, 'Ámbito', 40, true);
  var categoria = text_(p.categoria, 'Categoría', 60, true);
  var sub = text_(p.subcategoria, 'Subcategoría', 60, true);
  var desc = descText_(p.descripcion, true);
  var monto = (p.monto === '' || p.monto === null || p.monto === undefined) ? '' : amount_(p.monto, true); // vacío o >= 0
  var moneda = str_(p.moneda) || 'PEN';
  if (!/^[A-Z]{3}$/.test(moneda)) throw appError_('VALIDATION', 'Moneda inválida.');
  var medio = text_(p.medioPago, 'Medio de pago', 40, false);
  if (p.esCompromiso !== undefined && typeof p.esCompromiso !== 'boolean') throw appError_('VALIDATION', 'Es compromiso debe ser verdadero o falso.');
  var tipoNuevo = p.tipoGasto === undefined ? undefined : str_(p.tipoGasto);
  if (tipoNuevo !== undefined && TIPOS_GASTO.indexOf(tipoNuevo) < 0) throw appError_('VALIDATION', 'Tipo de gasto inválido.');
  if (p.esRecurrente !== undefined && typeof p.esRecurrente !== 'boolean') throw appError_('VALIDATION', 'Es recurrente debe ser verdadero o falso.');
  var sh = plHoja_(true);
  var items = plLeer_(sh), rows = items.map(function (x) { return x.r; });
  var plain = function (v) { return norm_(str_(v).replace(/^'/, '')); }; // ignora el apóstrofo anti-fórmulas
  var montoKey = function (v) { return str_(v) === '' ? '' : String(Math.round(num_(v) * 100)); };
  var key = [plain(ambito), plain(categoria), plain(sub), plain(desc), montoKey(monto), plain(moneda), plain(medio)].join('|');
  var idx = -1;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i][0]) === id) {
      if (idx >= 0) throw schemaError_('el ID ' + id + ' está repetido en las filas ' + (idx + 2) + ' y ' + (i + 2) + '.');
      idx = i; continue;
    }
    var k = [plain(rows[i][1]), plain(rows[i][2]), plain(rows[i][3]), plain(rows[i][4]), montoKey(rows[i][7]), plain(str_(rows[i][8]) || 'PEN'), plain(rows[i][9])].join('|');
    if (str_(rows[i][0]) && k === key) throw appError_('VALIDATION', 'La plantilla ya existe. Modifica al menos uno de sus valores para guardar una copia.');
  }
  var now = new Date().toISOString();
  if (idx >= 0) { // edición (o reintento de un alta ya guardada): conserva creación y orden
    var prev = rows[idx];
    var comp = p.esCompromiso === undefined ? bool_(prev[11]) : p.esCompromiso;
    var tipoF = tipoNuevo === undefined ? plantillaRow_(prev)[12] : tipoNuevo;
    var recF = p.esRecurrente === undefined ? bool_(prev[13]) : p.esRecurrente;
    var upd = [id, ambito, categoria, sub, desc, plantillaRow_(prev)[5], now, monto, moneda, medio, prev[10], comp, tipoF, recF];
    sh.getRange(items[idx].fila, 1, 1, PF_COLS_.length).setValues([plGastoAFila_(upd)]);
    return plantillaRow_(upd);
  }
  if (p.mode === 'update') throw appError_('NOT_FOUND', 'La plantilla ya no existe.');
  var row = [id, ambito, categoria, sub, desc, now, now, monto, moneda, medio, '', p.esCompromiso === true, tipoNuevo || 'Variable', p.esRecurrente === true];
  var filaNueva = lastDataRow_(sh) + 1;
  appendRows_(sh, [plGastoAFila_(row)]);
  // Nueva al final; una copia (afterId), justo después de la original. Se renumera en una sola escritura.
  rows.push(row); items.push({ fila: filaNueva, r: row });
  var orden = plantillasOrdenadas_(rows).map(function (x) { return x.i; }).filter(function (i) { return i !== rows.length - 1 && str_(rows[i][0]); });
  var after = str_(p.afterId);
  var pos = orden.length;
  if (after) { for (var j = 0; j < orden.length; j++) if (str_(rows[orden[j]][0]) === after) pos = j + 1; }
  orden.splice(pos, 0, rows.length - 1);
  escribirOrdenPlantillas_(sh, items, orden);
  row[10] = pos + 1;
  return plantillaRow_(row);
}

// Guarda el orden manual (arrastrar y soltar) en una sola escritura de la columna Orden.
function reorderPlantillas_(p) {
  var ids = Array.isArray(p.ids) ? p.ids.map(str_) : [];
  if (!ids.length || ids.some(function (x) { return !PL_ID.test(x); })) throw appError_('VALIDATION', 'Orden de plantillas inválido.');
  var sh = plHoja_(false);
  if (!sh) throw appError_('NOT_FOUND', 'No hay plantillas.');
  var items = plLeer_(sh), rows = items.map(function (x) { return x.r; });
  var pos = {};
  rows.forEach(function (r, i) { pos[str_(r[0])] = i; });
  var orden = [];
  ids.forEach(function (x) { if (pos[x] !== undefined && orden.indexOf(pos[x]) < 0) orden.push(pos[x]); });
  plantillasOrdenadas_(rows).forEach(function (x) { if (str_(x.r[0]) && orden.indexOf(x.i) < 0) orden.push(x.i); }); // las no enviadas, al final
  escribirOrdenPlantillas_(sh, items, orden);
  return { ok: true, total: orden.length };
}

// Elimina solo la fila de la plantilla. No toca gastos, presupuestos ni cajas.
function deletePlantilla_(p) {
  var id = str_(p.id);
  if (!PL_ID.test(id)) throw appError_('VALIDATION', 'ID de plantilla inválido.');
  // Sin revisar IDs repetidos: eliminar es justamente cómo se corrige un duplicado.
  var sh = plHoja_(false);
  var it = plLeer_(sh).filter(function (x) { return str_(x.r[0]) === id; })[0];
  if (!it) return { id: id, eliminada: false }; // ya no estaba: el resultado es el mismo
  sh.deleteRow(it.fila);
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
      g.plantillaId = plantillaIdOpcional_(x && x.plantillaId);
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
  // Vínculo con su plantilla (también en un reintento: si la vez anterior no llegó a escribirse, se completa).
  var pares = gastos.filter(function (g) { return g.plantillaId; }).map(function (g) { return [g.id, g.plantillaId]; });
  if (pares.length) vincular_(openSpreadsheet_(false), pares);
  return {
    estado: 'confirmado', loteId: loteId, solicitados: gastos.length, confirmados: gastos.length,
    nuevos: nuevas.length, yaExistian: gastos.length - nuevas.length,
    ids: gastos.map(function (g) { return g.id; }),
    gastos: filas.map(function (r) { return normalizeGastoRow_(r, tz_()); }),
    mensaje: 'Se registraron ' + gastos.length + ' gastos.'
  };
}

/* ===================== Vínculos gasto → plantilla (compromisos) ===================== */

function plantillaIdOpcional_(v) {
  var id = str_(v);
  if (!id) return '';
  if (!PL_ID.test(id)) throw appError_('VALIDATION', 'ID de plantilla inválido.');
  return id;
}

// Upsert por ID de gasto: actualiza en bloque los existentes y agrega los nuevos (máximo dos escrituras).
// Plantilla vacía = quitar el vínculo (la fila queda, sin borrar nada).
function vincular_(ss, pares) {
  var sh = ss.getSheetByName('VINCULOS_PLANTILLAS') || ensureSheet_(ss, 'VINCULOS_PLANTILLAS', SHEETS.VINCULOS_PLANTILLAS);
  var n = Math.max(lastDataRow_(sh) - 1, 0);
  var rows = n ? sh.getRange(2, 1, n, 3).getValues() : [];
  var idx = {};
  rows.forEach(function (r, i) { idx[str_(r[0]).toLowerCase()] = i; });
  var now = new Date().toISOString();
  var nuevos = [];
  var cambio = false;
  pares.forEach(function (par) {
    var k = par[0].toLowerCase();
    if (idx[k] >= 0) {
      if (str_(rows[idx[k]][1]) !== par[1]) { rows[idx[k]][1] = par[1]; cambio = true; }
    } else if (idx[k] === undefined && par[1]) {
      idx[k] = -1;
      nuevos.push([par[0], par[1], now]);
    }
  });
  if (cambio) sh.getRange(2, 1, n, 3).setValues(rows);
  appendRows_(sh, nuevos);
}

// Asocia (o desasocia con plantillaId vacío) un movimiento existente a una plantilla. No toca GASTOS.
function vincularGasto_(p) {
  var gastoId = requireId_(p.gastoId);
  var plId = plantillaIdOpcional_(p.plantillaId);
  var ss = openSpreadsheet_(false);
  if (!findRowById_(ss.getSheetByName('GASTOS'), G.ID + 1, gastoId)) throw appError_('NOT_FOUND', 'El gasto ya no existe en la hoja.');
  vincular_(ss, [[gastoId, plId]]);
  return [gastoId, plId];
}

/* ===================== Revisiones de calidad de datos ===================== */

var REVISION_ESTADOS = ['legitimo', 'pendiente', 'duplicado'];

// Guarda la decisión sobre una alerta (upsert por tipo + conjunto de IDs). Solo escribe REVISIONES_CALIDAD.
// La firma resume los datos revisados: si un movimiento cambia, la web ve otra firma y vuelve a mostrar la alerta.
function saveRevision_(p) {
  var tipo = str_(p.tipo);
  if (tipo !== 'duplicado') throw appError_('VALIDATION', 'Tipo de alerta inválido.');
  var estado = str_(p.estado);
  if (REVISION_ESTADOS.indexOf(estado) < 0) throw appError_('VALIDATION', 'Estado de revisión inválido.');
  var ids = Array.isArray(p.ids) ? p.ids.map(function (x) { return requireId_(x).toLowerCase(); }) : [];
  if (ids.length < 2 || ids.length > 50) throw appError_('VALIDATION', 'La revisión debe incluir entre 2 y 50 movimientos.');
  ids.sort();
  var idsTxt = ids.join(',');
  var firma = text_(p.firma, 'Firma', 2000, true);
  var nuevoId = str_(p.id);
  if (!/^rev-[0-9a-f-]{36}$/.test(nuevoId)) throw appError_('VALIDATION', 'ID de revisión inválido.');
  var ss = openSpreadsheet_(false);
  var sh = ss.getSheetByName('REVISIONES_CALIDAD') || ensureSheet_(ss, 'REVISIONES_CALIDAD', SHEETS.REVISIONES_CALIDAD);
  var n = Math.max(lastDataRow_(sh) - 1, 0);
  var rows = n ? sh.getRange(2, 1, n, 7).getValues() : [];
  var now = new Date().toISOString();
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i][1]) === tipo && str_(rows[i][2]) === idsTxt) {
      var creado = rows[i][5] instanceof Date ? rows[i][5].toISOString() : str_(rows[i][5]);
      var upd = [str_(rows[i][0]), tipo, idsTxt, estado, firma, creado, now];
      sh.getRange(i + 2, 1, 1, 7).setValues([upd]);
      return upd;
    }
  }
  var row = [nuevoId, tipo, idsTxt, estado, firma, now, now];
  appendRows_(sh, [row]);
  return row;
}

/* ===================== Conciliación de saldos (v1.22) ===================== */

var CONC_SEGUIMIENTO_ESTADOS_ = ['pendiente', 'en_revision', 'cerrada_justificada'];
var CONC_CAUSAS_ = ['gasto_pendiente', 'ingreso_pendiente', 'saldo_anterior', 'comision', 'reembolso', 'no_identificada', 'otro'];

function concHoja_(ss) {
  var sh = ensureSheet_(ss, 'CONCILIACIONES', SHEETS.CONCILIACIONES);
  if (sh.getLastRow() < 2) {
    // Hoja sin registros (recién creada por setup o por el primer guardado): Período, fecha de corte y creado-en son TEXTO,
    // así Sheets no los convierte en fechas. Con registros ya no se vuelve a tocar el formato.
    sh.getRange('D:E').setNumberFormat('@');
    sh.getRange('Q:Q').setNumberFormat('@');
  }
  return sh;
}

function concFecha_(v) { return v instanceof Date ? v.toISOString() : str_(v).replace(/^'/, ''); }

function concLeer_(ss) {
  var tz = tz_();
  return readRows_(ss, 'CONCILIACIONES').map(function (r) {
    return [str_(r[0]), str_(r[1]), str_(r[2]), periodo_(r[3], tz), concFecha_(r[4]), str_(r[5]), str_(r[6]), str_(r[7]),
      r[8] === '' ? null : num_(r[8]), r[9] === '' ? null : num_(r[9]), r[10] === '' ? null : num_(r[10]),
      str_(r[11]), str_(r[12]), str_(r[13]), str_(r[14]), str_(r[15]), concFecha_(r[16])];
  });
}

function dinero2_(v, label, noNegativo) {
  var n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (v === '' || v === null || v === undefined || !isFinite(n) || Math.abs(n) > 1e9 || (noNegativo && n < 0)) throw appError_('VALIDATION', label + ' inválido.');
  return Math.round(n * 100) / 100;
}

function concIdFila_(v) {
  var id = str_(v);
  if (!/^conc-[0-9a-f-]{36}$/.test(id)) throw appError_('VALIDATION', 'ID de conciliación inválido.');
  return id;
}

// Guarda una verificación NUEVA (nunca sobrescribe). Idempotente por ID (doble clic / reintento no duplica).
// La diferencia y el estado inicial se calculan aquí; el saldo calculado es la foto que manda la web en ese momento.
function saveConciliacion_(p) {
  var id = concIdFila_(p.id);
  var periodo = str_(p.periodo);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) throw appError_('VALIDATION', 'Período inválido.');
  var corteD = new Date(str_(p.corte));
  if (isNaN(corteD.getTime())) throw appError_('VALIDATION', 'Fecha de corte inválida.');
  if (corteD.getTime() > Date.now() + 24 * 3600 * 1000) throw appError_('VALIDATION', 'La fecha de corte no puede estar en el futuro.');
  if (Utilities.formatDate(corteD, tz_(), 'yyyy-MM') !== periodo) throw appError_('VALIDATION', 'La fecha de corte debe pertenecer al período elegido.');
  var grupoId = str_(p.grupoId);
  if (!/^(total|gf-[0-9a-f-]{8,40})$/.test(grupoId)) throw appError_('VALIDATION', 'Grupo de fondos inválido.');
  var grupo = text_(p.grupo, 'Grupo', 60, true);
  var moneda = str_(p.moneda).toUpperCase();
  if (!/^[A-Z]{3}$/.test(moneda)) throw appError_('VALIDATION', 'Moneda inválida.');
  var calculado = dinero2_(p.calculado, 'Saldo presupuestario', false);
  var real = dinero2_(p.real, 'Saldo real', true);
  var obs = text_(p.observacion, 'Observación', 500, false);
  var ref = text_(p.referencia, 'Referencia', 200, false);
  var reemplaza = str_(p.reemplazaA);
  var ss = openSpreadsheet_(false);
  var sh = concHoja_(ss);
  var rows = concLeer_(ss);
  for (var i = 0; i < rows.length; i++) if (rows[i][0] === id) return rows[i];   // ya guardada: no duplicar
  if (reemplaza) {
    var viejo = null;
    rows.forEach(function (r) { if (r[0] === reemplaza && r[1] === 'verificacion') viejo = r; });
    if (!viejo) throw appError_('NOT_FOUND', 'La verificación que se corrige ya no existe.');
    if (viejo[5] !== grupoId || viejo[3] !== periodo) throw appError_('VALIDATION', 'Una corrección debe ser del mismo grupo y período.');
    rows.forEach(function (r) { if (r[1] === 'verificacion' && r[14] === reemplaza) throw appError_('VALIDATION', 'Esa verificación ya fue corregida.'); });
  }
  var diff = Math.round((real - calculado) * 100) / 100;
  var now = new Date().toISOString();
  var row = [id, 'verificacion', id, periodo, corteD.toISOString(), grupoId, grupo, moneda, calculado, real, diff,
    diff === 0 ? 'conciliada' : 'pendiente', '', obs, reemplaza, ref, now];
  appendRows_(sh, [row]);
  return row;
}

// Cambia el seguimiento de una diferencia (en revisión / cerrada con diferencia justificada / reabrir). No es una transacción.
function saveSeguimientoConciliacion_(p) {
  var id = concIdFila_(p.id);
  var objetivo = concIdFila_(p.conciliacionId);
  var estado = str_(p.estado);
  if (CONC_SEGUIMIENTO_ESTADOS_.indexOf(estado) < 0) throw appError_('VALIDATION', 'Estado de seguimiento inválido.');
  var causa = str_(p.causa);
  if (causa && CONC_CAUSAS_.indexOf(causa) < 0) throw appError_('VALIDATION', 'Causa inválida.');
  var obs = text_(p.observacion, 'Observación', 500, false);
  if (estado === 'cerrada_justificada' && (!causa || !obs)) throw appError_('VALIDATION', 'Para cerrar con diferencia justificada indica la causa y una explicación.');
  var ss = openSpreadsheet_(false);
  var sh = concHoja_(ss);
  var rows = concLeer_(ss);
  for (var i = 0; i < rows.length; i++) if (rows[i][0] === id) return rows[i];
  var v = null;
  rows.forEach(function (r) { if (r[0] === objetivo && r[1] === 'verificacion') v = r; });
  if (!v) throw appError_('NOT_FOUND', 'La verificación ya no existe.');
  if (v[10] === 0) throw appError_('VALIDATION', 'Esa verificación no tiene diferencia que seguir.');
  rows.forEach(function (r) { if (r[1] === 'verificacion' && r[14] === objetivo) throw appError_('VALIDATION', 'Esa verificación fue reemplazada por una más reciente.'); });
  var row = [id, 'seguimiento', objetivo, v[3], v[4], v[5], v[6], v[7], null, null, null, estado, causa, obs, '', '', new Date().toISOString()];
  appendRows_(sh, [row.map(function (x) { return x === null ? '' : x; })]);
  return row;
}

// Define o actualiza un grupo de fondos (conjunto de fuentes). Nunca toca FUENTES. Una fuente solo puede estar en un grupo
// activo: así ningún dinero se suma dos veces.
function saveGrupoConciliacion_(p) {
  var id = concIdFila_(p.id);
  var grupoId = str_(p.grupoId);
  if (!/^gf-[0-9a-f-]{8,40}$/.test(grupoId)) throw appError_('VALIDATION', 'ID de grupo inválido.');
  var nombre = text_(p.nombre, 'Nombre del grupo', 40, true);
  var fuentes = Array.isArray(p.fuenteIds) ? p.fuenteIds.map(str_) : [];
  if (fuentes.length > 30 || fuentes.some(function (x) { return !/^[A-Za-z0-9_-]{1,64}$/.test(x); })) throw appError_('VALIDATION', 'Fuentes del grupo inválidas.');
  var vistos = {};
  fuentes = fuentes.filter(function (x) { if (vistos[x]) return false; vistos[x] = true; return true; });
  var activo = p.activo !== false;
  var ss = openSpreadsheet_(false);
  var sh = concHoja_(ss);
  var rows = concLeer_(ss);
  for (var i = 0; i < rows.length; i++) if (rows[i][0] === id) return rows[i];
  var vigentes = {};
  rows.forEach(function (r) { if (r[1] === 'grupo') vigentes[r[5]] = r; });
  if (activo) {
    Object.keys(vigentes).forEach(function (gid) {
      var g = vigentes[gid];
      if (gid === grupoId || g[11] !== 'activo') return;
      if (norm_(g[6]) === norm_(nombre)) throw appError_('VALIDATION', 'Ya existe un grupo llamado "' + g[6] + '".');
      var otras = g[15] ? g[15].split(',') : [];
      fuentes.forEach(function (f) { if (otras.indexOf(f) >= 0) throw appError_('VALIDATION', 'Una fuente ya pertenece al grupo "' + g[6] + '": no se puede contar dos veces.'); });
    });
  }
  var row = [id, 'grupo', '', '', '', grupoId, nombre, '', '', '', '', activo ? 'activo' : 'archivado', '', '', '', fuentes.join(','), new Date().toISOString()];
  appendRows_(sh, [row]);
  return concLeer_(ss).filter(function (r) { return r[0] === id; })[0];
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
    Object.keys(SHEETS).forEach(function (name) { asegurarHoja_(ss, name); }); // agrega Icono/Color si faltan
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
    descripcion: descText_(p.descripcion, false),
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


/* ===================== Normalización de descripciones (v1.19) =====================
 * Misma regla que web/src/lib/texto.ts (formatearDescripcion). Prioridad: 1) excepciones de marca/expresión,
 * 2) primera palabra, 3) palabras secundarias en minúscula, 4) mayúscula inicial. Idempotente. Solo se aplica a lo que se
 * escribe ahora (creaciones y ediciones); nunca reescribe registros históricos. */
var DESC_MINUSCULAS_ = ['de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'se', 'del', 'las', 'un', 'por', 'con', 'no', 'una', 'su', 'para', 'al', 'lo', 'como', 'más', 'o', 'pero', 'sus', 'le', 'me', 'si', 'sin', 'sobre', 'este', 'ya', 'entre', 'cuando', 'todo', 'esta', 'son', 'también', 'hasta', 'desde', 'mi', 'porque', 'qué', 'nos', 'ni', 'uno', 'donde', 'cada', 'e', 'otro', 'te', 'otros', 'aunque', 'esa', 'eso', 'otra', 'tan', 'durante', 'tanto', 'ella', 'él', 'yo', 'tú', 'tu', 'tus', 'mis', 'nuestro', 'nuestra', 'nuestros', 'nuestras', 'suyo', 'suya', 'suyos', 'suyas', 'aquel', 'aquella', 'aquellos', 'aquellas', 'estos', 'estas', 'ese', 'esos', 'esas', 'aquello', 'unas', 'unos', 'algo', 'alguien', 'nadie', 'nada', 'cual', 'cuáles', 'quien', 'quienes', 'cuyo', 'cuya', 'cuyos', 'cuyas', 'hacia', 'según'];
var DESC_EXCEPCIONES_BASE_ = ['ChatGPT', 'Google', 'YouTube', 'HBO', 'SOAT', 'Netflix', 'Spotify', 'Yape', 'Plin', 'USD', 'PEN', 'API', 'WiFi',   'iPhone', 'iPad', 'Claude', 'Cluely', 'Crunchyroll', 'Sodexo', 'KFC', 'BCP', 'BBVA', 'Interbank', 'Uber', 'Cabify', 'Rappi',   'PedidosYa', 'Amazon', 'Disney+', 'WhatsApp', 'iCloud', 'IGV', 'SUNAT', 'papa a la Huancaina'];
var DESC_EXC_CACHE_ = null;

function descExcepciones_() {
  if (DESC_EXC_CACHE_ !== null) return DESC_EXC_CACHE_;
  var extra = [];
  try {
    var sh = openSpreadsheet_(false).getSheetByName('CONFIG');
    var idx = sh ? findRowByValue_(sh, 1, 'desc_excepciones') : 0;
    if (idx) extra = String(sh.getRange(idx, 2).getValue() || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
  } catch (e) { extra = []; }
  DESC_EXC_CACHE_ = DESC_EXCEPCIONES_BASE_.concat(extra);
  return DESC_EXC_CACHE_;
}

function descPartir_(palabra) {
  var m = palabra.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}+]*)$/u);
  return m ? { pre: m[1], core: m[2], post: m[3] } : { pre: '', core: '', post: palabra };
}

function descCapitalizar_(core, inicio) {
  if (/\p{N}/u.test(core)) return core;
  return core.split(/([-/])/).map(function (seg, i) {
    if (seg === '-' || seg === '/' || !seg) return seg;
    var lower = seg.toLowerCase();
    if (!(inicio && i === 0) && DESC_MINUSCULAS_.indexOf(lower) >= 0) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('');
}

function normalizarDescripcion_(texto) {
  var limpio = String(texto === null || texto === undefined ? '' : texto).trim().replace(/\s+/g, ' ');
  if (!limpio) return '';
  var toks = limpio.split(' ').map(descPartir_);
  var fijo = toks.map(function () { return undefined; });
  var ex = descExcepciones_().map(function (e) { return e.trim().split(/\s+/); }).filter(function (w) { return w[0]; })
    .sort(function (a, b) { return b.length - a.length; });
  for (var i = 0; i < toks.length; i++) {
    if (fijo[i] !== undefined || !toks[i].core) continue;
    for (var j = 0; j < ex.length; j++) {
      var e = ex[j];
      if (i + e.length > toks.length) continue;
      var ok = true;
      for (var k = 0; k < e.length; k++) {
        if (fijo[i + k] !== undefined || toks[i + k].core.toLowerCase() !== e[k].toLowerCase()) { ok = false; break; }
      }
      if (ok) { for (var k2 = 0; k2 < e.length; k2++) fijo[i + k2] = e[k2]; break; }
    }
  }
  var primera = true;
  return toks.map(function (t, i) {
    if (!t.core) return t.pre + t.post;
    var out = fijo[i] !== undefined ? fijo[i] : descCapitalizar_(t.core, primera);
    primera = false;
    return t.pre + out + t.post;
  }).join(' ');
}

// Descripción lista para guardar: normalizada y validada como cualquier texto.
function descText_(v, required) { return text_(normalizarDescripcion_(str_(v)), 'Descripción', 200, required); }

// Evita que un texto se interprete como fórmula en Sheets (inyección de fórmulas).
function safeCell_(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }

function gastoToRow_(g, estado, origen, creado, actualizado) {
  return [g.fecha, g.monto, g.moneda, g.categoria, g.subcategoria, g.descripcion, g.medio, g.tipo,
    g.ambito, g.recurrente, estado, origen, g.url, g.id, creado, actualizado];
}

// Busca un ID (UUID) con TextFinder: Sheets lo resuelve en el servidor, sin traer la columna entera al script.
// Mismo criterio que antes: celda completa, sin distinguir mayúsculas; devuelve la primera fila (0 si no está).
function findRowById_(sh, col, id) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var hit = sh.getRange(2, col, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).matchCase(false).findNext();
  return hit ? hit.getRow() : 0;
}

function findRowByValue_(sh, col, value) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var vals = sh.getRange(2, col, last - 1, 1).getValues();
  var target = String(value).toLowerCase();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).toLowerCase() === target) return i + 2;
  return 0;
}
