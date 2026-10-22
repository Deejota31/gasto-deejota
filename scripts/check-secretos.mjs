// Busca secretos evidentes en los archivos versionados. No sustituye a una herramienta dedicada,
// pero detiene los descuidos típicos antes de que lleguen a main. Uso: node scripts/check-secretos.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const PATRONES = [
  ['URL de despliegue de Apps Script', /script\.google\.com\/macros\/s\/AKfy[\w-]{20,}/],
  ['Clave de API de Google', /AIza[0-9A-Za-z_-]{35}/],
  ['Clave privada', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['Token de GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Token de Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Token asignado en código', /\b(?:API_TOKEN|ATAJO_TOKEN|ADMIN_TOKEN)\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/],
]
const BINARIOS = /\.(png|jpg|jpeg|gif|ico|webp|woff2?|ttf|lock)$|package-lock\.json$/i

const archivos = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(f => f && !BINARIOS.test(f))
const hallazgos = []
for (const f of archivos) {
  let texto
  try { texto = readFileSync(f, 'utf8') } catch { continue }
  texto.split('\n').forEach((linea, i) => {
    for (const [nombre, re] of PATRONES) if (re.test(linea)) hallazgos.push(`${f}:${i + 1}  ${nombre}`)
  })
}
if (hallazgos.length) {
  console.error('Posibles secretos en el repositorio:\n' + hallazgos.join('\n'))
  process.exit(1)
}
console.log(`Sin secretos evidentes en ${archivos.length} archivos.`)
