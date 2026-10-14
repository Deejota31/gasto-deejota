/** Preferencias visuales locales (solo de este navegador). Nunca guardan datos financieros; todo en try/catch por si el almacenamiento está bloqueado. */
export function leerPref<T extends string>(clave: string, permitidos: readonly T[], porDefecto: T): T {
  try {
    const v = localStorage.getItem(clave)
    return v && (permitidos as readonly string[]).includes(v) ? (v as T) : porDefecto
  } catch { return porDefecto }
}
export function guardarPref(clave: string, valor: string): void {
  try { localStorage.setItem(clave, valor) } catch { /* sin almacenamiento: la preferencia vale solo para esta sesión */ }
}
