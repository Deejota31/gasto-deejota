import type { CajasResumen } from './engine'

/**
 * Presentación del Presupuesto consolidado (Dashboard). No calcula dinero nuevo: solo decide qué estado mostrar
 * y cómo repartir el ancho de la barra a partir de `aggregate().cajas`. Las fórmulas siguen viviendo en `engine.ts`.
 */

export type TonoEstado = 'ok' | 'atencion' | 'alerta' | 'neutro'

export interface EstadoPresupuesto {
  tono: TonoEstado
  etiqueta: string
  /** Céntimos por encima del presupuesto (0 si no se excede). */
  exceso: number
}

/** Estado financiero consolidado: texto + tono (el color nunca va solo). */
export function estadoPresupuesto(c: CajasResumen, money: (cents: number) => string): EstadoPresupuesto {
  if (c.presupuesto <= 0 || c.pct === null) return { tono: 'neutro', etiqueta: 'Sin presupuesto definido', exceso: 0 }
  if (c.disponible < 0) return { tono: 'alerta', etiqueta: `Presupuesto excedido en ${money(-c.disponible)}`, exceso: -c.disponible }
  if (c.pct >= 100) return { tono: 'atencion', etiqueta: 'Presupuesto agotado', exceso: 0 }
  if (c.pct >= 70) return { tono: 'atencion', etiqueta: `Cerca del límite · ${c.pct}% consumido`, exceso: 0 }
  return { tono: 'ok', etiqueta: 'Dentro del presupuesto', exceso: 0 }
}

export type ClaveSegmento = 'fuera' | 'cajas' | 'reservas' | 'libre'

export interface Segmento {
  clave: ClaveSegmento
  nombre: string
  /** Importe en céntimos, el mismo que muestra el motor (sin ajustes). */
  valor: number
  /** Parte del presupuesto consolidado, en % con un decimal (null sin presupuesto). */
  pctPresupuesto: number | null
  /** Ancho dentro de la barra, 0–100. Nunca desborda aunque el gasto supere el presupuesto. */
  ancho: number
}

export interface BarraPresupuesto {
  segmentos: Segmento[]
  /** Los segmentos suman más que el presupuesto (consumo > 100 % o saldo libre negativo). */
  excedido: boolean
  /** Posición del límite del presupuesto en % del ancho; solo existe cuando hay exceso. */
  limite: number | null
}

/**
 * Reparto de la barra. En el caso normal gastado fuera + gastado en cajas + reservas sin usar + saldo libre = presupuesto
 * (identidad del motor), así que la barra se llena exactamente. Con saldo libre negativo el segmento libre no se dibuja
 * (no existe) y la suma supera al presupuesto: el ancho se calcula sobre esa suma y una marca indica dónde estaba el límite.
 */
export function barraPresupuesto(c: CajasResumen): BarraPresupuesto {
  const P = c.presupuesto
  const brutos: [ClaveSegmento, string, number][] = [
    ['fuera', 'Gastado fuera de reservas', c.gastadoLibre],
    ['cajas', 'Gastado en cajas', c.gastadoSubcajas],
    ['reservas', 'Reservas sin utilizar', c.reservasSinUsar],
    ['libre', 'Saldo libre', Math.max(0, c.saldoLibre)],
  ]
  const suma = brutos.reduce((s, [, , v]) => s + v, 0)
  const base = Math.max(P, suma)
  if (P <= 0 || base <= 0) return { segmentos: [], excedido: false, limite: null }
  const segmentos = brutos.map(([clave, nombre, valor]) => ({
    clave, nombre, valor,
    pctPresupuesto: Math.round((valor / P) * 1000) / 10,
    ancho: (valor / base) * 100,
  }))
  const excedido = suma > P
  return { segmentos, excedido, limite: excedido ? (P / base) * 100 : null }
}
