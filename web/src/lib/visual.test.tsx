import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ICONOS, ICONS } from './iconos'
import { ambitoLook, cajaLook, categoriaLook, claveDeIcono, COLORS, fuenteLook, medioLook, PALETA, subcategoriaLook } from './visual'
import { COLORES_RAPIDOS } from '../components/Apariencia'
import { useApariencia } from '../components/Apariencia'
import type { Caja, Fuente } from './types'

const fu = (over: Partial<Fuente>): Pick<Fuente, 'nombre' | 'medioPago' | 'icono' | 'color'> => ({ nombre: 'X', medioPago: '', icono: '', color: '', ...over })
const cj = (over: Partial<Caja>): Pick<Caja, 'filtroCampo' | 'filtroValor' | 'color' | 'icono'> => ({ filtroCampo: 'Categoría', filtroValor: 'Auto', color: '#123456', icono: '', ...over })

describe('paleta e iconos (v1.10)', () => {
  it('64 colores únicos y válidos; incluye los predeterminados de siempre', () => {
    const todos = PALETA.flatMap(f => f.tonos)
    expect(PALETA).toHaveLength(16)
    expect(todos).toHaveLength(64)
    for (const c of todos) expect(c).toMatch(/^#[0-9A-F]{6}$/i)
    expect(new Set(todos.map(c => c.toLowerCase())).size).toBe(64)
    for (const c of COLORS) expect(todos.map(x => x.toLowerCase())).toContain(c.toLowerCase())
  })

  it('claves de iconos únicas, todas resolubles, y las anteriores se conservan', () => {
    const keys = ICONOS.map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.length).toBeGreaterThanOrEqual(240)
    for (const k of ['user', 'users', 'heart', 'utensils', 'car', 'fuel', 'plane', 'baby', 'cloud', 'wallet', 'tag', 'transfer', 'smartphone', 'ticket', 'banknote']) expect(ICONS[k]).toBeDefined()
    for (const i of ICONOS) expect(ICONS[i.key]).toBe(i.Icon)
  })

  it('claveDeIcono: cada icono por defecto de un medio de pago tiene clave y vuelve al mismo componente', () => {
    for (const m of ['Yape', 'Plin', 'Sodexo', 'Transferencia', 'Efectivo', 'Otros', 'Tarjeta de crédito']) {
      const { Icon } = medioLook(m)
      expect(ICONS[claveDeIcono(Icon)]).toBe(Icon)
    }
  })
})

describe('coherencia visual: un mismo medio / alcance se ve igual en toda la web', () => {
  it('fuente con medio de pago y sin icono elegido = exactamente el look del medio (aunque guarde otro color)', () => {
    for (const m of ['Yape', 'Plin', 'Sodexo', 'Transferencia', 'Efectivo']) {
      const l = fuenteLook(fu({ nombre: 'Lo que sea', medioPago: m, color: '#ABCDEF' }))
      expect(l).toEqual(medioLook(m))
    }
  })
  it('fuente con icono elegido usa su icono y su color; sin medio ni icono, uno según el nombre', () => {
    const l = fuenteLook(fu({ nombre: 'Sodexo', medioPago: 'Sodexo', icono: 'gift', color: '#C2569B' }))
    expect(l.Icon).toBe(ICONS.gift)
    expect(l.color).toBe('#C2569B')
    expect(fuenteLook(fu({ nombre: 'General', color: '#1E3A8A' })).Icon).toBe(ICONS.banknote)
    expect(fuenteLook(fu({ nombre: 'Algo raro', color: 'rojo' })).color).toBe('#1E3A8A') // color inválido → predeterminado
  })
  it('fuente libre sin icono propio = el mismo aspecto que General (el elegido en General si lo cambió)', () => {
    const general = fu({ nombre: 'General' })
    const ica = fu({ nombre: 'Viaje a Ica', color: '#B4693C' })        // el color guardado se ignora mientras sea automática
    expect(fuenteLook(ica, [general, ica])).toEqual(fuenteLook(general, [general, ica]))
    expect(fuenteLook(ica, [general, ica]).Icon).toBe(ICONS.banknote)
    expect(fuenteLook(fu({ nombre: 'Carpeta Tesis' }), [general]).Icon).toBe(ICONS.banknote)
    const generalElegida = fu({ nombre: 'General', icono: 'rocket', color: '#E5484D' })
    expect(fuenteLook(ica, [generalElegida, ica])).toEqual({ Icon: ICONS.rocket, color: '#E5484D' })
    // con medio de pago manda el medio; con icono propio, el propio
    expect(fuenteLook(fu({ nombre: 'Vales', medioPago: 'Yape' }), [generalElegida])).toEqual(medioLook('Yape'))
    expect(fuenteLook(fu({ nombre: 'Ica', icono: 'gift', color: '#C2569B' }), [generalElegida])).toEqual({ Icon: ICONS.gift, color: '#C2569B' })
    // sin General en la lista: aspecto base
    expect(fuenteLook(ica, [])).toEqual(fuenteLook(general, []))
  })
  it('caja automática: hereda el look de su alcance (medio, ámbito, categoría, subcategoría)', () => {
    expect(cajaLook(cj({ filtroCampo: 'Medio de pago', filtroValor: 'Sodexo' }))).toEqual(medioLook('Sodexo'))
    expect(cajaLook(cj({ filtroCampo: 'Ámbito', filtroValor: 'Familia' }))).toEqual(ambitoLook('Familia'))
    expect(cajaLook(cj({ filtroCampo: 'Categoría', filtroValor: 'Auto' }))).toEqual(categoriaLook('Auto'))
    const cat = [{ ambito: 'Personal', categoria: 'Viajes', subcategoria: '', activo: true, icono: 'tree-palm', color: '#0E8FA8' }]
    expect(cajaLook(cj({ filtroValor: 'Viajes' }), cat)).toEqual(categoriaLook('Viajes', cat))
    expect(cajaLook(cj({ filtroValor: 'Viajes' }), cat).Icon).toBe(ICONS['tree-palm'])
    expect(cajaLook(cj({ filtroCampo: 'Categoría', filtroValor: 'Viajes' })).Icon).toBe(ICONS.plane) // por defecto
    expect(cajaLook(cj({ filtroCampo: 'Subcategoría', filtroValor: 'Auto › Gasolina' })).color).toBe(categoriaLook('Auto').color) // sub = color de su categoría
    expect(cajaLook(cj({ filtroCampo: 'Todos', filtroValor: '', color: '#1E3A8A' })).Icon).toBe(ICONS.wallet)
  })
  it('caja con icono elegido: manda su icono y su color; el color guardado se ignora mientras sea automática', () => {
    const l = cajaLook(cj({ icono: 'rocket', color: '#E5484D' }))
    expect(l.Icon).toBe(ICONS.rocket)
    expect(l.color).toBe('#E5484D')
    expect(cajaLook(cj({ icono: 'no-existe', color: '#E5484D' }))).toEqual(categoriaLook('Auto')) // clave rota → vuelve al automático
    expect(cajaLook(cj({ color: '#E5484D' })).color).toBe(categoriaLook('Auto').color)
  })
})

describe('categorías y subcategorías compartidas entre ámbitos', () => {
  const fila = (ambito: string, categoria: string, subcategoria: string, icono = '', color = '') => ({ ambito, categoria, subcategoria, activo: true, icono, color })
  const cat = [
    fila('Personal', 'Auto', '', 'rocket', '#E5484D'), fila('Trabajo', 'Auto', ''), fila('Amigos', 'Auto', ''),
    fila('Personal', 'Auto', 'Gasolina', 'gift'), fila('Trabajo', 'Auto', 'Gasolina'),
  ]
  it('lo que editas en un ámbito se ve igual en los demás, aunque sus filas estén vacías', () => {
    for (const a of ['Personal', 'Trabajo', 'Amigos']) {
      const l = categoriaLook('Auto', cat, a)
      expect(l.Icon).toBe(ICONS.rocket)
      expect(l.color).toBe('#E5484D')
      expect(subcategoriaLook('Gasolina', 'Auto', cat, a).Icon).toBe(ICONS.gift)
      expect(subcategoriaLook('Gasolina', 'Auto', cat, a).color).toBe('#E5484D') // sub = color de su categoría
    }
  })
  it('sin nada guardado usa el predeterminado; una caja por categoría ve lo mismo que el catálogo', () => {
    expect(categoriaLook('Auto', [fila('Trabajo', 'Auto', '')]).Icon).toBe(ICONS.car)
    expect(cajaLook(cj({ filtroCampo: 'Categoría', filtroValor: 'Auto' }), cat)).toEqual(categoriaLook('Auto', cat, 'Trabajo'))
    expect(cajaLook(cj({ filtroCampo: 'Subcategoría', filtroValor: 'Auto › Gasolina' }), cat)).toEqual(subcategoriaLook('Gasolina', 'Auto', cat, 'Amigos'))
  })
})

describe('colores rápidos', () => {
  it('son 10, únicos, válidos y todos están en la paleta completa', () => {
    expect(COLORES_RAPIDOS).toHaveLength(10)
    expect(new Set(COLORES_RAPIDOS).size).toBe(10)
    const paleta = PALETA.flatMap(f => f.tonos).map(c => c.toLowerCase())
    for (const c of COLORES_RAPIDOS) { expect(c).toMatch(/^#[0-9A-F]{6}$/i); expect(paleta).toContain(c.toLowerCase()) }
  })
})

describe('useApariencia', () => {
  const auto = medioLook('Sodexo')
  it('automático por defecto: no guarda icono y sigue al automático cuando cambia', () => {
    const { result, rerender } = renderHook(({ a }) => useApariencia({ icono: '', color: '#111111' }, a), { initialProps: { a: auto } })
    expect(result.current.esAuto).toBe(true)
    expect(result.current.icono).toBe('')
    expect(result.current.look).toEqual(auto)
    rerender({ a: medioLook('Yape') })
    expect(result.current.look).toEqual(medioLook('Yape'))
  })
  it('elegir un icono conserva el color que se veía; elegir un color conserva el icono que se veía', () => {
    const a = renderHook(() => useApariencia({ icono: '', color: '#111111' }, auto))
    act(() => a.result.current.elegir({ icono: 'rocket' }))
    expect(a.result.current.icono).toBe('rocket')
    expect(a.result.current.color).toBe(auto.color)
    const b = renderHook(() => useApariencia({ icono: '', color: '#111111' }, auto))
    act(() => b.result.current.elegir({ color: '#E5484D' }))
    expect(b.result.current.color).toBe('#E5484D')
    expect(ICONS[b.result.current.icono]).toBe(auto.Icon)
    expect(b.result.current.esAuto).toBe(false)
  })
  it('restablecer vuelve al automático', () => {
    const { result } = renderHook(() => useApariencia({ icono: 'gift', color: '#C2569B' }, auto))
    expect(result.current.esAuto).toBe(false)
    act(() => result.current.restablecer())
    expect(result.current.esAuto).toBe(true)
    expect(result.current.icono).toBe('')
    expect(result.current.look).toEqual(auto)
  })
})
