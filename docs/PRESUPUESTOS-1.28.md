# Presupuestos inteligentes — v1.28.0

Rama `feat/presupuestos-inteligentes` (desde `fix/auditoria-20261022`, f4170a3). No desplegada.

## A. Resumen ejecutivo
Se retiran Cajas, Subcajas y Reservas (UI, Dashboard, backend, tipos). La pestaña pasa a **Presupuestos** y los **fondos** son la única estructura. Cada fondo define medios de pago (Todos / Todos excepto / Solo seleccionados) y cobertura (todos / ámbito / categoría / subcategoría / personalizada). Un motor determinista reparte cada gasto, desborda a General, permite asignación manual trazable y nunca reclasifica gastos.

## B. Arquitectura
```
Google Sheets ── Apps Script (Code.gs 1.28.0) ── web (React 19 + Vite)
 FONDOS_PRESUPUESTO (col 15 Reglas JSON)   validarRegla / validarMedioGasto /     lib/presupuesto.ts (motor, por mes)
 FONDOS_PRESUPUESTO_MESES                  validarAsignacion (mismos mensajes     lib/engine.ts (PresupuestoResumen)
 ASIGNACIONES_GASTOS (nueva)               que la web)                            tabs/Presupuestos, components/fondos
 GASTOS (sin cambios)                      retirarCajas (simula / archiva)        Asignacion, ResumenFondos
```

## C. Limpieza
Eliminados: `Cajas.tsx`, `cajas.tsx`, `lib/alcance.ts`, `cajaLook`, CajaModal, etapa «subcajas» del plan, plantillas de subcaja. `ResumenCajas` → `ResumenFondos`. Tests de cajas reescritos para fondos; e2e de Cajas retirados (ver matriz).

## D. Eliminación de Cajas
- Alias de ruta `#cajas → #presupuestos` (compatibilidad de enlaces antiguos; sin página `/cajas`).
- API: `cajas` y `presupuestos` de respuestas ≤1.27 se ignoran (test `regresionFinanciera`); el backend sigue devolviendo `[]` para web 1.27.
- Hojas antiguas intactas hasta ejecutar `retirarCajas` (solo las archiva).
- e2e `terminología v1.28`: la UI no contiene «subcaja», «caja(s)» ni «reserva(s)».

## E. Motor de fondos
Prioridad: asignación manual → exclusividad de medio → especificidad (subcategoría > categoría > ámbito > todos) → orden manual → ID estable. General es último recurso. Fondos con la misma cobertura suman capacidad y se consumen en orden. Excedente: automático a General (puede quedar negativo); si el medio está restringido, se sobregira el fondo elegible. Un medio que viola una restricción **bloquea el guardado** (web y backend, mismo mensaje); un fondo sin presupuesto no bloquea. Un gasto que ningún fondo cubre queda «Sin fondo asignable». Invariante por gasto: imputado + sin fondo = total. Reglas versionadas por mes: editar solo recalcula el mes vigente; el historial no cambia. Aislamiento desde 2026-11: solo fondos aplicados al mes.

## F. Resultados financieros (comprobados en tests)
Perfil producción: General 3000 + Aporte Pareja 200 + Sodexo 280 + Carpeta Tésis 1900 + Viaje a Ica 1414 = 6794. Demo octubre: General 3500 + Sodexo 280 + Extra 1 1000 = 4780. Regla nueva desde noviembre no altera octubre (`regresionFinanciera`).

## G. Pruebas
Ver la matriz y la sección de resultados al final (cifras reales de la última ejecución).

## H. Comparación
71 archivos tocados: +2390 / −3258 líneas netas respecto de f4170a3 (reducción neta). `Code.gs` 2972 → 3031 líneas (reglas, asignaciones y migración). Sin dependencias nuevas.

## I. Git
Rama `feat/presupuestos-inteligentes`; base f4170a3; PR borrador a `develop` (depende de #46). No se fusionó a `main`, sin force push.

## J. Migración
Ver `DESPLIEGUE-1.28.0.md`. Esquema: columna «Reglas» en `FONDOS_PRESUPUESTO`, hoja `ASIGNACIONES_GASTOS`. Mapeo: fondos antiguos → `reglasLegado`; subcajas no se convierten. Simulación por defecto; respaldo antes de aplicar; rollback renombrando hojas. Pendiente de aprobación: ejecutar `retirarCajas` con `aplicar:true`.

## K. Despliegue
Ver `DESPLIEGUE-1.28.0.md` (respaldo → esquema → backend → retirar cajas → frontend → validar → logs → rollback).

## Matriz final
| ID | Requisito | Estado | Evidencia |
|---|---|---|---|
| R1 | Quitar Cajas/Subcajas/Reservas de UI, tipos, Dashboard | Implementado y verificado | grep sin uso operativo; e2e terminología |
| R2 | Pestaña Presupuestos, `#presupuestos`, alias `#cajas` | Implementado y verificado | `navegacion.ts`, e2e v121 |
| R3 | Medios Todos / excepto / solo | Implementado y verificado | `fondosMedios.test`, `presupuesto.test` |
| R4 | Cobertura todos/ámbito/categoría/subcategoría/personalizada | Implementado y verificado | `presupuesto.test`, `fondos.test` |
| R5 | Sin nombres hardcodeados | Implementado y verificado | catálogo e IDs; reglas en JSON |
| R6 | Bloqueo de medio restringido (web y backend) | Implementado y verificado | `backend.test`, `presupuestosBackend.test`, `regresionFinanciera` |
| R7 | Prioridad, General fallback, desborde, sobregiro | Implementado y verificado | `presupuesto.test` (43) |
| R8 | Asignación manual y restaurar | Implementado y verificado | `presupuestosBackend.test`, `Asignacion.tsx` |
| R9 | Integridad imputado + sin fondo = total | Implementado y verificado | `auditoriaFinanciera.test` |
| R10 | Historial protegido (versionado) | Implementado y verificado | `regresionFinanciera`, `regresionMeses` |
| R11 | KPIs Dashboard y excedente en tabla de gastos | Implementado y verificado | `PresupuestoConsolidado.test`, `Dashboard.test` |
| R12 | Migración segura de Sheets | Implementado, pendiente de verificación real | `retirarCajas` simulada en tests; no ejecutada en producción |
| R13 | Aporte Pareja se mantiene en 200 | Implementado y verificado | no hay conversión automática |
| R14 | e2e navegación, fondos, gastos, dashboard, salud, responsive | Ver sección de resultados e2e | `web/e2e` |
| R15 | Despliegue / publicación / merge a main | No aplica, justificado | prohibido por el encargo |
