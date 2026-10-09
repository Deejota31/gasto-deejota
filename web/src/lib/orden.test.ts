import { describe, expect, it } from 'vitest'
import { isOtros, nextOrden, ordenCanonico, otrosAlFinal, sortCatalogo } from './orden'
import { catalogOptions, historicos } from '../components/shared'
import { CATALOGO_INICIAL } from './catalogo'
import type { CatalogoItem } from './types'

const it_ = (ambito: string, categoria: string, subcategoria: string, orden?: number, activo = true): CatalogoItem =>
  ({ ambito, categoria, subcategoria, activo, ...(orden !== undefined ? { orden } : {}) })

describe('regla "Otros" al final', () => {
  it('reconoce Otros sin importar mayúsculas ni espacios', () => {
    expect(['Otros', ' otros ', 'OTROS', 'otros  '].every(isOtros)).toBe(true)
    expect(isOtros('Otros gastos')).toBe(false)
  })

  it('mueve Otros al final sin alterar el resto y quita duplicados lógicos', () => {
    expect(otrosAlFinal(['Desayuno', 'Otros', 'Almuerzo', ' otros', 'Cena'])).toEqual(['Desayuno', 'Almuerzo', 'Cena', 'Otros'])
  })

  it('una subcategoría agregada después queda antes de Otros (ejemplo Merienda)', () => {
    const base = Object.values(CATALOGO_INICIAL.Personal)[0].map((s, i) => it_('Personal', 'Alimentación', s, 10101 + i))
    const conMerienda = [...base, it_('Personal', 'Alimentación', 'Merienda', nextOrden(base, 'Personal', 'Alimentación', 'Merienda'))]
    expect(sortCatalogo(conMerienda).map(c => c.subcategoria))
      .toEqual(['Desayuno', 'Almuerzo', 'Cena', 'Delivery', 'Snack / Antojos', 'Bebidas', 'Merienda', 'Otros'])
  })

  it('el orden no depende del orden físico de las filas', () => {
    const rows = [it_('Pareja', 'Salidas', 'Cine', 30602), it_('Personal', 'Otros', 'Otros', 11004), it_('Personal', 'Auto', 'Gas', 10202),
      it_('Personal', 'Alimentación', 'Cena', 10103), it_('Personal', 'Auto', 'Gasolina', 10201), it_('Pareja', 'Salidas', 'Paseos', 30601)]
    const sorted = sortCatalogo(rows.reverse())
    expect(sorted.map(c => `${c.ambito}/${c.categoria}/${c.subcategoria}`)).toEqual([
      'Personal/Alimentación/Cena', 'Personal/Auto/Gasolina', 'Personal/Auto/Gas', 'Personal/Otros/Otros', 'Pareja/Salidas/Paseos', 'Pareja/Salidas/Cine'])
  })

  it('respeta un orden manual (columna Orden) salvo para Otros, por grupo e independiente entre ámbitos', () => {
    const rows = [
      it_('Personal', 'Otros', 'Imprevistos', 10050), // categoría "Otros" con orden bajo: igual va al final del ámbito
      it_('Personal', 'Alimentación', 'Otros', 1), it_('Personal', 'Alimentación', 'Cena', 10103), it_('Personal', 'Alimentación', 'Desayuno', 10199),
      it_('Familia', 'Bebé', 'Otros', 40211), it_('Familia', 'Bebé', 'Leche', 40201),
    ]
    const s = sortCatalogo(rows)
    expect(s.map(c => `${c.categoria}/${c.subcategoria}`)).toEqual(['Alimentación/Cena', 'Alimentación/Desayuno', 'Alimentación/Otros', 'Otros/Imprevistos', 'Bebé/Leche', 'Bebé/Otros'])
  })

  it('filas sin Orden (hoja antigua) quedan después de las numeradas y antes de Otros', () => {
    const s = sortCatalogo([it_('Personal', 'Alimentación', 'Otros', 10107), it_('Personal', 'Alimentación', 'Vieja'), it_('Personal', 'Alimentación', 'Cena', 10103)])
    expect(s.map(c => c.subcategoria)).toEqual(['Cena', 'Vieja', 'Otros'])
  })

  it('el catálogo canónico ordenado deja Otros último en cada categoría y ámbito', () => {
    const orden = ordenCanonico(CATALOGO_INICIAL)
    const rows = Object.entries(CATALOGO_INICIAL).flatMap(([a, cats]) => Object.entries(cats).flatMap(([c, subs]) =>
      subs.map(s => it_(a, c, s, orden.get(`${a.toLowerCase()}|${c.toLowerCase()}|${s.toLowerCase()}`)))))
    const s = sortCatalogo([...rows].reverse())
    for (const [a, cats] of Object.entries(CATALOGO_INICIAL)) {
      const catsSorted = otrosAlFinal([...new Set(s.filter(r => r.ambito === a).map(r => r.categoria))])
      expect(catsSorted.at(-1)).toBe('Otros')
      for (const c of Object.keys(cats)) expect(s.filter(r => r.ambito === a && r.categoria === c).map(r => r.subcategoria).at(-1)).toBe('Otros')
    }
  })
})

describe('opciones de formularios y filtros', () => {
  const cat = sortCatalogo([
    it_('Personal', 'Alimentación', 'Cena', 10103), it_('Personal', 'Alimentación', 'Otros', 10107), it_('Personal', 'Otros', 'Otros', 11004),
    it_('Pareja', 'Salidas', 'Cine', 30602), it_('Pareja', 'Otros', 'Otros', 30704), it_('Pareja', 'Salidas', 'Otros', 30607),
    it_('Personal', 'Alimentación', 'Antojos', undefined, false),
  ])

  it('al mezclar varios ámbitos, la categoría Otros sigue al final', () => {
    expect(catalogOptions(cat, ['Personal', 'Pareja'], []).categorias).toEqual(['Alimentación', 'Salidas', 'Otros'])
  })

  it('subcategorías agrupadas por categoría con Otros al final de cada grupo', () => {
    expect(catalogOptions(cat, [], ['Alimentación', 'Salidas']).subcategorias.map(s => s.key))
      .toEqual(['Alimentación › Cena', 'Alimentación › Otros', 'Salidas › Cine', 'Salidas › Otros'])
  })

  it('las opciones desactivadas no se ofrecen para gastos nuevos', () => {
    expect(catalogOptions(cat, ['Personal'], ['Alimentación']).subcategorias.map(s => s.subcategoria)).toEqual(['Cena', 'Otros'])
  })

  it('los valores históricos de gastos se pueden filtrar (antes de Otros)', () => {
    const h = historicos(cat, [{ ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Antojos' }, { ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Cena' }])
    expect(h).toEqual([{ ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Antojos' }])
    expect(catalogOptions(cat, ['Personal'], ['Alimentación'], h).subcategorias.map(s => s.subcategoria)).toEqual(['Cena', 'Antojos', 'Otros'])
  })

  it('si se desactiva una categoría entera, sus gastos siguen apareciendo como históricos en el filtro', () => {
    const c2 = [...cat, { ambito: 'Pareja', categoria: 'Salidas', subcategoria: '', activo: false }]
    const h = historicos(c2, [{ ambito: 'Pareja', categoria: 'Salidas', subcategoria: 'Cine' }])
    expect(h).toHaveLength(1)
    expect(catalogOptions(c2, ['Pareja'], [], h).categorias).toContain('Salidas')
  })
})
