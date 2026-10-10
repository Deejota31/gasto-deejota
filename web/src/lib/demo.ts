import { shiftMonth } from './dates'
import type { Transport } from './api'
import { CATALOGO_INICIAL } from './catalogo'
import { nextOrden, normName, ordenCanonico } from './orden'

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

// Cajas de ejemplo para ver la pestaña Cajas con muchas subcajas (?cajas=10).
const CAJAS_EXTRA: unknown[][] = [
  ['caja-salud', 'Caja Salud', 250, 'Categoría', 'Salud', '#16A085'], ['caja-transporte', 'Caja Transporte', 180, 'Categoría', 'Transporte', '#0EA5E9'],
  ['caja-streaming', 'Caja Streaming', 120, 'Categoría', 'Suscripciones', '#E25563'], ['caja-familia', 'Caja Familia', 900, 'Ámbito', 'Familia', '#F59E0B'],
  ['caja-linea', 'Caja Línea Celular', 40, 'Subcategoría', 'Servicios › Línea Celular', '#4F7BE8'], ['caja-delivery', 'Caja Delivery', 150, 'Subcategoría', 'Alimentación › Delivery', '#E8664F'],
  ['caja-sodexo', 'Caja Sodexo', 280, 'Medio de pago', 'Sodexo', '#84CC16'], ['caja-educacion', 'Caja Educación', 300, 'Categoría', 'Educación', '#8B7CF6'],
  ['caja-viajes', 'Caja Viajes', 0, 'Ámbito', 'Amigos', '#64748B'], ['caja-emergencia', 'Caja Emergencia', 200, 'Subcategoría', 'Otros › Imprevistos', '#C0362C'],
]

export function demoTransport(today: string, n = 400, latencyMs = 250, extraCajas = 0): Transport {
  const db = {
    // + un gasto con una subcategoría que ya no está en el catálogo (histórico): debe verse y filtrarse igual.
    gastos: [...generateGastoRows(n, today), [`${today.slice(0, 8)}01`, 12.5, 'PEN', 'Alimentación', 'Antojos', 'Gasto histórico', 'Yape', 'Variable',
      'Personal', false, 'Activo', 'demo', '', 'd0000000-0000-4000-8000-999999999999', `${today}T12:00:00.000Z`, `${today}T12:00:00.000Z`],
      ...demoSalud(today)] as unknown[][],
    catalogo: demoCatalogo(),
    medios: MEDIOS.map(m => [m, true]) as unknown[][],
    cajas: [
      ['general', 'Caja general', 7000, 'Todos', '', '#1e3a8a', 1],
      ['auto', 'Caja Auto', 600, 'Categoría', 'Auto', '#64748b', 2],
      ['bebe', 'Caja Bebé', 800, 'Categoría', 'Bebé', '#ec4899', 3],
      ['plan-nube', 'Caja Plan Nube', 150, 'Categoría', 'Plan Nube', '#8b5cf6', 4],
      ...CAJAS_EXTRA.slice(0, Math.max(0, extraCajas)).map((r, i) => [...r, i + 5, true, '']),
    ] as unknown[][],
    presupuestos: [] as unknown[][],
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
    config: { moneda: 'PEN', monedas: 'PEN,USD', tipo_cambio_USD: '3.75', zona_horaria: 'America/Lima', formato_fecha: 'dd/MM/yyyy', tema: 'claro', notificaciones: 'true' } as Record<string, string>,
  }
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
  const fail = (code: string, message: string) => Object.assign(new Error(message), { code })
  const handlers: Record<string, (p: Record<string, unknown>) => unknown> = {
    data: () => structuredClone({ ...db, vinculos: db.vinculos.filter(r => r[1]).map(r => [r[0], r[1]]), version: '1.0.0-demo', sheetUrl: 'https://docs.google.com/spreadsheets/' }),
    saveGasto: p => {
      const now = new Date().toISOString()
      const i = db.gastos.findIndex(r => r[13] === p.id)
      if (p.mode === 'create' && i >= 0) return db.gastos[i]
      if (p.mode === 'update' && i < 0) throw fail('NOT_FOUND', 'El gasto ya no existe en la hoja.')
      const prev = i >= 0 ? db.gastos[i] : null
      const row = [p.fecha, Math.round(Number(p.monto) * 100) / 100, p.moneda, p.categoria, p.subcategoria, p.descripcion, p.medioPago,
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
    saveCatalogo: p => {
      const k = (r: unknown[]) => r.slice(0, 3).map(x => normName(String(x ?? ''))).join('|')
      const key = k([p.ambito, p.categoria ?? '', p.subcategoria ?? ''])
      const prev = db.catalogo.find(r => k(r) === key)
      const icono = p.icono === undefined ? (prev?.[4] ?? '') : p.icono
      const color = p.color === undefined ? (prev?.[5] ?? '') : p.color
      if (prev) { prev[3] = p.activo !== false; prev[4] = icono; prev[5] = color; return [...prev] }
      const orden = nextOrden(db.catalogo.map(r => ({ ambito: String(r[0]), categoria: String(r[1]), orden: typeof r[6] === 'number' ? r[6] : undefined })),
        String(p.ambito), String(p.categoria ?? ''), String(p.subcategoria ?? ''))
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
      return { catalogo, gastos }
    },
    saveMedio: p => upsert(db.medios, 1, [p.nombre, p.activo !== false]),
    saveCaja: p => {
      const norm = (v: unknown) => normName(String(v ?? ''))
      if (p.filtroCampo !== 'Todos' && p.activo !== false && db.cajas.some(r => r[0] !== p.id && r[3] === p.filtroCampo && norm(r[4]) === norm(p.filtroValor) && r[7] !== false)) {
        throw fail('VALIDATION', `Otra caja ya usa ${p.filtroCampo} = ${p.filtroValor}. Cambia el alcance o desactívala primero.`)
      }
      return upsert(db.cajas, 1, [p.id, p.nombre, Number(p.presupuesto), p.filtroCampo, p.filtroValor ?? '', p.color, Number(p.orden), p.activo !== false, p.descripcion ?? ''])
    },
    deleteCaja: p => {
      const r = db.cajas.find(x => x[0] === p.id)
      if (r && r[3] === 'Todos') throw fail('VALIDATION', 'La caja general no se puede eliminar.')
      db.cajas = db.cajas.filter(x => x[0] !== p.id)
      return { id: p.id, eliminada: !!r }
    },
    reorderCajas: p => {
      const ids = p.ids as string[]
      db.cajas.forEach(r => { r[6] = r[3] === 'Todos' ? 1 : ids.indexOf(String(r[0])) + 2 || ids.length + 2 })
      return { ok: true }
    },
    savePresupuesto: p => upsert(db.presupuestos, 2, [p.periodo, p.cajaId, Number(p.monto)]),
    saveConfig: p => { db.config[String(p.clave)] = String(p.valor); return [p.clave, p.valor] },
    plantillas: () => [...db.plantillas].sort((a, b) => Number(a[10]) - Number(b[10])),
    savePlantilla: p => {
      const n = (v: unknown) => normName(String(v ?? ''))
      const k = (r: unknown[]) => [n(r[1]), n(r[2]), n(r[3]), n(r[4]), r[7] === '' ? '' : Math.round(Number(r[7]) * 100), n(r[8] || 'PEN'), n(r[9])].join('|')
      const now = new Date().toISOString()
      const monto = p.monto === '' || p.monto === null || p.monto === undefined ? '' : Math.round(Number(p.monto) * 100) / 100
      if (monto !== '' && !(Number(monto) >= 0)) throw fail('VALIDATION', 'Monto inválido.')
      const prevRow = db.plantillas.find(r => r[0] === p.id)
      const row = [p.id, p.ambito, p.categoria, p.subcategoria, p.descripcion, now, now, monto, p.moneda || 'PEN', p.medioPago ?? '', 0,
        p.esCompromiso === undefined ? (prevRow?.[11] ?? false) : p.esCompromiso === true]
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
      const now = new Date().toISOString()
      const nuevas: unknown[][] = []
      // Como el backend real: un ID ya existente no se duplica ni se modifica; se devuelve lo guardado.
      const filas = lista.map(g => db.gastos.find(r => r[13] === g.id) ?? (() => {
        const f = [g.fecha, Math.round(Number(g.monto) * 100) / 100, g.moneda, g.categoria, g.subcategoria, g.descripcion, g.medioPago,
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
    reorderGastos: p => {
      ;(p.ids as string[]).forEach((id, i) => {
        const r = db.ordenGastos.find(x => x[0] === id)
        if (r) r[1] = i + 1; else db.ordenGastos.push([id, i + 1])
      })
      return { ok: true }
    },
    diagnose: () => ({ version: '1.0.0-demo', modo: 'demostración', filas: { GASTOS: db.gastos.length } }),
    backup: () => ({ nombre: 'Respaldo (demo)', url: 'https://docs.google.com/spreadsheets/' }),
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
