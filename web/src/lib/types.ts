export type Estado = 'Activo' | 'Anulado'
export const TIPOS_GASTO = ['Fijo', 'Variable', 'Extraordinario'] as const
export type TipoGasto = (typeof TIPOS_GASTO)[number]

export interface Gasto {
  fecha: string // AAAA-MM-DD
  monto: number
  moneda: string
  categoria: string
  subcategoria: string
  descripcion: string
  medioPago: string
  tipoGasto: TipoGasto
  ambito: string
  esRecurrente: boolean
  estado: Estado
  origen: string
  comprobanteUrl: string
  id: string
  creadoEn: string
  actualizadoEn: string
  /** Clave única para la interfaz (igual al ID salvo si el ID está repetido en la hoja). */
  uid?: string
  /** ID escrito a mano que la hoja no puede usar para editar: repetido o con caracteres no válidos. */
  problemaId?: 'duplicado' | 'invalido'
}

/** Plantilla de gasto frecuente: solo clasificación + descripción. No es un movimiento ni suma en nada. */
export interface Plantilla { id: string; ambito: string; categoria: string; subcategoria: string; descripcion: string; creadoEn: string; actualizadoEn: string }

export interface CatalogoItem { ambito: string; categoria: string; subcategoria: string; activo: boolean; icono?: string; color?: string; orden?: number }
export interface Medio { nombre: string; activo: boolean }
export type FiltroCampo = 'Todos' | 'Ámbito' | 'Categoría' | 'Subcategoría' | 'Medio de pago'
export interface Caja {
  id: string
  nombre: string
  presupuesto: number
  filtroCampo: FiltroCampo
  filtroValor: string
  color: string
  orden: number
}
export interface Presupuesto { periodo: string; cajaId: string; monto: number }

export interface AppData {
  gastos: Gasto[]
  catalogo: CatalogoItem[]
  medios: Medio[]
  cajas: Caja[]
  presupuestos: Presupuesto[]
  config: Record<string, string>
  sheetUrl: string
  version: string
}

export type PeriodPreset = 'mes' | 'mes-anterior' | '3m' | '6m' | 'anio' | 'custom'

/** Filtros compartidos por Dashboard y Gastos. Listas vacías = sin filtro. */
export interface Filters {
  preset: PeriodPreset
  desde: string // AAAA-MM-DD, inclusive
  hasta: string // AAAA-MM-DD, inclusive
  ambitos: string[]
  categorias: string[]
  subcategorias: string[] // clave "Categoría › Subcategoría": "Otros" existe en varias categorías
  medios: string[]
  tipos: string[]
}
