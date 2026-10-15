import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configurarExcepciones, descripcionDeSubcategoria, formatearDescripcion, MINUSCULAS_LISTA } from './texto'

describe('formato de descripciones (v1.19)', () => {
  afterEach(() => configurarExcepciones(''))
  it.each([
    ['arroz con pollo', 'Arroz con Pollo'],
    ['tallarines al horno con papa a la huancaina', 'Tallarines al Horno con papa a la Huancaina'],
    ['pago de internet', 'Pago de Internet'],
    ['seguro de mi papa', 'Seguro de mi Papa'],
    ['compra para mi hija', 'Compra para mi Hija'],
    ['mantenimiento del auto', 'Mantenimiento del Auto'],
    ['luz y agua de la casa', 'Luz y Agua de la Casa'],
    ['suscripcion de netflix', 'Suscripcion de Netflix'],
    ['servicio de internet para la familia', 'Servicio de Internet para la Familia'],
    ['gastos de viaje a ica', 'Gastos de Viaje a Ica'],
    ['ARROZ CON POLLO', 'Arroz con Pollo'],
    ['PAGO DE INTERNET PARA LA CASA', 'Pago de Internet para la Casa'],
    ['aRRoz CoN pOlLo', 'Arroz con Pollo'],
  ])('%s → %s', (entrada, esperado) => expect(formatearDescripcion(entrada)).toBe(esperado))

  it('palabras secundarias al inicio, en medio y al final', () => {
    expect(formatearDescripcion('de compras con el equipo')).toBe('De Compras con el Equipo')
    expect(formatearDescripcion('la cena del sábado')).toBe('La Cena del Sábado')
    expect(formatearDescripcion('regalo para ella')).toBe('Regalo para ella')
    expect(formatearDescripcion('nada')).toBe('Nada')
  })

  it('"papa" solo queda en minúscula dentro de la expresión; en otro contexto se capitaliza', () => {
    expect(formatearDescripcion('papa rellena')).toBe('Papa Rellena')
    expect(formatearDescripcion('compra de papa')).toBe('Compra de Papa')
    expect(formatearDescripcion('Papa a la Huancaina con arroz')).toBe('papa a la Huancaina con Arroz')
  })

  it('marcas y siglas con escritura propia', () => {
    expect(formatearDescripcion('pago de chatgpt plus')).toBe('Pago de ChatGPT Plus')
    expect(formatearDescripcion('FUNDA PARA IPHONE')).toBe('Funda para iPhone')
    expect(formatearDescripcion('youtube premium en usd')).toBe('YouTube Premium en USD')
    expect(formatearDescripcion('llamada api')).toBe('Llamada API')
  })

  it('excepciones propias del usuario (configurables), también de varias palabras', () => {
    configurarExcepciones('Pollo a la Brasa, ZETA')
    expect(formatearDescripcion('cena de pollo a la brasa')).toBe('Cena de Pollo a la Brasa')
    expect(formatearDescripcion('cuota zeta')).toBe('Cuota ZETA')
  })

  it('conserva tildes, ñ, números, signos y emojis; limpia espacios; vacío', () => {
    expect(formatearDescripcion('  bebé   y   mamá 🎉 ')).toBe('Bebé y Mamá 🎉')
    expect(formatearDescripcion('recarga 4g (30 días), plan "max"')).toBe('Recarga 4g (30 Días), Plan "Max"')
    expect(formatearDescripcion('menú del día: s/ 12.50')).toBe('Menú del Día: S/ 12.50')
    expect(formatearDescripcion('año nuevo')).toBe('Año Nuevo')
    expect(formatearDescripcion('')).toBe('')
    expect(formatearDescripcion('   ')).toBe('')
  })

  it('es idempotente en todos los casos de prueba', () => {
    for (const t of ['arroz con pollo', 'tallarines al horno con papa a la huancaina', 'ARROZ  CON   POLLO', 'pago de chatgpt', 'mi papa y mi mamá', 'de compras 4g (x)']) {
      const una = formatearDescripcion(t)
      expect(formatearDescripcion(una)).toBe(una)
    }
  })

  it('autocompletado: usa la subcategoría salvo Otros / Por Clasificar', () => {
    expect(descripcionDeSubcategoria('Moto Taxi')).toBe('Moto Taxi')
    expect(descripcionDeSubcategoria('Otros')).toBe('')
    expect(descripcionDeSubcategoria('Por Clasificar')).toBe('')
  })

  it('la lista de minúsculas del frontend y la del backend son idénticas', () => {
    const gs = readFileSync(resolve(__dirname, '../../../apps-script/Code.gs'), 'utf8')
    const m = gs.match(/var DESC_MINUSCULAS_ = (\[[^\]]*\]);/)!
    expect(JSON.parse(m[1].replace(/'/g, '"'))).toEqual(MINUSCULAS_LISTA)
  })
})
