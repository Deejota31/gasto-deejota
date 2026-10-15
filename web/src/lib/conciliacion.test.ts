import { describe, expect, it } from 'vitest'
import {
  calcularSaldos, causaTxt, difTxt, estaDesactualizada, fechaEnTz, GRUPO_TOTAL_ID, gruposDeTrabajo, gruposVigentes, historialCsv, horaEnTz, localAIso,
  porcentajeDif, redondear2, signoDe, verificaciones, vigentePorGrupo, type GrupoFondos,
} from './conciliacion'
import { parseMonto } from '../components/conciliacion/piezas'
import type { AppData, Caja, ConcFila, Fuente, Gasto } from './types'

// Caso de la especificación (octubre de 2026). Los importes son ilustrativos: aquí se arman de forma que el motor existente
// produzca exactamente 437.50 (dinero general) y 45.51 (Sodexo).
const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '',
  medioPago: 'Yape', tipoGasto: 'Variable', ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web',
  comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const fu = (id: string, monto: number, over: Partial<Fuente> = {}): Fuente => ({
  id, nombre: id, monto, moneda: 'PEN', color: '#000000', icono: '', activo: true, orden: 1, recurrencia: 'mensual', mes: '', medioPago: '',
  creadoEn: '', actualizadoEn: '', ...over,
})
const caja = (id: string, presupuesto: number, filtroCampo: Caja['filtroCampo'] = 'Todos', filtroValor = '', orden = 1): Caja =>
  ({ id, nombre: id, presupuesto, filtroCampo, filtroValor, color: '#000000', orden })

const FUENTES = [fu('general', 3000, { orden: 1 }), fu('pareja', 200, { orden: 2 }), fu('sodexo', 280, { orden: 3, medioPago: 'Sodexo' }), fu('tesis', 1900, { orden: 4 })]
const GASTOS = [g({ monto: 4662.5 }), g({ monto: 234.49, medioPago: 'Sodexo', fecha: '2026-10-06' })]
const base = (over: Partial<AppData> = {}): AppData => ({
  gastos: GASTOS, catalogo: [], medios: [], cajas: [caja('general-caja', 9999)], presupuestos: [], fuentes: FUENTES, fuentesMeses: [],
  config: { moneda: 'PEN', zona_horaria: 'America/Lima' }, sheetUrl: '', version: '1', ...over,
})
const GRUPOS: GrupoFondos[] = [
  { id: 'gf-general', nombre: 'Dinero general', fuenteIds: ['general', 'pareja', 'tesis'] },
  { id: 'gf-sodexo', nombre: 'Sodexo', fuenteIds: ['sodexo'] },
]

describe('saldo presupuestario calculado (motor existente, corte por fecha)', () => {
  it('caso real: total 483.01 = general 437.50 + Sodexo 45.51; nada sin atribuir', () => {
    const s = calcularSaldos(base(), '2026-10', '2026-10-31', '2026-10-15', GRUPOS)
    expect(s.calculable).toBe(true)
    expect(s.total).toBe(483.01)
    expect(s.porGrupo['gf-general']).toBe(437.5)
    expect(s.porGrupo['gf-sodexo']).toBe(45.51)
    expect(s.sinAtribuir).toBe(0)
  })

  it('diferencias del caso: +29.88, +2.92 y total +32.80, sin inventar nada', () => {
    const d1 = redondear2(467.38 - 437.5), d2 = redondear2(48.43 - 45.51)
    expect([d1, d2, redondear2(d1 + d2)]).toEqual([29.88, 2.92, 32.8])
    expect(signoDe(d1)).toBe('positiva')
    expect(difTxt(d1, 'PEN')).toContain('+')
    expect(porcentajeDif(29.88, 437.5)).toBe(6.8)
  })

  it('la fecha de corte excluye los gastos posteriores; los anulados no cuentan', () => {
    const tarde = g({ monto: 100, fecha: '2026-10-20' })
    const anulado = g({ monto: 50, estado: 'Anulado' })
    const d = base({ gastos: [...GASTOS, tarde, anulado] })
    expect(calcularSaldos(d, '2026-10', '2026-10-15', '2026-10-31', GRUPOS).total).toBe(483.01)
    expect(calcularSaldos(d, '2026-10', '2026-10-31', '2026-10-31', GRUPOS).total).toBe(383.01)
  })

  it('las subcajas son reservas: no cambian el disponible ni se descuentan dos veces', () => {
    const sin = calcularSaldos(base(), '2026-10', '2026-10-31', '2026-10-31', GRUPOS)
    const con = calcularSaldos(base({ cajas: [caja('general-caja', 9999), caja('bebe', 700, 'Categoría', 'Bebé', 2)] }), '2026-10', '2026-10-31', '2026-10-31', GRUPOS)
    expect(con.total).toBe(sin.total)
    expect(con.reservado).toBe(700)
    expect(con.libreNoReservado).toBe(redondear2(483.01 - 700))   // reserva ≠ saldo físico: se informa aparte
  })

  it('sin fuentes ni presupuesto: información insuficiente (no se inventa un importe)', () => {
    const s = calcularSaldos(base({ fuentes: [], cajas: [caja('general-caja', 0)], gastos: [] }), '2026-10', '2026-10-31', '2026-10-31', gruposDeTrabajo([]))
    expect(s.calculable).toBe(false)
    expect(s.total).toBeNull()
    expect(s.motivo).toMatch(/fuentes/)
  })

  it('período sin gastos: el calculado es el presupuesto completo', () => {
    expect(calcularSaldos(base({ gastos: [] }), '2026-10', '2026-10-31', '2026-10-31', GRUPOS).total).toBe(5380)
  })

  it('un grupo sin fuentes aplicadas al período no tiene saldo (null), no cero', () => {
    const s = calcularSaldos(base(), '2026-10', '2026-10-31', '2026-10-31', [...GRUPOS, { id: 'gf-x', nombre: 'Vacío', fuenteIds: ['no-existe'] }])
    expect(s.porGrupo['gf-x']).toBeNull()
  })

  it('cambio de mes y de año: cada período usa su propio corte', () => {
    const d = base({ gastos: [...GASTOS, g({ monto: 10, fecha: '2026-11-02' }), g({ monto: 10, fecha: '2027-01-02' })] })
    expect(calcularSaldos(d, '2026-10', '2026-10-31', '2026-12-31', GRUPOS).total).toBe(483.01)
    expect(calcularSaldos(d, '2027-01', '2027-01-31', '2027-01-31', GRUPOS).fuentes.length).toBeGreaterThan(0)
  })
})

const fila = (o: Partial<ConcFila>): ConcFila => ({
  id: 'conc-1', tipo: 'verificacion', conciliacionId: o.id ?? 'conc-1', periodo: '2026-10', corte: '2026-10-15T23:00:00.000Z', grupoId: 'gf-general', grupo: 'Dinero general',
  moneda: 'PEN', calculado: 437.5, real: 467.38, diferencia: 29.88, estado: 'pendiente', causa: '', observacion: '', reemplazaA: '', referencia: '', creadoEn: '2026-10-15T23:01:00.000Z', ...o,
})

describe('historial inmutable: verificaciones, seguimiento y correcciones', () => {
  it('diferencia cero = conciliada; con diferencia queda pendiente hasta que alguien la documenta', () => {
    const vs = verificaciones([fila({ id: 'a' }), fila({ id: 'b', grupoId: 'gf-sodexo', diferencia: 0, real: 437.5, estado: 'conciliada', creadoEn: '2026-10-15T23:02:00.000Z' })])
    expect(vs.find(v => v.id === 'a')!.estadoEfectivo).toBe('pendiente')
    expect(vs.find(v => v.id === 'b')!.estadoEfectivo).toBe('conciliada')
  })

  it('el seguimiento más reciente manda sin reescribir la verificación', () => {
    const rows = [fila({ id: 'a' }),
      fila({ id: 's1', tipo: 'seguimiento', conciliacionId: 'a', estado: 'en_revision', calculado: null, real: null, diferencia: null, creadoEn: '2026-10-16T10:00:00.000Z' }),
      fila({ id: 's2', tipo: 'seguimiento', conciliacionId: 'a', estado: 'cerrada_justificada', causa: 'comision', observacion: 'Comisión bancaria', calculado: null, real: null, diferencia: null, creadoEn: '2026-10-17T10:00:00.000Z' })]
    const v = verificaciones(rows)[0]
    expect(v.estadoEfectivo).toBe('cerrada_justificada')
    expect(v.causaEfectiva).toBe('comision')
    expect(causaTxt(v.causaEfectiva)).toBe('Comisión')
    expect(v.diferencia).toBe(29.88)            // no se presenta como diferencia cero
    expect(v.calculado).toBe(437.5)
    expect(rows[0].estado).toBe('pendiente')    // la fila original no cambió
  })

  it('una corrección conserva la anterior (marcada como corregida) y la vigente es la nueva', () => {
    const rows = [fila({ id: 'a' }), fila({ id: 'b', reemplazaA: 'a', real: 460, diferencia: 22.5, creadoEn: '2026-10-15T23:30:00.000Z' })]
    const vs = verificaciones(rows)
    expect(vs).toHaveLength(2)
    expect(vs.find(v => v.id === 'a')!.corregidaPor).toBe('b')
    expect(vigentePorGrupo(vs, '2026-10', 'gf-general')!.id).toBe('b')
  })

  it('una nueva verificación del mismo grupo no sobrescribe: ambas quedan en el historial', () => {
    const vs = verificaciones([fila({ id: 'a' }), fila({ id: 'b', creadoEn: '2026-10-16T09:00:00.000Z' })])
    expect(vs.map(v => v.id)).toEqual(['b', 'a'])
    expect(vigentePorGrupo(vs, '2026-10', 'gf-general')!.id).toBe('b')
  })

  it('desactualizada solo cuando el cálculo de hoy (mismo período, corte y grupo) difiere de la foto', () => {
    const v = verificaciones([fila({ id: 'a' })])[0]
    expect(estaDesactualizada(v, 437.5)).toBe(false)
    expect(estaDesactualizada(v, 417.5)).toBe(true)
    expect(estaDesactualizada(v, null)).toBe(false)
    // integración con el motor: un gasto olvidado FECHADO antes del corte cambia el cálculo; uno posterior no
    const antes = base({ gastos: [...GASTOS, g({ monto: 20, fecha: '2026-10-10' })] })
    const despues = base({ gastos: [...GASTOS, g({ monto: 20, fecha: '2026-10-25' })] })
    const calc = (d: AppData) => calcularSaldos(d, '2026-10', '2026-10-15', '2026-10-31', GRUPOS).porGrupo['gf-general']
    expect(calc(base())).toBe(437.5)
    expect(calc(antes)).toBe(417.5)
    expect(calc(despues)).toBe(437.5)
  })

  it('grupos: gana la definición más reciente y los archivados desaparecen sin borrar el historial', () => {
    const rows = [
      fila({ id: 'g1', tipo: 'grupo', grupoId: 'gf-a', grupo: 'General', estado: 'activo', referencia: 'general', calculado: null, real: null, diferencia: null }),
      fila({ id: 'g2', tipo: 'grupo', grupoId: 'gf-a', grupo: 'General', estado: 'activo', referencia: 'general,pareja', calculado: null, real: null, diferencia: null }),
      fila({ id: 'g3', tipo: 'grupo', grupoId: 'gf-b', grupo: 'Sodexo', estado: 'activo', referencia: 'sodexo', calculado: null, real: null, diferencia: null }),
      fila({ id: 'g4', tipo: 'grupo', grupoId: 'gf-b', grupo: 'Sodexo', estado: 'archivado', referencia: 'sodexo', calculado: null, real: null, diferencia: null }),
    ]
    expect(gruposVigentes(rows)).toEqual([{ id: 'gf-a', nombre: 'General', fuenteIds: ['general', 'pareja'] }])
    expect(gruposDeTrabajo([])[0].id).toBe(GRUPO_TOTAL_ID)
    expect(gruposDeTrabajo(rows)).toHaveLength(1)
  })
})

describe('zona horaria y utilidades', () => {
  it('America/Lima (UTC−5): 15/10 18:00 local = 23:00Z; el día y la hora locales se recuperan sin errores de UTC', () => {
    expect(localAIso('2026-10-15', '18:00', 'America/Lima')).toBe('2026-10-15T23:00:00.000Z')
    expect(fechaEnTz('2026-10-16T02:00:00.000Z', 'America/Lima')).toBe('2026-10-15')
    expect(horaEnTz('2026-10-16T02:00:00.000Z', 'America/Lima')).toBe('21:00')
    expect(localAIso('2026-10-31', '23:59', 'America/Lima')).toBe('2026-11-01T04:59:00.000Z')
    expect(fechaEnTz(localAIso('2026-10-31', '23:59', 'America/Lima'), 'America/Lima')).toBe('2026-10-31')
  })
  it('parseMonto acepta coma o punto, máx. 2 decimales, sin negativos ni texto', () => {
    expect(parseMonto('467,38')).toBe(467.38)
    expect(parseMonto(' 48.43 ')).toBe(48.43)
    expect(parseMonto('0')).toBe(0)
    for (const mal of ['', '-5', '1.234', 'abc', '1,2,3', '12e3']) expect(parseMonto(mal)).toBeNull()
  })
  it('exportación: escapa comas y neutraliza fórmulas', () => {
    const csv = historialCsv(verificaciones([fila({ id: 'a', observacion: '=SUMA(1;2), "x"' })]), 'America/Lima', 'dd/MM/yyyy')
    expect(csv).toContain("'=SUMA(1;2)")
    expect(csv.split('\n')).toHaveLength(2)
  })
})
