// Piezas compartidas de «Nuevo fondo» y de las plantillas: medios (sin «Todos excepto» al crear) y editor de cobertura.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogoItem, Ruta } from '../lib/types'
import { validarRegla } from '../lib/presupuesto'
import { EditorCobertura, MediosCampos, mismaRuta, opcionesModoMedios, rutaTxt } from './fondoCampos'

afterEach(cleanup)

const catalogo: CatalogoItem[] = [
  { ambito: 'Personal', categoria: '', subcategoria: '', activo: true }, { ambito: 'Personal', categoria: 'Alimentación', subcategoria: '', activo: true },
  { ambito: 'Personal', categoria: 'Alimentación', subcategoria: 'Almuerzo', activo: true }, { ambito: 'Personal', categoria: 'Otros', subcategoria: '', activo: true },
  { ambito: 'Familia', categoria: '', subcategoria: '', activo: true }, { ambito: 'Familia', categoria: 'Servicios', subcategoria: '', activo: true },
] as CatalogoItem[]

describe('medios del fondo', () => {
  it('«Todos excepto» solo existe como opción heredada cuando el fondo ya lo usa', () => {
    expect(opcionesModoMedios(false).map(o => o.value)).toEqual(['todos', 'solo'])
    expect(opcionesModoMedios(true).map(o => o.value)).toEqual(['todos', 'excepto', 'solo'])
  })
  it('«Solo seleccionados» muestra el multiselect y los chips son quitables', () => {
    const onLista = vi.fn()
    render(<MediosCampos medios={['Yape', 'Plin', 'Efectivo']} modo="solo" onModo={() => {}} lista={['Yape', 'Plin']} onLista={onLista} />)
    expect(screen.getByRole('combobox', { name: 'Medios permitidos' })).toBeTruthy()
    const chips = screen.getByTestId('fondo-medios-elegidos')
    fireEvent.click(within(chips).getByRole('button', { name: 'Quitar Yape' }))
    expect(onLista).toHaveBeenCalledWith(['Plin'])
  })
  it('con «Todos los medios» no hay lista; «solo» vacío no valida', () => {
    render(<MediosCampos medios={['Yape']} modo="todos" onModo={() => {}} lista={[]} onLista={() => {}} />)
    expect(screen.queryByRole('combobox', { name: 'Medios permitidos' })).toBeNull()
    expect(validarRegla({ desde: '', medios: 'solo', listaMedios: [], cobertura: 'todos', rutas: [], restringeMedio: false })).toMatch(/medio/i)
  })
})

describe('cobertura', () => {
  it('compara rutas sin distinguir mayúsculas y las describe de forma legible', () => {
    const a: Ruta = { ambito: 'Personal', categoria: 'Alimentación', subcategoria: '' }
    expect(mismaRuta(a, { ...a, categoria: 'alimentación' })).toBe(true)
    expect(rutaTxt({ ambito: '', categoria: 'Servicios', subcategoria: '' })).toBe('Todos los ámbitos › Servicios')
  })
  it('personalizada: «Agregar ruta» queda desactivado sin ámbito/categoría y las rutas se quitan con su chip', () => {
    const onRutas = vi.fn()
    const rutas: Ruta[] = [{ ambito: 'Personal', categoria: 'Alimentación', subcategoria: '' }]
    render(<EditorCobertura tipo="personalizada" rutas={rutas} onRutas={onRutas} catalogo={catalogo} />)
    fireEvent.click(within(screen.getByTestId('rutas-elegidas')).getByRole('button', { name: /Quitar/ }))
    expect(onRutas).toHaveBeenCalledWith([])
    // la ruta ya elegida (mismo ámbito y categoría) no se puede duplicar
    expect((screen.getByRole('button', { name: /Agregar ruta/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
