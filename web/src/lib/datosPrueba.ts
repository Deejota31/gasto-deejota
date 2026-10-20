import { shiftMonth } from './dates'

/** Límites de «Agregar datos de prueba». Deben coincidir con PRUEBA_MAX_* de apps-script/Code.gs. */
export const PRUEBA_MAX_REGISTROS = 500
export const PRUEBA_MAX_MESES = 24

export interface PruebaParams { cantidad: number; desde: string; hasta: string }

const RE_MES = /^(20\d\d)-(0[1-9]|1[0-2])$/

/** Meses AAAA-MM de [desde, hasta], ambos incluidos. */
export function mesesEntre(desde: string, hasta: string): string[] {
  const out: string[] = []
  for (let m = desde; m <= hasta && out.length <= PRUEBA_MAX_MESES + 1; m = shiftMonth(m, 1)) out.push(m)
  return out
}

/** Últimos 6 meses terminando en el mes de `hoy` (AAAA-MM-DD). */
export function periodoPorDefecto(hoy: string): { desde: string; hasta: string } {
  const hasta = hoy.slice(0, 7)
  return { desde: shiftMonth(hasta, -5), hasta }
}

export type ValidacionPrueba =
  | { ok: true; valor: PruebaParams; meses: number }
  | { ok: false; errores: { cantidad?: string; periodo?: string } }

/** Misma validación que el backend: la web la aplica antes de enviar para avisar sin esperar a Apps Script. */
export function validarPrueba(entrada: { cantidad: string | number; desde: string; hasta: string }): ValidacionPrueba {
  const errores: { cantidad?: string; periodo?: string } = {}
  const texto = String(entrada.cantidad).trim()
  const cantidad = /^\d+$/.test(texto) ? Number(texto) : NaN
  if (!(cantidad >= 1 && cantidad <= PRUEBA_MAX_REGISTROS)) errores.cantidad = `Escribe un número entero entre 1 y ${PRUEBA_MAX_REGISTROS}.`
  if (!RE_MES.test(entrada.desde) || !RE_MES.test(entrada.hasta)) errores.periodo = 'Elige el mes y el año de inicio y de fin.'
  else if (entrada.desde > entrada.hasta) errores.periodo = 'El mes inicial no puede ser posterior al mes final.'
  else if (mesesEntre(entrada.desde, entrada.hasta).length > PRUEBA_MAX_MESES) errores.periodo = `El rango puede abarcar como máximo ${PRUEBA_MAX_MESES} meses.`
  if (errores.cantidad || errores.periodo) return { ok: false, errores }
  return { ok: true, valor: { cantidad, desde: entrada.desde, hasta: entrada.hasta }, meses: mesesEntre(entrada.desde, entrada.hasta).length }
}
