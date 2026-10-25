import { formatearDescripcion } from './texto'
import { aislaDesde } from './engine'
import { daysInMonth, shiftMonth } from './dates'
import { mesesEntre, validarPrueba } from './datosPrueba'
import { leerReglas, type Transport } from './api'
import { validarAsignacion, validarMedioGasto, validarRegla } from './presupuesto'
import type { Fondo, Gasto, ParteManual, ReglaFondo } from './types'
import { CATALOGO_INICIAL } from './catalogo'
import { nextOrden, normName, ordenCanonico, ordenTrasReordenarCategorias } from './orden'

/** Modo demostración: backend en memoria con datos sintéticos. Se usa sin URL configurada, en pruebas E2E y en mediciones. */

const DEMO_CATALOGO: [string, string, string][] = Object.entries(CATALOGO_INICIAL)
  .flatMap(([a, cats]) => Object.entries(cats).flatMap(([c, subs]) => subs.map((sub): [string, string, string] => [a, c, sub])))
const MEDIOS = ['Yape', 'Plin', 'Sodexo', 'Transferencia', 'Efectivo', 'Otros']
const TIPOS = ['Fijo', 'Variable', 'Extraordinario']

/** Generador determinista (mismos datos en cada ejecución) para pruebas reproducibles. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

export function generateGastoRows(n: number, today: string, seed = 42): unknown[][] {
  const rand = rng(seed)
  const rows: unknown[][] = []
  for (let i = 0; i < n; i++) {
    const periodo = shiftMonth(today.slice(0, 7), -Math.floor(rand() * 8))
    const maxDay = periodo === today.slice(0, 7) ? Number(today.slice(8, 10)) : 28
    const day = String(1 + Math.floor(rand() * maxDay)).padStart(2, '0')
    const [ambito, categoria, sub] = DEMO_CATALOGO[Math.floor(rand() * DEMO_CATALOGO.length)]
    const usd = rand() < 0.05
    const ts = `${periodo}-${day}T12:00:00.000Z`
    rows.push([`${periodo}-${day}`, Math.round(rand() * (usd ? 50 : 250) * 100) / 100 + 1, usd ? 'USD' : 'PEN', categoria, sub,
      `${sub} ${i + 1}`, MEDIOS[Math.floor(rand() * MEDIOS.length)], TIPOS[Math.floor(rand() * 3)], ambito, rand() < 0.1,
      rand() < 0.03 ? 'Anulado' : 'Activo', 'demo', '', `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, ts, ts])
  }
  return rows
}

/** Catálogo vigente con su orden, más una opción antigua inactiva ("Antojos") para mostrar cómo se ven los históricos. */
function demoCatalogo(): unknown[][] {
  const orden = ordenCanonico(CATALOGO_INICIAL)
  const o = (a: string, c = '', s = '') => orden.get(`${normName(a)}|${normName(c)}|${normName(s)}`) ?? ''
  return [
    ...Object.keys(CATALOGO_INICIAL).map(a => [a, '', '', true, '', '', o(a)]),
    ...DEMO_CATALOGO.map(([a, c, s]) => [a, c, s, true, '', '', o(a, c, s)]),
    ['Personal', 'Alimentación', 'Antojos', false, '', '', ''],
  ]
}

/**
 * Casos de Salud de datos y compromisos del mes en curso: pago de Luz (vinculado), pago parcial de Internet,
 * tres "Propina Madre" idénticas y legítimas (pagos de meses distintos hechos el mismo día) y una clasificación antigua.
 */
function demoSalud(today: string): unknown[][] {
  const mes = today.slice(0, 8)
  const dia = (d: number) => `${mes}${String(Math.min(d, Number(today.slice(8, 10)))).padStart(2, '0')}`
  const ts = `${today}T12:00:00.000Z`
  const g = (f: string, monto: number, cat: string, sub: string, desc: string, medio: string, amb: string, id: string) =>
    [f, monto, 'PEN', cat, sub, desc, medio, 'Fijo', amb, false, 'Activo', 'demo', '', `d0000000-0000-4000-8000-${id}`, ts, ts]
  return [
    g(dia(3), 120, 'Servicios', 'Luz', 'Luz', 'Yape', 'Familia', '900000000001'),
    g(dia(4), 50, 'Servicios', 'Internet', 'Internet', 'Plin', 'Familia', '900000000002'),
    ...[3, 4, 5].map(n => g(dia(6), 100, 'Apoyo Familiar', 'Madre', 'Propina Madre', 'Yape', 'Familia', `90000000000${n}`)),
    g(dia(2), 80, 'Bebé', 'Cuidado Darielita', 'Cuidado de la bebé', 'Efectivo', 'Familia', '900000000006'),
  ]
}

// Fondos de ejemplo (?fondos=N): las tres primeras son el caso real (General + Sodexo + Extra 1 = S/ 4,780 en el mes). Sin reglas
// guardadas (columna 15 vacía), igual que los fondos anteriores a v1.28: Sodexo solo acepta Sodexo y todos cubren todos los gastos.
const FONDOS_EXTRA = ['Bonificación', 'Reembolso', 'Trabajo independiente', 'Extra 2', 'Ingreso adicional', 'Otro ingreso', 'Freelance', 'Venta', 'Premio',
  'Devolución', 'Aguinaldo', 'Gratificación', 'CTS', 'Comisión', 'Regalo', 'Alquiler', 'Intereses', 'Dividendos', 'Extra 3', 'Extra 4', 'Extra 5', 'Extra 6']
const COLORES_FONDO = ['#14917F', '#0E8FA8', '#C2569B', '#6B8E23', '#4F7BE8', '#B4693C', '#8B7CF6', '#64748B', '#6366F1', '#2F9E6B']
function demoFondos(n: number, mes: string): unknown[][] {
  const t = '2026-01-01T00:00:00.000Z'
  const base: unknown[][] = [
    ['fondo-general', 'General', 3500, 'PEN', '#1e3a8a', '', true, 1, 'mensual', '', '', t, t, 'mensual', ''],
    ['f-sodexo', 'Sodexo', 280, 'PEN', '#6B8E23', '', true, 2, 'mensual', '', 'Sodexo', t, t, 'mensual', ''],
    ['f-extra-1', 'Extra 1', 1000, 'PEN', '#B4693C', '', true, 3, 'unica', mes, '', t, t, 'extra', ''],
  ]
  const extra = FONDOS_EXTRA.map((nombre, i): unknown[] => [`f-demo-${i + 1}`, nombre, 50 * (i + 1), 'PEN', COLORES_FONDO[i % COLORES_FONDO.length], '', i % 4 !== 3, i + 4, i % 2 ? 'unica' : 'mensual', i % 2 ? mes : '', '', t, t, i % 2 ? 'extra' : 'mensual', ''])
  return [...base, ...extra].slice(0, n)
}

/** `vacio`: simula una hoja conectada pero sin ningún registro (solo pruebas / ?demo&vacio=1). */
export function demoTransport(today: string, n = 400, latencyMs = 250, nFondos = 0, vacio = false): Transport {
  const db = {
    // + un gasto con una subcategoría que ya no está en el catálogo (histórico): debe verse y filtrarse igual.
    gastos: [...generateGastoRows(n, today), [`${today.slice(0, 8)}01`, 12.5, 'PEN', 'Alimentación', 'Antojos', 'Gasto histórico', 'Yape', 'Variable',
      'Personal', false, 'Activo', 'demo', '', 'd0000000-0000-4000-8000-999999999999', `${today}T12:00:00.000Z`, `${today}T12:00:00.000Z`],
      ...demoSalud(today)] as unknown[][],
    catalogo: demoCatalogo(),
    medios: MEDIOS.map(m => [m, true]) as unknown[][],
    fondos: demoFondos(nFondos, today.slice(0, 7)),
    fondosMeses: [] as unknown[][],
    // [gastoId (minúsculas), JSON de partes]: asignaciones manuales (como ASIGNACIONES_GASTOS).
    asignaciones: [] as unknown[][],
    // [id, tipo, nombre, monto, moneda, medios, campo, valor, descripción, color, icono, recurrencia, activo, orden, origenId, estados, creado, actualizado]
    plantillasFin: [] as unknown[][],
    // [id, ámbito, categoría, subcategoría, descripción, creado, actualizado, monto, moneda, medio, orden]
    plantillas: ([
      ['Familia', 'Servicios', 'Luz', 'Luz', 120, 'PEN', 'Yape'],
      ['Familia', 'Servicios', 'Agua', 'Agua', 60, 'PEN', 'Yape'],
      ['Familia', 'Servicios', 'Internet', 'Internet', 100, 'PEN', 'Plin'],
      ['Familia', 'Servicios', 'Gas', 'Gas', 45, 'PEN', 'Efectivo'],
      ['Personal', 'Servicios', 'Línea Celular', 'Línea Celular', 40, 'PEN', 'Yape'],
      ['Personal', 'Suscripciones', 'ChatGPT', 'ChatGPT', 80, 'PEN', 'Yape'],
      ['Personal', 'Suscripciones', 'Spotify', 'Spotify', 25, 'PEN', 'Yape'],
      ['Personal', 'Suscripciones', 'Claude', 'Claude', 20, 'USD', 'Transferencia'],
      ['Personal', 'Suscripciones', 'Netflix', 'Netflix', 40, 'PEN', 'Yape'],
      ['Familia', 'Apoyo Familiar', 'Padre', 'Seguro Padre', 100, 'PEN', 'Transferencia'],
      ['Personal', 'Alimentación', 'Antojos', 'Antojos de la Tarde', '', 'PEN', ''], // clasificación retirada: "Requiere revisión"
    ] as unknown[][]).map((r, i) => [`pl-00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, r[0], r[1], r[2], r[3], '', '', r[4], r[5], r[6], i + 1,
      // Compromisos de ejemplo: Luz, Agua, Internet, Línea Celular, ChatGPT y Seguro Padre (el resto son solo atajos).
      [1, 2, 3, 5, 6, 10].includes(i + 1)]),
    ordenGastos: [] as unknown[][],
    // [gastoId, plantillaId, creado]: Luz pagada completa e Internet con un pago parcial (S/ 50 de 100).
    vinculos: [['d0000000-0000-4000-8000-900000000001', 'pl-00000000-0000-4000-8000-000000000001', ''],
      ['d0000000-0000-4000-8000-900000000002', 'pl-00000000-0000-4000-8000-000000000003', '']] as unknown[][],
    revisiones: [] as unknown[][],
    revisionesPresupuesto: [] as unknown[][],
    config: { moneda: 'PEN', monedas: 'PEN,USD', tipo_cambio_USD: '3.75', zona_horaria: 'America/Lima', formato_fecha: 'dd/MM/yyyy', tema: 'claro', notificaciones: 'true' } as Record<string, string>,
  }
  if (vacio) { db.gastos = []; db.catalogo = []; db.medios = []; db.fondos = []; db.plantillas = []; db.vinculos = [] }
  const upsert = (rows: unknown[][], keyLen: number, row: unknown[]) => {
    const key = JSON.stringify(row.slice(0, keyLen)).toLowerCase()
    const i = rows.findIndex(r => JSON.stringify(r.slice(0, keyLen)).toLowerCase() === key)
    if (i >= 0) rows[i] = row; else rows.push(row)
    return row
  }
  const vincular = (gastoId: string, plantillaId: string) => {
    const r = db.vinculos.find(x => String(x[0]).toLowerCase() === gastoId.toLowerCase())
    if (r) r[1] = plantillaId; else if (plantillaId) db.vinculos.push([gastoId, plantillaId, new Date().toISOString()])
  }
  const CARPETA_DEMO = { id: 'demo-backup-folder', nombre: 'Backup', url: 'https://drive.google.com/drive/', personalizada: false }
  let carpeta = { ...CARPETA_DEMO }
  const fail = (code: string, message: string) => Object.assign(new Error(message), { code })

  // ---- Fondos como objetos (mismas reglas que el backend, vía lib/presupuesto.ts) ----
  const fondosObj = (): Fondo[] => db.fondos.map(r => ({
    id: String(r[0]), nombre: String(r[1]), monto: Number(r[2]), moneda: String(r[3]), color: String(r[4]), icono: String(r[5]), activo: r[6] !== false, orden: Number(r[7]),
    recurrencia: r[8] === 'unica' ? 'unica' : 'mensual', mes: String(r[9] ?? ''), medioPago: String(r[10] ?? ''), tipo: 'mensual', creadoEn: '', actualizadoEn: '', reglas: leerReglas(String(r[14] ?? ''), String(r[10] ?? '')),
  }))
  const gastoObj = (p: Record<string, unknown>) => ({ fecha: String(p.fecha), medioPago: String(p.medioPago ?? ''), ambito: String(p.ambito ?? ''), categoria: String(p.categoria ?? ''), subcategoria: String(p.subcategoria ?? '') })
  const exigirMedio = (p: Record<string, unknown>, prefijo = '') => {
    const v = validarMedioGasto(gastoObj(p), fondosObj())
    if (!v.ok) throw fail('MEDIO_RESTRINGIDO', prefijo + v.mensaje)
  }

  // ---- Plantillas de fondos (misma lógica que el backend) ----
  const pfPub = (r: unknown[]) => {
    const est = r[15] as Record<string, { e: string; m: number }>
    return [...r.slice(0, 15), Object.fromEntries(Object.entries(est).map(([m, v]) => [m, { e: v.e, m: v.m }])), r[16], r[17], r[18] ?? null]
  }
  const MES = /^\d{4}-(0[1-9]|1[0-2])$/
  // Igual que pfIdSeguro_ del backend: cabe en el límite (60); si "pf-"+UUID no cabe con el prefijo, se omite su "pf-".
  const seguro = (pre: string, id: unknown, max = 60) => {
    const limpio = String(id).replace(/[^A-Za-z0-9_-]/g, ''), s = pre + limpio
    return s.length <= max ? s : (pre + limpio.replace(/^pf-/, '')).slice(0, max)
  }
  const eq = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100)
  const efectivoFondo = (f: unknown[], mes: string) => {
    let solo: unknown[] | undefined, desde: unknown[] | undefined
    for (const m of db.fondosMeses) {
      if (m[0] !== f[0]) continue
      if (m[3] === 'solo' && m[1] === mes) solo = m
      else if (m[3] === 'desde' && String(m[1]) <= mes && (!desde || String(m[1]) > String(desde[1]))) desde = m
    }
    if (mes >= aislaDesde(db.config)) {
      if (solo) return { monto: Number(solo[2]), solo: Number(solo[2]), aplicada: true }
      const propia = f[8] === 'unica' && mes === f[9]
      return { monto: propia ? Number(f[2]) : 0, solo: null, aplicada: propia }
    }
    if (solo) return { monto: Number(solo[2]), solo: Number(solo[2]), aplicada: true }
    if (f[8] === 'unica') return { monto: mes === f[9] ? Number(f[2]) : 0, solo: null, aplicada: true }
    if (desde) return { monto: Number(desde[2]), solo: null, aplicada: true }
    return { monto: !f[9] || mes >= String(f[9]) ? Number(f[2]) : 0, solo: null, aplicada: true }
  }
  const handlers: Record<string, (p: Record<string, unknown>) => unknown> = {
    data: () => structuredClone({ ...db, plantillasFin: db.plantillasFin.filter(r => r[1] === 'fondo').map(pfPub), vinculos: db.vinculos.filter(r => r[1]).map(r => [r[0], r[1]]), version: '1.0.0-demo', sheetUrl: 'https://docs.google.com/spreadsheets/' }),
    saveGasto: p => {
      const now = new Date().toISOString()
      const i = db.gastos.findIndex(r => r[13] === p.id)
      if (p.mode === 'create' && i >= 0) return db.gastos[i]
      if (p.mode === 'update' && i < 0) throw fail('NOT_FOUND', 'El gasto ya no existe en la hoja.')
      const prev = i >= 0 ? db.gastos[i] : null
      // Igual que saveGasto_: el medio se revalida al crear y al editar solo si cambió medio, clasificación o mes.
      const clave = (x: unknown[]) => [x[6], x[8], x[3], x[4], String(x[0]).slice(0, 7)].map(v => normName(String(v ?? ''))).join('|')
      if (!prev || clave(prev) !== clave([p.fecha, 0, 0, p.categoria, p.subcategoria, 0, p.medioPago, 0, p.ambito])) exigirMedio(p)
      const row = [p.fecha, Math.round(Number(p.monto) * 100) / 100, p.moneda, p.categoria, p.subcategoria, formatearDescripcion(String(p.descripcion ?? '')), p.medioPago,
        p.tipoGasto, p.ambito, p.esRecurrente === true, prev ? prev[10] : 'Activo', prev ? prev[11] : 'web', p.comprobanteUrl ?? '',
        p.id, prev ? prev[14] : now, now]
      if (i >= 0) db.gastos[i] = row; else db.gastos.push(row)
      if (p.mode === 'create' && p.plantillaId) vincular(String(p.id), String(p.plantillaId))
      return row
    },
    setEstado: p => {
      const row = db.gastos.find(r => r[13] === p.id)
      if (!row) throw fail('NOT_FOUND', 'El gasto ya no existe en la hoja.')
      row[10] = p.estado
      row[15] = new Date().toISOString()
      return { id: p.id, estado: p.estado, actualizadoEn: row[15] }
    },
    setEstadoLote: p => {
      const ids = Array.isArray(p.ids) ? (p.ids as string[]) : []
      if (p.estado !== 'Activo' && p.estado !== 'Anulado') throw fail('VALIDATION', 'Estado inválido.')
      if (!ids.length || ids.length > 200) throw fail('VALIDATION', 'Elige entre 1 y 200 gastos.')
      if (new Set(ids.map(x => x.toLowerCase())).size !== ids.length) throw fail('VALIDATION', 'Hay IDs repetidos en la selección.')
      const rows = ids.map(id => db.gastos.filter(r => String(r[13]).toLowerCase() === id.toLowerCase()))
      if (rows.some(r => r.length === 0)) throw fail('NOT_FOUND', 'Algún gasto ya no existe en la hoja. Actualiza los datos y vuelve a elegir.')
      if (rows.some(r => r.length > 1)) throw fail('VALIDATION', 'Un gasto tiene el ID repetido en la hoja. Ejecuta repararIds primero.')
      const now = new Date().toISOString()
      rows.forEach(([r]) => { r[10] = p.estado; r[15] = now })
      return { ids, estado: p.estado, actualizadoEn: now }
    },
    saveCatalogo: p => {
      const k = (r: unknown[]) => r.slice(0, 3).map(x => normName(String(x ?? ''))).join('|')
      const key = k([p.ambito, p.categoria ?? '', p.subcategoria ?? ''])
      const prev = db.catalogo.find(r => k(r) === key)
      let icono = p.icono === undefined ? (prev?.[4] ?? '') : p.icono
      let color = p.color === undefined ? (prev?.[5] ?? '') : p.color
      // Categorías y subcategorías se comparten entre ámbitos (igual que saveCatalogo_ en Code.gs).
      const cat = String(p.categoria ?? ''), sub = String(p.subcategoria ?? '')
      const hermana = (r: unknown[]) => !!cat && normName(String(r[1])) === normName(cat) && (sub ? normName(String(r[2])) === normName(sub) : String(r[2] ?? '') === '')
      if (prev) {
        prev[3] = p.activo !== false; prev[4] = icono; prev[5] = color
        if (hermana(prev) && (p.icono !== undefined || p.color !== undefined)) {
          for (const r of db.catalogo) if (r !== prev && hermana(r)) { if (p.icono !== undefined) r[4] = icono; if (p.color !== undefined) r[5] = color }
        }
        return [...prev]
      }
      const existente = db.catalogo.find(r => hermana(r) && (r[4] || r[5]))
      if (existente) { icono = String(existente[4] || icono); color = String(existente[5] || color) }
      const filas = db.catalogo.map(r => ({ ambito: String(r[0]), categoria: String(r[1]), orden: typeof r[6] === 'number' ? r[6] : undefined }))
      let orden = nextOrden(filas, String(p.ambito), String(p.categoria ?? ''), String(p.subcategoria ?? ''))
      if (!sub) {   // cabecera de un ámbito/categoría existente: hereda su Orden mínimo (no cambia de posición)
        const propios = filas.filter(r => normName(r.ambito) === normName(String(p.ambito)) && (!cat || normName(r.categoria) === normName(cat)) && r.orden !== undefined).map(r => r.orden!)
        if (propios.length) orden = Math.min(...propios)
      }
      const row = [p.ambito, p.categoria ?? '', p.subcategoria ?? '', p.activo !== false, icono, color, orden ?? '']
      db.catalogo.push(row)
      return [...row]
    },
    renameCatalogo: p => {
      const col = { ambito: 0, categoria: 1, subcategoria: 2 }[String(p.nivel) as 'ambito']
      const match = (a: unknown, c: unknown, s: unknown) => a === p.ambito && (p.nivel === 'ambito' || c === p.categoria) && (p.nivel !== 'subcategoria' || s === p.subcategoria)
      let catalogo = 0, gastos = 0
      for (const r of db.catalogo) if (match(r[0], r[1], r[2])) { r[col] = p.nuevo; catalogo++ }
      const gcol = [8, 3, 4][col]
      for (const r of db.gastos) if (match(r[8], r[3], r[4])) { r[gcol] = p.nuevo; gastos++ }
      if (!catalogo) throw fail('NOT_FOUND', 'La opción ya no existe en el catálogo.')
      // Igual que renameCatalogo_: las rutas de fondos fijadas a ese ámbito se renombran en todas sus versiones.
      let fondos = 0
      for (const r of db.fondos) {
        if (!r[14]) continue
        const vs = JSON.parse(String(r[14])) as ReglaFondo[]
        let cambio = false
        for (const v of vs) for (const ru of v.rutas) {
          if (!ru.ambito || !match(ru.ambito, ru.categoria, ru.subcategoria)) continue
          if (col === 0) { ru.ambito = String(p.nuevo); cambio = true } else if (col === 1 && ru.categoria) { ru.categoria = String(p.nuevo); cambio = true } else if (col === 2 && ru.subcategoria) { ru.subcategoria = String(p.nuevo); cambio = true }
        }
        if (cambio) { r[14] = JSON.stringify(vs); fondos++ }
      }
      return { catalogo, gastos, fondos }
    },
    reorderCategorias: p => {
      const nombres = Array.isArray(p.categorias) ? p.categorias.map(String) : []
      const o = ordenTrasReordenarCategorias(db.catalogo.map(r => ({ ambito: String(r[0]), categoria: String(r[1]), subcategoria: String(r[2]), orden: typeof r[6] === 'number' ? r[6] : undefined })), String(p.ambito), nombres)
      let cambios = 0
      db.catalogo.forEach((r, i) => { if (o[i] !== undefined && r[6] !== o[i]) { r[6] = o[i]; cambios++ } })
      return { ambito: p.ambito, categorias: nombres.length, cambios }
    },
    deleteCategoria: p => {
      const n = (v: unknown) => normName(String(v ?? ''))
      const filas = db.catalogo.filter(r => n(r[0]) === n(p.ambito) && n(r[1]) === n(p.categoria))
      if (!filas.length) return { eliminada: false, subcategorias: 0 }
      const subs = filas.filter(r => String(r[2]) !== '').map(r => n(r[2]))
      const gastos = db.gastos.filter(r => n(r[8]) === n(p.ambito) && n(r[3]) === n(p.categoria)).length
      const pl = db.plantillas.filter(r => n(r[1]) === n(p.ambito) && n(r[2]) === n(p.categoria)).length
      const otro = db.catalogo.some(r => n(r[0]) !== n(p.ambito) && n(r[1]) === n(p.categoria))
      const fondos = fondosObj().filter(f => f.reglas.some(v => v.rutas.some(ru => n(ru.categoria) === n(p.categoria) && (n(ru.ambito) === n(p.ambito) || (!ru.ambito && !otro))))).length
      if (gastos || pl || fondos) throw fail('IN_USE', `No se puede eliminar “${p.categoria}”: la usan ${[gastos && `${gastos} gasto(s)`, pl && `${pl} plantilla(s)`, fondos && `${fondos} fondo(s) del presupuesto`].filter(Boolean).join(', ')}. Desactívala para conservar el historial.`)
      if (subs.length && p.cascada !== true) throw fail('IN_USE', `“${p.categoria}” tiene ${subs.length} subcategoría(s). Confirma la eliminación en cascada o desactívala.`)
      db.catalogo = db.catalogo.filter(r => !(n(r[0]) === n(p.ambito) && n(r[1]) === n(p.categoria)))
      return { eliminada: true, subcategorias: subs.length }
    },
    saveMedio: p => {
      if (String(p.nombre ?? '').includes('|')) throw fail('VALIDATION', 'El nombre del medio no puede contener “|” (se usa para separar varios medios en un fondo).')
      const prev = db.medios.find(r => String(r[0]).toLowerCase() === String(p.nombre).toLowerCase())
      return upsert(db.medios, 1, [p.nombre, p.activo !== false, p.icono === undefined ? prev?.[2] ?? '' : p.icono, p.color === undefined ? prev?.[3] ?? '' : p.color])
    },
    saveAsignacion: p => {
      const gastoId = String(p.gastoId ?? '').toLowerCase()
      const row = db.gastos.find(r => String(r[13]).toLowerCase() === gastoId)
      if (!row) throw fail('NOT_FOUND', 'El gasto ya no existe en la hoja.')
      const partes = (Array.isArray(p.partes) ? p.partes : []) as ParteManual[]
      db.asignaciones = db.asignaciones.filter(r => r[0] !== gastoId)
      if (!partes.length) return [gastoId, '']
      if (row[10] === 'Anulado') throw fail('VALIDATION', 'El gasto está eliminado: restáuralo antes de cambiar su asignación.')
      const g = { fecha: row[0], monto: row[1], moneda: row[2], categoria: row[3], subcategoria: row[4], medioPago: row[6], ambito: row[8], id: row[13] } as unknown as Gasto
      const e = validarAsignacion(g, partes, fondosObj(), { fondosMeses: db.fondosMeses.map(m => ({ fondoId: String(m[0]), mes: String(m[1]), monto: Number(m[2]), modo: m[3] === 'desde' ? 'desde' : 'solo' })), aislarDesde: aislaDesde(db.config) })
      if (e) throw fail('VALIDATION', e)
      const json = JSON.stringify(partes.map(x => ({ fondoId: x.fondoId, monto: Math.round(x.monto * 100) / 100 })))
      db.asignaciones.push([gastoId, json])
      return [gastoId, json]
    },
    deleteFondo: p => {
      const antes = db.fondos.length, ajustes = db.fondosMeses.length
      db.fondos = db.fondos.filter(r => r[0] !== p.id)
      db.fondosMeses = db.fondosMeses.filter(r => r[0] !== p.id)
      return { id: p.id, eliminada: db.fondos.length < antes, ajustes: ajustes - db.fondosMeses.length }
    },
    // Mismas validaciones que saveFondo_ en Code.gs (upsert por ID: un doble clic no duplica).
    saveFondo: p => {
      const nombre = String(p.nombre ?? '').trim(), mes = String(p.mes ?? '')
      const reglas = Array.isArray(p.reglas) ? (p.reglas as ReglaFondo[]) : null
      if (reglas) for (const r of reglas) { const e = validarRegla(r); if (e) throw fail('VALIDATION', e) }
      const ult = reglas?.[reglas.length - 1]
      const medio = ult ? (ult.medios === 'solo' ? ult.listaMedios.join('|') : '') : leerReglas('', String(p.medioPago ?? ''))[0].listaMedios.join('|')
      const monedas = [db.config.moneda, ...String(db.config.monedas ?? '').split(',')].map(x => x.trim()).filter(Boolean)
      if (!nombre) throw fail('VALIDATION', 'Nombre del fondo es obligatorio.')
      if (!(Number(p.monto) >= 0) || Number(p.monto) > 1e9) throw fail('VALIDATION', 'Monto inválido.')
      if (!monedas.includes(String(p.moneda))) throw fail('VALIDATION', `Moneda no permitida: ${p.moneda}. Agrégala en Configuración.`)
      if (mes && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw fail('VALIDATION', 'Mes de aplicación inválido (AAAA-MM).')
      if (p.recurrencia === 'unica' && !mes) throw fail('VALIDATION', 'Un fondo de un solo mes necesita su mes de aplicación.')
      const activo = p.activo !== false
      for (const r of db.fondos) {
        if (r[0] === p.id) continue
        if (normName(String(r[1])) === normName(nombre)) throw fail('VALIDATION', `Ya existe un fondo llamado “${r[1]}”.`)
      }
      const now = new Date().toISOString()
      const prev = db.fondos.find(r => r[0] === p.id)
      const row = [p.id, nombre, Math.round(Number(p.monto) * 100) / 100, p.moneda, p.color || '#1e3a8a', p.icono ?? '', activo,
        p.orden === undefined && prev ? prev[7] : Number(p.orden ?? 0), p.recurrencia === 'unica' ? 'unica' : 'mensual', mes, medio, prev ? prev[11] : now, now,
        ['mensual', 'extra', 'ahorro_asignado'].includes(String(p.tipo)) ? p.tipo : prev ? prev[13] : p.recurrencia === 'unica' ? 'extra' : 'mensual',
        reglas ? JSON.stringify(reglas) : prev ? prev[14] ?? '' : '']
      return upsert(db.fondos, 1, row)
    },
    savePlantillaFin: p => {
      const tipo = String(p.tipo)
      if (tipo !== 'fondo') throw fail('VALIDATION', 'Tipo de plantilla inválido.')
      const nombre = String(p.nombre ?? '').trim()
      if (!nombre) throw fail('VALIDATION', 'Nombre de la plantilla es obligatorio.')
      if (!(Number(p.monto) >= 0)) throw fail('VALIDATION', 'Monto inválido.')
      const origen = String(p.origenId ?? '')
      if (origen && !db.fondos.some(r => r[0] === origen)) throw fail('NOT_FOUND', 'El fondo original ya no existe.')
      let maxOrden = 0
      for (const r of db.plantillasFin) {
        maxOrden = Math.max(maxOrden, Number(r[13]))
        if (r[0] === p.id || r[1] !== tipo) continue
        if (normName(String(r[2])) === normName(nombre)) throw fail('VALIDATION', `Ya existe una plantilla llamada “${r[2]}”.`)
        if (origen && r[14] === origen) throw fail('DUPLICATE', `Ya existe una plantilla vinculada a este registro (“${r[2]}”). Edítala en lugar de crear otra.`)
      }
      const prev = db.plantillasFin.find(r => r[0] === p.id)
      if (prev && prev[1] !== tipo) throw fail('VALIDATION', 'No se puede cambiar el tipo de una plantilla.')
      const now = new Date().toISOString()
      const medios = String(p.medios ?? '').split('|').map(x => x.trim()).filter(x => x && x !== 'Libre')
      const row = [p.id, tipo, nombre, Math.round(Number(p.monto) * 100) / 100, String(p.moneda || 'PEN'), [...new Set(medios)].join('|'),
        '', '', formatearDescripcion(String(p.descripcion ?? '')), String(p.color || '#1e3a8a'), String(p.icono ?? ''),
        p.recurrencia === 'unica' ? 'unica' : 'mensual', p.activo !== false, prev ? prev[13] : p.orden === undefined ? maxOrden + 1 : Number(p.orden),
        prev && !origen ? prev[14] : origen, prev ? prev[15] : {}, prev ? prev[16] : now, now,
        p.datos === undefined ? (prev ? prev[18] ?? null : null) : (p.datos ?? null)]
      upsert(db.plantillasFin, 1, row)
      return pfPub(row)
    },
    deletePlantillaFin: p => {
      const antes = db.plantillasFin.length
      db.plantillasFin = db.plantillasFin.filter(r => r[0] !== p.id || r[1] !== 'fondo')
      return { id: p.id, eliminada: db.plantillasFin.length < antes }
    },
    reorderPlantillasFin: p => {
      const ids = (p.ids as string[]) ?? []
      let extra = ids.length + 1
      for (const r of db.plantillasFin) if (r[1] === p.tipo) r[13] = ids.indexOf(String(r[0])) >= 0 ? ids.indexOf(String(r[0])) + 1 : extra++
      return { ok: true }
    },
    aplicarPlantillasFin: p => {
      const mes = String(p.mes)
      if (!MES.test(mes)) throw fail('VALIDATION', 'Mes inválido (AAAA-MM).')
      const items = (p.items as { id: string; accion?: string; monto?: number }[]) ?? []
      if (!items.length || items.length > 60) throw fail('VALIDATION', 'Selecciona entre 1 y 60 plantillas.')
      const plan = items.map(it => {
        const r = db.plantillasFin.find(x => x[0] === it.id && x[1] === 'fondo')
        if (!r) throw fail('NOT_FOUND', 'Una plantilla ya no existe. Actualiza los datos.')
        const accion = it.accion === 'omitir' ? 'omitir' : it.accion === 'pendiente' ? 'pendiente' : 'aplicar'
        const monto = accion === 'aplicar' ? Number(it.monto ?? r[3]) : 0
        if (accion === 'aplicar' && !(monto >= 0)) throw fail('VALIDATION', 'Monto inválido.')
        if (accion === 'aplicar' && r[12] === false) throw fail('VALIDATION', `La plantilla “${r[2]}” está desactivada.`)
        if (accion === 'aplicar' && !r[14] && db.fondos.some(f => f[0] !== seguro('f-', r[0]) && normName(String(f[1])) === normName(String(r[2]))))
          throw fail('VALIDATION', `Ya existe un fondo llamado “${r[2]}”. Enlaza la plantilla a ese fondo (Guardar como plantilla desde ella).`)
        return { r, accion, monto }
      })
      const revertir = (r: unknown[], est: { e: string; w?: boolean; p?: number | null } | undefined) => {
        if (!est || est.e !== 'aplicada' || !est.w) return
        const origen = r[14]
        db.fondosMeses = db.fondosMeses.filter(x => !(x[0] === origen && x[1] === mes && x[3] === 'solo'))
        if (est.p != null) db.fondosMeses.push([origen, mes, est.p, 'solo'])
      }
      const out: unknown[] = []
      for (const { r, accion, monto } of plan) {
        const est = r[15] as Record<string, { e: string; m: number; w?: boolean; p?: number | null }>
        const act = est[mes]
        if (accion === 'aplicar' && act?.e === 'aplicada' && act.m === monto) { out.push(pfPub(r)); continue }
        if (act?.e === 'aplicada') revertir(r, act)
        if (accion === 'pendiente') delete est[mes]
        else if (accion === 'omitir') est[mes] = { e: 'omitida', m: 0 }
        else {
          let w = false, origen = String(r[14])
          if (!db.fondos.some(f => f[0] === origen)) {
            origen = seguro('f-', r[0])
            if (!db.fondos.some(f => f[0] === origen)) {
              const dat = r[18] as { tipo?: string; regla?: Record<string, unknown> } | null
              handlers.saveFondo({ id: origen, nombre: r[2], monto: r[3], moneda: r[4], color: r[9], icono: r[10], recurrencia: r[11], mes, activo: true, medioPago: r[5] || 'Libre', orden: db.fondos.length + 1,
                ...(dat?.tipo ? { tipo: dat.tipo } : {}), ...(dat?.regla ? { reglas: [{ desde: '', ...dat.regla }] } : {}) })
            }
          }
          const ef = efectivoFondo(db.fondos.find(f => f[0] === origen)!, mes)
          const prev = ef.solo
          if (!eq(monto, ef.monto) || !ef.aplicada) { handlers.saveFondoMes({ fondoId: origen, mes, modo: 'solo', monto }); w = true }
          est[mes] = { e: 'aplicada', m: monto, w, p: prev }
          r[14] = origen
        }
        r[17] = new Date().toISOString()
        out.push(pfPub(r))
      }
      return { mes, plantillas: out }
    },
    aplicarEntidadesMes: p => {
      if (p.tipo !== 'fondo') throw fail('VALIDATION', 'Tipo inválido: desde la versión 1.28 solo se aplican fondos (las cajas se retiraron).')
      const mes = String(p.mes)
      if (!MES.test(mes)) throw fail('VALIDATION', 'Mes inválido (AAAA-MM).')
      const items = (p.items as { id: string; monto: number }[]) ?? []
      if (!items.length || items.length > 60) throw fail('VALIDATION', 'Selecciona entre 1 y 60 elementos.')
      if (new Set(items.map(i => i.id)).size !== items.length) throw fail('VALIDATION', 'Elemento repetido en la solicitud.')
      const plan = items.map(it => {
        const fila = db.fondos.find(x => x[0] === it.id)
        if (!fila) throw fail('NOT_FOUND', 'Un fondo ya no existe. Actualiza los datos.')
        if (!(Number(it.monto) >= 0)) throw fail('VALIDATION', 'Monto inválido.')
        return { fila, monto: Number(it.monto) }
      })
      let escritas = 0
      for (const { fila, monto } of plan) {
        const ef = efectivoFondo(fila, mes)
        if (!eq(monto, ef.monto) || !ef.aplicada) { handlers.saveFondoMes({ fondoId: fila[0], mes, modo: 'solo', monto }); escritas++ }
      }
      return { tipo: 'fondo', mes, aplicadas: plan.length, escritas }
    },
    saveFondoMes: p => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p.mes))) throw fail('VALIDATION', 'Mes inválido (AAAA-MM).')
      if (!db.fondos.some(r => r[0] === p.fondoId)) throw fail('NOT_FOUND', 'El fondo ya no existe. Actualiza los datos.')
      const modo = p.modo === 'desde' ? 'desde' : 'solo'
      const same = (r: unknown[]) => r[0] === p.fondoId && r[1] === p.mes && r[3] === modo
      if (p.quitar === true) { const had = db.fondosMeses.some(same); db.fondosMeses = db.fondosMeses.filter(r => !same(r)); return { quitado: had } }
      if (!(Number(p.monto) >= 0)) throw fail('VALIDATION', 'Monto inválido.')
      const row = [p.fondoId, p.mes, Math.round(Number(p.monto) * 100) / 100, modo]
      const i = db.fondosMeses.findIndex(same)
      if (i >= 0) db.fondosMeses[i] = row; else db.fondosMeses.push(row)
      return row
    },
    reorderFondos: p => {
      const ids = p.ids as string[]
      db.fondos.forEach(r => { r[7] = ids.indexOf(String(r[0])) + 1 || ids.length + 1 })
      return { ok: true }
    },
    // Igual que completarVacios_ en Code.gs: solo rellena celdas vacías del catálogo con lo que envía la web.
    completarVacios: p => {
      let catalogo = 0
      const defs = new Map((Array.isArray(p.catalogo) ? p.catalogo as Record<string, string>[] : []).map(d => [[d.ambito, d.categoria, d.subcategoria].map(x => normName(String(x ?? ''))).join('|'), d]))
      for (const r of db.catalogo) {
        const d = defs.get(r.slice(0, 3).map(x => normName(String(x ?? ''))).join('|'))
        if (!d) continue
        let cambio = false
        if (!r[4] && d.icono) { r[4] = d.icono; cambio = true }
        if (!r[5] && d.color) { r[5] = d.color; cambio = true }
        if (cambio) catalogo++
      }
      return { fondos: 0, catalogo, config: 0, medios: 0 }
    },
    saveConfig: p => { db.config[String(p.clave)] = String(p.valor); return [p.clave, p.valor] },
    plantillas: () => [...db.plantillas].sort((a, b) => Number(a[10]) - Number(b[10])),
    savePlantilla: p => {
      const n = (v: unknown) => normName(String(v ?? ''))
      const k = (r: unknown[]) => [n(r[1]), n(r[2]), n(r[3]), n(r[4]), r[7] === '' ? '' : Math.round(Number(r[7]) * 100), n(r[8] || 'PEN'), n(r[9])].join('|')
      const now = new Date().toISOString()
      const monto = p.monto === '' || p.monto === null || p.monto === undefined ? '' : Math.round(Number(p.monto) * 100) / 100
      if (monto !== '' && !(Number(monto) >= 0)) throw fail('VALIDATION', 'Monto inválido.')
      const prevRow = db.plantillas.find(r => r[0] === p.id)
      const row = [p.id, p.ambito, p.categoria, p.subcategoria, formatearDescripcion(String(p.descripcion ?? '')), now, now, monto, p.moneda || 'PEN', p.medioPago ?? '', 0,
        p.esCompromiso === undefined ? (prevRow?.[11] ?? false) : p.esCompromiso === true,
        p.tipoGasto === undefined ? (prevRow?.[12] ?? 'Variable') : p.tipoGasto, p.esRecurrente === undefined ? (prevRow?.[13] ?? false) : p.esRecurrente === true]
      if (![row[1], row[2], row[3], row[4]].every(v => String(v ?? '').trim())) throw fail('VALIDATION', 'Ámbito, categoría, subcategoría y descripción son obligatorios.')
      if (db.plantillas.some(r => r[0] !== p.id && k(r) === k(row))) throw fail('VALIDATION', 'La plantilla ya existe. Modifica al menos uno de sus valores para guardar una copia.')
      const i = db.plantillas.findIndex(r => r[0] === p.id)
      if (i >= 0) { row[5] = db.plantillas[i][5]; row[10] = db.plantillas[i][10]; db.plantillas[i] = row; return [...row] }
      const orden = [...db.plantillas].sort((a, b) => Number(a[10]) - Number(b[10]))
      const pos = p.afterId ? orden.findIndex(r => r[0] === p.afterId) + 1 || orden.length : orden.length
      orden.splice(pos, 0, row)
      orden.forEach((r, j) => { r[10] = j + 1 })
      db.plantillas.push(row)
      return [...row]
    },
    reorderPlantillas: p => {
      const ids = p.ids as string[]
      const resto = db.plantillas.filter(r => !ids.includes(String(r[0]))).sort((a, b) => Number(a[10]) - Number(b[10]))
      ;[...ids.map(id => db.plantillas.find(r => r[0] === id)).filter(Boolean) as unknown[][], ...resto].forEach((r, j) => { r[10] = j + 1 })
      return { ok: true }
    },
    deletePlantilla: p => { db.plantillas = db.plantillas.filter(r => r[0] !== p.id); return { id: p.id, eliminada: true } },
    saveGastosBatch: p => {
      const lista = p.gastos as Record<string, unknown>[]
      lista.forEach((g, i) => { if (!(Number(g.monto) > 0) || !String(g.medioPago ?? '').trim()) throw fail('VALIDATION', `Gasto ${i + 1} (${g.descripcion}): monto o medio de pago inválido.`) })
      lista.forEach((g, i) => { if (!db.gastos.some(r => r[13] === g.id)) exigirMedio(g, `Gasto ${i + 1} (${formatearDescripcion(String(g.descripcion ?? '')) || 'sin descripción'}): `) })
      const now = new Date().toISOString()
      const nuevas: unknown[][] = []
      // Como el backend real: un ID ya existente no se duplica ni se modifica; se devuelve lo guardado.
      const filas = lista.map(g => db.gastos.find(r => r[13] === g.id) ?? (() => {
        const f = [g.fecha, Math.round(Number(g.monto) * 100) / 100, g.moneda, g.categoria, g.subcategoria, formatearDescripcion(String(g.descripcion ?? '')), g.medioPago,
          g.tipoGasto ?? 'Variable', g.ambito, g.esRecurrente === true, 'Activo', 'web', '', g.id, now, now]
        nuevas.push(f)
        return f
      })())
      db.gastos.push(...nuevas)
      lista.forEach(g => { if (g.plantillaId) vincular(String(g.id), String(g.plantillaId)) })
      return { estado: 'confirmado', loteId: p.loteId, solicitados: filas.length, confirmados: filas.length, nuevos: nuevas.length, yaExistian: filas.length - nuevas.length,
        ids: filas.map(f => f[13]), gastos: filas, mensaje: `Se registraron ${filas.length} gastos.` }
    },
    vincularGasto: p => {
      if (!db.gastos.some(r => String(r[13]).toLowerCase() === String(p.gastoId).toLowerCase())) throw fail('NOT_FOUND', 'El gasto ya no existe en la hoja.')
      vincular(String(p.gastoId), String(p.plantillaId ?? ''))
      return [p.gastoId, p.plantillaId ?? '']
    },
    saveRevision: p => {
      if (!['legitimo', 'pendiente', 'duplicado'].includes(String(p.estado))) throw fail('VALIDATION', 'Estado de revisión inválido.')
      const ids = (p.ids as string[]).map(x => x.toLowerCase()).sort().join(',')
      const now = new Date().toISOString()
      const prev = db.revisiones.find(r => r[2] === ids)
      if (prev) { prev[3] = p.estado; prev[4] = p.firma; prev[6] = now; return [...prev] }
      const row = [p.id, 'duplicado', ids, p.estado, p.firma, now, now]
      db.revisiones.push(row)
      return [...row]
    },
    // Revisión del presupuesto (v1.26): réplica del backend. Solo agrega filas a su propia hoja; nunca toca gastos ni fondos.
    saveRevisionPresupuesto: p => {
      const prev = db.revisionesPresupuesto.find(r => r[0] === p.id); if (prev) return [...prev]
      if (!/^rev-[0-9a-f-]{36}$/.test(String(p.id))) throw fail('VALIDATION', 'ID de revisión inválido.')
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p.periodo))) throw fail('VALIDATION', 'Período inválido.')
      if (!['pendiente', 'completo', 'con_gastos_anteriores', 'revisado_con_observaciones'].includes(String(p.estado))) throw fail('VALIDATION', 'Estado de revisión inválido.')
      if (String(p.observacion ?? '').length > 500 || String(p.pendientes ?? '').length > 500) throw fail('VALIDATION', 'Las notas admiten hasta 500 caracteres.')
      if (p.estado === 'con_gastos_anteriores' && !String(p.pendientes ?? '').trim()) throw fail('VALIDATION', 'Anota qué gastos faltan por registrar.')
      if (p.estado === 'revisado_con_observaciones' && !String(p.observacion ?? '').trim()) throw fail('VALIDATION', 'Escribe la observación de la revisión.')
      const row = [p.id, p.periodo, p.estado, String(p.pendientes ?? ''), String(p.observacion ?? ''), '', new Date().toISOString()]
      db.revisionesPresupuesto.push(row)
      return [...row]
    },
    reorderGastos: p => {
      ;(p.ids as string[]).forEach((id, i) => {
        const r = db.ordenGastos.find(x => x[0] === id)
        if (r) r[1] = i + 1; else db.ordenGastos.push([id, i + 1])
      })
      return { ok: true }
    },
    // Funciones de mantenimiento (en demostración devuelven una respuesta de ejemplo y no cambian nada).
    setup: () => ({ spreadsheet: 'https://docs.google.com/spreadsheets/', apiToken: 'demo-token-no-real', hojas: 12 }),
    misArchivos: () => ({ proyecto: 'https://script.google.com/', spreadsheetId: 'demo', hoja: 'https://docs.google.com/spreadsheets/', urlApi: 'https://script.google.com/macros/s/demo/exec', respaldos: 'Busca "Gasto Deejota - Respaldo" en Google Drive' }),
    crearTokenAtajo: () => ({ token: 'atj_demo_no_real' }),
    revocarTokenAtajo: () => ({ revocado: true }),
    autorizarRespaldos: () => ({ carpeta: carpeta.nombre, url: carpeta.url }),
    // Igual que el backend: `cantidad` gastos válidos repartidos en los meses de [desde, hasta] y un presupuesto de prueba por mes.
    generarDatosPrueba: p => {
      const v = validarPrueba({ cantidad: (p.cantidad as number | string | undefined) ?? 60, desde: String(p.desde ?? '2026-07'), hasta: String(p.hasta ?? '2026-09') })
      if (!v.ok) throw fail('VALIDATION', v.errores.cantidad ?? v.errores.periodo ?? 'Parámetros inválidos.')
      const { cantidad, desde, hasta } = v.valor
      const meses = mesesEntre(desde, hasta)
      const combos = db.catalogo.filter(c => c[0] && c[1] && c[2] && c[3] !== false)
      const medios = db.medios.filter(m => m[1] !== false).map(m => String(m[0]))
      if (!combos.length || !medios.length) throw fail('VALIDATION', 'El catálogo o los medios de pago no tienen elementos activos para generar datos de prueba.')
      const now = new Date().toISOString()
      const nuevas: unknown[][] = []
      for (let i = 0; i < cantidad; i++) {
        const mes = meses[i % meses.length], r = Math.random(), c = combos[Math.floor(Math.random() * combos.length)]
        const dia = 1 + Math.floor(Math.random() * daysInMonth(mes))
        nuevas.push([`${mes}-${String(dia).padStart(2, '0')}`, Math.round((3 + r * r * 297) * 10) / 10, 'PEN', c[1], c[2], c[2], medios[Math.floor(Math.random() * medios.length)],
          r > 0.95 ? 'Extraordinario' : r > 0.8 ? 'Fijo' : 'Variable', c[0], false, 'Activo', 'prueba', '', crypto.randomUUID(), now, now])
      }
      db.gastos.push(...nuevas)
      const porMes: Record<string, number> = {}
      db.gastos.filter(g => g[11] === 'prueba' && g[10] !== 'Anulado').forEach(g => { const m = String(g[0]).slice(0, 7); porMes[m] = (porMes[m] ?? 0) + Number(g[1]) })
      const presupuesto = (m: string) => Math.max(50, Math.ceil((porMes[m] ?? 0) * 1.15 / 50) * 50)
      if (!db.fondos.some(f => f[0] === 'f-prueba-presupuesto'))
        db.fondos.push(['f-prueba-presupuesto', 'Presupuesto de prueba', presupuesto(desde), 'PEN', '#6366F1', '', true, 99, 'unica', desde, '', now, now, 'extra'])
      meses.forEach(m => handlers.saveFondoMes({ fondoId: 'f-prueba-presupuesto', mes: m, modo: 'solo', monto: presupuesto(m) }))
      return { gastos: cantidad, desde, hasta, meses: meses.length, presupuestoPorMes: meses.map(m => [m, presupuesto(m)]), respaldo: 'https://docs.google.com/spreadsheets/', demo: true }
    },
    generarCasosEspecialesPrueba: () => ({ plantillas: [], catalogo: [], medios: [], respaldo: 'https://docs.google.com/spreadsheets/', demo: true }),
    borrarDatosPrueba: () => {
      const antes = db.gastos.length, antesF = db.fondos.length
      db.gastos = db.gastos.filter(g => g[11] !== 'prueba')
      db.fondos = db.fondos.filter(f => f[0] !== 'f-prueba-presupuesto')
      db.fondosMeses = db.fondosMeses.filter(m => m[0] !== 'f-prueba-presupuesto')
      return { gastos: antes - db.gastos.length, vinculos: 0, compromisos: 0, catalogo: 0, medios: 0, fondos: antesF - db.fondos.length, respaldo: 'https://docs.google.com/spreadsheets/', demo: true }
    },
    repararIds: () => [],
    repararHojas: () => ({ url: 'https://docs.google.com/spreadsheets/', demo: true }),
    // En demostración no hay hojas de cajas que retirar: se informa el inventario vacío y no se cambia nada.
    retirarCajas: () => ({ simulacion: true, inventario: { cajas: 0, subcajas: 0, cajaGeneral: null, ajustesMensuales: 0, plantillasSubcaja: 0, fondos: db.fondos.length, acciones: [] }, demo: true }),
    auditarHojas: () => ({ hojas: ['GASTOS', 'CATALOGO', 'MEDIOS_PAGO', 'CONFIG', 'FONDOS_PRESUPUESTO', 'FONDOS_PRESUPUESTO_MESES', 'REVISIONES_PRESUPUESTO'].map(hoja => ({ hoja, estado: 'vigente', accion: 'Conservar' })), obsoletas: [], demo: true }),
    limpiarHojasObsoletas: () => ({ simulacion: true, plan: [], hojas: [], demo: true }),
    diagnose: () => ({ version: '1.0.0-demo', modo: 'demostración', filas: { GASTOS: db.gastos.length } }),
    backup: () => ({ nombre: 'Respaldo (demo)', url: 'https://docs.google.com/spreadsheets/', carpeta: carpeta.nombre, carpetaUrl: carpeta.url }),
    carpetaRespaldo: () => ({ ...carpeta }),
    saveCarpetaRespaldo: p => {
      const v = String(p.carpeta ?? '').trim()
      if (!v) { carpeta = { ...CARPETA_DEMO }; return { ...carpeta } }
      const id = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(v)?.[1] ?? v
      if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw fail('VALIDATION', 'Pega el enlace de una carpeta de Google Drive (…/folders/…) o su ID.')
      carpeta = { id, nombre: 'Mi carpeta de respaldos', url: `https://drive.google.com/drive/folders/${id}`, personalizada: true }
      return { ...carpeta }
    },
  }
  return async (action, payload) => {
    // Contador de llamadas (solo modo demo) para comprobar en pruebas que no se hacen lecturas de más.
    const w = globalThis as unknown as { __gdDemoCalls?: Record<string, number> }
    w.__gdDemoCalls = { ...w.__gdDemoCalls, [action]: (w.__gdDemoCalls?.[action] ?? 0) + 1 }
    await new Promise(r => setTimeout(r, latencyMs))
    const h = handlers[action]
    if (!h) throw fail('BAD_ACTION', 'Acción no válida.')
    return structuredClone(h(payload as Record<string, unknown>))
  }
}
