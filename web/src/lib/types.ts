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
/**
 * Revisión del presupuesto (v1.26). Hoja de solo agregar: cada fila es un registro de revisión de un período; la vigente es la
 * última. No hay saldos reales ni importes inventados: `pendientes` es texto libre sobre gastos anteriores por registrar.
 */
export type EstadoRevisionPres = 'pendiente' | 'completo' | 'con_gastos_anteriores' | 'revisado_con_observaciones'
export interface RevisionPres { id: string; periodo: string; estado: EstadoRevisionPres; pendientes: string; observacion: string; creadoEn: string }
/** Qué falta migrar de la hoja a “Fondos del presupuesto” (lo calcula el backend). */
export interface MigracionEstado { pendiente: boolean; hojasViejas: string[]; plantillasPorConvertir: number; fondosSinTipo: number }

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
  /** Tipo de gasto y recurrencia con que se precargan los gastos creados desde esta plantilla. */
  tipoGasto: TipoGasto
  esRecurrente: boolean
}

export interface CatalogoItem { ambito: string; categoria: string; subcategoria: string; activo: boolean; icono?: string; color?: string; orden?: number }
/** icono/color vacíos = el predeterminado del medio. */
export interface Medio { nombre: string; activo: boolean; icono?: string; color?: string }
export type FiltroCampo = 'Todos' | 'Ámbito' | 'Categoría' | 'Subcategoría' | 'Medio de pago'
export interface Caja {
  id: string
  nombre: string
  presupuesto: number
  filtroCampo: FiltroCampo
  filtroValor: string
  color: string
  orden: number
  /** false = inactiva: no reserva dinero ni toma gastos (queda guardada para reactivarla). Sin valor = activa. */
  activo?: boolean
  descripcion?: string
  /** Icono elegido (clave de iconos.ts). Vacío = automático: el de su alcance (medio de pago, ámbito, categoría…). */
  icono?: string
}
export interface Presupuesto { periodo: string; cajaId: string; monto: number }

/**
 * Fondo del presupuesto (v1.8): de dónde sale el presupuesto del mes (General, Sodexo, Extra 1…). Es configuración
 * reutilizable; su aporte a cada mes lo dan `recurrencia` + `mes` + los importes de FONDOS_PRESUPUESTO_MESES.
 *  - mensual: aporta `monto` todos los meses desde `mes` (vacío = desde siempre).
 *  - unica: aporta `monto` solo en `mes` (un ingreso extraordinario no se arrastra a otros meses).
 * Inactiva = queda guardada pero no aporta presupuesto. Nunca toca gastos.
 */
export type Recurrencia = 'mensual' | 'unica'
/**
 * Tipo de fondo (independiente de la recurrencia): mensual = presupuesto habitual del mes; extra = presupuesto adicional de un período;
 * ahorro_asignado = dinero ya separado para un objetivo (p. ej. Carpeta Tésis, Viaje a Ica).
 */
export type TipoFondo = 'mensual' | 'extra' | 'ahorro_asignado'
export const TIPOS_FONDO: readonly TipoFondo[] = ['mensual', 'extra', 'ahorro_asignado']
export const TIPO_FONDO_TXT: Record<TipoFondo, string> = { mensual: 'Mensual', extra: 'Extra', ahorro_asignado: 'Ahorro asignado' }
export interface Fondo {
  id: string; nombre: string; monto: number; moneda: string; color: string; icono: string
  activo: boolean; orden: number; recurrencia: Recurrencia; mes: string
  tipo: TipoFondo
  /** Medio de pago asociado (Sodexo…): los gastos pagados con él se atribuyen a este fondo. Vacío = fondo libre. */
  medioPago: string
  creadoEn: string; actualizadoEn: string
}
/** Importe de un fondo para un mes: "solo" = únicamente ese mes; "desde" = ese mes en adelante. */
export interface FondoMes { fondoId: string; mes: string; monto: number; modo: 'solo' | 'desde' }

/**
 * Plantilla de fondo o de subcaja (v1.17): solo configuración reutilizable. Crearla, editarla o clonarla no crea dinero,
 * fondos, subcajas ni gastos. `origenId` enlaza con el fondo/subcaja original; `estados` dice qué pasó cada mes.
 */
export type TipoPlantillaFin = 'fondo' | 'subcaja'
export type EstadoPlantillaMes = 'pendiente' | 'aplicada' | 'omitida'
export interface PlantillaFin {
  id: string; tipo: TipoPlantillaFin; nombre: string; monto: number
  moneda: string; medios: string                                  // solo fondos ('A|B' o vacío)
  campo: string; valor: string                                     // solo cajas (alcance)
  descripcion: string; color: string; icono: string
  recurrencia: Recurrencia; activo: boolean; orden: number
  origenId: string; estados: Record<string, { e: 'aplicada' | 'omitida'; m: number }>
  creadoEn: string; actualizadoEn: string
}

export interface AppData {
  gastos: Gasto[]
  catalogo: CatalogoItem[]
  medios: Medio[]
  cajas: Caja[]
  presupuestos: Presupuesto[]
  /** Sin fondos (instalaciones anteriores) el presupuesto sigue saliendo de la caja general. */
  fondos?: Fondo[]
  fondosMeses?: FondoMes[]
  plantillasFin?: PlantillaFin[]
  config: Record<string, string>
  /** Orden personalizado de la tabla de Gastos: [id, orden]. Se guarda aparte para no recalcular el dashboard. */
  ordenGastos?: [string, number][]
  /** Vínculo gasto → plantilla (qué movimiento pagó qué compromiso): [gastoId, plantillaId]. */
  vinculos?: [string, string][]
  revisiones?: Revision[]
  /** Revisión del presupuesto: historial de solo agregar (la vigente de un período es la última). */
  revisionesPresupuesto?: RevisionPres[]
  /** Estado de la migración a Fondos del presupuesto (backend ≥ 1.26). `undefined` = backend anterior. */
  migracion?: MigracionEstado
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
