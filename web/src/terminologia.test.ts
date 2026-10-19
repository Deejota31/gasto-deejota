import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Puerta de terminología (v1.26): “Fuentes de dinero” se llama ahora “Fondos del presupuesto” y “Conciliación de saldos”
 * dejó de existir. Ningún archivo de la app puede depender de los nombres anteriores, salvo el código de migración y de
 * compatibilidad, que debe estar marcado con `[compat-migración]` (una línea) o entre `<compat-migración>` y `</compat-migración>`.
 */
const RAIZ = resolve(__dirname, '../..')
const VIEJO = /fuente|conciliaci/i

function archivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'test-results', 'playwright-report'].includes(n)) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) archivos(p, acc)
    else if (/\.(ts|tsx|gs|html|css)$/.test(n) && !/\.test\.tsx?$/.test(n) && n !== 'v126.spec.ts') acc.push(p)
  }
  return acc
}

function infractores(): string[] {
  const out: string[] = []
  for (const f of [...archivos(join(RAIZ, 'web/src')), ...archivos(join(RAIZ, 'apps-script')), ...archivos(join(RAIZ, 'web/e2e'))]) {
    let dentro = false
    readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
      if (linea.includes('</compat-migración>')) { dentro = false; return }
      if (linea.includes('<compat-migración>')) { dentro = true; return }
      if (VIEJO.test(linea) && !dentro && !linea.includes('[compat-migración]')) out.push(`${relative(RAIZ, f)}:${i + 1}: ${linea.trim().slice(0, 100)}`)
    })
  }
  return out
}

describe('terminología: sin dependencias operativas de los nombres anteriores', () => {
  it('ningún archivo de la app, del backend ni de e2e usa «fuente» o «conciliación» fuera del código de migración', () => {
    expect(infractores()).toEqual([])
  })
  it('los marcadores de compatibilidad están balanceados', () => {
    for (const f of [join(RAIZ, 'apps-script/Code.gs'), join(RAIZ, 'web/src/lib/api.ts'), join(RAIZ, 'web/src/components/MigracionBanner.tsx')]) {
      const t = readFileSync(f, 'utf8')
      expect((t.match(/<compat-migración>/g) ?? []).length - (t.match(/<\/compat-migración>/g) ?? []).length).toBe(0)
    }
  })
  it('las acciones y hojas actuales usan los nombres nuevos', () => {
    const gs = readFileSync(join(RAIZ, 'apps-script/Code.gs'), 'utf8')
    for (const n of ['FONDOS_PRESUPUESTO', 'FONDOS_PRESUPUESTO_MESES', 'REVISIONES_PRESUPUESTO', 'saveFondo', 'saveFondoMes', 'deleteFondo', 'reorderFondos', 'saveRevisionPresupuesto']) expect(gs).toContain(n)
  })
})
