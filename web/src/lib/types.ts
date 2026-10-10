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
  /** Estado tal como está en la hoja cuando no es "Activo" ni "Anulado" (escrito a mano): se informa en Salud de datos. */
  estadoHoja?: string
}

/** Decisión sobre una alerta de calidad. `firma` resume los datos revisados: si cambian, la alerta vuelve. */
export type EstadoRevision = 'legitimo' | 'pendiente' | 'duplicado'
export interface Revision { id: string; tipo: 'duplicado'; ids: string[]; estado: EstadoRevision; firma: string; creadoEn: string; actualizadoEn: string }

/** Plantilla de gasto frecuente: configuración reutilizable. No es un movimiento ni suma en nada. */
export interface Plantilla {
  id: string; ambito: string; categoria: string; subcategoria: string; descripcion: string; creadoEn: string; actualizadoEn: string
  /** Monto predeterminado (null = sin definir). */
  monto: number | null; moneda: string; medioPago: string
  /** Orden manual (arrastrar y soltar); null en plantillas antiguas sin orden. */
  orden: number | null
  /** Compromiso mensual (Luz, Internet…): lo decides tú. Solo estas cuentan en "Compromisos". */
  esCompromiso: boolean
}

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
  /** Orden personalizado de la tabla de Gastos: [id, orden]. Se guarda aparte para no recalcular el dashboard. */
  ordenGastos?: [string, number][]
  /** Vínculo gasto → plantilla (qué movimiento pagó qué compromiso): [gastoId, plantillaId]. */
  vinculos?: [string, string][]
  revisiones?: Revision[]
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
