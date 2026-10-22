# Auditoría, corrección y validación — Gasto Deejota (2026-10-22)

Rama de trabajo: `fix/auditoria-20261022` (versión **1.27.0**). Sin despliegues, sin fusión a `main`, sin cambios en la hoja de producción.

## A. Resumen ejecutivo

- Se corrigieron los hallazgos de seguridad (S-01..S-05), se retiró código de migración vencido (O-01, O-02), se añadió CI, cabeceras/CSP, contratos demo↔backend, pruebas de integridad ante fallos de red y regresión financiera de frontera de meses.
- Reglas financieras, cajas, contratos de API y esquemas de hojas **no cambiaron**. El único cambio de contrato es aditivo: `adminToken` opcional en el cuerpo del POST.
- Lo que **no** se pudo verificar desde aquí: web publicada, Apps Script desplegado y hoja real (ver estados finales). No se afirma ausencia absoluta de errores.

## B. Matriz de trazabilidad

| ID | Problema | Archivo | Corrección | Test | Resultado |
|---|---|---|---|---|---|
| S-01 | Cabeceras de seguridad / CSP ausentes | `netlify.toml` | Cabeceras + CSP en modo *Report-Only* | `e2e/csp.spec.ts` (3) | CORREGIDO Y VERIFICADO en navegador local; pasar a *enforcing* tras observar en producción |
| S-02 | Token de API en localStorage | `lib/api.ts`, docs | Riesgo residual documentado, `rotarTokenApi()` para rotación | `backend.test.ts` (rotación) | CORREGIDO (mitigado), riesgo residual en `docs/SEGURIDAD.md` |
| S-03 | Atajo bloqueable desde fuera | `Code.gs atajo_` | Contador de fallos solo para tokens inválidos; token válido sigue limitado a 20/min | `backend.test.ts` seguridad | CORREGIDO Y VERIFICADO (backend simulado) |
| S-04 | `setup`/`crearTokenAtajo` y similares con el token diario | `Code.gs`, `FuncionesBackend.tsx`, `api.ts` | Token de administración separado (`ADMIN_TOKEN`), solo en memoria en la UI | matriz S-04 + guardia de clasificación de ACTIONS | CORREGIDO Y VERIFICADO (backend simulado) |
| S-05 | Escape de fórmulas disperso/incompleto | `Code.gs safeCell_` | Regex única `^[=+\-@\t\r\n]`, `mediosTexto_` | S-05 valores hostiles en ~12 acciones | CORREGIDO; comportamiento real del apóstrofo en Sheets **PENDIENTE DE VERIFICACIÓN REAL** |
| O-01 | Migración PLANTILLAS_MENSUALES vencida | `Code.gs` | Retirada (~195 líneas) | tests de migración eliminados con su código | CORREGIDO Y VERIFICADO |
| O-02 | `actualizarCatalogo` obsoleto | `Code.gs`, `demo.ts`, UI | Retirado | `e2e/app.spec.ts` | CORREGIDO; confirmar columna Orden en CATALOGO real: PENDIENTE (O-03) |
| O-03 | Inventario de conciliaciones anteriores / registros de prueba | hoja real | No realizado: requiere lectura de la hoja real | — | PENDIENTE |
| O-04 | `migrarGeneralAFondo`, `completarVacios` | `Code.gs` | **NO APLICA**: siguen siendo flujo vivo de la UI | — | Falso positivo del informe |
| D-04 | Duplicación de lecturas en Code.gs | `Code.gs` | No abstraído a ciegas | — | PENDIENTE (sin evidencia de defecto) |
| R-03 / A-14 | Carga diferida | `main.tsx`, vite | Ya implementada | build | Corregido previamente |
| A-01 | Sin CI | `.github/workflows/ci.yml`, `scripts/check-secretos.mjs` | Secretos, tsc, lint, tests, build, `npm audit` | ejecución local de cada paso | CORREGIDO; primera ejecución en GitHub **PENDIENTE** |
| A-02 | CSP vs zod JIT | `zodConfig.ts` | `z.config({ jitless: true })` | `csp.spec.ts` | CORREGIDO Y VERIFICADO |
| A-09 | `generacion` extra de caché | — | No justificada por la medición | — | NO APLICA |
| A-10 / A-12 | Versión única y README | `version.test.ts`, README, package-lock | 1.27.0 en 5 lugares, comprobado por test | `version.test.ts` | CORREGIDO Y VERIFICADO |
| A-11 | `app.spec.ts` de 2503 líneas, sin smoke en CI | `web/e2e` | No dividido en esta pasada | — | PENDIENTE |
| A-13 | Componentes de ~1000 líneas | `SaludFinanciera.tsx`, etc. | Sin dividir: no hay defecto, el riesgo de regresión no lo justifica ahora | — | PENDIENTE |
| T-01 | Contratos demo↔backend | `contratoDemo.test.ts` (5) | Paridad de acciones, secuencia idéntica, rechazos | idem | CORREGIDO Y VERIFICADO |
| T-02 | e2e dependía de la fecha actual | `e2e/v125.spec.ts` | Reloj fijo | e2e | CORREGIDO Y VERIFICADO |
| T-03 | Integridad ante fallos | `integracionRed.test.ts` (10) | Respuesta perdida, BUSY, dos pestañas, token inválido contra Code.gs real | idem | CORREGIDO Y VERIFICADO (backend simulado, no hoja real) |
| RN-01..13 | Regresión financiera oct/nov/dic 2026 | `lib/regresionMeses.test.ts` (13) | Céntimos enteros, tolerancia cero | idem | CORREGIDO Y VERIFICADO |
| N-01 | *Nuevo*: README sin 1.26.0 y package-lock en 0.0.0 | — | Corregido | `version.test.ts` | CORREGIDO Y VERIFICADO |
| N-02 | *Nuevo*: los tests no pasan por `tsc` | `tsconfig.app.json` | Sin cambio | — | PENDIENTE |
| N-03 | *Nuevo*: 76 advertencias de lint | varios | 99 → 76; restantes (only-export-components, set-state-in-effect, purity en handlers) no son defectos | lint 0 errores | ACEPTADO, documentado |

## C. Pruebas (conteos reales de la última ejecución)

| Suite | Resultado |
|---|---|
| Vitest | 37 archivos, **497/497** OK |
| Playwright e2e | 250/250 en la última corrida completa (incluye 3 de CSP) |
| `tsc -b` | sin errores |
| Lint | 0 errores, 76 advertencias |
| Secretos | 0 hallazgos en 134 archivos |

Ninguna prueba fue eliminada para obtener verde, salvo las de funciones retiradas junto con su código (O-01, O-02).

## D. Rendimiento

| Métrica | Antes | Después |
|---|---|---|
| Bundle principal (gzip) | 113.45 kB | 113.64 kB (+0.19 kB, zod sin JIT) |
| Chunk Cajas (gzip) | 18.68 kB | 18.72 kB |
| Parseo + validación, 1 000 / 5 000 / 10 000 gastos | No medido | 7.6 / 19.5 / 46.2 ms |
| Agregación, 1 000 / 5 000 / 10 000 gastos | No medido | 6.5 / 13.1 / 24.5 ms |
| Operaciones reales sobre Sheets / Apps Script | No medido (sin acceso) | No medido |

## E. Regresión funcional

Cubierta por e2e (250) en modo demo: fondos, gastos, conciliación (presupuesto disponible separado del saldo real verificado), cajas, compromisos, dashboard, salud financiera, configuración y accesibilidad. No se validó contra la hoja real.

## F. Estado de Git

- Rama `fix/auditoria-20261022`, creada desde la punta de `main` (que ya contiene `develop`); PR en borrador hacia `develop`.
- Sin `force push`, sin fusión a `main`. No se afirma que `main` esté protegida: no se verificó.

## G. Despliegue

Ver `docs/DESPLIEGUE-1.27.0.md`. **No ejecutado.**

## Estado final

| Estado | Elementos |
|---|---|
| CORREGIDO Y VERIFICADO | S-03, S-04, O-01, A-02, A-10, A-12, T-01, T-02, T-03, RN-01..13, N-01 |
| CORREGIDO, PENDIENTE DE VERIFICACIÓN REAL | S-01 (enforcing), S-05 (apóstrofo en Sheets), S-02, A-01 (primer run en GitHub), O-02 |
| NO APLICA | O-04, A-09, R-03/A-14 |
| PENDIENTE | A-11, A-13, D-04, O-03, N-02 |
| BLOQUEADO (requiere autorización) | Despliegue de backend y web, pruebas contra la hoja real |
