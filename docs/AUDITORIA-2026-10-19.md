# Auditoría integral — 2026-10-19

Alcance: estado de `main` tras el PR #43 (`e34035b`). Rama de trabajo: `audit/integral-20261019`.
No se añadieron funcionalidades, no se tocó la lógica financiera y las cajas siguen vigentes.

## Limitaciones de acceso (no verificable desde esta sesión)

| Qué | Estado |
|---|---|
| Web publicada (`deejota-finanzas.netlify.app`) | **No se pudo abrir**: el proxy de la sesión bloquea el dominio y no hay navegador enlazado. La validación de UI se hizo con Playwright contra la compilación local. |
| Despliegue de Apps Script en producción | **No inspeccionable** (no hay acceso al editor). Que `saveRevisionPresupuesto` funcionó en producción se deduce de la fila `rev-b4f10e20…` creada el 2026-10-19 21:49 UTC en `REVISIONES_PRESUPUESTO`; eso prueba que el despliegue conoce esa acción, no que sea idéntico a este `Code.gs`. |
| Google Sheets de producción | Leído **solo en lectura** con el conector de Drive (no se escribió nada). |
| Cálculo independiente sobre los 90 gastos reales | No realizado: solo se obtuvo el CSV en base64 sin poder canalizarlo a un script. Los cálculos se validaron con fixtures calculados a mano (ver F-04). |

## Esquema real vs. esquema esperado por el código

Las 12 hojas existentes en producción coinciden **exactamente** (nombre, orden y cantidad de columnas) con `SHEETS`/`PF_COLS_` de `Code.gs`:
`GASTOS` (16), `CATALOGO` (7), `MEDIOS_PAGO` (4), `CAJAS` (10), `PRESUPUESTOS` (3), `CONFIG` (2), `PLANTILLAS_FINANCIERAS` (19),
`VINCULOS_PLANTILLAS` (3), `REVISIONES_CALIDAD` (7), `FONDOS_PRESUPUESTO` (14), `FONDOS_PRESUPUESTO_MESES` (5), `REVISIONES_PRESUPUESTO` (7).
`CONCILIACIONES_ANTERIOR` (17 columnas, vacía) es el archivo de la migración. `ORDEN_GASTOS` no existe todavía: se crea al primer reordenamiento (comportamiento previsto).
No quedan hojas `FUENTES*` ni `*_MIGRADA`: la migración ya se ejecutó.

Observaciones de datos (sin acción; son decisiones del usuario o datos históricos):
- `Aporte Pareja`: el fondo vale 200 (editado el 19/10) y su plantilla conserva 400 con estado «aplicada» de octubre. Octubre es anterior al aislamiento mensual, así que la web usa el importe del fondo (200). No es un defecto.
- Hay 3 gastos «Propina Madre» de 100 el 2026-10-01; están marcados como legítimos en `REVISIONES_CALIDAD`.
- 5 gastos «Test-Claude …» **anulados** (fecha 2026-10-16) son restos de pruebas anteriores. No suman. Se pueden borrar a mano si se desea.
- `VINCULOS_PLANTILLAS` contiene un vínculo a `pl-63da0ca7…` que no aparece entre las filas visibles de plantillas (la muestra leída estaba truncada a 15 de 19); el código ignora vínculos huérfanos.
- Las plantillas de subcaja «Bebé»/«Auto» apuntan a cajas (`c-…`) que ya no existen (`CAJAS` está vacía). `aplicarPlantillasFin` ya lo contempla (vuelve a crear la entidad o no revierte).

## Defectos y correcciones

| ID | Sev. | Capa | Problema | Causa raíz | Corrección | Prueba |
|---|---|---|---|---|---|---|
| D-01 | P1 | Backend | `getData` lanza `TypeError` si la base no tiene `FONDOS_PRESUPUESTO`/`_MESES` (base nueva o restaurada): la app no carga. | El PR #43 quitó la guarda `getSheetByName(...) ? … : []` al retirar la compatibilidad. | Guarda restaurada en `getData_` (`Code.gs`). | `backend.test.ts › la primera fondo crea las hojas…` fallaba en `main`; ahora pasa. |
| D-02 | P3 | Frontend | `SwipeFila` decidía abrir/cerrar al soltar con el estado `arrastre`, que vale `null` si el render va retrasado respecto a los eventos. | Lectura de estado de React en un manejador en lugar de la posición del último evento. | Se calcula con `g.base - dx` acotado (`swipe.tsx`). | `swipe.test.tsx` (2 de 3 pruebas **fallan con el código anterior** y pasan con la corrección). Solo reproducido de forma sintética; no se observó en producción. |
| D-03 | P3 | Prueba | `v117.spec.ts:80` fallaba de forma intermitente. | El segundo gesto empezaba al 20 % del ancho: con la transición terminada ese punto es un botón de acción, no el contenido (en 390 px solo asoma una franja de 48 px). Pasaba solo si el gesto llegaba antes de terminar la animación. | El gesto empieza en la franja visible, tras esperar la transición. | 16/16 con 6 workers en paralelo (antes fallaba en todas bajo carga). |
| D-04 | P3 | Frontend/Backend | Código muerto: `periodTitle`, `estadoEnMes`, `AparienciaCampos` (+ imports), `Select`, `filasDeAmbito_`. | Restos de versiones anteriores sin referencias. | Eliminados. | `tsc -b`, lint y suites completas sin referencias rotas. |
| D-05 | P3 | Prueba | `v126.spec.ts:50` (siete escenarios encadenados) agotaba el límite de 30 s con varios workers (falló 10/10 con 5 workers; ≈20 s en solitario). | Prueba monolítica cercana al límite; no es un defecto de la app (3/3 en solitario). | `test.slow()` (límite ×3). | 10/10 con 5 workers. |

## Cobertura añadida

- `auditoriaFinanciera.test.ts` (12 pruebas, valores calculados a mano en céntimos): presupuesto cero, agotado, sobregasto, fondo inactivo, fondo de un mes, anulado, edición retroactiva de fecha, decimales, USD con y sin tipo de cambio, montos de 9 999 999,99, duplicados y reservas de cajas.
- `backend.test.ts` (+6): integración web (`createApi` + zod) ↔ `Code.gs` real ↔ filas crudas de Sheets con el perfil de producción (5 fondos con tipos, revisión existente): crear/editar/anular/restaurar gasto con reintento idempotente, ciclo de fondos y de importe mensual, revisión idempotente, configuración con token inválido, y `BUSY` sin filas a medias.
- `swipe.test.tsx` (3).

## Contratos web ↔ backend

49 acciones en `ACTIONS`; todas tienen consumidor en `api.ts`; ninguna acción de la web carece de implementación. `doGet` es el punto de entrada de comprobación de versión.

## Rendimiento

No se identificó un cuello de botella demostrable ni se midió una mejora, así que **no se optimizó nada**. `getData` hace una lectura por hoja con caché por generación y las escrituras usan `LockService`.

## Instrucciones de despliegue

1. Revisar y mergear el PR de la rama `audit/integral-20261019`.
2. **Redesplegar `apps-script/Code.gs`** como nueva versión de la aplicación web (el cambio D-01 es de backend; sin él, la corrección solo existe en GitHub).
3. Netlify publica el frontend al mergear a `main`.
4. Tras desplegar: abrir la web, comprobar que el Dashboard carga, registrar un gasto de prueba y anularlo.
