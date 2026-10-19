/**
 * Medios de pago de un fondo. Se guardan en la misma columna de siempre (Medio de pago de FONDOS_PRESUPUESTO) separados por "|":
 * "Sodexo" (valor antiguo, un solo medio) sigue siendo válido; "Sodexo|Plin" son dos; vacío o "Libre" = ninguno (fondo libre).
 * El importe del fondo NO se multiplica ni se divide por la cantidad de medios.
 */
export const SEP_MEDIOS = '|'

const nrm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

export function mediosDeFondo(medioPago: string | undefined | null): string[] {
  const vistos = new Set<string>()
  const out: string[] = []
  for (const parte of String(medioPago ?? '').split(SEP_MEDIOS)) {
    const m = parte.trim()
    const k = nrm(m)
    if (!m || k === 'libre' || vistos.has(k)) continue
    vistos.add(k)
    out.push(m)
  }
  return out
}

export function unirMedios(medios: string[]): string {
  return mediosDeFondo(medios.join(SEP_MEDIOS)).join(SEP_MEDIOS)
}

export const tieneMedio = (medioPago: string | undefined | null, medio: string): boolean => mediosDeFondo(medioPago).some(m => nrm(m) === nrm(medio))
