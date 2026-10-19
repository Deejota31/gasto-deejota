import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Control de contrato: el código de producción utiliza únicamente el esquema de fondos vigente.
 * El historial archivado de Sheets y la documentación histórica no son contratos de ejecución.
 */
const RAIZ = resolve(__dirname, '../..')
const OBSOLETO = /fuente|conciliaci|compat-migraci|migrarAFondosPresupuesto|revertirMigracionAFondos/i

function archivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'test-results', 'playwright-report'].includes(n)) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) archivos(p, acc)
    else if (/\.(ts|tsx|gs|html|css)$/.test(n) && !/\.test\.tsx?$/.test(n)) acc.push(p)
  }
  return acc
}

describe('contrato vigente: fondos y revisión del presupuesto', () => {
  it('no conserva terminología, rutas ni compatibilidad anteriores en producción', () => {
    const incorrectos: string[] = []
    for (const f of [...archivos(join(RAIZ, 'web/src')), ...archivos(join(RAIZ, 'apps-script'))]) {
      readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
        if (OBSOLETO.test(linea)) incorrectos.push(`${relative(RAIZ, f)}:${i + 1}: ${linea.trim().slice(0, 100)}`)
      })
    }
    expect(incorrectos).toEqual([])
  })

  it('el backend publica las hojas y acciones del modelo actual', () => {
    const gs = readFileSync(join(RAIZ, 'apps-script/Code.gs'), 'utf8')
    for (const n of ['FONDOS_PRESUPUESTO', 'FONDOS_PRESUPUESTO_MESES', 'REVISIONES_PRESUPUESTO', 'saveFondo', 'saveFondoMes', 'deleteFondo', 'reorderFondos', 'saveRevisionPresupuesto']) {
      expect(gs).toContain(n)
    }
  })
})
