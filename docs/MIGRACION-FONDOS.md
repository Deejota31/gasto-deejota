# Migración a «Fondos del presupuesto» (v1.26.0)

Estado: **implementada en el código; la hoja real se migra con un botón (o desde el editor de Apps Script) después de volver a desplegar `Code.gs`.**

## 1. Qué cambió (modelo)

| Antes | Ahora |
|---|---|
| Fuentes de dinero | **Fondos del presupuesto** (un fondo = de dónde sale una parte del presupuesto del mes) |
| Una fuente podía ser «única» o «mensual» (la recurrencia hacía de tipo) | **Tipo de fondo** (mensual · extra · ahorro asignado) **independiente** de la **recurrencia** (todos los meses · solo un mes) |
| Conciliación de saldos (saldo real vs presupuesto, grupos de fuentes) | **Revisión del presupuesto** (¿el período está completo y es coherente?) sin saldos de banco |
| Salud financiera mezclaba presupuesto y conciliación | Solo presupuesto: calidad de datos, presupuesto, evolución, compromisos y revisión |

Reglas que se conservan sin cambiar fórmulas (motor `aggregate`): presupuesto consolidado = Σ aportes de los fondos activos aplicados al período; los extras y los ahorros de un mes solo cuentan en su período; cada mes tiene importes propios (aislamiento mensual) y editar un mes nunca toca los anteriores; las cajas reparten el mismo presupuesto (no suman dinero).

**Ahorro asignado**: *Carpeta Tésis* (S/ 1,900) y *Viaje a Ica* (S/ 1,414) se marcan automáticamente así al migrar (por nombre; se puede cambiar después). Es dinero ya separado para un objetivo: una distribución interna, no un ingreso nuevo.

## 2. Mapeo de hojas y columnas (Google Sheets)

| Hoja anterior | Hoja nueva | Qué pasa |
|---|---|---|
| `FUENTES` | `FONDOS_PRESUPUESTO` | Se **renombra** (mismas filas e IDs) y se agrega la columna 14 **Tipo de fondo** |
| `FUENTES_MESES` (col. A «Fuente ID») | `FONDOS_PRESUPUESTO_MESES` (col. A «Fondo ID») | Se renombra y se cambia solo el encabezado |
| `CONCILIACIONES` | `REVISIONES_PRESUPUESTO` (nueva) | `CONCILIACIONES` se **archiva** como `CONCILIACIONES_ANTERIOR` (no se borra nada). Las revisiones empiezan en blanco: los saldos reales ya no se usan |
| `PLANTILLAS_FINANCIERAS` col. *Tipo* = `fuente` | = `fondo` | Se convierte fila por fila |

`REVISIONES_PRESUPUESTO`: `ID, Período, Estado, Gastos pendientes, Observación, Reservado, Creado en`. Solo se agregan filas; la revisión vigente de un período es la última. Estados: `pendiente`, `completo`, `con_gastos_anteriores`, `revisado_con_observaciones`.

IDs: se conservan todos (también el histórico `fuente-general`; los fondos nuevos usan `fondo-general`). Ningún gasto referencia un fondo, así que `GASTOS` no se toca.

## 3. Matriz de impacto

| Capa | Cambio |
|---|---|
| `apps-script/Code.gs` | Hojas y columnas nuevas; acciones `saveFondo`, `saveFondoMes`, `deleteFondo`, `reorderFondos`, `migrarGeneralAFondo`, `saveRevisionPresupuesto`, `migrarAFondosPresupuesto`, `revertirMigracionAFondos`; `data` devuelve `fondos`, `fondosMeses`, `revisionesPresupuesto`, `migracion`; lectura compatible con las hojas anteriores; bloqueo de acciones sobre fondos hasta migrar |
| `web/src/lib` | Tipos `Fondo` (con `tipo`), `FondoMes`, `RevisionPres`; `api.ts` (+ capa de compatibilidad con un backend anterior); `store`, `demo`, `engine`, `fondoMedios`, `revisionPresupuesto` (nuevo); se eliminó `conciliacion` |
| `web/src/components` | `fondos.tsx` (formulario con *Tipo de fondo*), `RevisionPresupuesto.tsx`, `MigracionBanner.tsx`, Salud financiera, Cajas, Dashboard, Planificación y plantillas con el vocabulario nuevo |
| Pruebas | Backend (migración, revisión), unitarias (revisión, regresión financiera, compatibilidad), puerta de terminología, e2e |

## 4. Cómo migrar tu hoja real (5 minutos)

1. En Apps Script pega el nuevo `Code.gs` y **vuelve a desplegar** (misma URL, nueva versión).
2. Abre la web: aparece el aviso **«Migrar ahora»** (también puedes ejecutar `migrarAFondosPresupuesto` desde el editor).
3. La migración: hace **respaldo completo** (guardado en la carpeta de respaldos) → renombra hojas → asigna tipos → convierte plantillas → archiva la conciliación → **verifica** y devuelve los conteos antes/después.
4. Si algo se interrumpe, **vuelve a ejecutarla**: cada paso comprueba el estado real y no duplica filas.

Mientras no se migre: los gastos siguen funcionando, los fondos se **leen** (con las hojas anteriores) pero no se pueden editar (error claro `MIGRACION_PENDIENTE`).

## 5. Reversión (rollback)

- `revertirMigracionAFondos` (editor o acción): devuelve los nombres anteriores de hojas, el encabezado «Fuente ID», el tipo `fuente` de las plantillas y reabre `CONCILIACIONES`. No borra datos (la columna «Tipo de fondo» queda y es inocua).
- Respaldo completo previo: la URL queda en la propiedad `MIGRACION_FONDOS_RESPALDO` y en la respuesta de la migración.

## 6. Compatibilidad

- **Web nueva + Apps Script viejo**: la web reintenta con los nombres anteriores de las acciones y traduce los datos (`conCompatibilidad` en `api.ts`). `Tipo de fondo` se deduce (Tésis/Ica → ahorro asignado; un solo mes → extra). No hay banner de migración (el backend viejo no lo informa).
- **Apps Script nuevo + hoja sin migrar**: ver sección 4.

## 7. Verificación

- `npx vitest run`: backend con el `Code.gs` real sobre hojas simuladas (migración normal, repetida, a medias, hoja inexistente, reversión), motor, regresión financiera antes/después, compatibilidad, terminología.
- Puerta de terminología (`web/src/terminologia.test.ts`): ningún archivo de la app, del backend ni de e2e usa «fuente»/«conciliación» salvo el código marcado `compat-migración`.
- Playwright (modo demostración) para la interfaz.

## 8. Qué NO se pudo hacer desde aquí

- Desplegar `Code.gs` y ejecutar la migración sobre **tu Google Sheet real** (requiere tu cuenta). Está listo y probado con simulación del libro; el primer paso real es el respaldo automático.
- Aprobar el PR propio en GitHub (GitHub lo rechaza: el autor no puede aprobar su propio PR).
