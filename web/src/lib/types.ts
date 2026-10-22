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
  /**
   * Medios de la regla vigente separados por "|" (columna histórica «Medio de pago»). Solo se conserva para que una web anterior
   * siga leyendo algo coherente durante el despliegue; el motor usa `reglas`.
   */
  medioPago: string
  /** Reglas del fondo (medios, cobertura, restricción) versionadas por mes: ver lib/presupuesto.ts. Nunca vacío. */
  reglas: ReglaFondo[]
  creadoEn: string; actualizadoEn: string
}

/**
 * Reglas de un fondo (v1.28). Se versionan por mes (`desde`): editar las reglas en un mes crea una versión nueva desde ese mes y los
 * meses anteriores siguen usando la suya (el historial no cambia). `desde` vacío = desde siempre.
 *  - medios: 'todos' | 'excepto' (todos menos `listaMedios`) | 'solo' (solo `listaMedios`).
 *  - cobertura + rutas: qué gastos cubre. Ruta = ámbito › categoría › subcategoría; '' = cualquiera en ese nivel.
 *  - restringeMedio: los medios de `listaMedios` (modo 'solo') SOLO pueden usarse en gastos que cubra este fondo (o la unión de los
 *    fondos que restringen el mismo medio). Un gasto que lo viola no se guarda. Nada de esto se codifica por nombre.
 */
export type ModoMedios = 'todos' | 'excepto' | 'solo'
export type TipoCobertura = 'todos' | 'ambito' | 'categoria' | 'subcategoria' | 'personalizada'
export interface Ruta { ambito: string; categoria: string; subcategoria: string }
export interface ReglaFondo { desde: string; medios: ModoMedios; listaMedios: string[]; cobertura: TipoCobertura; rutas: Ruta[]; restringeMedio: boolean }
/** Asignación manual de un gasto a uno o varios fondos (importes en la moneda del gasto; suman exactamente el monto). */
export interface ParteManual { fondoId: string; monto: number }
/** Importe de un fondo para un mes: "solo" = únicamente ese mes; "desde" = ese mes en adelante. */
export interface FondoMes { fondoId: string; mes: string; monto: number; modo: 'solo' | 'desde' }

/**
 * Plantilla de fondo (v1.17): solo configuración reutilizable. Crearla, editarla o clonarla no crea dinero, fondos ni gastos.
 * `origenId` enlaza con el fondo original; `estados` dice qué pasó cada mes.
 */
export type TipoPlantillaFin = 'fondo'
export type EstadoPlantillaMes = 'pendiente' | 'aplicada' | 'omitida'
/** Configuración completa del fondo guardada en la plantilla (v1.29). Sin esto la plantilla funciona como en 1.28. */
export interface DatosPlantillaFin { tipo: TipoFondo | ''; vigencia: string; regla?: Omit<ReglaFondo, 'desde'> }
export interface PlantillaFin {
  id: string; tipo: TipoPlantillaFin; nombre: string; monto: number
  moneda: string; medios: string                                  // 'A|B' o vacío
  descripcion: string; color: string; icono: string
  recurrencia: Recurrencia; activo: boolean; orden: number
  origenId: string; estados: Record<string, { e: 'aplicada' | 'omitida'; m: number }>
  creadoEn: string; actualizadoEn: string
  datos?: DatosPlantillaFin | null
}

export interface AppData {
  gastos: Gasto[]
  catalogo: CatalogoItem[]
  medios: Medio[]
  fondos?: Fondo[]
  fondosMeses?: FondoMes[]
  plantillasFin?: PlantillaFin[]
  /** Asignaciones manuales de gastos a fondos: ID de gasto (minúsculas) → partes. Sin entrada = asignación automática. */
  asignaciones?: Record<string, ParteManual[]>
  config: Record<string, string>
  /** Orden personalizado de la tabla de Gastos: [id, orden]. Se guarda aparte para no recalcular el dashboard. */
  ordenGastos?: [string, number][]
  /** Vínculo gasto → plantilla (qué movimiento pagó qué compromiso): [gastoId, plantillaId]. */
  vinculos?: [string, string][]
  revisiones?: Revision[]
  /** Revisión del presupuesto: historial de solo agregar (la vigente de un período es la última). */
  revisionesPresupuesto?: RevisionPres[]
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
