import { z } from 'zod'

/**
 * Debe importarse ANTES que cualquier módulo que construya esquemas (primer import de main.tsx).
 * Zod compila sus validadores con `new Function` para ir más rápido; con la CSP de producción (sin 'unsafe-eval')
 * el navegador bloquea esa prueba y registra una violación. Sin JIT los validadores funcionan igual, solo sin esa optimización;
 * las respuestas de la API son pequeñas, así que el coste es despreciable.
 */
z.config({ jitless: true })
