// Todos los cálculos se hacen en céntimos enteros para evitar errores de coma flotante.
export const toCents = (amount: number): number => Math.round(amount * 100)
export const fromCents = (cents: number): number => cents / 100

/** Convierte un monto a céntimos de la moneda base. Devuelve null si falta el tipo de cambio. */
export function toBaseCents(amount: number, currency: string, base: string, rates: Record<string, number>): number | null {
  if (currency === base) return toCents(amount)
  const rate = rates[currency]
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null
  return Math.round(toCents(amount) * rate)
}

export function ratesFromConfig(config: Record<string, string>): Record<string, number> {
  const rates: Record<string, number> = {}
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith('tipo_cambio_') && value.trim() !== '') rates[key.slice(12)] = Number(value)
  }
  return rates
}

const formatters = new Map<string, Intl.NumberFormat>()
export function formatMoney(cents: number, currency: string): string {
  let f = formatters.get(currency)
  if (!f) {
    f = new Intl.NumberFormat('es-PE', { style: 'currency', currency, minimumFractionDigits: 2 })
    formatters.set(currency, f)
  }
  return f.format(fromCents(cents))
}

/** Porcentaje con 1 decimal; null cuando el divisor es 0 (presupuesto no configurado). */
export function percent(part: number, whole: number): number | null {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}
