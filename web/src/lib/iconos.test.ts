import { describe, expect, it } from 'vitest'
import { buscarIconos, ICONOS, iconoPorClave, sugerirIconos } from './iconos'
import { ambitoLook, categoriaLook, COLORS, ESTADOS, ICONS, subcategoriaLook } from './visual'

const CLAVES_ANTERIORES = ['user', 'briefcase', 'heart', 'users', 'party-popper', 'house', 'utensils', 'coffee', 'car', 'fuel', 'bus', 'plane', 'tv', 'film', 'music',
  'gamepad', 'shopping-bag', 'shopping-cart', 'shirt', 'gift', 'graduation-cap', 'book', 'baby', 'stethoscope', 'pill', 'dumbbell', 'paw-print', 'sofa', 'wrench',
  'zap', 'lightbulb', 'wifi', 'cloud', 'sparkles', 'building', 'hand-coins', 'tag', 'shapes']

describe('catálogo de iconos y colores', () => {
  it('conserva todas las claves guardadas por versiones anteriores; claves únicas y válidas para la hoja', () => {
    for (const k of CLAVES_ANTERIORES) expect(ICONS[k], k).toBeTruthy()
    const keys = ICONOS.map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k).toMatch(/^[a-z0-9-]{1,30}$/)              // mismo criterio que saveCatalogo_
    expect(ICONOS.length).toBeGreaterThan(150)
  })
  it('icono desconocido → fallback, nunca rompe', () => {
    expect(iconoPorClave('no-existe')).toBe(ICONS.tag)
    expect(iconoPorClave(undefined)).toBe(ICONS.tag)
    expect(ambitoLook('Ámbito nuevo', [{ ambito: 'Ámbito nuevo', categoria: '', subcategoria: '', activo: true, icono: 'icono-borrado' }]).Icon).toBe(ICONS.tag)
  })
  it('búsqueda sin tildes ni mayúsculas, por sinónimos', () => {
    expect(buscarIconos('GASOLINA').map(i => i.key)).toContain('fuel')
    expect(buscarIconos('bebe').map(i => i.key)).toContain('baby')
    expect(buscarIconos('zzzz')).toEqual([])
  })
  it('sugerencias contextuales por nombre y por su ámbito/categoría', () => {
    expect(sugerirIconos('Gasolina')[0].key).toBe('fuel')
    expect(sugerirIconos('Pañales').map(i => i.key)).toContain('baby')
    expect(sugerirIconos('Internet').map(i => i.key).slice(0, 2)).toContain('wifi')
    expect(sugerirIconos('Xyz', ['Mascotas']).map(i => i.key)).toContain('paw-print')
    expect(sugerirIconos('')).toEqual([])
  })
  it('la paleta de clasificación no usa los colores de estado (rojo/ámbar)', () => {
    for (const c of COLORS) expect([ESTADOS.alerta.fg, ESTADOS.atencion.fg, '#E25563', '#E0A030', '#D2463C']).not.toContain(c)
    expect(new Set(['Personal', 'Trabajo', 'Pareja', 'Familia', 'Amigos'].map(a => ambitoLook(a).color)).size).toBe(5)
  })
  it('lo guardado en el catálogo manda; la subcategoría hereda el color de su categoría', () => {
    const cat = [{ ambito: 'Personal', categoria: 'Auto', subcategoria: '', activo: true, icono: 'truck', color: '#123456' },
      { ambito: 'Personal', categoria: 'Auto', subcategoria: 'Gasolina', activo: true, icono: 'car' }]
    expect(categoriaLook('Auto', cat, 'Personal')).toEqual({ Icon: ICONS.truck, color: '#123456' })
    expect(subcategoriaLook('Gasolina', 'Auto', cat, 'Personal')).toEqual({ Icon: ICONS.car, color: '#123456' })
    expect(subcategoriaLook('Gas', 'Auto', [], 'Personal')).toEqual({ Icon: ICONS.fuel, color: categoriaLook('Auto').color })
    expect(subcategoriaLook('Qwerty', 'Auto').Icon).toBe(categoriaLook('Auto').Icon)
  })
})
