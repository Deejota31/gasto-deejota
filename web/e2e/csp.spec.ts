import { expect, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

// S-01 — La política de netlify.toml, aplicada como OBLIGATORIA, no debe bloquear nada de la app real:
// se sirve la compilación (dist) con las cabeceras del archivo y se recorren todas las pestañas.

const RAIZ = join(process.cwd(), '..') // playwright se ejecuta desde web/
const DIST = join(RAIZ, 'web', 'dist')
const TIPOS: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }

function cabecerasDeNetlify(): Record<string, string> {
  const toml = readFileSync(join(RAIZ, 'netlify.toml'), 'utf8')
  const bloque = toml.split('[headers.values]')[1] ?? ''
  const h: Record<string, string> = {}
  for (const m of bloque.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"((?:[^"\\]|\\.)*)"/gm)) h[m[1]] = m[2]
  return h
}

let server: Server
let base = ''
const cab = cabecerasDeNetlify()

test.beforeAll(async () => {
  const h = { ...cab }
  // La política del archivo se aplica aquí como obligatoria.
  h['Content-Security-Policy'] = h['Content-Security-Policy-Report-Only'] ?? h['Content-Security-Policy']
  delete h['Content-Security-Policy-Report-Only']
  server = createServer((req, res) => {
    const ruta = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '')
    let f = join(DIST, ruta)
    if (!existsSync(f) || !statSync(f).isFile()) f = join(DIST, 'index.html')
    res.writeHead(200, { ...h, 'Content-Type': TIPOS[extname(f)] ?? 'application/octet-stream' })
    res.end(readFileSync(f))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

test('netlify.toml define las cabeceras de seguridad esperadas', () => {
  expect(cab['X-Content-Type-Options']).toBe('nosniff')
  expect(cab['X-Frame-Options']).toBe('DENY')
  expect(cab['Referrer-Policy']).toBe('no-referrer')
  expect(cab['Permissions-Policy']).toContain('camera=()')
  expect(cab['Strict-Transport-Security']).toMatch(/max-age=\d{7,}/)
  const csp = cab['Content-Security-Policy'] ?? cab['Content-Security-Policy-Report-Only']
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).not.toContain("'unsafe-eval'")
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
})

test('con la CSP obligatoria la app funciona en todas las pestañas, con conexión real simulada y sin violaciones', async ({ page }) => {
  const violaciones: string[] = []
  const errores: string[] = []
  page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) violaciones.push(m.text()) })
  page.on('pageerror', e => errores.push(e.message))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e => ((window as unknown as { __csp: string[] }).__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI}`))
    sessionStorage.setItem('vistaDefecto', '1')
  })
  // Modo demo: recorre todas las pestañas.
  await page.setViewportSize({ width: 1366, height: 900 })
  for (const tab of ['dashboard', 'gastos', 'cajas', 'catalogo', 'salud', 'config']) {
    await page.goto(`${base}/?demo=60&fondos=3#${tab}`)
    await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible()
    await page.waitForTimeout(400)
  }
  // Conexión (simulada) con Apps Script: la petición debe poder salir hacia script.google.com.
  let llamadas = 0
  await page.route('https://script.google.com/**', r => { llamadas++; return r.fulfill({ status: 200, contentType: 'text/plain', body: JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Token inválido.' } }) }) })
  await page.addInitScript(() => localStorage.setItem('gd.connection', JSON.stringify({ url: 'https://script.google.com/macros/s/PRUEBA/exec', token: 'x'.repeat(24) })))
  await page.goto(`${base}/#dashboard`)
  await expect.poll(() => llamadas, { timeout: 8000 }).toBeGreaterThan(0)
  const reportadas = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
  expect(violaciones, violaciones.join('\n')).toEqual([])
  expect(reportadas).toEqual([])
  expect(errores).toEqual([])
})

test('la política sí bloquea lo que debe bloquear (scripts en línea y conexiones a otros dominios)', async ({ page }) => {
  await page.goto(`${base}/?demo=60`)
  const r = await page.evaluate(async () => {
    const out = { script: false, fetchAjeno: '' }
    const s = document.createElement('script'); s.textContent = 'window.__x = 1'; document.head.appendChild(s)
    out.script = (window as unknown as { __x?: number }).__x === 1
    try { await fetch('https://example.com/'); out.fetchAjeno = 'permitido' } catch { out.fetchAjeno = 'bloqueado' }
    return out
  })
  expect(r.script).toBe(false)
  expect(r.fetchAjeno).toBe('bloqueado')
})
