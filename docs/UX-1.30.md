# Mejoras Fase 2 (v1.30)

Cambia **`apps-script/Code.gs`** (pegar y desplegar como nueva versión) y la web.

## A. Cambios por mejora
1. **Nuevo fondo**: se eliminó el bloque «Vista previa». El formulario termina en *Fondo activo | Restricción* + Cancelar / Crear fondo. El color del fondo se sigue calculando y guardando igual; payload y lógica financiera sin cambios.
2. **Salud financiera**: las 4 tarjetas usan `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` (sin anchos fijos, importes sin `truncate`).
3. **Revisión del presupuesto**
   - Estados como tarjetas seleccionables con descripción breve (siguen siendo 4). «Gastos anteriores por registrar» y «Revisado con observaciones» exigen su texto, en la web **y** en el backend.
   - Alertas compactas con importe y detalle por fondo desplegable; si los fondos sobregirados explican exactamente el exceso del consolidado es **una** alerta, no dos. Un excedente no es un error de datos.
   - Días sin movimientos: solo fechas ya transcurridas (no hoy ni futuras), informativos, cada día abre «Nuevo gasto» con la fecha.
   - Historial compacto (últimas 3; «Incluir otros períodos»); la hoja sigue siendo de solo agregar. Completar una revisión no crea gastos ni toca fondos.
   - Un único cálculo (`revisarPeriodo` sobre el motor `aggregate`) alimenta Dashboard, Presupuestos y Salud.
4. **Hojas de Google Sheets** (ver matriz y procedimiento abajo).

## B. Archivos principales
`web/src/components/{fondos,SaludFinanciera,RevisionPresupuesto,FuncionesBackend}.tsx`, `web/src/lib/{revisionPresupuesto,demo}.ts`, `apps-script/Code.gs`, `web/src/testing/backendHarness.ts`, pruebas y `web/e2e/v130.spec.ts`.

## C. Matriz de hojas (catálogo central: `SHEETS` + `HOJAS_USO_` en Code.gs)
| Hoja | Estado | Uso actual | Dependencias | Acción |
|---|---|---|---|---|
| GASTOS | vigente | Registro de gastos | Todo | Conservar |
| CATALOGO | vigente | Ámbitos/categorías/subcategorías | Formulario, filtros, coberturas | Conservar |
| MEDIOS_PAGO | vigente | Medios de pago | Formulario, reglas de fondos | Conservar |
| CONFIG | vigente | Moneda, tipos de cambio, aislamiento | Motor, Ajustes | Conservar |
| ORDEN_GASTOS | vigente | Orden de la tabla | Tabla de Gastos | Conservar |
| VINCULOS_PLANTILLAS | vigente | Gasto ↔ plantilla | Plantillas de gasto | Conservar |
| REVISIONES_CALIDAD | vigente | Decisiones sobre alertas de calidad | Calidad de datos | Conservar |
| FONDOS_PRESUPUESTO | vigente | Fondos y reglas | Presupuestos, Salud, Revisión | Conservar |
| FONDOS_PRESUPUESTO_MESES | vigente | Importe por fondo y mes | Presupuesto consolidado | Conservar |
| ASIGNACIONES_GASTOS | vigente | Asignación manual a fondos | Motor | Conservar |
| PLANTILLAS_FINANCIERAS | vigente | Plantillas de fondo y de gasto | Aplicar plantillas | Conservar |
| REVISIONES_PRESUPUESTO | vigente | Historial de revisiones | Revisión, Salud | Conservar |
| CAJAS, PRESUPUESTOS | **obsoleta** | Modelo anterior de Cajas | Ninguna en web/API | `retirarCajas` → `limpiarHojasObsoletas` |
| ARCHIVO_CAJAS, ARCHIVO_PRESUPUESTOS (y `_n`) | **obsoleta** | Archivo que deja `retirarCajas` | Ninguna | `limpiarHojasObsoletas` |
| Cualquier otra | desconocida | — | — | Revisar manualmente (nunca se toca) |

La función **`auditarHojas`** devuelve esta matriz con los datos reales de tu archivo (registros, columnas, acción).

## Procedimiento seguro en tu Google Sheets
1. Pegar el nuevo `Code.gs` y desplegar nueva versión.
2. En *Configuración → Funciones del backend*: **Auditar hojas** (solo lectura) y revisar la matriz.
3. **Retirar cajas → Simular → Aplicar** (respaldo + crea el fondo General si no hay fondos + archiva).
4. **Eliminar hojas obsoletas → Simular → Aplicar**: respaldo completo, comprueba que el respaldo contiene cada hoja con el mismo número de registros, elimina solo las confirmadas, reinicia la instalación y verifica que no reaparecen y que las vigentes siguen. Si algo no se puede verificar queda **pendiente** y no se elimina.
5. Ejecutar *Instalar / verificar (setup)* y comprobar que no se recrean.

`setup()` y `repararHojas()` recorren únicamente `SHEETS`, por lo que nunca crean CAJAS ni PRESUPUESTOS (prueba automática incluida). Se retiró además el código de compatibilidad `cajas`/`presupuestos` de la lectura y de `completarVacios`.
