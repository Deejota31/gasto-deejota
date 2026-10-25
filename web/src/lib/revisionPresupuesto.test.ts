import { describe, expect, it } from 'vitest'
import { estadoDe, historial, revisarPeriodo, vigente } from './revisionPresupuesto'
import type { AppData, Caja, Fondo, Gasto, RevisionPres } from './types'

const g = (over: Partial<Gasto>): Gasto => ({
  fecha: '2026-10-05', monto: 10, moneda: 'PEN', categoria: 'Alimentación', subcategoria: 'Almuerzo', descripcion: '', medioPago: 'Yape', tipoGasto: 'Variable',
  ambito: 'Personal', esRecurrente: false, estado: 'Activo', origen: 'web', comprobanteUrl: '', id: crypto.randomUUID(), creadoEn: '', actualizadoEn: '', ...over,
})
const fondo = (id: string, monto: number, over: Partial<Fondo> = {}): Fondo => ({
  id, nombre: id, monto, moneda: 'PEN', color: '#000', icono: '', activo: true, orden: 1, recurrencia: 'mensual', mes: '', medioPago: '', tipo: 'mensual', creadoEn: '', actualizadoEn: '', ...over,
})
const caja = (id: string, presupuesto: number, filtroCampo: Caja['filtroCampo'] = 'Todos', filtroValor = ''): Caja => ({ id, nombre: id, presupuesto, filtroCampo, filtroValor, color: '#000', orden: 1 })
const rev = (id: string, periodo: string, estado: RevisionPres['estado'], creadoEn: string, extra: Partial<RevisionPres> = {}): RevisionPres => ({ id, periodo, estado, pendientes: '', observacion: '', creadoEn, ...extra })
const datos = (over: Partial<AppData> = {}): AppData => ({
  gastos: [], catalogo: [], medios: [], cajas: [caja('general', 0)], presupuestos: [], config: { moneda: 'PEN' }, sheetUrl: '', version: '1.26.0',
  fondos: [fondo('general', 3500)], fondosMeses: [], ...over,
})

describe('revisión del presupuesto: estado vigente', () => {
  const rs = [rev('a', '2026-10', 'completo', '2026-10-05T10:00:00Z'), rev('b', '2026-10', 'con_gastos_anteriores', '2026-10-06T10:00:00Z', { pendientes: 'Almuerzos' }), rev('c', '2026-09', 'revisado_con_observaciones', '2026-09-30T10:00:00Z')]
  it('la vigente de un período es la última; sin registros es «pendiente»', () => {
    expect(vigente(rs, '2026-10')?.id).toBe('b')
    expect(estadoDe(rs, '2026-10')).toBe('con_gastos_anteriores')
    expect(estadoDe(rs, '2026-09')).toBe('revisado_con_observaciones')
    expect(estadoDe(rs, '2026-08')).toBe('pendiente')
    expect(estadoDe(undefined, '2026-08')).toBe('pendiente')
  })
  it('el historial conserva todo, de lo más nuevo a lo más viejo, y no se mezcla entre períodos', () => {
    expect(historial(rs, '2026-10').map(x => x.id)).toEqual(['b', 'a'])
    expect(historial(rs, '2026-09').map(x => x.id)).toEqual(['c'])
  })
})

describe('revisión del presupuesto: chequeos del período (solo datos del presupuesto)', () => {
  it('período coherente: sin observaciones', () => {
    const gastos = Array.from({ length: 10 }, (_, i) => g({ fecha: `2026-10-${String(i + 1).padStart(2, '0')}` }))
    const r = revisarPeriodo(datos({ gastos }), '2026-10', '2026-10-10')
    expect(r.chequeos.map(c => c.id)).toEqual(['todo-en-orden'])
    expect(r.alertas).toBe(0); expect(r.avisos).toBe(0); expect(r.movimientos).toBe(10)
    expect(r.enCurso).toBe(true)
  })
  it('sin fondos activos ni presupuesto: alerta', () => {
    const r = revisarPeriodo(datos({ fondos: [fondo('x', 100, { activo: false })], cajas: [caja('general', 0)] }), '2026-10', '2026-10-10')
    expect(r.chequeos.some(c => c.id === 'sin-presupuesto' && c.severidad === 'alerta')).toBe(true)
  })
  it('un extra de otro mes no suma en el período revisado', () => {
    const d = datos({ fondos: [fondo('extra', 1000, { recurrencia: 'unica', mes: '2026-11', tipo: 'extra' })], cajas: [caja('general', 0)] })
    expect(revisarPeriodo(d, '2026-10', '2026-10-10').chequeos.some(c => c.id === 'sin-presupuesto')).toBe(true)
    expect(revisarPeriodo(d, '2026-11', '2026-11-10').chequeos.some(c => c.id === 'sin-presupuesto')).toBe(false)
  })
  it('días sin movimientos: solo informativo, solo fechas transcurridas (sin hoy ni futuras) y sin alertas', () => {
    const r = revisarPeriodo(datos({ gastos: [g({ fecha: '2026-10-02' })] }), '2026-10', '2026-10-10')
    expect(r.chequeos.some(c => c.id === 'dias-vacios')).toBe(false)               // ya no es una alerta
    expect(r.diasSinMovimientos).toContain('2026-10-01'); expect(r.diasSinMovimientos).not.toContain('2026-10-02')
    expect(r.diasSinMovimientos.every(d => d <= '2026-10-09')).toBe(true)          // hoy (10) todavía no cuenta
    expect(r.diasTranscurridos).toBe(9)
    expect(r.alertas + r.avisos).toBe(0)                                             // un día vacío no es una irregularidad
    // período futuro: ninguna fecha pendiente; período cerrado: todos sus días
    expect(revisarPeriodo(datos({}), '2026-12', '2026-10-10')).toMatchObject({ diasSinMovimientos: [], diasTranscurridos: 0 })
    expect(revisarPeriodo(datos({ gastos: [g({ fecha: '2026-10-02' })] }), '2026-10', '2026-11-05').diasTranscurridos).toBe(31)
  })
  it('gasto por encima del presupuesto: aviso; un gasto anulado no cuenta como movimiento', () => {
    const d = datos({ fondos: [fondo('general', 100)], gastos: [g({ monto: 150 }), g({ monto: 999, estado: 'Anulado', fecha: '2026-10-06' })] })
    const r = revisarPeriodo(d, '2026-10', '2026-10-31')
    expect(r.chequeos.some(c => c.id === 'excedido')).toBe(true)
    expect(r.movimientos).toBe(1)
    // el mismo exceso explicado por un solo fondo es UNA alerta con el importe y el detalle por fondo (no dos bloques)
    const ex = r.chequeos.find(c => c.id === 'excedido')!
    expect(r.chequeos.some(c => c.id === 'sobregiro')).toBe(false)
    expect(ex.importe).toBe(5000); expect(ex.items).toEqual([{ nombre: 'general', importe: 5000 }])
  })
  it('revisar no modifica los datos de entrada', () => {
    const d = datos({ gastos: [g({})] }); const antes = JSON.stringify(d)
    revisarPeriodo(d, '2026-10', '2026-10-10')
    expect(JSON.stringify(d)).toBe(antes)
  })
})
