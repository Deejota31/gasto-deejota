import { describe, expect, it } from 'vitest'
import { descripcionDeSubcategoria, formatearDescripcion } from './texto'

describe('formato de descripciones', () => {
  it.each([
    ['almuerzo con mi pareja', 'Almuerzo con Mi Pareja'],
    ['pago de linea celular', 'Pago de Linea Celular'],
    ['compra de pañales y leche', 'Compra de Pañales y Leche'],
    ['taxi a la oficina', 'Taxi a la Oficina'],
    ['cuidado de la bebe', 'Cuidado de la Bebe'],
    ['regalo para mi mama', 'Regalo para Mi Mama'],
    ['cena con beatriz', 'Cena con Beatriz'],
    ['compra de ropa para la bebe', 'Compra de Ropa para la Bebe'],
  ])('%s → %s', (entrada, esperado) => expect(formatearDescripcion(entrada)).toBe(esperado))

  it('el artículo o la preposición al inicio va con mayúscula', () => {
    expect(formatearDescripcion('de compras con el equipo')).toBe('De Compras con el Equipo')
    expect(formatearDescripcion('la cena del sábado')).toBe('La Cena del Sábado')
  })

  it('respeta marcas y siglas aunque se escriban en minúscula', () => {
    expect(formatearDescripcion('pago de chatgpt plus')).toBe('Pago de ChatGPT Plus')
    expect(formatearDescripcion('hbo max y netflix por yape')).toBe('HBO Max y Netflix por Yape')
    expect(formatearDescripcion('funda para iphone')).toBe('Funda para iPhone')
    expect(formatearDescripcion('soat del auto en usd')).toBe('SOAT del Auto en USD')
    expect(formatearDescripcion('router wifi de youtube')).toBe('Router WiFi de YouTube')
  })

  it('conserva tildes, números, signos, emojis y siglas propias; limpia espacios', () => {
    expect(formatearDescripcion('  bebé   y   mamá 🎉 ')).toBe('Bebé y Mamá 🎉')
    expect(formatearDescripcion('recarga 4g (30 días), plan "max"')).toBe('Recarga 4g (30 Días), Plan "Max"')
    expect(formatearDescripcion('pago a la SUNAT')).toBe('Pago a la SUNAT')
    expect(formatearDescripcion('menú del día: s/ 12.50')).toBe('Menú del Día: S/ 12.50')
    expect(formatearDescripcion('')).toBe('')
  })

  it('es idempotente (aplicarla dos veces no cambia nada)', () => {
    const t = formatearDescripcion('compra de ropa para la bebe con chatgpt')
    expect(formatearDescripcion(t)).toBe(t)
  })

  it('autocompletado: usa la subcategoría salvo Otros / Por Clasificar', () => {
    expect(descripcionDeSubcategoria('Moto Taxi')).toBe('Moto Taxi')
    expect(descripcionDeSubcategoria('ChatGPT')).toBe('ChatGPT')
    expect(descripcionDeSubcategoria('Otros')).toBe('')
    expect(descripcionDeSubcategoria('Por Clasificar')).toBe('')
  })
})
